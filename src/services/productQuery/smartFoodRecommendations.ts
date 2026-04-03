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
  /** Hasta 3 ítems con razón del LLM o fallback (vacío si IA desactivada sin bullets). */
  forDisplay: SmartFoodRecommendation[];
  /** Filas para la lista interactiva y metadata. */
  forList: SmartFoodRecommendation[];
  usedLlm: boolean;
};

const TOP_FOR_LLM = 5;
const TOP_PICKS = 3;
const TOP_FALLBACK_DISPLAY = 3;

const FALLBACK_REASON = 'Buena coincidencia con tu búsqueda.';

/** Palabras que no sirven para filtrar por coincidencia léxica. */
const SPANISH_STOPWORDS = new Set([
  'algo',
  'como',
  'con',
  'cual',
  'cuando',
  'cuatro',
  'cinco',
  'de',
  'del',
  'diez',
  'doce',
  'dos',
  'el',
  'en',
  'esa',
  'ese',
  'eso',
  'esta',
  'este',
  'favor',
  'hay',
  'las',
  'los',
  'mas',
  'me',
  'mi',
  'muy',
  'nueve',
  'nos',
  'ocho',
  'once',
  'por',
  'para',
  'pedido',
  'que',
  'quiero',
  'se',
  'seis',
  'siete',
  'sin',
  'son',
  'su',
  'sus',
  'tengo',
  'traer',
  'tu',
  'tres',
  'una',
  'uno',
  'unos',
  'unas',
  'ver',
  'vos',
  'y',
  'ya',
  'yo',
]);

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

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Términos significativos para filtrar nombre/descripción (evita pulpo cuando buscás pollo).
 */
export function extractSearchTerms(termSource: string): string[] {
  const raw = normalizeForMatch(termSource.trim());
  if (!raw) return [];
  const parts = raw.split(/[^a-z0-9ñ]+/i).filter(Boolean);
  const terms = new Set<string>();
  for (const w of parts) {
    if (w.length < 3 || /^\d+$/.test(w) || SPANISH_STOPWORDS.has(w)) continue;
    terms.add(w);
  }
  return [...terms];
}

function itemMatchesAnyTerm(item: MenuItemSearchResult, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = normalizeForMatch(`${item.name} ${item.description ?? ''}`);
  return terms.some((t) => hay.includes(t));
}

function keywordPrefilter(
  items: MenuItemSearchResult[],
  terms: string[]
): MenuItemSearchResult[] {
  if (terms.length === 0) return items;
  const matched = items.filter((i) => itemMatchesAnyTerm(i, terms));
  return matched.length > 0 ? matched : items;
}

function dedupeMenuResults(items: MenuItemSearchResult[]): MenuItemSearchResult[] {
  const seenId = new Set<string>();
  const seenName = new Set<string>();
  const out: MenuItemSearchResult[] = [];
  for (const item of items) {
    const nameKey = normalizeForMatch(item.name.trim());
    if (seenId.has(item.id) || seenName.has(nameKey)) continue;
    seenId.add(item.id);
    seenName.add(nameKey);
    out.push(item);
  }
  return out;
}

function keywordRelevanceScore(item: MenuItemSearchResult, terms: string[]): number {
  if (terms.length === 0) return 0;
  const name = normalizeForMatch(item.name);
  const desc = normalizeForMatch(item.description ?? '');
  let s = 0;
  for (const t of terms) {
    if (name.includes(t)) s += 4;
    else if (desc.includes(t)) s += 1;
  }
  return s;
}

function sortByKeywordRelevance(
  items: MenuItemSearchResult[],
  terms: string[]
): MenuItemSearchResult[] {
  if (terms.length === 0) return items;
  return [...items].sort(
    (a, b) => keywordRelevanceScore(b, terms) - keywordRelevanceScore(a, terms)
  );
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
  sortedFiltered: MenuItemSearchResult[]
): SmartFoodRecommendation[] {
  return menuResultsToSmart(
    sortedFiltered.slice(0, TOP_FALLBACK_DISPLAY),
    FALLBACK_REASON
  );
}

