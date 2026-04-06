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
import { authenticateJwt } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticateJwt);

router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);
router.patch("/orders/:id/status", patchOrderDeliveryStatus);
router.patch("/orders/:id/payment-status", patchOrderPaymentStatus);
router.get("/dashboard/summary", getDashboardSummary);

router.get("/reservations", getReservations);
router.get("/reservations/:id", getReservationById);

export default router;
