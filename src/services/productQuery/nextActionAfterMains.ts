import type { MenuCategoryTag } from '@prisma/client';
import type { RecommendationCartSummary } from './recommendationCartSummary';

/** Fases del flujo tipo mozo después de fijar comensales. */
export type NextActionFlowPhase =
  | 'MAIN_INCOMPLETE'
  | 'DRINK'
  | 'STARTER'
  | 'DESSERT'
  | 'CHECKOUT'
  /** Sin peopleCount o flujo no aplica: no forzar categoría. */
  | 'BROWSE';

export type NextActionHintKey = 'DRINK' | 'STARTER' | 'DESSERT' | 'CHECKOUT';

export type NextActionHintsShown = Partial<Record<NextActionHintKey, boolean>>;

/**
 * Orden fijo: bebida → entrada → postre → cierre.
 * Cobertura por categoría = unidades en borrador (buildRecommendationCartSummary).
 */
export function resolveNextActionFlowPhase(params: {
  peopleCount: number | null;
  mainCoverage: number;
  cartSummary: RecommendationCartSummary;
}): NextActionFlowPhase {
  const pc = params.peopleCount;
  if (pc == null || pc <= 0) return 'BROWSE';

  if (params.mainCoverage < pc) return 'MAIN_INCOMPLETE';

  const cs = params.cartSummary;
  if (cs.drinks === 0) return 'DRINK';
  if (cs.starters === 0) return 'STARTER';
  if (cs.desserts === 0) return 'DESSERT';
  return 'CHECKOUT';
}

/** Tag a filtrar en el catálogo; null = sin filtro por categoría. */
export function forcedCategoryTagForFlowPhase(
  phase: NextActionFlowPhase
): MenuCategoryTag | null {
  switch (phase) {
    case 'MAIN_INCOMPLETE':
      return 'MAIN';
    case 'DRINK':
      return 'DRINK';
    case 'STARTER':
      return 'STARTER';
    case 'DESSERT':
      return 'DESSERT';
    default:
      return null;
  }
}

const BANNER: Record<NextActionHintKey, string> = {
  DRINK: 'Ya tenés los platos principales 👌 ¿Querés algo para tomar?',
  STARTER: 'Podés sumar una entrada para compartir 👌',
  DESSERT: '¿Querés agregar algo dulce para cerrar?',
  CHECKOUT:
    'Tenés entrada, principales, bebida y postre en el pedido 👌 Si querés, podemos cerrarlo.',
};

/**
 * Mensaje determinístico solo la primera vez por fase (hints en metadata).
 */
/** Tras agregar ítem no principal con MAIN aún incompleto (post-carrito, sin bloquear). */
export function acknowledgeNonMainAddLine(
  tag: MenuCategoryTag
): string | null {
  switch (tag) {
    case 'STARTER':
      return 'Perfecto, sumamos la entrada 👌';
    case 'DRINK':
      return 'Perfecto, sumamos la bebida 👌';
    case 'DESSERT':
      return 'Perfecto, sumamos el postre 👌';
    default:
      return null;
  }
}

export const GUIDE_CHOOSE_MAINS_AFTER_NON_MAIN =
  'Si querés, podés seguir con platos principales para el grupo 👌';

export function getNextActionBannerMessage(
  phase: NextActionFlowPhase,
  hintsShown: NextActionHintsShown | null | undefined
): { message: string | null; hintKey: NextActionHintKey | null } {
  if (phase === 'MAIN_INCOMPLETE' || phase === 'BROWSE') {
    return { message: null, hintKey: null };
  }
  if (phase === 'CHECKOUT') {
    if (hintsShown?.CHECKOUT) return { message: null, hintKey: null };
    return { message: BANNER.CHECKOUT, hintKey: 'CHECKOUT' };
  }
  const key = phase as NextActionHintKey;
  if (hintsShown?.[key]) return { message: null, hintKey: null };
  return { message: BANNER[key], hintKey: key };
}
