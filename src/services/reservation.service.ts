import { prisma } from '../lib/prisma';
import type { EnrichedContext } from '../controllers/webhook/types';
import type { WhatsAppInteractiveMessage, WhatsAppListMessage } from '../domain/intent/whatsappTemplates';
import { updateConversationState } from '../repositories/conversationState.repository';
import { buildListMessageFromButtons } from '../whatsappBuilders';

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

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m + minutes, 0);
  return date.toTimeString().slice(0, 5);
}

function addMinutesWithWrap(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const baseMinutes = h * 60 + m + minutes;
  const total = ((baseMinutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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
  const reservationDate = new Date(input.date);

  return prismaClient.$transaction(async (tx) => {
    const conflict = await tx.reservation_table.findFirst({
      where: {
        table_id: { in: input.tableIds },
        reservation: {
          reservation_date: reservationDate,
          status: {
            in: ["confirmed", "pending"],
          },
          AND: [
            {
              start_time: {
                lt: endTime,
              },
            },
            {
              end_time: {
                gt: input.time,
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
        start_time: input.time,
        end_time: endTime,
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

  const endTime = addMinutes(time, SLOT_DURATION_MINUTES);
  console.log("[Reservation] Time range:", {
    startTime: time,
    endTime
  });

  // 1️⃣ Traer mesas candidatas
  const tables = await prisma.table.findMany({
    where: {
      business_id: businessId,
      is_active: true,
      capacity: {
        gte: partySize,
      },
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
          reservation_date: new Date(date),
          status: {
            in: ["confirmed", "pending"],
          },
          AND: [
            {
              start_time: {
                lt: endTime,
              },
            },
            {
              end_time: {
                gt: time,
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
        date: new Date(date),
        OR: [
          { table_id: table.id },
          { environment_id: table.environment_id },
        ],
        AND: [
          {
            start_time: {
              lt: endTime,
            },
          },
          {
            end_time: {
              gt: time,
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

const parsePartySize = (value: string): number | null => {
  const match = value.match(/\d+/);
  if (!match) return null;
  const numberValue = Number(match[0]);
  return Number.isNaN(numberValue) || numberValue <= 0 ? null : numberValue;
};

export const handleReservationIntent = async (
  ctx: EnrichedContext
): Promise<string | WhatsAppInteractiveMessage | WhatsAppListMessage | null> => {
  const metadata = ctx.conversationState?.metadata ?? {};
  const reservation: ReservationState | undefined = metadata.reservation;
  const messageText = ctx.message?.text?.body?.trim() ?? '';

  if (!reservation) {
    const nextState: ReservationState = { step: 'ASK_DATE' };
    await updateConversationState(ctx.conversationId, {
      metadata: { ...metadata, reservation: nextState }
    });
    return '🤖\n\n¿Para qué fecha querés reservar? (Ej: 05/04)';
  }

  switch (reservation.step) {
    case 'ASK_DATE': {
      if (!messageText) {
        return '🤖\n\n¿Para qué fecha querés reservar? (Ej: 05/04)';
      }
      const nextState: ReservationState = {
        ...reservation,
        date: messageText,
        step: 'ASK_TIME'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '🤖\n\n¿A qué hora? (Ej: 20:30)';
    }
    case 'ASK_TIME': {
      if (!messageText) {
        return '🤖\n\n¿A qué hora? (Ej: 20:30)';
      }
      const nextState: ReservationState = {
        ...reservation,
        time: messageText,
        step: 'ASK_PARTY_SIZE'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '🤖\n\n¿Para cuántas personas?';
    }
    case 'ASK_PARTY_SIZE': {
      const partySize = parsePartySize(messageText);
      if (!partySize) {
        return '🤖\n\n¿Para cuántas personas? (Ej: 4)';
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
            header: { type: 'text', text: 'Confirmar reserva' },
            body: { text: `🤖\n\nConfirmá tu reserva:\n${summary}` },
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
        '🤖\n\n¿En qué ambiente preferís reservar?',
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
          header: { type: 'text', text: 'Confirmar reserva' },
          body: { text: `🤖\n\nConfirmá tu reserva:\n${summary}` },
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
      if (ctx.payloadId === 'RESERVATION_CANCEL') {
        await updateConversationState(ctx.conversationId, {
          metadata: { ...metadata, reservation: undefined }
        });
        return '🤖\n\nReserva cancelada. ¿Querés que te ayude en algo más?';
      }

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
            header: { type: 'text', text: 'Confirmar reserva' },
            body: { text: `🤖\n\nConfirmá tu reserva:\n${summary}` },
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
        return '❌ No hay disponibilidad';
      }
      const result = await findAvailableTable({
        businessId: ctx.business.id,
        date: reservation.date ?? '',
        time: reservation.time ?? '',
        partySize: reservation.partySize ?? 0,
        environmentId: reservation.environmentId
      });
      if (result.tableIds && ctx.customer?.id) {
        await createReservation(prisma, {
          businessId: ctx.business.id,
          customerId: ctx.customer.id,
          conversationId: ctx.conversationId,
          partySize: reservation.partySize ?? 0,
          date: reservation.date ?? '',
          time: reservation.time ?? '',
          tableIds: result.tableIds
        });
        await updateConversationState(ctx.conversationId, {
          metadata: { ...metadata, reservation: undefined }
        });
        return '🤖\n\n✅ Reserva confirmada';
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
      return '🤖\n\nNo hay disponibilidad para ese horario';

    }
    default:
      return null;
  }
};

