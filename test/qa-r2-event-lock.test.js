import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import app from '../index.js';
import prisma, { Prisma } from '../src/service/prisma.js';
import { generateToken } from '../src/utils/generateToken.js';

test('QA-011 tier edit and review share the PostgreSQL event lock', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const prefix = 'qa_r2_venue_lock';
  const users = [];
  let category, event, release, held;
  try {
    for (const role of ['ADMIN', 'USER']) {
      users.push(await prisma.user.create({ data: {
        email: prefix + '_' + role.toLowerCase() + '@example.invalid', fullName: prefix, password: 'unusable-test-account',
        role, emailVerified: true,
      } }));
    }
    const [admin, organizer] = users;
    await prisma.organizerProfile.create({ data: {
      userId: organizer.id, organizationName: prefix, phoneNumber: '000', address: prefix, bankName: prefix,
      bankAccountNumber: '000', bankAccountName: prefix, status: 'APPROVED',
    } });
    category = await prisma.category.create({ data: { name: prefix, slug: prefix } });
    event = await prisma.event.create({ data: {
      title: prefix, description: 'Test event', location: 'Test venue', organizerId: organizer.id, categoryId: category.id,
      coverImageUrl: 'https://example.invalid/cover.png', coverImageId: prefix + '_cover',
      previewVideoUrl: 'https://example.invalid/preview.mp4', previewVideoId: prefix + '_preview',
      ticketBackgroundUrl: 'https://example.invalid/ticket.png', ticketBackgroundId: prefix + '_ticket',
      venueLayout: 'ARENA', startDatetime: new Date(Date.now() + 86400000), endDatetime: new Date(Date.now() + 90000000),
      ticketTypes: { create: { name: prefix, price: 100, quota: 2, availableQuota: 2, viewPosition: 'FRONT' } },
    }, include: { ticketTypes: true } });
    const route = async (actor, path, method, data) => {
      const reply = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
        method, headers: { Authorization: 'Bearer ' + generateToken(actor), 'Content-Type': 'application/json' },
        ...(data && { body: JSON.stringify(data) }),
      });
      await reply.json();
      return reply.status;
    };

    const unlocked = new Promise(resolve => { release = resolve; });
    let lockAcquired;
    const acquired = new Promise(resolve => { lockAcquired = resolve; });
    held = prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`);
      lockAcquired();
      await unlocked;
    });
    await Promise.race([acquired, held]);
    const edit = route(organizer, '/ticket-types/' + event.ticketTypes[0].id, 'PUT', { viewPosition: 'MIDDLE' });
    const submit = route(organizer, '/events/' + event.id + '/submit', 'PATCH');
    const waited = await Promise.race([edit.then(() => false), delay(350, true)]);
    release();
    const [editStatus, submitStatus] = await Promise.all([edit, submit]);
    await held;
    assert.equal(waited, true, 'tier write cannot commit while another transaction holds the event lock');
    assert.ok([200, 409].includes(editStatus));
    assert.equal(submitStatus, 200);
    assert.equal(await route(admin, '/events/admin/' + event.id + '/approve', 'PATCH'), 200);
    const persisted = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { ticketTypes: true } });
    assert.equal(persisted.status, 'PUBLISHED');
    assert.equal(persisted.ticketTypes[0].viewPosition, editStatus === 200 ? 'MIDDLE' : 'FRONT');
  } finally {
    release?.();
    await held?.catch(() => {});
    if (event) {
      await prisma.auditLog.deleteMany({ where: { entityId: event.id } });
      await prisma.event.delete({ where: { id: event.id } });
    }
    if (category) await prisma.category.delete({ where: { id: category.id } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await new Promise(resolve => server.close(resolve));
  }
});
