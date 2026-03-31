import { prisma } from '../lib/prisma';
import { RESERVATION_OCCUPYING_STATUSES } from '../constants/reservation';
import type { EnrichedContext, HandlerResult } from '../controllers/webhook/types';
import type { WhatsAppInteractiveMessage, WhatsAppListMessage } from '../domain/intent/whatsappTemplates';
import { updateConversationState } from '../repositories/conversationState.repository';
import { buildListMessageFromButtons } from '../whatsappBuilders';
import { generateReservationQR } from '../utils/reservationQr';

export type ReservationStep =
  | 'ASK_DATE'
  | 'ASK_TIME'
  | 'ASK_PARTY_SIZE'
  | 'ASK_ENVIRONMENT'
  | 'CONFIRM';

export type ReservationState = {
  step: ReservationStep;
  date?: string;
  time?: string;
  partySize?: number;
  environmentId?: string;
};

type FindTableInput = {
  businessId: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  partySize: number;
  environmentId?: string;
};

type FindTableResult = {
  tableIds: string[] | null;
  reason?: string;
};

const SLOT_DURATION_MINUTES = 120;

export function normalizeDate(dateStr: string): Date {
  // soporta "DD/MM" o "DD/MM/YYYY"
  const parts = dateStr.split("/");

  if (parts.length < 2) {
    throw new Error("INVALID_DATE_FORMAT");
  }

  const day = Number(parts[0]);
  const month = Number(parts[1]) - 1;

  const year =
    parts[2] !== undefined
      ? Number(parts[2])
      : new Date().getFullYear();

  const date = new Date(year, month, day);

  // Evita autocorrecciones silenciosas de JS (ej: 31/02 -> 03/03)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    throw new Error("INVALID_DATE");
  }

  if (isNaN(date.getTime())) {
    throw new Error("INVALID_DATE");
  }

  return date;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m + minutes, 0);
  return date.toTimeString().slice(0, 5);
}
export function buildDateTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);

  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);

  return result;
}

