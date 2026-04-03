// webhooks/handlers/addItemHandler.ts
import type { IntentHandler } from '../types';
import type { EnrichedContext, HandlerResult, IntentClassification } from '../types';
import {
  interactiveResponse,
  noResponse,
  parseAddItemButtonPayload,
  textResponse,
} from '../utils';
import { handleAddItemFromWebhook } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';
import {
  getRequestedPartySize,
  normalizeMetadata,
} from '../../../services/productQuery/utils';

function resolveAddItemQuantity(params: {
  payloadId: string;
  detectionQuantity: number | null | undefined;
  metadata: ReturnType<typeof normalizeMetadata>;
}): number {
  const explicit = parseAddItemButtonPayload(params.payloadId).quantityFromPayload;
  if (explicit != null && explicit >= 1) {
    return Math.min(99, Math.floor(explicit));
  }
  if (
    params.detectionQuantity != null &&
    params.detectionQuantity >= 1
  ) {
    return Math.min(99, Math.floor(params.detectionQuantity));
  }
  const last = params.metadata.lastListSuggestedQuantity;
  if (last != null && last >= 1) {
    return Math.min(99, Math.floor(last));
  }
  const party = getRequestedPartySize(params.metadata);
  if (party != null && party >= 1) {
    return Math.min(99, Math.floor(party));
  }
  return 1;
}

export class AddItemHandler implements IntentHandler {
  readonly command = ConversationIntent.ADD_ITEM;

  canHandle(intent: string): boolean {
    return intent === ConversationIntent.ADD_ITEM;
  }

  async execute(
    ctx: EnrichedContext,
    classification?: IntentClassification
  ): Promise<HandlerResult | null> {
    const payloadId = ctx.payloadId ?? '';
    const { productId: menuItemId } = parseAddItemButtonPayload(payloadId);
    if (!menuItemId) return noResponse();

    const meta = normalizeMetadata(ctx.conversationState?.metadata);
    const addQuantity = resolveAddItemQuantity({
      payloadId,
      detectionQuantity: ctx.detection?.quantity ?? classification?.quantity,
      metadata: meta,
    });

    const result = await handleAddItemFromWebhook(
      ctx.payload,
      menuItemId,
      addQuantity
    );
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    return interactiveResponse(
      result.main,
      result.complementBridge
        ? [{ type: 'interactive' as const, message: result.complementBridge }]
        : undefined
    );
  }
}
