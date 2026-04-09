import { Router } from "express";
import {
  getOrderById,
  getOrders,
  patchOrderDeliveryStatus,
  patchOrderPaymentStatus
} from "../controllers/adminOrders.controller";
import {
  getReservationById,
  getReservations
} from "../controllers/adminReservations.controller";
import {
  getDeliveryZoneById,
  getDeliveryZones,
  patchDeliveryZone,
  postDeliveryZone,
  removeDeliveryZone
} from "../controllers/adminDeliveryZones.controller";
import {
  getMenuCategoriesOptions,
  getMenuItemById,
  getMenuItems,
  patchMenuItem,
  postMenuItem,
  removeMenuItem
} from "../controllers/adminMenuItems.controller";
import { getDashboardSummary } from "../controllers/adminDashboard.controller";
import { getWhatsappMessages } from "../controllers/adminWhatsappMessages.controller";
import {
  getWhatsappConversationBotStatus,
  patchWhatsappConversationBotStatus
} from "../controllers/adminWhatsappBotControl.controller";
import { postAdminWhatsappReply } from "../controllers/adminWhatsappReply.controller";
import { authenticateJwt, requireRoles } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticateJwt);

router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);
router.patch("/orders/:id/status", patchOrderDeliveryStatus);
router.patch("/orders/:id/payment-status", patchOrderPaymentStatus);
router.get("/dashboard/summary", getDashboardSummary);
router.get("/whatsapp/messages", getWhatsappMessages);
router.get(
  "/whatsapp/conversations/:conversationId/bot",
  getWhatsappConversationBotStatus
);
router.patch(
  "/whatsapp/conversations/:conversationId/bot",
  patchWhatsappConversationBotStatus
);
router.post("/whatsapp/conversations/:conversationId/messages", postAdminWhatsappReply);
router.get(
  "/menu-categories/options",
  requireRoles("OWNER", "ADMIN"),
  getMenuCategoriesOptions
);
router.get("/menu-items", requireRoles("OWNER", "ADMIN"), getMenuItems);
router.get("/menu-items/:id", requireRoles("OWNER", "ADMIN"), getMenuItemById);
router.post("/menu-items", requireRoles("OWNER", "ADMIN"), postMenuItem);
router.patch("/menu-items/:id", requireRoles("OWNER", "ADMIN"), patchMenuItem);
router.delete("/menu-items/:id", requireRoles("OWNER", "ADMIN"), removeMenuItem);
router.get("/delivery-zones", requireRoles("OWNER", "ADMIN"), getDeliveryZones);
router.get(
  "/delivery-zones/:id",
  requireRoles("OWNER", "ADMIN"),
  getDeliveryZoneById
);
router.post("/delivery-zones", requireRoles("OWNER", "ADMIN"), postDeliveryZone);
router.patch(
  "/delivery-zones/:id",
  requireRoles("OWNER", "ADMIN"),
  patchDeliveryZone
);
router.delete(
  "/delivery-zones/:id",
  requireRoles("OWNER", "ADMIN"),
  removeDeliveryZone
);

router.get("/reservations", getReservations);
router.get("/reservations/:id", getReservationById);

export default router;
