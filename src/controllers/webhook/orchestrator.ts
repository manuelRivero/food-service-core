// src/webhooks/orchestrator.ts

import { extractContext } from './extractor';
import { dispatchIntent, dispatchInteractive } from './dispachers';
import { sendResponse } from './sender';
import { detectIntentWithConfidence, DetectionContext, IntentDetectionResult } from '../../services/ai/detection.service';
import {
  findBusinessByPhoneNumberId,
  findOrCreateCustomer,
  createOrGetOpenConversation,
  findOrCreateConversationState,
  createConversationMessage,
  updateConversationLastMessageAt
} from '../../repositories';
import { prisma } from '../../lib/prisma';
import { ConversationIntent } from '../../types/conversationIntent';
import { EnrichedContext, WebhookContext } from './types';


export const processWebhook = async (payload: any): Promise<void> => {

  try {
    const ctx = extractContext(payload);
    console.log('[Orchestrator] Extracted context:', ctx);

    if (!ctx) {
      console.error('[Orchestrator] Invalid payload structure');
      await logFailedProcessing(payload, 'invalid_payload');
      return;
    }

    console.log('[Orchestrator] Processing message from:', ctx.to);

    // Persistir mensaje usuario
    const persistResult = await persistUserMessage(ctx);
    if (!persistResult) {
      console.error('[Orchestrator] Failed to persist message');
      return;
    }

    // Construir contexto enriquecido
    const contextData = await buildDetectionContext(
      persistResult.conversationId,
      ctx
    );

    if (!contextData) {
      console.error('[Orchestrator] Failed to build context');
      return;
    }

    const {
      conversation,
      business,
      customer,
      conversationState,
      recentMessages
    } = contextData;

    const enrichedBase = {
      ...ctx,
      conversation,
      business,
      customer,
      conversationState,
      conversationId: conversation.id
    };

    // =========================================================
    // 🛡️ PASO 0: FORCE ONBOARDING POR ESTADO
    // =========================================================

    const isOnboardingActive =
      (enrichedBase.conversationState?.metadata as any)?.onboarding_step;

    if (isOnboardingActive) {
      console.log('[Orchestrator] Onboarding active → bypass NLP');

      const onboardingCtx: EnrichedContext = {
        ...enrichedBase,
        detection: {
          intent: ConversationIntent.ONBOARDING_START, // dummy
          confidence: 1,
          detectedProductName: null,
          quantity: null,
          candidates: [],
          raw: null,
        },
      };

      const result = await dispatchIntent(onboardingCtx);

      if (result) {
        await sendResponse(ctx, result);
        await createConversationMessage(
          conversation.id,
          'ai',
          typeof result.content === 'string' ? result.content : '[interactive]',
          true
        );
        await updateConversationLastMessageAt(conversation.id);
      }

      return;
    }

    const hasAddress = await prisma.customer_address.findFirst({
      where: {
        customer_id: customer.id,
        is_default: true,
      },
    });
    
    if (!hasAddress) {
      console.log('[Orchestrator] No address → start onboarding');
    
      const onboardingCtx: EnrichedContext = {
        ...enrichedBase,
        detection: {
          intent: ConversationIntent.ONBOARDING_START,
          confidence: 1,
          detectedProductName: null,
          quantity: null,
          candidates: [],
          raw: null,
        },
      };
    
      const result = await dispatchIntent(onboardingCtx);
    
      if (result) {
        await sendResponse(ctx, result);
        await createConversationMessage(
          conversation.id,
          'ai',
          typeof result.content === 'string' ? result.content : '[interactive]',
          true
        );
        await updateConversationLastMessageAt(conversation.id);
      }
    
      return;
    }
    // =========================================================
    // 🟢 CASO 1: INTERACTIVE (sin cambios)
    // =========================================================
    if (ctx.message?.type === 'interactive') {
      console.log('[Orchestrator] Route: Interactive');
      const result = await dispatchInteractive(enrichedBase);

      if (result) {
        await sendResponse(ctx, result);
        await createConversationMessage(
          conversation.id,
          'ai',
          typeof result.content === 'string' ? result.content : '[interactive]',
          true
        );
        await updateConversationLastMessageAt(conversation.id);
      }
      return;
    }

    // =========================================================
    // 🔵 CASO 2: TEXT → NLP (con onboarding pasado)
    // =========================================================
    console.log('[Orchestrator] Route: NLP (text message)');

    const userMessage = ctx.message?.text?.body || '';

    const detectionContext: DetectionContext = {
      conversationMode: conversationState.mode || 'GLOBAL',
      lastReferencedProductId: conversation.lastReferencedProductId,
      candidateProductIds:
        (conversationState.metadata as any)?.candidateProductIds || null,
      recentMessages: recentMessages.map(m => m.message),
      lastReferencedProductName:
        (conversationState.metadata as any)?.lastReferencedProductName || null
    };

    const detection = await detectIntentWithConfidence(
      userMessage,
      detectionContext
    );

    console.log('[NLP] Detection result:', detection);

    const enrichedCtx: EnrichedContext = {
      ...enrichedBase,
      detection
    };

    const result = await dispatchIntent(enrichedCtx);

    if (result) {
      await sendResponse(ctx, result);
      await createConversationMessage(
        conversation.id,
        'ai',
        typeof result.content === 'string' ? result.content : '[interactive]',
        true
      );
      await updateConversationLastMessageAt(conversation.id);
    }

  } catch (error) {
    console.error('[Orchestrator] Unhandled error:', error);
  }
};

// ... resto de funciones sin cambios (persistUserMessage, buildDetectionContext, etc.) ...

