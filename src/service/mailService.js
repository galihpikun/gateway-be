import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
  connectionTimeout: 3000,
  greetingTimeout: 3000,
  socketTimeout: 4000,
});

export class MailService {
  static async sendMailVerif(email, code) {
    // 1. ALWAYS print OTP prominently to console for instant local development & testing
    console.log(`\n===================================================================`);
    console.log(`[Festix AUTH OTP] Email Verification Code`);
    console.log(`Target Email : ${email}`);
    console.log(`OTP Code     : ${code}`);
    console.log(`Expires In   : 5 Minutes`);
    console.log(`===================================================================\n`);

    if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
      console.log(`[MailService] Simulation: Verification OTP for ${email} is ${code}`);
      return;
    }

    // 2. Dispatch email asynchronously (non-blocking) so HTTP responses never hang or timeout
    try {
      transporter
        .sendMail({
          from: `"Festix" <${process.env.MAIL_USER}>`,
          to: email,
          subject: "Verify Your Email - Festix",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
              <h2 style="color: #070606; margin-bottom: 12px;">Verify Your Email</h2>
              <p style="color: #555; font-size: 14px; line-height: 1.5;">
                Thank you for registering on Festix. Use the following OTP code to verify your email address:
              </p>
              <div style="background: #ece6db; padding: 16px; text-align: center; margin: 20px 0; border: 1px solid #070606;">
                <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #070606;">${code}</span>
              </div>
              <p style="color: #888; font-size: 12px;">This code will expire in <strong>5 minutes</strong>.</p>
              <p style="color: #888; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
            </div>
          `,
        })
        .then(() => {
          console.log(`[MailService] Verification email successfully dispatched to ${email}`);
        })
        .catch((err) => {
          console.warn(`[MailService WARNING] SMTP send failed (${err.message}). Use the console OTP above.`);
        });
    } catch (err) {
      console.warn(`[MailService WARNING] Failed to initiate email send: ${err.message}`);
    }
  }

  static async sendMailForgotPasssword(email, code) {
    // 1. ALWAYS print OTP prominently to console
    console.log(`\n===================================================================`);
    console.log(`[Festix AUTH OTP] Password Reset Code`);
    console.log(`Target Email : ${email}`);
    console.log(`OTP Code     : ${code}`);
    console.log(`Expires In   : 15 Minutes`);
    console.log(`===================================================================\n`);

    if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
      console.log(`[MailService] Simulation: Password Reset OTP for ${email} is ${code}`);
      return;
    }

    // 2. Dispatch email asynchronously (non-blocking)
    try {
      transporter
        .sendMail({
          from: `"Festix" <${process.env.MAIL_USER}>`,
          to: email,
          subject: "Reset Password - Festix",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
              <h2 style="color: #070606; margin-bottom: 12px;">Reset Your Password</h2>
              <p style="color: #555; font-size: 14px; line-height: 1.5;">
                We received a request to reset your password. Use the following OTP code to proceed:
              </p>
              <div style="background: #ece6db; padding: 16px; text-align: center; margin: 20px 0; border: 1px solid #070606;">
                <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #070606;">${code}</span>
              </div>
              <p style="color: #888; font-size: 12px;">This code will expire in <strong>15 minutes</strong>.</p>
              <p style="color: #888; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
            </div>
          `,
        })
        .then(() => {
          console.log(`[MailService] Password reset email successfully dispatched to ${email}`);
        })
        .catch((err) => {
          console.warn(`[MailService WARNING] SMTP send failed (${err.message}). Use the console OTP above.`);
        });
    } catch (err) {
      console.warn(`[MailService WARNING] Failed to initiate email send: ${err.message}`);
    }
  }
}

export default MailService;
