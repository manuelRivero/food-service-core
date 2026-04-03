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
  /** Hasta 3 ítems con razón del LLM (vacío si hubo fallback sin bullets). */
  forDisplay: SmartFoodRecommendation[];
  /** Filas para la lista interactiva y metadata. */
  forList: SmartFoodRecommendation[];
  usedLlm: boolean;
};

const TOP_VECTOR_FOR_LLM = 8;
const TOP_PICKS = 3;

const FALLBACK_REASON = 'Buena coincidencia con tu búsqueda.';

function stripCodeFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

function tryParseRecommendationsJson(
  raw: string
): Array<{ id: string; reason: string }> | null {
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
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
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
 * Arma el prompt para reordenar y explicar hasta 3 platos a partir de candidatos vectoriales.
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

  return `Sos asistente de un restaurante por WhatsApp. El cliente escribió: "${userQuery}".

Inferí preferencias implícitas (liviano vs contundente, tipo de comida, ingredientes que encajan o no) solo a partir de esa consulta y de las fichas siguientes.

Candidatos (resultado de búsqueda por similitud en el menú). Debés elegir SOLO ítems cuyo id aparezca exactamente acá:
${lines}

Tareas:
1) Elegí hasta ${TOP_PICKS} ítems que mejor respondan a la intención del cliente.
2) Ordenalos del más al menos adecuado.
3) Para cada uno, una razón breve en español (máximo ~18 palabras), alineada con nombre/categoría/descripción; no inventes alérgenos ni datos que no figuren.

Respondé SOLO JSON válido, sin markdown ni texto extra:
{"recommendations":[{"id":"<uuid>","reason":"<texto>"}]}`;
}

/**
 * Búsqueda vectorial existente + re-ranking y razones vía LLM.
 * Si `vectorResults` se omite, se llama a {@link MenuService.searchMenuItemsByKeyword}.
 */
export async function getSmartRecommendations(params: {
  userQuery: string;
  businessId: string;
  business: Business;
  /** Evita repetir la búsqueda vectorial cuando ya tenés los resultados. */
  vectorResults?: MenuItemSearchResult[];
}): Promise<GetSmartRecommendationsResult> {
  const { userQuery, businessId, business } = params;
  const trimmedQuery = userQuery.trim();

  const vectorItems =
    params.vectorResults ??
    (await MenuService.searchMenuItemsByKeyword({
      businessId,
      keyword: trimmedQuery,
    }));

  if (vectorItems.length === 0) {
    return { forDisplay: [], forList: [], usedLlm: false };
  }

  const fallbackList = menuResultsToSmart(vectorItems, FALLBACK_REASON);

  const useAi =
    business.openai_active !== false &&
    !business.ai_blocked &&
    trimmedQuery.length > 0;

  if (!useAi) {
    return {
      forDisplay: [],
      forList: fallbackList,
      usedLlm: false,
    };
  }

  const topForLlm = vectorItems.slice(0, TOP_VECTOR_FOR_LLM);
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
      'Sos un motor de recomendación de menú. Respondés únicamente JSON con el formato pedido.';
    const user = FOOD_RECOMMENDER_PROMPT(trimmedQuery, candidates);

    const { content } = await generateAIResponse(business, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    if (!content || content.includes('🚫') || content.includes('⚡')) {
      return { forDisplay: [], forList: fallbackList, usedLlm: false };
    }

    const parsed = tryParseRecommendationsJson(content);
    if (!parsed) {
      return { forDisplay: [], forList: fallbackList, usedLlm: false };
    }

    const picked: SmartFoodRecommendation[] = [];
    for (const row of parsed) {
      if (!allowed.has(row.id) || picked.length >= TOP_PICKS) continue;
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
      return { forDisplay: [], forList: fallbackList, usedLlm: false };
    }

    /** Lista interactiva: todos los hallazgos vectoriales; el cuerpo del mensaje destaca el top del LLM. */
    const fullList = menuResultsToSmart(vectorItems, '');

    return {
      forDisplay: picked,
      forList: fullList,
      usedLlm: true,
    };
  } catch {
    return { forDisplay: [], forList: fallbackList, usedLlm: false };
  }
}

export function formatSmartRecommendationsBullets(
  recommendations: SmartFoodRecommendation[]
): string {
  return recommendations.map((r) => `• ${r.name}: ${r.reason}`).join('\n');
}
