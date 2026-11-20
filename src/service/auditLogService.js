import prisma from "./prisma.js";
import { buildPaginatedResponse, parsePagination } from "../utils/paginate.js";

export class AuditLogService {
  static async log(actorId, action, entityType, entityId, metadata, tx) {
    const client = tx || prisma;
    return client.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        metadata: metadata ?? undefined,
      },
    });
  }

  static async findAll(query) {
    const { page, limit, skip } = parsePagination(query);

    const where = {};

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.actorId) {
      where.actorId = query.actorId;
    }

    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { entityType: { contains: query.search, mode: "insensitive" } },
        { entityId: { contains: query.search, mode: "insensitive" } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = new Date(query.dateTo);
      }
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, page, limit);
  }

  static async findOne(id) {
    return prisma.auditLog.findUnique({ where: { id } });
  }
}

export default AuditLogService;
