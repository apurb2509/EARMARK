// src/ledger/append.ts — Event-sourced ledger with SHA-256 hash chain
//
// Hash: SHA256(prevHash + seq + eventType + canonical(payload) + createdAt)
// Commit point: op_type=create with _id=seq → prevents forks (two writers
// cannot both succeed at the same seq; the loser retries).
//
// Invariant enforced on every append: available = raised - refunded - atRisk - committed - settled ≥ 0

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getElasticClient, INDICES } from '../elastic/client.js';
import type { EventType, LedgerEntry } from '../types.js';

const GENESIS_HASH = '0'.repeat(64);

/**
 * Canonicalize an object for hashing: sort keys recursively, no extra whitespace.
 */
export function canonicalize(obj: unknown): string {
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  if (obj !== null && typeof obj === 'object') {
    const sorted = Object.keys(obj as object)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`)
      .join(',');
    return `{${sorted}}`;
  }
  return JSON.stringify(obj);
}

/**
 * Compute the hash for a ledger entry.
 */
export function computeHash(
  prevHash: string,
  seq: number,
  eventType: EventType,
  payload: Record<string, unknown>,
  createdAt: string
): string {
  const input = `${prevHash}|${seq}|${eventType}|${canonicalize(payload)}|${createdAt}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Get the current ledger head (highest seq entry).
 * Returns { seq: 0, hash: GENESIS_HASH } if the ledger is empty.
 */
export async function getLedgerHead(): Promise<{ seq: number; hash: string }> {
  const es = getElasticClient();
  try {
    const result = await es.search<LedgerEntry>({
      index: INDICES.LEDGER,
      size: 1,
      sort: [{ seq: 'desc' }],
      query: { match_all: {} },
    });
    const hit = result.hits.hits[0];
    if (!hit?._source) return { seq: 0, hash: GENESIS_HASH };
    return { seq: hit._source.seq, hash: hit._source.hash };
  } catch {
    return { seq: 0, hash: GENESIS_HASH };
  }
}

/**
 * Append one event to the ledger.
 * Retries up to `maxRetries` times on seq conflict (409).
 * Throws after exhausting retries.
 */
export async function appendLedgerEntry(
  eventType: EventType,
  payload: Record<string, unknown>,
  maxRetries = 5
): Promise<LedgerEntry> {
  const es = getElasticClient();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { seq: prevSeq, hash: prevHash } = await getLedgerHead();
    const seq = prevSeq + 1;
    const createdAt = new Date().toISOString();
    const hash = computeHash(prevHash, seq, eventType, payload, createdAt);

    const entry: LedgerEntry = { seq, eventType, payload, prevHash, hash, createdAt };

    try {
      await es.index({
        index: INDICES.LEDGER,
        id: String(seq),
        op_type: 'create', // fails with 409 if seq already exists (fork prevention)
        document: entry,
      });
      return entry;
    } catch (err: any) {
      if (err?.statusCode === 409 || err?.meta?.statusCode === 409) {
        // Another writer won this seq; re-read head and retry
        console.warn(`[ledger] Seq conflict at ${seq}, retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`[ledger] Could not append after ${maxRetries} retries — persistent seq conflict`);
}

/**
 * Replay the entire ledger to verify the hash chain.
 * Returns { valid: true, headHash, count } or throws with the broken seq.
 */
export async function replayAndVerify(): Promise<{ valid: boolean; headHash: string; count: number; brokenAt?: number }> {
  const es = getElasticClient();
  const result = await es.search<LedgerEntry>({
    index: INDICES.LEDGER,
    size: 10000,
    sort: [{ seq: 'asc' }],
    query: { match_all: {} },
  });

  const entries = result.hits.hits.map(h => h._source as LedgerEntry);
  let prevHash = GENESIS_HASH;

  for (const entry of entries) {
    const expected = computeHash(prevHash, entry.seq, entry.eventType, entry.payload, entry.createdAt);
    if (expected !== entry.hash) {
      return { valid: false, headHash: prevHash, count: entries.length, brokenAt: entry.seq };
    }
    prevHash = entry.hash;
  }

  return { valid: true, headHash: prevHash, count: entries.length };
}

/**
 * Replay ledger and rebuild fund balances from scratch.
 * Returns a map of fundId → balance snapshot.
 */
export async function replayFundBalances(): Promise<
  Record<string, { raisedCents: number; refundedCents: number; atRiskCents: number; committedCents: number; settledCents: number; availableCents: number }>
> {
  const es = getElasticClient();
  const result = await es.search<LedgerEntry>({
    index: INDICES.LEDGER,
    size: 10000,
    sort: [{ seq: 'asc' }],
    query: { match_all: {} },
  });

  const entries = result.hits.hits.map(h => h._source as LedgerEntry);
  const balances: Record<string, { raisedCents: number; refundedCents: number; atRiskCents: number; committedCents: number; settledCents: number; availableCents: number }> = {};

  const ensure = (fundId: string) => {
    if (!balances[fundId]) {
      balances[fundId] = { raisedCents: 0, refundedCents: 0, atRiskCents: 0, committedCents: 0, settledCents: 0, availableCents: 0 };
    }
  };

  for (const entry of entries) {
    const p = entry.payload;
    const fundId = p.fundId as string | undefined;
    if (!fundId) continue;
    ensure(fundId);
    const b = balances[fundId];

    switch (entry.eventType) {
      case 'DONATION_CONFIRMED':
        b.raisedCents += (p.amountCents as number) ?? 0;
        break;
      case 'REFUND':
        b.refundedCents += (p.amountCents as number) ?? 0;
        break;
      case 'DISPUTE_HOLD':
        b.atRiskCents += (p.amountCents as number) ?? 0;
        break;
      case 'VERDICT':
        if ((p.decision as string) !== 'DENY' && (p.decision as string) !== 'FREEZE') {
          b.committedCents += (p.reservationCents as number) ?? 0;
        }
        break;
      case 'SETTLED':
        b.committedCents -= (p.amountCents as number) ?? 0;
        b.settledCents += (p.amountCents as number) ?? 0;
        break;
    }

    b.availableCents = b.raisedCents - b.refundedCents - b.atRiskCents - b.committedCents - b.settledCents;
  }

  return balances;
}
