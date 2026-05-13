import { Router } from 'express';
import { proxyRequestToLangGraph } from '../controllers/whatsapp.controller.v2';

const router = Router();

/**
 * Proxy de todo `/api/*` hacia el backend LangGraph (misma ruta y query).
 * Base URL: LANGGRAPH_PROXY_URL o https://food-service-langraph.onrender.com
 *
 * Montar en `app.use('/api', router)` para cubrir auth, whatsapp, admin, etc.
 */
router.use(proxyRequestToLangGraph);

export default router;

