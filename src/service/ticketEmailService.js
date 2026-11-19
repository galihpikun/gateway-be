import QRCode from "qrcode";
import prisma from "./prisma.js";
import MailService from "./mailService.js";

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html = (value) => value.replace(/[&<>"']/g, (character) => entities[character]);

async function sendTickets(contact, tickets) {
  const english = contact.language === "en";
  const event = tickets[0].orderItem.ticketType.event.title;
  const order = contact.order.orderNumber;
  const subject = english ? `Your Gateway tickets · ${order}` : `Tiket Gateway Anda · ${order}`;
  const message = english
    ? "Payment confirmed. Show one QR code per ticket to the gate staff."
    : "Pembayaran terkonfirmasi. Tunjukkan satu kode QR per tiket kepada petugas pintu masuk.";
  const attachments = [];
  const sections = [];
  const codes = [];
  for (const ticket of tickets) {
    const { ticketCode, orderItem } = ticket;
    const image = await QRCode.toBuffer(ticketCode, {
      type: "png", width: 240, margin: 4, errorCorrectionLevel: "H",
    });
    const cid = `qr-${ticket.id}`;
    const name = orderItem.ticketType.name;
    attachments.push({
      filename: `${ticketCode}.png`,
      content: image.toString("base64"),
      content_type: "image/png",
      content_id: cid,
    });
    sections.push(`<div style="margin:24px 0"><h2>${html(name)}</h2><img src="cid:${cid}" width="240" height="240" alt="QR ${html(ticketCode)}"><p><strong>${html(ticketCode)}</strong></p></div>`);
    codes.push(`${name}: ${ticketCode}`);
  }
  await MailService.deliver({
    to: [contact.email],
    subject,
    text: `${event}\n${order}\n\n${message}\n\n${codes.join("\n")}`,
    html: `<h1>${html(event)}</h1><p>${html(order)}</p><p>${message}</p>${sections.join("")}`,
    attachments,
  }, `ticket-email/${contact.orderId}`);
}

export async function processQueuedTicketEmails(orderId) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return;
  const pending = await prisma.orderBuyerContact.findMany({
    where: {
      ...(orderId && { orderId }),
      nextEmailAttempt: { lte: new Date() },
      emailSentAt: null,
      order: { paymentStatus: "PAID" },
    },
    include: { order: { select: { orderNumber: true } } },
    orderBy: { nextEmailAttempt: "asc" },
    take: 10,
  });
  for (const contact of pending) {
    const lease = new Date(Date.now() + 2 * 60_000);
    const claimed = await prisma.orderBuyerContact.updateMany({
      where: { orderId: contact.orderId, emailSentAt: null, nextEmailAttempt: contact.nextEmailAttempt },
      data: { nextEmailAttempt: lease, emailAttempts: { increment: 1 } },
    });
    if (!claimed.count) continue;

    const claim = { orderId: contact.orderId, nextEmailAttempt: lease };
    try {
      const tickets = await prisma.issuedTicket.findMany({
        where: { orderItem: { orderId: contact.orderId }, isCancelled: false, isRefunded: false },
        select: {
          id: true,
          ticketCode: true,
          orderItem: { select: { ticketType: { select: { name: true, event: { select: { title: true } } } } } },
        },
        orderBy: { id: "asc" },
      });
      if (tickets.length) await sendTickets(contact, tickets);
      await prisma.orderBuyerContact.updateMany({
        where: claim,
        data: { nextEmailAttempt: null, emailSentAt: tickets.length ? new Date() : null },
      });
    } catch (error) {
      const waitMinutes = Math.min(60, 2 ** Math.min(contact.emailAttempts, 6));
      await prisma.orderBuyerContact.updateMany({
        where: claim,
        data: { nextEmailAttempt: new Date(Date.now() + waitMinutes * 60_000) },
      });
      console.error("Ticket email will retry:", contact.orderId, error.message);
    }
  }
}
