// webhooks/handlers/addItemHandler.ts
import { IntentHandler } from '../types';
import { WebhookContext, HandlerResult } from '../types';
import { extractPayloadId, interactiveResponse, noResponse, textResponse } from '../utils';
import {  handleSelectQuantityDecreaseItemFromWebhook } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class DecreaseItemQuantityHandler implements IntentHandler {
  readonly command = ConversationIntent.DECREASE_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.DECREASE_ITEM;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const itemID = extractPayloadId(ctx.payloadId!);
    const result = await handleSelectQuantityDecreaseItemFromWebhook(ctx.payload, itemID);
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    return interactiveResponse(result);
  }
}