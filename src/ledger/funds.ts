// src/ledger/funds.ts — Fund projection with compare-and-set
//
// availableCents = raisedCents - refundedCents - atRiskCents - committedCents - settledCents
// Invariant: availableCents must never go negative.
// CAS uses ES seqNo + primaryTerm (if_seq_no / if_primary_term).

import { getElasticClient, INDICES } from '../elastic/client.js';
import type { FundProjection, Cents } from '../types.js';

interface ESVersioned<T> {
  doc: T;
  seqNo: number;
  primaryTerm: number;
}

/**
 * Read a fund projection from Elasticsearch.
 * Returns null if the fund does not exist.
 */
export async function getFundProjection(fundId: string): Promise<ESVersioned<FundProjection> | null> {
  const es = getElasticClient();
  try {
    const res = await es.get<FundProjection>({
      index: INDICES.FUNDS,
      id: fundId,
    });
    if (!res.found) return null;
    return {
      doc: res._source as FundProjection,
      seqNo: res._seq_no!,
      primaryTerm: res._primary_term!,
    };
  } catch (err: any) {
    if (err?.meta?.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Initialize a fund projection if it doesn't exist.
 */
export async function ensureFundProjection(fundId: string): Promise<void> {
  const es = getElasticClient();
  const initial: FundProjection = {
    fundId,
    raisedCents: 0,
    refundedCents: 0,
    atRiskCents: 0,
    committedCents: 0,
    settledCents: 0,
    availableCents: 0,
    seqNo: 0,
    version: 1,
  };
  try {
    await es.index({ index: INDICES.FUNDS, id: fundId, op_type: 'create', document: initial });
  } catch (err: any) {
    // 409 = already exists, that's fine
    if (err?.meta?.statusCode !== 409) throw err;
  }
}

/**
 * Credit a donation to a fund (called after DONATION_CONFIRMED webhook).
 * Uses optimistic concurrency: reads, checks invariant, writes with CAS.
 * Retries on conflict.
 */
export async function creditDonation(
  fundId: string,
  amountCents: Cents,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    f.raisedCents += amountCents;
    f.availableCents = computeAvailable(f);
    checkInvariant(f);
    return f;
  }, maxRetries);
}

/**
 * Reserve (commit) an amount for an approved proposal.
 * Throws if available < reservationCents.
 */
export async function reserveFund(
  fundId: string,
  reservationCents: Cents,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    if (f.availableCents < reservationCents) {
      throw new Error(`INSUFFICIENT_FUNDS: available=${f.availableCents} requested=${reservationCents}`);
    }
    f.committedCents += reservationCents;
    f.availableCents = computeAvailable(f);
    checkInvariant(f);
    return f;
  }, maxRetries);
}

/**
 * Settle a payout: move from committed → settled.
 */
export async function settleFund(
  fundId: string,
  amountCents: Cents,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    f.committedCents -= amountCents;
    f.settledCents += amountCents;
    f.availableCents = computeAvailable(f);
    checkInvariant(f);
    return f;
  }, maxRetries);
}

/**
 * Hold an amount as atRisk (dispute opened).
 */
export async function holdAtRisk(
  fundId: string,
  amountCents: Cents,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    f.atRiskCents += amountCents;
    f.availableCents = computeAvailable(f);
    // Don't throw on invariant here — deficit raises incident instead
    return f;
  }, maxRetries);
}

/**
 * Release atRisk (dispute resolved / payout returned).
 */
export async function releaseAtRisk(
  fundId: string,
  amountCents: Cents,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    f.atRiskCents = Math.max(0, f.atRiskCents - amountCents);
    f.availableCents = computeAvailable(f);
    return f;
  }, maxRetries);
}

/**
 * Freeze a fund.
 */
export async function freezeFund(
  fundId: string,
  reason: string,
  maxRetries = 5
): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    f.frozenAt = new Date().toISOString();
    f.frozenReason = reason;
    return f;
  }, maxRetries);
}

/**
 * Unfreeze a fund.
 */
export async function unfreezeFund(fundId: string, maxRetries = 5): Promise<FundProjection> {
  return updateFund(fundId, (f) => {
    delete f.frozenAt;
    delete f.frozenReason;
    return f;
  }, maxRetries);
}

// ── Core CAS update ───────────────────────────────────────────────────────────

async function updateFund(
  fundId: string,
  mutate: (f: FundProjection) => FundProjection,
  maxRetries: number
): Promise<FundProjection> {
  const es = getElasticClient();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const versioned = await getFundProjection(fundId);
    if (!versioned) {
      await ensureFundProjection(fundId);
      continue;
    }

    const updated = mutate({ ...versioned.doc });

    try {
      await es.index({
        index: INDICES.FUNDS,
        id: fundId,
        if_seq_no: versioned.seqNo,
        if_primary_term: versioned.primaryTerm,
        document: updated,
      });
      return updated;
    } catch (err: any) {
      if (err?.meta?.statusCode === 409) {
        console.warn(`[funds] CAS conflict for ${fundId}, retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`[funds] CAS failed for ${fundId} after ${maxRetries} retries`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeAvailable(f: FundProjection): Cents {
  return f.raisedCents - f.refundedCents - f.atRiskCents - f.committedCents - f.settledCents;
}

function checkInvariant(f: FundProjection): void {
  if (f.availableCents < 0) {
    throw new Error(
      `INVARIANT_VIOLATION: available went negative in fund ${f.fundId}: ${f.availableCents}`
    );
  }
}

/**
 * List all fund projections.
 */
export async function listFunds(): Promise<FundProjection[]> {
  const es = getElasticClient();
  const res = await es.search<FundProjection>({
    index: INDICES.FUNDS,
    size: 100,
    query: { match_all: {} },
  });
  return res.hits.hits.map(h => h._source as FundProjection);
}

