import prisma from "./prisma.js";
import IssuedTicketService from "./issuedTicketService.js";

export class PaymentService {
  static async createPaymentSession(order, user) {
    const secretKey = process.env.XENDIT_SECRET_KEY;

    if (!secretKey) {
      // Mock payment session for environments without active Xendit API key
      const mockSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        paymentSessionId: mockSessionId,
        paymentUrl: `https://checkout-staging.xendit.co/v2/${mockSessionId}`,
      };
    }

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
      const errorText = await response.text();
      console.error("Xendit payment session error", { status: response.status, body: errorText });
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

  static async handleWebhook(token, body) {
    if (token !== process.env.XENDIT_WEBHOOK_TOKEN) {
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

    if (order.paymentStatus === "PAID" || order.paymentStatus === "EXPIRED") {
      return { message: "Payment webhook already processed" };
    }

    const paymentSessionId = this.getPaymentSessionId(body);

    await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.updateMany({
        where: {
          id: order.id,
          paymentStatus: "PENDING",
        },
        data: {
          paymentStatus: "PAID",
          ...(paymentSessionId && {
            pgTransactionId: paymentSessionId,
          }),
        },
      });

      if (updatedOrder.count === 0) {
        return;
      }

      await IssuedTicketService.issueTicketsForOrder(order.id, tx);
    });

    return { message: "Payment completed" };
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
