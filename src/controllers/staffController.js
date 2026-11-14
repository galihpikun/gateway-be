import prisma from '../service/prisma.js';
import AuditLogService from '../service/auditLogService.js';
import { buildPaginatedResponse } from '../utils/paginate.js';

export const getAssignedEvents = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const assignments = await prisma.eventStaff.findMany({
      where: { userId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            coverImageUrl: true,
            status: true,
            location: true,
            startDatetime: true,
            endDatetime: true,
          },
        },
      },
      orderBy: {
        event: {
          startDatetime: 'asc',
        },
      },
    });

    const eventIds = assignments.map((assignment) => assignment.event.id);

    if (eventIds.length === 0) {
      return res.status(200).json([]);
    }

    const countsByEventId = new Map();

    await Promise.all(
      eventIds.map(async (eventId) => {
        const [totalParticipants, totalRedeemed] = await Promise.all([
          prisma.issuedTicket.count({
            where: {
              isCancelled: false,
              orderItem: {
                ticketType: { eventId },
                order: { paymentStatus: 'PAID' },
              },
            },
          }),
          prisma.issuedTicket.count({
            where: {
              isCancelled: false,
              isRedeemed: true,
              orderItem: {
                ticketType: { eventId },
                order: { paymentStatus: 'PAID' },
              },
            },
          }),
        ]);
        countsByEventId.set(eventId, { totalParticipants, totalRedeemed });
      })
    );

    const now = new Date();

    const result = assignments.map((assignment) => {
      const event = assignment.event;
      const counts = countsByEventId.get(event.id) ?? {
        totalParticipants: 0,
        totalRedeemed: 0,
      };

      const isActive =
        event.status === 'PUBLISHED' &&
        now >= new Date(event.startDatetime) &&
        now <= new Date(event.endDatetime);

      return {
        id: event.id,
        title: event.title,
        coverImageUrl: event.coverImageUrl,
        status: event.status,
        location: event.location,
        startDatetime: event.startDatetime,
        endDatetime: event.endDatetime,
        isActive,
        assignedAt: assignment.createdAt,
        participantSummary: counts,
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getEventDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        location: true,
        status: true,
        startDatetime: true,
        endDatetime: true,
      },
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const staffAssignment = await prisma.eventStaff.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (!staffAssignment) {
      return res.status(403).json({ message: 'You are not assigned to this event' });
    }

    const [totalValid, totalRedeemed, recentRedemptions] = await Promise.all([
      prisma.issuedTicket.count({
        where: {
          isCancelled: false,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: 'PAID' },
          },
        },
      }),
      prisma.issuedTicket.count({
        where: {
          isCancelled: false,
          isRedeemed: true,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: 'PAID' },
          },
        },
      }),
      prisma.issuedTicket.findMany({
        where: {
          isCancelled: false,
          isRedeemed: true,
          orderItem: {
            ticketType: { eventId },
            order: { paymentStatus: 'PAID' },
          },
        },
        select: {
          id: true,
          ticketCode: true,
          redeemedAt: true,
          orderItem: {
            select: {
              ticketType: {
                select: {
                  name: true,
                },
              },
              order: {
                select: {
                  user: {
                    select: {
                      fullName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          redeemedAt: 'desc',
        },
        take: 5,
      }),
    ]);

    const remainingTickets = Math.max(0, totalValid - totalRedeemed);
    const redemptionRate =
      totalValid > 0
        ? Number(((totalRedeemed / totalValid) * 100).toFixed(2))
        : 0;

    const now = new Date();
    const isActive =
      event.status === 'PUBLISHED' &&
      now >= new Date(event.startDatetime) &&
      now <= new Date(event.endDatetime);

    return res.status(200).json({
      event: {
        id: event.id,
        title: event.title,
        status: event.status,
        location: event.location,
        startDatetime: event.startDatetime,
        endDatetime: event.endDatetime,
        isActive,
      },
      statistics: {
        totalParticipants: totalValid,
        totalRedeemed,
        remainingTickets,
        redemptionRate,
      },
      recentRedemptions: recentRedemptions.map((ticket) => ({
        id: ticket.id,
        ticketCode: ticket.ticketCode,
        ticketType: ticket.orderItem.ticketType.name,
        buyerName: ticket.orderItem.order.user.fullName,
        redeemedAt: ticket.redeemedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
};

export const findAllStaff = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const where = {
      role: 'STAFF',
    };

    if (req.query.search) {
      where.OR = [
        { fullName: { contains: req.query.search, mode: 'insensitive' } },
        { email: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [staffUsers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          avatar: true,
          role: true,
          emailVerified: true,
          isSuspended: true,
          createdAt: true,
          _count: {
            select: {
              assignedEvents: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(staffUsers, total, page, limit));
  } catch (err) {
    next(err);
  }
};

export const findStaffDetail = async (req, res, next) => {
  try {
    const { id } = req.params;

    const staff = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isSuspended: true,
        createdAt: true,
        assignedEvents: {
          include: {
            event: {
              select: {
                id: true,
                title: true,
                location: true,
                startDatetime: true,
                endDatetime: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!staff) {
      return res.status(404).json({ message: 'Staff user not found' });
    }

    if (staff.role !== 'STAFF') {
      return res.status(400).json({ message: 'User does not have the STAFF role' });
    }

    return res.status(200).json(staff);
  } catch (err) {
    next(err);
  }
};

export const getStaffForEvent = async (req, res, next) => {
  try {
    const { eventId } = req.params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const staff = await prisma.eventStaff.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json(staff);
  } catch (err) {
    next(err);
  }
};

export const assignStaff = async (req, res, next) => {
  try {
    const { userId, eventId } = req.body;
    const actorId = req.user.id;

    if (!userId || !eventId) {
      return res.status(400).json({ message: 'userId and eventId are required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'STAFF') {
      return res.status(400).json({ message: 'User must have the STAFF role to be assigned to events' });
    }

    if (user.isSuspended) {
      return res.status(400).json({ message: 'Cannot assign a suspended staff member' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const existing = await prisma.eventStaff.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
    });

    if (existing) {
      return res.status(409).json({ message: 'Staff member is already assigned to this event' });
    }

    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.eventStaff.create({
        data: {
          eventId,
          userId,
        },
        include: {
          event: {
            select: { id: true, title: true },
          },
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        'ASSIGN_STAFF',
        'EventStaff',
        created.id,
        {
          eventId,
          eventTitle: event.title,
          userId,
          staffName: user.fullName,
        },
        tx
      );

      return created;
    });

    return res.status(201).json({
      message: 'Staff assigned to event successfully',
      assignment,
    });
  } catch (err) {
    next(err);
  }
};

export const removeAssignment = async (req, res, next) => {
  try {
    const { id: assignmentId } = req.params;
    const actorId = req.user.id;

    const assignment = await prisma.eventStaff.findUnique({
      where: { id: assignmentId },
      include: {
        event: { select: { title: true } },
        user: { select: { fullName: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({ message: 'Staff assignment not found' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.eventStaff.delete({
        where: { id: assignmentId },
      });

      await AuditLogService.log(
        actorId ?? null,
        'REMOVE_STAFF',
        'EventStaff',
        assignmentId,
        {
          eventId: assignment.eventId,
          eventTitle: assignment.event.title,
          userId: assignment.userId,
          staffName: assignment.user.fullName,
        },
        tx
      );
    });

    return res.status(200).json({
      message: 'Staff assignment removed successfully',
    });
  } catch (err) {
    next(err);
  }
};
