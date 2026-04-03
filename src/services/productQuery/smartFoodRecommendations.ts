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
  /** 2–3 ítems con razón del LLM, o hasta 3 en fallback. */
  forDisplay: SmartFoodRecommendation[];
  /** Filas para la lista interactiva y metadata (orden del vector, sin filtrado semántico). */
  forList: SmartFoodRecommendation[];
  usedLlm: boolean;
};

const MAX_CANDIDATES_FOR_LLM = 10;
const MAX_LLM_PICKS = 3;
const TOP_FALLBACK_DISPLAY = 3;

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

type PromptOptions = {
  quantity?: number | null;
};

/**
 * Prompt: el LLM interpreta intención, preferencias y elige entre todos los candidatos del retrieval.
 */
export function FOOD_RECOMMENDER_PROMPT(
  userQuery: string,
  candidates: FoodRecommenderCandidate[],
  options?: PromptOptions
): string {
  const lines = candidates
    .map((c, i) => {
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. id=${c.id} | categoría=${c.category} | nombre=${c.name}${desc ? ` | descripción=${desc}` : ''}`;
    })
    .join('\n');

  const qty = options?.quantity;
  const qtyBlock =
    qty != null && qty > 0
      ? `\nEl cliente mencionó aproximadamente ${qty} persona(s) (o porciones equivalentes). Revisá nombre y descripción de cada candidato: si no aclara cuántas personas alcanza, tratá como dato ausente. Si un plato parece individual o para menos personas que ${qty}, en el campo reason aclarálo (ej. que para ${qty} personas podrían hacer falta varias unidades) sin inventar cifras que no estén en el texto.`
      : '';

  return `Sos asistente de un restaurante por WhatsApp. El cliente escribió: "${userQuery}".${qtyBlock}

Tu rol: interpretar la intención del mensaje, inferir preferencias (por ejemplo más liviano o más contundente, estilo, ingredientes que el cliente podría querer o evitar) y elegir las mejores opciones SOLO entre los candidatos listados abajo (resultado de búsqueda por similitud en el menú). Todas las decisiones semánticas son tuyas; no hay otro filtro previo.

Reglas obligatorias:
- Debés evaluar mentalmente TODOS los candidatos del listado antes de elegir.
- Devolvé **2 o 3 recomendaciones** si hay al menos 2 candidatos distintos; si solo hay 1 candidato, devolvé 1. Si hay 2 o más, no devuelvas solo 1 salvo que el resto sea claramente irrelevante para la consulta (y en ese caso explicá el trade-off en la razón).
- Equilibrá **relevancia** respecto al pedido con **variedad** (no tres platos casi iguales si el listado ofrece alternativas razonables).
- Si ningún plato encaja perfecto, elegí las mejores opciones posibles y explicá en cada **reason** el trade-off o la limitación (ej. "no hay opción sin X en la lista; esta es la más cercana").${qty != null && qty > 0 ? ` Si el pedido era para ~${qty} persona(s) y el candidato no alcanza según la ficha, decilo explícitamente en la razón.` : ''}
- NO inventes ingredientes, alérgenos ni datos que NO aparezcan en nombre o descripción del ítem. Podés inferir tono general (liviano/pesado) solo si es razonable a partir del texto de la ficha; si no, usá formulaciones cautelosas ("puede ser una opción más liviana según la descripción").
- Cada "reason": breve en español (máx. ~22 palabras), útil para el cliente.

Candidatos (ids exactos; usá solo estos):
${lines}

Respondé SOLO JSON válido, sin markdown ni texto extra:
{"recommendations":[{"id":"<uuid>","reason":"<texto>"}]}`;
}

/**
 * Vector search (retrieval) + deduplicación por id + re-ranking y selección solo vía LLM.
 */
export async function getSmartRecommendations(params: {
  userQuery: string;
  businessId: string;
  business: Business;
  quantity?: number | null;
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
    return { forDisplay: [], forList: [], usedLlm: false };
  }

  const deduped = dedupeById(vectorItems);
  const fallbackListFull = menuResultsToSmart(deduped, FALLBACK_REASON);

  const llmFailureResult = (): GetSmartRecommendationsResult => ({
    forDisplay: buildLlmFailureDisplay(deduped),
    forList: menuResultsToSmart(deduped, ''),
    usedLlm: false,
  });

  const useAi =
    business.openai_active !== false &&
    !business.ai_blocked &&
    trimmedUtterance.length > 0;

  if (!useAi) {
    return {
      forDisplay: [],
      forList: fallbackListFull,
      usedLlm: false,
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
      'Sos el único motor semántico de recomendación: interpretás al cliente y elegís entre los candidatos del menú. Respondés solo JSON válido. No inventás ingredientes ni datos fuera de las fichas.';
    const user = FOOD_RECOMMENDER_PROMPT(trimmedUtterance, candidates, {
      quantity: params.quantity,
    });

    const { content } = await generateAIResponse(business, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    if (!content || content.includes('🚫') || content.includes('⚡')) {
      return llmFailureResult();
    }

    const parsed = tryParseRecommendationsJson(content);
    if (!parsed) {
      return llmFailureResult();
    }

    const picked: SmartFoodRecommendation[] = [];
    for (const row of parsed) {
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

    const fullList = menuResultsToSmart(deduped, '');

    return {
      forDisplay: picked,
      forList: fullList,
      usedLlm: true,
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
