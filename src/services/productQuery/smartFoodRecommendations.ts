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
    for (const r of recs) {
      if (!r || typeof r !== 'object') continue;
      const id = (r as { id?: unknown }).id;
      const reason = (r as { reason?: unknown }).reason;
      if (typeof id === 'string' && typeof reason === 'string' && id.length > 0) {
        const reasonTrim = reason.trim();
        if (reasonTrim.length > 0) {
          const sq = clampSuggestedQuantity((r as { suggestedQuantity?: unknown }).suggestedQuantity);
          out.push({
            id,
            reason: reasonTrim,
            ...(sq != null && sq > 1 ? { suggestedQuantity: sq } : {}),
          });
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
      ? `Personas (contexto de sesión): aproximadamente ${requestedPartySize}.`
      : 'Personas (contexto de sesión): no indicado.';

  const cartJson = JSON.stringify(cartSummary);

  return `Sos asistente de un restaurante por WhatsApp. El mensaje del cliente es: "${userQuery}".

${partyLine}

Estado actual del carrito (suma de CANTIDADES por tipo de categoría, no cantidad de líneas):
${cartJson}
- starters = entradas (STARTER), mains = platos principales (MAIN), drinks = bebidas (DRINK), desserts = postres (DESSERT).
- Valores 0 significan que aún no hay nada de ese tipo en el pedido.

Tu rol: actuar como un mozo inteligente que ayuda a armar el pedido. Elegís SOLO entre los candidatos listados abajo (retrieval por similitud). Toda la explicación la generás vos; no hay otro texto automático fuera del JSON.

INTENT:
- Entendé el pedido del cliente y sus preferencias si se infieren del texto (ingredientes solo si constan en la ficha, etc.).
- Si hay personas en contexto, tenelas en cuenta para sugerir cantidades de forma prudente (ver abajo).

CART AWARENESS:
- Analizá el resumen del carrito: qué tipos faltan, cuáles están incompletos respecto a las personas si aplica, y cuáles ya están razonablemente cubiertos.
- Si falta un tipo relevante para un pedido completo, priorizá sugerir candidatos de ese tipo cuando el listado lo permita.
- Si hay pocos platos principales respecto a las personas, podés orientar a "completar" sin afirmar porciones exactas.
- Si el carrito ya tiene bastante de un tipo, podés pasar al siguiente hueco útil o diversificar según el pedido.

DECISION LOGIC (flexible, sin reglas rígidas en código):
- Si falta una categoría importante → sugerí ítems que la cubran.
- Si está parcialmente cubierta (ej. pocos mains para varias personas) → sugerí completar con cautela.
- Si ya hay bastante → podés sugerir exploración, variedad o siguiente paso lógico (bebida/postre) según el listado.

SELECTION BEHAVIOR:
- Preferí ofrecer 2 o 3 recomendaciones cuando haya al menos dos ítems razonablemente útiles.
- No seas demasiado estricto: incluí alternativas "bastante bien" o relacionadas si el listado las trajo por similitud.
- Equilibrá relevancia y diversidad.
- Devolvé una sola recomendación solo cuando el resto de candidatos sea claramente irrelevante para el pedido.

TRUTH RULES:
- Usá únicamente lo que se desprende con certeza razonable del nombre, categoría y descripción del ítem.
- NO asumas tamaño de porción, cuántas personas alcanza un plato ni si es para compartir, salvo que la ficha lo diga explícitamente.
- NO digas que un plato es "ideal para X personas" salvo que la ficha lo indique con claridad.
- Si no hay dato de porciones, usá lenguaje cauteloso: "puede servir", "depende del tamaño de la porción", etc.

ANTI-HALLUCINATION:
- No inventes: tamaños de porción, ingredientes no mencionados, idoneidad para N personas, alérgenos, tiempos, etc.

suggestedQuantity (por ítem, opcional, 1–99):
- Indicá cuántas unidades de ESE ítem podrían tener sentido pedir en el siguiente paso, considerando personas y carrito, sin asumir porciones no dichas en la ficha.
- Si no tiene sentido sugerir más de una unidad, omití el campo o usá 1.
- Preferí sugerencias seguras (ej. 2 o 3) cuando haya incertidumbre; no busques el número exacto para "cerrar" matemáticamente el pedido.

Campo "progress" (opcional, string corto):
- Un resumen en español del estado del pedido y qué estás priorizando con estas recomendaciones (1–3 oraciones).
- No repitas texto de los "reason" ni de "note".

Campo "note" (opcional):
- Orientación general (cantidad/personas) sin repetir "progress" ni los "reason".
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
  const topVectorFallback = deduped.slice(0, TOP_FALLBACK_DISPLAY);

  const llmFailureResult = (): GetSmartRecommendationsResult => ({
    forDisplay: buildLlmFailureDisplay(deduped),
    forList: menuResultsToSmart(topVectorFallback, ''),
    usedLlm: false,
    llmNote: null,
    llmProgress: null,
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
      'Sos el motor de recomendación guiada del menú. Usás el carrito y las personas solo como contexto; no inventás datos de fichas. Respondés solo JSON con recommendations (cada una con reason y suggestedQuantity opcional), note y progress opcionales.';
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
        ...(row.suggestedQuantity != null && row.suggestedQuantity > 1
          ? { suggestedQuantity: row.suggestedQuantity }
          : {}),
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
