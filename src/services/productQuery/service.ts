import { Prisma } from '@prisma/client';
import type { WhatsAppInteractiveMessage } from '../../domain/intent/whatsappTemplates';
import type {
  EnrichedContext,
  IntentClassification,
} from '../../controllers/webhook/types';
import {
  createConversationMessage,
  updateConversationLastMessageAt,
  clearLastReferencedProductId,
  setLastReferencedProductId,
} from '../../repositories';
import {
  findOrCreateConversationState,
  updateConversationState,
} from '../../repositories/conversationState.repository';
import { MenuService } from '../menu.service';
import { generateProductAwareResponse } from '../ai/openai.service';
import { truncateDescription } from '../../whatsappBuilders';
import type { ConversationMode, ProductQueryServiceResult } from './types';
import {
  buildListMessage,
  buildMetadataValue,
  clearProductFilterMetadata,
  formatBotUserMessage,
  getActivePrice,
  normalizeMetadata,
} from './utils';
import {
  formatSmartRecommendationsBullets,
  getSmartRecommendations,
} from './smartFoodRecommendations';

/**
 * Flujo PRODUCT_QUERY: búsqueda, estado y payloads para WhatsApp (sin envolver en HandlerResult).
 */
export async function executeProductQuery(
  ctx: EnrichedContext,
  classification?: IntentClassification
): Promise<ProductQueryServiceResult> {
  const keyword = classification?.detectedProductName?.trim() ?? '';
  const userMessage = ctx.message?.text?.body || '';

  if (!keyword) {
    return formatBotUserMessage(
      'Tu búsqueda',
      '🔍',
      '¿Qué producto estás buscando? Escribí el nombre o una palabra clave.'
    );
  }

  const items = await MenuService.searchMenuItemsByKeyword({
    businessId: ctx.business.id,
    keyword,
  });

  if (items.length === 0) {
    const bodyCopy = `No encontramos productos relacionados con "${keyword}" en nuestro menú.`;
    const fullText = formatBotUserMessage('Sin coincidencias', '🔎', bodyCopy);
    await createConversationMessage(ctx.conversation.id, 'ai', fullText, false);
    await updateConversationLastMessageAt(ctx.conversation.id);
    const interactive: WhatsAppInteractiveMessage = {
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: '' },
        body: { text: fullText },
        footer: { text: 'Elegí una opción' },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: 'VIEW_MENU',
                title: 'Ver menú',
              },
            },
          ],
        },
      },
    };
    return interactive;
  }

  if (items.length > 1) {
    const smart = await getSmartRecommendations({
      userQuery: userMessage.trim() || keyword,
      businessId: ctx.business.id,
      business: ctx.business,
      quantity: classification?.quantity ?? null,
      vectorResults: items,
    });

    const listSource = smart.forList.length > 0 ? smart.forList : items;

    const requestedQty = classification?.quantity;
    const qtyMeta =
      requestedQty != null && requestedQty > 0
        ? { pendingProductQueryQuantity: requestedQty }
        : {};

    await updateConversationState(ctx.conversation.id, {
      mode: 'FILTER_SET',
      metadata: buildMetadataValue({
        pendingProductSelection: true,
        pendingQuestion: userMessage,
        candidateProductIds: listSource.map((item) => item.id),
        ...qtyMeta,
      }),
    } as Prisma.conversation_stateUpdateInput & { mode?: ConversationMode });

    if (ctx.conversation.lastReferencedProductId) {
      await clearLastReferencedProductId(ctx.conversation.id);
    }

    const qtyNote =
      requestedQty != null && requestedQty > 0
        ? `\n\nPediste algo pensado para unas *${requestedQty}* persona(s). Si en el menú no hay un plato que indique claramente esa porción, las sugerencias pueden ser aproximadas: *tocá un ítem de la lista* para ver porciones, precio y si conviene sumar más de una unidad.`
        : '';

    const listHint = `Tocá la lista para *ver más detalle* de cada opción (descripción, precio, porciones) antes de agregarla al pedido.${qtyNote}`;

    const intro =
      smart.forDisplay.length > 0
        ? `${formatSmartRecommendationsBullets(smart.forDisplay)}\n\n${listHint}\n\nSeleccioná abajo 👇`
        : `${listHint}\n\nSeleccioná un plato en la lista 👇`;

    const listBody = formatBotUserMessage('Varios resultados', '📋', intro);

    const listMessage = buildListMessage({
      headerText: '',
      bodyText: listBody,
      footerText: 'Elegí una opción',
      actionButtonLabel: 'Ver opciones',
      sections: [
        {
          title: 'Resultados',
          rows: listSource.map((item) => ({
            id: `SELECT_PRODUCT:${item.id}`,
            title: item.name,
            description: truncateDescription(
              item.description ??
                ('ingredients' in item ? item.ingredients : null) ??
                'Sin descripción'
            ),
          })),
        },
      ],
    });

    await createConversationMessage(
      ctx.conversation.id,
      'ai',
      listMessage.body.text,
      false
    );
    await updateConversationLastMessageAt(ctx.conversation.id);

    return listMessage;
  }

  const matchedItem = items[0];
  const currency =
    ctx.customer.preferred_currency ?? ctx.business.currency_code ?? null;
  const activePrice = await getActivePrice({
    productId: matchedItem.id,
    currency,
  });

  const aiResponse = await generateProductAwareResponse({
    product: {
      name: matchedItem.name,
      description: matchedItem.description,
      ingredients: matchedItem.ingredients,
      serves_people: matchedItem.serves_people,
      is_available: matchedItem.is_available,
      price: activePrice
        ? {
            amount: activePrice.amount,
            currency_code: activePrice.currency_code,
          }
        : null,
    },
    userQuestion: userMessage,
  });

  const fullText = formatBotUserMessage('Info del plato', '🍽️', aiResponse);

  await createConversationMessage(ctx.conversation.id, 'ai', fullText, true);
  await updateConversationLastMessageAt(ctx.conversation.id);

  await setLastReferencedProductId(ctx.conversation.id, matchedItem.id);

  const stateForFocus = await findOrCreateConversationState(ctx.conversation.id);
  const cleanedMetadata = clearProductFilterMetadata(
    normalizeMetadata(stateForFocus.metadata)
  );
  await updateConversationState(ctx.conversation.id, {
    mode: 'PRODUCT_FOCUS',
    metadata: buildMetadataValue(cleanedMetadata),
  } as Prisma.conversation_stateUpdateInput & { mode?: ConversationMode });

  return fullText;
}
