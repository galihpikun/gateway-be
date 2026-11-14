import express from "express";
import {
  createOrder,
  getOrders,
  getOrderDetail,
  getAdminOrders,
  getAdminOrderDetail,
} from "../controllers/orderController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";

const router = express.Router();

router.post("/", jwtMiddleware, createOrder);

// Admin routes (before :id)
router.get("/admin", jwtMiddleware, requireAdmin, getAdminOrders);
router.get("/admin/:id", jwtMiddleware, requireAdmin, getAdminOrderDetail);

// User order routes
router.get("/", jwtMiddleware, getOrders);
router.get("/:id", jwtMiddleware, getOrderDetail);

export default router;
