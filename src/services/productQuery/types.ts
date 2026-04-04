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
  /** Alias explícito de personas (mismo valor que requestedPartySize cuando aplica). */
  peopleCount?: number;
  /** @deprecated Lectura legacy; preferir requestedPartySize. */
  pendingProductQueryQuantity?: number;
  /**
   * Última cantidad sugerida al elegir desde lista (recomendador); respaldo si el botón es ADD_ITEM sin :N.
   */
  lastListSuggestedQuantity?: number;
  /** Suma de quantity × serves_people (fallback 1) en el borrador activo; sincronizado al mutar carrito. */
  coveredPortions?: number;
  /** peopleCount − coveredPortions (mínimo 0); solo si hay N personas en contexto. */
  missingPortions?: number;
};

export type ConversationMode = 'GLOBAL' | 'FILTER_SET' | 'PRODUCT_FOCUS';

export type ProductQueryServiceResult =
  | string
  | WhatsAppListMessage
  | WhatsAppInteractiveMessage
  | null;
