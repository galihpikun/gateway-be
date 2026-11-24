import { v2 as cloudinary } from "cloudinary";
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

test('HTTP workflow: organizer review, atomic event, staff, payment, refund, recovery and late payment', async (t) => {
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
    const deliveryTypes = [];
    const signer = t.mock.method(cloudinary.utils, 'private_download_url', (id, format, options) => {
      assert.equal(options.type, 'authenticated');
      assert.equal(format, 'png');
      assert.ok(options.expires_at > Math.floor(Date.now() / 1000));
      assert.ok(options.expires_at <= Math.floor(Date.now() / 1000) + 600);
      return 'https://example.invalid/signed/' + id;
    });
    let raceEventId, failingDeleteId;
    const destroyed = [];
    const destroy = t.mock.method(cloudinary.uploader, 'destroy', async (id, options) => {
      const references = await prisma.event.count({ where: { OR: [{ coverImageId: id }, { venueImageId: id }, { previewVideoId: id }, { ticketBackgroundId: id }] } });
      destroyed.push({ id, options, references });
      if (id === failingDeleteId) throw new Error('Stubbed provider failure');
      return { result: 'ok' };
    });
    CloudinaryService.uploadImage = async (file, folder, resourceType, deliveryType) => {
      deliveryTypes.push(deliveryType);
      if (deliveryType === 'authenticated') return { public_id: 'qa_r2_document', secure_url: 'https://example.invalid/demo/image/authenticated/qa_r2_document.png' };
      if (file.originalname === 'qa_r2_conflict.mp4') {
        await prisma.event.update({ where: { id: raceEventId }, data: { status: 'PENDING_REVIEW' } });
        return { public_id: 'qa_r2_conflict_' + suffix, secure_url: 'https://example.invalid/test.mp4' };
      }
      if (resourceType === 'video') return { public_id: 'qa_r2_preview_' + file.originalname + suffix, secure_url: 'https://example.invalid/test.mp4' };
      return { public_id: 'test-only-image', secure_url: resourceType === 'video' ? 'https://example.invalid/test.mp4' : 'https://example.invalid/test.jpg' };
    };
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
    assert.deepEqual(deliveryTypes, Array(4).fill('authenticated'));
    const profile = await request('/organizer/me', organizer);
    assert.ok(profile.documents.every(doc => doc.fileUrl === 'https://example.invalid/signed/qa_r2_document'));
    assert.equal(signer.mock.callCount(), 4);
    const administrativeProfile = await request('/organizer/admin/' + profile.id, admin);
    assert.ok(administrativeProfile.documents.every(doc => doc.fileUrl === 'https://example.invalid/signed/qa_r2_document'));
    const legacy = profile.documents[0];
    await prisma.organizerDocument.update({ where: { id: legacy.id }, data: { fileUrl: 'https://example.invalid/legacy.png' } });
    assert.equal((await request('/organizer/me', organizer)).documents.find(doc => doc.id === legacy.id).fileUrl, 'https://example.invalid/legacy.png');

    for (const doc of profile.documents) await request(`/organizer/admin/documents/${doc.id}/approve`, admin, 'PATCH');
    await request(`/organizer/admin/${profile.id}/approve`, admin, 'PATCH');
    assert.equal((await request('/auth/me', organizer)).data.organizerProfile.status, 'APPROVED');
    const publicLists = [['/events', null], ['/orders', buyer], ['/issued-tickets/my', buyer]];
    for (const [path, actor] of publicLists) {
      assert.ok(Array.isArray(await request(path, actor)));
      assert.equal((await request(path + '?limit=2', actor)).meta.limit, 2);
    }
    const paginatedLists = [
      ...publicLists,
      ...['orders', 'issued-tickets', 'events', 'organizer', 'users', 'staff', 'audit-logs', 'refunds'].map(route => ['/' + route + '/admin', admin]),
      ['/events/organizer/my-events', organizer], ['/events/search-invitable-users', organizer],
      ['/refunds/organizer', organizer], ['/refunds/my', buyer],
    ];
    for (const [path, actor] of paginatedLists) {
      const invalid = await request(path + '?page=0', actor, 'GET', undefined, 400);
      assert.deepEqual(invalid, { statusCode: 400, message: 'Invalid pagination: page must be a positive integer and limit must be between 1 and 100.' });
      const valid = await request(path + '?page=1', actor);
      assert.equal(valid.meta.page, 1);
      assert.equal(valid.meta.limit, 20);
    }
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
    const tiers = await request(`/ticket-types/event/${eventId}`, organizer);
    assert.equal(created.event.previewVideoUrl, 'https://example.invalid/test.mp4');
    assert.equal(tiers[0].viewPosition, 'FRONT');
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', {viewPosition:'seat-42'},400);
    await request(`/ticket-types/${tiers[0].id}`, buyer, 'PUT', {viewPosition:'REAR'},403);
    assert.equal((await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', {viewPosition:'BALCONY'})).viewPosition,'BALCONY');
    raceEventId = eventId;
    const conflict = new FormData();
    conflict.set('previewVideo', new Blob(['0000ftyp'], { type: 'video/mp4' }), 'qa_r2_conflict.mp4');
    await request(`/events/${eventId}`, organizer, 'PATCH', conflict, 409);
    assert.deepEqual(destroyed, [{ id: 'qa_r2_conflict_' + suffix, options: { resource_type: 'video', invalidate: true }, references: 0 }]);
    await prisma.event.update({ where: { id: eventId }, data: { status: 'DRAFT' } });
    assert.equal((await request(`/events/organizer/${eventId}`, organizer)).previewVideoId, created.event.previewVideoId);
    const shared = await prisma.event.create({ data: {
      organizerId: organizer.id, categoryId: category.id, title: 'qa_r2_shared_' + suffix, description: 'Media fixture', location: 'Test',
      coverImageUrl: 'https://example.invalid/shared.jpg', coverImageId: 'qa_r2_shared_cover_' + suffix,
      previewVideoId: created.event.previewVideoId, startDatetime: new Date(created.event.startDatetime), endDatetime: new Date(created.event.endDatetime),
    } });
    const removePreview = new FormData();removePreview.set('removePreviewVideo','true');
    await request(`/events/${eventId}`,organizer,'PATCH',removePreview);
    assert.equal((await request(`/events/organizer/${eventId}`,organizer)).previewVideoUrl,null);
    assert.equal(destroy.mock.callCount(), 1, 'a shared asset is retained');
    await request(`/events/${shared.id}`, organizer, 'PATCH', removePreview);
    assert.deepEqual(destroyed.at(-1), { id: created.event.previewVideoId, options: { resource_type: 'video', invalidate: true }, references: 0 });
    assert.equal(destroy.mock.callCount(), 2, 'old asset is deleted only after the final DB reference is gone');
    assert.equal(tiers.length, 1, 'event and tiers must be created atomically');
    await request(`/events/${eventId}/submit`, organizer, 'PATCH', undefined, 409);
    const outdoor = new FormData();
    outdoor.set('venueLayout', 'ICE_BSD');
    outdoor.set('previewVideo', new Blob(['0000ftyp'], { type: 'video/mp4' }), 'preview.mp4');
    const firstOutdoor = await request(`/events/${eventId}`, organizer, 'PATCH', outdoor);
    failingDeleteId = firstOutdoor.event.previewVideoId;
    outdoor.set('previewVideo', new Blob(['0000ftyp'], { type: 'video/mp4' }), 'qa_r2_replacement.mp4');
    const replacement = await request(`/events/${eventId}`, organizer, 'PATCH', outdoor);
    assert.notEqual(replacement.event.previewVideoId, failingDeleteId);
    assert.deepEqual(destroyed.at(-1), { id: failingDeleteId, options: { resource_type: 'video', invalidate: true }, references: 0 });
    await request(`/events/${eventId}/submit`, organizer, 'PATCH', undefined, 409);
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', { viewPosition: 'BALCONY' }, 400);
    await request(`/ticket-types/${tiers[0].id}`, organizer, 'PUT', { viewPosition: 'REAR' });
    const past = { startDatetime: new Date(Date.now() - 7200000), endDatetime: new Date(Date.now() - 3600000) };
    await prisma.event.update({ where: { id: eventId }, data: past });
    const ended = await request(`/events/${eventId}/submit`, organizer, 'PATCH', undefined, 409);
    assert.match(ended.message, /already ended/);
    await prisma.event.update({ where: { id: eventId }, data: {
      startDatetime: new Date(created.event.startDatetime), endDatetime: new Date(created.event.endDatetime),
    } });

    const search = await request('/events/search-invitable-users?search=' + encodeURIComponent(staff.email), organizer);
    assert.equal(search.data[0].id, staff.id);
    await request(`/events/organizer/${eventId}/staff`, organizer, 'POST', { userId: staff.id });
    const roster = await request('/organizer/staff?eventId=' + eventId, organizer);
    assert.deepEqual(roster.pending.map(entry => entry.userId), [staff.id]);
    assert.deepEqual(roster.active, []);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).role, 'USER');

    await request(`/events/${eventId}/submit`, organizer, 'PATCH');
    await request(`/events/${eventId}`, null, 'GET', undefined, 404);
    const preview = await request(`/events/admin/${eventId}`, admin);
    assert.equal(preview.title, created.event.title);
    assert.equal(preview.status, 'PENDING_REVIEW');
    assert.equal(preview.ticketTypes[0].viewPosition, 'REAR');

    const approved = await request(`/events/admin/${eventId}/approve`, admin, 'PATCH');
    assert.equal(approved.event.status, 'PUBLISHED');
    const activeRoster = await request('/organizer/staff?eventId=' + eventId, organizer);
    assert.deepEqual(activeRoster.pending, []);
    assert.deepEqual(activeRoster.active.map(entry => entry.userId), [staff.id]);
    assert.equal((await request(`/ticket-types/event/${eventId}`))[0].id, tiers[0].id);
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
    assert.equal((await request('/orders/' + order.id, buyer)).canRequestRefund, true);
    const requested = await request('/refunds', buyer, 'POST', { orderId: order.id, reason: 'Cannot attend' }, 201);
    const refundId = requested.refunds[0].id;
    const lockedTickets = await request('/issued-tickets/my', buyer);
    assert.ok(lockedTickets.length > 0 && lockedTickets.every(ticket => ticket.refundLocked === true));
    assert.equal((await request('/orders/' + order.id, buyer)).canRequestRefund, false);
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
    await request('/auth/reset-password', null, 'POST', { email: buyer.email, code: '000000', password: 'NewPass123!' }, 400);
    await request('/auth/reset-password', null, 'POST', { email: buyer.email, code: otp, password: 'NewPass123!' });
    await request('/auth/login', null, 'POST', { email: buyer.email, password: 'NewPass123!' });
    const active = await prisma.event.create({ data: { organizerId: organizer.id, categoryId: category.id, title: "Active gate test", description: "Test", location: "Test", coverImageUrl: "https://example.invalid/test.jpg", coverImageId: "test", startDatetime: new Date(Date.now() - 3600000), endDatetime: new Date(Date.now() + 3600000), status: "PUBLISHED", ticketTypes: { create: { name: "GA", price: 100000, quota: 5, availableQuota: 5 } } }, include: { ticketTypes: true } });
    eventIds.push(active.id);
    await request(`/events/organizer/${active.id}/staff`, organizer, "POST", { userId: staff.id });
    const liveOrder = (await request("/orders", buyer, "POST", { items: [{ ticketTypeId: active.ticketTypes[0].id, quantity: 1 }], buyer: contact }, 201)).order;
    orderIds.push(liveOrder.id);
    await request("/payments/webhook", null, "POST", { event: "payment_session.completed", data: { reference_id: liveOrder.orderNumber, payment_id: `py-${liveOrder.id}`, amount: 100000 } });
    assert.equal((await request('/orders/' + liveOrder.id, buyer)).canRequestRefund, false);
    const liveTicket = (await request("/issued-tickets/my", buyer)).find(t => t.orderItem.order.id === liveOrder.id);
    await processQueuedTicketEmails(liveOrder.id);
    const emailedCode = ticketEmails.at(-1).message.attachments[0].filename.replace(/\.png$/, '');
    assert.equal(emailedCode, liveTicket.ticketCode);
    const stale = await prisma.refund.create({ data: {
      orderId: liveOrder.id, eventId: active.id, requestedById: buyer.id, originalAmount: 100000, amount: 95000,
      status: "PENDING_APPROVAL", reason: "qa_r2_gate_request",
    } });
    const redemption = await request("/ticket-redemption/redeem", staff, "POST", { ticketCode: emailedCode, eventId: active.id });
    assert.equal(redemption.ticket.ticketType.name, "GA");
    const rejected = await prisma.refund.findUniqueOrThrow({ where: { id: stale.id } });
    assert.equal(rejected.status, "REJECTED");
    assert.match(rejected.adminReason, /event already started/i);
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
    const freeEvent = await prisma.event.create({ data: {
      organizerId: organizer.id, categoryId: category.id, title: "qa_r2_free", description: "Free fixture", location: "Test",
      coverImageUrl: "https://example.invalid/qa_r2_free.jpg", coverImageId: "qa_r2_free",
      startDatetime: new Date(Date.now() + 86400000), endDatetime: new Date(Date.now() + 90000000), status: "PUBLISHED",
      ticketTypes: { create: { name: "qa_r2_free_tier", price: 0, quota: 1, availableQuota: 1 } },
    }, include: { ticketTypes: true } });
    eventIds.push(freeEvent.id);
    let freeProviderCalls = 0;
    PaymentService.createPaymentSession = async () => { freeProviderCalls++; throw new Error("Free orders must bypass provider"); };
    const free = await request("/orders", buyer, "POST", { items: [{ ticketTypeId: freeEvent.ticketTypes[0].id, quantity: 1 }], buyer: contact, idempotencyKey: "qa_r2_free_order" }, 201);
    orderIds.push(free.order.id);
    assert.equal(free.order.paymentStatus, "PAID");
    assert.equal(free.order.paymentMethod, "FREE");
    assert.equal(free.paymentUrl, null);
    assert.equal(freeProviderCalls, 0);
    assert.equal(await prisma.issuedTicket.count({ where: { orderItem: { orderId: free.order.id } } }), 1);
    assert.ok((await prisma.orderBuyerContact.findUniqueOrThrow({ where: { orderId: free.order.id } })).nextEmailAttempt);
    await request("/refunds", buyer, "POST", { orderId: free.order.id, reason: "qa_r2_free_refund" }, 400);
    await request("/events/admin/" + freeEvent.id + "/cancel", admin, "PATCH", { reason: "qa_r2_free_cancel" });
    assert.equal(await prisma.refund.count({ where: { orderId: free.order.id } }), 0);
    assert.equal(await prisma.issuedTicket.count({ where: { orderItem: { orderId: free.order.id }, isCancelled: true } }), 1);
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
