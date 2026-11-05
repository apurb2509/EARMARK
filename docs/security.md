# EARMARK — Security & Threat Model

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Prompt injection via vendor/product text | Engine ignores free text; payee/amounts from registry + structured fields only |
| Payee swap via agent arguments | Rule D4: payee resolved server-side from vendor registry; Executor re-checks before every PayPal call |
| Runaway agent loop | Call cap (12), proposal cap (5), token budget, per-task kill switch |
| Double spend / race condition | Atomic reservation with ES compare-and-set; per-fund async queue |
| Replay / edited approval | Approval binds proposalHash; Executor recomputes hash and rejects mismatch; 24h expiry |
| Fake webhook | Signature verified via PayPal `verify-webhook-signature` endpoint (real events only; sandbox simulator events are unsigned) |
| Duplicate / out-of-order webhooks | Dedupe by PayPal event ID (`op_type=create` on `webhooks` index); park and retry matcher |
| Ledger rewrite by insider | PayPal-anchored hashes, Zapier daily witness, PayPal batch cross-check |
| Insider splitting payouts | Daily cap + structuring detection (3+ payouts ≥90% human threshold to one vendor in 24h) |
| Single-approver collusion | Two-person rule above threshold: two distinct approvers, neither the requester |
| Spending unconfirmed money | Only webhook-confirmed COMPLETED lots are spendable; browser callbacks never credit |
| Clawback after spending | Dispute holds atRisk; deficit incident; freeze if atRisk > threshold |
| Secret leakage | Secrets only in Executor + Render env vars; `.env.example` is the only env file in repo |
| Spending after freeze | Executor re-checks freeze state immediately before every PayPal API call |

## Honest Limitations

This is a **sandbox proof of concept**. Known architectural limitations:

1. **No multi-document transactions in Elasticsearch.** The design compensates with:
   - Atomic seq commit (`op_type=create`)
   - Compare-and-set on fund projections
   - Write-ahead EXECUTION_INTENT ledger entry
   - Nightly replay + invariant checks
   A production system would use a transactional database (Postgres) alongside ES for the financial ledger.

2. **Single Render instance** provides the per-fund async queue. A multi-instance deployment would need a distributed lock (e.g. Redis SETNX).

3. **Sandbox only** — real PayPal production onboarding, KYC, and country-specific Payouts availability are not covered.

4. **Approval identity** — the demo uses role labels. Production needs real identity (OAuth, MFA).

5. **Hash chain** is not a blockchain. A determined attacker with Elasticsearch write access + knowledge of the algorithm can rewrite the chain. Mitigations (PayPal anchor, Zapier witness) raise the cost but are not cryptographic proofs.

## Sensitive Data Handling

- No PayPal credentials stored in the ledger or logs.
- Donor email is optional and stored only in the lot (not broadcast).
- Sandbox vendor emails are not real.
- `.env` is gitignored; `.env.example` contains only placeholders.
- AG Grid and Bryntum license keys are never committed.

