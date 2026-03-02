import { Prisma } from '@prisma/client';
import {
  EnrichedContext,
  HandlerResult,
  IntentClassification,
  IntentHandler
} from '../types';
import { interactiveResponse, listResponse, textResponse } from '../utils';
import { ConversationIntent } from '../../../types/conversationIntent';
import { MenuService } from '../../../services/menu.service';
import {
  createConversationMessage,
  updateConversationLastMessageAt
} from '../../../repositories';
import {
  findOrCreateConversationState,
  updateConversationState
} from '../../../repositories/conversationState.repository';
import { prisma } from '../../../lib/prisma';
import {
  generateProductAwareResponse
} from '../../../services/ai/openai.service';
import type { WhatsAppListMessage } from '../../../domain/intent/whatsappTemplates';
import { truncateDescription } from '../../../whatsappBuilders';

type ConversationMetadata = {
  pendingProductSelection?: boolean;
  pendingQuestion?: string;
  candidateProductIds?: string[];
};

type ConversationMode = 'GLOBAL' | 'FILTER_SET' | 'PRODUCT_FOCUS';

const normalizeMetadata = (value: unknown): ConversationMetadata => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as ConversationMetadata;
  }
  return {};
};

const buildMetadataValue = (
  metadata: ConversationMetadata
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput => {
  return Object.keys(metadata).length === 0
    ? Prisma.JsonNull
    : (metadata as Prisma.InputJsonValue);
};

const clearProductFilterMetadata = (
  metadata: ConversationMetadata
): ConversationMetadata => {
  if (
    !metadata.pendingProductSelection &&
    !metadata.pendingQuestion &&
    !metadata.candidateProductIds
  ) {
    return metadata;
  }
  const { pendingProductSelection, pendingQuestion, candidateProductIds, ...rest } = metadata;
  void pendingProductSelection;
  void pendingQuestion;
  void candidateProductIds;
  return rest;
};

const buildListMessage = (params: {
  headerText: string;
  bodyText: string;
  footerText: string;
  actionButtonLabel: string;
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description: string }>;
  }>;
}): WhatsAppListMessage => ({
  type: 'list',
  header: { type: 'text', text: params.headerText },
  body: { text: params.bodyText },
  footer: { text: params.footerText },
  action: {
    button: params.actionButtonLabel,
    sections: params.sections
  }
});

const getActivePrice = async (params: {
  productId: string;
  currency: string | null;
}) => {
  const now = new Date();
  const priceWhere = {
    is_active: true,
    valid_from: { lte: now },
    OR: [{ valid_to: null }, { valid_to: { gte: now } }],
    ...(params.currency ? { currency_code: params.currency } : {})
  };

  return prisma.menu_item_price.findFirst({
    where: {
      menu_item_id: params.productId,
      ...priceWhere
    },
    orderBy: { valid_from: 'desc' }
  });
};

export class ProductQueryHandler implements IntentHandler {
  readonly command = ConversationIntent.PRODUCT_QUERY;

  canHandle(intent: string): boolean {
    return intent === ConversationIntent.PRODUCT_QUERY;
  }

  async execute(
    ctx: EnrichedContext,
    classification?: IntentClassification
  ): Promise<HandlerResult | null> {
    const keyword = classification?.detectedProductName?.trim() ?? '';
    const userMessage = ctx.message?.text?.body || '';

    if (!keyword) {
      return textResponse('¿Qué producto estás buscando?');
    }

    const items = await MenuService.searchMenuItemsByKeyword({
      businessId: ctx.business.id,
      keyword
    });

    if (items.length === 0) {
      const messageText = `No encontramos productos relacionados con "${keyword}" en nuestro menú.`;
      await createConversationMessage(ctx.conversation.id, 'ai', messageText, false);
      await updateConversationLastMessageAt(ctx.conversation.id);
      return interactiveResponse({
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Sin resultados a tu consulta' },
          body: { text: messageText },
          footer: { text: 'Elige una opción' },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: 'VIEW_MENU',
                  title: 'Ver menú'
                }
              }
            ]
          }
        }
      });
    }

    if (items.length > 1) {
      await updateConversationState(ctx.conversation.id, {
        mode: 'FILTER_SET',
        metadata: buildMetadataValue({
          pendingProductSelection: true,
          pendingQuestion: userMessage,
          candidateProductIds: items.map((item) => item.id)
        })
      } as Prisma.conversation_stateUpdateInput & { mode?: ConversationMode });

      if (ctx.conversation.lastReferencedProductId) {
        await prisma.conversation.update({
          where: { id: ctx.conversation.id },
          data: { lastReferencedProductId: null }
        });
      }

      const listMessage = buildListMessage({
        headerText: '',
        bodyText: '*Tenemos algunos resultados para tu consulta* \n Selecciona uno 👇',
        footerText: 'Elige una opción',
        actionButtonLabel: 'Ver opciones',
        sections: [
          {
            title: 'Resultados',
            rows: items.map((item) => ({
              id: `SELECT_PRODUCT:${item.id}`,
              title: item.name,
              description: truncateDescription(
                item.description ?? item.ingredients ?? 'Sin descripción'
              )
            }))
          }
        ]
      });

      await createConversationMessage(
        ctx.conversation.id,
        'ai',
        listMessage.body.text,
        false
      );
      await updateConversationLastMessageAt(ctx.conversation.id);

      return listResponse(listMessage);
    }

    const matchedItem = items[0];
    const currency = ctx.customer.preferred_currency ?? ctx.business.currency_code ?? null;
    const activePrice = await getActivePrice({
      productId: matchedItem.id,
      currency
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
            currency_code: activePrice.currency_code
          }
          : null
      },
      userQuestion: userMessage
    });

    await createConversationMessage(ctx.conversation.id, 'ai', aiResponse, true);
    await updateConversationLastMessageAt(ctx.conversation.id);

    await prisma.conversation.update({
      where: { id: ctx.conversation.id },
      data: { lastReferencedProductId: matchedItem.id }
    });

    const stateForFocus = await findOrCreateConversationState(ctx.conversation.id);
    const cleanedMetadata = clearProductFilterMetadata(
      normalizeMetadata(stateForFocus.metadata)
    );
    await updateConversationState(ctx.conversation.id, {
      mode: 'PRODUCT_FOCUS',
      metadata: buildMetadataValue(cleanedMetadata)
    } as Prisma.conversation_stateUpdateInput & { mode?: ConversationMode });

    return textResponse(aiResponse);
  }
}
