import {
  ConversationIntent,
  IntentResult,
  IntentDetectionResult,
  CONFIDENCE_THRESHOLDS
} from './types';
import { INTENT_PRIORITY } from './intentNormalizer';
import {
  createIntentConfirmationList,
  type WhatsAppListMessage,
  LIST_OPTION_LABELS
} from './whatsappTemplates';

export function evaluateConfidence(
  intentResult: IntentResult,
  originalMessage: string
): IntentDetectionResult {
  const { intents, confidence } = intentResult;

  const sortedIntents = sortIntentsByPriority(intents);

  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
    return {
      type: 'CONFIDENT',
      intent: sortedIntents[0],
      confidence,
      allIntents: sortedIntents,
      responseType: 'TEXT',
      content: originalMessage
    };
  }

  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
    const topCandidates = sortedIntents.slice(0, 3).map((intent) => ({
      intent,
      confidence
    }));

    return {
      type: 'UNCERTAIN',
      candidates: topCandidates,
      originalMessage,
      responseType: 'LIST',
      listContent: generateConfirmationList(topCandidates)
    };
  }

  return {
    type: 'CONFIDENT',
    intent: ConversationIntent.UNKNOWN,
    confidence,
    allIntents: sortedIntents,
    responseType: 'TEXT',
    content: originalMessage
  };
}

function sortIntentsByPriority(
  intents: ConversationIntent[]
): ConversationIntent[] {
  return [...intents].sort((a, b) => {
    const indexA = INTENT_PRIORITY.indexOf(a);
    const indexB = INTENT_PRIORITY.indexOf(b);
    return indexA - indexB;
  });
}

export function generateConfirmationList(
  candidates: Array<{ intent: ConversationIntent; confidence: number }>
): WhatsAppListMessage {
  const mappedCandidates = candidates.map((candidate) => {
    const labelData = LIST_OPTION_LABELS[candidate.intent] ?? {
      title: candidate.intent,
      description: 'Selecciona esta opción'
    };

    return {
      intent: candidate.intent as string,
      label: labelData.title,
      description: labelData.description
    };
  });

  return createIntentConfirmationList(mappedCandidates);
}
