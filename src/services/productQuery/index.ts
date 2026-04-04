export { executeProductQuery } from './service';
export type { ProductQueryServiceResult } from './types';
export {
  formatBotUserMessage,
  partySizeMetadataFields,
} from './utils';
export {
  buildPortionClarificationForRecommendations,
  classifyPortionVsParty,
  dedupeMenuItemSearchResultsById,
  FOOD_RECOMMENDER_PROMPT,
  formatMainCoverageGuidance,
  formatSingleProductPortionHint,
  formatSmartRecommendationsBlock,
  formatSmartRecommendationsBulletLines,
  formatSmartRecommendationsBullets,
  getSmartRecommendations,
  MAX_WHATSAPP_LIST_ROWS,
  suggestedUnitsForListRow,
} from './smartFoodRecommendations';
export type {
  FoodRecommenderCandidate,
  GetSmartRecommendationsResult,
  PortionCase,
  SmartFoodRecommendation,
} from './smartFoodRecommendations';
export {
  buildRecommendationCartSummary,
  computeMainPortionCoverageFromDraft,
} from './recommendationCartSummary';
export {
  forcedCategoryTagForFlowPhase,
  getNextActionBannerMessage,
  resolveNextActionFlowPhase,
} from './nextActionAfterMains';
export type {
  NextActionFlowPhase,
  NextActionHintKey,
  NextActionHintsShown,
} from './nextActionAfterMains';
export type { RecommendationCartSummary } from './recommendationCartSummary';
