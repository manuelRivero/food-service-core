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
      return buildListMessageFromButtons(
        '🤖\n\n¿Preferís interior o exterior?',
        [
          {
            title: 'Interior',
            payload: 'RESERVATION_ENV_INTERIOR',
            description: 'Mesa en interior',
            sectionTitle: 'Ambiente'
          },
          {
            title: 'Exterior',
            payload: 'RESERVATION_ENV_EXTERIOR',
            description: 'Mesa en exterior',
            sectionTitle: 'Ambiente'
          },
          {
            title: 'Sin preferencia',
            payload: 'RESERVATION_ENV_NONE',
            description: 'Cualquier ambiente',
            sectionTitle: 'Ambiente'
          }
        ],
        'Ver opciones',
        '',
        'Seleccioná una opción para continuar'
      );
    }
    case 'ASK_ENVIRONMENT': {
      const envId =
        ctx.payloadId === 'RESERVATION_ENV_INTERIOR'
          ? 'interior'
          : ctx.payloadId === 'RESERVATION_ENV_EXTERIOR'
            ? 'exterior'
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

      const summary = [
        `Fecha: ${nextState.date ?? '-'}`,
        `Hora: ${nextState.time ?? '-'}`,
        `Personas: ${nextState.partySize ?? '-'}`,
        `Ambiente: ${nextState.environmentId ?? 'sin preferencia'}`
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
      const response = result.tableId
        ? '🤖\n\n✅ Reserva confirmada'
        : '🤖\n\n❌ No hay disponibilidad';

      await updateConversationState(ctx.conversationId, {
        metadata: { ...metadata, reservation: undefined }
      });

      return response;
    }
    default:
      return null;
  }
};
