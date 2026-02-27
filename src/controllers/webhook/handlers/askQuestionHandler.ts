// webhooks/handlers/askQuestionHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleAskQuestionFromWebhook } from '../../../services/conversation.service';

export class AskQuestionHandler extends BaseHandler {
  readonly command = 'ASK_QUESTION';
  
  matches(payloadId: string): boolean {
    return payloadId === 'ASK_QUESTION';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleAskQuestionFromWebhook(ctx.payload);
    if (result === null) return this.noResponse();
    return this.textResponse(result);
  }
}