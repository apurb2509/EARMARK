import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { bootstrapIndices } from '../elastic/client.js';
import { healthRouter } from './routes/health.js';
import { donationsRouter } from './routes/donations.js';
import { webhookRouter } from './routes/webhook.js';
import { fundsRouter } from './routes/funds.js';
import { ledgerRouter } from './routes/ledger.js';
import { lotsRouter } from './routes/lots.js';
import { receiptsRouter } from './routes/receipts.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors());

// ── Raw body MUST come before express.json() for webhook signature verification
app.use('/api/paypal/webhook', express.raw({ type: 'application/json' }));

// ── JSON body for all other routes ────────────────────────────────────────────
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/healthz', healthRouter);
app.use('/api/donations', donationsRouter);
app.use('/api/paypal/webhook', webhookRouter);
app.use('/api/funds', fundsRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/api/lots', lotsRouter);
app.use('/api/receipts', receiptsRouter);

// Root info
app.get('/', (_req, res) => {
  res.json({
    name: 'EARMARK',
    version: '0.1.0',
    description: 'Donor intent, enforced by code, settled on PayPal',
    demoMode: process.env.DEMO_MODE === 'true',
  });
});

// ── Render cold-start keepalive ───────────────────────────────────────────────
if (process.env.PUBLIC_BASE_URL && process.env.NODE_ENV === 'production') {
  const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 min
  setInterval(async () => {
    try {
      await fetch(`${process.env.PUBLIC_BASE_URL}/healthz`);
      console.log('[keepalive] ping sent');
    } catch (e) {
      console.warn('[keepalive] ping failed', e);
    }
  }, KEEPALIVE_INTERVAL_MS);
}

// ── Bootstrap Elasticsearch indices, then start server ───────────────────────
async function start() {
  try {
    await bootstrapIndices();
  } catch (err) {
    console.error('[earmark] Elasticsearch bootstrap failed:', err);
    console.error('[earmark] Starting anyway — routes will fail until ES is reachable');
  }

  app.listen(PORT, () => {
    console.log(`[earmark] Server listening on :${PORT} (${process.env.NODE_ENV ?? 'development'})`);
    if (process.env.DEMO_MODE === 'true') {
      console.warn('[earmark] ⚠  DEMO_MODE=true — using seeded/replay flows');
    }
  });
}

start();
export { app };
