import express from "express";
import {
  getEvents,
  getMostPopularEvents,
  eventDetail,
  createEvent,
  updateEvent,
  submitEvent,
  completeEvent,
  getAdminEvents,
  getAdminEventDetail,
  approveEvent,
  rejectEvent,
  cancelEvent,
  getMyEvents,
  getOrganizerEventDetail,
  getOrganizerEventCheckin,
  removeOrganizerStaff,
  searchInvitableUsers,
} from "../controllers/eventController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getEvents);
router.get("/most-popular", getMostPopularEvents);

// Admin routes (MUST be defined before :id)
router.get("/admin", jwtMiddleware, requireAdmin, getAdminEvents);
router.get("/admin/:id", jwtMiddleware, requireAdmin, getAdminEventDetail);
router.patch("/admin/:id/approve", jwtMiddleware, requireAdmin, approveEvent);
router.patch("/admin/:id/reject", jwtMiddleware, requireAdmin, rejectEvent);
router.patch("/admin/:id/cancel", jwtMiddleware, requireAdmin, cancelEvent);

// Organizer routes (MUST be defined before :id)
router.get("/organizer/my-events", jwtMiddleware, getMyEvents);
router.get("/organizer/:id/checkin", jwtMiddleware, getOrganizerEventCheckin);
router.delete("/organizer/:eventId/staff/:assignmentId", jwtMiddleware, removeOrganizerStaff);
router.get("/organizer/:id", jwtMiddleware, getOrganizerEventDetail);
router.get("/search-invitable-users", jwtMiddleware, searchInvitableUsers);

// Create event
router.post(
  "/",
  jwtMiddleware,
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "venueImage", maxCount: 1 },
  ]),
  createEvent
);

// Public event detail
router.get("/:id", eventDetail);

// Organizer actions on event by id
router.patch(
  "/:id",
  jwtMiddleware,
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "venueImage", maxCount: 1 },
  ]),
  updateEvent
);
router.patch("/:id/submit", jwtMiddleware, submitEvent);
router.patch("/:id/complete", jwtMiddleware, completeEvent);

export default router;