type PromptOptions = {
  quantity?: number | null;
};

/**
 * Arma el prompt para reordenar y explicar hasta 3 platos a partir de candidatos filtrados.
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
      ? `\nCantidad pedida (porciones / personas, según interprete el mensaje): ${qty}. Tené en cuenta si el plato parece individual, para compartir o adecuado para varias personas según nombre y descripción; no inventes porciones que no figuren en el texto.`
      : '';

  return `Sos asistente de un restaurante por WhatsApp. El cliente escribió: "${userQuery}".${qtyBlock}

Reglas estrictas (incumplir invalida la respuesta):
- NO inventes ingredientes, alérgenos, calorías ni datos que NO aparezcan literalmente en nombre o descripción de cada ítem.
- Solo podés basar la razón en categoría, nombre y descripción provistos. Si no estás seguro de un detalle culinario, usá formulaciones como "puede ser una opción liviana" o "podría encajar si buscás algo así", sin afirmar hechos no escritos.

Inferí preferencias implícitas solo a partir del mensaje del cliente y de las fichas (sin suposiciones externas).

Candidatos (ya filtrados por relevancia). Elegí SOLO ítems cuyo id esté exactamente en esta lista:
${lines}

Tareas:
1) Elegí hasta ${TOP_PICKS} ítems que mejor respondan a la intención del cliente.
2) Ordenalos del más al menos adecuado.
3) Para cada uno, una razón breve en español (máximo ~18 palabras), cumpliendo las reglas de arriba.

Respondé SOLO JSON válido, sin markdown ni texto extra:
{"recommendations":[{"id":"<uuid>","reason":"<texto>"}]}`;
}

function buildFilteredPipeline(
  vectorItems: MenuItemSearchResult[],
  termSource: string
): MenuItemSearchResult[] {
  const deduped = dedupeMenuResults(vectorItems);
  const terms = extractSearchTerms(termSource);
  const filtered = keywordPrefilter(deduped, terms);
  return sortByKeywordRelevance(filtered, terms);
}

/**
 * Búsqueda vectorial existente + pre-filtro léxico, deduplicación, re-ranking LLM.
 * Si `vectorResults` se omite, se llama a {@link MenuService.searchMenuItemsByKeyword}.
 */
export async function getSmartRecommendations(params: {
  /** Texto mostrado al modelo como mensaje del cliente. */
  userQuery: string;
  /** Texto para extraer términos de filtro (p. ej. nombre detectado + mensaje completo). */
  termSource?: string;
  businessId: string;
  business: Business;
  quantity?: number | null;
  vectorResults?: MenuItemSearchResult[];
}): Promise<GetSmartRecommendationsResult> {
  const { userQuery, businessId, business } = params;
  const trimmedUtterance = userQuery.trim();
  const termSource = (params.termSource ?? userQuery).trim();

  const vectorItems =
    params.vectorResults ??
    (await MenuService.searchMenuItemsByKeyword({
      businessId,
      keyword: trimmedUtterance,
    }));

  if (vectorItems.length === 0) {
    return { forDisplay: [], forList: [], usedLlm: false };
  }

  const sortedFiltered = buildFilteredPipeline(vectorItems, termSource);
  const fallbackListFull = menuResultsToSmart(sortedFiltered, FALLBACK_REASON);
  const llmFailureResult = (): GetSmartRecommendationsResult => ({
    forDisplay: buildLlmFailureDisplay(sortedFiltered),
    forList: menuResultsToSmart(sortedFiltered, ''),
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

  const topForLlm = sortedFiltered.slice(0, TOP_FOR_LLM);
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
      'Sos un motor de recomendación de menú. Respondés únicamente JSON con el formato pedido. No inventás datos que no estén en las fichas.';
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
      return llmFailureResult();
    }

    const fullList = menuResultsToSmart(sortedFiltered, '');

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
