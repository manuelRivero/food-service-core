import { prisma } from '../lib/prisma';
import { EnrichedContext } from '../controllers/webhook/types';
import { buildListMessageFromButtons } from '../whatsappBuilders';
import type { WhatsAppListMessage } from '../domain/intent/whatsappTemplates';
import { buildSmallTalkButtons } from './smallTalk.service';

const dayNames = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

export const buildBusinessHoursMessage = async (
  ctx: EnrichedContext
): Promise<WhatsAppListMessage | string | null> => {
  const businessId = ctx.business?.id;
  if (!businessId) return null;

  const hours = await prisma.business_hours.findMany({
    where: { business_id: businessId },
    orderBy: { day_of_week: 'asc' }
  });

  if (!hours.length) {
    return 'Por el momento no tengo horarios disponibles.';
  }

  const byDay = new Map<number, { closed: boolean; slots: string[] }>();
  for (const hour of hours) {
    const existing = byDay.get(hour.day_of_week) ?? {
      closed: false,
      slots: []
    };
    if (hour.is_closed) {
      existing.closed = true;
    } else {
      existing.slots.push(`${hour.opens_at} hs a ${hour.closes_at} hs`);
    }
    byDay.set(hour.day_of_week, existing);
  }

  const lines: string[] = [];
  for (const [dayIndex, dayLabel] of dayNames.entries()) {
    const entry = byDay.get(dayIndex);
    if (!entry) continue;
    if (entry.closed || entry.slots.length === 0) {
      lines.push(`${dayLabel}: Cerrado`);
    } else {
      lines.push(`${dayLabel}: ${entry.slots.join(' / ')}`);
    }
  }

  const bodyText = `🤖\n\n*Horarios de atención* 🕐\n\n${lines.join('\n')}\n\n¿Qué te gustaría hacer ahora?`;
  const buttons = await buildSmallTalkButtons(ctx);

  return buildListMessageFromButtons(
    bodyText,
    buttons,
    'Ver opciones',
    '',
    'Seleccioná una opción para continuar'
  );
};
