import AuditLogService from '../service/auditLogService.js';

export const findAll = async (req, res, next) => {
  try {
    const result = await AuditLogService.findAll(req.query);

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
