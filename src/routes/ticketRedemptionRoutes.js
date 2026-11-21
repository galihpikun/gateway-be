import express from 'express';
import { requireAuth } from '../middlewares/jwtMiddleware.js';
import { requireStaff } from '../middlewares/roleMiddleware.js';
import {
  lookupTicket,
  redeemTicket,
} from '../controllers/ticketRedemptionController.js';

const router = express.Router();

router.use(requireAuth, requireStaff);
router.post('/lookup', lookupTicket);
router.post('/redeem', redeemTicket);

export default router;
