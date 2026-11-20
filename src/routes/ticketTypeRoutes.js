import express from "express";
import {
  getTicketTypes,
  getTicketTypeDetail,
  createTicketType,
  updateTicketType,
  deleteTicketType,
} from "../controllers/ticketTypeController.js";
import { jwtMiddleware, optionalAuth } from "../middlewares/jwtMiddleware.js";

const router = express.Router();

router.get("/event/:eventId", optionalAuth, getTicketTypes);
router.get("/:id", optionalAuth, getTicketTypeDetail);

router.post("/event/:eventId", jwtMiddleware, createTicketType);
router.put("/:id", jwtMiddleware, updateTicketType);
router.delete("/:id", jwtMiddleware, deleteTicketType);

export default router;
