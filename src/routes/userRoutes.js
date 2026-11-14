import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireRoles } from '../middlewares/roleMiddleware.js';
import {
  findAll,
  findOne,
  changeRole,
  suspendUser,
  unsuspendUser,
} from '../controllers/userController.js';

const router = express.Router();

router.use(requireAuth, requireRoles('ADMIN'));

router.get('/admin', findAll);
router.get('/admin/:id', findOne);
router.patch('/admin/:id/role', changeRole);
router.patch('/admin/:id/suspend', suspendUser);
router.patch('/admin/:id/unsuspend', unsuspendUser);

export default router;
