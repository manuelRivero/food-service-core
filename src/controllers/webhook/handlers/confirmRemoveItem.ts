// webhooks/handlers/addItemHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseProductId } from '../utils';
import { handleConfirmRemoveItemFromWebhook } from '../../../services/cart.service';

export class ConfirmRemoveItemHandler extends BaseHandler {
  readonly command = 'CONFIRM_REMOVE_ITEM';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('CONFIRM_REMOVE_ITEM:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const menuItemId = parseProductId(ctx.payloadId!);
    const result = await handleConfirmRemoveItemFromWebhook(ctx.payload, menuItemId);
    if (result === null) return this.noResponse();
    if (typeof result === 'string') return this.textResponse(result);
    return this.interactiveResponse(result);
  }
}