import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import prisma from "../service/prisma.js";

dotenv.config();

export async function jwtMiddleware(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (authHeader) {
    token = authHeader;
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({
      statusCode: 401,
      message: "Token tidak ditemukan, akses ditolak",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret");
    const userId = decoded.sub || decoded.id;

    if (!userId) {
      return res.status(401).json({
        statusCode: 401,
        message: "Token tidak valid, akses ditolak",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isSuspended: true,
        fullName: true,
        avatar: true,
      },
    });

    if (!user) {
      return res.status(403).json({
        statusCode: 403,
        message: "User not found",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        statusCode: 403,
        message: "Account suspended",
      });
    }

    req.user = {
      userId: user.id,
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      avatar: user.avatar,
      isSuspended: user.isSuspended,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      statusCode: 401,
      message: "Token tidak valid, akses ditolak",
    });
  }
}

export const requireAuth = jwtMiddleware;
export default jwtMiddleware;
