import type { MenuCategoryTag } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { MENU_SUGGESTION_ORDER } from '../helpers/complementaryMenu.helper';
import { findOrCreateConversationState, updateConversationState } from '../repositories';
import type { ConversationMetadata } from './productQuery/types';
import {
  buildMetadataValue,
  getRequestedPartySize,
  normalizeMetadata,
} from './productQuery/utils';

/** Por unidad sin dato de ficha: 1 porción por unidad. */
const SERVES_FALLBACK = 1;

const MEANINGFUL: ReadonlySet<MenuCategoryTag> = new Set([
  'STARTER',
  'MAIN',
  'DRINK',
  'SIDE',
  'DESSERT',
]);

/** Orden de la guía: misma prioridad que el menú complementario. */
const GUIDANCE_ORDER: MenuCategoryTag[] = MENU_SUGGESTION_ORDER.filter((t) =>
  MEANINGFUL.has(t)
);

export type CategoryCoverageMap = Partial<Record<MenuCategoryTag, number>>;

export type PortionCoverageResult = {
  coveredPortions: number;
  peopleCount: number | null;
  missingPortions: number | null;
  /** Porciones (qty × serves) en MAIN; redundante con categoryCoverage.MAIN. */
  mainCoveredPortions: number;
  hasMainLine: boolean;
  /** Por categoría: suma de porciones por línea (qty × serves, fallback 1). */
  categoryCoverage: CategoryCoverageMap;
};

type DraftLineForCoverage = {
  quantity: number;
  menu_item: {
    serves_people: number | null;
    menu_category: { category_tag: MenuCategoryTag } | null;
  } | null;
};

export function linePortionCoverage(
  quantity: number,
  servesPeople: number | null | undefined
): number {
  const serves =
    servesPeople != null && servesPeople > 0 ? servesPeople : SERVES_FALLBACK;
  return quantity * serves;
}

function portionForCategory(tag: MenuCategoryTag | undefined | null): tag is MenuCategoryTag {
  return tag != null && MEANINGFUL.has(tag);
}

export function computePortionCoverageFromDraftLines(
  lines: DraftLineForCoverage[]
): Omit<PortionCoverageResult, 'peopleCount' | 'missingPortions'> {
  let coveredPortions = 0;
  const categoryCoverage: CategoryCoverageMap = {};

  for (const line of lines) {
    const mi = line.menu_item;
    if (!mi) continue;
    const cov = linePortionCoverage(line.quantity, mi.serves_people);
    coveredPortions += cov;
    const tag = mi.menu_category?.category_tag;
    if (portionForCategory(tag)) {
      categoryCoverage[tag] = (categoryCoverage[tag] ?? 0) + cov;
    }
  }

  const mainCoveredPortions = categoryCoverage.MAIN ?? 0;
  const hasMainLine = mainCoveredPortions > 0;

  return {
    coveredPortions,
    mainCoveredPortions,
    hasMainLine,
    categoryCoverage,
  };
}

function applyPeopleCount(
  base: Omit<PortionCoverageResult, 'peopleCount' | 'missingPortions'>,
  peopleCount: number | undefined
): PortionCoverageResult {
  const people =
    peopleCount != null && peopleCount > 0 ? peopleCount : null;
  const missingPortions =
    people != null ? Math.max(0, people - base.coveredPortions) : null;
  return {
    ...base,
    peopleCount: people,
    missingPortions,
  };
}

function categoryLabelPlural(tag: MenuCategoryTag): string {
  switch (tag) {
    case 'STARTER':
      return 'entradas';
    case 'MAIN':
      return 'platos principales';
    case 'DRINK':
      return 'bebidas';
    case 'SIDE':
      return 'guarniciones';
    case 'DESSERT':
      return 'postres';
    default:
      return 'productos';
  }
}

function categoryAckComplete(tag: MenuCategoryTag): string {
  switch (tag) {
    case 'STARTER':
      return 'Tenés entradas sumadas para la referencia del grupo 👌';
    case 'MAIN':
      return 'Tenés platos principales para la referencia del grupo 👌';
    case 'DRINK':
      return 'Tenés bebidas sumadas para la referencia del grupo 👌';
    case 'SIDE':
      return 'Tenés guarniciones sumadas para la referencia del grupo 👌';
    case 'DESSERT':
      return 'Tenés postres sumados para la referencia del grupo 👌';
    default:
      return '';
  }
}

/** Primera categoría en orden que aún no alcanza `people` porciones (con N personas). */
function firstIncompleteCategory(
  r: PortionCoverageResult,
  people: number
): MenuCategoryTag | null {
  for (const tag of GUIDANCE_ORDER) {
    const c = r.categoryCoverage[tag] ?? 0;
    if (c < people) return tag;
  }
  return null;
}

/** Primera categoría en orden sin ninguna porción (sin N personas en contexto). */
function firstEmptyCategory(r: PortionCoverageResult): MenuCategoryTag | null {
  for (const tag of GUIDANCE_ORDER) {
    if ((r.categoryCoverage[tag] ?? 0) === 0) return tag;
  }
  return null;
}

function linesForCategoryVsPeople(
  tag: MenuCategoryTag,
  coverage: number,
  people: number
): string[] {
  const label = categoryLabelPlural(tag);
  if (coverage === 0) {
    return [
      `Todavía no agregaste ${label}. Si querés, podés sumar hasta ${people} porciones de referencia (según cantidad por plato).`,
    ];
  }
  return [
    `Llevás ${coverage} de ${people} porciones de referencia de ${label}.`,
    `Si querés alinear con el grupo, podés sumar más ${label}.`,
  ];
}

