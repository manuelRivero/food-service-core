import 'dotenv/config';
import express, { Request, Response } from 'express';
import whatsappRoutes from './routes/whatsapp.routes';
import checkinRoutes from './routes/checkin.routes';

import { processDraftOrderTimeouts } from './workers/draftOrders';

setInterval(processDraftOrderTimeouts, 60000)

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/whatsapp', whatsappRoutes);
app.use('/checkin', checkinRoutes);

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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

export default app;

