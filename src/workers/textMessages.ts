export const workerTextMessages = {
  draftOrderReminder: (minutes: number) =>
    `🛒 Tienes un pedido en curso.\nSi no finalizas tu compra en ${minutes} minutos, tu pedido será cancelado automáticamente.`,
  draftOrderReminderListBody: (minutes: number) =>
    `🛒 Tienes un pedido en curso.\nSi no finalizas tu compra en ${minutes} minutos, tu pedido será cancelado automáticamente.\n\n¿Querés continuar?`,
  draftOrderExpiredListBody:
    '⏰ Tu pedido fue cancelado por inactividad.\nPodés iniciar uno nuevo cuando quieras.\n\n¿Querés volver a empezar?',
  conversationIdleReminder: (minutes: number) =>
    `⏳ ¿Seguís ahí?\nSi no respondés en ${minutes} minutos, cerraremos la conversación por inactividad.`,
  conversationIdleClosed:
    '✅ Conversación finalizada por inactividad.\nPodés escribirnos cuando quieras.'
} as const;
