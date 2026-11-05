// scripts/verifyChain.ts — standalone ledger chain verifier
// Run with: npm run verify-chain

import 'dotenv/config';
import { Client } from '@elastic/elasticsearch';
import { createHash } from 'crypto';

const client = new Client({
  node: process.env.ELASTIC_URL ?? 'http://localhost:9200',
  auth: process.env.ELASTIC_API_KEY
    ? { apiKey: process.env.ELASTIC_API_KEY }
    : undefined,
});

async function verifyChain() {
  console.log('[verify] Fetching ledger entries…');

  const result = await client.search({
    index: 'ledger',
    size: 10000,
    sort: [{ seq: 'asc' }],
    query: { match_all: {} },
  });

  const entries = result.hits.hits.map((h: any) => h._source);
  console.log(`[verify] ${entries.length} entries found`);

  let prevHash = '0'.repeat(64);
  let broken = false;

  for (const entry of entries) {
    const { seq, eventType, payload, createdAt } = entry as any;
    const canonical = JSON.stringify(
      { prevHash, seq, eventType, payload: sortKeys(payload), createdAt }
    );
    const expected = createHash('sha256').update(canonical).digest('hex');

    if (expected !== entry.hash) {
      console.error(`[verify] ✗ BROKEN at seq=${seq}: expected ${expected}, got ${entry.hash}`);
      broken = true;
    } else {
      console.log(`[verify] ✓ seq=${seq} ${eventType}`);
    }
    prevHash = entry.hash;
  }

  if (!broken) {
    console.log(`\n[verify] Chain intact. Head hash: ${prevHash}`);
  } else {
    console.error('\n[verify] CHAIN INTEGRITY FAILURE');
    process.exit(1);
  }
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj as object).sort().reduce((acc, k) => {
      (acc as any)[k] = sortKeys((obj as any)[k]);
      return acc;
    }, {} as object);
  }
  return obj;
}

verifyChain().catch(e => { console.error(e); process.exit(1); });

