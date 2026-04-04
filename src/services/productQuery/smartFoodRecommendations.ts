import type { business as Business } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateAIResponse } from '../ai/openai.service';
import { MenuService, type MenuItemSearchResult } from '../menu.service';
import type { RecommendationCartSummary } from './recommendationCartSummary';

export type FoodRecommenderCandidate = {
  id: string;
  name: string;
  description: string | null;
  category: string;
};

export type SmartFoodRecommendation = {
  id: string;
  name: string;
  description: string | null;
  reason: string;
  /** Cantidad sugerida para agregar (1 si no aplica). */
  suggestedQuantity?: number;
};

export type GetSmartRecommendationsResult = {
  forDisplay: SmartFoodRecommendation[];
  /** Listado WhatsApp: alineado con el LLM (mismos ids y orden); en fallback, top 3 del vector. */
  forList: SmartFoodRecommendation[];
  usedLlm: boolean;
  /** Mensaje contextual opcional del LLM (porciones, cantidad, guía). Sin plantillas en código. */
  llmNote?: string | null;
  /** Resumen corto del estado del pedido / progreso (solo si el LLM lo devuelve). */
  llmProgress?: string | null;
};

const MAX_CANDIDATES_FOR_LLM = 10;
const MAX_LLM_PICKS = 3;
/** WhatsApp interactive list: max rows per section (API limit). */
export const MAX_WHATSAPP_LIST_ROWS = 10;
const TOP_FALLBACK_DISPLAY = 3;
const MAX_NOTE_LENGTH = 500;
const MAX_PROGRESS_LENGTH = 400;

const FALLBACK_REASON = 'Buena coincidencia con tu búsqueda.';

function stripCodeFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

type ParsedLlmRecommender = {
  recommendations: Array<{
    id: string;
    reason: string;
    suggestedQuantity?: number;
  }>;
  note: string | null;
  progress: string | null;
};

function clampSuggestedQuantity(n: unknown): number | undefined {
  if (n === null || n === undefined) return undefined;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  if (i < 1) return undefined;
  return Math.min(99, i);
}

function tryParseSmartRecommenderJson(raw: string): ParsedLlmRecommender | null {
  const trimmed = stripCodeFences(raw);
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const recs = (obj as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(recs)) return null;
    const out: ParsedLlmRecommender['recommendations'] = [];
    const seenIds = new Set<string>();
    for (const r of recs) {
      if (!r || typeof r !== 'object') continue;
      const id = (r as { id?: unknown }).id;
      const reason = (r as { reason?: unknown }).reason;
      if (typeof id !== 'string' || typeof reason !== 'string') continue;
      const idTrim = id.trim();
      if (idTrim.length === 0 || seenIds.has(idTrim)) continue;
      const reasonTrim = reason.trim();
      if (reasonTrim.length === 0) continue;
      seenIds.add(idTrim);
      const sq = clampSuggestedQuantity((r as { suggestedQuantity?: unknown }).suggestedQuantity);
      out.push({
        id: idTrim,
        reason: reasonTrim,
        ...(sq != null && sq > 1 ? { suggestedQuantity: sq } : {}),
      });
    }
    if (out.length === 0) return null;

    let note: string | null = null;
    if ('note' in obj) {
      const n = (obj as { note?: unknown }).note;
      if (n === null || n === undefined) {
        note = null;
      } else if (typeof n === 'string') {
        const t = n.trim();
        note = t.length > 0 ? t.slice(0, MAX_NOTE_LENGTH) : null;
      }
    }

    let progress: string | null = null;
    if ('progress' in obj) {
      const p = (obj as { progress?: unknown }).progress;
      if (p === null || p === undefined) {
        progress = null;
      } else if (typeof p === 'string') {
        const t = p.trim();
        progress = t.length > 0 ? t.slice(0, MAX_PROGRESS_LENGTH) : null;
      }
    }

    return { recommendations: out, note, progress };
  } catch {
    return null;
  }
}

