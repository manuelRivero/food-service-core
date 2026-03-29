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

  const lines = hours.map((hour) => {
    const dayLabel = dayNames[hour.day_of_week] ?? `Día ${hour.day_of_week}`;
    if (hour.is_closed) {
      return `${dayLabel}: Cerrado`;
    }
    return `${dayLabel}: ${hour.opens_at} - ${hour.closes_at}`;
  });

  const bodyText = `🤖\n\n🕒 Horarios de atención\n\n${lines.join('\n')}\n\n¿Qué te gustaría hacer ahora?`;
  const buttons = await buildSmallTalkButtons(ctx);

  return buildListMessageFromButtons(
    bodyText,
    buttons,
    'Ver opciones',
    '',
    'Seleccioná una opción para continuar'
  );
};
