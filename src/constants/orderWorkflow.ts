/**
 * Estados que el panel admin puede asignar al flujo de entrega (valor persistido en `orders.status`).
 * Etiquetas en español para UI y mensajes al cliente.
 */
export const ADMIN_ORDER_DELIVERY_STATUSES = [
  "preparing",
  "shipped",
  "delivered"
] as const;

export type AdminOrderDeliveryStatus =
  (typeof ADMIN_ORDER_DELIVERY_STATUSES)[number];

export const ADMIN_ORDER_DELIVERY_LABEL_ES: Record<
  AdminOrderDeliveryStatus,
  string
> = {
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado"
};

export function isAdminOrderDeliveryStatus(
  value: string
): value is AdminOrderDeliveryStatus {
  return (ADMIN_ORDER_DELIVERY_STATUSES as readonly string[]).includes(value);
}
