// src/server/routes/receipts.ts — GET /api/receipts/:donationId (public)
// Shows: donation lot → allocated payouts → vendor → settlement + hash proof
// Fully public — no auth required; uses donationId as the token (UUID).

import { Router } from 'express';
import { getLotByDonationId } from '../../ledger/lots.js';
import { getElasticClient, INDICES } from '../../elastic/client.js';
import { getLedgerHead } from '../../ledger/append.js';
import type { LedgerEntry } from '../../types.js';

export const receiptsRouter = Router();

receiptsRouter.get('/:donationId', async (req, res) => {
  try {
    const { donationId } = req.params;

    // 1. Find the lot
    const lot = await getLotByDonationId(donationId);
    if (!lot) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    // 2. Find ledger entries related to this donation
    const es = getElasticClient();
    const ledgerResult = await es.search<LedgerEntry>({
      index: INDICES.LEDGER,
      size: 100,
      sort: [{ seq: 'asc' }],
      query: {
        bool: {
          should: [
            { term: { 'payload.donationId': donationId } },
            { term: { 'payload.lotId': lot.lotId } },
          ],
        },
      },
    });

    const ledgerEntries = ledgerResult.hits.hits.map(h => h._source as LedgerEntry);

    // 3. Find settled payouts that allocated from this lot
    const reconResult = await es.search({
      index: INDICES.RECON,
      size: 50,
      query: { term: { 'lotAllocations.lotId': lot.lotId } },
    });
    const payouts = reconResult.hits.hits.map(h => h._source);

    // 4. Get current head hash for public display
    const { hash: headHash } = await getLedgerHead();

    res.json({
      donationId,
      lot,
      ledgerEntries,
      payouts,
      headHash,
      verifyUrl: `${process.env.PUBLIC_BASE_URL ?? ''}/api/ledger/verify`,
    });
  } catch (err) {
    console.error('[receipts] error:', err);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

