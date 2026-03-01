// webhooks/handlers/checkoutHandler.ts
import { WebhookContext, HandlerResult, IntentHandler } from '../types';
import { handleCheckoutFromWebhook } from '../../../services/checkout.service';
import { ConversationIntent } from '../../../types/conversationIntent';
import { noResponse, textResponse } from '../utils';

export class CheckoutHandler implements IntentHandler {
  readonly command = ConversationIntent.CHECKOUT;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.CHECKOUT;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const content = await handleCheckoutFromWebhook(ctx.payload);
    
    if (!content) {
      return noResponse();
    }

    return textResponse(content);
  }
}