interface PersistResult {
  success: boolean;
  conversationId: string;
  businessId: string;
  customerId: string;
}

const persistUserMessage = async (
  ctx: WebhookContext
): Promise<PersistResult | null> => {
  try {
    const { phoneNumberId, to, message } = ctx;

    if (!phoneNumberId || !to) {
      console.error('[Persist] Missing phoneNumberId or to');
      return null;
    }

    const business = await findBusinessByPhoneNumberId(phoneNumberId);
    if (!business) {
      console.error('[Persist] Business not found:', phoneNumberId);
      return null;
    }

    const customer = await findOrCreateCustomer(business.id, to);
    const conversation = await createOrGetOpenConversation(business.id, customer.id);

    // Extraer contenido del mensaje
    let messageContent = '';
    let messageType = 'unknown';

    if (message?.type === 'text') {
      messageContent = message.text?.body || '';
      messageType = 'text';
    } else if (message?.type === 'interactive') {
      const interactiveId = message.interactive?.button_reply?.id
        || message.interactive?.list_reply?.id;
      messageContent = `[interactive: ${interactiveId || 'unknown'}]`;
      messageType = 'interactive';
    } else {
      messageContent = `[${message?.type || 'unknown'}]`;
    }

    // Guardar en DB
    await createConversationMessage(
      conversation.id,
      'user',
      messageContent,
      false,
      message?.id
    );

    await updateConversationLastMessageAt(conversation.id);

    console.log('[Persist] Message saved:', {
      conversationId: conversation.id,
      type: messageType,
      contentPreview: messageContent.substring(0, 50)
    });

    return {
      success: true,
      conversationId: conversation.id,
      businessId: business.id,
      customerId: customer.id
    };

  } catch (error) {
    console.error('[Persist] Error:', error);
    return null;
  }
};

const buildDetectionContext = async (
  conversationId: string,
  ctx: WebhookContext
) => {
  try {
    const { phoneNumberId, to } = ctx;

    const business = await findBusinessByPhoneNumberId(phoneNumberId);
    if (!business) return null;

    const customer = await findOrCreateCustomer(business.id, to);
    const conversation = await createOrGetOpenConversation(business.id, customer.id);
    const conversationState = await findOrCreateConversationState(conversation.id);

    // Obtener mensajes recientes para contexto
    const recentMessages = await prisma.conversation_message.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'desc' },
      take: 5
    });

    return {
      conversation,
      business,
      customer,
      conversationState,
      recentMessages
    };

  } catch (error) {
    console.error('[Context] Error building context:', error);
    return null;
  }
};

const maybeClearContext = async (
  intent: ConversationIntent,
  detectedProduct: string | null,
  conversation: any,
  conversationState: any
): Promise<void> => {

  // Intents que limpian contexto de producto
  const intentsToClear = new Set([
    ConversationIntent.SMALL_TALK,
    ConversationIntent.BUSINESS_HOURS,
    ConversationIntent.BUSINESS_LOCATION,
    ConversationIntent.DELIVERY_INFO,
    ConversationIntent.PAYMENT_METHODS,
    ConversationIntent.SUPPORT,
    ConversationIntent.CONFIRM_ADD,
    ConversationIntent.CONFIRM_REMOVE,
    ConversationIntent.UNKNOWN,
    ConversationIntent.CATEGORY,
    ConversationIntent.CATEGORY_LIST_PAGE,
    ConversationIntent.CHECKOUT,
    ConversationIntent.CANCEL_ORDER,
    ConversationIntent.END_CONVERSATION,
    ConversationIntent.VIEW_MENU,
    ConversationIntent.VIEW_CART,
    ConversationIntent.VIEW_ORDER,

  ]);

  const shouldClear = intentsToClear.has(intent)
    && !detectedProduct
    && (conversation.lastReferencedProductId || (conversationState.metadata as any)?.candidateProductIds?.length);

  if (!shouldClear) return;

  try {
    console.log('[Context] Clearing product context');

    // Limpiar lastReferencedProductId
    if (conversation.lastReferencedProductId) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastReferencedProductId: null }
      });
    }

    // Limpiar metadata
    const currentMetadata = (conversationState.metadata as any) || {};
    const cleanedMetadata = {
      ...currentMetadata,
      candidateProductIds: null,
      pendingProductSelection: false,
      pendingQuestion: null
    };

    await prisma.conversation_state.update({
      where: { conversation_id: conversationState.id },
      data: {
        mode: 'GLOBAL',
        metadata: cleanedMetadata
      }
    });

  } catch (error) {
    console.error('[Context] Error clearing context:', error);
  }
};

const shouldBreakProductFocus = (
  userMessage: string,
  intent: ConversationIntent,
  mode: string
): boolean => {

  if (mode !== 'PRODUCT_FOCUS') return false;

  if (intent !== ConversationIntent.PRODUCT_QUERY) return false;

  const lower = userMessage.toLowerCase();

  const explicitSearchPatterns = [
    'tienen',
    'hay',
    'quiero',
    'busco',
    'muestrame',
    'ver ',
    'algo con'
  ];

  return explicitSearchPatterns.some(pattern =>
    lower.includes(pattern)
  );
};

const logFailedProcessing = async (payload: any, reason: string): Promise<void> => {
  // Log simple para debug, podría guardar en DB para análisis
  console.error('[Orchestrator] Failed processing:', {
    payloadId: payload.payloadId,
    payload: payload,
    reason,
    timestamp: new Date().toISOString(),
    payloadKeys: Object.keys(payload || {})
  });
};
