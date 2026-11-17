import prisma, { Prisma } from "../service/prisma.js";

export const lookupTicket = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { ticketCode, eventId } = req.body;

  if (!ticketCode || !ticketCode.trim()) {
    return res.status(400).json({ statusCode: 400, message: "Ticket code is required" });
  }

  const code = ticketCode.trim().toUpperCase();

  try {
    const ticket = await prisma.issuedTicket.findUnique({
      where: { ticketCode: code },
      include: {
        orderItem: {
          include: {
            ticketType: {
              include: {
                event: {
                  include: {
                    staffs: {
                      where: { userId },
                    },
                  },
                },
              },
            },
            order: {
              select: {
                orderNumber: true,
                paymentStatus: true,
                user: {
                  select: { id: true, fullName: true, email: true },
                },
              },
            },
          },
        },
      },
    });

    if (!ticket || ticket.orderItem.order.paymentStatus !== "PAID") {
      return res.status(404).json({ statusCode: 404, message: "Ticket not found" });
    }

    const staffAssignment = ticket.orderItem.ticketType.event.staffs;
    if (req.user?.role !== "ADMIN" && staffAssignment.length === 0) {
      return res.status(403).json({ statusCode: 403, message: "You are not assigned to this event" });
    }

    const event = ticket.orderItem.ticketType.event;
    if (!eventId || eventId !== event.id) return res.status(409).json({ message: "Ticket belongs to another event" });

    return res.status(200).json({
      id: ticket.id,
      ticketCode: ticket.ticketCode,
      isRedeemed: ticket.isRedeemed,
      isCancelled: ticket.isCancelled,
      isRefunded: ticket.isRefunded,
      redeemedAt: ticket.redeemedAt,
      createdAt: ticket.createdAt,
      ticketType: {
        id: ticket.orderItem.ticketType.id,
        name: ticket.orderItem.ticketType.name,
        price: ticket.orderItem.ticketType.price,
      },
      event: {
        id: event.id,
        title: event.title,
        status: event.status,
        location: event.location,
        startDatetime: event.startDatetime,
        endDatetime: event.endDatetime,
      },
      order: {
        orderNumber: ticket.orderItem.order.orderNumber,
        paymentStatus: ticket.orderItem.order.paymentStatus,
      },
      owner: ticket.orderItem.order.user,
    });
  } catch (error) {
    console.error("Lookup ticket error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const redeemTicket = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { ticketCode, eventId } = req.body;

  if (!ticketCode || !ticketCode.trim()) {
    return res.status(400).json({ statusCode: 400, message: "Ticket code is required" });
  }

  const code = ticketCode.trim().toUpperCase();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.issuedTicket.findUnique({
        where: { ticketCode: code },
        include: {
          orderItem: {
            include: {
              ticketType: {
                include: { event: true },
              },
              order: {
                select: {
                  orderNumber: true,
                  paymentStatus: true,
                  user: {
                    select: { id: true, fullName: true, email: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!ticket || ticket.orderItem.order.paymentStatus !== "PAID") {
        throw { statusCode: 404, message: "Ticket not found" };
      }

      const ticketEvent = ticket.orderItem.ticketType.event;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${ticketEvent.id} FOR UPDATE`);
      const event = await tx.event.findUnique({ where: { id: ticketEvent.id } });
      if (!eventId || eventId !== event.id) throw { statusCode: 409, message: "Ticket belongs to another event" };
      const activeRefund = await tx.refund.findFirst({ where: { orderId: ticket.orderItem.orderId, eventId, status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING"] } } });
      if (activeRefund) throw { statusCode: 409, message: "Ticket is locked while a refund is pending" };

      const staffAssignment = await tx.eventStaff.findUnique({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId,
          },
        },
      });

      if (req.user?.role !== "ADMIN" && !staffAssignment) {
        throw { statusCode: 403, message: "You are not assigned to this event" };
      }

      if (event.status !== "PUBLISHED") {
        throw { statusCode: 400, message: "Redemption is only allowed for published events" };
      }

      const now = new Date();
      if (now < event.startDatetime || now > event.endDatetime) {
        throw { statusCode: 400, message: "Redemption is only allowed during the event schedule" };
      }

      if (ticket.isCancelled) {
        throw { statusCode: 409, message: "Ticket has been cancelled" };
      }

      if (ticket.isRefunded) {
        throw { statusCode: 409, message: "Ticket has been refunded" };
      }

      if (ticket.isRedeemed) {
        throw { statusCode: 409, message: "Ticket has already been redeemed" };
      }

      const redeemed = await tx.issuedTicket.updateMany({
        where: {
          id: ticket.id,
          isRedeemed: false,
          isCancelled: false,
          isRefunded: false,
        },
        data: {
          isRedeemed: true,
          redeemedAt: now,
        },
      });

      if (redeemed.count === 0) {
        throw { statusCode: 409, message: "Ticket has already been redeemed" };
      }

      return {
        message: "Ticket redeemed successfully",
        ticket: {
          id: ticket.id,
          ticketCode: ticket.ticketCode,
          isRedeemed: true,
          redeemedAt: now,
          ticketType: {
            id: ticket.orderItem.ticketType.id,
            name: ticket.orderItem.ticketType.name,
            price: ticket.orderItem.ticketType.price,
          },
          event: {
            id: event.id,
            title: event.title,
            status: event.status,
            location: event.location,
            startDatetime: event.startDatetime,
            endDatetime: event.endDatetime,
          },
          order: {
            orderNumber: ticket.orderItem.order.orderNumber,
            paymentStatus: ticket.orderItem.order.paymentStatus,
          },
          owner: ticket.orderItem.order.user,
        },
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};
