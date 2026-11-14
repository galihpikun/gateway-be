import express from "express";
import {
  applyOrganizer,
  getMyOrganizerProfile,
  getOrganizerDashboard,
  getOrganizerStaff,
  getAllOrganizerApplications,
  getOrganizerDetail,
  approveDocument,
  rejectDocument,
  approveOrganizer,
  rejectOrganizer,
} from "../controllers/organizerController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = express.Router();

router.post(
  "/apply",
  jwtMiddleware,
  upload.fields([
    { name: "businessLicense", maxCount: 1 },
    { name: "guaranteeLetter", maxCount: 1 },
    { name: "organizationRegistration", maxCount: 1 },
    { name: "identityCard", maxCount: 1 },
  ]),
  applyOrganizer
);

router.get("/me", jwtMiddleware, getMyOrganizerProfile);
router.get("/dashboard", jwtMiddleware, getOrganizerDashboard);
router.get("/staff", jwtMiddleware, getOrganizerStaff);

// Admin routes (document routes before :id)
router.get("/admin", jwtMiddleware, requireAdmin, getAllOrganizerApplications);
router.patch("/admin/documents/:docId/approve", jwtMiddleware, requireAdmin, approveDocument);
router.patch("/admin/documents/:docId/reject", jwtMiddleware, requireAdmin, rejectDocument);
router.get("/admin/:id", jwtMiddleware, requireAdmin, getOrganizerDetail);
router.patch("/admin/:id/approve", jwtMiddleware, requireAdmin, approveOrganizer);
router.patch("/admin/:id/reject", jwtMiddleware, requireAdmin, rejectOrganizer);

export default router;
