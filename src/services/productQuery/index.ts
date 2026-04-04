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
} from './recommendationCartSummary';
export type { RecommendationCartSummary } from './recommendationCartSummary';
