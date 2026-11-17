import { validPreviewVideo, validViewPosition } from "../utils/previewValidation.js";
import prisma, { Prisma } from "../service/prisma.js";
import CloudinaryService from "../service/cloudinaryService.js";
import AuditLogService from "../service/auditLogService.js";
import RefundService from "../service/refundService.js";
import { buildPaginatedResponse } from "../utils/paginate.js";

export const getEvents = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        endDatetime: { gt: new Date() },
      },
      include: {
        category: true,
        ticketTypes: true,
      },
      orderBy: {
        startDatetime: "asc",
      },
    });

    return res.status(200).json(events);
  } catch (error) {
    console.error("Get events error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getMostPopularEvents = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        endDatetime: { gt: new Date() },
      },
      include: {
        category: true,
        ticketTypes: true,
      },
      orderBy: {
        ticketTypes: {
          _count: "desc",
        },
      },
    });

    const ranked = await Promise.all(events.map(async event => ({ event, sold: await prisma.issuedTicket.count({ where: { isCancelled: false, isRefunded: false, orderItem: { ticketType: { eventId: event.id }, order: { paymentStatus: "PAID" } } } }) })));
    ranked.sort((a, b) => b.sold - a.sold || a.event.startDatetime - b.event.startDatetime);
    return res.status(200).json(ranked.map(row => row.event));
  } catch (error) {
    console.error("Get most popular events error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const eventDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const event = await prisma.event.findFirst({
      where: {
        id,
        status: "PUBLISHED",
        endDatetime: { gt: new Date() },
      },
      include: {
        category: true,
        organizer: {
          select: {
            id: true,
            fullName: true,
            organizerProfile: {
              select: {
                organizationName: true,
              },
            },
          },
        },
        ticketTypes: true,
      },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Event detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const createEvent = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const dto = req.body;
  const files = req.files || {};

  try {
    let tiers = [];
    try { tiers = req.body.ticketTypes ? JSON.parse(req.body.ticketTypes) : []; }
    catch { return res.status(400).json({ message: "Invalid ticket types" }); }
    if (!Array.isArray(tiers) || tiers.some(t => !t || typeof t.name !== "string" || !t.name.trim() || !Number.isFinite(t.price) || t.price < 0 || !Number.isSafeInteger(t.quota) || t.quota < 1 || !validViewPosition(t.viewPosition))) return res.status(400).json({ message: "Invalid ticket type name, price or quota" });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organizerProfile: true },
    });

    if (!user) {
      return res.status(404).json({ statusCode: 404, message: "User not found" });
    }

    if (!user.organizerProfile) {
      return res.status(403).json({ statusCode: 403, message: "You do not have an organizer profile" });
    }

    if (user.organizerProfile.status !== "APPROVED") {
      return res.status(403).json({ statusCode: 403, message: "Your organizer account has not been approved" });
    }

    const previewVideo = files.previewVideo?.[0];
    if (!validPreviewVideo(previewVideo)) return res.status(400).json({ message: "Preview must be an MP4 or WebM video up to 25 MB" });
    const coverImage = files.coverImage?.[0];
    const venueImage = files.venueImage?.[0];

    if (!coverImage) {
      return res.status(400).json({ statusCode: 400, message: "Cover image is required" });
    }

    const images = [coverImage, venueImage].filter(Boolean);
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

    for (const file of images) {
      const ext = file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ statusCode: 400, message: `Invalid image type: ${file.originalname}` });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ statusCode: 400, message: `File ${file.originalname} exceeds 5 MB` });
      }
    }

    const startDatetime = new Date(dto.startDatetime);
    const endDatetime = new Date(dto.endDatetime);

    if (isNaN(startDatetime.getTime())) {
      return res.status(400).json({ statusCode: 400, message: "Invalid start datetime" });
    }
    if (isNaN(endDatetime.getTime())) {
      return res.status(400).json({ statusCode: 400, message: "Invalid end datetime" });
    }
    if (startDatetime >= endDatetime) {
      return res.status(400).json({ statusCode: 400, message: "End datetime must be after start datetime" });
    }

    const category = await prisma.category.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category) {
      return res.status(404).json({ statusCode: 404, message: "Category not found" });
    }

    const [coverUpload, venueUpload] = await Promise.all([
      CloudinaryService.uploadImage(coverImage),
      venueImage ? CloudinaryService.uploadImage(venueImage) : null,
    ]);

    const previewUpload = previewVideo ? await CloudinaryService.uploadVideo(previewVideo) : null;
    let invitedUserIds = dto.invitedUserIds;
    if (typeof invitedUserIds === "string") {
      try {
        invitedUserIds = JSON.parse(invitedUserIds);
      } catch {
        invitedUserIds = [invitedUserIds];
      }
    }
    const uniqueInvitedIds = Array.isArray(invitedUserIds) ? [...new Set(invitedUserIds)] : [];

    if (uniqueInvitedIds.length > 0) {
      if (uniqueInvitedIds.includes(userId)) {
        return res.status(400).json({ statusCode: 400, message: "You cannot invite yourself as staff" });
      }

      const invitedUsers = await prisma.user.findMany({
        where: { id: { in: uniqueInvitedIds } },
        select: { id: true, emailVerified: true, isSuspended: true, role: true },
      });

      const foundIds = new Set(invitedUsers.map((u) => u.id));
      const missingIds = uniqueInvitedIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        return res.status(400).json({ statusCode: 400, message: `Users not found: ${missingIds.join(", ")}` });
      }

      const errors = [];
      for (const u of invitedUsers) {
        if (!u.emailVerified) errors.push(`User ${u.id} has not verified their email`);
        if (u.isSuspended) errors.push(`User ${u.id} is suspended`);
        if (u.role === "ADMIN") errors.push(`User ${u.id} is an admin and cannot be invited as staff`);
      }
      if (errors.length > 0) {
        return res.status(400).json({ statusCode: 400, message: errors });
      }
    }

    const isRefundable =
      dto.isRefundable === undefined || dto.isRefundable === true || dto.isRefundable === "true";

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          organizerId: userId,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          location: dto.location,
          coverImageUrl: coverUpload.secure_url,
          coverImageId: coverUpload.public_id,
          venueImageUrl: venueUpload?.secure_url,
          venueImageId: venueUpload?.public_id,
          previewVideoUrl: previewUpload?.secure_url,
          previewVideoId: previewUpload?.public_id,
          startDatetime,
          endDatetime,
          isRefundable,
          status: "DRAFT",
          ticketTypes: { create: tiers.map(t => ({ name: t.name.trim(), price: t.price, quota: t.quota, availableQuota: t.quota, viewPosition: t.viewPosition || null })) },
        },
      });

      if (uniqueInvitedIds.length > 0) {
        await tx.staffInvitation.createMany({
          data: uniqueInvitedIds.map((inviteeId) => ({
            eventId: created.id,
            userId: inviteeId,
          })),
        });
      }

      return created;
    });

    return res.status(201).json({
      message: "Event created successfully",
      event,
    });
  } catch (error) {
    console.error("Create event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const updateEvent = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.params.id;
  const dto = req.body;
  const files = req.files || {};

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    if (event.status !== "DRAFT" && event.status !== "REJECTED") {
      return res.status(409).json({ statusCode: 409, message: "Only draft or rejected events can be updated" });
    }

    if (dto.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        return res.status(404).json({ statusCode: 404, message: "Category not found" });
      }
    }

    const startDatetime = dto.startDatetime ? new Date(dto.startDatetime) : event.startDatetime;
    const endDatetime = dto.endDatetime ? new Date(dto.endDatetime) : event.endDatetime;

    if (isNaN(startDatetime.getTime()) || isNaN(endDatetime.getTime())) {
      return res.status(400).json({ statusCode: 400, message: "Invalid datetime" });
    }
    if (startDatetime >= endDatetime) {
      return res.status(400).json({ statusCode: 400, message: "End datetime must be after start datetime" });
    }

    const previewVideo = files.previewVideo?.[0];
    if (!validPreviewVideo(previewVideo)) return res.status(400).json({ message: "Preview must be an MP4 or WebM video up to 25 MB" });
    const coverImage = files.coverImage?.[0];
    const venueImage = files.venueImage?.[0];
    const images = [coverImage, venueImage].filter(Boolean);
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

    for (const file of images) {
      const ext = file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ statusCode: 400, message: `Invalid image type: ${file.originalname}` });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ statusCode: 400, message: `File ${file.originalname} exceeds 5 MB` });
      }
    }

    const previewUpload = previewVideo ? await CloudinaryService.uploadVideo(previewVideo) : null;
    let coverUpload;
    if (coverImage) coverUpload = await CloudinaryService.uploadImage(coverImage);
    let venueUpload;
    if (venueImage) venueUpload = await CloudinaryService.uploadImage(venueImage);

    const isRefundable =
      dto.isRefundable !== undefined
        ? dto.isRefundable === true || dto.isRefundable === "true"
        : undefined;

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.startDatetime !== undefined && { startDatetime }),
        ...(dto.endDatetime !== undefined && { endDatetime }),
        ...(isRefundable !== undefined && { isRefundable }),
        ...(previewUpload && { previewVideoUrl: previewUpload.secure_url, previewVideoId: previewUpload.public_id }),
        ...(dto.removePreviewVideo === "true" && !previewUpload && { previewVideoUrl: null, previewVideoId: null }),
        ...(coverUpload && { coverImageUrl: coverUpload.secure_url, coverImageId: coverUpload.public_id }),
        ...(venueUpload && { venueImageUrl: venueUpload.secure_url, venueImageId: venueUpload.public_id }),
        ...(event.status === "REJECTED" && { rejectionReason: null }),
      },
    });

    return res.status(200).json({
      message: "Event updated successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Update event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const submitEvent = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.params.id;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    if (event.status !== "DRAFT" && event.status !== "REJECTED") {
      return res.status(409).json({ statusCode: 409, message: "Only draft or rejected events can be submitted" });
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        status: "PENDING_REVIEW",
        rejectionReason: null,
      },
    });

    return res.status(200).json({
      message: "Event submitted for review",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Submit event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const completeEvent = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.params.id;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    if (event.status === "COMPLETED") {
      return res.status(409).json({ statusCode: 409, message: "Event is already marked as completed" });
    }

    if (event.status !== "PUBLISHED") {
      return res.status(409).json({ statusCode: 409, message: "Only published events can be marked as completed" });
    }

    if (new Date(event.endDatetime) > new Date()) {
      return res.status(400).json({
        statusCode: 400,
        message: "Event cannot be marked as completed until its scheduled end date and time have passed",
      });
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: { status: "COMPLETED" },
    });

    await AuditLogService.log(userId, "COMPLETE", "Event", eventId, {
      title: event.title,
      previousStatus: event.status,
    });

    return res.status(200).json({
      message: "Event marked as completed successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Complete event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

// Admin handlers
export const getAdminEvents = async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.search) {
    where.OR = [
      { title: { contains: req.query.search, mode: "insensitive" } },
      { location: { contains: req.query.search, mode: "insensitive" } },
    ];
  }

  try {
    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          category: true,
          organizer: {
            select: {
              id: true,
              email: true,
              fullName: true,
              organizerProfile: {
                select: {
                  id: true,
                  organizationName: true,
                  status: true,
                },
              },
            },
          },
          ticketTypes: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.event.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(events, total, page, limit));
  } catch (error) {
    console.error("Get admin events error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getAdminEventDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const event = await prisma.event.findFirst({
      where: { id },
      include: {
        category: true,
        organizer: {
          select: {
            id: true,
            fullName: true,
            organizerProfile: {
              select: {
                organizationName: true,
              },
            },
          },
        },
        ticketTypes: true,
      },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Admin event detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const approveEvent = async (req, res) => {
  const eventId = req.params.id;
  const actorId = req.user?.userId || req.user?.id;

  try {
    const updatedEvent = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          organizer: {
            include: { organizerProfile: true },
          },
          ticketTypes: true,
          staffInvitations: {
            where: { activated: false },
            include: {
              user: {
                select: { id: true, role: true, emailVerified: true, isSuspended: true },
              },
            },
          },
        },
      });

      if (!event) throw { statusCode: 404, message: "Event not found" };

      if (!event.organizer.organizerProfile || event.organizer.organizerProfile.status !== "APPROVED") {
        throw { statusCode: 409, message: "Organizer is not approved" };
      }

      if (event.ticketTypes.length === 0) {
        throw { statusCode: 409, message: "EVent Must atleast have one ticket type before approval" };
      }

      const published = await tx.event.updateMany({
        where: { id: eventId, status: "PENDING_REVIEW" },
        data: { status: "PUBLISHED", rejectionReason: null },
      });

      if (published.count === 0) {
        throw { statusCode: 409, message: "Only events pending review can be approved" };
      }

      for (const invitation of event.staffInvitations) {
        const u = invitation.user;
        if (!u.emailVerified || u.isSuspended || u.role === "ADMIN") continue;

        if (u.role === "USER") {
          const promoted = await tx.user.updateMany({
            where: { id: u.id, role: "USER", emailVerified: true, isSuspended: false },
            data: { role: "STAFF" },
          });
          if (promoted.count === 0) continue;
        }

        await tx.eventStaff.upsert({
          where: {
            eventId_userId: { eventId, userId: u.id },
          },
          create: { eventId, userId: u.id },
          update: {},
        });

        await tx.staffInvitation.updateMany({
          where: { id: invitation.id, activated: false },
          data: { activated: true },
        });
      }

      await AuditLogService.log(
        actorId ?? null,
        "APPROVE",
        "Event",
        eventId,
        {
          title: event.title,
          previousStatus: event.status,
          staffInvitationsProcessed: event.staffInvitations.length,
        },
        tx
      );

      return tx.event.findUniqueOrThrow({
        where: { id: eventId },
        include: {
          category: true,
          organizer: {
            select: {
              id: true,
              fullName: true,
              organizerProfile: { select: { organizationName: true } },
            },
          },
          ticketTypes: true,
          staffs: {
            include: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      });
    });

    return res.status(200).json({
      message: "Event approved successfully",
      event: updatedEvent,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};

export const rejectEvent = async (req, res) => {
  const eventId = req.params.id;
  const { reason } = req.body;
  const actorId = req.user?.userId || req.user?.id;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ statusCode: 400, message: "Rejection reason is required" });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.status !== "PENDING_REVIEW") {
      return res.status(409).json({ statusCode: 409, message: "Only events pending review can be rejected" });
    }

    const updatedEvent = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          status: "REJECTED",
          rejectionReason: reason.trim(),
        },
        include: {
          category: true,
          organizer: {
            select: {
              id: true,
              fullName: true,
              organizerProfile: { select: { organizationName: true } },
            },
          },
          ticketTypes: true,
          staffs: {
            include: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "REJECT",
        "Event",
        eventId,
        { title: event.title, reason: reason.trim() },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: "Event rejected successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Reject event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const cancelEvent = async (req, res) => {
  const eventId = req.params.id;
  const { reason } = req.body;
  const actorId = req.user?.userId || req.user?.id;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ statusCode: 400, message: "Cancellation reason is required" });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTypes: {
          include: {
            orderItems: {
              include: { order: true },
            },
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.status !== "PUBLISHED" && event.status !== "PENDING_REVIEW") {
      return res.status(409).json({ statusCode: 409, message: "Only published or pending review events can be cancelled" });
    }

    const updatedEvent = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
      {
        await RefundService.triggerAutomaticEventCancellationRefunds(
          eventId,
          reason.trim(),
          actorId,
          tx
        );
      }

      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          status: "CANCELLED",
          rejectionReason: reason.trim(),
        },
        include: {
          category: true,
          organizer: {
            select: {
              id: true,
              fullName: true,
              organizerProfile: { select: { organizationName: true } },
            },
          },
          ticketTypes: true,
          staffs: {
            include: {
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "CANCEL",
        "Event",
        eventId,
        {
          title: event.title,
          reason: reason.trim(),
          previousStatus: event.status,
        },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: "Event cancelled successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Cancel event error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

// Organizer handlers
export const getMyEvents = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organizerProfile: true },
    });

    if (!user?.organizerProfile || user.organizerProfile.status !== "APPROVED") {
      return res.status(403).json({ statusCode: 403, message: "Your organizer account has not been approved" });
    }

    const where = { organizerId: userId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.categoryId) where.categoryId = req.query.categoryId;
    if (req.query.search) {
      where.OR = [
        { title: { contains: req.query.search, mode: "insensitive" } },
        { location: { contains: req.query.search, mode: "insensitive" } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          category: true,
          ticketTypes: true,
          _count: {
            select: { staffs: true, staffInvitations: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.event.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(events, total, page, limit));
  } catch (error) {
    console.error("Get my events error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getOrganizerEventDetail = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.params.id;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        category: true,
        ticketTypes: true,
        staffs: {
          include: {
            user: { select: { id: true, fullName: true, email: true, avatar: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        staffInvitations: {
          include: {
            user: { select: { id: true, fullName: true, email: true, avatar: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Get organizer event detail error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const getOrganizerEventCheckin = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.params.id;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        status: true,
        startDatetime: true,
        endDatetime: true,
        organizerId: true,
      },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    const [totalValid, totalRedeemed, recentRedemptions] = await Promise.all([
      prisma.issuedTicket.count({
        where: {
          isCancelled: false,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: "PAID" },
          },
        },
      }),
      prisma.issuedTicket.count({
        where: {
          isCancelled: false,
          isRedeemed: true,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: "PAID" },
          },
        },
      }),
      prisma.issuedTicket.findMany({
        where: {
          isCancelled: false,
          isRedeemed: true,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: "PAID" },
          },
        },
        select: {
          id: true,
          ticketCode: true,
          redeemedAt: true,
          orderItem: {
            select: {
              ticketType: { select: { name: true } },
              order: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
        orderBy: { redeemedAt: "desc" },
        take: 20,
      }),
    ]);

    const remainingTickets = Math.max(0, totalValid - totalRedeemed);
    const redemptionRate = totalValid > 0 ? Number(((totalRedeemed / totalValid) * 100).toFixed(2)) : 0;

    return res.status(200).json({
      eventId: event.id,
      eventTitle: event.title,
      eventStatus: event.status,
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      statistics: {
        totalParticipants: totalValid,
        totalRedeemed,
        remainingTickets,
        redemptionRate,
      },
      recentRedemptions: recentRedemptions.map((t) => ({
        id: t.id,
        ticketCode: t.ticketCode,
        ticketType: t.orderItem.ticketType.name,
        buyerName: t.orderItem.order.user.fullName,
        redeemedAt: t.redeemedAt,
      })),
    });
  } catch (error) {
    console.error("Get checkin monitor error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const removeOrganizerStaff = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { eventId, assignmentId } = req.params;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizerId: true },
    });

    if (!event) {
      return res.status(404).json({ statusCode: 404, message: "Event not found" });
    }

    if (event.organizerId !== userId) {
      return res.status(403).json({ statusCode: 403, message: "You are not the owner of this event" });
    }

    const assignment = await prisma.eventStaff.findUnique({
      where: { id: assignmentId },
      include: { user: { select: { fullName: true } } },
    });

    if (!assignment || assignment.eventId !== eventId) {
      return res.status(404).json({ statusCode: 404, message: "Staff assignment not found for this event" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.eventStaff.delete({
        where: { id: assignmentId },
      });

      await AuditLogService.log(
        userId,
        "ORGANIZER_REMOVE_STAFF",
        "EventStaff",
        assignmentId,
        {
          eventId,
          eventTitle: event.title,
          staffUserId: assignment.userId,
          staffName: assignment.user.fullName,
        },
        tx
      );
    });

    return res.status(200).json({
      message: "Staff assignment removed successfully",
    });
  } catch (error) {
    console.error("Remove organizer staff error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const searchInvitableUsers = async (req, res) => {
  const organizerId = req.user?.userId || req.user?.id;
  const search = req.query.search || "";
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 10, 20);
  const skip = (page - 1) * limit;

  try {
    const organizer = await prisma.user.findUnique({
      where: { id: organizerId },
      include: { organizerProfile: true },
    });

    if (!organizer?.organizerProfile) {
      return res.status(403).json({ statusCode: 403, message: "You do not have an organizer profile" });
    }

    if (organizer.isSuspended || organizer.organizerProfile.status !== "APPROVED") {
      return res.status(403).json({ statusCode: 403, message: "Your organizer account has not been approved" });
    }

    const where = {
      emailVerified: true,
      isSuspended: false,
      role: { not: "ADMIN" },
      id: { not: organizerId },
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          avatar: true,
          role: true,
        },
        orderBy: { fullName: "asc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(users, total, page, limit));
  } catch (error) {
    console.error("Search invitable users error:", error);
    return res.status(500).json({ statusCode: 500, message: error.message });
  }
};

export const inviteOrganizerStaff = async (req, res) => {
  try {
    const actorId = req.user.id;
    const { eventId } = req.params;
    const targetId = req.body.userId;
    if (!targetId || targetId === actorId) return res.status(400).json({ message: "Choose another verified user" });
    await prisma.$transaction(async tx => {
      const event = await tx.event.findUnique({ where: { id: eventId }, include: { organizer: { include: { organizerProfile: true } } } });
      if (!event || event.organizerId !== actorId || event.organizer.organizerProfile?.status !== "APPROVED") throw { statusCode: 403, message: "Only the approved event organizer may invite staff" };
      if (!["DRAFT", "REJECTED", "PENDING_REVIEW", "PUBLISHED"].includes(event.status)) throw { statusCode: 409, message: "Event is closed" };
      const user = await tx.user.findUnique({ where: { id: targetId } });
      if (!user || !user.emailVerified || user.isSuspended || user.role === "ADMIN") throw { statusCode: 400, message: "User is not eligible for staff assignment" };
      await tx.staffInvitation.upsert({ where: { eventId_userId: { eventId, userId: targetId } }, create: { eventId, userId: targetId, activated: event.status === "PUBLISHED" }, update: { activated: event.status === "PUBLISHED" } });
      if (event.status === "PUBLISHED") {
        await tx.user.update({ where: { id: targetId }, data: { role: "STAFF" } });
        await tx.eventStaff.upsert({ where: { eventId_userId: { eventId, userId: targetId } }, create: { eventId, userId: targetId }, update: {} });
      }
      await AuditLogService.log(actorId, "INVITE_STAFF", "Event", eventId, { userId: targetId }, tx);
    });
    return res.json({ message: "Staff invitation saved; published events grant gate access immediately" });
  } catch (error) { return res.status(error.statusCode || 500).json({ message: error.message }); }
};
