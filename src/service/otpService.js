import bcrypt from "bcrypt";
import { randomInt } from "node:crypto";
import prisma, { Prisma } from "./prisma.js";
import MailService from "./mailService.js";

const cooldownMs = 60_000;
const maxFailures = 5;

export function normalizeOtpAddress(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function forAddress(identifier, type, action) {
  const key = "gateway:otp:" + type + ":" + identifier;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`);
    const latest = await tx.otp.findFirst({ where: { identifier, type }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return action(tx, latest);
  });
}

export async function issueOtp(identifier, type) {
  const result = await forAddress(identifier, type, async (tx, latest) => {
    const now = new Date();
    if (latest && now - latest.createdAt < cooldownMs) return { status: 429 };
    const user = await tx.user.findUnique({
      where: { email: identifier }, select: { id: true, emailVerified: true, isSuspended: true },
    });
    const eligible = user && !user.isSuspended && (type !== "VERIFY_EMAIL" || !user.emailVerified);
    const code = randomInt(100000, 1000000).toString();
    const encoded = await bcrypt.hash(code, 10);
    const expiresAt = new Date(now.getTime() + (type === "VERIFY_EMAIL" ? 5 : 15) * 60_000);
    await tx.otp.updateMany({ where: { identifier, type, isUsed: false }, data: { isUsed: true } });
    const data = { identifier, type, code: encoded, ...(eligible && { userId: user.id }), createdAt: now, expiresAt };
    // A single cover record gives unregistered addresses the same cooldown behavior.
    if (!eligible && latest?.userId === null) {
      await tx.otp.update({ where: { id: latest.id }, data: { ...data, isUsed: false, verifiedAt: null } });
    } else {
      await tx.otp.create({ data });
    }
    return { status: 200, ...(eligible && { code }) };
  });

  if (result.code) {
    try {
      if (type === "VERIFY_EMAIL") await MailService.sendMailVerif(identifier, result.code);
      else await MailService.sendMailForgotPasssword(identifier, result.code);
    } catch {
      // Do not disclose account eligibility or provider errors through public OTP endpoints.
      console.warn("OTP delivery failed");
    }
  }
  return result.status;
}

export function checkOtp(identifier, type, candidate, mode, newPassword) {
  return forAddress(identifier, type, async (tx, otp) => {
    if (!otp || otp.expiresAt <= new Date()) return 400;
    const [hash, attempts = "0"] = otp.code.split(":");
    const failures = Number(attempts);
    if (failures >= maxFailures) return 429;
    if (otp.isUsed || (mode === "reset" && !otp.verifiedAt) || (mode === "verify" && otp.verifiedAt)) return 400;

    const matches = await bcrypt.compare(candidate, hash);
    const where = { id: otp.id, code: otp.code, isUsed: false, expiresAt: { gt: new Date() } };
    if (!matches || !otp.userId) {
      const count = failures + 1;
      const result = await tx.otp.updateMany({ where, data: { code: hash + ":" + count, isUsed: count >= maxFailures } });
      return result.count && count >= maxFailures ? 429 : 400;
    }

    if (mode === "verify") {
      const result = await tx.otp.updateMany({ where: { ...where, verifiedAt: null }, data: { verifiedAt: new Date() } });
      return result.count === 1 ? 200 : 400;
    }

    const result = await tx.otp.updateMany({ where, data: { isUsed: true } });
    if (result.count !== 1) return 400;
    await tx.user.update({
      where: { id: otp.userId },
      data: mode === "email" ? { emailVerified: true } : { password: newPassword },
    });
    return 200;
  });
}
