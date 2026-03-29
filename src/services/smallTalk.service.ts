import { prisma } from '../lib/prisma';
import { EnrichedContext } from '../controllers/webhook/types';
import { buildListMessageFromButtons } from '../whatsappBuilders';
import type { WhatsAppListMessage } from '../domain/intent/whatsappTemplates';

const baseButtons = [
  {
    title: 'Ver menú',
    payload: 'VIEW_MENU',
    description: 'Explorar platos disponibles',
    sectionTitle: 'Opciones'
  },
  {
    title: 'Horarios de atención',
    payload: 'VIEW_BUSINESS_HOURS',
    description: 'Ver los horarios de atención',
    sectionTitle: 'Opciones'
  },
  {
    title: 'Hacer una consulta',
    payload: 'ASK_QUESTION',
    description: 'Hacer una consulta',
    sectionTitle: 'Opciones'
  }
];

export const buildSmallTalkMenu = async (
    ctx: EnrichedContext
): Promise<WhatsAppListMessage | string | null> => {
  const businessNameFromCtx = ctx.business?.name;
  if (!businessNameFromCtx) {
    return '¡Hola! ¿En qué te puedo ayudar?';
  }

  const business = await prisma.business.findFirst({
    where: { name: businessNameFromCtx }
  });

  const businessName = business?.name ?? businessNameFromCtx;

  const activeOrder = await prisma.draft_order.findFirst({
    where: {
      business_id: ctx.business?.id ?? business?.id ?? null,
      customer_phone: ctx.customer?.phone_number,
      status: 'active'
    },
    select: { id: true }
  });

  const buttons = [...baseButtons];
  if (activeOrder) {
    buttons.unshift({
      title: 'Ver pedido',
      payload: 'VIEW_ORDER',
      description: 'Revisar tu pedido actual',
      sectionTitle: 'Opciones'
    });
  }

  const headerText = `Bienvenido a ${businessName}`;
  const bodyText = `¡Hola! Soy el asistente de IA de ${businessName}. ¿Qué te gustaría hacer?`;

  return buildListMessageFromButtons(
    bodyText,
    buttons,
    'Ver opciones',
    headerText,
    'Seleccioná una opción para continuar'
  );
};
