import express from "express";
import {
  getMe,
  login,
  logout,
  register,
  updateMe,
  verifyEmail,
  forgotPassword,
  verifyForgotPassword,
  resetPassword,
  sendChangePasswordOtp,
  changePassword,
} from "../controllers/authController.js";
import { jwtMiddleware } from "../middlewares/jwtMiddleware.js";
import upload from "../middlewares/uploadMiddleware.js";

const routerAuth = express.Router();

routerAuth.post("/register", register);
routerAuth.post("/verify-email", verifyEmail);
routerAuth.post("/login", login);
routerAuth.post("/forgot-password", forgotPassword);
routerAuth.post("/verify-forgot-password", verifyForgotPassword);
routerAuth.post("/reset-password", resetPassword);

routerAuth.get("/me", jwtMiddleware, getMe);
routerAuth.get("/get-me", jwtMiddleware, getMe);
routerAuth.patch("/me", jwtMiddleware, upload.single("avatar"), updateMe);
routerAuth.patch("/update-me", jwtMiddleware, upload.single("avatar"), updateMe);

routerAuth.post("/change-password/otp", jwtMiddleware, sendChangePasswordOtp);
routerAuth.post("/change-password", jwtMiddleware, changePassword);

routerAuth.get("/logout", jwtMiddleware, logout);
routerAuth.post("/logout", jwtMiddleware, logout);

export default routerAuth;
