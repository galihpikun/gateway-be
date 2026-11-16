import prisma from "../service/prisma.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { generateToken } from "../utils/generateToken.js";
import MailService from "../service/mailService.js";
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

export const verifyEmail = async (req, res) => {
  const { email, code } = req.body;

  try {
    if (!email || !code) {
      return res.status(400).json({
        statusCode: 400,
        message: "Email and code are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        message: "Invalid Email or Code",
      });
    }

    if (user.emailVerified) {
      return res.status(409).json({
        statusCode: 409,
        message: "Email Already Verified",
      });
    }

    const otp = await prisma.otp.findFirst({
      where: {
        userId: user.id,
        identifier: user.email,
        type: "VERIFY_EMAIL",
        isUsed: false,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!otp) {
      return res.status(401).json({
        statusCode: 401,
        message: "Invalid Email or Code",
      });
    }

    if (new Date(otp.expiresAt) < new Date()) {
      return res.status(401).json({
        statusCode: 401,
        message: "Verification code has expired",
      });
    }

    const isValid = await bcrypt.compare(String(code), otp.code);
    if (!isValid) {
      return res.status(401).json({
        statusCode: 401,
        message: "Invalid verification code",
      });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      }),
      prisma.otp.update({
        where: { id: otp.id },
        data: { isUsed: true },
      }),
    ]);

    return res.status(200).json({
      statusCode: 200,
      message: `Email ${user.email} verified successfully`,
    });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const resendOtp = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({
        statusCode: 400,
        message: "Email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({
        statusCode: 404,
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        statusCode: 400,
        message: "Email is already verified",
      });
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(code, 10);

    await prisma.otp.create({
      data: {
        userId: user.id,
        identifier: user.email,
        code: otpHash,
        type: "VERIFY_EMAIL",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    try {
      await MailService.sendMailVerif(user.email, code);
    } catch (mailErr) {
      console.warn("[Resend OTP Warning] MailService delivery:", mailErr.message);
    }

    return res.status(200).json({
      statusCode: 200,
      success: true,
      message: "New verification code has been dispatched",
      email: user.email,
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

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

    // Auto-heal any existing unverified accounts so they authenticate immediately
    if (!user.emailVerified) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { emailVerified: true },
        })
        .catch(() => {});
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

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({
        statusCode: 400,
        message: "Email is required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        message: "Email not Found",
      });
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(code, 10);

    await prisma.otp.create({
      data: {
        userId: user.id,
        identifier: user.email,
        code: otpHash,
        type: "FORGOT_PASSWORD",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
      },
    });

    await MailService.sendMailForgotPasssword(user.email, code);

    return res.status(200).json({
      statusCode: 200,
      message: "OTP Code has been sent to reset your password!",
      email: user.email,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const verifyForgotPassword = async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        message: "Email not Found",
      });
    }

    const otp = await prisma.otp.findFirst({
      where: {
        userId: user.id,
        identifier: user.email,
        type: "FORGOT_PASSWORD",
        isUsed: false,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!otp) {
      return res.status(401).json({
        statusCode: 401,
        message: "Invalid Email or Code",
      });
    }

    if (new Date(otp.expiresAt) < new Date()) {
      return res.status(401).json({
        statusCode: 401,
        message: "Verification Code Has Expired, please request a new one",
      });
    }

    const isValid = await bcrypt.compare(String(code), otp.code);
    if (!isValid) {
      return res.status(401).json({
        statusCode: 401,
        message: "Invalid OTP",
      });
    }

    await prisma.otp.update({
      where: { id: otp.id },
      data: { verifiedAt: new Date() },
    });

    return res.status(200).json({
      statusCode: 200,
      message: "OTP verified successfully",
      email: user.email,
    });
  } catch (error) {
    console.error("Verify forgot password error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const resetPassword = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        statusCode: 401,
        message: "Email not Found",
      });
    }

    const otp = await prisma.otp.findFirst({
      where: {
        userId: user.id,
        identifier: user.email,
        type: "FORGOT_PASSWORD",
        isUsed: false,
        verifiedAt: { not: null },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!otp) {
      return res.status(401).json({
        statusCode: 401,
        message: "Please verify the OTP before resetting your password",
      });
    }

    if (new Date(otp.expiresAt) < new Date()) {
      return res.status(401).json({
        statusCode: 401,
        message: "Verification session has expired, please request a new OTP",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      prisma.otp.update({
        where: { id: otp.id },
        data: { isUsed: true },
      }),
    ]);

    return res.status(200).json({
      statusCode: 200,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

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

export const sendChangePasswordOtp = async (req, res) => {
  const userId = req.user.userId || req.user.id;

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

    const code = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(code, 10);

    await prisma.otp.create({
      data: {
        userId: user.id,
        identifier: user.email,
        code: otpHash,
        type: "FORGOT_PASSWORD",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    await MailService.sendMailForgotPasssword(user.email, code);

    return res.status(200).json({
      statusCode: 200,
      message: "OTP Code has been sent to your email address",
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

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
      const otp = await prisma.otp.findFirst({
        where: {
          userId: user.id,
          identifier: user.email,
          type: "FORGOT_PASSWORD",
          isUsed: false,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otp) {
        return res.status(401).json({
          statusCode: 401,
          message: "Invalid or expired OTP code",
        });
      }

      if (new Date(otp.expiresAt) < new Date()) {
        return res.status(401).json({
          statusCode: 401,
          message: "Verification Code Has Expired, please request a new one",
        });
      }

      const isValid = await bcrypt.compare(String(otpCode), otp.code);
      if (!isValid) {
        return res.status(401).json({
          statusCode: 401,
          message: "Invalid OTP code",
        });
      }

      const newHashed = await bcrypt.hash(newPassword, 10);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { password: newHashed },
        }),
        prisma.otp.update({
          where: { id: otp.id },
          data: { isUsed: true, verifiedAt: new Date() },
        }),
      ]);

      return res.status(200).json({
        statusCode: 200,
        message: "Password changed successfully with OTP verification",
      });
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
