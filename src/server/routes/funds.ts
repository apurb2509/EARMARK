// src/server/routes/funds.ts — GET /api/funds, GET /api/funds/:id

import { Router } from 'express';
import { listFunds, getFundProjection } from '../../ledger/funds.js';

export const fundsRouter = Router();

fundsRouter.get('/', async (_req, res) => {
  try {
    const funds = await listFunds();
    res.json({ funds });
  } catch (err) {
    console.error('[funds] list error:', err);
    res.status(500).json({ error: 'Failed to fetch funds' });
  }
});

fundsRouter.get('/:fundId', async (req, res) => {
  try {
    const versioned = await getFundProjection(req.params.fundId);
    if (!versioned) return res.status(404).json({ error: 'Fund not found' });
    res.json(versioned.doc);
  } catch (err) {
    console.error('[funds] get error:', err);
    res.status(500).json({ error: 'Failed to fetch fund' });
  }
});
