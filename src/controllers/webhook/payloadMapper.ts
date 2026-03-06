// payloadIntentMapper.ts

import { IntentDetectionResult } from '../../services/ai/detection.service';
import { ConversationIntent } from '../../types/conversationIntent';

export const detectIntentFromPayload = (
    payloadId: string
  ): IntentDetectionResult | null => {
  
    // Prefijos con ID dinámico
    if (payloadId.startsWith('SELECT_PRODUCT:')) {
      return buildInteractiveResult(
        ConversationIntent.SELECT_PRODUCT,
        payloadId
      );
    }
  
    if (payloadId.startsWith('SELECT_ORDER_PRODUCT:')) {
      return buildInteractiveResult(
        ConversationIntent.SELECT_ORDER_PRODUCT,
        payloadId
      );
    }
  
    if (payloadId.startsWith('ADD_ITEM:')) {
      return buildInteractiveResult(
        ConversationIntent.ADD_ITEM,
        payloadId,
        1
      );
    }
    if (payloadId.startsWith('CONFIRM_REMOVE:')) {
        return buildInteractiveResult(
          ConversationIntent.CONFIRM_REMOVE,
          payloadId
        );
      }
      if (payloadId.startsWith('CONFIRM_ADD:')) {
        return buildInteractiveResult(
          ConversationIntent.CONFIRM_ADD,
          payloadId
        );
      }

      if (payloadId.startsWith('SELECT_CART_ITEM:')) {
        return buildInteractiveResult(
          ConversationIntent.SELECT_CART_ITEM,
          payloadId
        );
      }
      if (payloadId.startsWith('INCREASE_ITEM_QUANTITY:')) {
        return buildInteractiveResult(
          ConversationIntent.INCREASE_ITEM_QUANTITY,
          payloadId
        );
      }
      if (payloadId.startsWith('DECREASE_ITEM_QUANTITY:')) {
        return buildInteractiveResult(
          ConversationIntent.DECREASE_ITEM_QUANTITY,
          payloadId
        );
      }
      
      if (payloadId.startsWith('CANCEL_REMOVE:')) {
        return buildInteractiveResult(
          ConversationIntent.CANCEL_REMOVE,
          payloadId
        );
      }

      if (payloadId.startsWith('CATEGORY_LIST_PAGE:')) {
        return buildInteractiveResult(
          ConversationIntent.CATEGORY_LIST_PAGE,
          payloadId
        );
      }

      if (payloadId.startsWith('CATEGORY:')) {
        return buildInteractiveResult(
          ConversationIntent.CATEGORY,
          payloadId
        );
      }

        if (payloadId.startsWith('ORDER_SEARCH_PAGE:')) {
          return buildInteractiveResult(
            ConversationIntent.ORDER_SEARCH_PAGE,
            payloadId
          );
        }

  
    // IDs estáticos
    const staticMap: Record<string, ConversationIntent> = {
      ORDER_SEARCH_PAGE: ConversationIntent.ORDER_SEARCH_PAGE,
      CHECKOUT: ConversationIntent.CHECKOUT,
      CANCEL_ORDER: ConversationIntent.CANCEL_ORDER,
      END_CONVERSATION: ConversationIntent.END_CONVERSATION,
      VIEW_MENU_RETURN: ConversationIntent.VIEW_MENU_RETURN,
      VIEW_MENU: ConversationIntent.VIEW_MENU,
      VIEW_CATEGORIES: ConversationIntent.VIEW_CATEGORIES,
      VIEW_CART_FOR_EDITION: ConversationIntent.VIEW_CART_FOR_EDITION,
      VIEW_ORDER: ConversationIntent.VIEW_ORDER
    };
  
    if (staticMap[payloadId]) {
      return buildInteractiveResult(staticMap[payloadId], payloadId);
    }
  
    return null;
  };

  const buildInteractiveResult = (
    intent: ConversationIntent,
    raw: string,
    quantity: number | null = null,
    productId: string | null = null
  ): IntentDetectionResult & { productId: string | null } => ({
    intent,
    confidence: 1,
    detectedProductName: null,
    quantity,
    candidates: [],
    raw,
    productId
  });