import nodemailer from "nodemailer";
import { EMAIL_CONFIG } from "../config.js";

function createTransporter() {
  return nodemailer.createTransport({
    service: EMAIL_CONFIG.service,
    auth: {
      user: EMAIL_CONFIG.user,
      pass: EMAIL_CONFIG.pass,
    },
  });
}

export async function sendAlertEmail(to, subject, htmlBody) {
  try {
    if (!to || !subject || !htmlBody) {
      console.warn("⚠️ [ALERT EMAIL] Missing required fields — skipping send");
      return;
    }

    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `SiteLens Alerts <${EMAIL_CONFIG.user}>`,
      to,
      subject,
      html: htmlBody,
    });

    console.log(`📧 [ALERT EMAIL] Sent to ${to} | messageId: ${info.messageId}`);
  } catch (err) {
    console.error(`❌ [ALERT EMAIL] Failed to send to ${to}: ${err.message}`);
  }
}
