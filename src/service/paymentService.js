import prisma, { Prisma } from "./prisma.js";
import { randomUUID } from "crypto";
import IssuedTicketService from "./issuedTicketService.js";

export class PaymentService {
  static async createPaymentSession(order, user) {
    const secretKey = process.env.XENDIT_SECRET_KEY;

    if (!secretKey) throw new Error("XENDIT_SECRET_KEY is required");

    const response = await fetch("https://api.xendit.co/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference_id: order.orderNumber,
        session_type: "PAY",
        mode: "PAYMENT_LINK",
        amount: Number(order.totalAmount),
        currency: "IDR",
        country: "ID",
        capture_method: "AUTOMATIC",
        expires_at: order.expiresAt.toISOString(),
        description: `Payment for order ${order.orderNumber}`,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
        },
        customer: {
          reference_id: `${user.id.replace(/-/g, "")}${order.id.replace(/-/g, "")}`,
          type: "INDIVIDUAL",
          email: user.email,
          individual_detail: {
            given_names: user.fullName,
          },
        },
      }),
    });

    if (!response.ok) {
      console.error("Xendit payment session error", { status: response.status });
      throw { statusCode: 400, message: "Failed to create Xendit payment session" };
    }

    const paymentSession = await response.json();
    const paymentSessionId = paymentSession.payment_session_id || paymentSession.id;

    if (!paymentSessionId || !paymentSession.payment_link_url) {
      throw { statusCode: 400, message: "Invalid Xendit payment session response" };
    }

    return {
      paymentSessionId,
      paymentUrl: paymentSession.payment_link_url,
    };
  }

  static async reconcilePayments() {
    if (!process.env.XENDIT_SECRET_KEY) return;
    const orders = await prisma.order.findMany({ where: { paymentStatus: { in: ["PENDING", "EXPIRED", "FAILED"] }, pgTransactionId: { startsWith: "ps-" } }, orderBy: { updatedAt: "asc" }, take: 20 });
    for (const order of orders) {
      try {
        // Rotate even when the provider is unavailable so other orders continue to get checked.
        await prisma.order.updateMany({ where: { id: order.id, paymentStatus: { not: "PAID" } }, data: { updatedAt: new Date() } });
        const response = await fetch(`https://api.xendit.co/sessions/${encodeURIComponent(order.pgTransactionId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}` }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) continue;
        const session = await response.json();
        if (session.status === "COMPLETED") await this.handlePaymentCompleted({ data: { ...session, metadata: { orderId: order.id } } });
        else if (session.status === "EXPIRED" && order.paymentStatus === "PENDING") await this.handlePaymentExpired({ data: { metadata: { orderId: order.id } } });
      } catch (error) {
        console.warn("Payment reconciliation will retry:", order.id, error.code || error.name || "Error");
      }
    }
  }

  static async handleWebhook(token, body) {
    if (!process.env.XENDIT_WEBHOOK_TOKEN || token !== process.env.XENDIT_WEBHOOK_TOKEN) {
      throw { statusCode: 403, message: "Invalid webhook token" };
    }

    const webhookBody = body;
    const event = webhookBody?.event || webhookBody?.type;

    if (event === "payment_session.completed") {
      return this.handlePaymentCompleted(webhookBody);
    }

    if (event === "payment_session.expired") {
      return this.handlePaymentExpired(webhookBody);
    }

    return { message: "Webhook received" };
  }

  static async handlePaymentCompleted(body) {
    const order = await this.findOrderFromWebhook(body);

    if (order.paymentStatus === "PAID") return { message: "Payment webhook already processed" };
    const data = body.data || body;
    if (data.amount !== undefined && Number(data.amount) !== Number(order.totalAmount)) throw { statusCode: 409, message: "Payment amount does not match order" };
    const paymentId = data.payment_id || data.payment_request_id || this.getPaymentSessionId(body);
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, include: { ticketType: true } });
    const eventId = items[0]?.ticketType.eventId;
    if (!eventId) throw { statusCode: 409, message: "Order has no event" };
    await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
      const current = await tx.order.findUnique({ where: { id: order.id } });
      if (current.paymentStatus === "PAID") return;
      const event = await tx.event.findUnique({ where: { id: eventId } });
      let compensate = event.status !== "PUBLISHED" || event.endDatetime <= new Date();
      // Expiration released this reservation. Reacquire inventory before issuing usable tickets.
      if (["EXPIRED", "FAILED"].includes(current.paymentStatus) && !compensate) {
        const tiers = await tx.ticketType.findMany({ where: { id: { in: items.map(i => i.ticketTypeId) } } });
        compensate = items.some(i => (tiers.find(t => t.id === i.ticketTypeId)?.availableQuota || 0) < i.quantity);
        if (!compensate) for (const item of items) {
          const reserved = await tx.ticketType.updateMany({ where: { id: item.ticketTypeId, availableQuota: { gte: item.quantity } }, data: { availableQuota: { decrement: item.quantity } } });
          if (!reserved.count) throw { statusCode: 409, message: "Inventory changed; retry payment webhook" };
        }
      }
      const changed = await tx.order.updateMany({ where: { id: order.id, paymentStatus: current.paymentStatus }, data: { paymentStatus: "PAID", pgTransactionId: paymentId } });
      if (!changed.count) throw { statusCode: 409, message: "Order changed; retry webhook" };
      if (compensate) {
        // A previously released reservation must not be returned again by refund finalization.
        if (current.paymentStatus === "PENDING") for (const item of items) await tx.ticketType.update({ where: { id: item.ticketTypeId }, data: { availableQuota: { increment: item.quantity } } });
        await tx.refund.upsert({ where: { order_event_refund_unique: { orderId: order.id, eventId, type: "EVENT_CANCELLATION" } }, create: { orderId: order.id, eventId, requestedById: order.userId, type: "EVENT_CANCELLATION", status: "APPROVED", originalAmount: order.totalAmount, amount: order.totalAmount, reason: "Payment received after event cancellation or inventory expiry", idempotencyKey: randomUUID(), approvedAt: new Date() }, update: {} });
      } else {
        await IssuedTicketService.issueTicketsForOrder(order.id, tx);
        await tx.orderBuyerContact.updateMany({
          where: { orderId: order.id },
          data: { nextEmailAttempt: new Date() },
        });
      }
    });
    return { message: "Payment completed and reconciled" };
  }

  static async handlePaymentExpired(body) {
    const order = await this.findOrderFromWebhook(body);

    if (order.paymentStatus === "PAID" || order.paymentStatus === "EXPIRED") {
      return { message: "Payment webhook already processed" };
    }

    await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.updateMany({
        where: {
          id: order.id,
          paymentStatus: "PENDING",
        },
        data: {
          paymentStatus: "EXPIRED",
        },
      });

      if (updatedOrder.count === 0) {
        return;
      }

      const orderItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
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

    return { message: "Payment expired" };
  }

  static async findOrderFromWebhook(body) {
    const paymentData = body?.data;
    const orderId = paymentData?.metadata?.orderId || body?.metadata?.orderId;
    const orderNumber =
      paymentData?.reference_id ||
      paymentData?.referenceId ||
      body?.reference_id ||
      body?.referenceId ||
      paymentData?.metadata?.orderNumber ||
      body?.metadata?.orderNumber;

    if (!orderId && !orderNumber) {
      throw { statusCode: 400, message: "Order reference is required" };
    }

    const order = orderId
      ? await prisma.order.findUnique({ where: { id: orderId } })
      : await prisma.order.findUnique({ where: { orderNumber } });

    if (!order) {
      throw { statusCode: 404, message: "Order not found" };
    }

    return order;
  }

  static getPaymentSessionId(body) {
    const paymentData = body?.data;
    return paymentData?.payment_session_id || paymentData?.id || body?.payment_session_id || body?.id;
  }
}

export default PaymentService;
