import nodemailer from "nodemailer";

let _transporter = null;

export function isEmailReady() {
  return !!(process.env.EMAIL_ADDRESS && process.env.EMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!isEmailReady()) throw new Error("אימייל לא מוגדר. הוסף EMAIL_ADDRESS ו-EMAIL_APP_PASSWORD ל-.env");
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_ADDRESS,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

export async function sendEmail({ to, subject, body, replyTo, attachments = [] }) {
  const transporter = getTransporter();
  const from = process.env.EMAIL_ADDRESS;

  const isHtml = body.trim().startsWith("<");

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "WhatsApp Agent"}" <${from}>`,
    to,
    subject,
    text: isHtml ? body.replace(/<[^>]+>/g, "") : body,
    html: isHtml ? body : body.replace(/\n/g, "<br>"),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
  });

  return { success: true, to, subject };
}

export async function verifyEmailConfig() {
  const transporter = getTransporter();
  await transporter.verify();
  return true;
}
