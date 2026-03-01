// src/controllers/webhook/handlers/fallbackHandler.ts

import { IntentHandler, IntentClassification, HandlerResult, EnrichedContext, WebhookContext } from '../types';
import { generateAIResponse } from '../../../services/ai/openai.service';
import { 
  createConversationMessage,
  getRecentMessagesByConversationId,
  updateConversationLastMessageAt
} from '../../../repositories';
import { ConversationIntent } from 'src/types/conversationIntent';
import { textResponse } from '../utils';
import { ChatCompletionMessageParam } from 'openai/resources/index';

export class FallbackHandler implements IntentHandler {
  readonly command = ConversationIntent.UNKNOWN;
  
  canHandle(intent: string): boolean {
    return intent === ConversationIntent.UNKNOWN;
    return true; // Catch-all
  }

  async execute(
    ctx: EnrichedContext | WebhookContext,
    classification?: IntentClassification
  ): Promise<HandlerResult | null> {
    
    console.log('[FallbackHandler] Executing as last resort');

    // Intentar obtener datos del contexto
    let business: any = null;
    let conversation: any = null;
    let messageContent = '';

    if ('detection' in ctx) {
      // Contexto enriquecido
      business = ctx.business;
      conversation = ctx.conversation;
      messageContent = ctx.message?.text?.body || '';
    } else {
      // Contexto básico - no debería pasar, pero por seguridad
      messageContent = ctx.message?.text?.body || '';
    }

    if (!business || !conversation) {
      return textResponse('Disculpá, no pude procesar tu mensaje. Intentá de nuevo.');
    }

    // Generar respuesta genérica con LLM
    const history = await getRecentMessagesByConversationId(conversation.id, 5);
    const messages: ChatCompletionMessageParam[] = history.map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: m.message
    }));
    
    const response = await generateAIResponse(business, [
      ...messages,
      { role: 'user' as const, content: messageContent }
    ]);

    // Guardar respuesta
    await createConversationMessage(conversation.id, 'ai', response.content, true);
    await updateConversationLastMessageAt(conversation.id);

    return textResponse(response.content);
  }

  private async getRecentHistory(conversationId: string): Promise<any[]> {
    const { prisma } = await import('../../../lib/prisma');
    
    const messages = await prisma.conversation_message.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      take: 10
    });

    return messages.map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: m.message
    }));
  }
}