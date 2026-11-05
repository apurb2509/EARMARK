# EARMARK — Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Public Surfaces                           │
│  Donate Page  │  Donor Receipt (public)  │  Public Verifier     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                     Treasurer Console                             │
│  AG Grid Enterprise  │  AG Studio Assistant  │  Audit Vault      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                        API Server (Node/TS on Render)            │
│  /api/donations  │  /api/paypal/webhook  │  /api/agents/run      │
│  /api/policy  │  /api/proposals  │  /api/approvals               │
│  /api/funds  │  /api/ledger  │  /api/receipts  │  /healthz       │
└───┬───────────────────┬──────────────────────────┬──────────────┘
    │                   │                          │
┌───▼──────┐  ┌────────▼──────────┐  ┌───────────▼──────────────┐
│  Agents  │  │  Policy Engine    │  │   Executor               │
│ (staged  │  │  (pure functions) │  │   (holds credentials)    │
│  tools   │  │  no AI decides    │  │   PayPal Payouts REST    │
│  only)   │  │                   │  │   Write-ahead ledger     │
└───┬──────┘  └────────┬──────────┘  └───────────┬──────────────┘
    │                   │                          │
    └────────────────────┴──────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                     Elasticsearch Ledger                          │
│  event-sourced, hash-chained, compare-and-set projections        │
│  Indices: ledger, funds, lots, mandates, vendors, proposals,     │
│  approvals, executions, webhooks, recon, incidents               │
└──────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

| Module | Role | Has PayPal Credentials? |
|--------|------|------------------------|
| `src/agents` | Proposes via staged stub tools, calls AI SDK | No |
| `src/policy` | Pure evaluate() function; deterministic rules | No |
| `src/executor` | Calls Payouts API; write-ahead log | **Yes — only module** |
| `src/paypal` | OAuth2 token refresh, Orders, webhook verify | Yes |
| `src/ledger` | Append events, hash chain, replay | No |
| `src/reconcile` | Three-way match | No (reads ES) |
| `src/sentinel` | Anomaly detection | No |
| `src/elastic` | ES client | No |

## Money Flow

1. Donor pays via PayPal JS SDK v6 → Orders v2 create + capture
2. `PAYMENT.CAPTURE.COMPLETED` webhook (signature-verified) → lot created
3. Agent proposes → Policy Engine decides → stored as PROPOSAL + VERDICT
4. Humans approve (two-person rule if large) → APPROVAL with proposal-hash binding
5. Executor: write-ahead EXECUTION_INTENT → POST /v1/payments/payouts (idempotent)
6. `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` webhook → SETTLED + RECONCILED
7. Donor receipt: lot → payout → vendor, verifiable via hash chain

## Concurrency

- One Render instance → one process → per-fund async queue prevents race conditions
- Atomic reservation: compare-and-set on `funds` ES document (seqNo)
- Idempotent payouts: `sender_batch_id` = `PayPal-Request-Id` = `proposalId`

## Tamper Evidence

- Hash chain: `hash = SHA256(prevHash + seq + eventType + canonical(payload) + createdAt)`
- PayPal anchor: payout note = `EARMARK#<seq>:<12-hex head hash>`
- Daily Zapier witness: head hash emailed / written to sheet
- Public page shows current head hash
- Verify button: recompute chain + replay balances + cross-check PayPal batch
