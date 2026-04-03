export { executeProductQuery } from './service';
export type { ProductQueryServiceResult } from './types';
export { formatBotUserMessage } from './utils';
export {
  dedupeMenuItemSearchResultsById,
  FOOD_RECOMMENDER_PROMPT,
  formatSmartRecommendationsBlock,
  formatSmartRecommendationsBullets,
  getSmartRecommendations,
  MAX_WHATSAPP_LIST_ROWS,
} from './smartFoodRecommendations';
export type {
  FoodRecommenderCandidate,
  GetSmartRecommendationsResult,
  SmartFoodRecommendation,
} from './smartFoodRecommendations';
export {
  buildRecommendationCartSummary,
} from './recommendationCartSummary';
export type { RecommendationCartSummary } from './recommendationCartSummary';
