import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireRoles } from '../middlewares/roleMiddleware.js';
import { getDashboardData } from '../controllers/adminDashboardController.js';

const router = express.Router();

router.get('/', requireAuth, requireRoles('ADMIN'), getDashboardData);

export default router;
