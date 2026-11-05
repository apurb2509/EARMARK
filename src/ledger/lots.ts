// src/ledger/lots.ts — Donation lot management
//
// A lot is created ONLY after PAYMENT.CAPTURE.COMPLETED webhook (status=COMPLETED).
// Browser callbacks NEVER credit funds.

import { v4 as uuidv4 } from 'uuid';
import { getElasticClient, INDICES } from '../elastic/client.js';
import type { DonationLot, Cents } from '../types.js';

/**
 * Create a confirmed donation lot.
 * Called from the webhook handler after signature verification and status check.
 */
export async function createLot(params: {
  donationId: string;
  captureId: string;
  fundId: string;
  amountCents: Cents;
  mandateRef: string;    // "FUND:version"
  donorEmail?: string;
}): Promise<DonationLot> {
  const es = getElasticClient();

  const lot: DonationLot = {
    lotId: uuidv4(),
    donationId: params.donationId,
    captureId: params.captureId,
    donorEmail: params.donorEmail,
    fundId: params.fundId,
    amountCents: params.amountCents,
    spentCents: 0,
    status: 'CONFIRMED',
    mandateRef: params.mandateRef,
    createdAt: new Date().toISOString(),
  };

  await es.index({ index: INDICES.LOTS, id: lot.lotId, document: lot });
  return lot;
}

/**
 * Get a lot by its lot ID.
 */
export async function getLot(lotId: string): Promise<DonationLot | null> {
  const es = getElasticClient();
  try {
    const res = await es.get<DonationLot>({ index: INDICES.LOTS, id: lotId });
    return res.found ? (res._source as DonationLot) : null;
  } catch (err: any) {
    if (err?.meta?.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Find a lot by donationId (invoice_id on the PayPal order).
 */
export async function getLotByDonationId(donationId: string): Promise<DonationLot | null> {
  const es = getElasticClient();
  const res = await es.search<DonationLot>({
    index: INDICES.LOTS,
    query: { term: { donationId } },
    size: 1,
  });
  const hit = res.hits.hits[0];
  return hit?._source ?? null;
}

/**
 * List all lots for a fund, ordered by creation date.
 */
export async function listLotsByFund(fundId: string): Promise<DonationLot[]> {
  const es = getElasticClient();
  const res = await es.search<DonationLot>({
    index: INDICES.LOTS,
    query: { term: { fundId } },
    sort: [{ createdAt: 'asc' }],
    size: 1000,
  });
  return res.hits.hits.map(h => h._source as DonationLot);
}

/**
 * FIFO allocation: mark lots as spent for a given payout amount.
 * Returns the allocation map (lotId → amountAllocatedCents).
 */
export async function allocateLotsFIFO(
  fundId: string,
  amountCents: Cents
): Promise<Record<string, Cents>> {
  const es = getElasticClient();
  const lots = await listLotsByFund(fundId);
  const confirmedLots = lots.filter(l => l.status === 'CONFIRMED' && l.spentCents < l.amountCents);

  let remaining = amountCents;
  const allocation: Record<string, Cents> = {};

  for (const lot of confirmedLots) {
    if (remaining <= 0) break;
    const available = lot.amountCents - lot.spentCents;
    const toSpend = Math.min(available, remaining);

    allocation[lot.lotId] = toSpend;
    remaining -= toSpend;

    // Update the lot
    const newSpent = lot.spentCents + toSpend;
    const newStatus: DonationLot['status'] =
      newSpent >= lot.amountCents ? 'FULLY_SPENT' : 'CONFIRMED';

    await es.update({
      index: INDICES.LOTS,
      id: lot.lotId,
      doc: { spentCents: newSpent, status: newStatus },
    });
  }

  return allocation;
}

