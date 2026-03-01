// webhooks/handlers/viewCategoriesHandlerV2.ts
import { WebhookContext, HandlerResult, IntentHandler } from '../types';
import { handleViewCategories } from '../../../services/category.service';
import { listResponse, noResponse, textResponse } from '../utils';
import { ConversationIntent } from 'src/types/conversationIntent';

export class ViewCategoriesHandler implements IntentHandler {
  readonly command = ConversationIntent.VIEW_CATEGORIES;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.VIEW_CATEGORIES;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleViewCategories(ctx.payload);
    
    if (result === null) return noResponse();
    if (typeof result === 'string') return textResponse(result);
    return listResponse(result);
  }
}