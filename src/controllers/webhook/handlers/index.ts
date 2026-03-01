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

// Fallback
import { FallbackHandler } from './fallbackHandler';

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
  
  // === INTENCIONES (NLP) ===
  new OrderFoodHandler(),
  new RemoveItemHandler(),
  
  // === FALLBACK (siempre último) ===
  new FallbackHandler()
];