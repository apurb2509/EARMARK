# EARMARK

**Donor intent, enforced by code, settled on PayPal.**

Donor-restricted money that an AI agent can spend quickly, but only inside the donor's stated intent — with proof the donor can verify.

---

## Problem

Small nonprofits and community relief groups raise restricted money from many small donors but spend it through slow, opaque, manual processes. Three things fail together:

1. **Intent violated** — Funds are commingled; restricted gifts get spent on the wrong thing.
2. **Spending is slow** — Volunteer treasurers approve everything by hand and bottleneck in emergencies.
3. **Donors cannot verify** — They get a thank-you email and nothing else.

Adding an AI agent speeds procurement but creates a **fourth failure**: a hallucination or prompt injection could spend restricted funds.

**EARMARK** closes all four loops in a single system.

---

## How It Works

```
Donor → PayPal JS SDK v6 → Restricted Fund Envelope
         ↓ (PAYMENT.CAPTURE.COMPLETED webhook)
        Lot credited to fund
         ↓
Volunteer enters need → Procurement Agent drafts bill of materials
         ↓
Policy Engine enforces mandate rules (deterministic, no AI)
         ↓
Treasurer approves edge cases (two-person rule for large amounts)
         ↓
Executor → PayPal Payouts API → Vendor paid
         ↓ (PAYMENT.PAYOUTS-ITEM.SUCCEEDED webhook)
Reconciler matches 3 records → Ledger SETTLED
         ↓
Donor Receipt: lot → payout → vendor → settlement + hash proof
```

---

## Stack

| Layer | Tool |
|-------|------|
| Payments | PayPal Orders v2, Payouts, JS SDK v6, Webhooks, Agent Toolkit |
| AI | Vercel AI SDK, structured output (Zod), temperature 0 for planning |
| Search | Elasticsearch (ledger, hybrid vendor search) |
| Console | AG Grid Enterprise + AG Studio |
| Market prices | Channel3 |
| Hosting | Render |
| Notifications | Zapier MCP (Tier B) |
| SDK / Docs | APIMatic (Tier B) |

---

## Setup

### Prerequisites
- Node 18+
- A PayPal sandbox business account with Payouts enabled
- Elasticsearch (Elastic Cloud trial or `docker-compose up`)

### Local (Docker)
```bash
cp .env.example .env
# Fill in your sandbox credentials
docker-compose up
npm run seed
```

### Local (bare)
```bash
cp .env.example .env
# Fill in .env
npm install
npm run seed   # requires Elasticsearch running
npm run dev
```

### Tests
```bash
npm test
```

---

## Sandbox Testing

See `docs/demo-script.md` for the full demo walkthrough.

**Sandbox accounts needed:**
- 1 Business account (org treasurer — receives donations, sends payouts)
- 2–4 Personal/Business accounts as vendors
- 2 Personal accounts as donors

**Sandbox credentials** (provided in Devpost testing section):  
`[Added before submission]`

---

## Repo Layout

```
src/
  server/      Express API server + routes
  agents/      AI agent stubs (stage proposals only, no credentials)
  policy/      Deterministic policy engine (pure functions)
  ledger/      Event-sourced ledger with hash chain
  executor/    PayPal Payouts + write-ahead log (holds credentials)
  reconcile/   Three-way reconciler
  sentinel/    Anomaly detection (deterministic)
  paypal/      OAuth2, Orders, Payouts, Webhooks clients
  elastic/     Elasticsearch client + index setup
  web/         React components (donate page, console)
mandates/      Mandate YAML files
tests/         Vitest table-driven test suite
docs/          Architecture, security, demo script
scripts/       Seed + chain verify utilities
postman/       Postman collection (Tier B)
openapi.yaml   OpenAPI spec (Tier B)
```

---

## Security

See `docs/security.md` for the full threat model and honest limitations.

---

## AI Disclosure

Models used: `[provider and model — added before submission]`  
Coding assistants: Antigravity (Google DeepMind)

---

## License

MIT © 2026 EARMARK Contributors
