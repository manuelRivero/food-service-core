import OpenAI from 'openai';
import type { OpenAI as OpenAITypes } from 'openai';
import { classifyIntent } from '../domain/intent/intentClassifier';
import { evaluateConfidence } from '../domain/intent/confidenceEvaluator';
import { ConversationIntent, IntentDetectionResult } from '../domain/intent/types';
import { normalizeIntent } from '../domain/intent/intentNormalizer';
import { parseIntentResult } from '../domain/intent/intentValidator';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const detectIntent = async (
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<ConversationIntent> => {
  const result = await detectIntentWithConfidence(messages);

  if (result.type === 'UNCERTAIN') {
    return result.candidates[0].intent;
  }

  return result.intent;
};

export const detectIntentWithConfidence = async (
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<IntentDetectionResult> => {
  const rawContent = await classifyIntent(messages);
  const parsedResult = parseIntentResult(rawContent);

  if (!parsedResult) {
    return {
      type: 'CONFIDENT',
      intent: ConversationIntent.UNKNOWN,
      confidence: 0,
      allIntents: [ConversationIntent.UNKNOWN],
      responseType: 'TEXT',
      content: ''
    };
  }

  const lastMessage = messages[messages.length - 1]?.content;
  const originalMessage = typeof lastMessage === 'string' ? lastMessage : '';

  return evaluateConfidence(parsedResult, originalMessage);
};
