/**
 * Envía el mail de bienvenida de negocio nuevo usando Ethereal (SMTP de prueba de Nodemailer).
 * La mascota va como adjunto inline (CID), no hace falta PUBLIC_URL ni el API levantado.
 *
 * Requisito de red: una llamada a api.nodemailer.com para crear la cuenta Ethereal.
 *
 * Uso:
 *   npm run script:email:test-welcome
 *   npm run script:email:test-welcome -- --name "Pizzería Test"
 */

import { parseArgs } from "node:util";
import { createElement } from "react";
import dayjs from "dayjs";
import "dayjs/locale/es";
import nodemailer from "nodemailer";
import { NewBusinessWelcomeEmail, renderEmailHtml } from "../../email-templates";
import { gestyMascotInlineAttachment } from "../../services/mail.service";

dayjs.locale("es");

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: "string", default: "Restaurante de prueba" },
      to: { type: "string", default: "destino-prueba@ethereal.email" },
    },
    strict: true,
    allowPositionals: false,
  });

  const trialEnd = dayjs().add(14, "day").toDate();
  const trialEndsLabel = dayjs(trialEnd).format("D [de] MMMM [de] YYYY");

  const html = await renderEmailHtml(
    createElement(NewBusinessWelcomeEmail, {
      businessName: values.name ?? "Restaurante de prueba",
      trialEndsLabel,
      tokenLimitLabel: new Intl.NumberFormat("es-AR").format(100_000),
    })
  );

  console.log("Creando cuenta Ethereal de prueba…");
  const testAccount = await nodemailer.createTestAccount();

  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  const attachments = process.env.EMAIL_MASCOT_REMOTE_URL?.trim()
    ? undefined
    : [gestyMascotInlineAttachment()];

  const info = await transporter.sendMail({
    from: `"gesty.ai (prueba)" <${testAccount.user}>`,
    to: values.to ?? "destino-prueba@ethereal.email",
    subject: `${values.name ?? "Negocio demo"} · bienvenida a gesty.ai [prueba]`,
    html,
    attachments,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log("");
  console.log("Mensaje enviado al SMTP de prueba Ethereal.");
  if (previewUrl) {
    console.log("Vista previa en el navegador:");
    console.log(previewUrl);
  } else {
    console.log(
      "No se obtuvo URL de vista previa; revisá la respuesta:",
      info.response
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
