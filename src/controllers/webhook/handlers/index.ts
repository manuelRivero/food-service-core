// src/controllers/webhook/handlers/index.ts

// Handlers de botones (payloadId)
import { SelectProductHandler } from './selectProductHandler';
import { SelectOrderProductHandler } from './selectOrderProductHandler';
import { OrderSearchPageHandler } from './orderSearchPageHandler';
import { CategoryPageHandler } from './categoryPageHandler';
import { CategoryListPageHandler } from './categoryListPageHandler';
import { CategoryHandler } from './categoryHandler';
import { AddItemHandler } from './addItemHandler';
import { CheckoutHandler } from './checkoutHandler';
import { CancelOrderHandler } from './cancelOrderHandler';
import { EndConversationHandler } from './endConversationHandler';
import { AskQuestionHandler } from './askQuestionHandler';
import { ViewMenuReturnHandler } from './viewMenuReturnHandler';
import { ViewCategoriesHandler } from './viewCategoriesHandler';
import { ConfirmRemoveActionHandler } from './confirmRemoveActionHandler';

// Handlers de intención (NLP)
import { OrderFoodHandler } from './orderFoodHandler';
import { RemoveItemHandler } from './removeItemHandler';
import { ProductQueryHandler } from './productQueryHandler';
import { ProductAttributeQuestionHandler } from './productAttributeQuestionHandler';
import { SmallTalkHandler } from './smallTalkHandler';

// Fallback
import { FallbackHandler } from './fallbackHandler';
import { ViewCartForEditionHandler } from './viewCartForEditionHandler';
import { ViewCartHandler } from './viewCartHandler';
import { ViewMenuHandler } from './viewMenuHandler';
import { SelectCartItemForEditionHandler } from './selectCartItemForEdition';
import { SelectDecreaseItemQuantityHandler } from './selectDecreaseItemQuantityHandler';
import { DecreaseItemHandler } from './decreaseItemHandler';
import { SelectIncreaseItemQuantityHandler } from './selectIncreaseItemQuantityHandler';
import { IncreaseItemHandler } from './increaseItemHandler';
import { OnboardingStartHandler } from './onboardingStartHandler';

export const handlers = [
  // === BOTONES (payloadId) - orden: más específicos primero ===
  new SelectProductHandler(),
  new SelectOrderProductHandler(),
  new OrderSearchPageHandler(),
  new CategoryPageHandler(),
  new CategoryListPageHandler(),
  new CategoryHandler(),
  new AddItemHandler(),
  new CheckoutHandler(),
  new CancelOrderHandler(),
  new EndConversationHandler(),
  new AskQuestionHandler(),
  new ViewMenuReturnHandler(),
  new ViewCategoriesHandler(),
  new ConfirmRemoveActionHandler(), // CONFIRM_REMOVE:id y CANCEL_REMOVE
  new ViewCartForEditionHandler(),
  new ViewCartHandler(),
  new ViewMenuHandler(),
  new SelectCartItemForEditionHandler(),
  new DecreaseItemHandler(),
  new SelectDecreaseItemQuantityHandler(),
  new IncreaseItemHandler(),
  new SelectIncreaseItemQuantityHandler(),
  new OnboardingStartHandler(),
  // === INTENCIONES (NLP) ===
  new OrderFoodHandler(),
  new SmallTalkHandler(),
  new RemoveItemHandler(),
  new ProductQueryHandler(),
  new ProductAttributeQuestionHandler(),
  
  // === FALLBACK (siempre último) ===
  new FallbackHandler()
];