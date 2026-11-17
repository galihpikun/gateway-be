import "dotenv/config";

export class MailService {
  static async send(email, subject, code, minutes) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL are required");
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject, text: `Your verification code is ${code}. It expires in ${minutes} minutes.` }),
    });
    if (!response.ok) throw new Error(`Resend email delivery failed (${response.status})`);
  }
  static async sendMailVerif(email, code) { return this.send(email, "Verify your email", code, 5); }
  static async sendMailForgotPasssword(email, code) { return this.send(email, "Reset your password", code, 15); }
}
export default MailService;
