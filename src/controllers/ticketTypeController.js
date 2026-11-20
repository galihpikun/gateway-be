import { withEventLock } from "../utils/eventLock.js";
import { validViewPosition } from "../utils/previewValidation.js";
import prisma from "../service/prisma.js";
import { isLayoutZone } from "../utils/venueLayout.js";

export const getTicketTypes = async (req, res) => {
  const { eventId } = req.params;

  try {
    const ticketTypes = await prisma.ticketType.findMany({
      where: { eventId },
    });

    return res.status(200).json(ticketTypes);
  } catch (error) {
    console.error("Get ticket types error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getTicketTypeDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id },
    });

    if (!ticketType) {
      return res.status(404).json({ statusCode: 404, message: "Ticket Type with this id does not exists" });
    }

    return res.status(200).json(ticketType);
  } catch (error) {
    console.error("Get ticket type detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

function requireEditableEvent(event, userId, role) {
  if (!event) throw { statusCode: 404, message: "Event not found" };
  if (event.organizerId !== userId && role !== "ADMIN") {
    throw { statusCode: 403, message: "You are not the organizer of this event" };
  }
  if (!["DRAFT", "REJECTED"].includes(event.status)) {
    throw { statusCode: 409, message: "Ticket tiers may only change on draft or rejected events" };
  }
}

function requireValidTierFields({ name, price, quota, viewPosition }) {
  if (!validViewPosition(viewPosition)) throw { statusCode: 400, message: "Invalid viewing zone" };
  if ((price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) ||
      (quota !== undefined && (!Number.isSafeInteger(Number(quota)) || Number(quota) < 1)) ||
      (name !== undefined && (typeof name !== "string" || !name.trim()))) {
    throw { statusCode: 400, message: "Name, non-negative price and positive integer quota are required" };
  }
}

function requireValidZone(event, viewPosition) {
  if (viewPosition !== undefined && event.venueLayout && !isLayoutZone(event.venueLayout, viewPosition)) {
    throw { statusCode: 400, message: "This zone is unavailable in the chosen layout." };
  }
}

async function withEditableTier(id, user, change) {
  const reference = await prisma.ticketType.findUnique({ where: { id }, select: { eventId: true } });
  if (!reference) throw { statusCode: 404, message: "Ticket type not found" };
  return withEventLock(reference.eventId, async tx => {
    const tier = await tx.ticketType.findUnique({ where: { id }, include: { event: true } });
    if (!tier) throw { statusCode: 404, message: "Ticket type not found" };
    requireEditableEvent(tier.event, user?.userId || user?.id, user?.role);
    return change(tx, tier);
  });
}

function respondToTierError(res, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode === 500) console.error("Ticket tier update failed", error.code || error.name);
  return res.status(statusCode).json({ statusCode, message: error.message });
}

export const createTicketType = async (req, res) => {
  const { eventId } = req.params;
  const { name, price, quota, viewPosition } = req.body ?? {};
  try {
    requireValidTierFields({ name, price, quota, viewPosition });
    if (!name || price === undefined || quota === undefined) {
      return res.status(400).json({ message: "Name, price and quota are required" });
    }
    const ticketType = await withEventLock(eventId, async tx => {
      const event = await tx.event.findUnique({ where: { id: eventId } });
      requireEditableEvent(event, req.user?.userId || req.user?.id, req.user?.role);
      requireValidZone(event, viewPosition ?? null);
      return tx.ticketType.create({ data: {
        eventId, name, price, quota: Number(quota), availableQuota: Number(quota), viewPosition: viewPosition || null,
      } });
    });
    return res.status(201).json(ticketType);
  } catch (error) {
    return respondToTierError(res, error);
  }
};

export const updateTicketType = async (req, res) => {
  const { id } = req.params;
  const { name, price, quota, viewPosition } = req.body ?? {};
  try {
    requireValidTierFields({ name, price, quota, viewPosition });
    const updated = await withEditableTier(id, req.user, (tx, ticketType) => {
      requireValidZone(ticketType.event, viewPosition);
      const soldQuota = ticketType.quota - ticketType.availableQuota;
      if (quota !== undefined && Number(quota) < soldQuota) {
        throw { statusCode: 400, message: "Quota cannot be less than tickets already sold (" + soldQuota + ")" };
      }
      return tx.ticketType.update({ where: { id }, data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(viewPosition !== undefined && { viewPosition: viewPosition || null }),
        ...(quota !== undefined && { quota: Number(quota), availableQuota: Number(quota) - soldQuota }),
      } });
    });
    return res.status(200).json(updated);
  } catch (error) {
    return respondToTierError(res, error);
  }
};

export const deleteTicketType = async (req, res) => {
  const { id } = req.params;
  try {
    await withEditableTier(id, req.user, async tx => {
      if (await tx.orderItem.count({ where: { ticketTypeId: id } })) {
        throw { statusCode: 409, message: "Ticket type cannot be deleted because it has orders" };
      }
      await tx.ticketType.delete({ where: { id } });
    });
    return res.status(200).json({ message: "Ticket type deleted successfully" });
  } catch (error) {
    return respondToTierError(res, error);
  }
};
