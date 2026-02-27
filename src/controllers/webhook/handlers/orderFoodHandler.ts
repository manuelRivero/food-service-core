// src/controllers/webhook/handlers/orderFoodHandler.ts
import { BaseHandler } from './baseHandler';
import { WebhookContext, HandlerResult } from '../types';
import { generateOrderResolution } from '../../../services/ai/openai.service'; // ← Verificar esta ruta
import { buildConfirmRemoveItemMessage } from '../../../services/cart.service';
import { extractOrderContext } from 'src/services/intent.service';

export class OrderFoodHandler extends BaseHandler {
  readonly command = 'ORDER_FOOD';
  
  matches(payloadId: string): boolean {
    return false;
  }

  async execute(ctx: WebhookContext): Promise<HandlerResult | null> {
    const orderContext = await extractOrderContext(ctx.payload);
    
    const resolution = await generateOrderResolution({
      userMessage: orderContext.lastMessage,
      currentOrderItems: orderContext.items
    });

    if (resolution.needs_clarification && orderContext.items.length > 0) {
      return this.buildClarificationList(orderContext.items);
    }

    for (const action of resolution.actions) {
      const quantity = action.quantity && action.quantity > 0 ? action.quantity : 1;

      switch (action.action) {
        case 'add':
          return await this.handleAddProduct(ctx, action.product_name, quantity);
          
        case 'remove':
          return await this.handleRemoveProduct(ctx, action.product_name, quantity);
          
        case 'set_quantity':
          return await this.handleSetQuantity(ctx, action.product_name, quantity);
      }
    }

    return await this.buildUpdatedOrderResponse(ctx);
  }

  private async handleRemoveProduct(
    ctx: WebhookContext, 
    productName: string, 
    quantity: number
  ): Promise<HandlerResult | null> {
    
    const entry = ctx.payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const from = value?.messages?.[0]?.from;
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!phoneNumberId || !from) return null;

    const { findBusinessByPhoneNumberId, findOrCreateCustomer, createOrGetOpenConversation } = await import('../../../repositories');
    const business = await findBusinessByPhoneNumberId(phoneNumberId);
    if (!business) return null;

    const customer = await findOrCreateCustomer(business.id, from);
    const conversation = await createOrGetOpenConversation(business.id, customer.id);

    const result = await buildConfirmRemoveItemMessage(
      business,
      conversation,
      productName
    );

    if (result.errorMessage) {
      return this.textResponse(result.errorMessage);
    }

    return this.interactiveResponse(result.message!);
  }

  private async handleAddProduct(ctx: WebhookContext, productName: string, quantity: number): Promise<HandlerResult | null> {
    // TODO: Implementar flujo de agregar producto
    return this.textResponse(`Agregar ${quantity} de ${productName}`);
  }

  private async handleSetQuantity(ctx: WebhookContext, productName: string, quantity: number): Promise<HandlerResult | null> {
    // TODO: Implementar flujo de cambiar cantidad
    return this.textResponse(`Cambiar cantidad de ${productName} a ${quantity}`);
  }

  private buildClarificationList(items: Array<{ name: string; quantity: number }>): HandlerResult {
    // TODO: Implementar lista de clarificación con botones
    return this.textResponse('¿Cuál producto querés modificar? ' + items.map(i => i.name).join(', '));
  }

  private async buildUpdatedOrderResponse(ctx: WebhookContext): Promise<HandlerResult | null> {
    // TODO: Implementar respuesta de pedido actualizado
    return this.textResponse('Pedido actualizado');
  }
}