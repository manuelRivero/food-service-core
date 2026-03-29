export const workerTextMessages = {
  draftOrderReminder: (minutes: number) =>
    `🤖\n\n*🛒 Tienes un pedido en curso.*\n\nSi no finalizas tu compra en ${minutes} minutos, tu pedido será cancelado automáticamente.*`,
  draftOrderReminderListBody: (minutes: number) =>
    `🤖\n\n*🛒 Tienes un pedido en curso.*\n\nSi no finalizas tu compra en ${minutes} minutos, tu pedido será cancelado automáticamente.\n\n¿Querés continuar?*`,
  draftOrderExpiredListBody:
    '🤖\n\n*⏰ Tu pedido fue cancelado por inactividad.*\n\nPodés iniciar uno nuevo cuando quieras.\n\n¿Querés volver a empezar?*',
  conversationIdleReminder: (minutes: number) =>
    `🤖\n\n*⏳ ¿Seguís ahí?*\n\nSi no respondés en ${minutes} minutos, cerraremos la conversación por inactividad.`,
  conversationIdleClosed:
    '🤖\n\n*✅ Conversación finalizada por inactividad.*\n\nPodés escribirnos cuando quieras.*',
} as const;
