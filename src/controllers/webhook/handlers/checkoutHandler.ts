// webhooks/handlers/checkoutHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleCheckoutFromWebhook } from '../../../services/checkout.service';

export class CheckoutHandler extends BaseHandler {
  readonly command = 'CHECKOUT';
  
  matches(payloadId: string): boolean {
    return payloadId === 'CHECKOUT';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const content = await handleCheckoutFromWebhook(ctx.payload);
    
    if (!content) {
      return this.noResponse();
    }

    return this.textResponse(content);
  }
}