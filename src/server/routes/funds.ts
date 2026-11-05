// src/server/routes/funds.ts — GET /api/funds, GET /api/funds/:id

import { Router } from 'express';

export const fundsRouter = Router();

// Placeholder — wired to Elasticsearch projections in commit 3
fundsRouter.get('/', async (_req, res) => {
  res.json({ funds: [], message: 'Fund projections wired in commit 3' });
});

fundsRouter.get('/:fundId', async (req, res) => {
  res.json({ fundId: req.params.fundId, message: 'Fund projection wired in commit 3' });
});

