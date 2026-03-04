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
  
    // IDs estáticos
    const staticMap: Record<string, ConversationIntent> = {
      ORDER_SEARCH_PAGE: ConversationIntent.ORDER_SEARCH_PAGE,
      CATEGORY_PAGE: ConversationIntent.CATEGORY_PAGE,
      CATEGORY_LIST_PAGE: ConversationIntent.CATEGORY_LIST_PAGE,
      CATEGORY: ConversationIntent.CATEGORY,
      CHECKOUT: ConversationIntent.CHECKOUT,
      CANCEL_ORDER: ConversationIntent.CANCEL_ORDER,
      END_CONVERSATION: ConversationIntent.END_CONVERSATION,
      VIEW_MENU_RETURN: ConversationIntent.VIEW_MENU_RETURN,
      VIEW_CATEGORIES: ConversationIntent.VIEW_CATEGORIES,
      CANCEL_REMOVE: ConversationIntent.CANCEL_REMOVE,
      VIEW_CART_FOR_EDITION: ConversationIntent.VIEW_CART_FOR_EDITION
    };
  
    if (staticMap[payloadId]) {
      return buildInteractiveResult(staticMap[payloadId], payloadId);
    }
  
    return null;
  };

  const buildInteractiveResult = (
    intent: ConversationIntent,
    raw: string,
    quantity: number | null = null
  ): IntentDetectionResult => ({
    intent,
    confidence: 1,
    detectedProductName: null,
    quantity,
    candidates: [],
    raw
  });