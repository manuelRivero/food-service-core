import { prisma } from "../lib/prisma";

export type BusinessConfig = {
  bot_enabled: boolean;
  send_idle_reminders: boolean;
  idle_reminder_minutes: number;
  idle_close_minutes: number;
  send_order_reminders: boolean;
  draft_order_reminder_minutes: number;
  draft_order_expire_minutes: number;
  reservations_enabled: boolean;
  reservation_min_lead_minutes: number;
  reservation_max_days_ahead: number;
  reservation_default_duration_minutes: number;
};

const DEFAULT_CONFIG: BusinessConfig = {
  bot_enabled: true,
  send_idle_reminders: true,
  idle_reminder_minutes: 1,
  idle_close_minutes: 2,
  send_order_reminders: true,
  draft_order_reminder_minutes: 1,
  draft_order_expire_minutes: 2,
  reservations_enabled: true,
  reservation_min_lead_minutes: 60,
  reservation_max_days_ahead: 30,
  reservation_default_duration_minutes: 90
};

export async function getBusinessConfig(businessId: string): Promise<BusinessConfig> {
  const rows = await prisma.$queryRaw<
    Array<{
      bot_enabled: boolean;
      send_idle_reminders: boolean;
      idle_reminder_minutes: number;
      idle_close_minutes: number;
      send_order_reminders: boolean;
      draft_order_reminder_minutes: number;
      draft_order_expire_minutes: number;
      reservations_enabled: boolean;
      reservation_min_lead_minutes: number;
      reservation_max_days_ahead: number;
      reservation_default_duration_minutes: number;
    }>
  >`
    SELECT
      bot_enabled,
      send_idle_reminders,
      idle_reminder_minutes,
      idle_close_minutes,
      send_order_reminders,
      draft_order_reminder_minutes,
      draft_order_expire_minutes,
      reservations_enabled,
      reservation_min_lead_minutes,
      reservation_max_days_ahead,
      reservation_default_duration_minutes
    FROM business_config
    WHERE business_id = ${businessId}::uuid
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return DEFAULT_CONFIG;
  }

  return {
    ...DEFAULT_CONFIG,
    ...row
  };
}

