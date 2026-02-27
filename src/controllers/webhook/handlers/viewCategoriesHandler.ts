// webhooks/handlers/viewCategoriesHandlerV2.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { handleViewCategories } from '../../../services/category.service';

export class ViewCategoriesHandler extends BaseHandler {
  readonly command = 'VIEW_CATEGORIES';
  
  matches(payloadId: string): boolean {
    return payloadId === 'VIEW_CATEGORIES';
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const result = await handleViewCategories(ctx.payload);
    
    if (result === null) return this.noResponse();
    if (typeof result === 'string') return this.textResponse(result);
    return this.listResponse(result);
  }
}