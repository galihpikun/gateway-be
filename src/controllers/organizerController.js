import prisma from "../service/prisma.js";
import CloudinaryService from "../service/cloudinaryService.js";
import AuditLogService from "../service/auditLogService.js";
import { buildPaginatedResponse, parsePagination, PaginationError } from "../utils/paginate.js";

function documentForViewer(document) {
  return { ...document, fileUrl: CloudinaryService.organizerDocumentUrl(document) };
}

function organizerForViewer(organizer) {
  return { ...organizer, documents: organizer.documents.map(documentForViewer) };
}

export const applyOrganizer = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const {
    organizationName,
    phoneNumber,
    address,
    identityCardNumber,
    bankName,
    bankAccountNumber,
    bankAccountName,
  } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        statusCode: 404,
        message: "User not found",
      });
    }

    const existingOrganizer = await prisma.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (existingOrganizer) {
      if (existingOrganizer.status === "PENDING") {
        return res.status(409).json({
          statusCode: 409,
          message: "Your organizer application is still being reviewed",
        });
      }
      if (existingOrganizer.status === "APPROVED") {
        return res.status(409).json({
          statusCode: 409,
          message: "You are already an approved organizer",
        });
      }
    }

    const files = req.files || {};
    const businessLicense = files.businessLicense?.[0];
    const guaranteeLetter = files.guaranteeLetter?.[0];
    const organizationRegistration = files.organizationRegistration?.[0];
    const identityCard = files.identityCard?.[0];

    if (!businessLicense) {
      return res.status(400).json({ statusCode: 400, message: "Business license is required" });
    }
    if (!guaranteeLetter) {
      return res.status(400).json({ statusCode: 400, message: "Guarantee letter is required" });
    }
    if (!organizationRegistration) {
      return res.status(400).json({ statusCode: 400, message: "Organization registration is required" });
    }
    if (!identityCard) {
      return res.status(400).json({ statusCode: 400, message: "Identity card is required" });
    }

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const documents = [businessLicense, guaranteeLetter, organizationRegistration, identityCard];

    for (const file of documents) {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          statusCode: 400,
          message: `Invalid image type: ${file.originalname}`,
        });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          statusCode: 400,
          message: `File ${file.originalname} exceeds 5 MB`,
        });
      }
    }

    const [
      businessLicenseUpload,
      guaranteeLetterUpload,
      organizationRegistrationUpload,
      identityCardUpload,
    ] = await Promise.all([
      CloudinaryService.uploadOrganizerDocument(businessLicense),
      CloudinaryService.uploadOrganizerDocument(guaranteeLetter),
      CloudinaryService.uploadOrganizerDocument(organizationRegistration),
      CloudinaryService.uploadOrganizerDocument(identityCard),
    ]);

    if (existingOrganizer) {
      await prisma.organizerDocument.deleteMany({
        where: { organizerId: existingOrganizer.id },
      });
    }

    const profileData = {
      organizationName: organizationName || "",
      phoneNumber: phoneNumber || "",
      address: address || "",
      identityCardNumber: identityCardNumber || null,
      bankName: bankName || "",
      bankAccountNumber: bankAccountNumber || "",
      bankAccountName: bankAccountName || "",
      status: "PENDING",
      rejectionReason: null,
    };

    let organizer;
    if (existingOrganizer) {
      organizer = await prisma.organizerProfile.update({
        where: { id: existingOrganizer.id },
        data: profileData,
      });
    } else {
      organizer = await prisma.organizerProfile.create({
        data: {
          userId: user.id,
          ...profileData,
        },
      });
    }

    await prisma.organizerDocument.createMany({
      data: [
        {
          organizerId: organizer.id,
          type: "BUSINESS_LICENSE",
          fileUrl: businessLicenseUpload.secure_url,
          publicId: businessLicenseUpload.public_id,
        },
        {
          organizerId: organizer.id,
          type: "GUARANTEE_LETTER",
          fileUrl: guaranteeLetterUpload.secure_url,
          publicId: guaranteeLetterUpload.public_id,
        },
        {
          organizerId: organizer.id,
          type: "ORGANIZATION_REGISTRATION",
          fileUrl: organizationRegistrationUpload.secure_url,
          publicId: organizationRegistrationUpload.public_id,
        },
        {
          organizerId: organizer.id,
          type: "IDENTITY_CARD",
          fileUrl: identityCardUpload.secure_url,
          publicId: identityCardUpload.public_id,
        },
      ],
    });

    return res.status(200).json({
      message: "Organizer application submitted successfully",
      status: organizer.status,
      organizerId: organizer.id,
    });
  } catch (error) {
    console.error("Apply organizer error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const getMyOrganizerProfile = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;

  try {
    const organizer = await prisma.organizerProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });

    if (!organizer) {
      return res.status(404).json({
        statusCode: 404,
        message: "Organizer profile not found. Please apply first",
      });
    }

    return res.set("Cache-Control", "private, no-store").status(200).json(organizerForViewer(organizer));
  } catch (error) {
    console.error("Get my organizer error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const getOrganizerDashboard = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organizerProfile: true },
    });

    if (!user) {
      return res.status(404).json({ statusCode: 404, message: "User not found" });
    }

    if (!user.organizerProfile || user.organizerProfile.status !== "APPROVED") {
      return res.status(403).json({
        statusCode: 403,
        message: "Your organizer account has not been approved",
      });
    }

    const [
      totalEvents,
      publishedEvents,
      pendingEvents,
      draftEvents,
      rejectedEvents,
      paidOrderItems,
      checkedInCount,
      upcomingEvents,
      draftsNeedingAttention,
      rejectedNeedingAttention,
    ] = await Promise.all([
      prisma.event.count({ where: { organizerId: userId } }),
      prisma.event.count({ where: { organizerId: userId, status: "PUBLISHED" } }),
      prisma.event.count({ where: { organizerId: userId, status: "PENDING_REVIEW" } }),
      prisma.event.count({ where: { organizerId: userId, status: "DRAFT" } }),
      prisma.event.count({ where: { organizerId: userId, status: "REJECTED" } }),
      prisma.orderItem.findMany({
        where: {
          order: { paymentStatus: "PAID" },
          ticketType: { event: { organizerId: userId } },
        },
        select: {
          id: true,
          quantity: true,
          price: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              },
            },
          },
          ticketType: {
            select: {
              id: true,
              name: true,
              event: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.issuedTicket.count({
        where: {
          isRedeemed: true,
          orderItem: {
            ticketType: { event: { organizerId: userId } },
            order: { paymentStatus: "PAID" },
          },
        },
      }),
      prisma.event.findMany({
        where: {
          organizerId: userId,
          status: "PUBLISHED",
        },
        include: {
          category: true,
          ticketTypes: {
            select: {
              id: true,
              name: true,
              quota: true,
              availableQuota: true,
            },
          },
        },
        orderBy: { startDatetime: "asc" },
        take: 4,
      }),
      prisma.event.findMany({
        where: {
          organizerId: userId,
          status: "DRAFT",
        },
        include: {
          category: true,
          ticketTypes: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 3,
      }),
      prisma.event.findMany({
        where: {
          organizerId: userId,
          status: "REJECTED",
        },
        include: {
          category: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 3,
      }),
    ]);

    let totalTicketsSold = 0;
    let grossRevenue = 0;
    const distinctOrderIds = new Set();

    for (const item of paidOrderItems) {
      totalTicketsSold += item.quantity;
      grossRevenue += Number(item.price) * item.quantity;
      distinctOrderIds.add(item.order.id);
    }

    const recentSales = paidOrderItems.slice(0, 10).map((item) => ({
      orderId: item.order.id,
      orderNumber: item.order.orderNumber,
      buyerName: item.order.user.fullName,
      buyerEmail: item.order.user.email,
      ticketName: item.ticketType.name,
      eventTitle: item.ticketType.event.title,
      quantity: item.quantity,
      totalAmount: Number(item.price) * item.quantity,
      createdAt: item.createdAt,
    }));

    return res.status(200).json({
      organizationName: user.organizerProfile.organizationName,
      metrics: {
        totalEvents,
        publishedEvents,
        pendingEvents,
        draftEvents,
        rejectedEvents,
        paidOrdersCount: distinctOrderIds.size,
        totalTicketsSold,
        grossRevenue,
        checkedInAttendees: checkedInCount,
      },
      upcomingEvents: upcomingEvents.map((evt) => {
        const totalQuota = evt.ticketTypes.reduce((acc, tt) => acc + tt.quota, 0);
        const availableQuota = evt.ticketTypes.reduce((acc, tt) => acc + tt.availableQuota, 0);
        const sold = Math.max(0, totalQuota - availableQuota);
        return {
          id: evt.id,
          title: evt.title,
          coverImageUrl: evt.coverImageUrl,
          location: evt.location,
          startDatetime: evt.startDatetime,
          endDatetime: evt.endDatetime,
          category: evt.category.name,
          status: evt.status,
          totalQuota,
          soldQuota: sold,
        };
      }),
      actionItems: {
        drafts: draftsNeedingAttention.map((evt) => ({
          id: evt.id,
          title: evt.title,
          ticketTypesCount: evt.ticketTypes.length,
          updatedAt: evt.updatedAt,
        })),
        rejected: rejectedNeedingAttention.map((evt) => ({
          id: evt.id,
          title: evt.title,
          rejectionReason: evt.rejectionReason,
          updatedAt: evt.updatedAt,
        })),
      },
      recentSales,
    });
  } catch (error) {
    console.error("Get organizer dashboard error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const getOrganizerStaff = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const eventId = req.query.eventId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organizerProfile: true },
    });

    if (!user) {
      return res.status(404).json({ statusCode: 404, message: "User not found" });
    }

    if (!user.organizerProfile || user.organizerProfile.status !== "APPROVED") {
      return res.status(403).json({
        statusCode: 403,
        message: "Your organizer account has not been approved",
      });
    }

    const eventWhere = {
      organizerId: userId,
      ...(eventId ? { id: String(eventId) } : {}),
    };

    const [activeAssignments, pendingInvitations] = await Promise.all([
      prisma.eventStaff.findMany({
        where: { event: eventWhere },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatar: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
              status: true,
              startDatetime: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.staffInvitation.findMany({
        where: {
          activated: false,
          event: eventWhere,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatar: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
              status: true,
              startDatetime: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const activeList = activeAssignments.map((a) => ({
      id: a.id,
      type: "ACTIVE",
      assignmentId: a.id,
      eventId: a.event.id,
      eventTitle: a.event.title,
      eventStatus: a.event.status,
      startDatetime: a.event.startDatetime,
      userId: a.user.id,
      fullName: a.user.fullName,
      email: a.user.email,
      avatar: a.user.avatar,
      createdAt: a.createdAt,
    }));

    const pendingList = pendingInvitations.map((i) => ({
      id: i.id,
      type: "PENDING",
      invitationId: i.id,
      eventId: i.event.id,
      eventTitle: i.event.title,
      eventStatus: i.event.status,
      startDatetime: i.event.startDatetime,
      userId: i.user.id,
      fullName: i.user.fullName,
      email: i.user.email,
      avatar: i.user.avatar,
      createdAt: i.createdAt,
    }));

    return res.status(200).json({
      active: activeList,
      pending: pendingList,
      totalCount: activeList.length + pendingList.length,
    });
  } catch (error) {
    console.error("Get organizer staff error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const getAllOrganizerApplications = async (req, res, next) => {
  const where = {};
  if (req.query.status) {
    where.status = req.query.status;
  }
  if (req.query.search) {
    where.OR = [
      { organizationName: { contains: req.query.search, mode: "insensitive" } },
      { user: { fullName: { contains: req.query.search, mode: "insensitive" } } },
      { user: { email: { contains: req.query.search, mode: "insensitive" } } },
    ];
  }

  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [organizers, total] = await Promise.all([
      prisma.organizerProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              createdAt: true,
            },
          },
          documents: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.organizerProfile.count({ where }),
    ]);

    return res.set("Cache-Control", "private, no-store").status(200).json(buildPaginatedResponse(organizers.map(organizerForViewer), total, page, limit));
  } catch (error) {
    if (error instanceof PaginationError) return next(error);
    console.error("Get all organizers error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const getOrganizerDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const organizer = await prisma.organizerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            createdAt: true,
            emailVerified: true,
            role: true,
          },
        },
        documents: true,
      },
    });

    if (!organizer) {
      return res.status(404).json({
        statusCode: 404,
        message: "Organizer application not found",
      });
    }

    return res.set("Cache-Control", "private, no-store").status(200).json(organizerForViewer(organizer));
  } catch (error) {
    console.error("Get organizer detail error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const approveDocument = async (req, res) => {
  const { docId } = req.params;
  const actorId = req.user?.userId || req.user?.id;

  try {
    const doc = await prisma.organizerDocument.findUnique({
      where: { id: docId },
    });

    if (!doc) {
      return res.status(404).json({ statusCode: 404, message: "Document not found" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.organizerDocument.update({
        where: { id: docId },
        data: {
          status: "APPROVED",
          rejectionReason: null,
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "APPROVE_DOCUMENT",
        "OrganizerDocument",
        docId,
        { type: doc.type, organizerId: doc.organizerId },
        tx
      );

      return result;
    });

    return res.set("Cache-Control", "private, no-store").status(200).json({
      message: "Document approved successfully",
      document: documentForViewer(updated),
    });
  } catch (error) {
    console.error("Approve doc error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const rejectDocument = async (req, res) => {
  const { docId } = req.params;
  const rejectionReason = (req.body.rejectionReason || req.body.reason || "").trim();
  const actorId = req.user?.userId || req.user?.id;

  if (!rejectionReason) {
    return res.status(400).json({
      statusCode: 400,
      message: "Rejection reason is required",
    });
  }

  try {
    const doc = await prisma.organizerDocument.findUnique({
      where: { id: docId },
    });

    if (!doc) {
      return res.status(404).json({ statusCode: 404, message: "Document not found" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.organizerDocument.update({
        where: { id: docId },
        data: {
          status: "REJECTED",
          rejectionReason: rejectionReason.trim(),
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "REJECT_DOCUMENT",
        "OrganizerDocument",
        docId,
        {
          type: doc.type,
          organizerId: doc.organizerId,
          reason: rejectionReason.trim(),
        },
        tx
      );

      return result;
    });

    return res.set("Cache-Control", "private, no-store").status(200).json({
      message: "Document rejected successfully",
      document: documentForViewer(updated),
    });
  } catch (error) {
    console.error("Reject doc error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const approveOrganizer = async (req, res) => {
  const { id } = req.params;
  const actorId = req.user?.userId || req.user?.id;

  try {
    const organizer = await prisma.organizerProfile.findUnique({
      where: { id },
      include: { documents: true },
    });

    if (!organizer) {
      return res.status(404).json({
        statusCode: 404,
        message: "Organizer application not found",
      });
    }

    if (organizer.status === "APPROVED") {
      return res.status(409).json({
        statusCode: 409,
        message: "Organizer is already approved",
      });
    }

    if (organizer.status === "REJECTED") {
      return res.status(409).json({
        statusCode: 409,
        message: "Rejected application cannot be approved",
      });
    }

    const unapprovedDocs = organizer.documents.filter((d) => d.status !== "APPROVED");
    if (unapprovedDocs.length > 0) {
      return res.status(409).json({
        statusCode: 409,
        message: `Cannot approve organizer. ${unapprovedDocs.length} document(s) have not been approved yet.`,
      });
    }

    const updatedOrganizer = await prisma.$transaction(async (tx) => {
      const updated = await tx.organizerProfile.update({
        where: { id },
        data: {
          status: "APPROVED",
          rejectionReason: null,
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "APPROVE",
        "OrganizerProfile",
        id,
        { organizationName: organizer.organizationName },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: "Organizer approved successfully",
      organizer: updatedOrganizer,
    });
  } catch (error) {
    console.error("Approve organizer error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const rejectOrganizer = async (req, res) => {
  const { id } = req.params;
  const rejectionReason = (req.body.rejectionReason || req.body.reason || "").trim();
  const actorId = req.user?.userId || req.user?.id;

  if (!rejectionReason) {
    return res.status(400).json({
      statusCode: 400,
      message: "Rejection reason is required",
    });
  }

  try {
    const organizer = await prisma.organizerProfile.findUnique({
      where: { id },
    });

    if (!organizer) {
      return res.status(404).json({
        statusCode: 404,
        message: "Organizer application not found",
      });
    }

    if (organizer.status === "APPROVED") {
      return res.status(409).json({
        statusCode: 409,
        message: "Approved organizer cannot be rejected",
      });
    }

    if (organizer.status === "REJECTED") {
      return res.status(409).json({
        statusCode: 409,
        message: "Organizer is already rejected",
      });
    }

    const updatedOrganizer = await prisma.$transaction(async (tx) => {
      const updated = await tx.organizerProfile.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectionReason: rejectionReason.trim(),
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "REJECT",
        "OrganizerProfile",
        id,
        {
          organizationName: organizer.organizationName,
          reason: rejectionReason.trim(),
        },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: "Organizer rejected successfully",
      organizer: updatedOrganizer,
    });
  } catch (error) {
    console.error("Reject organizer error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};
