import { createHash, randomBytes } from "crypto";
import prisma, { Prisma } from "../service/prisma.js";
import PaymentService from "../service/paymentService.js";
import { parseBuyerContact } from "../utils/buyerContact.js";
import { buildPaginatedResponse } from "../utils/paginate.js";

function generateOrderNumber(date) {
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

function computeFingerprint(dto, buyer) {
  const normalized = dto.items
    .map((item) => `${item.ticketTypeId}:${item.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(JSON.stringify([normalized, buyer])).digest("hex");
}

async function expireOrder(orderId) {
  return await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.updateMany({
      where: {
        id: orderId,
        paymentStatus: "PENDING",
        expiresAt: { lt: new Date() },
      },
      data: { paymentStatus: "EXPIRED" },
    });

    if (updatedOrder.count === 0) return false;

    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
    });

    for (const orderItem of orderItems) {
      await tx.ticketType.update({
        where: { id: orderItem.ticketTypeId },
        data: {
          availableQuota: {
            increment: orderItem.quantity,
          },
        },
      });
    }

    return true;
  });
}

export async function expirePendingOrders(userId) {
  const expiredOrders = await prisma.order.findMany({
    where: {
      paymentStatus: "PENDING",
      expiresAt: { lt: new Date() },
      ...(userId && { userId }),
    },
    select: { id: true },
  });

  let count = 0;
  for (const order of expiredOrders) {
    const expired = await expireOrder(order.id);
    if (expired) count++;
  }
  return count;
}

async function cancelFailedPaymentOrder(orderId) {
  await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: "PENDING" },
      data: { paymentStatus: "FAILED" },
    });

    if (updatedOrder.count === 0) return;

    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
    });

    for (const orderItem of orderItems) {
      await tx.ticketType.update({
        where: { id: orderItem.ticketTypeId },
        data: {
          availableQuota: {
            increment: orderItem.quantity,
          },
        },
      });
    }
  });
}

export const createOrder = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const dto = req.body || {};

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, organizerProfile: { select: { status: true } } },
    });

    if (!user) {
      return res.status(404).json({ statusCode: 404, message: "User not found" });
    }

    if (user.role !== "USER" || user.organizerProfile?.status === "APPROVED") {
      return res.status(403).json({ message: "Only regular customer accounts can buy tickets." });
    }

    if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      return res.status(400).json({ statusCode: 400, message: "Order must contain items" });
    }

    if (dto.items.some((item) => !item || typeof item.ticketTypeId !== "string" || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
      return res.status(400).json({ statusCode: 400, message: "Each ticket quantity must be a positive integer" });
    }

    const buyer = parseBuyerContact(dto.buyer);
    if (!buyer.contact) return res.status(400).json({ message: buyer.error });
    const fingerprint = computeFingerprint(dto, buyer.contact);

    if (dto.idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: {
          orderItems: {
            include: {
              ticketType: {
                include: { event: true },
              },
            },
          },
        },
      });

      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          return res.status(409).json({
            statusCode: 409,
            message: "Idempotency key already used with a different request",
          });
        }

        if (existing.paymentStatus === "FAILED" || existing.paymentStatus === "EXPIRED") {
          return res.status(409).json({
            statusCode: 409,
            message: "Previous order with this idempotency key has failed or expired. Use a new idempotency key.",
          });
        }

        return res.status(200).json({
          message: "Order created successfully",
          order: existing,
          paymentUrl: existing.paymentUrl,
        });
      }
    }

    const ticketTypeIds = dto.items.map((item) => item.ticketTypeId);
    const uniqueIds = [...new Set(ticketTypeIds)];
    if (uniqueIds.length !== ticketTypeIds.length) {
      return res.status(400).json({
        statusCode: 400,
        message: "Duplicate ticket types in order items are not allowed",
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const orderNumber = generateOrderNumber(now);

    const order = await prisma.$transaction(async (tx) => {
      const firstType = await tx.ticketType.findUnique({ where: { id: dto.items[0].ticketTypeId } });
      if (firstType) await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${firstType.eventId} FOR UPDATE`);
      const ticketTypes = await Promise.all(
        dto.items.map((item) =>
          tx.ticketType.findUnique({
            where: { id: item.ticketTypeId },
            include: { event: true },
          })
        )
      );

      let eventId = null;

      for (let i = 0; i < dto.items.length; i++) {
        const ticketType = ticketTypes[i];
        const item = dto.items[i];

        if (!ticketType) {
          throw { statusCode: 404, message: `Ticket type not found: ${item.ticketTypeId}` };
        }

        if (eventId === null) {
          eventId = ticketType.eventId;
        } else if (ticketType.eventId !== eventId) {
          throw { statusCode: 400, message: "All ticket types must belong to the same event" };
        }

        if (ticketType.event.organizerId === userId) {
          throw { statusCode: 403, message: "Only regular customer accounts can buy tickets." };
        }

        if (ticketType.event.status !== "PUBLISHED") {
          throw { statusCode: 409, message: "Event is not available for ticket sales" };
        }

        if (ticketType.event.endDatetime <= now) {
          throw { statusCode: 409, message: "Event has already ended" };
        }
      }

      for (let i = 0; i < dto.items.length; i++) {
        const ticketType = ticketTypes[i];
        const item = dto.items[i];

        const reservedQuota = await tx.ticketType.updateMany({
          where: {
            id: ticketType.id,
            availableQuota: {
              gte: item.quantity,
            },
          },
          data: {
            availableQuota: {
              decrement: item.quantity,
            },
          },
        });

        if (reservedQuota.count === 0) {
          throw { statusCode: 409, message: `Insufficient ticket quota for: ${ticketType.name}` };
        }
      }

      let totalAmount = new Prisma.Decimal(0);
      const orderItemsData = dto.items.map((item, i) => {
        const ticketType = ticketTypes[i];
        const lineTotal = new Prisma.Decimal(ticketType.price).mul(item.quantity);
        totalAmount = totalAmount.add(lineTotal);
        return {
          ticketTypeId: ticketType.id,
          quantity: item.quantity,
          price: ticketType.price,
        };
      });

      return tx.order.create({
        data: {
          orderNumber,
          userId,
          totalAmount,
          paymentStatus: "PENDING",
          expiresAt,
          idempotencyKey: dto.idempotencyKey ?? null,
          requestFingerprint: dto.idempotencyKey ? fingerprint : null,
          buyerContact: { create: buyer.contact },
          orderItems: {
            create: orderItemsData,
          },
        },
        include: {
          orderItems: {
            include: {
              ticketType: {
                include: { event: true },
              },
            },
          },
        },
      });
    });

    let paymentSession;
    try {
      paymentSession = await PaymentService.createPaymentSession(order, { id: user.id, email: buyer.contact.email, fullName: buyer.contact.fullName });
    } catch {
      await cancelFailedPaymentOrder(order.id);
      return res.status(400).json({ statusCode: 400, message: "Failed to create payment session" });
    }

    try {
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          pgTransactionId: paymentSession.paymentSessionId,
          paymentUrl: paymentSession.paymentUrl,
          paymentMethod: "XENDIT_PAYMENT_SESSION",
        },
        include: {
          orderItems: {
            include: {
              ticketType: {
                include: { event: true },
              },
            },
          },
        },
      });

      return res.status(201).json({
        message: "Order created successfully",
        order: updatedOrder,
        paymentUrl: paymentSession.paymentUrl,
      });
    } catch {
      return res.status(400).json({ statusCode: 400, message: "Failed to save payment session" });
    }
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};