function addMinutesWithWrap(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const baseMinutes = h * 60 + m + minutes;
  const total = ((baseMinutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

type BusinessShift = {
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
};

const toMinutes = (value: string): number => {
  const [hh, mm] = value.split(":").map((v) => Number(v));
  return (hh || 0) * 60 + (mm || 0);
};

const isTimeInShift = (time: string, shift: BusinessShift): boolean => {
  const current = toMinutes(time);
  const start = toMinutes(shift.opens_at);
  const end = toMinutes(shift.closes_at);
  if (start === end) return false;
  if (end > start) return current >= start && current < end;
  return current >= start || current < end;
};

async function getBusinessShifts(
  prismaClient: typeof prisma,
  businessId: string,
  date: Date
): Promise<BusinessShift[]> {
  return prismaClient.business_hours.findMany({
    where: {
      business_id: businessId,
      day_of_week: date.getDay()
    },
    orderBy: { opens_at: "asc" }
  });
}

function findShiftForTime(
  time: string,
  shifts: BusinessShift[]
): BusinessShift | null {
  const openShifts = shifts.filter((s) => !s.is_closed);
  for (const shift of openShifts) {
    if (isTimeInShift(time, shift)) return shift;
  }
  return null;
}

async function validateReservationShift(params: {
  businessId: string;
  dateText: string;
  timeText: string;
}) {
  const reservationDate = normalizeDate(params.dateText);
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const selected = new Date(reservationDate);
  selected.setHours(0, 0, 0, 0);

  if (selected.getTime() < today.getTime()) {
    throw new Error("PAST_DATE");
  }

  const reservationShifts = await getBusinessShifts(
    prisma,
    params.businessId,
    reservationDate
  );
  const selectedShift = findShiftForTime(params.timeText, reservationShifts);
  if (!selectedShift) {
    throw new Error("OUTSIDE_BUSINESS_HOURS");
  }

  const isSameDay = selected.getTime() === today.getTime();
  if (!isSameDay) return;

  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  const todayShifts = await getBusinessShifts(prisma, params.businessId, now);
  const currentShift = findShiftForTime(nowTime, todayShifts);

  if (
    currentShift &&
    currentShift.opens_at === selectedShift.opens_at &&
    currentShift.closes_at === selectedShift.closes_at
  ) {
    throw new Error("INVALID_SHIFT");
  }
}

function formatDateExample(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

async function getFirstAvailableTimeForDate(
  businessId: string,
  date: Date,
  now: Date
): Promise<string | null> {
  const shifts = (await getBusinessShifts(prisma, businessId, date)).filter(
    (s) => !s.is_closed
  );
  if (!shifts.length) return null;

  const minReservationDateTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  const currentShift = isSameDay ? findShiftForTime(nowTime, shifts) : null;

  for (const shift of shifts) {
    if (
      currentShift &&
      currentShift.opens_at === shift.opens_at &&
      currentShift.closes_at === shift.closes_at
    ) {
      continue;
    }
    const candidate = buildDateTime(date, shift.opens_at);
    if (candidate.getTime() >= minReservationDateTime.getTime()) {
      return shift.opens_at;
    }
  }

  return null;
}

async function getNextDateExample(businessId: string): Promise<string> {
  const now = new Date();
  for (let offset = 0; offset < 30; offset += 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const time = await getFirstAvailableTimeForDate(businessId, date, now);
    if (time) return formatDateExample(date);
  }
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  return formatDateExample(fallback);
}

async function getTimeExampleForDate(
  businessId: string,
  dateText: string
): Promise<string> {
  try {
    const date = normalizeDate(dateText);
    const now = new Date();
    return (await getFirstAvailableTimeForDate(businessId, date, now)) ?? "20:30";
  } catch {
    return "20:30";
  }
}

function formatReservationDateDb(d: Date): string {
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function formatDbTimeReservation(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function reservationStatusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmada";
    case "partial":
      return "Parcial";
    case "completed":
      return "Completada";
    case "closed":
      return "Cerrada";
    default:
      return status;
  }
}

function buildReservationErrorMessage(text: string): WhatsAppInteractiveMessage {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: "Reserva" },
      body: { text },
      footer: { text: "Elegí una opción" },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "RESERVATION_CANCEL", title: "Cancelar reserva" }
          },
          {
            type: "reply",
            reply: { id: "RESERVATION_RESET", title: "Reiniciar reserva" }
          }
        ]
      }
    }
  };
}

async function createReservation(
  prismaClient: typeof prisma,
  input: {
    businessId: string;
    customerId: string;
    conversationId?: string;
    partySize: number;
    date: string;
    time: string;
    tableIds: string[];
  }
) {
  const endTime = addMinutes(input.time, SLOT_DURATION_MINUTES);
  const reservationDate = normalizeDate(input.date);
  const startDateTime = buildDateTime(reservationDate, input.time);
  const endDateTime = buildDateTime(reservationDate, endTime);

  return prismaClient.$transaction(async (tx) => {
    const conflict = await tx.reservation_table.findFirst({
      where: {
        table_id: { in: input.tableIds },
        reservation: {
          reservation_date: normalizeDate(input.date),
          status: {
            in: [...RESERVATION_OCCUPYING_STATUSES],
          },
          AND: [
            {
              start_time: {
                lt: endDateTime,
              },
            },
            {
              end_time: {
                gt: startDateTime,
              },
            },
          ],
        },
      },
    });

    if (conflict) {
      throw new Error("TABLES_ALREADY_BOOKED");
    }

    const reservation = await tx.reservation.create({
      data: {
        business: { connect: { id: input.businessId } },
        customer: { connect: { id: input.customerId } },
        ...(input.conversationId
          ? { conversation: { connect: { id: input.conversationId } } }
          : {}),
        party_size: input.partySize,
        reservation_date: reservationDate,
        start_time: startDateTime,
        end_time: endDateTime,
        status: "confirmed",
      }
    });

    await tx.reservation_table.createMany({
      data: input.tableIds.map((tableId) => ({
        reservation_id: reservation.id,
        table_id: tableId
      }))
    });

    return reservation;
  });
}

