// webhooks/handlers/addItemHandler.ts
import { WebhookContext, HandlerResult, IntentHandler } from '../types';
import { extractPayloadId, listResponse, noResponse, textResponse } from '../utils';
import { handleCartItemSelectionFromWebhook } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class SelectCartItemForEditionHandler implements IntentHandler {
  readonly command = ConversationIntent.SELECT_CART_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.SELECT_CART_ITEM;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const payloadId = extractPayloadId(ctx.payload);
    const result = await handleCartItemSelectionFromWebhook(ctx.payload, payloadId);
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    return listResponse(result);
  }
}