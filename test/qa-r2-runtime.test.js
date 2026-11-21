import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { v2 as cloudinary } from 'cloudinary';
import app from '../index.js';
import prisma from '../src/service/prisma.js';
import PaymentService from '../src/service/paymentService.js';
import RefundService from '../src/service/refundService.js';

test('QA-R2 PostgreSQL role boundaries, check-in, inventory and audit trail', async t => {
  const prefix = 'qa_r2_' + randomUUID();
  const password = 'FixturePassword123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const adminReason = 'QA review reason';
  const ids = [];
  let category;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const denyExternal = () => { throw new Error('External provider disabled in this test'); };
  t.mock.method(PaymentService, 'createPaymentSession', denyExternal);
  t.mock.method(RefundService, 'createXenditRefund', denyExternal);
  t.mock.method(cloudinary.uploader, 'upload_stream', denyExternal);
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (!String(url).startsWith(base + '/')) denyExternal();
    return originalFetch(url, options);
  });

  async function request(method, path, actor, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (actor?.token) headers.Authorization = 'Bearer ' + actor.token;
    const response = await fetch(base + path, {
      method, headers, ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data };
  }

  async function expect(status, method, path, actor, body) {
    const result = await request(method, path, actor, body);
    assert.equal(result.status, status, method + ' ' + path + ': ' + JSON.stringify(result.data));
    return result.data;
  }

  async function createUser(name, role = 'USER') {
    const user = await prisma.user.create({ data: {
      email: prefix + '_' + name + '@example.invalid', fullName: prefix + '_' + name,
      role, password: passwordHash, emailVerified: true,
    } });
    ids.push(user.id);
    const { token } = await expect(200, 'POST', '/auth/login', null, { email: user.email, password });
    assert.ok(token);
    return { ...user, token };
  }

  async function createProfile(user, status, documents = []) {
    return prisma.organizerProfile.create({
      data: {
        userId: user.id, organizationName: user.fullName, phoneNumber: '000',
        address: prefix, bankName: prefix, bankAccountNumber: '000', bankAccountName: prefix,
        status, documents: { create: documents.map(type => ({
          type, fileUrl: 'https://example.invalid/qa-document.png', publicId: prefix + '_' + type,
        })) },
      },
      include: { documents: true },
    });
  }

  async function createEvent(owner, name, status, { live = false, quota = 2, price = 0 } = {}) {
    const stamp = Date.now();
    return prisma.event.create({
      data: {
        organizerId: owner.id, categoryId: category.id, title: prefix + '_' + name,
        description: prefix, location: prefix, status, venueLayout: 'ARENA', isRefundable: true,
        coverImageUrl: 'https://example.invalid/cover.png', coverImageId: prefix + '_' + name + '_cover',
        previewVideoUrl: 'https://example.invalid/preview.mp4', previewVideoId: prefix + '_' + name + '_preview',
        ticketBackgroundUrl: 'https://example.invalid/ticket.png', ticketBackgroundId: prefix + '_' + name + '_ticket',
        startDatetime: new Date(stamp + (live ? -3600000 : 86400000)), endDatetime: new Date(stamp + 172800000),
        ticketTypes: { create: { name: prefix + '_tier', price, quota, availableQuota: quota, viewPosition: 'FRONT' } },
      },
      include: { ticketTypes: true },
    });
  }

  async function queueRefund(buyer, event, name) {
    const order = await prisma.order.create({ data: {
      userId: buyer.id, orderNumber: prefix + '_' + name, totalAmount: 100000,
      paymentStatus: 'PAID', paymentMethod: 'XENDIT', expiresAt: new Date(Date.now() + 3600000),
      orderItems: { create: { ticketTypeId: event.ticketTypes[0].id, price: 100000 } },
    } });
    return prisma.refund.create({ data: {
      orderId: order.id, eventId: event.id, requestedById: buyer.id, reason: prefix,
      originalAmount: 100000, amount: 90000,
    } });
  }

  function checkout(event, buyer, suffix) {
    return request('POST', '/orders', buyer, {
      items: [{ ticketTypeId: event.ticketTypes[0].id, quantity: 1 }],
      buyer: { fullName: buyer.fullName, email: buyer.email, phone: '+6281212345678',
        identityType: 'KTP', identityNumber: '3201010101011234', language: 'id' },
      idempotencyKey: prefix + '_' + suffix,
    });
  }

  const auditChecks = [];
  async function recordAdminMutation(admin, path, body, action, entityType, entityId, metadata) {
    const data = await expect(200, 'PATCH', path, admin, body);
    auditChecks.push({ action, entityType, entityId, metadata });
    return data;
  }

  try {
    category = await prisma.category.create({ data: { name: prefix, slug: prefix } });
    const admin = await createUser('admin', 'ADMIN');
    const owner = await createUser('organizer_one');
    const other = await createUser('organizer_two');
    const staff = await createUser('staff', 'STAFF');
    const pendingStaff = await createUser('invited_staff', 'STAFF');
    const buyer = await createUser('buyer');
    await createProfile(owner, 'APPROVED');
    await createProfile(other, 'APPROVED');
    const draft = await createEvent(owner, 'draft', 'DRAFT');
    const futureEvent = await createEvent(owner, 'refund_event', 'PUBLISHED', { price: 100000 });
    const approvedRefund = await queueRefund(buyer, futureEvent, 'refund_approved');
    const rejectedRefund = await queueRefund(buyer, futureEvent, 'refund_rejected');
    const liveEvent = await createEvent(owner, 'live', 'PUBLISHED', { live: true });
    const otherEvent = await createEvent(other, 'other', 'PUBLISHED', { live: true });
    const assignment = await prisma.eventStaff.create({ data: { eventId: liveEvent.id, userId: staff.id } });
    await prisma.staffInvitation.create({ data: { eventId: liveEvent.id, userId: pendingStaff.id, activated: false } });

    await t.test('suspension blocks fresh login and previously issued sessions for three roles', async () => {
      for (const [actor, route] of [[buyer, '/orders'], [owner, '/events/organizer/my-events'], [staff, '/staff/events']]) {
        await expect(200, 'GET', route, actor);
        await recordAdminMutation(admin, '/users/admin/' + actor.id + '/suspend', { reason: adminReason }, 'SUSPEND', 'User', actor.id, { reason: adminReason });
        await expect(403, 'POST', '/auth/login', null, { email: actor.email, password });
        await expect(403, 'GET', '/auth/me', actor);
        await expect(403, 'GET', route, actor);
        await recordAdminMutation(admin, '/users/admin/' + actor.id + '/unsuspend', undefined, 'UNSUSPEND', 'User', actor.id);
        await expect(200, 'GET', route, actor);
        const newSession = await expect(200, 'POST', '/auth/login', null, { email: actor.email, password });
        assert.ok(newSession.token);
      }
    });

    await t.test('organizer resources observe ownership and published tier visibility', async () => {
      const eventPath = '/events/' + draft.id;
      const organizerPath = '/events/organizer/' + draft.id;
      const tierList = '/ticket-types/event/' + draft.id;
      const tierPath = '/ticket-types/' + draft.ticketTypes[0].id;
      const staffPath = '/events/organizer/' + liveEvent.id + '/staff';

      await expect(200, 'GET', organizerPath, owner);
      await expect(403, 'GET', organizerPath, other);
      await expect(403, 'PATCH', eventPath, other, { title: prefix + '_edit' });
      await expect(403, 'PATCH', eventPath + '/submit', other);
      await expect(403, 'PATCH', '/events/admin/' + liveEvent.id + '/cancel', other, { reason: adminReason });
      await expect(404, 'DELETE', eventPath, other);

      await expect(200, 'GET', tierList, owner);
      await expect(200, 'GET', tierPath, owner);
      await expect(404, 'GET', tierList, other);
      await expect(404, 'GET', tierPath, other);
      await expect(404, 'GET', tierList);
      await expect(403, 'POST', tierList, other, { name: prefix + '_extra', price: 0, quota: 1 });
      await expect(403, 'PUT', tierPath, other, { price: 5000 });
      await expect(403, 'DELETE', tierPath, other);
      await expect(200, 'GET', '/ticket-types/event/' + liveEvent.id);

      await expect(403, 'POST', staffPath, other, { userId: pendingStaff.id });
      await expect(403, 'DELETE', staffPath + '/' + assignment.id, other);
      const ownerRefunds = await expect(200, 'GET', '/refunds/organizer', owner);
      assert.ok(ownerRefunds.data.some(row => row.id === approvedRefund.id));
      const otherRefunds = await expect(200, 'GET', '/refunds/organizer', other);
      assert.deepEqual(otherRefunds.data, []);
      await expect(404, 'GET', '/refunds/' + approvedRefund.id, other);
      await expect(403, 'PATCH', '/refunds/admin/' + approvedRefund.id + '/approve', other);
      await expect(403, 'PATCH', '/refunds/admin/' + rejectedRefund.id + '/reject', other, { reason: adminReason });
    });

    await t.test('five concurrent checkouts cannot sell more than the PostgreSQL quota', async () => {
      const buyers = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser('checkout_' + i)));
      const results = await Promise.all(buyers.map((customer, i) => checkout(liveEvent, customer, 'checkout_' + i)));
      assert.deepEqual(results.map(result => result.status).sort(), [201, 201, 409, 409, 409]);
      const tier = await prisma.ticketType.findUniqueOrThrow({ where: { id: liveEvent.ticketTypes[0].id } });
      const sold = await prisma.orderItem.aggregate({ where: {
        ticketTypeId: tier.id, order: { paymentStatus: 'PAID' },
      }, _sum: { quantity: true } });
      assert.equal(sold._sum.quantity, tier.quota);
      assert.equal(tier.availableQuota, 0);
    });

    await t.test('only assigned staff can check in, and a ticket can be redeemed once', async () => {
      const ticket = await prisma.issuedTicket.findFirstOrThrow({ where: { orderItem: { ticketType: { eventId: liveEvent.id } } } });
      const valid = { ticketCode: ticket.ticketCode, eventId: liveEvent.id };
      for (const account of [admin, owner, buyer]) {
        await expect(403, 'POST', '/ticket-redemption/lookup', account, valid);
        await expect(403, 'POST', '/ticket-redemption/redeem', account, valid);
      }
      const unused = await prisma.issuedTicket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(unused.isRedeemed, false);
      const pendingTicket = await expect(403, 'POST', '/ticket-redemption/lookup', pendingStaff, valid);
      assert.equal(pendingTicket.message, 'You are not assigned to this event');
      await expect(403, 'POST', '/ticket-redemption/redeem', pendingStaff, valid);
      const otherOrder = await checkout(otherEvent, buyer, 'other_event');
      assert.equal(otherOrder.status, 201);
      const otherTicket = await prisma.issuedTicket.findFirstOrThrow({ where: { orderItem: { orderId: otherOrder.data.order.id } } });
      const differentEvent = { ticketCode: otherTicket.ticketCode, eventId: otherEvent.id };
      await expect(403, 'POST', '/ticket-redemption/lookup', staff, differentEvent);
      await expect(403, 'POST', '/ticket-redemption/redeem', staff, differentEvent);
      await expect(200, 'POST', '/ticket-redemption/lookup', staff, valid);

      const responses = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/ticket-redemption/redeem', staff, valid)));
      assert.deepEqual(responses.map(result => result.status).sort(), [200, 409, 409, 409, 409]);
      const saved = await prisma.issuedTicket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(saved.isRedeemed, true);
      assert.ok(saved.redeemedAt);
    });

    await t.test('granular admin review and critical mutations persist audit rows', async () => {
      const applicant = await createUser('applicant');
      const rejected = await createUser('rejected_applicant');
      const docTypes = ['BUSINESS_LICENSE', 'GUARANTEE_LETTER', 'ORGANIZATION_REGISTRATION', 'IDENTITY_CARD'];
      const application = await createProfile(applicant, 'PENDING', docTypes);
      const rejectedApplication = await createProfile(rejected, 'PENDING');
      const [document] = application.documents;
      const docPath = '/organizer/admin/documents/' + document.id;
      const profilePath = '/organizer/admin/' + application.id;
      await expect(403, 'PATCH', docPath + '/approve', buyer);
      await expect(409, 'PATCH', profilePath + '/approve', admin);
      await recordAdminMutation(admin, docPath + '/reject', { rejectionReason: adminReason }, 'REJECT_DOCUMENT', 'OrganizerDocument', document.id, { reason: adminReason });
      const rejectedDoc = await prisma.organizerDocument.findUniqueOrThrow({ where: { id: document.id } });
      assert.equal(rejectedDoc.status, 'REJECTED');
      assert.equal(rejectedDoc.rejectionReason, adminReason);
      for (const doc of application.documents) {
        await recordAdminMutation(admin, '/organizer/admin/documents/' + doc.id + '/approve', undefined, 'APPROVE_DOCUMENT', 'OrganizerDocument', doc.id);
      }
      const approvedDoc = await prisma.organizerDocument.findUniqueOrThrow({ where: { id: document.id } });
      assert.equal(approvedDoc.status, 'APPROVED');
      assert.equal(approvedDoc.rejectionReason, null);
      await recordAdminMutation(admin, profilePath + '/approve', undefined, 'APPROVE', 'OrganizerProfile', application.id);
      await recordAdminMutation(admin, '/organizer/admin/' + rejectedApplication.id + '/reject', { reason: adminReason }, 'REJECT', 'OrganizerProfile', rejectedApplication.id);

      await expect(200, 'PATCH', '/events/' + draft.id + '/submit', owner);
      const eventPath = '/events/admin/' + draft.id;
      await recordAdminMutation(admin, eventPath + '/reject', { reason: adminReason }, 'REJECT', 'Event', draft.id, { reason: adminReason });
      await expect(200, 'PATCH', '/events/' + draft.id + '/submit', owner);
      await recordAdminMutation(admin, eventPath + '/approve', undefined, 'APPROVE', 'Event', draft.id);
      await recordAdminMutation(admin, eventPath + '/cancel', { reason: adminReason }, 'CANCEL', 'Event', draft.id);
      await recordAdminMutation(admin, '/refunds/admin/' + approvedRefund.id + '/approve', undefined, 'APPROVE_REFUND', 'Refund', approvedRefund.id);
      await recordAdminMutation(admin, '/refunds/admin/' + rejectedRefund.id + '/reject', { reason: adminReason }, 'REJECT_REFUND', 'Refund', rejectedRefund.id, { adminReason });

      const audit = await prisma.auditLog.findMany({ where: { actorId: admin.id } });
      for (const { action, entityType, entityId, metadata } of auditChecks) {
        const entries = audit.filter(row => row.action === action && row.entityType === entityType && row.entityId === entityId);
        assert.equal(entries.length, 1, action + ' ' + entityType + ' should produce one audit row');
        for (const [key, value] of Object.entries(metadata ?? {})) assert.equal(entries[0].metadata[key], value);
      }
      assert.equal(audit.length, auditChecks.length);
    });
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    const userId = { in: ids };
    await prisma.issuedTicket.deleteMany({ where: { orderItem: { order: { userId } } } });
    await prisma.refund.deleteMany({ where: { requestedById: userId } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.event.deleteMany({ where: { organizerId: userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    if (category) await prisma.category.delete({ where: { id: category.id } });
    await prisma.$disconnect();
  }
});
