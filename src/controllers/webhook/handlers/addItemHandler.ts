// webhooks/handlers/addItemHandler.ts
import { IntentHandler } from '../types';
import { WebhookContext, HandlerResult } from '../types';
import { noResponse, parseProductId, textResponse } from '../utils';
import { handleAddItemFromWebhook } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class AddItemHandler implements IntentHandler {
  readonly command = ConversationIntent.ADD_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.ADD_ITEM;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const menuItemId = ctx.payloadId!.replace('ADD_ITEM:', '');
    const result = await handleAddItemFromWebhook(ctx.payload, menuItemId);
    if (result === null) return noResponse();
    return textResponse(result);
  }
}