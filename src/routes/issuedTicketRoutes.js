import express from "express";
import {
  getMyTickets,
  getTicketDetail,
  getAdminTickets,
  getAdminTicketDetail,
} from "../controllers/issuedTicketController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";

const router = express.Router();

router.get("/my", jwtMiddleware, getMyTickets);

// Admin routes (before :id)
router.get("/admin", jwtMiddleware, requireAdmin, getAdminTickets);
router.get("/admin/:id", jwtMiddleware, requireAdmin, getAdminTicketDetail);

// Single ticket detail
router.get("/:id", jwtMiddleware, getTicketDetail);

export default router;
