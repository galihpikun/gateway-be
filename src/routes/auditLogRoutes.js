import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireRoles } from '../middlewares/roleMiddleware.js';
import { findAll, findOne } from '../controllers/auditLogController.js';

const router = express.Router();

router.use(requireAuth, requireRoles('ADMIN'));

router.get('/admin', findAll);
router.get('/admin/:id', findOne);

export default router;
