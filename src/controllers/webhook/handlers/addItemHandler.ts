// webhooks/handlers/addItemHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseProductId } from '../utils';
import { handleAddItemFromWebhook } from '../../../services/cart.service';

export class AddItemHandler extends BaseHandler {
  readonly command = 'ADD_ITEM';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('ADD_ITEM:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const menuItemId = parseProductId(ctx.payloadId!);
    const result = await handleAddItemFromWebhook(ctx.payload, menuItemId);
    if (result === null) return this.noResponse();
    return this.textResponse(result);
  }
}