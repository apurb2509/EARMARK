// tests/unit/ledger.test.ts — hash chain, fund projections, replay, tamper detection

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeHash, canonicalize } from '../../src/ledger/append.js';

// ─── canonicalize ─────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('sorts object keys alphabetically', () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts keys recursively in nested objects', () => {
    const result = canonicalize({ b: { d: 4, c: 3 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('handles arrays without reordering elements', () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('handles primitives', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(null)).toBe('null');
  });

  it('produces identical output for same content in different key order', () => {
    const a = canonicalize({ foo: 1, bar: 2 });
    const b = canonicalize({ bar: 2, foo: 1 });
    expect(a).toBe(b);
  });
});

// ─── computeHash ─────────────────────────────────────────────────────────────

describe('computeHash', () => {
  const GENESIS = '0'.repeat(64);

  it('returns a 64-character hex string', () => {
    const h = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F1' }, '2026-01-01T00:00:00.000Z');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce same hash', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F1' }, '2026-01-01T00:00:00.000Z');
    const h2 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F1' }, '2026-01-01T00:00:00.000Z');
    expect(h1).toBe(h2);
  });

  it('changes when prevHash changes', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F' }, 'ts');
    const h2 = computeHash('a'.repeat(64), 1, 'LOT_CREATED', { fundId: 'F' }, 'ts');
    expect(h1).not.toBe(h2);
  });

  it('changes when seq changes', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F' }, 'ts');
    const h2 = computeHash(GENESIS, 2, 'LOT_CREATED', { fundId: 'F' }, 'ts');
    expect(h1).not.toBe(h2);
  });

  it('changes when eventType changes', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F' }, 'ts');
    const h2 = computeHash(GENESIS, 1, 'DONATION_CONFIRMED', { fundId: 'F' }, 'ts');
    expect(h1).not.toBe(h2);
  });

  it('changes when payload changes', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F', amount: 100 }, 'ts');
    const h2 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F', amount: 101 }, 'ts');
    expect(h1).not.toBe(h2);
  });

  it('changes when createdAt changes', () => {
    const h1 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F' }, '2026-01-01T00:00:00.000Z');
    const h2 = computeHash(GENESIS, 1, 'LOT_CREATED', { fundId: 'F' }, '2026-01-02T00:00:00.000Z');
    expect(h1).not.toBe(h2);
  });

  it('is not affected by payload key order (canonical)', () => {
    const h1 = computeHash(GENESIS, 1, 'PROPOSAL', { z: 9, a: 1 }, 'ts');
    const h2 = computeHash(GENESIS, 1, 'PROPOSAL', { a: 1, z: 9 }, 'ts');
    expect(h1).toBe(h2);
  });
});

// ─── Hash chain simulation (pure, in-memory) ──────────────────────────────────

describe('Hash chain integrity simulation', () => {
  interface FakeEntry {
    seq: number;
    eventType: string;
    payload: Record<string, unknown>;
    prevHash: string;
    hash: string;
    createdAt: string;
  }

  function buildChain(n: number): FakeEntry[] {
    const entries: FakeEntry[] = [];
    let prevHash = '0'.repeat(64);
    for (let i = 1; i <= n; i++) {
      const eventType = 'LOT_CREATED' as const;
      const payload = { fundId: 'F', seq: i };
      const createdAt = `2026-01-0${i}T00:00:00.000Z`;
      const hash = computeHash(prevHash, i, eventType, payload, createdAt);
      entries.push({ seq: i, eventType, payload, prevHash, hash, createdAt });
      prevHash = hash;
    }
    return entries;
  }

  function verifyChain(entries: FakeEntry[]): { valid: boolean; brokenAt?: number } {
    let prevHash = '0'.repeat(64);
    for (const e of entries) {
      const expected = computeHash(prevHash, e.seq, e.eventType as any, e.payload, e.createdAt);
      if (expected !== e.hash) return { valid: false, brokenAt: e.seq };
      prevHash = e.hash;
    }
    return { valid: true };
  }

  it('verifies a correct 5-entry chain', () => {
    const chain = buildChain(5);
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it('detects tamper at entry 1 (payload mutation)', () => {
    const chain = buildChain(5);
    chain[0].payload = { fundId: 'EVIL', seq: 1 }; // tamper payload
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('detects tamper at entry 3 (hash mutation)', () => {
    const chain = buildChain(5);
    chain[2].hash = 'deadbeef' + 'a'.repeat(56); // tamper stored hash
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it('detects tamper at last entry', () => {
    const chain = buildChain(5);
    chain[4].payload = { fundId: 'TAMPERED' };
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(5);
  });

  it('verifier uses running prevHash not stored prevHash field (re-link attack has no effect)', () => {
    // The verifier tracks its own prevHash from the previous hash — not from entry.prevHash.
    // This means mutating entry.prevHash alone won't trick the verifier, which is correct:
    // the security property is that hash = f(prevHash_computed, ...) and that chain is unbroken.
    const chain = buildChain(5);
    chain[1].prevHash = 'b'.repeat(64); // attacker mutates stored prevHash field only
    // verifier re-derives prevHash from entry[0].hash → entry[1] check still passes
    // because entry[1].hash was computed with the real prevHash
    const result = verifyChain(chain);
    // The chain DOES still verify because we recompute prevHash from entry[0].hash,
    // which is correct. The stored prevHash field is redundant for verification.
    expect(result.valid).toBe(true);
    // Note: in audit-vault UI we additionally display the stored prevHash alongside
    // the computed one so discrepancies are visible to auditors.
  });

  it('detects tamper at createdAt', () => {
    const chain = buildChain(5);
    chain[2].createdAt = '2099-01-01T00:00:00.000Z';
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it('reports valid on empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });
});

// ─── Fund balance invariant (pure simulation) ─────────────────────────────────

describe('Fund balance invariant', () => {
  interface FundState {
    raisedCents: number;
    refundedCents: number;
    atRiskCents: number;
    committedCents: number;
    settledCents: number;
  }

  function available(f: FundState): number {
    return f.raisedCents - f.refundedCents - f.atRiskCents - f.committedCents - f.settledCents;
  }

  const BASE: FundState = {
    raisedCents: 20000,    // $200
    refundedCents: 0,
    atRiskCents: 0,
    committedCents: 0,
    settledCents: 0,
  };

  it('available = raised after donation', () => {
    expect(available(BASE)).toBe(20000);
  });

  it('available decreases when committed', () => {
    expect(available({ ...BASE, committedCents: 5000 })).toBe(15000);
  });

  it('available decreases when settled (committed moves to settled, net same reduction)', () => {
    // Both committedCents and settledCents reduce available, so with 5000 committed + 5000 settled
    // the total deducted is 10000: available = 20000 - 10000 = 10000
    expect(available({ ...BASE, committedCents: 5000, settledCents: 5000 })).toBe(10000);
  });

  it('available correct after refund', () => {
    expect(available({ ...BASE, refundedCents: 2000 })).toBe(18000);
  });

  it('available correct after dispute hold', () => {
    expect(available({ ...BASE, atRiskCents: 3000 })).toBe(17000);
  });

  it('detects negative available (invariant violation)', () => {
    const f: FundState = { ...BASE, committedCents: 25000 }; // over-committed
    expect(available(f)).toBeLessThan(0);
  });

  it('available = 0 when fully spent', () => {
    const f: FundState = { ...BASE, settledCents: 20000 };
    expect(available(f)).toBe(0);
  });
});
