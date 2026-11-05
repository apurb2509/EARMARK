import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());

// Raw body needed for PayPal webhook signature verification
app.use('/api/paypal/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/healthz', healthRouter);

// Placeholder routes — filled in subsequent commits
app.get('/', (_req, res) => {
  res.json({ name: 'EARMARK API', version: '0.1.0', status: 'booting' });
});

app.listen(PORT, () => {
  console.log(`[earmark] Server listening on :${PORT}`);
});

export { app };