function linesGuidanceWithPeople(r: PortionCoverageResult, people: number): string[] {
  const out: string[] = [];
  const focus = firstIncompleteCategory(r, people);
  if (focus == null) {
    out.push(
      'En las categorías guiadas (entradas, principales, bebidas, guarniciones y postres) tenés cobertura de referencia para el grupo 👌'
    );
    out.push('Si querés, podés revisar el total o finalizar el pedido.');
    return out;
  }

  const idx = GUIDANCE_ORDER.indexOf(focus);
  for (let i = 0; i < idx; i++) {
    const tag = GUIDANCE_ORDER[i];
    const c = r.categoryCoverage[tag] ?? 0;
    if (c >= people) {
      const ack = categoryAckComplete(tag);
      if (ack) out.push(ack);
    }
  }

  const cov = r.categoryCoverage[focus] ?? 0;
  out.push(...linesForCategoryVsPeople(focus, cov, people));

  const nextIdx = idx + 1;
  if (nextIdx < GUIDANCE_ORDER.length) {
    const nextTag = GUIDANCE_ORDER[nextIdx];
    const nextLabel = categoryLabelPlural(nextTag);
    out.push(`Más adelante, si querés, podés sumar ${nextLabel} u otras categorías.`);
  }

  return out;
}

function linesGuidanceNoPeople(r: PortionCoverageResult): string[] {
  const empty = firstEmptyCategory(r);
  if (empty == null) {
    return [
      'Tenés al menos algo en cada categoría principal.',
      'Podés sumar bebidas o guarniciones, o finalizar el pedido.',
    ];
  }
  const label = categoryLabelPlural(empty);
  return [
    `Si querés, podés sumar ${label} cuando te parezca.`,
  ];
}

function pickDeterministicNextStep(r: PortionCoverageResult): string | null {
  const people = r.peopleCount;

  if (people != null && r.missingPortions != null) {
    if (r.missingPortions >= 1 && r.missingPortions <= 2) {
      return 'Estás cerca del total de porciones: podés finalizar o seguir sumando.';
    }
    if (r.missingPortions === 0) {
      return 'Llegaste al total de referencia de porciones: si querés, podés finalizar el pedido o seguir sumando.';
    }
  }

  if (people == null) {
    const anyCov = Object.values(r.categoryCoverage).some(
      (n) => n != null && n > 0
    );
    if (anyCov) {
      return 'Podés seguir explorando el menú o finalizar cuando quieras.';
    }
  }

  if (people != null && r.missingPortions != null && r.missingPortions > 2) {
    return 'Si querés acercarte al total de referencia del grupo, podés seguir sumando porciones.';
  }

  return null;
}

/**
 * Texto guiado para carrito / post–agregar ítem (sin LLM).
 */
export function formatCartGuidanceBlock(result: PortionCoverageResult): string {
  const lines: string[] = [];
  const y = result.peopleCount;

  if (y != null && y > 0) {
    lines.push(`Porciones cubiertas: ${result.coveredPortions} de ${y}`);
    if (result.missingPortions != null) {
      if (result.coveredPortions < y) {
        lines.push(
          `Referencia: podrías sumar hasta ${result.missingPortions} porciones más para el grupo, si querés.`
        );
      } else {
        lines.push(
          'Tenés el total de referencia de porciones para la cantidad de personas del pedido 👌'
        );
      }
    }
  } else {
    lines.push(`Porciones en carrito: ${result.coveredPortions}`);
  }

  lines.push('');
  if (y != null && y > 0) {
    lines.push(...linesGuidanceWithPeople(result, y));
  } else {
    lines.push(...linesGuidanceNoPeople(result));
  }

  const hint = pickDeterministicNextStep(result);
  if (hint) {
    lines.push('', hint);
  }

  return lines.join('\n');
}

/**
 * Lee el borrador activo, calcula porciones y persiste `coveredPortions` / `missingPortions` en metadata.
 */
export async function syncOrderCoverageToConversationState(
  conversationId: string,
  businessId: string,
  customerPhone: string
): Promise<PortionCoverageResult> {
  const state = await findOrCreateConversationState(conversationId);
  const meta = normalizeMetadata(state.metadata) as ConversationMetadata;
  const people = getRequestedPartySize(meta);

  const draft = await prisma.draft_order.findFirst({
    where: {
      business_id: businessId,
      customer_phone: customerPhone,
      status: 'active',
    },
    include: {
      draft_order_item: {
        include: {
          menu_item: {
            include: {
              menu_category: { select: { category_tag: true } },
            },
          },
        },
      },
    },
  });

  const empty = !draft?.draft_order_item?.length;
  const base = empty
    ? {
        coveredPortions: 0,
        mainCoveredPortions: 0,
        hasMainLine: false,
        categoryCoverage: {} as CategoryCoverageMap,
      }
    : computePortionCoverageFromDraftLines(draft.draft_order_item);

  const result = applyPeopleCount(base, people);

  const nextMeta: ConversationMetadata = { ...meta };
  nextMeta.coveredPortions = result.coveredPortions;
  if (result.missingPortions != null) {
    nextMeta.missingPortions = result.missingPortions;
  } else {
    delete nextMeta.missingPortions;
  }

  await updateConversationState(conversationId, {
    metadata: buildMetadataValue(nextMeta),
  });

  return result;
}
