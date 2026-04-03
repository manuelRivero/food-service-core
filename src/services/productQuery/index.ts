export { executeProductQuery } from './service';
export type { ProductQueryServiceResult } from './types';
export { formatBotUserMessage } from './utils';
export {
  FOOD_RECOMMENDER_PROMPT,
  formatSmartRecommendationsBlock,
  formatSmartRecommendationsBullets,
  getSmartRecommendations,
} from './smartFoodRecommendations';
export type {
  FoodRecommenderCandidate,
  GetSmartRecommendationsResult,
  SmartFoodRecommendation,
} from './smartFoodRecommendations';
