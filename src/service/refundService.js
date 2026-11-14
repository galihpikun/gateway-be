import { randomUUID } from "crypto";
import prisma, { Prisma } from "./prisma.js";
import AuditLogService from "./auditLogService.js";
import { buildPaginatedResponse } from "../utils/paginate.js";

export const CUSTOMER_REFUND_DEDUCTION_RATE = 0.05;
export const REFUND_CALENDAR_TIMEZONE = "Asia/Jakarta";

export class RefundService {
  static getEventCalendarDateString(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: REFUND_CALENDAR_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  static calculateCustomerRefund(eligiblePaidAmount) {
    const original = new Prisma.Decimal(eligiblePaidAmount);
    if (original.lessThanOrEqualTo(0)) {
      throw new Error("Eligible paid amount must be greater than zero");
    }
    const deduction = original
      .mul(CUSTOMER_REFUND_DEDUCTION_RATE)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const payout = original.sub(deduction);

    return {
      originalAmount: original,
      deductionAmount: deduction,
      refundAmount: payout,
    };
  }

  static calculateCancellationRefund(eligiblePaidAmount) {
    const original = new Prisma.Decimal(eligiblePaidAmount);
    if (original.lessThanOrEqualTo(0)) {
      throw new Error("Eligible paid amount must be greater than zero");
    }
    return {
      originalAmount: original,
      deductionAmount: new Prisma.Decimal(0),
      refundAmount: original,
    };
  }

  static validateCumulativeRefund(existingRefundedSum, newRefundAmount, orderTotalAmount) {
    const existing = new Prisma.Decimal(existingRefundedSum);
    const newAmount = new Prisma.Decimal(newRefundAmount);
    const total = new Prisma.Decimal(orderTotalAmount);

    if (existing.add(newAmount).greaterThan(total)) {
      throw new Error(
        `Cumulative refund amount (${existing.add(newAmount).toFixed(2)}) cannot exceed total order amount (${total.toFixed(2)})`
      );
    }
  }

  static async createXenditRefund(payload) {
    const secretKey = process.env.XENDIT_SECRET_KEY;
    if (!secretKey) {
      // Mock for test environments when key not set
      return {
        id: `mock_ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        status: "PENDING",
      };
    }

    const authHeader = Buffer.from(`${secretKey}:`).toString("base64");
    const body = {
      payment_id: payload.paymentId,
      amount: payload.amount,
      reason: payload.reason || "REQUESTED_BY_CUSTOMER",
      ...(payload.metadata && { metadata: payload.metadata }),
    };

    const res = await fetch("https://api.xendit.co/refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
        "Idempotency-key": payload.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errorMsg = data?.message || data?.error_code || `Xendit error ${res.status}`;
      throw new Error(errorMsg);
    }

    return data;
  }

  static async createCustomerRefund(userId, { orderId, reason }) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
            issuedTickets: true,
          },
        },
      },
    });

    if (!order) {
      throw { statusCode: 404, message: "Order not found" };
    }

    if (order.userId !== userId) {
      throw { statusCode: 403, message: "You do not own this order" };
    }

    if (order.paymentStatus !== "PAID") {
      throw { statusCode: 400, message: "Only paid orders can be refunded" };
    }

    if (!order.orderItems || order.orderItems.length === 0) {
      throw { statusCode: 400, message: "Order does not have any items" };
    }

    const itemsByEvent = new Map();
    for (const item of order.orderItems) {
      const eventId = item.ticketType.event.id;
      const group = itemsByEvent.get(eventId) || [];
      group.push(item);
      itemsByEvent.set(eventId, group);
    }

    const now = new Date();
    const todayCalendarStr = this.getEventCalendarDateString(now);
    const createdRefunds = [];

    await prisma.$transaction(async (tx) => {
      for (const [, items] of itemsByEvent.entries()) {
        const event = items[0].ticketType.event;

        if (!event.isRefundable) {
          throw { statusCode: 400, message: `Event "${event.title}" is marked as non-refundable` };
        }

        if (event.status === "CANCELLED") {
          throw {
            statusCode: 400,
            message: `Event "${event.title}" is cancelled and will be refunded automatically`,
          };
        }

        const eventStartCalendarStr = this.getEventCalendarDateString(event.startDatetime);
        if (todayCalendarStr >= eventStartCalendarStr) {
          throw {
            statusCode: 400,
            message: `Refund requests for "${event.title}" must be submitted before the event's calendar date`,
          };
        }

        if (now >= event.startDatetime) {
          throw { statusCode: 400, message: `Event "${event.title}" has already started` };
        }

        const allIssuedTickets = items.flatMap((i) => i.issuedTickets);
        const hasRedeemed = allIssuedTickets.some((t) => t.isRedeemed);
        if (hasRedeemed) {
          throw {
            statusCode: 400,
            message: `Cannot request refund for "${event.title}": one or more tickets have already been redeemed`,
          };
        }

        const hasAlreadyRefunded = allIssuedTickets.some((t) => t.isRefunded);
        if (hasAlreadyRefunded) {
          throw {
            statusCode: 409,
            message: `Tickets for "${event.title}" have already been refunded`,
          };
        }

        const existingRefund = await tx.refund.findFirst({
          where: {
            orderId: order.id,
            eventId: event.id,
            status: {
              in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCEEDED"],
            },
          },
        });

        if (existingRefund) {
          throw {
            statusCode: 409,
            message: `A refund request for "${event.title}" is already active or completed`,
          };
        }

        const eligibleAmount = items.reduce(
          (sum, i) => sum.add(new Prisma.Decimal(i.price).mul(i.quantity)),
          new Prisma.Decimal(0)
        );

        const calculation = this.calculateCustomerRefund(eligibleAmount);

        const pastRefunds = await tx.refund.findMany({
          where: {
            orderId: order.id,
            status: { in: ["PROCESSING", "SUCCEEDED"] },
          },
          select: { amount: true },
        });

        const cumulativeSum = pastRefunds.reduce((acc, r) => acc.add(r.amount), new Prisma.Decimal(0));
        this.validateCumulativeRefund(cumulativeSum, calculation.refundAmount, order.totalAmount);

        const refund = await tx.refund.create({
          data: {
            orderId: order.id,
            eventId: event.id,
            requestedById: userId,
            type: "CUSTOMER_REQUEST",
            status: "PENDING_APPROVAL",
            originalAmount: calculation.originalAmount,
            deductionAmount: calculation.deductionAmount,
            amount: calculation.refundAmount,
            reason: reason.trim(),
            idempotencyKey: randomUUID(),
          },
          include: {
            event: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

        await AuditLogService.log(
          userId,
          "REQUEST_REFUND",
          "Refund",
          refund.id,
          {
            orderId: order.id,
            eventId: event.id,
            originalAmount: calculation.originalAmount.toFixed(2),
            deductionAmount: calculation.deductionAmount.toFixed(2),
            refundAmount: calculation.refundAmount.toFixed(2),
            reason: reason.trim(),
          },
          tx
        );

        createdRefunds.push(refund);
      }
    });

    return {
      message: "Refund request submitted successfully",
      refunds: createdRefunds.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        eventId: r.eventId,
        eventTitle: r.event.title,
        originalAmount: r.originalAmount,
        deductionAmount: r.deductionAmount,
        amount: r.amount,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  static async getCustomerRefunds(userId, query) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      requestedById: userId,
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
    };

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        include: {
          event: {
            select: {
              id: true,
              title: true,
              coverImageUrl: true,
              startDatetime: true,
              endDatetime: true,
            },
          },
          order: {
            select: {
              id: true,
              orderNumber: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.refund.count({ where }),
    ]);

    return buildPaginatedResponse(refunds, total, page, limit);
  }

  static async getCustomerRefundDetail(userId, refundId) {
    const refund = await prisma.refund.findFirst({
      where: {
        id: refundId,
        requestedById: userId,
      },
      include: {
        event: true,
        order: {
          include: {
            orderItems: {
              include: {
                ticketType: true,
                issuedTickets: true,
              },
            },
          },
        },
      },
    });

    if (!refund) {
      throw { statusCode: 404, message: "Refund not found" };
    }

    return refund;
  }

  static async getAdminRefunds(query) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
      ...(query.eventId && { eventId: query.eventId }),
      ...(query.orderId && { orderId: query.orderId }),
      ...(query.search && {
        OR: [
          { order: { orderNumber: { contains: query.search, mode: "insensitive" } } },
          { event: { title: { contains: query.search, mode: "insensitive" } } },
          { requestedBy: { fullName: { contains: query.search, mode: "insensitive" } } },
          { requestedBy: { email: { contains: query.search, mode: "insensitive" } } },
        ],
      }),
    };

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        include: {
          event: { select: { id: true, title: true, startDatetime: true } },
          order: { select: { id: true, orderNumber: true, totalAmount: true, paymentStatus: true } },
          requestedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.refund.count({ where }),
    ]);

