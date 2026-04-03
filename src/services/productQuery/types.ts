import type {
  WhatsAppInteractiveMessage,
  WhatsAppListMessage,
} from '../../domain/intent/whatsappTemplates';

export type ConversationMetadata = {
  pendingProductSelection?: boolean;
  pendingQuestion?: string;
  candidateProductIds?: string[];
  /**
   * Personas/comensales de contexto de sesión (persiste durante el pedido).
   * Reemplaza el uso temporal de solo product query.
   */
  requestedPartySize?: number;
  /** @deprecated Lectura legacy; preferir requestedPartySize. */
  pendingProductQueryQuantity?: number;
};

export type ConversationMode = 'GLOBAL' | 'FILTER_SET' | 'PRODUCT_FOCUS';

export type ProductQueryServiceResult =
  | string
  | WhatsAppListMessage
  | WhatsAppInteractiveMessage
  | null;
