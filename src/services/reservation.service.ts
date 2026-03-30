import { prisma } from 'src/lib/prisma';
import type { EnrichedContext } from '../controllers/webhook/types';
import type { WhatsAppInteractiveMessage } from '../domain/intent/whatsappTemplates';
import { updateConversationState } from '../repositories/conversationState.repository';

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
  tableId: string | null;
  reason?: string;
};

const SLOT_DURATION_MINUTES = 120;

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m + minutes, 0);
  return date.toTimeString().slice(0, 5);
}

export async function findAvailableTable(
  input: FindTableInput
): Promise<FindTableResult> {
  const { businessId, date, time, partySize, environmentId } = input;

  const endTime = addMinutes(time, SLOT_DURATION_MINUTES);

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

  if (!tables.length) {
    return { tableId: null, reason: "NO_TABLES" };
  }

  // 2️⃣ Evaluar disponibilidad
  for (const table of tables) {
    // reservas que se pisan
    const overlappingReservation = await prisma.reservation.findFirst({
      where: {
        table_id: table.id,
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
      },
    });

    if (overlappingReservation) continue;

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

    if (overlappingBlock) continue;

    // ✅ encontrada
    return { tableId: table.id };
  }

  return { tableId: null, reason: "NO_AVAILABILITY" };
}

const parsePartySize = (value: string): number | null => {
  const match = value.match(/\d+/);
  if (!match) return null;
  const numberValue = Number(match[0]);
  return Number.isNaN(numberValue) || numberValue <= 0 ? null : numberValue;
};

export const handleReservationIntent = async (
  ctx: EnrichedContext
): Promise<string | WhatsAppInteractiveMessage | null> => {
  const metadata = ctx.conversationState?.metadata ?? {};
  const reservation: ReservationState | undefined = metadata.reservation;
  const messageText = ctx.message?.text?.body?.trim() ?? '';

  if (!reservation) {
    const nextState: ReservationState = { step: 'ASK_DATE' };
    await updateConversationState(ctx.conversationId, {
      metadata: { ...metadata, reservation: nextState }
    });
    return '¿Para qué fecha querés reservar? (Ej: 05/04)';
  }

  switch (reservation.step) {
    case 'ASK_DATE': {
      if (!messageText) {
        return '¿Para qué fecha querés reservar? (Ej: 05/04)';
      }
      const nextState: ReservationState = {
        ...reservation,
        date: messageText,
        step: 'ASK_TIME'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '¿A qué hora? (Ej: 20:30)';
    }
    case 'ASK_TIME': {
      if (!messageText) {
        return '¿A qué hora? (Ej: 20:30)';
      }
      const nextState: ReservationState = {
        ...reservation,
        time: messageText,
        step: 'ASK_PARTY_SIZE'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '¿Para cuántas personas?';
    }
    case 'ASK_PARTY_SIZE': {
      const partySize = parsePartySize(messageText);
      if (!partySize) {
        return '¿Para cuántas personas? (Ej: 4)';
      }
      const nextState: ReservationState = {
        ...reservation,
        partySize,
        step: 'ASK_ENVIRONMENT'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });
      return '¿Preferís interior o exterior? (Opcional, podés responder "sin preferencia")';
    }
    case 'ASK_ENVIRONMENT': {
      const environmentValue = messageText.toLowerCase();
      const environmentId =
        environmentValue.includes('interior')
          ? 'interior'
          : environmentValue.includes('exterior')
            ? 'exterior'
            : undefined;

      const nextState: ReservationState = {
        ...reservation,
        environmentId,
        step: 'CONFIRM'
      };
      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: nextState }
      });

      const summary = [
        `Fecha: ${nextState.date ?? '-'}`,
        `Hora: ${nextState.time ?? '-'}`,
        `Personas: ${nextState.partySize ?? '-'}`,
        `Ambiente: ${environmentId ?? 'sin preferencia'}`
      ].join('\n');

      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Confirmar reserva' },
          body: { text: `Confirmá tu reserva:\n${summary}` },
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
        return 'Reserva cancelada. ¿Querés que te ayude en algo más?';
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
            body: { text: `Confirmá tu reserva:\n${summary}` },
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
      const response = result.tableId
        ? '✅ Reserva confirmada'
        : '❌ No hay disponibilidad';

      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: undefined }
      });

      return response;
    }
    default:
      return null;
  }
};
