import { Router } from "express";
import {
  getOrderById,
  getOrders
} from "../controllers/adminOrders.controller";
import {
  getReservationById,
  getReservations
} from "../controllers/adminReservations.controller";
import { authenticateJwt } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticateJwt);

router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);

router.get("/reservations", getReservations);
router.get("/reservations/:id", getReservationById);

export default router;
