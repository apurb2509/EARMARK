// src/server/routes/ledger.ts — GET /api/ledger, GET /api/ledger/verify

import { Router } from 'express';
import { getElasticClient, INDICES } from '../../elastic/client.js';
import { replayAndVerify, replayFundBalances } from '../../ledger/append.js';
import type { LedgerEntry } from '../../types.js';

export const ledgerRouter = Router();

/**
 * GET /api/ledger?from=0&size=50&fundId=SCHOOL-MEALS
 * Returns paginated ledger entries.
 */
ledgerRouter.get('/', async (req, res) => {
  const es = getElasticClient();
  try {
    const from = parseInt(req.query.from as string ?? '0');
    const size = Math.min(parseInt(req.query.size as string ?? '50'), 200);
    const fundId = req.query.fundId as string | undefined;

    const query = fundId
      ? { match: { 'payload.fundId': fundId } }
      : { match_all: {} };

    const result = await es.search<LedgerEntry>({
      index: INDICES.LEDGER,
      from,
      size,
      sort: [{ seq: 'desc' }],
      query,
    });

    res.json({
      total: result.hits.total,
      entries: result.hits.hits.map(h => h._source),
    });
  } catch (err) {
    console.error('[ledger] list error:', err);
    res.status(500).json({ error: 'Failed to fetch ledger' });
  }
});

/**
 * GET /api/ledger/verify
 * Recomputes the full hash chain + replays balances.
 * Also returns current head hash for public display.
 */
ledgerRouter.get('/verify', async (_req, res) => {
  try {
    const [chainResult, replayedBalances] = await Promise.all([
      replayAndVerify(),
      replayFundBalances(),
    ]);

    res.json({
      chainValid: chainResult.valid,
      headHash: chainResult.headHash,
      entryCount: chainResult.count,
      brokenAt: chainResult.brokenAt ?? null,
      replayedBalances,
    });
  } catch (err) {
    console.error('[ledger] verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

