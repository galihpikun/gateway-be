import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import app from '../index.js';
import prisma from '../src/service/prisma.js';
import { generateToken } from '../src/utils/generateToken.js';
import PaymentService from '../src/service/paymentService.js';
import RefundService from '../src/service/refundService.js';
import CloudinaryService from '../src/service/cloudinaryService.js';
import { processQueuedTicketEmails } from '../src/service/ticketEmailService.js';

test('HTTP workflow: organizer review, atomic event, staff, payment, refund, recovery and late payment', async () => {
  const suffix = randomUUID();
  const ids = [], eventIds = [], orderIds = [];
  const previousPayment = PaymentService.createPaymentSession;
  const previousCloud = CloudinaryService.uploadImage;
  const previousRefund = RefundService.createXenditRefund;
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.XENDIT_WEBHOOK_TOKEN;
  const previousResend = process.env.RESEND_API_KEY;
  const previousSender = process.env.RESEND_FROM_EMAIL;
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let category, otp;
  let mailAvailable = false;
  const ticketEmails = [];
  const contact = { fullName: 'Demo Buyer', email: 'delivery@example.invalid', phone: '+6281212345678', identityType: 'KTP', identityNumber: '3201010101011234', language: 'id' };
  try {
    process.env.XENDIT_WEBHOOK_TOKEN = 'workflow-test';
    process.env.RESEND_API_KEY = 'test-only-key';
    process.env.RESEND_FROM_EMAIL = 'test@example.invalid';
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.resend.com/emails') {
        const message = JSON.parse(options.body);
        if (message.attachments) {
          ticketEmails.push({ message, key: options.headers['Idempotency-Key'] });
          if (!mailAvailable) return new Response(null, { status: 503 });
        } else {
          otp = message.text.match(/\b\d{6}\b/)[0];
        }
        return new Response(JSON.stringify({ id: 'test-mail' }), { status: 200 });
      }
      if (String(url).startsWith('https://')) throw new Error('Unexpected external network call in integration test');
      return previousFetch(url, options);
    };
    PaymentService.createPaymentSession = async (order, customer) => {
      assert.equal(customer.email, contact.email);
      assert.equal(customer.fullName, contact.fullName);
      return { paymentSessionId: `ps-${order.id}`, paymentUrl: 'https://example.invalid/test-checkout' };
    };
    CloudinaryService.uploadImage = async (file, folder, resourceType) => ({ public_id: 'test-only-image', secure_url: resourceType === 'video' ? 'https://example.invalid/test.mp4' : 'https://example.invalid/test.jpg' });
    RefundService.createXenditRefund = async payload => {
      assert.match(payload.paymentId, /^py-/);
      assert.ok(payload.amount > 0);
      return { id: `rfd-${payload.idempotencyKey}`, status: 'SUCCEEDED' };
    };
    async function user(role = 'USER') {
      const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${ids.length}-${suffix}@example.invalid`, fullName: 'Workflow Test', password: await bcrypt.hash('InitialPass123!', 10), role, emailVerified: true } });
      ids.push(u.id);
      return { ...u, token: generateToken(u) };
    }
    async function request(path, actor, method = 'GET', body, expected = 200) {
      const headers = { ...(actor && { Authorization: `Bearer ${actor.token}` }) };
      if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      if (path.includes('/webhook')) headers['x-callback-token'] = 'workflow-test';
      const r = await fetch(base + path, { method, headers, ...(body && { body: body instanceof FormData ? body : JSON.stringify(body) }) });
      const data = await r.json();
      assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    }
    const admin = await user('ADMIN'), organizer = await user(), buyer = await user(), staff = await user();
    category = await prisma.category.create({ data: { name: suffix, slug: suffix } });
    const form = new FormData();
    for (const [key, value] of Object.entries({ organizationName: 'Workflow Org', phoneNumber: '000', address: 'Test', bankName: 'Test', bankAccountNumber: '000', bankAccountName: 'Test' })) form.set(key, value);
    for (const name of ['businessLicense', 'guaranteeLetter', 'organizationRegistration', 'identityCard']) form.set(name, new Blob(['test'], { type: 'image/png' }), 'test.png');
    await request('/organizer/apply', organizer, 'POST', form, 200);
    const profile = await request('/organizer/me', organizer);
    for (const doc of profile.documents) await request(`/organizer/admin/documents/${doc.id}/approve`, admin, 'PATCH');
    await request(`/organizer/admin/${profile.id}/approve`, admin, 'PATCH');
    assert.equal((await request('/auth/me', organizer)).data.organizerProfile.status, 'APPROVED');
    const eventForm = new FormData();
    for (const [key, value] of Object.entries({ title: 'Workflow concert', description: 'Test fixture', categoryId: category.id, location: 'Test venue', startDatetime: new Date(Date.now() + 3 * 86400000).toISOString(), endDatetime: new Date(Date.now() + 4 * 86400000).toISOString(), isRefundable: 'true', ticketTypes: JSON.stringify([{ name: 'GA', price: 100000, quota: 10, viewPosition: 'FRONT' }]) })) eventForm.set(key, value);
    eventForm.set('coverImage', new Blob(['test'], { type: 'image/png' }), 'test.png');
    eventForm.set('previewVideo', new Blob(['0000ftyp'], { type: 'video/mp4' }), 'preview.mp4');
    await request('/events', organizer, 'POST', eventForm, 400);
    eventForm.set('venueLayout', 'INDONESIA_ARENA');
    await request('/events', organizer, 'POST', eventForm, 400);
    eventForm.set('ticketBackground', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'pass.png');
    const created = await request('/events', organizer, 'POST', eventForm, 201);
    assert.equal(created.event.venueLayout, 'INDONESIA_ARENA');
    assert.equal(created.event.ticketBackgroundUrl, 'https://example.invalid/test.jpg');
    const eventId = created.event.id; eventIds.push(eventId);
    const tiers = await request(`/ticket-types/event/${eventId}`);
    assert.equal(created.event.previewVideoUrl, 'https://example.invalid/test.mp4');
    assert.equal(tiers[0].viewPosition, 'FRONT');
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', {viewPosition:'seat-42'},400);
    await request(`/ticket-types/${tiers[0].id}`, buyer, 'PUT', {viewPosition:'REAR'},403);
    assert.equal((await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', {viewPosition:'BALCONY'})).viewPosition,'BALCONY');
    const removePreview = new FormData();removePreview.set('removePreviewVideo','true');
    await request(`/events/${eventId}`,organizer,'PATCH',removePreview);
    assert.equal((await request(`/events/organizer/${eventId}`,organizer)).previewVideoUrl,null);
    assert.equal(tiers.length, 1, 'event and tiers must be created atomically');
    await request(`/events/${eventId}/submit`, organizer, 'PATCH', undefined, 409);
    const outdoor = new FormData();
    outdoor.set('venueLayout', 'ICE_BSD');
    outdoor.set('previewVideo', new Blob(['0000ftyp'], { type: 'video/mp4' }), 'preview.mp4');
    await request(`/events/${eventId}`, organizer, 'PATCH', outdoor);
    await request(`/events/${eventId}/submit`, organizer, 'PATCH', undefined, 409);
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', { viewPosition: 'BALCONY' }, 400);
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', { viewPosition: 'REAR' });
    await request(`/events/${eventId}/submit`, organizer, 'PATCH');
    await request(`/events/admin/${eventId}/approve`, admin, 'PATCH');
    await request(`/events/organizer/${eventId}/staff`, organizer, 'POST', { userId: staff.id });
    assert.equal((await request('/staff/events', staff)).length, 1);
    await request('/orders', buyer, 'POST', { items: [{ ticketTypeId: tiers[0].id, quantity: -1 }] }, 400);
    const checkout = { items: [{ ticketTypeId: tiers[0].id, quantity: 2 }], buyer: contact, idempotencyKey: suffix };
    for (const restricted of [organizer, staff, admin]) {
      await request('/orders', restricted, 'POST', checkout, 403);
    }
    await prisma.organizerProfile.update({ where: { userId: organizer.id }, data: { status: 'REJECTED' } });
    try {
      await request('/orders', organizer, 'POST', checkout, 403);
    } finally {
      await prisma.organizerProfile.update({ where: { userId: organizer.id }, data: { status: 'APPROVED' } });
    }
    await request('/orders', buyer, 'POST', { ...checkout, buyer: undefined }, 400);
    await request('/orders', buyer, 'POST', { ...checkout, buyer: { ...contact, identityNumber: '1' } }, 400);
    const order = (await request('/orders', buyer, 'POST', checkout, 201)).order;
    orderIds.push(order.id);
    assert.equal((await request('/orders', buyer, 'POST', checkout)).order.id, order.id);
    await request('/orders', buyer, 'POST', { ...checkout, buyer: { ...contact, email: 'other@example.invalid' } }, 409);
    assert.equal(order.buyerContact, undefined);
    const savedBuyer = await prisma.orderBuyerContact.findUnique({ where: { orderId: order.id } });
    assert.equal(savedBuyer.identityLastFour, '1234');
    assert.ok(!JSON.stringify(savedBuyer).includes(contact.identityNumber));
    await processQueuedTicketEmails(order.id);
    assert.equal(ticketEmails.length, 0, 'no email before payment');
    const completed = { event: 'payment_session.completed', data: { reference_id: order.orderNumber, payment_session_id: `ps-${order.id}`, payment_id: `py-${order.id}`, amount: 200000 } };
    await request('/payments/webhook', null, 'POST', completed);
    const tickets = await request('/issued-tickets/my', buyer);
    assert.equal(tickets.length, 2);
    await processQueuedTicketEmails(order.id);
    const deferred = await prisma.orderBuyerContact.findUnique({ where: { orderId: order.id } });
    assert.equal(deferred.emailSentAt, null);
    assert.equal(deferred.emailAttempts, 1);
    assert.ok(deferred.nextEmailAttempt > new Date());
    await prisma.orderBuyerContact.update({ where: { orderId: order.id }, data: { nextEmailAttempt: new Date() } });
    mailAvailable = true;
    await processQueuedTicketEmails(order.id);
    await request('/payments/webhook', null, 'POST', completed);
    await processQueuedTicketEmails(order.id);
    assert.equal(ticketEmails.length, 2, 'one failed send and one successful retry');
    assert.equal(ticketEmails[0].key, ticketEmails[1].key);
    const { message } = ticketEmails[1];
    assert.deepEqual(message.to, [contact.email]);
    assert.equal(message.attachments.length, tickets.length);
    for (const ticket of tickets) {
      const qr = message.attachments.find(image => image.filename === ticket.ticketCode + '.png');
      assert.ok(qr);
      assert.equal(Buffer.from(qr.content, 'base64').subarray(1, 4).toString(), 'PNG');
      assert.ok(message.html.includes('cid:' + qr.content_id));
    }
    assert.ok(!JSON.stringify(message).includes(contact.identityNumber));
    assert.ok((await prisma.orderBuyerContact.findUnique({ where: { orderId: order.id } })).emailSentAt);
    assert.equal(tickets[0].orderItem.ticketType.event.ticketBackgroundUrl, 'https://example.invalid/test.jpg');
    const published = await request(`/events/${eventId}`);
    assert.equal(published.venueLayout, 'ICE_BSD');
    assert.equal(published.ticketTypes[0].viewPosition, 'REAR');
    await request('/ticket-redemption/redeem', staff, 'POST', { ticketCode: tickets[0].ticketCode, eventId: randomUUID() }, 409);
    const requested = await request('/refunds', buyer, 'POST', { orderId: order.id, reason: 'Cannot attend' }, 201);
    const refundId = requested.refunds[0].id;
    assert.equal((await request(`/orders/${order.id}`, buyer)).refunds.length, 1);
    assert.equal((await request('/refunds/organizer', organizer)).data.length, 1);
    await request(`/refunds/admin/${refundId}/approve`, admin, 'PATCH');
    await RefundService.processQueuedRefunds((await prisma.refund.findMany({ where: { requestedById: buyer.id }, select: { id: true } })).map(row => row.id));
    assert.equal((await prisma.refund.findUnique({ where: { id: refundId } })).status, 'SUCCEEDED');
    assert.equal((await prisma.ticketType.findUnique({ where: { id: tiers[0].id } })).availableQuota, 10);
    await request('/refunds/webhook', null, 'POST', { event: 'refund.succeeded', data: { id: `rfd-${(await prisma.refund.findUnique({ where: { id: refundId } })).idempotencyKey}` } });
    assert.equal((await prisma.ticketType.findUnique({ where: { id: tiers[0].id } })).availableQuota, 10, 'duplicate callback must not restore stock twice');
    // Cancellation refunds only the unpaid balance after a successful customer refund.
    await request(`/events/admin/${eventId}/cancel`, admin, 'PATCH', { reason: 'Venue closed' });
    const cancellation = await prisma.refund.findFirst({ where: { orderId: order.id, type: 'EVENT_CANCELLATION' } });
    assert.equal(Number(cancellation.amount), 10000);
    await RefundService.processQueuedRefunds((await prisma.refund.findMany({ where: { requestedById: buyer.id }, select: { id: true } })).map(row => row.id));
    assert.equal((await prisma.ticketType.findUnique({ where: { id: tiers[0].id } })).availableQuota, 10);
    await request('/auth/forgot-password', null, 'POST', { email: buyer.email });
    assert.ok(otp);
    await request('/auth/verify-forgot-password', null, 'POST', { email: buyer.email, code: otp });
    await request('/auth/reset-password', null, 'POST', { email: buyer.email, code: '000000', password: 'NewPass123!' }, 401);
    await request('/auth/reset-password', null, 'POST', { email: buyer.email, code: otp, password: 'NewPass123!' });
    await request('/auth/login', null, 'POST', { email: buyer.email, password: 'NewPass123!' });
    const active = await prisma.event.create({ data: { organizerId: organizer.id, categoryId: category.id, title: "Active gate test", description: "Test", location: "Test", coverImageUrl: "https://example.invalid/test.jpg", coverImageId: "test", startDatetime: new Date(Date.now() - 3600000), endDatetime: new Date(Date.now() + 3600000), status: "PUBLISHED", ticketTypes: { create: { name: "GA", price: 100000, quota: 5, availableQuota: 5 } } }, include: { ticketTypes: true } });
    eventIds.push(active.id);
    await request(`/events/organizer/${active.id}/staff`, organizer, "POST", { userId: staff.id });
    const liveOrder = (await request("/orders", buyer, "POST", { items: [{ ticketTypeId: active.ticketTypes[0].id, quantity: 1 }], buyer: contact }, 201)).order;
    orderIds.push(liveOrder.id);
    await request("/payments/webhook", null, "POST", { event: "payment_session.completed", data: { reference_id: liveOrder.orderNumber, payment_id: `py-${liveOrder.id}`, amount: 100000 } });
    const liveTicket = (await request("/issued-tickets/my", buyer)).find(t => t.orderItem.order.id === liveOrder.id);
    await processQueuedTicketEmails(liveOrder.id);
    const emailedCode = ticketEmails.at(-1).message.attachments[0].filename.replace(/\.png$/, '');
    assert.equal(emailedCode, liveTicket.ticketCode);
    const redemption = await request("/ticket-redemption/redeem", staff, "POST", { ticketCode: emailedCode, eventId: active.id });
    assert.equal(redemption.ticket.ticketType.name, "GA");
    await request("/ticket-redemption/redeem", staff, "POST", { ticketCode: liveTicket.ticketCode, eventId: active.id }, 409);
    const expiredOrder = (await request("/orders", buyer, "POST", { items: [{ ticketTypeId: active.ticketTypes[0].id, quantity: 1 }], buyer: contact }, 201)).order;
    orderIds.push(expiredOrder.id);
    await prisma.order.update({ where: { id: expiredOrder.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request(`/orders/${expiredOrder.id}`, buyer)).paymentStatus, "EXPIRED");
    await request("/payments/webhook", null, "POST", { event: "payment_session.completed", data: { reference_id: expiredOrder.orderNumber, payment_id: `py-${expiredOrder.id}`, amount: 100000 } });
    assert.equal((await request(`/orders/${expiredOrder.id}`, buyer)).paymentStatus, "PAID");
    assert.equal((await prisma.issuedTicket.count({ where: { orderItem: { orderId: expiredOrder.id } } })), 1);
    assert.equal((await prisma.ticketType.findUnique({ where: { id: active.ticketTypes[0].id } })).availableQuota, 3);
    // A payment arriving after cancellation must be recorded and queued for full refund.
    const late = await prisma.order.create({ data: { userId: buyer.id, orderNumber: `LATE-${suffix}`, totalAmount: 100000, paymentStatus: 'EXPIRED', expiresAt: new Date(), orderItems: { create: { ticketTypeId: tiers[0].id, quantity: 1, price: 100000 } } } });
    orderIds.push(late.id);
    await request('/payments/webhook', null, 'POST', { event: 'payment_session.completed', data: { reference_id: late.orderNumber, payment_id: `py-${late.id}`, amount: 100000 } });
    assert.equal((await prisma.order.findUnique({ where: { id: late.id } })).paymentStatus, 'PAID');
    assert.equal((await prisma.refund.findFirst({ where: { orderId: late.id } })).status, 'APPROVED');
    await RefundService.processQueuedRefunds((await prisma.refund.findMany({ where: { requestedById: buyer.id }, select: { id: true } })).map(row => row.id));
    assert.equal((await prisma.refund.findFirst({ where: { orderId: late.id } })).status, 'SUCCEEDED');
    assert.equal((await prisma.ticketType.findUnique({ where: { id: tiers[0].id } })).availableQuota, 10);
  } finally {
    PaymentService.createPaymentSession = previousPayment;
    CloudinaryService.uploadImage = previousCloud;
    RefundService.createXenditRefund = previousRefund;
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries({ XENDIT_WEBHOOK_TOKEN: previousToken, RESEND_API_KEY: previousResend, RESEND_FROM_EMAIL: previousSender })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise(resolve => server.close(resolve));
    const fixtureRefunds = await prisma.refund.findMany({ where: { requestedById: { in: ids } }, select: { id: true } });
    await prisma.issuedTicket.deleteMany({ where: { orderItem: { order: { userId: { in: ids } } } } });
    await prisma.refund.deleteMany({ where: { requestedById: { in: ids } } });
    await prisma.order.deleteMany({ where: { userId: { in: ids } } });
    await prisma.event.deleteMany({ where: { organizerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (category) await prisma.category.delete({ where: { id: category.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...eventIds, ...orderIds, ...fixtureRefunds.map(row => row.id)] } }] } });
    await prisma.$disconnect();
  }
});