function mapEnvironmentToId(
  input: string,
  environments: { id: string; name: string; is_outdoor: boolean }[]
): string | null {
  const text = input.toLowerCase();

  if (text.includes("interior") || text.includes("adentro")) {
    return environments.find((e) => !e.is_outdoor)?.id || null;
  }

  if (text.includes("exterior") || text.includes("afuera")) {
    return environments.find((e) => e.is_outdoor)?.id || null;
  }

  return null;
}

export async function findAvailableTable(
  input: FindTableInput
): Promise<FindTableResult> {
  const { businessId, date, time, partySize, environmentId } = input;
  console.log("[Reservation] Input:", {
    businessId,
    date,
    time,
    partySize,
    environmentId
  });

  const reservationDate = normalizeDate(date);
  const startDateTime = buildDateTime(reservationDate, time);
  const endDateTime = buildDateTime(reservationDate, addMinutes(time, SLOT_DURATION_MINUTES));
  console.log("[Reservation] Time range:", {
    startTime: startDateTime,
    endTime: endDateTime
  });

  // 1️⃣ Traer mesas candidatas
  const tables = await prisma.table.findMany({
    where: {
      business_id: businessId,
      is_active: true,
      ...(environmentId && {
        environment_id: environmentId,
      }),
    },
    orderBy: {
      capacity: "asc",
    },
  });
  console.log("[Reservation] Tables found:", tables.length);

  if (!tables.length) {
    console.log("[Reservation] No tables match basic filters");
    return { tableIds: null, reason: "NO_TABLES" };
  }

  // 2️⃣ Evaluar disponibilidad
  const availableTables: typeof tables = [];
  for (const table of tables) {
    console.log("[Reservation] Checking table:", {
      tableId: table.id,
      capacity: table.capacity,
      environmentId: table.environment_id
    });
    // reservas que se pisan
    const overlappingReservation = await prisma.reservation_table.findFirst({
      where: {
        table_id: table.id,
        reservation: {
          reservation_date: reservationDate,
          status: {
            in: [...RESERVATION_OCCUPYING_STATUSES],
          },
          AND: [
            {
              start_time: {
                lt: endDateTime,
              },
            },
            {
              end_time: {
                gt: startDateTime,
              },
            },
          ],
        }
      },
      include: { reservation: true }
    });

    if (overlappingReservation) {
      console.log("[Reservation] Table blocked by reservation:", {
        tableId: table.id,
        reservationId: overlappingReservation.reservation_id,
        start: overlappingReservation.reservation.start_time,
        end: overlappingReservation.reservation.end_time
      });
      continue;
    }

    // bloqueos
    const overlappingBlock = await prisma.reservation_block.findFirst({
      where: {
        date: reservationDate,
        OR: [
          { table_id: table.id },
          { environment_id: table.environment_id },
        ],
        AND: [
          {
            start_time: {
              lt: endDateTime,
            },
          },
          {
            end_time: {
              gt: startDateTime,
            },
          },
        ],
      },
    });

    if (overlappingBlock) {
      console.log("[Reservation] Table blocked by block:", {
        tableId: table.id,
        blockId: overlappingBlock.id
      });
      continue;
    }

    // ✅ encontrada
    console.log("[Reservation] Table available:", {
      tableId: table.id
    });
    availableTables.push(table);
  }

  const selectedTables = selectTables(availableTables, partySize);
  if (selectedTables) {
    console.log("[Reservation] Table available:", {
      tableIds: selectedTables.map((table) => table.id)
    });
    return { tableIds: selectedTables.map((table) => table.id) };
  }

  console.log("[Reservation] No available tables found");
  return { tableIds: null, reason: "NO_AVAILABILITY" };
}

