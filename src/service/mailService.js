import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});

export class MailService {
  static async sendMailVerif(email, code) {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
      console.log(`[MailService] Simulation: Verification OTP for ${email} is ${code}`);
      return;
    }

    await transporter.sendMail({
      from: `"Festix" Galih & Randu`,
      to: email,
      subject: "Verify Your Email - Festix",
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Verify Your Email</h2>
          <p>
            Thank you for registering on Festix.
            Use the following OTP code to verify your email:
          </p>
          <h1 style="letter-spacing: 8px;">
            ${code}
          </h1>
          <p>
            This code will expire in <strong>5 minutes</strong>.
          </p>
          <p>
            If you did not create this account, you can ignore this email.
          </p>
        </div>
      `,
    });
  }

  static async sendMailForgotPasssword(email, code) {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
      console.log(`[MailService] Simulation: Password Reset OTP for ${email} is ${code}`);
      return;
    }

    await transporter.sendMail({
      from: `"Festix" Galih & Randu`,
      to: email,
      subject: "Reset Password - Festix",
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Reset Your Password</h2>
          <p>
            Thank you for registering on Festix.
            Use the following OTP code to reset your password:
          </p>
          <h1 style="letter-spacing: 8px;">
            ${code}
          </h1>
          <p>
            This code will expire in <strong>15 minutes</strong>.
          </p>
          <p>
            If you did not create this account, you can ignore this email.
          </p>
        </div>
      `,
    });
  }
}

export default MailService;
