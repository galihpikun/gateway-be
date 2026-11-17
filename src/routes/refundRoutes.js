import express from "express";
import {
  createRefund,
  getMyRefunds,
  getOrganizerRefunds,
  getRefundDetail,
  getAdminRefunds,
  getAdminRefundDetail,
  approveRefund,
  rejectRefund,
  handleRefundWebhook,
} from "../controllers/refundController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";

const router = express.Router();

// Webhook
router.post("/webhook", handleRefundWebhook);

// Customer routes
router.post("/", jwtMiddleware, createRefund);
router.get("/my", jwtMiddleware, getMyRefunds);
router.get("/organizer", jwtMiddleware, getOrganizerRefunds);

// Admin routes (placed before customer :id to avoid route collision)
router.get("/admin", jwtMiddleware, requireAdmin, getAdminRefunds);
router.get("/admin/:id", jwtMiddleware, requireAdmin, getAdminRefundDetail);
router.patch("/admin/:id/approve", jwtMiddleware, requireAdmin, approveRefund);
router.patch("/admin/:id/reject", jwtMiddleware, requireAdmin, rejectRefund);

// Customer detail route
router.get("/:id", jwtMiddleware, getRefundDetail);

export default router;
