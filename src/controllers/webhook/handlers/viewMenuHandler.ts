// webhooks/handlers/viewMenuReturnHandler.ts
import { WebhookContext, HandlerResult, IntentHandler } from '../types';
import { handleViewMenuFromWebhook } from '../../../services/category.service';
import { listResponse, noResponse, textResponse } from '../utils';
import { ConversationIntent } from '../../../types/conversationIntent';

export class ViewMenuHandler implements IntentHandler {
  readonly command = ConversationIntent.VIEW_MENU;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.VIEW_MENU;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleViewMenuFromWebhook(ctx.payload);
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    return listResponse(result);
  }
}