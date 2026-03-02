// src/controllers/webhook/handlers/removeItemHandler.ts

import { IntentHandler, EnrichedContext, HandlerResult, IntentClassification } from '../types';
import { textResponse, interactiveResponse, noResponse } from '../utils';
import { buildConfirmRemoveItemMessage } from '../../../services/cart.service';
import { ConversationIntent } from '../../../types/conversationIntent';

export class RemoveItemHandler implements IntentHandler {
  readonly command = ConversationIntent.REMOVE_ITEM;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.REMOVE_ITEM;
  }

  async execute(
    ctx: EnrichedContext, 
    classification?: IntentClassification
  ): Promise<HandlerResult | null> {
    console.log('[RemoveItemHandler] Executing');
    const itemName = classification?.detectedProductName;
    
    if (!itemName) {
      console.log('[RemoveItemHandler] No product name detected');
      return textResponse('¿Qué producto querés remover de tu pedido? Decime el nombre.');
    }

    console.log('[RemoveItemHandler] Removing:', itemName);

    const result = await buildConfirmRemoveItemMessage(
      ctx.business,
      ctx.conversation,
      itemName
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