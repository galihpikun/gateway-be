import prisma from '../service/prisma.js';
import AuditLogService from '../service/auditLogService.js';
import { buildPaginatedResponse, parsePagination } from '../utils/paginate.js';

export const findAll = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const where = {};

    if (req.query.role) {
      where.role = req.query.role;
    }

    if (req.query.isSuspended !== undefined) {
      where.isSuspended = req.query.isSuspended === 'true';
    }

    if (req.query.search) {
      where.OR = [
        { fullName: { contains: req.query.search, mode: 'insensitive' } },
        { email: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
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
          suspendedAt: true,
          suspendReason: true,
          createdAt: true,
          updatedAt: true,
          organizerProfile: {
            select: {
              id: true,
              organizationName: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json(buildPaginatedResponse(users, total, page, limit));
  } catch (err) {
    next(err);
  }
};

export const findOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isSuspended: true,
        suspendedAt: true,
        suspendReason: true,
        createdAt: true,
        updatedAt: true,
        organizerProfile: {
          select: {
            id: true,
            organizationName: true,
            status: true,
            phoneNumber: true,
          },
        },
        _count: {
          select: {
            events: true,
            orders: true,
            assignedEvents: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

export const changeRole = async (req, res, next) => {
  try {
    const { id: userId } = req.params;
    const { role } = req.body;
    const currentAdminId = req.user.id;

    if (!role) {
      return res.status(400).json({ message: 'role is required' });
    }

    if (userId === currentAdminId) {
      return res.status(403).json({ message: 'You cannot change your own role' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === role) {
      return res.status(409).json({ message: `User is already in role ${role}` });
    }

    // If demoting an ADMIN, ensure at least one other ADMIN remains
    if (user.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' },
      });

      if (adminCount <= 1) {
        return res.status(403).json({
          message:
            'Cannot demote the last administrator. The system must have at least one active administrator.',
        });
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { role },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
        },
      });

      await AuditLogService.log(
        currentAdminId,
        'CHANGE_ROLE',
        'User',
        userId,
        {
          previousRole: user.role,
          newRole: role,
        },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: `User role updated to ${role}`,
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export const suspendUser = async (req, res, next) => {
  try {
    const { id: userId } = req.params;
    const { reason } = req.body;
    const currentAdminId = req.user.id;

    if (userId === currentAdminId) {
      return res.status(403).json({ message: 'You cannot suspend your own account' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Suspension reason is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isSuspended) {
      return res.status(409).json({ message: 'User is already suspended' });
    }

    if (user.role === 'ADMIN') {
      return res.status(403).json({ message: 'Cannot suspend an administrator account' });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          isSuspended: true,
          suspendedAt: new Date(),
          suspendReason: reason.trim(),
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          isSuspended: true,
          suspendedAt: true,
          suspendReason: true,
        },
      });

      await AuditLogService.log(
        currentAdminId,
        'SUSPEND',
        'User',
        userId,
        {
          reason: reason.trim(),
        },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: 'User suspended successfully',
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export const unsuspendUser = async (req, res, next) => {
  try {
    const { id: userId } = req.params;
    const currentAdminId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.isSuspended) {
      return res.status(409).json({ message: 'User is not suspended' });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          isSuspended: false,
          suspendedAt: null,
          suspendReason: null,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          isSuspended: true,
        },
      });

      await AuditLogService.log(
        currentAdminId,
        'UNSUSPEND',
        'User',
        userId,
        {},
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: 'User unsuspended successfully',
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};
