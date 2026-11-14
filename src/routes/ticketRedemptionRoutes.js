import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireRoles } from '../middlewares/roleMiddleware.js';
import {
  lookupTicket,
  redeemTicket,
} from '../controllers/ticketRedemptionController.js';

const router = express.Router();

router.post('/lookup', requireAuth, requireRoles('STAFF', 'ADMIN'), lookupTicket);
router.post('/redeem', requireAuth, requireRoles('STAFF', 'ADMIN'), redeemTicket);

export default router;
