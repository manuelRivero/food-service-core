// webhooks/handlers/cancelOrderHandlerV2.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleCancelOrderFromWebhook } from '../../../services/order.service';

export class CancelOrderHandler extends BaseHandler {
  readonly command = 'CANCEL_ORDER';
  
  matches(payloadId: string): boolean {
    return payloadId === 'CANCEL_ORDER';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleCancelOrderFromWebhook(ctx.payload);
    if (result === null) return this.noResponse();
    return this.textResponse(result);
  }
}