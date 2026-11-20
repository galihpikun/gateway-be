import prisma, { Prisma } from "../service/prisma.js";

export async function lockEvent(tx, eventId) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
}

export function withEventLock(eventId, work) {
  return prisma.$transaction(async tx => {
    await lockEvent(tx, eventId);
    return work(tx);
  });
}
