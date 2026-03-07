// src/webhooks/orchestrator.ts

import { extractContext } from './extractor';
import { dispatchIntent, dispatchInteractive } from './dispachers';
import { sendResponse } from './sender';
import { detectIntentWithConfidence, DetectionContext } from '../../services/ai/detection.service';
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
import { EnrichedContext, IntentClassification, WebhookContext } from './types';
import { refreshDraftOrderTimeout } from 'src/services/draftOrderTimeout.service';

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
  
      // 🔹 Construir contexto enriquecido (para ambos caminos)
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
       
      const userPhone = customer.phone_number;

      const draftOrder = await prisma.draft_order.findFirst({
        where: {
          business_id: business.id,
          customer_phone: customer.phone_number,
          status: 'active'
        }
      });
      if (draftOrder) {
        await refreshDraftOrderTimeout(draftOrder.id);
      }
      // =========================================================
      // 🟢 CASO 1: INTERACTIVE
      // =========================================================
      if (ctx.message?.type === 'interactive') {
        console.log('[Orchestrator] Route: Interactive');
        console.log('[Orchestrator] Enriched base:', enrichedBase);
        const result = await dispatchInteractive(enrichedBase);
        console.log('[Orchestrator] Result:', result);
        if (result) {
          await sendResponse(ctx, result);
  
          if (typeof result.content === 'string') {
            await createConversationMessage(
              conversation.id,
              'ai',
              result.content,
              true
            );
          }
  
          await updateConversationLastMessageAt(conversation.id);
        }
  
        return;
      }
  
      // =========================================================
      // 🔵 CASO 2: TEXT → NLP
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
  
        if (typeof result.content === 'string') {
          await createConversationMessage(
            conversation.id,
            'ai',
            result.content,
            true
          );
        }
  
        await updateConversationLastMessageAt(conversation.id);
      }
  
    } catch (error) {
      console.error('[Orchestrator] Unhandled error:', error);
    }
  };

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

