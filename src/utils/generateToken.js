import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const generateToken = (params, res) => {
  const userId = params.id || params.userId || params.sub;
  const payload = {
    sub: userId,
    id: userId,
    email: params.email,
    role: params.role,
    ...(params.username && { username: params.username }),
    ...(params.fullName && { fullName: params.fullName }),
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET || "default_jwt_secret", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

  if (res && typeof res.cookie === "function") {
    res.cookie("jwt", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }

  return token;
};

export default generateToken;
