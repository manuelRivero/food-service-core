import { WhatsAppInteractiveMessage, WhatsAppListMessage } from "src/domain/intent/whatsappTemplates";

export interface WhatsAppWebhookPayload {
    entry: Array<{
      changes: Array<{
        value: {
          metadata: { phone_number_id: string };
          messages: Array<{
            from: string;
            type: string;
            interactive?: {
              button_reply?: { id: string };
              list_reply?: { id: string };
            };
            text?: { body: string };
          }>;
        };
      }>;
    }>;
  }
  
  export interface WebhookContext {
    payload: WhatsAppWebhookPayload;
    phoneNumberId: string;
    to: string;
    message: any;
    value: any;
    payloadId: string | undefined;
  }
  
  export type WhatsAppResponseMessage = WhatsAppListMessage | WhatsAppInteractiveMessage | string;
  // TODOS los handlers deben devolver esto
  export interface HandlerResult {
    content: WhatsAppResponseMessage;
    isInteractive: boolean;  // true = sendInteractiveMessage, false = sendResponse
  }
  
  export interface WebhookHandler {
    readonly command: string;
    matches(payloadId: string): boolean;
    execute(ctx: WebhookContext): Promise<HandlerResult | null>;
  }