    return buildPaginatedResponse(refunds, total, page, limit);
  }

  static async getAdminRefundDetail(refundId) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        event: true,
        order: {
          include: {
            orderItems: {
              include: {
                ticketType: true,
                issuedTickets: true,
              },
            },
          },
        },
        requestedBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    if (!refund) {
      throw { statusCode: 404, message: "Refund not found" };
    }

    return refund;
  }

  static async approveRefund(adminId, refundId) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: { order: true, event: true },
    });

    if (!refund) {
      throw { statusCode: 404, message: "Refund not found" };
    }

    if (refund.status !== "PENDING_APPROVAL") {
      throw { statusCode: 409, message: `Refund cannot be approved from status "${refund.status}"` };
    }

    const now = new Date();
    const updated = await prisma.refund.updateMany({
      where: { id: refund.id, status: "PENDING_APPROVAL" },
      data: {
        status: "APPROVED",
        approvedById: adminId,
        approvedAt: now,
      },
    });

    if (updated.count === 0) {
      throw { statusCode: 409, message: "Refund is no longer pending approval" };
    }

    await AuditLogService.log(adminId, "APPROVE_REFUND", "Refund", refund.id, {
      orderId: refund.orderId,
      eventId: refund.eventId,
      amount: refund.amount.toFixed(2),
    });

    const paymentId = refund.order.pgTransactionId;
    if (!paymentId) {
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          failureReason: "Order does not have a payment gateway transaction ID",
        },
      });
      throw { statusCode: 400, message: "Order lacks a payment gateway transaction identifier" };
    }

    try {
      const xenditRes = await this.createXenditRefund({
        paymentId,
        amount: Number(refund.amount),
        reason: refund.reason,
        idempotencyKey: refund.idempotencyKey || randomUUID(),
        metadata: {
          refundId: refund.id,
          orderId: refund.orderId,
          eventId: refund.eventId,
        },
      });

      const processedRefund = await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: "PROCESSING",
          pgRefundId: xenditRes.id,
        },
      });

      await AuditLogService.log(adminId, "INITIATE_REFUND", "Refund", refund.id, {
        pgRefundId: xenditRes.id,
        status: "PROCESSING",
      });

      return {
        message: "Refund approved and processing initiated",
        refund: processedRefund,
      };
    } catch (err) {
      const errMsg = err.message || "Payment gateway refund request failed";
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          failureReason: errMsg,
        },
      });

      await AuditLogService.log(adminId, "FAIL_REFUND", "Refund", refund.id, {
        failureReason: errMsg,
      });

      throw { statusCode: 502, message: errMsg };
    }
  }

  static async rejectRefund(adminId, refundId, { reason }) {
    if (!reason || !reason.trim()) {
      throw { statusCode: 400, message: "Rejection reason is required" };
    }

    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
    });

    if (!refund) {
      throw { statusCode: 404, message: "Refund not found" };
    }

    if (refund.status !== "PENDING_APPROVAL") {
      throw { statusCode: 409, message: `Refund cannot be rejected from status "${refund.status}"` };
    }

    const updated = await prisma.refund.updateMany({
      where: { id: refund.id, status: "PENDING_APPROVAL" },
      data: {
        status: "REJECTED",
        adminReason: reason.trim(),
        rejectedById: adminId,
        rejectedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw { statusCode: 409, message: "Refund is no longer pending approval" };
    }

    await AuditLogService.log(adminId, "REJECT_REFUND", "Refund", refund.id, {
      adminReason: reason.trim(),
    });

    const rejected = await prisma.refund.findUnique({
      where: { id: refund.id },
    });

    return {
      message: "Refund request rejected",
      refund: rejected,
    };
  }

  static async handleWebhook(token, body) {
    if (token !== process.env.XENDIT_WEBHOOK_TOKEN) {
      throw { statusCode: 403, message: "Invalid webhook verification token" };
    }

    if (!body || typeof body !== "object") {
      throw { statusCode: 400, message: "Invalid webhook body" };
    }

    const event = body.event || body.type;
    const data = body.data || body;
    const pgRefundId = data.id || data.refund_id || body.id;
    const metadataRefundId = data.metadata?.refundId || body.metadata?.refundId;

    if (!pgRefundId && !metadataRefundId) {
      throw { statusCode: 400, message: "Refund reference not found in webhook body" };
    }

    const refund = await prisma.refund.findFirst({
      where: {
        OR: [
          ...(pgRefundId ? [{ pgRefundId }] : []),
          ...(metadataRefundId ? [{ id: metadataRefundId }] : []),
        ],
      },
      include: {
        order: {
          include: {
            orderItems: {
              include: {
                ticketType: true,
                issuedTickets: true,
              },
            },
          },
        },
      },
    });

    if (!refund) {
      throw { statusCode: 404, message: "Associated refund record not found" };
    }

    if (refund.status === "SUCCEEDED" || refund.status === "FAILED") {
      return { message: "Refund webhook already processed" };
    }

    if (event === "refund.succeeded" || data.status === "SUCCEEDED") {
      return this.finalizeRefundSucceeded(refund, pgRefundId);
    }

    if (event === "refund.failed" || data.status === "FAILED") {
      const reason = data.failure_reason || data.reason || "Payment gateway refund failed";
      return this.finalizeRefundFailed(refund, pgRefundId, reason);
    }

    return { message: "Webhook event acknowledged" };
  }

  static async finalizeRefundSucceeded(refund, pgRefundId) {
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.refund.updateMany({
        where: {
          id: refund.id,
          status: { in: ["PROCESSING", "APPROVED"] },
        },
        data: {
          status: "SUCCEEDED",
          succeededAt: now,
          ...(pgRefundId && { pgRefundId }),
        },
      });

      if (updateResult.count === 0) return;

      const matchingItems = refund.order.orderItems.filter(
        (oi) => oi.ticketType.eventId === refund.eventId
      );

      const ticketIds = matchingItems
        .flatMap((oi) => oi.issuedTickets)
        .filter((t) => !t.isRefunded)
        .map((t) => t.id);

      if (ticketIds.length > 0) {
        await tx.issuedTicket.updateMany({
          where: { id: { in: ticketIds } },
          data: {
            isRefunded: true,
            refundedAt: now,
            isCancelled: true,
            refundId: refund.id,
          },
        });
      }

      for (const item of matchingItems) {
        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: {
            availableQuota: {
              increment: item.quantity,
            },
          },
        });
      }

      await AuditLogService.log(
        null,
        "CONFIRM_REFUND",
        "Refund",
        refund.id,
        {
          orderId: refund.orderId,
          eventId: refund.eventId,
          amount: refund.amount.toFixed(2),
          ticketsRefundedCount: ticketIds.length,
        },
        tx
      );
    });

    return { message: "Refund succeeded and processed" };
  }

  static async finalizeRefundFailed(refund, pgRefundId, reason) {
    const now = new Date();

    await prisma.refund.updateMany({
      where: {
        id: refund.id,
        status: { in: ["PROCESSING", "APPROVED"] },
      },
      data: {
        status: "FAILED",
        failedAt: now,
        failureReason: reason || "Gateway refund failed",
        ...(pgRefundId && { pgRefundId }),
      },
    });

    await AuditLogService.log(null, "FAIL_REFUND", "Refund", refund.id, {
      failureReason: reason,
    });

    return { message: "Refund failure recorded" };
  }

  static async triggerAutomaticEventCancellationRefunds(eventId, cancelReason, actorId, txClient) {
    const client = txClient || prisma;

    const event = await client.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTypes: {
          include: {
            orderItems: {
              where: {
                order: {
                  paymentStatus: "PAID",
                },
              },
              include: {
                order: true,
                issuedTickets: true,
              },
            },
          },
        },
      },
    });

    if (!event) {
      throw { statusCode: 404, message: "Event not found" };
    }

    if (!event.isRefundable) {
      return { count: 0, message: "Event is non-refundable" };
    }

    const itemsByOrder = new Map();
    for (const tt of event.ticketTypes) {
      for (const oi of tt.orderItems) {
        const orderId = oi.order.id;
        const group = itemsByOrder.get(orderId) || [];
        group.push(oi);
        itemsByOrder.set(orderId, group);
      }
    }

    const createdRefunds = [];

    for (const [orderId, items] of itemsByOrder.entries()) {
      const order = items[0].order;

      const existing = await client.refund.findFirst({
        where: {
          orderId,
          eventId,
          type: "EVENT_CANCELLATION",
          status: {
            in: ["APPROVED", "PROCESSING", "SUCCEEDED"],
          },
        },
      });

      if (existing) continue;

      const eligibleAmount = items.reduce(
        (sum, i) => sum.add(new Prisma.Decimal(i.price).mul(i.quantity)),
        new Prisma.Decimal(0)
      );

      const calculation = this.calculateCancellationRefund(eligibleAmount);

      const refund = await client.refund.create({
        data: {
          orderId,
          eventId,
          requestedById: order.userId,
          type: "EVENT_CANCELLATION",
          status: "APPROVED",
          originalAmount: calculation.originalAmount,
          deductionAmount: calculation.deductionAmount,
          amount: calculation.refundAmount,
          reason: `Event cancelled: ${cancelReason}`,
          idempotencyKey: randomUUID(),
          approvedAt: new Date(),
          approvedById: actorId,
        },
      });

      await AuditLogService.log(
        actorId || null,
        "AUTO_CANCEL_REFUND",
        "Refund",
        refund.id,
        {
          eventId,
          orderId,
          amount: calculation.refundAmount.toFixed(2),
          reason: cancelReason,
        },
        txClient
      );

      createdRefunds.push({
        refundId: refund.id,
        paymentId: order.pgTransactionId,
        amount: calculation.refundAmount.toNumber(),
        reason: refund.reason,
        idempotencyKey: refund.idempotencyKey,
      });
    }

    if (createdRefunds.length > 0) {
      setImmediate(async () => {
        for (const job of createdRefunds) {
          try {
            if (!job.paymentId) continue;
            const res = await RefundService.createXenditRefund({
              paymentId: job.paymentId,
              amount: job.amount,
              reason: job.reason,
              idempotencyKey: job.idempotencyKey || randomUUID(),
              metadata: { refundId: job.refundId, eventId },
            });
            await prisma.refund.update({
              where: { id: job.refundId },
              data: {
                status: "PROCESSING",
                pgRefundId: res.id,
              },
            });
          } catch (err) {
            await prisma.refund.update({
              where: { id: job.refundId },
              data: {
                status: "FAILED",
                failedAt: new Date(),
                failureReason: err.message,
              },
            });
          }
        }
      });
    }

    return {
      count: createdRefunds.length,
      message: `Created ${createdRefunds.length} cancellation refund record(s)`,
    };
  }
}

export default RefundService;
