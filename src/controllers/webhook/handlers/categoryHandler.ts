import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseProductId } from '../utils';
import { handleCategorySelectionFromWebhook } from 'src/services/category.service';

export class CategoryHandler extends BaseHandler {
  readonly command = 'CATEGORY';
  
  matches(payloadId: string): boolean {
    // Evitar conflicto con CATEGORY_PAGE y CATEGORY_LIST_PAGE
    return payloadId.startsWith('CATEGORY:') && 
           !payloadId.startsWith('CATEGORY_PAGE:') && 
           !payloadId.startsWith('CATEGORY_LIST_PAGE:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const categoryId = parseProductId(ctx.payloadId!);
    
    const result = await handleCategorySelectionFromWebhook(ctx.payload, categoryId, 1);
    
    if (result === null) {
      return this.noResponse();
    }

    if (typeof result === 'string') {
      return this.textResponse(result);
    }

    return this.listResponse(result);
  }
}