/**
 * Alta manual de un negocio con suscripción al plan `trial` y correo de bienvenida opcional.
 *
 * Uso:
 *   npx ts-node -r dotenv/config src/scripts/business/createBusinessWithTrial.ts --name "Mi local" --notify socio@mail.com
 *
 * Variables:
 *   MANUAL_TRIAL_DAYS (default 14)
 *   SMTP_*, MAIL_FROM — si enviás --notify (ver mail.service)
 *   La mascota va incrustada (CID) desde public/images; opcional: EMAIL_MASCOT_REMOTE_URL=https://…/gesty-face.png
 */

import { parseArgs } from "node:util";
import { createElement } from "react";
import dayjs from "dayjs";
import "dayjs/locale/es";
import {
  NewBusinessWelcomeEmail,
  renderEmailHtml,
} from "../../email-templates";
import {
  gestyMascotInlineAttachment,
  sendHtmlEmail,
} from "../../services/mail.service";
import { prisma } from "../../lib/prisma";

dayjs.locale("es");

const TRIAL_PLAN_CODE = "trial";

function trialDays(): number {
  const n = Number(process.env.MANUAL_TRIAL_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

async function ensureTrialPlan() {
  return prisma.plan.upsert({
    where: { code: TRIAL_PLAN_CODE },
    update: {},
    create: {
      name: "Trial",
      code: TRIAL_PLAN_CODE,
      token_limit: 100_000,
      monthly_price_usd: null,
      is_active: true,
    },
  });
}

function formatTrialEndLabel(d: Date): string {
  return dayjs(d).format("D [de] MMMM [de] YYYY");
}

function formatTokenLimit(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: "string" },
      notify: { type: "string" },
      timezone: { type: "string", default: "America/Argentina/Buenos_Aires" },
      description: { type: "string" },
      "skip-email": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const name = values.name?.trim();
  if (!name) {
    console.error(
      "Falta --name. Ejemplo: --name \"Pizzería Norte\" --notify socio@mail.com"
    );
    process.exit(1);
  }

  const plan = await ensureTrialPlan();
  const days = trialDays();
  const periodStart = new Date();
  const periodEnd = dayjs(periodStart).add(days, "day").toDate();

  const business = await prisma.$transaction(async (tx) => {
    const b = await tx.business.create({
      data: {
        name,
        description: values.description?.trim() || undefined,
        timezone: values.timezone ?? "America/Argentina/Buenos_Aires",
        ai_plan: "trial",
        ai_monthly_token_limit: plan.token_limit,
      },
    });

    await tx.subscription.create({
      data: {
        business_id: b.id,
        stripe_customer_id: `manual_cust_${b.id}`,
        stripe_subscription_id: `manual_sub_${b.id}`,
        status: "trialing",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        plan_id: plan.id,
        is_trial: true,
        trial_end: periodEnd,
      },
    });

    return b;
  });

  console.log("Negocio creado:", business.id, business.name);
  console.log("Plan:", TRIAL_PLAN_CODE, "| trial hasta:", periodEnd.toISOString());

  const notify = values.notify?.trim();
  if (!notify || values["skip-email"]) {
    if (notify && values["skip-email"]) {
      console.log("Correo omitido (--skip-email).");
    }
    return;
  }

  try {
    const html = await renderEmailHtml(
      createElement(NewBusinessWelcomeEmail, {
        businessName: business.name,
        trialEndsLabel: formatTrialEndLabel(periodEnd),
        tokenLimitLabel: formatTokenLimit(plan.token_limit),
      })
    );
    const attachments = process.env.EMAIL_MASCOT_REMOTE_URL?.trim()
      ? undefined
      : [gestyMascotInlineAttachment()];
    await sendHtmlEmail({
      to: notify,
      subject: `${business.name} · bienvenida a gesty.ai`,
      html,
      attachments,
    });
    console.log("Correo enviado a:", notify);
  } catch (e) {
    console.error("No se pudo enviar el correo:", e);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
