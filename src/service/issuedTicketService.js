import { gateRefundStatuses, refundBlocksGate } from "./refundService.js";
import { randomBytes } from "crypto";
import prisma from "./prisma.js";
import { buildPaginatedResponse, parsePagination } from "../utils/paginate.js";

async function withRefundLocks(tickets) {
  if (!tickets.length) return tickets;
  const orderIds = [...new Set(tickets.map(ticket => ticket.orderItem.orderId))];
  const refunds = await prisma.refund.findMany({
    where: { orderId: { in: orderIds }, status: { in: gateRefundStatuses } },
    select: { orderId: true, eventId: true, type: true, status: true },
  });
  const byOrder = Map.groupBy(refunds, refund => refund.orderId);
  const now = new Date();
  return tickets.map(ticket => {
    const { event } = ticket.orderItem.ticketType;
    const refundLocked = (byOrder.get(ticket.orderItem.orderId) ?? [])
      .some(refund => refund.eventId === event.id && refundBlocksGate(refund, event, now));
    return { ...ticket, refundLocked };
  });
}

export class IssuedTicketService {
  static generateTicketCode() {
    const randomHex = randomBytes(4).toString("hex").toUpperCase();
    const timestampPart = Date.now().toString(36).toUpperCase().slice(-4);
    return `TCK-${timestampPart}-${randomHex}`;
  }

  static async issueTicketsForOrder(orderId, tx) {
    const db = tx || prisma;

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            issuedTickets: true,
          },
        },
      },
    });

    if (!order) {
      throw { statusCode: 404, message: "Order not found" };
    }

    if (order.paymentStatus !== "PAID") {
      throw { statusCode: 409, message: "Cannot issue tickets for unpaid order" };
    }

    const alreadyIssued = order.orderItems.some((item) => item.issuedTickets.length > 0);
    if (alreadyIssued) {
      return order.orderItems.flatMap((item) => item.issuedTickets);
    }

    const createdTickets = [];

    for (const item of order.orderItems) {
      for (let i = 0; i < item.quantity; i++) {
        let ticketCreated = false;
        let attempts = 0;

        while (!ticketCreated && attempts < 5) {
          attempts++;
          const ticketCode = this.generateTicketCode();

          try {
            const ticket = await db.issuedTicket.create({
              data: {
                orderItemId: item.id,
                ticketCode,
                isRedeemed: false,
                isCancelled: false,
                redeemedAt: null,
              },
            });
            createdTickets.push(ticket);
            ticketCreated = true;
          } catch (error) {
            if (error.code === "P2002" && attempts < 5) {
              continue;
            }
            throw error;
          }
        }

        if (!ticketCreated) {
          throw { statusCode: 409, message: "Failed to generate unique ticket code" };
        }
      }
    }

    return createdTickets;
  }

  static async getMyTickets(userId, query) {
    const { page, limit, skip, requested } = parsePagination(query);
    const where = { orderItem: { order: { userId, paymentStatus: "PAID" } } };
    const tickets = await prisma.issuedTicket.findMany({
      where,
      ...(requested && { skip, take: limit }),
      include: {
        orderItem: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
            order: {
              select: {
                id: true,
                orderNumber: true,
                createdAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const data = await withRefundLocks(tickets);
    if (!requested) return data;
    const total = await prisma.issuedTicket.count({ where });
    return buildPaginatedResponse(data, total, page, limit);
  }

  static async getTicketDetail(userId, ticketId) {
    const ticket = await prisma.issuedTicket.findUnique({
      where: { id: ticketId },
      include: {
        orderItem: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
            order: true,
          },
        },
      },
    });

    if (!ticket) {
      throw { statusCode: 404, message: "Ticket not found" };
    }

    if (ticket.orderItem.order.userId !== userId) {
      throw { statusCode: 403, message: "You do not have access to this ticket" };
    }

    const [result] = await withRefundLocks([ticket]);
    return result;
  }

  static async getAdminTickets(query) {
    const { page, limit, skip } = parsePagination(query);

    const where = {};

    if (query?.isRedeemed !== undefined) {
      where.isRedeemed = query.isRedeemed === "true";
    }

    if (query?.isCancelled !== undefined) {
      where.isCancelled = query.isCancelled === "true";
    }

    if (query?.eventId) {
      where.orderItem = {
        ticketType: {
          eventId: query.eventId,
        },
      };
    }

    if (query?.search) {
      where.OR = [
        { ticketCode: { contains: query.search, mode: "insensitive" } },
        {
          orderItem: {
            order: {
              OR: [
                { orderNumber: { contains: query.search, mode: "insensitive" } },
                { user: { fullName: { contains: query.search, mode: "insensitive" } } },
              ],
            },
          },
        },
      ];
    }

    const [tickets, total] = await Promise.all([
      prisma.issuedTicket.findMany({
        where,
        include: {
          orderItem: {
            include: {
              ticketType: {
                include: {
                  event: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                },
              },
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  paymentStatus: true,
                  user: {
                    select: {
                      id: true,
                      fullName: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.issuedTicket.count({ where }),
    ]);

    return buildPaginatedResponse(tickets, total, page, limit);
  }

  static async getAdminTicketDetail(ticketId) {
    const ticket = await prisma.issuedTicket.findUnique({
      where: { id: ticketId },
      include: {
        orderItem: {
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
            order: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      throw { statusCode: 404, message: "Ticket not found" };
    }

    return ticket;
  }
}

export default IssuedTicketService;