async function suggestAlternativeTimes(
  prismaClient: typeof prisma,
  input: FindTableInput
): Promise<{ time: string; tableIds: string[] }[]> {
  const offsets = [-60, -30, 30, 60];
  const suggestions: { time: string; tableIds: string[] }[] = [];
  for (const offset of offsets) {
    const candidateTime = addMinutesWithWrap(input.time, offset);
    const result = await findAvailableTable({
      ...input,
      time: candidateTime
    });
    if (result.tableIds) {
      suggestions.push({ time: candidateTime, tableIds: result.tableIds });
    }
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

function selectTables(
  tables: { id: string; capacity: number }[],
  partySize: number
): { id: string; capacity: number }[] | null {
  const sorted = [...tables].sort((a, b) => a.capacity - b.capacity);
  const exact = sorted.find((table) => table.capacity === partySize);
  if (exact) return [exact];

  const selected: { id: string; capacity: number }[] = [];
  let total = 0;
  for (const table of sorted) {
    selected.push(table);
    total += table.capacity;
    if (total >= partySize) return selected;
  }
  return null;
}

export async function handleViewReservationIntent(
  ctx: EnrichedContext
): Promise<HandlerResult> {
  if (!ctx.customer?.id) {
    return {
      content: "🤖\n\nNo encontramos tu usuario.",
      isInteractive: false
    };
  }

  const r = await prisma.reservation.findFirst({
    where: {
      customer_id: ctx.customer.id,
      status: { in: [...RESERVATION_OCCUPYING_STATUSES] }
    },
    orderBy: [{ reservation_date: "desc" }, { start_time: "desc" }],
    include: {
      reservation_table: { include: { table: true } }
    }
  });

  if (!r) {
    return {
      content: "🤖\n\nNo tenés reservas activas.",
      isInteractive: false
    };
  }

  const dateStr = formatReservationDateDb(r.reservation_date);
  const timeStr = formatDbTimeReservation(r.start_time);
  const mesas = r.reservation_table.map((rt) => `- ${rt.table.name}`).join("\n");
  const statusEsp = reservationStatusLabel(r.status ?? "confirmed");
  const bodyText = `🤖\n\n📋 Tu reserva:\n\n📅 ${dateStr}\n⏰ ${timeStr}\n👥 ${r.party_size}\n\nEstado: ${statusEsp}\n\nMesas:\n${mesas}`;

  return {
    content: {
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "text", text: "Tu reserva" },
        body: { text: bodyText },
        footer: { text: "Opciones" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "VIEW_QR", title: "Ver código QR" }
            }
          ]
        }
      }
    },
    isInteractive: true
  };
}

export async function handleViewQrIntent(
  ctx: EnrichedContext
): Promise<HandlerResult> {
  if (!ctx.customer?.id) {
    return {
      content: "🤖\n\nNo encontramos tu usuario.",
      isInteractive: false
    };
  }

  const metadata = ctx.conversationState?.metadata ?? {};
  const lastId = metadata.lastReservationId as string | undefined;

  let r =
    lastId != null
      ? await prisma.reservation.findFirst({
          where: { id: lastId, customer_id: ctx.customer.id }
        })
      : null;

  if (!r) {
    r = await prisma.reservation.findFirst({
      where: {
        customer_id: ctx.customer.id,
        status: { in: [...RESERVATION_OCCUPYING_STATUSES] }
      },
      orderBy: [{ reservation_date: "desc" }, { start_time: "desc" }]
    });
  }

  if (!r) {
    return {
      content:
        "🤖\n\nNo encontré una reserva para mostrar el código.",
      isInteractive: false
    };
  }

  const qrDataUrl = await generateReservationQR(
    (r as unknown as { checkin_token: string }).checkin_token
  );

  return {
    content: "🤖\n\nAcá está tu código QR para el ingreso.",
    isInteractive: false,
    followUps: [{ type: "image", dataUrl: qrDataUrl }]
  };
}

