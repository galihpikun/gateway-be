import prisma from "../service/prisma.js";

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

export const createTicketType = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { eventId } = req.params;
  const { name, price, quota } = req.body;
  if ((price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) || (quota !== undefined && (!Number.isSafeInteger(Number(quota)) || Number(quota) < 1)) || (name !== undefined && (typeof name !== "string" || !name.trim()))) return res.status(400).json({ message: "Name, non-negative price and positive integer quota are required" });

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId && req.user?.role !== "ADMIN") {
      return res.status(403).json({ statusCode: 403, message: "You are not the organizer of this event" });
    }

    if (!["DRAFT", "REJECTED"].includes(event.status)) return res.status(409).json({ message: "Ticket tiers may only change on draft or rejected events" });
    if (!name || price === undefined || quota === undefined) return res.status(400).json({ message: "Name, price and quota are required" });
    const ticketType = await prisma.ticketType.create({
      data: {
        name,
        price,
        quota: Number(quota),
        availableQuota: Number(quota),
        eventId,
      },
    });

    return res.status(201).json(ticketType);
  } catch (error) {
    console.error("Create ticket type error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const updateTicketType = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { id } = req.params;
  const { name, price, quota } = req.body;
  if ((price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) || (quota !== undefined && (!Number.isSafeInteger(Number(quota)) || Number(quota) < 1)) || (name !== undefined && (typeof name !== "string" || !name.trim()))) return res.status(400).json({ message: "Name, non-negative price and positive integer quota are required" });

  try {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id },
      include: { event: true },
    });

    if (!ticketType) {
      return res.status(404).json({ statusCode: 404, message: "Ticket type not found" });
    }

    if (ticketType.event.organizerId !== userId && req.user?.role !== "ADMIN") {
      return res.status(403).json({ statusCode: 403, message: "You are not the organizer of this event" });
    }

    if (!["DRAFT", "REJECTED"].includes(ticketType.event.status)) return res.status(409).json({ message: "Ticket tiers may only change on draft or rejected events" });
    const soldQuota = ticketType.quota - ticketType.availableQuota;

    if (quota !== undefined && Number(quota) < soldQuota) {
      return res.status(400).json({
        statusCode: 400,
        message: `Quota cannot be less than tickets already sold (${soldQuota})`,
      });
    }

    const availableQuota =
      quota !== undefined ? Number(quota) - soldQuota : ticketType.availableQuota;

    const updated = await prisma.ticketType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(quota !== undefined && {
          quota: Number(quota),
          availableQuota,
        }),
      },
    });

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Update ticket type error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const deleteTicketType = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { id } = req.params;

  try {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id },
      include: { orderItems: true, event: true },
    });

    if (!ticketType) {
      return res.status(404).json({ statusCode: 404, message: "Ticket type not found" });
    }

    if (ticketType.event.organizerId !== userId && req.user?.role !== "ADMIN") {
      return res.status(403).json({ statusCode: 403, message: "You are not the organizer of this event" });
    }

    if (!["DRAFT", "REJECTED"].includes(ticketType.event.status)) return res.status(409).json({ message: "Ticket tiers may only change on draft or rejected events" });
    if (ticketType.orderItems.length > 0) {
      return res.status(409).json({
        statusCode: 409,
        message: "Ticket type cannot be deleted because it has orders",
      });
    }

    await prisma.ticketType.delete({
      where: { id },
    });

    return res.status(200).json({
      message: "Ticket type deleted successfully",
    });
  } catch (error) {
    console.error("Delete ticket type error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};