/** Solo deduplicación técnica por id (preserva orden del vector). */
function dedupeById(items: MenuItemSearchResult[]): MenuItemSearchResult[] {
  const seen = new Set<string>();
  const out: MenuItemSearchResult[] = [];
  for (const item of items) {
    const id = String(item.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export function dedupeMenuItemSearchResultsById(
  items: MenuItemSearchResult[]
): MenuItemSearchResult[] {
  return dedupeById(items);
}

function dedupeSmartRecommendationsById(
  recs: SmartFoodRecommendation[]
): SmartFoodRecommendation[] {
  const seen = new Set<string>();
  const out: SmartFoodRecommendation[] = [];
  for (const r of recs) {
    const id = (r.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/**
 * Nombres/description desde el vector; descarta entradas sin id válido.
 * Máximo MAX_WHATSAPP_LIST_ROWS ítems (límite WhatsApp).
 */
function finalizeRecommendationsForWhatsAppList(
  recs: SmartFoodRecommendation[],
  byIdVector: Map<string, MenuItemSearchResult>
): SmartFoodRecommendation[] {
  const deduped = dedupeSmartRecommendationsById(recs);
  const out: SmartFoodRecommendation[] = [];
  for (const r of deduped) {
    if (out.length >= MAX_WHATSAPP_LIST_ROWS) break;
    const id = (r.id ?? '').trim();
    if (!id) continue;
    const src = byIdVector.get(id);
    const name = (src?.name ?? r.name ?? '').trim() || 'Producto';
    out.push({
      ...r,
      id,
      name,
      description: src?.description ?? r.description ?? null,
    });
  }
  return out;
}

function finalizeVectorItemsForWhatsAppList(
  items: MenuItemSearchResult[]
): MenuItemSearchResult[] {
  const deduped = dedupeById(items);
  const out: MenuItemSearchResult[] = [];
  for (const item of deduped) {
    if (out.length >= MAX_WHATSAPP_LIST_ROWS) break;
    const id = (item.id ?? '').trim();
    if (!id) continue;
    const name = (item.name ?? '').trim() || 'Producto';
    out.push({ ...item, id, name });
  }
  return out;
}

async function loadCategoryNamesByItemId(
  businessId: string,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.menu_item.findMany({
    where: { id: { in: ids }, business_id: businessId },
    select: {
      id: true,
      menu_category: { select: { name: true } },
    },
  });
  return new Map(
    rows.map((r) => [r.id, r.menu_category?.name?.trim() || 'Sin categoría'])
  );
}

function menuResultsToSmart(
  items: MenuItemSearchResult[],
  reason: string
): SmartFoodRecommendation[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    reason,
  }));
}

/**
 * Prompt: intención, carrito, personas, ranking — todo decidido por el LLM.
 */
export function FOOD_RECOMMENDER_PROMPT(
  userQuery: string,
  candidates: FoodRecommenderCandidate[],
  requestedPartySize: number | null | undefined,
  cartSummary: RecommendationCartSummary
): string {
  const lines = candidates
    .map((c, i) => {
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. id=${c.id} | categoría=${c.category} | nombre=${c.name}${desc ? ` | descripción=${desc}` : ''}`;
    })
    .join('\n');

  const partyLine =
    requestedPartySize != null && requestedPartySize > 0
      ? `Comensales de referencia (lo que el cliente mencionó; no implica que el listado ya cubra ese total): aproximadamente ${requestedPartySize}.`
      : 'Comensales de referencia: no indicado.';

  const cartJson = JSON.stringify(cartSummary);

  return `Sos asistente de un restaurante por WhatsApp. El mensaje del cliente es: "${userQuery}".

${partyLine}

Estado del carrito (única fuente de verdad sobre lo que hay en el borrador; suma de unidades por tipo de categoría):
${cartJson}
- starters = entradas (STARTER), mains = platos principales (MAIN), drinks = bebidas (DRINK), desserts = postres (DESSERT).
- Valores 0 = ninguna unidad de ese tipo en el borrador según el sistema. Si todo es 0, el carrito está vacío: no inventes ítems.

Tu rol: actuar como un mozo inteligente que ayuda a armar el pedido. Elegís SOLO entre los candidatos listados abajo (retrieval por similitud). Toda la explicación la generás vos; no hay otro texto automático fuera del JSON.

STATE RULES (obligatorio):
- NO asumas que el usuario ya tiene productos en el pedido salvo que el JSON muestre cantidades > 0 en algún campo.
- NO uses "ya tenés", "ya tienes", "tenés", "tienes", "tu pedido tiene", "tu pedido incluye", "completaste" ni afirmaciones similares sobre el estado del pedido, salvo que el JSON lo respalde explícitamente.
- Solo referí el pedido actual con los números del JSON; si no hay datos positivos, hablá solo de sugerencias posibles, no de lo que "ya" tiene.
- No inventes líneas de pedido, ni cantidades, ni que "agregó" algo.

INTENCIÓN vs ESTADO:
- Expresiones como "quiero pedir", "busco", "necesito", "para llevar" son intención o deseo, no confirmación de que el pedido ya existe. Respondé en tono de sugerencia, no de confirmación.

ENCABEZADOS Y GRUPO (obligatorio):
- NO uses "Para X personas:" ni variantes como título o primera línea en "reason", "note" ni "progress". Eso lo agrega el sistema después; suena a que las opciones ya alcanzan para X personas.
- Presentá las recomendaciones de forma neutra; el tamaño del grupo ya está en el contexto superior.

LENGUAJE (sugerencias, no afirmaciones sobre su pedido):
- Evitá: "ya tenés...", "tenés...", "tu pedido tiene..."
- Preferí: "podrías pedir...", "te recomiendo...", "una opción es...", "si querés sumar...", "podría servir para..."
- Si mencionás el grupo, hacelo en una frase aclaratoria, no como encabezado (ej.: orientación general, sin afirmar que el listado cubre ese número).

INTENT:
- Entendé el pedido del cliente y sus preferencias si se infieren del texto (ingredientes solo si constan en la ficha, etc.).
- Si hay personas en contexto, usalas como guía para sugerencias generales (sin asumir cantidades ya pedidas por el usuario).

CART AWARENESS (anclado al JSON):
- Mirá solo el resumen: qué tipos tienen cantidad > 0 y cuáles están en 0.
- Si falta un tipo relevante y hay candidatos, priorizá sugerir de ese tipo.
- Si hay cantidades > 0 pero bajas respecto a las personas, orientá con cautela ("para sumar", "podría ayudar a...") sin asumir más de lo que dice el JSON.
- Si hay bastante de un tipo según el JSON, podés sugerir diversificar o el siguiente paso lógico según el listado.

DECISION LOGIC (flexible, sin reglas rígidas en código):
- Si falta una categoría importante (según JSON) → sugerí ítems que la cubran.
- Si está parcialmente cubierta → sugerí completar con cautela, sin afirmar totales no mostrados.
- Si el JSON muestra bastante en un tipo → podés sugerir exploración o siguiente paso (bebida/postre) según el listado.

SELECTION BEHAVIOR:
- Preferí ofrecer 2 o 3 recomendaciones cuando haya al menos dos ítems razonablemente útiles.
- No seas demasiado estricto: incluí alternativas "bastante bien" o relacionadas si el listado las trajo por similitud.
- Equilibrá relevancia y diversidad.
- Devolvé una sola recomendación solo cuando el resto de candidatos sea claramente irrelevante para el pedido.

UNICIDAD Y SALIDA (obligatorio):
- Cada "id" de producto debe aparecer como máximo UNA vez en "recommendations". Nunca repitas el mismo id ni dupliques el mismo plato con distinta redacción.
- No incluyas razonamiento interno, cadena de pensamiento, notas para vos mismo ni texto meta fuera de los campos del JSON (reason, note, progress).
- Los valores "reason", "note" y "progress" son texto para el cliente: frases cortas y útiles, no explicaciones de proceso.

TRUTH RULES:
- Usá únicamente lo que se desprende con certeza razonable del nombre, categoría y descripción del ítem.
- NO asumas tamaño de porción, cuántas personas alcanza un plato ni si es para compartir, salvo que la ficha lo diga explícitamente.
- NO digas que un plato es "ideal para X personas" salvo que la ficha lo indique con claridad.
- Si no hay dato de porciones, usá lenguaje cauteloso: "puede servir", "depende del tamaño de la porción", etc.

ANTI-HALLUCINATION:
- No inventes: tamaños de porción, ingredientes no mencionados, idoneidad para N personas, alérgenos, tiempos, etc.

suggestedQuantity (por ítem, opcional, 1–99):
- No asumas cantidades previas del usuario ni "lo que ya pidió"; solo guiá por personas (si hay), carrito según JSON y ficha.
- Indicá cuántas unidades de ESE ítem podrían tener sentido como sugerencia prudente, sin pretender cerrar el pedido al detalle.
- Si no tiene sentido más de una unidad, omití el campo o usá 1.
- Con incertidumbre, preferí rangos conservadores (p. ej. 1–2 o 2–3) y explicá la cautela en "reason" si hace falta, sin afirmar números exactos obligatorios.

Campo "progress" (opcional, string corto):
- Resumen del estado según el JSON y el pedido del usuario (1–3 oraciones). Si el carrito está vacío (todo 0), indicá que aún no hay ítems en el borrador o enfocá en primeras sugerencias, sin decir que "ya tiene" platos.
- No empieces con "Para X personas:"; no presentes el tamaño del grupo como si las sugerencias ya cubrieran ese total.
- No repitas texto de los "reason" ni de "note".

Campo "note" (opcional):
- Orientación general (personas / sugerencias) sin repetir "progress" ni los "reason"; tono de recomendación, no de hechos sobre su pedido salvo lo que muestre el JSON.
- Una o dos oraciones máximo.

REDUNDANCY:
- Cada "reason" debe ser UNA sola oración breve; no repitas la misma idea entre ítems.

Candidatos (usá solo estos ids):
${lines}

Respondé SOLO JSON válido, sin markdown ni texto fuera del JSON, con esta forma:
{"recommendations":[{"id":"<uuid>","reason":"<una oración>","suggestedQuantity":2}],"note":null,"progress":null}
- "suggestedQuantity" es opcional por ítem.
- "note" y "progress" pueden ser null o string.`;
}

/**
 * Vector search (retrieval) + deduplicación por id; ranking, textos y metadatos solo vía LLM.
 */
export async function getSmartRecommendations(params: {
  userQuery: string;
  businessId: string;
  business: Business;
  vectorResults?: MenuItemSearchResult[];
  /** Personas/comensales ya inferidos o guardados en sesión. */
  requestedPartySize?: number | null;
  /** Resumen de unidades en el borrador (por tipo de categoría). */
  cartSummary: RecommendationCartSummary;
}): Promise<GetSmartRecommendationsResult> {
  const { userQuery, businessId, business } = params;
  const trimmedUtterance = userQuery.trim();

  const vectorItems =
    params.vectorResults ??
    (await MenuService.searchMenuItemsByKeyword({
      businessId,
      keyword: trimmedUtterance,
    }));

  if (vectorItems.length === 0) {
    return {
      forDisplay: [],
      forList: [],
      usedLlm: false,
      llmNote: null,
      llmProgress: null,
    };
  }

  const deduped = dedupeById(vectorItems);

  const llmFailureResult = (): GetSmartRecommendationsResult => {
    const safeRows = finalizeVectorItemsForWhatsAppList(deduped).slice(
      0,
      TOP_FALLBACK_DISPLAY
    );
    return {
      forDisplay: menuResultsToSmart(safeRows, FALLBACK_REASON),
      forList: menuResultsToSmart(safeRows, ''),
      usedLlm: false,
      llmNote: null,
      llmProgress: null,
    };
  };

  const useAi =
    business.openai_active !== false &&
    !business.ai_blocked &&
    trimmedUtterance.length > 0;

  if (!useAi) {
    const safeRows = finalizeVectorItemsForWhatsAppList(deduped).slice(
      0,
      TOP_FALLBACK_DISPLAY
    );
    return {
      forDisplay: [],
      forList: menuResultsToSmart(safeRows, FALLBACK_REASON),
      usedLlm: false,
      llmNote: null,
      llmProgress: null,
    };
  }

  const topForLlm = deduped.slice(0, MAX_CANDIDATES_FOR_LLM);
  const ids = topForLlm.map((i) => i.id);
  const categoryById = await loadCategoryNamesByItemId(businessId, ids);

  const candidates: FoodRecommenderCandidate[] = topForLlm.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: categoryById.get(row.id) ?? 'Sin categoría',
  }));

  const allowed = new Set(ids);
  const byIdVector = new Map(topForLlm.map((r) => [r.id, r]));

  try {
    const system =
      'Sos el motor de recomendación guiada del menú. Usás solo el carrito del JSON y las personas como contexto; no inventás datos de fichas ni del pedido. Nunca afirmes que el usuario "ya tiene" algo en el pedido si el JSON no muestra cantidades > 0. Respondés solo JSON: cada id en recommendations debe ser único (sin repetir). No incluyas razonamiento interno fuera del JSON. Campos: recommendations (reason, suggestedQuantity opcional), note y progress opcionales.';
    const user = FOOD_RECOMMENDER_PROMPT(
      trimmedUtterance,
      candidates,
      params.requestedPartySize,
      params.cartSummary
    );

    const { content } = await generateAIResponse(business, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    if (!content || content.includes('🚫') || content.includes('⚡')) {
      return llmFailureResult();
    }

    const parsed = tryParseSmartRecommenderJson(content);
    if (!parsed) {
      return llmFailureResult();
    }

    const pickedIds = new Set<string>();
    const picked: SmartFoodRecommendation[] = [];
    for (const row of parsed.recommendations) {
      if (
        !allowed.has(row.id) ||
        pickedIds.has(row.id) ||
        picked.length >= MAX_LLM_PICKS
      ) {
        continue;
      }
      const src = byIdVector.get(row.id);
      if (!src) continue;
      pickedIds.add(row.id);
      picked.push({
        id: src.id,
        name: src.name,
        description: src.description,
        reason: row.reason.slice(0, 280),
        ...(row.suggestedQuantity != null && row.suggestedQuantity > 1
          ? { suggestedQuantity: row.suggestedQuantity }
          : {}),
      });
    }

    const finalList = finalizeRecommendationsForWhatsAppList(picked, byIdVector);
    if (finalList.length === 0) {
      return llmFailureResult();
    }

    return {
      forDisplay: finalList,
      forList: finalList,
      usedLlm: true,
      llmNote: parsed.note,
      llmProgress: parsed.progress,
    };
  } catch {
    return llmFailureResult();
  }
}

export function formatSmartRecommendationsBullets(
  recommendations: SmartFoodRecommendation[]
): string {
  return recommendations.map((r) => `• ${r.name}: ${r.reason}`).join('\n');
}

/** Bullets + progreso + nota del LLM (orden: recomendaciones, progress, note). */
export function formatSmartRecommendationsBlock(
  recommendations: SmartFoodRecommendation[],
  llmNote?: string | null,
  llmProgress?: string | null
): string {
  const bullets = formatSmartRecommendationsBullets(recommendations);
  const parts: string[] = [bullets];
  const prog = llmProgress?.trim();
  if (prog) parts.push(prog);
  const n = llmNote?.trim();
  if (n) parts.push(n);
  return parts.join('\n\n');
}
