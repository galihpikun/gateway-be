export class PaginationError extends Error {
  constructor() {
    super("Invalid pagination: page must be a positive integer and limit must be between 1 and 100.");
    this.statusCode = 400;
  }
}

function readInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1) throw new PaginationError();
  return value;
}

export function parsePagination(query = {}) {
  const page = readInteger(query.page, 1);
  const limit = readInteger(query.limit, 20);
  const skip = (page - 1) * limit;
  if (limit > 100 || !Number.isSafeInteger(skip)) throw new PaginationError();
  return { page, limit, skip, requested: query.page !== undefined || query.limit !== undefined };
}

export function buildPaginatedResponse(data, total, page, limit) {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