export const getOrders = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  try {
    await expirePendingOrders(userId);

    const page = req.query?.page ? Number(req.query.page) : null;
    const limit = req.query?.limit ? Number(req.query.limit) : null;

    if (page !== null && limit !== null) {
      const skip = (page - 1) * limit;
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where: { userId },
          include: {
            orderItems: {
              include: {
                ticketType: {
                  include: { event: true },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.order.count({ where: { userId } }),
      ]);
      return res.status(200).json(buildPaginatedResponse(orders, total, page, limit));
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        refunds: true,
        orderItems: {
          include: {
            ticketType: {
              include: { event: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json(orders);
  } catch (error) {
    console.error("Get orders error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getOrderDetail = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { id } = req.params;

  try {
    let order = await prisma.order.findUnique({
      where: { id },
      include: {
        refunds: true,
        orderItems: {
          include: {
            ticketType: {
              include: { event: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ statusCode: 404, message: "Order not found" });
    }

    if (order.userId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You do not have access to this order" });
    }

    if (order.paymentStatus === "PENDING" && order.expiresAt < new Date()) {
      await expireOrder(order.id);
      const refreshed = await prisma.order.findUnique({
        where: { id },
        include: {
          orderItems: {
            include: {
              ticketType: {
                include: { event: true },
              },
            },
          },
        },
      });
      if (refreshed) order = refreshed;
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Get order detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getAdminOrders = async (req, res) => {
  await expirePendingOrders();

  const page = Number(req.query?.page) || 1;
  const limit = Number(req.query?.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  const statusFilter = req.query?.paymentStatus || req.query?.status;
  if (statusFilter) where.paymentStatus = statusFilter;
  if (req.query?.search) {
    where.OR = [
      { orderNumber: { contains: req.query.search, mode: "insensitive" } },
      { user: { fullName: { contains: req.query.search, mode: "insensitive" } } },
      { user: { email: { contains: req.query.search, mode: "insensitive" } } },
    ];
  }

  if (req.query?.dateFrom || req.query?.dateTo) {
    where.createdAt = {};
    if (req.query.dateFrom) where.createdAt.gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) where.createdAt.lte = new Date(req.query.dateTo);
  }

  try {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          orderItems: {
            include: {
              ticketType: {
                include: {
                  event: {
                    select: { id: true, title: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(orders, total, page, limit));
  } catch (error) {
    console.error("Get admin orders error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getAdminOrderDetail = async (req, res) => {
  const { id } = req.params;

  try {
    let order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        orderItems: {
          include: {
            ticketType: {
              include: {
                event: {
                  select: {
                    id: true,
                    title: true,
                    location: true,
                    startDatetime: true,
                    endDatetime: true,
                  },
                },
              },
            },
            issuedTickets: {
              select: {
                id: true,
                ticketCode: true,
                isRedeemed: true,
                isCancelled: true,
                redeemedAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ statusCode: 404, message: "Order not found" });
    }

    if (order.paymentStatus === "PENDING" && order.expiresAt < new Date()) {
      await expireOrder(order.id);
      const refreshed = await prisma.order.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          orderItems: {
            include: {
              ticketType: {
                include: {
                  event: {
                    select: {
                      id: true,
                      title: true,
                      location: true,
                      startDatetime: true,
                      endDatetime: true,
                    },
                  },
                },
              },
              issuedTickets: {
                select: {
                  id: true,
                  ticketCode: true,
                  isRedeemed: true,
                  isCancelled: true,
                  redeemedAt: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });
      if (refreshed) order = refreshed;
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Get admin order detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};
