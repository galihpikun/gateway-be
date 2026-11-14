import AuditLogService from '../service/auditLogService.js';

export const findAll = async (req, res, next) => {
  try {
    const { page, limit, search, action, entityType, actorId, dateFrom, dateTo } = req.query;

    const result = await AuditLogService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      action,
      entityType,
      actorId,
      dateFrom,
      dateTo,
    });

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const findOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    const log = await AuditLogService.findOne(id);

    if (!log) {
      return res.status(404).json({ message: 'Audit log not found' });
    }

    return res.status(200).json(log);
  } catch (err) {
    next(err);
  }
};
