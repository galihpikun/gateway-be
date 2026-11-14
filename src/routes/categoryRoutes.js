import express from "express";
import {
  getCategories,
  createCategory,
  editCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import { requireAdmin } from "../middlewares/roleMiddleware.js";

const router = express.Router();

router.get("/", getCategories);
router.post("/", jwtMiddleware, requireAdmin, createCategory);
router.put("/:id", jwtMiddleware, requireAdmin, editCategory);
router.delete("/:id", jwtMiddleware, requireAdmin, deleteCategory);

export default router;
