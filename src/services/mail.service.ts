import path from "path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { GESTY_MASCOT_CONTENT_ID } from "../email-templates/emailAssets";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new Error("SMTP_HOST no está configurado");
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER != null && process.env.SMTP_USER !== ""
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS ?? "",
          }
        : undefined,
  });
  return transporter;
}

/** Adjunto inline para la mascota; el HTML debe usar `src="cid:${GESTY_MASCOT_CONTENT_ID}"`. */
export function gestyMascotInlineAttachment(): NonNullable<
  SendMailOptions["attachments"]
>[number] {
  return {
    filename: "gesty-face.png",
    path: path.join(process.cwd(), "public", "images", "gesty-face.png"),
    cid: GESTY_MASCOT_CONTENT_ID,
  };
}

export async function sendHtmlEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: SendMailOptions["attachments"];
}): Promise<void> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    throw new Error("MAIL_FROM no está configurado");
  }
  await getTransporter().sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    attachments: params.attachments,
  });
}
