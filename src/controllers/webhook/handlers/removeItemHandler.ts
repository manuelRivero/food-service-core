// src/controllers/webhook/handlers/removeItemHandler.ts

import { IntentHandler, EnrichedContext, HandlerResult, IntentClassification } from '../types';
import { textResponse, interactiveResponse, noResponse, parseProductId } from '../utils';
import { buildConfirmRemoveItemMessage } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class RemoveItemHandler implements IntentHandler {
  readonly command = ConversationIntent.REMOVE_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.REMOVE_ITEM;
  }

  async execute(
    ctx: EnrichedContext, 
  ): Promise<HandlerResult | null> {
    console.log('[RemoveItemHandler] Executing', ctx.detection);
    const productId = parseProductId(ctx.payloadId!);
    
    if (!productId) {
      console.log('[RemoveItemHandler] No product name detected');
      return textResponse('¿Qué producto querés remover de tu pedido? Decime el nombre.');
    }

    console.log('[RemoveItemHandler] Removing:', productId);

    const result = await buildConfirmRemoveItemMessage(
      ctx.business,
      ctx.conversation,
      productId
    );
    
    if (result.errorMessage) {
      console.log('[RemoveItemHandler] Error:', result.errorMessage);
      return textResponse(result.errorMessage);
    }
    
    if (!result.message) {
      return noResponse();
    }

    console.log('[RemoveItemHandler] Confirmation built');
    return interactiveResponse(result.message);
  }
}