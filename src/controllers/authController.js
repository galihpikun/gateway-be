import prisma from "../service/prisma.js";
import bcrypt from "bcrypt";
import { generateToken } from "../utils/generateToken.js";
import { checkOtp, issueOtp, normalizeOtpAddress } from "../service/otpService.js";
import CloudinaryService from "../service/cloudinaryService.js";

export const register = async (req, res) => {
  const { email, password, fullName } = req.body;

  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({
        statusCode: 400,
        message: "Belum diisi inputnya / All fields are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanFullName = fullName.trim();

    const emailExists = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (emailExists) {
      return res.status(409).json({
        statusCode: 409,
        success: false,
        message: "Email Already Exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        fullName: cleanFullName,
        email: normalizedEmail,
        password: hashedPassword,
        emailVerified: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      statusCode: 201,
      success: true,
      message: "User registered successfully",
      email: user.email,
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

function otpResponse(res, status, success, email) {
  const message = status === 200 ? success
    : status === 429 ? "Too many OTP requests or attempts. Please wait and request a new code."
      : "Invalid or expired verification code";
  return res.status(status).json({ statusCode: status, message, ...(status === 200 && email && { email }) });
}

function otpHandler(action) {
  return async (req, res) => {
    try { return await action(req, res); }
    catch {
      console.error("OTP operation failed");
      return res.status(500).json({ statusCode: 500, message: "Could not process OTP request" });
    }
  };
}

function sendOtp(type) {
  return otpHandler(async (req, res) => {
    const email = normalizeOtpAddress(req.body?.email);
    if (!email) return otpResponse(res, 400);
    const status = await issueOtp(email, type);
    return otpResponse(res, status, "If this address is eligible, a code has been sent.", email);
  });
}

function verifyOtp(type, mode, success) {
  return otpHandler(async (req, res) => {
    const { email: input, code, password } = req.body || {};
    const email = normalizeOtpAddress(input);
    if (!email || !/^[0-9]{6}$/.test(String(code)) || (mode === "reset" && (typeof password !== "string" || !password))) return otpResponse(res, 400);
    const hash = mode === "reset" ? await bcrypt.hash(password, 10) : undefined;
    const status = await checkOtp(email, type, String(code), mode, hash);
    return otpResponse(res, status, success, email);
  });
}

export const resendOtp = sendOtp("VERIFY_EMAIL");
export const verifyEmail = verifyOtp("VERIFY_EMAIL", "email", "Email verified successfully");

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      statusCode: 400,
      message: "Belum diisi inputnya / Email and password are required",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        success: false,
        message: "Invalid Email or Password",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        statusCode: 403,
        success: false,
        message: "Account suspended",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        statusCode: 401,
        success: false,
        message: "Invalid Email or Password",
      });
    }

    const token = generateToken(
      {
        id: user.id,
        sub: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      res
    );

    return res.status(200).json({
      statusCode: 200,
      success: true,
      message: "Login successful",
      access_token: token,
      token,
      role: user.role,
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const forgotPassword = sendOtp("FORGOT_PASSWORD");
export const verifyForgotPassword = verifyOtp("FORGOT_PASSWORD", "verify", "OTP verified successfully");
export const resetPassword = verifyOtp("FORGOT_PASSWORD", "reset", "Password reset successfully");

export const logout = async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  return res.status(200).json({
    statusCode: 200,
    success: true,
    message: "Berhasil logout",
  });
};

export const getMe = async (req, res) => {
  const userId = req.user.userId || req.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isSuspended: true,
        organizerProfile: { select: { status: true } },
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        statusCode: 404,
        success: false,
        message: "User tidak ditemukan",
      });
    }

    return res.status(200).json({
      message: "You are authenticated",
      data: {
        userId: user.id,
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        emailVerified: user.emailVerified,
        isSuspended: user.isSuspended,
        organizerProfile: user.organizerProfile,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const updateMe = async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { fullName, email, avatar } = req.body;

  try {
    const data = {};

    if (fullName && fullName.trim().length > 0) {
      data.fullName = fullName.trim();
    }
    if (email && email.trim().length > 0) {
      data.email = email.trim();
    }

    if (req.file) {
      const upload = await CloudinaryService.uploadImage(req.file);
      data.avatar = upload.secure_url;
    } else if (avatar) {
      data.avatar = avatar;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        avatar: true,
        role: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      message: "Profile updated successfully",
      data: {
        userId: updatedUser.id,
        id: updatedUser.id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const sendChangePasswordOtp = otpHandler(async (req, res) => {
  const status = await issueOtp(req.user.email, "FORGOT_PASSWORD");
  return otpResponse(res, status, "If this address is eligible, a code has been sent.", req.user.email);
});

export const changePassword = async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { currentPassword, newPassword, otpCode } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        message: "User not found",
      });
    }

    if (currentPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({
          statusCode: 401,
          message: "Current password is incorrect",
        });
      }

      const newHashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: newHashed },
      });

      return res.status(200).json({
        statusCode: 200,
        message: "Password changed successfully",
      });
    }

    if (otpCode) {
      if (!/^[0-9]{6}$/.test(String(otpCode)) || typeof newPassword !== "string" || !newPassword) return otpResponse(res, 400);
      const newHashed = await bcrypt.hash(newPassword, 10);
      const status = await checkOtp(user.email, "FORGOT_PASSWORD", String(otpCode), "change", newHashed);
      return otpResponse(res, status, "Password changed successfully with OTP verification");
    }

    return res.status(409).json({
      statusCode: 409,
      message: "Please provide either your current password or an OTP verification code",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};