export const handleReservationIntent = async (
  ctx: EnrichedContext
): Promise<
  string | WhatsAppInteractiveMessage | WhatsAppListMessage | HandlerResult | null
> => {
  const metadata = ctx.conversationState?.metadata ?? {};
  const reservation: ReservationState | undefined = metadata.reservation;
  const messageText = ctx.message?.text?.body?.trim() ?? '';
  const dateRegex = /^\d{1,2}\/\d{1,2}(\/\d{4})?$/;
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const nextDateExample = ctx.business?.id
    ? await getNextDateExample(ctx.business.id)
    : "05/04";

  if (ctx.payloadId === "RESERVATION_CANCEL") {
    if (!reservation && ctx.customer?.id) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const activeReservation = await prisma.reservation.findFirst({
        where: {
          customer_id: ctx.customer.id,
          status: { in: [...RESERVATION_OCCUPYING_STATUSES] },
          reservation_date: { gte: now }
        },
        orderBy: [{ reservation_date: "desc" }, { start_time: "desc" }]
      });
      if (activeReservation) {
        await prisma.reservation.update({
          where: { id: activeReservation.id },
          data: { status: "closed" }
        });
        return "🤖\n\n*Reserva cancelada* ✅\n\nTu reserva fue cancelada. Si querés, te ayudo a crear una nueva.";
      }
    }
    await updateConversationState(ctx.conversationId, {
      metadata: { ...metadata, reservation: undefined }
    });
    return '🤖\n\n*Reserva cancelada* 🛑\n\nReserva cancelada. ¿Querés que te ayude en algo más?';
  }

  if (ctx.payloadId === "RESERVATION_RESET") {
    const nextState: ReservationState = { step: "ASK_DATE" };
    await updateConversationState(ctx.conversationId, {
      metadata: { ...metadata, reservation: nextState }
    });
    return `🤖\n\n*Reserva reiniciada* 🔄\n\n¿Para qué fecha querés reservar? (Ej: ${nextDateExample})\n\nRecordá que las reservas deben hacerse con al menos 8 horas de anticipación.`;
  }

  if (!reservation) {
    if (ctx.customer?.id) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const activeReservation = await prisma.reservation.findFirst({
        where: {
          customer_id: ctx.customer.id,
          status: { in: [...RESERVATION_OCCUPYING_STATUSES] },
          reservation_date: { gte: today }
        }
      });
      if (activeReservation) {
        return {
          type: "interactive",
          interactive: {
            type: "button",
            header: { type: "text", text: "🤖" },
            body: {
              text: "📋 *Reserva activa* ⚠️\n\nYa tenés una reserva activa.\n\nPodés gestionarla desde estas opciones:"
            },
            footer: { text: "Elegí una opción" },
            action: {
              buttons: [
                {
                  type: "reply",
                  reply: { id: "VIEW_RESERVATION", title: "Modificar reserva" }
                },
                {
                  type: "reply",
                  reply: { id: "RESERVATION_CANCEL", title: "Cancelar reserva" }
                }
              ]
            }
          }
        };
      }
    }
    const nextState: ReservationState = { step: 'ASK_DATE' };
    await updateConversationState(ctx.conversationId, {
      metadata: { ...metadata, reservation: nextState }
    });
    return `🤖\n\n*Coordinemos tu reserva* 📅\n\n¿Para qué fecha querés reservar? (Ej: ${nextDateExample})\n\nTe pedimos reservar con al menos 8 horas de anticipación para poder prepararte una mejor experiencia.`;
  }

  switch (reservation.step) {
    case 'ASK_DATE': {
      if (!messageText) {
        return `🤖\n\n*Fecha de reserva* 📅\n\n¿Para qué fecha querés reservar? (Ej: ${nextDateExample})\n\nRecordá que las reservas deben hacerse con al menos 8 horas de anticipación.`;
      }
      if (!dateRegex.test(messageText)) {
        return buildReservationErrorMessage(
            `🤖\n\n*Formato inválido* ❌\n\nEscribí nuevamente la fecha en formato DD/MM (ej: ${nextDateExample}) y te ayudo a reservar en segundos.`
        );
      }
      try {
        const parsedDate = normalizeDate(messageText);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(parsedDate);
        selected.setHours(0, 0, 0, 0);
        if (selected.getTime() < today.getTime()) {
          return buildReservationErrorMessage(
            `🤖\n\n*Fecha inválida* ❌\n\nEsa fecha ya pasó. Escribí nuevamente una fecha a futuro en formato DD/MM (ej: ${nextDateExample}), con al menos 8 horas de anticipación, y te reservo enseguida.`
          );
        }
      } catch (error) {
        if ((error as Error).message === "INVALID_DATE") {
          return buildReservationErrorMessage(
            `🤖\n\n*Fecha inválida* ❌\n\nEsa fecha no existe. Escribí nuevamente la fecha en formato DD/MM (ej: ${nextDateExample}).`
          );
        }
        throw error;
      }
      const nextState: ReservationState = {
        ...reservation,
        date: messageText,
        step: 'ASK_TIME'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      const timeExample = ctx.business?.id
        ? await getTimeExampleForDate(ctx.business.id, messageText)
        : "20:30";
      return `🤖\n\n*¡Fecha registrada!* ✅\n\nPerfecto, ya agendé la fecha.\n\n*Hora de reserva* ⏰\n\n¿A qué hora? (Ej: ${timeExample})`;
    }
    case 'ASK_TIME': {
      if (!messageText) {
        const timeExample = ctx.business?.id && reservation.date
          ? await getTimeExampleForDate(ctx.business.id, reservation.date)
          : "20:30";
        return `🤖\n\n*Hora de reserva* ⏰\n\n¿A qué hora? (Ej: ${timeExample})`;
      }
      if (!timeRegex.test(messageText)) {
        const timeExample = ctx.business?.id && reservation.date
          ? await getTimeExampleForDate(ctx.business.id, reservation.date)
          : "20:30";
        return buildReservationErrorMessage(
          `🤖\n\n*Hora inválida* ❌\n\nEscribí nuevamente la hora en formato HH:mm (ej: ${timeExample}) así avanzamos rápido con tu reserva.`
        );
      }
      if (!ctx.business?.id) {
        return buildReservationErrorMessage(
          "🤖\n\n*Sin disponibilidad* ❌\n\nNo hay disponibilidad."
        );
      }
      try {
        await validateReservationShift({
          businessId: ctx.business.id,
          dateText: reservation.date ?? "",
          timeText: messageText
        });
      } catch (error) {
        const reason = (error as Error).message;
        if (reason === "PAST_DATE") {
          return buildReservationErrorMessage(
            `🤖\n\n*Fecha inválida* ❌\n\nEsa fecha ya pasó. Escribí nuevamente una fecha a futuro en formato DD/MM (ej: ${nextDateExample}), con al menos 8 horas de anticipación, y te reservo enseguida.`
          );
        }
        if (reason === "OUTSIDE_BUSINESS_HOURS") {
          return buildReservationErrorMessage(
            "🤖\n\n*Fuera de horario* 🕒\n\nEse horario está fuera del horario de atención. Probá otra hora dentro de nuestro horario y lo coordinamos ahora."
          );
        }
        if (reason === "INVALID_SHIFT") {
          return buildReservationErrorMessage(
            "🤖\n\n*Turno no disponible* 🚫\n\nPara darte el mejor servicio, ese turno no está disponible para reservas. Elegí otro turno y te lo confirmo al instante."
          );
        }
        throw error;
      }
      const nextState: ReservationState = {
        ...reservation,
        time: messageText,
        step: 'ASK_PARTY_SIZE'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '🤖\n\n*¡Hora registrada!* ✅\n\nExcelente, ya tengo la hora.\n\n*Cantidad de personas* 👥\n\n¿Para cuántas personas?';
    }
    case 'ASK_PARTY_SIZE': {
      const partySize = Number(messageText);
      if (Number.isNaN(partySize) || partySize <= 0) {
        return buildReservationErrorMessage(
          "🤖\n\n*Número inválido* ❌\n\nIndicá un número válido de personas (ej: 4) y seguimos con tu reserva."
        );
      }
      const nextState: ReservationState = {
        ...reservation,
        partySize,
        step: 'ASK_ENVIRONMENT'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      const environments = await prisma.environment.findMany({
        where: {
          business_id: ctx.business?.id,
          is_active: true
        },
        orderBy: { name: 'asc' }
      });

      if (!environments.length) {
        await updateConversationState(ctx.conversationId, {
          metadata: {
            ...metadata,
            reservation: { ...nextState, environmentId: undefined, step: 'CONFIRM' }
          }
        });
        const summary = [
          `Fecha: ${nextState.date ?? '-'}`,
          `Hora: ${nextState.time ?? '-'}`,
          `Personas: ${nextState.partySize ?? '-'}`,
          `Ambiente: sin preferencia`
        ].join('\n');
        return {
          type: 'interactive',
          interactive: {
            type: 'button',
            header: { type: 'text', text: '🤖' },
            body: { text: `*¡Cantidad registrada!* ✅\n\nYa tengo la cantidad de personas.\n\n*Confirmar reserva* ✅\n\nRevisá los datos:\n${summary}` },
            footer: { text: 'Seleccioná una opción' },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: { id: 'RESERVATION_CONFIRM', title: '✅ Confirmar' }
                },
                {
                  type: 'reply',
                  reply: { id: 'RESERVATION_CANCEL', title: '❌ Cancelar' }
                }
              ]
            }
          }
        };
      }

      const buttons = environments.map((env) => ({
        title: env.name,
        payload: `RESERVATION_ENV:${env.id}`,
        description: env.description ?? 'Seleccioná este ambiente',
        sectionTitle: 'Ambientes'
      }));
      buttons.push({
        title: 'Sin preferencia',
        payload: 'RESERVATION_ENV_NONE',
        description: 'Cualquier ambiente',
        sectionTitle: 'Ambientes'
      });

      return buildListMessageFromButtons(
        '🤖\n\n*¡Cantidad registrada!* ✅\n\nYa tengo la cantidad de personas.\n\n*Preferencia de ambiente* 🪑\n\n¿En qué ambiente preferís reservar?',
        buttons,
        'Ver opciones',
        '',
        'Seleccioná una opción para continuar'
      );
    }
    case 'ASK_ENVIRONMENT': {
      const envId =
        ctx.payloadId?.startsWith('RESERVATION_ENV:')
          ? ctx.payloadId.split(':')[1]
          : ctx.payloadId === 'RESERVATION_ENV_NONE'
            ? undefined
            : mapEnvironmentToId(messageText, ctx.business?.environments ?? []);

      const nextState: ReservationState = {
        ...reservation,
        environmentId: envId ?? undefined,
        step: 'CONFIRM'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });

      const environmentName = envId
        ? (await prisma.environment.findUnique({ where: { id: envId } }))?.name
        : undefined;

      const summary = [
        `Fecha: ${nextState.date ?? '-'}`,
        `Hora: ${nextState.time ?? '-'}`,
        `Personas: ${nextState.partySize ?? '-'}`,
        `Ambiente: ${environmentName ?? 'sin preferencia'}`
      ].join('\n');

      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: '🤖' },
          body: { text: `*Confirmar reserva* ✅\n\nRevisá los datos:\n${summary}` },
          footer: { text: 'Seleccioná una opción' },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: { id: 'RESERVATION_CONFIRM', title: '✅ Confirmar' }
              },
              {
                type: 'reply',
                reply: { id: 'RESERVATION_CANCEL', title: '❌ Cancelar' }
              }
            ]
          }
        }
      };
    }
    case 'CONFIRM': {
      if (ctx.payloadId !== 'RESERVATION_CONFIRM') {
        const summary = [
          `Fecha: ${reservation.date ?? '-'}`,
          `Hora: ${reservation.time ?? '-'}`,
          `Personas: ${reservation.partySize ?? '-'}`,
          `Ambiente: ${reservation.environmentId ?? 'sin preferencia'}`
        ].join('\n');
        return {
          type: 'interactive',
          interactive: {
            type: 'button',
            header: { type: 'text', text: '🤖' },
            body: { text: `*Confirmar reserva* ✅\n\nRevisá los datos:\n${summary}` },
            footer: { text: 'Seleccioná una opción' },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: { id: 'RESERVATION_CONFIRM', title: '✅ Confirmar' }
                },
                {
                  type: 'reply',
                  reply: { id: 'RESERVATION_CANCEL', title: '❌ Cancelar' }
                }
              ]
            }
          }
        };
      }
      if (!ctx.business?.id) {
        return '🤖\n\n*Sin disponibilidad* ❌\n\nNo hay disponibilidad.';
      }
      const result = await findAvailableTable({
        businessId: ctx.business.id,
        date: reservation.date ?? '',
        time: reservation.time ?? '',
        partySize: reservation.partySize ?? 0,
        environmentId: reservation.environmentId
      });
      if (result.tableIds && ctx.customer?.id) {
        const created = await createReservation(prisma, {
          businessId: ctx.business.id,
          customerId: ctx.customer.id,
          conversationId: ctx.conversationId,
          partySize: reservation.partySize ?? 0,
          date: reservation.date ?? "",
          time: reservation.time ?? "",
          tableIds: result.tableIds
        });

        let followUps: HandlerResult["followUps"];
        try {
          const checkinToken = (created as unknown as { checkin_token: string })
            .checkin_token;
          const qrDataUrl = await generateReservationQR(checkinToken);
          followUps = [{ type: "image", dataUrl: qrDataUrl }];
        } catch (err) {
          console.error("[Reservation] No se pudo generar el QR:", err);
        }

        await updateConversationState(ctx.conversationId, {
          metadata: {
            ...metadata,
            reservation: undefined,
            lastReservationId: created.id
          }
        });
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: {
            status: "closed",
            idle_closed_at: new Date(),
            idle_reminder_sent_at: null,
            lastReferencedProductId: null
          }
        });

        const bodyText = `🤖\n\n*Reserva confirmada* ✅\n\n📅 ${reservation.date ?? "-"}\n⏰ ${reservation.time ?? "-"}\n👥 ${reservation.partySize ?? "-"}\n\n📍 Mostrá este código al llegar 👇\n\nPodés compartirlo con quienes vengan con vos`;

        const confirmResult: HandlerResult = {
          content: bodyText,
          isInteractive: false,
          followUps: [
            ...(followUps ?? []),
            {
              type: "text",
              message:
                "🤖\n\n¡Gracias por reservar con nosotros! Te esperamos 🙌"
            }
          ]
        };
        return confirmResult;
      }

      const suggestions = await suggestAlternativeTimes(prisma, {
        businessId: ctx.business.id,
        date: reservation.date ?? '',
        time: reservation.time ?? '',
        partySize: reservation.partySize ?? 0,
        environmentId: reservation.environmentId
      });

      if (suggestions.length) {
        const options = suggestions.map((s) => `- ${s.time}`).join('\n');
        await updateConversationState(ctx.conversationId, {
          metadata: { ...metadata, reservation: undefined }
        });
        return `🤖\n\nNo hay disponibilidad a las ${reservation.time ?? '-'}.\nTe puedo ofrecer:\n${options}`;
      }

      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: undefined }
      });
      return '🤖\n\n*Sin disponibilidad* ❌\n\nNo hay disponibilidad para ese horario';

    }
    default:
      return null;
  }
};

