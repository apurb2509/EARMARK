// scripts/invariantCheck.ts — nightly ledger invariant job
// Replays balances from ledger and cross-checks against ES fund projections.
// Run with: npx tsx scripts/invariantCheck.ts
// Can also be triggered via GET /api/ledger/verify

import 'dotenv/config';
import { replayFundBalances, replayAndVerify } from '../src/ledger/append.js';
import { listFunds } from '../src/ledger/funds.js';

async function run() {
  console.log('[invariant] Starting check…\n');

  // 1. Verify hash chain
  const chain = await replayAndVerify();
  if (!chain.valid) {
    console.error(`[invariant] ✗ HASH CHAIN BROKEN at seq=${chain.brokenAt}`);
    process.exit(2);
  }
  console.log(`[invariant] ✓ Hash chain valid. ${chain.count} entries. Head: ${chain.headHash.slice(0, 12)}…\n`);

  // 2. Replay balances from ledger
  const replayed = await replayFundBalances();

  // 3. Load live fund projections
  const funds = await listFunds();

  let drift = false;
  for (const fund of funds) {
    const r = replayed[fund.fundId];
    if (!r) continue;

    const driftCents = Math.abs(fund.availableCents - r.availableCents);
    if (driftCents > 0) {
      console.error(
        `[invariant] ✗ DRIFT in fund ${fund.fundId}: ` +
        `projection=${fund.availableCents}¢ replay=${r.availableCents}¢ delta=${driftCents}¢`
      );
      drift = true;
    } else {
      console.log(`[invariant] ✓ Fund ${fund.fundId}: available=${fund.availableCents}¢ — matches replay`);
    }
  }

  if (drift) {
    console.error('\n[invariant] DRIFT DETECTED — projection is out of sync with ledger');
    process.exit(3);
  }

  console.log('\n[invariant] All invariants satisfied ✓');
}

run().catch(e => { console.error(e); process.exit(1); });

