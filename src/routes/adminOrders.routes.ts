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
import { getDashboardSummary } from "../controllers/adminDashboard.controller";
import { getWhatsappMessages } from "../controllers/adminWhatsappMessages.controller";
import {
  getWhatsappConversationBotStatus,
  patchWhatsappConversationBotStatus
} from "../controllers/adminWhatsappBotControl.controller";
import { authenticateJwt } from "../middleware/auth.middleware";

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

router.get("/reservations", getReservations);
router.get("/reservations/:id", getReservationById);

export default router;
