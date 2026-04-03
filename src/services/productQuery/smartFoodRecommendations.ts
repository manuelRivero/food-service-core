import type { business as Business } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateAIResponse } from '../ai/openai.service';
import { MenuService, type MenuItemSearchResult } from '../menu.service';

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
};

export type GetSmartRecommendationsResult = {
  forDisplay: SmartFoodRecommendation[];
  /** Listado WhatsApp: alineado con el LLM (mismos ids y orden); en fallback, top 3 del vector. */
  forList: SmartFoodRecommendation[];
  usedLlm: boolean;
  /** Mensaje contextual opcional del LLM (porciones, cantidad, guía). Sin plantillas en código. */
  llmNote?: string | null;
};

const MAX_CANDIDATES_FOR_LLM = 10;
const MAX_LLM_PICKS = 3;
const TOP_FALLBACK_DISPLAY = 3;
const MAX_NOTE_LENGTH = 500;

const FALLBACK_REASON = 'Buena coincidencia con tu búsqueda.';

function stripCodeFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

type ParsedLlmRecommender = {
  recommendations: Array<{ id: string; reason: string }>;
  note: string | null;
};

function tryParseSmartRecommenderJson(raw: string): ParsedLlmRecommender | null {
  const trimmed = stripCodeFences(raw);
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const recs = (obj as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(recs)) return null;
    const out: Array<{ id: string; reason: string }> = [];
    for (const r of recs) {
      if (!r || typeof r !== 'object') continue;
      const id = (r as { id?: unknown }).id;
      const reason = (r as { reason?: unknown }).reason;
      if (typeof id === 'string' && typeof reason === 'string' && id.length > 0) {
        const reasonTrim = reason.trim();
        if (reasonTrim.length > 0) {
          out.push({ id, reason: reasonTrim });
        }
      }
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

    return { recommendations: out, note };
  } catch {
    return null;
  }
}

