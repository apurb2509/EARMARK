// src/server/routes/lots.ts — GET /api/lots/:fundId (lots for a fund)

import { Router } from 'express';
import { listLotsByFund, getLot } from '../../ledger/lots.js';

export const lotsRouter = Router();

lotsRouter.get('/fund/:fundId', async (req, res) => {
  try {
    const lots = await listLotsByFund(req.params.fundId);
    res.json({ lots });
  } catch (err) {
    console.error('[lots] list error:', err);
    res.status(500).json({ error: 'Failed to fetch lots' });
  }
});

lotsRouter.get('/:lotId', async (req, res) => {
  try {
    const lot = await getLot(req.params.lotId);
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    res.json(lot);
  } catch (err) {
    console.error('[lots] get error:', err);
    res.status(500).json({ error: 'Failed to fetch lot' });
  }
});

