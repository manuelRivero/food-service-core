// webhooks/handlers/categoryPageHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { parseCategoryPage } from '../utils';
import { handleCategoryPageFromWebhook } from '../../../services/category.service';

export class CategoryPageHandler extends BaseHandler {
  readonly command = 'CATEGORY_PAGE';
  
  matches(payloadId: string): boolean {
    return payloadId.startsWith('CATEGORY_PAGE:');
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const { categoryId, page } = parseCategoryPage(ctx.payloadId!);
    
    // Función modificada: devuelve contenido, no envía
    const content = await handleCategoryPageFromWebhook(
      ctx.payload, 
      categoryId, 
      page
    );
    
    if (!content) {
      return this.noResponse();
    }

    if (typeof content === 'string') {
      return this.textResponse(content);
    }

    return this.listResponse(content);
  }
}