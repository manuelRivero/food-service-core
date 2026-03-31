// src/webhooks/orchestrator.ts

import { extractContext } from './extractor';
import { dispatchIntent, dispatchInteractive } from './dispachers';
import { sendResponse, sendResponseWithQrSequence } from './sender';
import { detectIntentWithConfidence, DetectionContext } from '../../services/ai/detection.service';
import {
  findBusinessByPhoneNumberId,
  findOrCreateCustomer,
  findDefaultCustomerAddress,
  createOrGetOpenConversation,
  createClosedConversationForOffHoursInbound,
  findOrCreateConversationState,
  createConversationMessage,
  updateConversationLastMessageAt,
  findLatestClosedConversationByCustomer,
  clearConversationIdleTimestamps,
  clearLastReferencedProductId,
  findRecentMessagesForDetectionContext,
  updateConversationState
} from '../../repositories';
import { ConversationIntent } from '../../types/conversationIntent';
import { EnrichedContext, WebhookContext } from './types';
import { normalizeToHandlerResult } from './utils';
import { AddressService } from '../../services/address.service';
import { handleReservationIntent } from '../../services/reservations';
import {
  formatClosedBusinessCustomerNotice,
  getBusinessOpenInfo
} from '../../services/businessHours.service';


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

    const business = await findBusinessByPhoneNumberId(ctx.phoneNumberId);
    if (!business) {
      console.error('[Orchestrator] Business not found:', ctx.phoneNumberId);
      return;
    }

    const customer = await findOrCreateCustomer(business.id, ctx.to);

    const businessStatus = await getBusinessOpenInfo({
      businessId: business.id,
      timezone: business.timezone
    });

    if (!businessStatus.isOpen) {
      await processInboundWhileBusinessClosed({
        ctx,
        business: { id: business.id, timezone: business.timezone },
        customer: { id: customer.id },
        nextOpenText: businessStatus.nextOpenText
      });
      return;
    }

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
      business: contextBusiness,
      customer: contextCustomer,
      conversationState,
      recentMessages
    } = contextData;

    const enrichedBase = {
      ...ctx,
      conversation,
      business: contextBusiness,
      customer: contextCustomer,
      conversationState,
      conversationId: conversation.id
    };

    const detectionContext: DetectionContext = {
      conversationMode: conversationState.mode || 'GLOBAL',
      lastReferencedProductId: conversation.lastReferencedProductId,
      candidateProductIds:
        (conversationState.metadata as any)?.candidateProductIds || null,
      recentMessages: recentMessages.map(m => m.message),
      lastReferencedProductName:
        (conversationState.metadata as any)?.lastReferencedProductName || null
    };

    const onboardingReminder =
      'Para continuar con un pedido necesito tu dirección.';

    const handledReservationWizard = await processReservationWizardIfActive({
      ctx,
      enrichedBase
    });
    if (handledReservationWizard) return;

    const handledOnboardingByState =
      await processOnboardingByConversationStateIfActive({
        ctx,
        enrichedBase,
        detectionContext,
        conversation,
        onboardingReminder
      });
    if (handledOnboardingByState) return;

    const hasAddress = await findDefaultCustomerAddress(customer.id);
    
    if (!hasAddress) {
      console.log('[Orchestrator] No address → start onboarding');
      await runOnboardingAddressCaptureFlow({
        ctx,
        enrichedBase,
        detectionContext,
        conversation,
        onboardingReminder
      });
      return;
    }
    // =========================================================
    // 🟢 CASO 1: INTERACTIVE (sin cambios)
    // =========================================================
    if (ctx.message?.type === 'interactive') {
      console.log('[Orchestrator] Route: Interactive');
      const result = await dispatchInteractive(enrichedBase);

      if (result) {
        await sendResponseWithQrSequence(ctx, result);
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

    const detection = await detectIntentWithConfidence(
      userMessage,
      detectionContext
    );

    console.log('[NLP] Detection result:', detection);
    console.log('[NLP] Resolution metadata:', {
      finalIntent: detection.intent,
      confidence: detection.confidence,
      source: detection.resolutionSource || 'unknown',
      topCandidate: detection.topCandidate || null,
      rescueMargin: detection.rescueMargin ?? null
    });

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

// -----------------------------------------------------------------------------
// Helpers (misma unidad de orquestación): normalización para persistir mensajes
// -----------------------------------------------------------------------------

/**
 * Convierte el mensaje crudo del webhook al string que guardamos en el historial
 * (`conversation_message`): cuerpo de texto, marcador `[interactive: id]` para
 * respuestas de botón/lista, `[location]` u otros tipos como `[nombreTipo]`.
 */
function formatInboundMessageForLog(
  message: WebhookContext['message'] | undefined
): string {
  if (!message) {
    return '[unknown]';
  }
  if (message.type === 'text') {
    return message.text?.body || '';
  }
  if (message.type === 'interactive') {
    const id =
      message.interactive?.button_reply?.id ||
      message.interactive?.list_reply?.id ||
      'unknown';
    return `[interactive: ${id}]`;
  }
  if (message.type === 'location') {
    return '[location]';
  }
  return `[${message.type || 'unknown'}]`;
}

/**
 * Comportamiento del bot cuando el negocio está fuera de horario:
 * guarda el mensaje entrante (reusando conversación cerrada o creando un stub),
 * y envía el aviso automático de cierre si el negocio tiene timezone configurado.
 */
async function processInboundWhileBusinessClosed(params: {
  ctx: WebhookContext;
  business: { id: string; timezone: string | null };
  customer: { id: string };
  nextOpenText: string | null;
}): Promise<void> {
  const { ctx, business, customer, nextOpenText } = params;
  const closedConversation = await findLatestClosedConversationByCustomer(
    customer.id,
    business.id
  );
  const conversationId = closedConversation?.id;
  const message = ctx.message;
  const messageContent = formatInboundMessageForLog(message);

  if (conversationId) {
    await createConversationMessage(
      conversationId,
      'user',
      messageContent,
      false,
      message?.id
    );
  } else {
    const created = await createClosedConversationForOffHoursInbound(
      business.id,
      customer.id
    );
    await createConversationMessage(
      created.id,
      'user',
      messageContent,
      false,
      message?.id
    );
  }

  const timezone = business.timezone?.trim();
  if (timezone) {
    const closedNotice = formatClosedBusinessCustomerNotice(nextOpenText);
    await sendResponse(ctx, {
      content: closedNotice,
      isInteractive: false
    });
  } else {
    console.warn(
      '[Orchestrator] Negocio sin timezone; no se envía aviso de cierre al cliente'
    );
  }
}

/**
 * Flujo de reserva por WhatsApp en curso (`conversation_state.metadata.reservation`):
 * ejecuta el wizard, envía respuesta (con secuencia QR si aplica) y persiste mensaje AI.
 * @returns `true` si había paso de reserva activo (el caller debe hacer `return` y no seguir al NLP).
 */
async function processReservationWizardIfActive(params: {
  ctx: WebhookContext;
  enrichedBase: WebhookContext & {
    conversation: { id: string };
    business: unknown;
    customer: unknown;
    conversationState: unknown;
    conversationId: string;
  };
}): Promise<boolean> {
  const { ctx, enrichedBase } = params;
  const reservationStep = (enrichedBase.conversationState as any)?.metadata?.reservation
    ?.step;
  if (!reservationStep) {
    return false;
  }

  const reservationResult = await handleReservationIntent(
    enrichedBase as EnrichedContext
  );
  if (reservationResult) {
    const handlerResult = normalizeToHandlerResult(reservationResult);
    await sendResponseWithQrSequence(ctx, handlerResult);
    await createConversationMessage(
      enrichedBase.conversation.id,
      'ai',
      typeof handlerResult.content === 'string'
        ? handlerResult.content
        : '[interactive]',
      true
    );
    await updateConversationLastMessageAt(enrichedBase.conversation.id);
  }
  return true;
}

type OnboardingOrchestratorBase = WebhookContext & {
  conversation: { id: string };
  business: unknown;
  customer: unknown;
  conversationState: unknown;
  conversationId: string;
};

/**
 * Captura de dirección / onboarding sin pasar por NLP completo: dirección en texto,
 * dispatch con recordatorio, o mensaje pidiendo dirección; si no es texto, dispatch con intención dummy.
 */
async function runOnboardingAddressCaptureFlow(params: {
  ctx: WebhookContext;
  enrichedBase: OnboardingOrchestratorBase;
  detectionContext: DetectionContext;
  conversation: { id: string };
  onboardingReminder: string;
}): Promise<void> {
  const { ctx, enrichedBase, detectionContext, conversation, onboardingReminder } =
    params;

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

  if (ctx.message?.type === 'text') {
    const userMessage = ctx.message?.text?.body || '';
    const detection = await detectIntentWithConfidence(
      userMessage,
      detectionContext
    );

    if (detection.addressText) {
      const serviceResult = await new AddressService().processWithAddressText(
        onboardingCtx,
        detection.addressText
      );
      if (serviceResult) {
        const handlerResult = normalizeToHandlerResult(serviceResult);
        await sendResponse(ctx, handlerResult);
        await createConversationMessage(
          conversation.id,
          'ai',
          typeof handlerResult.content === 'string'
            ? handlerResult.content
            : '[interactive]',
          true
        );
        await updateConversationLastMessageAt(conversation.id);
      }
      return;
    }

    if (detection.intent !== ConversationIntent.UNKNOWN) {
      const enrichedCtx: EnrichedContext = {
        ...enrichedBase,
        detection,
      };
      const result = await dispatchIntent(enrichedCtx);
      if (result) {
        if (typeof result.content === 'string') {
          result.content = `${result.content}\n\n${onboardingReminder}`;
        }
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

    const askResult = normalizeToHandlerResult(
      'Necesito tu dirección para continuar.\n\nIndicame calle y número o compartí tu ubicación.'
    );
    await sendResponse(ctx, askResult);
    await createConversationMessage(
      conversation.id,
      'ai',
      typeof askResult.content === 'string'
        ? askResult.content
        : '[interactive]',
      true
    );
    await updateConversationLastMessageAt(conversation.id);
    return;
  }

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
}

/**
 * Onboarding forzado por `metadata.onboarding_step` (bypass NLP general).
 * @returns `true` si aplicó (el caller debe hacer `return`).
 */
async function processOnboardingByConversationStateIfActive(params: {
  ctx: WebhookContext;
  enrichedBase: OnboardingOrchestratorBase;
  detectionContext: DetectionContext;
  conversation: { id: string };
  onboardingReminder: string;
}): Promise<boolean> {
  const metadata = (params.enrichedBase.conversationState as any)?.metadata;
  const onboardingStep = metadata?.onboarding_step;
  if (!onboardingStep) {
    return false;
  }

  console.log('[Orchestrator] Onboarding active → bypass NLP', {
    step: onboardingStep,
    hasTempAddress: Boolean(metadata?.temp_address),
    messageType: params.ctx.message?.type,
    payloadId: params.ctx.payloadId,
  });

  await runOnboardingAddressCaptureFlow(params);
  return true;
}

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

    const messageContent = formatInboundMessageForLog(message);
    const messageType =
      message && typeof message.type === 'string' ? message.type : 'unknown';

    // Guardar en DB
    await createConversationMessage(
      conversation.id,
      'user',
      messageContent,
      false,
      message?.id
    );

    await clearConversationIdleTimestamps(conversation.id);

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

    const recentMessages = await findRecentMessagesForDetectionContext(
      conversationId,
      conversation.started_at,
      5
    );

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

    if (conversation.lastReferencedProductId) {
      await clearLastReferencedProductId(conversation.id);
    }

    const currentMetadata = (conversationState.metadata as Record<string, unknown>) || {};
    const cleanedMetadata = {
      ...currentMetadata,
      candidateProductIds: null,
      pendingProductSelection: false,
      pendingQuestion: null
    };

    await updateConversationState(conversation.id, {
      mode: 'GLOBAL',
      metadata: cleanedMetadata
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