const processTextMessage = async (
    ctx: WebhookContext,
    conversationId: string
): Promise<void> => {

    try {
        // Obtener contexto completo de la conversación
        const contextData = await buildDetectionContext(conversationId, ctx);
        if (!contextData) {
            console.error('[NLP] Failed to build context');
            return;
        }

        const { conversation, business, customer, conversationState, recentMessages } = contextData;

        // Preparar mensaje para detección
        const userMessage = ctx.message?.text?.body || '';

        // Detectar intención
        const detectionContext: DetectionContext = {
            conversationMode: (conversationState as any).mode || 'GLOBAL',
            lastReferencedProductId: conversation.lastReferencedProductId,
            candidateProductIds: (conversationState.metadata as any)?.candidateProductIds || null,
            recentMessages: recentMessages.map(m => m.message),
            lastReferencedProductName: (conversationState.metadata as any)?.lastReferencedProductName || null
        };

        console.log('[NLP] Detecting intent for:', userMessage.substring(0, 50));

        const detection = await detectIntentWithConfidence(userMessage, detectionContext);
        if (
            shouldBreakProductFocus(
                userMessage,
                detection.intent,
                conversationState.mode
            )
        ) {
            console.log('[Context] Breaking PRODUCT_FOCUS due to explicit search');

            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastReferencedProductId: null }
            });

            await prisma.conversation_state.update({
                where: { conversation_id: conversation.id },
                data: {
                    mode: 'GLOBAL',
                    metadata: {
                        ...(JSON.parse(JSON.stringify(conversationState.metadata)) || {}),
                        candidateProductIds: null,
                        pendingProductSelection: false,
                        pendingQuestion: null
                    }
                }
            });
        }
        console.log('[NLP] Detection result:', {
            intent: detection.intent,
            confidence: detection.confidence,
            product: detection.detectedProductName,
            quantity: detection.quantity
        });

        // Aplicar context clearing si aplica
        await maybeClearContext(
            detection.intent,
            detection.detectedProductName,
            conversation,
            conversationState
        );

        // Enriquecer contexto para handlers
        const enrichedCtx = {
            ...ctx,
            detection,
            conversation,
            business,
            customer,
            conversationState,
            conversationId
        };

        // Dispatch por intención
        const result = await dispatchIntent(enrichedCtx);
        console.log('[NLP] Result:', result);

        if (result) {
            await sendResponse(ctx, result);

            // Guardar respuesta AI en DB si es mensaje de texto
            if (typeof result.content === 'string') {
                await createConversationMessage(conversation.id, 'ai', result.content, true);
            } else {
                // Para mensajes interactivos, guardar descripción
                const description = (result.content as any)?.body?.text as any
                    || (result.isInteractive as any)?.body?.text as any
                    || '[interactive response]';
                await createConversationMessage(conversation.id, 'ai', description, true);
            }

            await updateConversationLastMessageAt(conversation.id);
        } else {
            console.log('[NLP] No handler produced result for intent:', detection.intent);

            // Fallback genérico
            const fallbackText = '*No entendí bien tu pregunta, aun estoy aprendiendo.* \n\nElejí una opción para continuar';
            await sendResponse(ctx, {
                isInteractive: true,
                content: {
                    type: 'list',
                    title: '',
                    body: fallbackText,
                    footer: 'Selecciona una opción',
                    sections: [
                        {
                            title: 'Opciones',
                            rows: [
                                {
                                    id: 'VIEW_MENU',
                                    title: 'Ver menú',
                                    description: 'Ver el menú de la empresa'
                                },
                                {
                                    id: 'SUPPORT',
                                    title: 'Necesito ayuda',
                                    description: 'Necesito ayuda con mi pedido'
                                },
                                {
                                    id: 'CANCEL_ORDER',
                                    title: 'Cancelar pedido',
                                    description: 'Cancelar mi pedido'
                                },
                                {
                                    id: 'END_CONVERSATION',
                                    title: 'Finalizar conversación',
                                    description: 'Finalizar la conversación'
                                },
                                {
                                    id: 'BUSINESS_HOURS',
                                    title: 'Horarios de atención',
                                    description: 'Ver los horarios de atención de la empresa'
                                },
                                {
                                    id: 'PAYMENT_METHODS',
                                    title: 'metodos de pago',
                                    description: 'Ver los metodos de pago de la empresa'
                                },
                            ]
                        }
                    ]
                }
            });
            await createConversationMessage(conversation.id, 'ai', fallbackText, true);
            await updateConversationLastMessageAt(conversation.id);
        }

    } catch (error) {
        console.error('[NLP] Error processing text:', error);

        // Error graceful
        const errorText = '*Ups, se cruzaron mis cables pero estoy trabajando en resolverlo.* \n\nElejí una opción o realiza tu pregunta nuevamente.';
        await sendResponse(ctx, {
            isInteractive: true,
            content: {
                type: 'list',
                title: '',
                body: errorText,
                footer: 'Selecciona una opción',
                sections: [
                    {
                        title: 'Opciones',
                        rows: [
                            {
                                id: 'VIEW_MENU',
                                title: 'Ver menú',
                                description: 'Ver el menú de la empresa'
                            },
                            {
                                id: 'SUPPORT',
                                title: 'Necesito ayuda',
                                description: 'Necesito ayuda con mi pedido'
                            },
                            {
                                id: 'CANCEL_ORDER',
                                title: 'Cancelar pedido',
                                description: 'Cancelar mi pedido'
                            },
                            {
                                id: 'END_CONVERSATION',
                                title: 'Finalizar conversación',
                                description: 'Finalizar la conversación'
                            },
                            {
                                id: 'BUSINESS_HOURS',
                                title: 'Horarios de atención',
                                description: 'Ver los horarios de atención de la empresa'
                            },
                            {
                                id: 'PAYMENT_METHODS',
                                title: 'metodos de pago',
                                description: 'Ver los metodos de pago de la empresa'
                            },
                        ]
                    }
                ]
            }
        });
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
