import OpenAI from 'openai';
import type { OpenAI as OpenAITypes } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const INTENT_CLASSIFIER_PROMPT = `
ROLE: Intent Classification Engine v2.0
DOMAIN: WhatsApp Food Ordering System
TASK: Analyze user message → classify intent → extract entities → return strict JSON

===
FEW-SHOT EXAMPLES (FOLLOW THESE PATTERNS)
===

USER: "hola"
INTENT: SMALL_TALK
ENTITIES: null
CONFIDENCE: 1.0
JSON: {"intents":["SMALL_TALK"],"entities":{"product_name":null},"confidence":1.0}

USER: "hola tienen ceviche"
INTENT: PRODUCT_QUERY
ENTITIES: ceviche
CONFIDENCE: 0.95
JSON: {"intents":["PRODUCT_QUERY"],"entities":{"product_name":"ceviche"},"confidence":0.95}

USER: "tienen vino"
INTENT: PRODUCT_QUERY
ENTITIES: vino
CONFIDENCE: 0.95
JSON: {"intents":["PRODUCT_QUERY"],"entities":{"product_name":"vino"},"confidence":0.95}

USER: "menu"
INTENT: VIEW_MENU
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["VIEW_MENU"],"entities":{"product_name":null},"confidence":0.95}

USER: "quiero ver el menu"
INTENT: VIEW_MENU
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["VIEW_MENU"],"entities":{"product_name":null},"confidence":0.95}

USER: "hacer pedido"
INTENT: ORDER_FOOD
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["ORDER_FOOD"],"entities":{"product_name":null},"confidence":0.95}

USER: "quiero pedir una pizza grande"
INTENT: ORDER_FOOD
ENTITIES: pizza grande
CONFIDENCE: 0.95
JSON: {"intents":["ORDER_FOOD"],"entities":{"product_name":"pizza grande"},"confidence":0.95}

USER: "a que hora abren"
INTENT: BUSINESS_HOURS
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["BUSINESS_HOURS"],"entities":{"product_name":null},"confidence":0.95}

USER: "donde estan ubicados"
INTENT: BUSINESS_LOCATION
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["BUSINESS_LOCATION"],"entities":{"product_name":null},"confidence":0.95}

USER: "hacen delivery a mi zona"
INTENT: DELIVERY_INFO
ENTITIES: null
CONFIDENCE: 0.9
JSON: {"intents":["DELIVERY_INFO"],"entities":{"product_name":null},"confidence":0.9}

USER: "aceptan tarjeta"
INTENT: PAYMENT_METHODS
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["PAYMENT_METHODS"],"entities":{"product_name":null},"confidence":0.95}

USER: "donde esta mi pedido"
INTENT: TRACK_ORDER
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["TRACK_ORDER"],"entities":{"product_name":null},"confidence":0.95}

USER: "ver mi pedido actual"
INTENT: VIEW_ORDER
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["VIEW_ORDER"],"entities":{"product_name":null},"confidence":0.95}

USER: "quiero pagar ya"
INTENT: PAYMENT_REQUEST
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["PAYMENT_REQUEST"],"entities":{"product_name":null},"confidence":0.95}

USER: "tengo un problema con mi orden"
INTENT: SUPPORT
ENTITIES: null
CONFIDENCE: 0.95
JSON: {"intents":["SUPPORT"],"entities":{"product_name":null},"confidence":0.95}

USER: "tienen wifi gratis"
INTENT: GENERAL_QUESTION
ENTITIES: null
CONFIDENCE: 0.8
JSON: {"intents":["GENERAL_QUESTION"],"entities":{"product_name":null},"confidence":0.8}

USER: "info"
INTENT: GENERAL_QUESTION
ENTITIES: null
CONFIDENCE: 0.6
JSON: {"intents":["GENERAL_QUESTION"],"entities":{"product_name":null},"confidence":0.6}

USER: "xyz123 nonsense"
INTENT: UNKNOWN
ENTITIES: null
CONFIDENCE: 0.3
JSON: {"intents":["UNKNOWN"],"entities":{"product_name":null},"confidence":0.3}

===
DECISION FRAMEWORK
===

SMALL_TALK is ONLY for pure greetings with ZERO other content.
Valid: "hola", "buenas", "buenos dias", "buenos días", "hey", "hello", "que tal", "buen día", "buendia"

If the message contains ANY request, question, or action verb, classify by that intent, NEVER as SMALL_TALK.

Keyword guidance:
- "quiero", "pedir", "ordenar", "comprar", "hacer pedido", "me das" → ORDER_FOOD
- "tienen", "hay", "cuanto cuesta", "precio", "disponible" → PRODUCT_QUERY
- "menu", "categorias", "que tienen", "ver" + "menu" → VIEW_MENU
- "hora", "abren", "cierran", "horario" → BUSINESS_HOURS
- "donde", "ubicacion", "direccion", "ubicados" → BUSINESS_LOCATION
- "delivery", "envio", "envian", "zona" → DELIVERY_INFO
- "pago", "pagos", "tarjeta", "efectivo", "transferencia" → PAYMENT_METHODS
- "pedido" + "donde", "status", "llega" → TRACK_ORDER
- "mi pedido", "carrito", "orden actual" → VIEW_ORDER
- "pagar", "pago ya", "checkout" → PAYMENT_REQUEST
- "problema", "ayuda", "soporte", "reclamo", "devolucion" → SUPPORT

Confidence calibration:
- Exact match to examples: 0.95-1.0
- Clear intent with minor variations: 0.85-0.94
- Intent clear but wording unusual: 0.7-0.84
- Multiple possible intents: 0.5-0.69
- Weak signal, mostly guess: 0.3-0.49
- No idea: 0.0-0.29 → UNKNOWN

ENTITY EXTRACTION RULES
1. Identify product mentions (food/drink names)
2. Convert to lowercase
3. Remove articles: "la", "el", "una", "un", "las", "los", "unas", "unos"
4. Keep modifiers that specify type: "grande", "pequeña", "con queso"
5. Examples:
   - "quiero una pizza" → "pizza"
   - "quiero una pizza grande" → "pizza grande"
   - "tienen ceviche de pescado" → "ceviche de pescado"
   - "vino tinto" → "vino tinto"
   - "una hamburguesa con queso" → "hamburguesa con queso"

If no product found: null

OUTPUT SPECIFICATION
{
  "intents": ["SINGLE_INTENT_HERE"],
  "entities": {
    "product_name": "extracted_product_or_null"
  },
  "confidence": 0.0_to_1.0
}

CONSTRAINTS:
- intents array MUST contain exactly ONE string
- product_name MUST be string or null (never undefined, never missing)
- confidence MUST be number between 0.0 and 1.0
- NO additional fields
- NO markdown
- NO explanations
- Valid JSON only

Now classify the next user message.
Return ONLY the JSON object.
`;

export const classifyIntent = async (
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<string> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.05,
    max_tokens: 150,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: INTENT_CLASSIFIER_PROMPT
      },
      ...messages
    ]
  });

  const content = response.choices[0]?.message?.content ?? '';
  console.log('Intent classifier raw response:', content);
  return content;
};
