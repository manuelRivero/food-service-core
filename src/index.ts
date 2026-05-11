import 'dotenv/config';
import './types/express';
import { createServer } from 'http';
import path from 'path';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { attachAdminSocket } from './socket/adminSocket';
import whatsappRoutes from './routes/whatsapp.routes';
import checkinRoutes from './routes/checkin.routes';
import authRoutes from './routes/auth.routes';
import adminOrdersRoutes from './routes/adminOrders.routes';
import superAdminRoutes from './routes/superAdmin.routes';
import publicRoutes from './routes/public.routes';

import { processDraftOrderTimeouts } from './workers/draftOrders';

setInterval(processDraftOrderTimeouts, 60000)

const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  })
);

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(process.cwd(), 'public')));

// Rutas
app.use('/api/whatsapp', whatsappRoutes);
app.use('/checkin', checkinRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminOrdersRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/public', publicRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Bienvenido al Food Service Backend',
    status: 'OK'
  });
});

// Ruta de health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

const httpServer = createServer(app);
attachAdminSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

export default app;

