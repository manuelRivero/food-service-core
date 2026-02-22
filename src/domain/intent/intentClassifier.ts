import OpenAI from 'openai';
import type { OpenAI as OpenAITypes } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const INTENT_CLASSIFIER_PROMPT = `
CLASSIFICATION TASK — WHATSAPP FOOD ORDERING

OUTPUT: Strict JSON only. No text. No markdown. No explanations.

===
FEW-SHOT CLASSIFICATIONS (COPY THESE PATTERNS)
===

"Tienen ceviche?" 
→ {"intents":["PRODUCT_QUERY"],"entities":{"product_name":"ceviche"},"confidence":0.95}

"Hay vino?"
→ {"intents":["PRODUCT_QUERY"],"entities":{"product_name":"vino"},"confidence":0.95}

"Cuanto cuesta la pizza?"
→ {"intents":["PRODUCT_QUERY"],"entities":{"product_name":"pizza"},"confidence":0.95}

"Menu"
→ {"intents":["VIEW_MENU"],"entities":{"product_name":null},"confidence":0.95}

"Ver categorias"
→ {"intents":["VIEW_MENU"],"entities":{"product_name":null},"confidence":0.95}

"Quiero pedir"
→ {"intents":["ORDER_FOOD"],"entities":{"product_name":null},"confidence":0.95}

"Hacer pedido"
→ {"intents":["ORDER_FOOD"],"entities":{"product_name":null},"confidence":0.95}

"Quiero una pizza grande"
→ {"intents":["ORDER_FOOD"],"entities":{"product_name":"pizza grande"},"confidence":0.95}

"A que hora abren?"
→ {"intents":["BUSINESS_HOURS"],"entities":{"product_name":null},"confidence":0.95}

"Donde estan ubicados?"
→ {"intents":["BUSINESS_LOCATION"],"entities":{"product_name":null},"confidence":0.95}

"Hacen delivery?"
→ {"intents":["DELIVERY_INFO"],"entities":{"product_name":null},"confidence":0.95}

"Aceptan tarjeta?"
→ {"intents":["PAYMENT_METHODS"],"entities":{"product_name":null},"confidence":0.95}

"Donde esta mi pedido?"
→ {"intents":["TRACK_ORDER"],"entities":{"product_name":null},"confidence":0.95}

"Ver mi pedido"
→ {"intents":["VIEW_ORDER"],"entities":{"product_name":null},"confidence":0.95}

"Quiero pagar"
→ {"intents":["PAYMENT_REQUEST"],"entities":{"product_name":null},"confidence":0.95}

"Tengo un problema"
→ {"intents":["SUPPORT"],"entities":{"product_name":null},"confidence":0.95}

"Tienen wifi?"
→ {"intents":["GENERAL_QUESTION"],"entities":{"product_name":null},"confidence":0.8}

"hola"
→ {"intents":["SMALL_TALK"],"entities":{"product_name":null},"confidence":1.0}

"buenas"
→ {"intents":["SMALL_TALK"],"entities":{"product_name":null},"confidence":1.0}

"hey"
→ {"intents":["SMALL_TALK"],"entities":{"product_name":null},"confidence":1.0}

"info"
→ {"intents":["GENERAL_QUESTION"],"entities":{"product_name":null},"confidence":0.6}

"xyz123"
→ {"intents":["UNKNOWN"],"entities":{"product_name":null},"confidence":0.3}

===
DECISION RULES (APPLY IN ORDER)
===

RULE 1: SMALL_TALK DETECTION
SMALL_TALK is ONLY for these exact words: "hola", "buenas", "buenos dias", "buenos días", "hey", "hello", "que tal", "buen día"

IF message is EXACTLY one of these → SMALL_TALK, confidence 1.0
ELSE → Continue to Rule 2

RULE 2: PRODUCT DETECTION
IF message contains food/drink names OR words: "tienen", "hay", "cuanto cuesta", "precio", "disponible"
THEN → PRODUCT_QUERY

Extract product name in lowercase, remove articles (la, el, una, un)

RULE 3: ACTION DETECTION
IF message contains: "quiero", "pedir", "ordenar", "comprar", "hacer pedido", "dame", "me das"
THEN → ORDER_FOOD

RULE 4: MENU NAVIGATION
IF message contains: "menu", "categorias", "ver", "que tienen", "opciones"
THEN → VIEW_MENU

RULE 5: BUSINESS INFO
- "hora", "abren", "cierran" → BUSINESS_HOURS
- "donde", "ubicacion", "direccion" → BUSINESS_LOCATION  
- "delivery", "envio", "envian", "zona" → DELIVERY_INFO
- "pago", "pagos", "tarjeta", "efectivo" → PAYMENT_METHODS

RULE 6: ORDER MANAGEMENT
- "pedido" + "donde", "status", "llega" → TRACK_ORDER
- "mi pedido", "carrito", "orden actual" → VIEW_ORDER
- "pagar", "pago ya", "checkout" → PAYMENT_REQUEST

RULE 7: SUPPORT
- "problema", "ayuda", "soporte", "reclamo" → SUPPORT

RULE 8: FALLBACK
IF no rule matches clearly → GENERAL_QUESTION (confidence 0.6) or UNKNOWN (confidence <0.5)

===
CONFIDENCE CALIBRATION
===

- Exact match to examples: 0.95-1.0
- Clear intent, slight variation: 0.85-0.94
- Intent likely but ambiguous: 0.7-0.84
- Weak signal: 0.5-0.69
- Cannot determine: 0.0-0.49 → UNKNOWN

===
ENTITY EXTRACTION
===

Product names:
- Convert to lowercase
- Remove: la, el, una, un, las, los, unas, unos
- Keep: size modifiers (grande, pequeña), preparation (con queso, sin cebolla)

Examples:
"quiero una pizza" → "pizza"
"quiero una pizza grande" → "pizza grande"
"tienen ceviche de pescado" → "ceviche de pescado"
"una hamburguesa con queso" → "hamburguesa con queso"

If no product: null

===
OUTPUT FORMAT
===

{
  "intents": ["SINGLE_INTENT_ONLY"],
  "entities": {"product_name": "extracted_product_or_null"},
  "confidence": 0.0_to_1.0
}

===
CLASSIFY THIS MESSAGE
===

Message: "{{USER_MESSAGE}}"

Apply Rule 1 first. If not SMALL_TALK, continue through rules.

JSON:
`;

const INTENT_PROMPT_VERSION = 'intent-classifier-v3';

export const classifyIntent = async (
  messages: OpenAITypes.Chat.ChatCompletionMessageParam[]
): Promise<string> => {
  console.log('Intent classifier prompt version:', INTENT_PROMPT_VERSION);
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
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
