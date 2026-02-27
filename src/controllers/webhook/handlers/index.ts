// webhooks/handlers/index.ts
import { WebhookHandler } from '../types';

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
import { FallbackHandler } from './fallbackHandler';
import { ConfirmRemoveItemHandler } from './confirmRemoveItem';
import { RemoveItemHandler } from './removeItem';
import { OrderFoodHandler } from './orderFoodHandler';

export const handlers: WebhookHandler[] = [
  // Específicos con parámetros (más específicos primero)
  new SelectProductHandler(),
  new SelectOrderProductHandler(),
  new OrderSearchPageHandler(),
  new CategoryPageHandler(),
  new CategoryListPageHandler(),
  new CategoryHandler(),
  new AddItemHandler(),
  new ConfirmRemoveItemHandler(),
  new RemoveItemHandler(),
  new OrderFoodHandler(),
  
  // Comandos exactos
  new CheckoutHandler(),
  new CancelOrderHandler(),
  new EndConversationHandler(),
  new AskQuestionHandler(),
  new ViewMenuReturnHandler(),
  new ViewCategoriesHandler(),
  
  // Siempre al final
  new FallbackHandler()
];