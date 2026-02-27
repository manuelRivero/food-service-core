// webhooks/handlers/endConversationHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleEndConversationFromWebhook } from '../../../services/conversation.service';

export class EndConversationHandler extends BaseHandler {
  readonly command = 'END_CONVERSATION';
  
  matches(payloadId: string): boolean {
    return payloadId === 'END_CONVERSATION';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleEndConversationFromWebhook(ctx.payload);
    if (result === null) return this.noResponse();
    return this.textResponse(result);
  }
}