import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const mailOptions = {
  from: process.env.EMAIL_USER,
  to: process.env.REPORT_EMAIL,
  subject: "Test Email",
  text: "Hello! This is a test from your monitoring setup.",
};

transporter.sendMail(mailOptions, (err, info) => {
  if (err) console.error("❌ Error sending test email:", err);
  else console.log("✅ Test email sent:", info.response);
});
