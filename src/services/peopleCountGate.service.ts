import type { IntentDetectionResult } from './ai/detection.service';
import type { ConversationMetadata } from './productQuery/types';
import { resolveRequestedPartySize } from './productQuery/utils';
import { ConversationIntent } from '../types/conversationIntent';

export const PEOPLE_COUNT_PROMPT_MESSAGE =
  '¿Para cuántas personas es el pedido? 👥';

export const PEOPLE_COUNT_INVALID_REPLY_MESSAGE =
  'Pasame un número (ej. 2 o 4). ¿Para cuántas personas es el pedido? 👥';

export type PeopleCountResumePayload = {
  userMessage: string;
  detection: IntentDetectionResult;
};

export function parsePeopleCountResume(
  meta: ConversationMetadata
): PeopleCountResumePayload | null {
  const raw = meta.peopleCountResume;
  if (!raw || typeof raw !== 'object') return null;
  const userMessage =
    typeof (raw as { userMessage?: unknown }).userMessage === 'string'
      ? (raw as { userMessage: string }).userMessage.trim()
      : '';
  const detection = (raw as { detection?: unknown }).detection;
  if (!userMessage || !detection || typeof detection !== 'object') return null;
  const intent = (detection as { intent?: unknown }).intent;
  if (typeof intent !== 'string') return null;
  return { userMessage, detection: detection as IntentDetectionResult };
}

/**
 * True si el intent de pedido/búsqueda requiere número de personas y aún no está definido.
 */
export function shouldBlockForMissingPeopleCount(params: {
  intent: ConversationIntent;
  metadata: ConversationMetadata;
  detectionQuantity: number | null | undefined;
}): boolean {
  const { intent, metadata, detectionQuantity } = params;
  if (
    intent !== ConversationIntent.ORDER_FOOD &&
    intent !== ConversationIntent.PRODUCT_QUERY
  ) {
    return false;
  }
  if (metadata.awaitingPeopleCount) return false;

  const effective = resolveRequestedPartySize(detectionQuantity, metadata);
  return effective == null || effective <= 0;
}
