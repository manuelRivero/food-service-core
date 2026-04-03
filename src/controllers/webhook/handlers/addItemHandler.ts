// webhooks/handlers/addItemHandler.ts
import { IntentHandler } from '../types';
import { WebhookContext, HandlerResult } from '../types';
import {
  interactiveResponse,
  noResponse,
  parseProductId,
  parseQuantity,
  textResponse,
} from '../utils';
import { handleAddItemFromWebhook } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class AddItemHandler implements IntentHandler {
  readonly command = ConversationIntent.ADD_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.ADD_ITEM;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const menuItemId = parseProductId(ctx.payloadId!);
    const addQuantity = parseQuantity(ctx.payloadId!) ?? 1;
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