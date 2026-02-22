import { ConversationIntent } from '../../types/conversationIntent';

export const INTENT_ENUM_VALUES = [
  'ORDER_FOOD',
  'PRODUCT_QUERY',
  'VIEW_MENU',
  'VIEW_ORDER',
  'TRACK_ORDER',
  'PAYMENT_REQUEST',
  'SUPPORT',
  'GENERAL_QUESTION',
  'SMALL_TALK',
  'BUSINESS_HOURS',
  'BUSINESS_LOCATION',
  'DELIVERY_INFO',
  'PAYMENT_METHODS',
  'UNKNOWN'
] as const;

export const INTENT_PRIORITY: ConversationIntent[] = [
  ConversationIntent.ORDER_FOOD,
  ConversationIntent.PRODUCT_QUERY,
  ConversationIntent.VIEW_MENU,
  ConversationIntent.VIEW_ORDER,
  ConversationIntent.TRACK_ORDER,
  ConversationIntent.PAYMENT_REQUEST,
  ConversationIntent.SUPPORT,
  ConversationIntent.BUSINESS_HOURS,
  ConversationIntent.BUSINESS_LOCATION,
  ConversationIntent.DELIVERY_INFO,
  ConversationIntent.PAYMENT_METHODS,
  ConversationIntent.GENERAL_QUESTION,
  ConversationIntent.SMALL_TALK,
  ConversationIntent.UNKNOWN
];

export const normalizeIntent = (value: string): ConversationIntent => {
  const trimmed = value.trim().toUpperCase();

  switch (trimmed) {
    case ConversationIntent.SMALL_TALK:
    case ConversationIntent.VIEW_MENU:
    case ConversationIntent.VIEW_ORDER:
    case ConversationIntent.ASK_QUESTION:
    case ConversationIntent.ORDER_FOOD:
    case ConversationIntent.TRACK_ORDER:
    case ConversationIntent.PAYMENT_REQUEST:
    case ConversationIntent.SUPPORT:
    case ConversationIntent.BUSINESS_HOURS:
    case ConversationIntent.BUSINESS_LOCATION:
    case ConversationIntent.DELIVERY_INFO:
    case ConversationIntent.PAYMENT_METHODS:
    case ConversationIntent.PRODUCT_QUERY:
    case ConversationIntent.GENERAL_QUESTION:
    case ConversationIntent.UNKNOWN:
      return trimmed as ConversationIntent;
    default:
      return ConversationIntent.UNKNOWN;
  }
};

export const mapUnknownIntents = (intents: string[]): ConversationIntent[] => {
  const allowed = new Set<string>(INTENT_ENUM_VALUES);
  return intents.map((intent) => {
    const trimmed = intent.trim().toUpperCase();
    return allowed.has(trimmed)
      ? (trimmed as ConversationIntent)
      : ConversationIntent.UNKNOWN;
  });
};

export const selectHighestPriorityIntent = (
  intents: string[]
): ConversationIntent => {
  const normalized = intents.map((intent) => {
    const trimmed = intent.trim().toUpperCase();
    if (trimmed === 'BUSINESS_INFO') {
      return ConversationIntent.GENERAL_QUESTION;
    }
    return normalizeIntent(trimmed);
  });

  for (const candidate of INTENT_PRIORITY) {
    if (normalized.includes(candidate)) {
      return candidate;
    }
  }

  return ConversationIntent.UNKNOWN;
};
