export const workerTextMessages = {
  draftOrderReminder: (minutes: number) =>
    `🛒 Tienes un pedido en curso.\nSi no finalizas tu compra en ${minutes} minutos, tu pedido será cancelado automáticamente.`,
  draftOrderExpired:
    '⏰ Tu pedido fue cancelado por inactividad.\nPuedes iniciar uno nuevo cuando quieras.',
  conversationIdleReminder: (minutes: number) =>
    `⏳ ¿Seguís ahí?\nSi no respondés en ${minutes} minutos, cerraremos la conversación por inactividad.`,
  conversationIdleClosed:
    '✅ Conversación finalizada por inactividad.\nPodés escribirnos cuando quieras.'
} as const;