/** Solo deduplicación técnica por id (preserva orden del vector). */
function dedupeById(items: MenuItemSearchResult[]): MenuItemSearchResult[] {
  const seen = new Set<string>();
  const out: MenuItemSearchResult[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
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

function buildLlmFailureDisplay(
  dedupedVector: MenuItemSearchResult[]
): SmartFoodRecommendation[] {
  return menuResultsToSmart(
    dedupedVector.slice(0, TOP_FALLBACK_DISPLAY),
    FALLBACK_REASON
  );
}

/**
 * Prompt: intención, cantidad/porciones, ranking y mensaje UX opcional — todo decidido por el LLM.
 */
export function FOOD_RECOMMENDER_PROMPT(
  userQuery: string,
  candidates: FoodRecommenderCandidate[]
): string {
  const lines = candidates
    .map((c, i) => {
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. id=${c.id} | categoría=${c.category} | nombre=${c.name}${desc ? ` | descripción=${desc}` : ''}`;
    })
    .join('\n');

  return `Sos asistente de un restaurante por WhatsApp. El mensaje del cliente es: "${userQuery}".

Tu rol: interpretar la intención (incluida cantidad o personas si las mencionó, ej. "para 3", "somos cuatro"), inferir preferencias (liviano, contundente, ingredientes solo si constan en la ficha, etc.) y elegir SOLO entre los candidatos listados abajo (retrieval por similitud). Toda la explicación y guía para el usuario la generás vos; no hay otro texto automático fuera de este JSON.

Evaluá mentalmente TODOS los candidatos antes de elegir. Devolvé entre 1 y 3 entradas en "recommendations": el número exacto lo decidís vos según el caso; no hay un mínimo obligatorio ni un máximo forzado.

SELECTION BEHAVIOR:
- Preferí ofrecer 2 o 3 recomendaciones cuando haya al menos dos ítems que sean razonablemente útiles para explorar (aunque ninguno sea un match perfecto).
- No seas demasiado estricto: incluí alternativas "bastante bien" o relacionadas de algún modo con lo pedido, si el listado las trajo por similitud y tienen sentido para el cliente.
- Incluí opciones "good enough": si algo es solo parcialmente alineado pero puede servir, ofrecela y ordenala por utilidad.
- Equilibrá relevancia y diversidad (evitá tres platos casi idénticos si el listado permite perfiles distintos).
- Devolvé una sola recomendación solo cuando todos los demás candidatos del listado sean claramente irrelevantes o fuera de lugar para el pedido (no por perfeccionismo).

TRUTH RULES:
- Usá únicamente lo que se desprende con certeza razonable del nombre, categoría y descripción del ítem; no completes huecos con suposiciones.
- NO asumas tamaño de porción, cantidad de comensales que "alcanza" un plato ni si es para compartir, salvo que el texto de la ficha lo diga de forma explícita (ej. "sirve 2", "para compartir").
- NO digas que un plato es "ideal para X personas" ni equivalente, a menos que la ficha lo indique con claridad.
- Si no hay dato de porciones o personas, usá lenguaje cauteloso: "puede servir", "depende del tamaño de la porción", "revisá el detalle al pedirlo", etc.

ANTI-HALLUCINATION:
- No inventes ni afirmes hechos sobre: tamaño de porciones, cuántas personas alcanza, si conviene compartir, ingredientes no mencionados, alérgenos, calorías, tiempo de cocción, ni nada que no esté en nombre o descripción.
- Si el cliente pidió cantidad o personas y la ficha no aclara porciones: no asumas idoneidad para compartir; podés sugerir con cautela que *quizá* hagan falta más de una unidad, sin afirmar cuántas.

HONESTY (sin contradicciones):
- Si una opción no encaja del todo con lo pedido, decilo en una sola idea clara en "reason" (ej. "más contundente de lo que buscabas").
- No incluyas ítems totalmente ajenos al pedido.

REDUNDANCY:
- Cada "reason" debe ser UNA sola oración breve y concreta; no repitas la misma idea en dos frases ni uses relleno.
- Entre recomendaciones distintas, no repitas el mismo argumento genérico; cada ítem debe aportar un ángulo distinto cuando sea posible.

Cantidad / personas en el mensaje del cliente:
- NO asumas si el plato es adecuado para compartir entre N personas sin dato en la ficha.
- Preferí orientar a sumar varias unidades si hace falta, con formulaciones prudentes.
- Ejemplo BUENO: "Si son varios, puede que necesites más de una porción; el detalle lo ves al elegir el plato."
- Ejemplo MALO: "Ideal para compartir entre tres" (sin que la ficha lo diga).

Campo opcional "note":
- Usalo para orientación general (p. ej. cantidad: sugerir considerar más de una unidad sin cifras inventadas). Una o dos oraciones máximo, español, tono cercano.
- NO repitas en "note" lo mismo que ya dijiste en algún "reason"; si la idea es una sola, dejala solo en "reason" o solo en "note", no en ambos.
- Podés omitir "note", usar null o string vacío si no suma.

Candidatos (usá solo estos ids):
${lines}

Respondé SOLO JSON válido, sin markdown ni texto fuera del JSON:
{"recommendations":[{"id":"<uuid>","reason":"<una sola oración concisa>"}],"note":null}
o con "note" como string cuando corresponda y sin redundancia respecto a "reason".`;
}

/**
 * Vector search (retrieval) + deduplicación por id; ranking, textos y note solo vía LLM.
 */
export async function getSmartRecommendations(params: {
  userQuery: string;
  businessId: string;
  business: Business;
  vectorResults?: MenuItemSearchResult[];
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
    return { forDisplay: [], forList: [], usedLlm: false, llmNote: null };
  }

  const deduped = dedupeById(vectorItems);
  const topVectorFallback = deduped.slice(0, TOP_FALLBACK_DISPLAY);

  const llmFailureResult = (): GetSmartRecommendationsResult => ({
    forDisplay: buildLlmFailureDisplay(deduped),
    forList: menuResultsToSmart(topVectorFallback, ''),
    usedLlm: false,
    llmNote: null,
  });

  const useAi =
    business.openai_active !== false &&
    !business.ai_blocked &&
    trimmedUtterance.length > 0;

  if (!useAi) {
    return {
      forDisplay: [],
      forList: menuResultsToSmart(topVectorFallback, FALLBACK_REASON),
      usedLlm: false,
      llmNote: null,
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
      'Sos el motor de recomendación y mensajería contextual del menú. Preferís dar 2–3 opciones útiles cuando el listado lo permite, sin ser demasiado restrictivo. Respondés solo JSON con recommendations y note opcional. No inventás datos fuera de las fichas.';
    const user = FOOD_RECOMMENDER_PROMPT(trimmedUtterance, candidates);

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

    const picked: SmartFoodRecommendation[] = [];
    for (const row of parsed.recommendations) {
      if (!allowed.has(row.id) || picked.length >= MAX_LLM_PICKS) continue;
      const src = byIdVector.get(row.id);
      if (!src) continue;
      picked.push({
        id: src.id,
        name: src.name,
        description: src.description,
        reason: row.reason.slice(0, 280),
      });
    }

    if (picked.length === 0) {
      return llmFailureResult();
    }

    return {
      forDisplay: picked,
      forList: picked,
      usedLlm: true,
      llmNote: parsed.note,
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

/** Bullets + nota del LLM (sin plantillas fijas para la nota). */
export function formatSmartRecommendationsBlock(
  recommendations: SmartFoodRecommendation[],
  llmNote?: string | null
): string {
  const bullets = formatSmartRecommendationsBullets(recommendations);
  const n = llmNote?.trim();
  return n ? `${bullets}\n\n${n}` : bullets;
}
