import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireRoles } from '../middlewares/roleMiddleware.js';
import {
  getAssignedEvents,
  getEventDashboard,
  findAllStaff,
  getStaffForEvent,
  findStaffDetail,
  assignStaff,
  removeAssignment,
} from '../controllers/staffController.js';

const router = express.Router();

router.use(requireAuth);

// STAFF routes
router.get('/events', requireRoles('STAFF'), getAssignedEvents);
router.get('/events/:eventId/dashboard', requireRoles('STAFF'), getEventDashboard);

// ADMIN routes
router.get('/admin', requireRoles('ADMIN'), findAllStaff);
router.get('/admin/event/:eventId', requireRoles('ADMIN'), getStaffForEvent);
router.post('/admin/assign', requireRoles('ADMIN'), assignStaff);
router.delete('/admin/assign/:id', requireRoles('ADMIN'), removeAssignment);
router.get('/admin/:id', requireRoles('ADMIN'), findStaffDetail);

export default router;
