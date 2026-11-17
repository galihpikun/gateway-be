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
    if (!secretKey) throw new Error("XENDIT_SECRET_KEY is required");
    const authHeader = Buffer.from(`${secretKey}:`).toString("base64");
    const body = {
      ...(payload.paymentId.startsWith("py-") ? { payment_id: payload.paymentId } : { payment_request_id: payload.paymentId }),
      reference_id: payload.idempotencyKey,
      ...(!payload.paymentId.startsWith("py-") && { currency: "IDR" }),
      amount: payload.amount,
      reason: ["FRAUDULENT", "DUPLICATE", "REQUESTED_BY_CUSTOMER", "CANCELLATION", "OTHERS"].includes(payload.reason) ? payload.reason : "REQUESTED_BY_CUSTOMER",
      ...(payload.metadata && { metadata: payload.metadata }),
    };

    const res = await fetch(payload.paymentId.startsWith("py-") ? "https://api.xendit.co/v3/refunds" : "https://api.xendit.co/refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
        "Idempotency-key": payload.idempotencyKey,
        ...(payload.paymentId.startsWith("py-") && { "api-version": "2024-11-11" }),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errorMsg = data?.message || data?.error_code || `Xendit error ${res.status}`;
      throw new Error(errorMsg);
    }

    return { ...data, id: data.refund_id || data.id };
  }

  static async createCustomerRefund(userId, { orderId, reason }) {
    if (typeof orderId !== "string" || typeof reason !== "string" || !reason.trim()) throw { statusCode: 400, message: "Order and refund reason are required" };
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
        const eventId = items[0].ticketType.event.id;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
        const event = await tx.event.findUnique({ where: { id: eventId } });
        const redeemedNow = await tx.issuedTicket.count({ where: { isRedeemed: true, orderItem: { orderId: order.id, ticketType: { eventId } } } });
        if (redeemedNow) throw { statusCode: 409, message: "Tickets have already been used" };

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

        const previous = await tx.refund.findUnique({ where: { order_event_refund_unique: { orderId: order.id, eventId: event.id, type: "CUSTOMER_REQUEST" } } });
        if (previous) throw { statusCode: 409, message: "A request already exists. Contact an administrator to retry a failed refund." };
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

  static async getCustomerRefunds(userId, query, organizer = false) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      ...(organizer ? { event: { organizerId: userId } } : { requestedById: userId }),
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
    await prisma.$transaction(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { event: true } });
      if (!refund) throw { statusCode: 404, message: "Refund not found" };
      if (!["PENDING_APPROVAL", "FAILED"].includes(refund.status)) throw { statusCode: 409, message: "Refund is not awaiting approval or retry" };
      const redeemed = await tx.issuedTicket.count({ where: { isRedeemed: true, orderItem: { orderId: refund.orderId, ticketType: { eventId: refund.eventId } } } });
      if (redeemed && refund.type === "CUSTOMER_REQUEST" && refund.event.status !== "CANCELLED") throw { statusCode: 409, message: "Tickets have already been used" };
      if (refund.type === "CUSTOMER_REQUEST" && refund.event.status !== "CANCELLED" && new Date() >= refund.event.startDatetime) throw { statusCode: 409, message: "Event has already started" };
      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: refund.status }, data: { status: "APPROVED", approvedById: adminId, approvedAt: new Date(), failureReason: null, failedAt: null, ...(refund.status === "FAILED" && { idempotencyKey: randomUUID(), pgRefundId: null }) } });
      if (!claimed.count) throw { statusCode: 409, message: "Refund was already processed" };
      await AuditLogService.log(adminId, "APPROVE_REFUND", "Refund", refundId, {}, tx);
    }, { isolationLevel: "Serializable" });
    return { message: "Refund approved and queued for processing", refund: await prisma.refund.findUnique({ where: { id: refundId } }) };
  }

  static async processQueuedRefunds() {
    const jobs = await prisma.refund.findMany({ where: { status: { in: ["APPROVED", "PROCESSING"] } }, include: { order: true }, take: 20, orderBy: { updatedAt: "asc" } });
    for (const job of jobs) {
      try {
        if (job.pgRefundId) {
          const modern = job.order.pgTransactionId?.startsWith("py-");
          const response = await fetch(`https://api.xendit.co/${modern ? "v3/" : ""}refunds/${encodeURIComponent(job.pgRefundId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}`, ...(modern && { "api-version": "2024-11-11" }) }, signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("Cannot reconcile gateway refund; queued for retry");
          const data = await response.json();
          const refund = await this.getAdminRefundDetail(job.id);
          if (data.status === "SUCCEEDED") await this.finalizeRefundSucceeded(refund, job.pgRefundId);
          else if (data.status === "FAILED") await this.finalizeRefundFailed(refund, job.pgRefundId, data.failure_reason || data.failure_code);
          else await prisma.refund.updateMany({ where: { id: job.id, status: "PROCESSING" }, data: { updatedAt: new Date() } });
          continue;
        }
        let paymentId = job.order.pgTransactionId;
        if (paymentId?.startsWith("ps-")) {
          const response = await fetch(`https://api.xendit.co/sessions/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}` }, signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("Cannot retrieve payment for refund; queued for retry");
          const session = await response.json();
          paymentId = session.payment_id || session.payment_request_id;
          if (paymentId) await prisma.order.updateMany({ where: { id: job.orderId, pgTransactionId: job.order.pgTransactionId }, data: { pgTransactionId: paymentId } });
        }
        if (!paymentId || !/^(py-|pr-)/.test(paymentId)) throw new Error("Payment reference unavailable; queued for reconciliation");
        const claim = await prisma.refund.updateMany({ where: { id: job.id, status: { in: ["APPROVED", "PROCESSING"] }, pgRefundId: null }, data: { status: "PROCESSING" } });
        if (!claim.count) continue;
        const response = await this.createXenditRefund({ paymentId, amount: Number(job.amount), reason: job.type === "EVENT_CANCELLATION" ? "CANCELLATION" : "REQUESTED_BY_CUSTOMER", idempotencyKey: job.idempotencyKey, metadata: { refundId: job.id, refundKey: job.idempotencyKey } });
        if (!response.id) throw new Error("Refund response lacks its identifier");
        await prisma.refund.updateMany({ where: { id: job.id, status: { in: ["APPROVED", "PROCESSING"] } }, data: { pgRefundId: response.id, failureReason: null } });
        const currentRefund = await this.getAdminRefundDetail(job.id);
        if (response.status === "SUCCEEDED") await this.finalizeRefundSucceeded(currentRefund, response.id);
        else if (response.status === "FAILED") await this.finalizeRefundFailed(currentRefund, response.id, response.failure_reason || response.failure_code);
      } catch (error) {
        // Keep durable queue state on transport/configuration errors; retry with the same key.
        await prisma.refund.updateMany({ where: { id: job.id, status: { in: ["APPROVED", "PROCESSING"] } }, data: { failureReason: error.message } });
      }
    }
  }

  static async rejectRefund(adminId, refundId, body = {}) {
    const reason = (body.reason || body.adminReason || body.rejectionReason || "").trim();
    if (!reason) {
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
    if (!process.env.XENDIT_WEBHOOK_TOKEN || token !== process.env.XENDIT_WEBHOOK_TOKEN) {
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

    const callbackKey = data.metadata?.refundKey || body.metadata?.refundKey;
    if (pgRefundId && refund.pgRefundId !== pgRefundId && callbackKey !== refund.idempotencyKey) return { message: "Stale or unmatched refund callback acknowledged; reconciliation will confirm status" };

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
      await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${refund.orderId} FOR UPDATE`);
      refund = await tx.refund.findUnique({ where: { id: refund.id }, include: { order: { include: { orderItems: { include: { ticketType: true, issuedTickets: true } } } } } });

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
              increment: item.issuedTickets.filter(t => !t.isRefunded).length,
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

      const prior = await client.refund.findMany({ where: { orderId, eventId, status: { in: ["APPROVED", "PROCESSING", "SUCCEEDED"] } }, select: { amount: true } });
      const remaining = eligibleAmount.sub(prior.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)));
      await client.refund.updateMany({ where: { orderId, eventId, status: "PENDING_APPROVAL" }, data: { status: "REJECTED", adminReason: "Replaced by automatic event cancellation refund" } });
      if (remaining.lessThanOrEqualTo(0)) continue;
      const calculation = this.calculateCancellationRefund(remaining);

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

    return {
      count: createdRefunds.length,
      message: `Created ${createdRefunds.length} cancellation refund record(s)`,
    };
  }
}

export default RefundService;
