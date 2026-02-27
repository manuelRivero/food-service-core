import { WhatsAppInteractiveMessage, WhatsAppListMessage } from '../../../domain/intent/whatsappTemplates';
import { WebhookContext, HandlerResult, WebhookHandler } from '../types';

export abstract class BaseHandler implements WebhookHandler {
    abstract readonly command: string;
    abstract matches(payloadId: string): boolean;
    abstract execute(ctx: WebhookContext): Promise<HandlerResult | null>;
  
    // Mensaje de texto plano
    protected textResponse(content: string): HandlerResult {
      return { content, isInteractive: false };
    }
  
    // Mensaje lista (list message)
    protected listResponse(listMessage: WhatsAppListMessage): HandlerResult {
      return { content: listMessage, isInteractive: true };
    }
  
    // Mensaje interactivo con botones
    protected interactiveResponse(interactiveMessage: WhatsAppInteractiveMessage): HandlerResult {
      return { content: interactiveMessage, isInteractive: true };
    }
  
    // Helper genérico para cualquier mensaje interactivo (si no sabes el tipo específico)
    protected rawInteractiveResponse(message: WhatsAppListMessage | WhatsAppInteractiveMessage): HandlerResult {
      return { content: message, isInteractive: true };
    }
  
    protected noResponse(): null {
      return null;
    }
  }