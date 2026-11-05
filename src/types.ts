// EARMARK – shared TypeScript types
// All money values are integer cents (USD) unless noted.

export type Cents = number; // integer, never float

// ─── Funds & Mandates ─────────────────────────────────────────────────────────

export type MandatePurpose =
  | 'food_staples' | 'cooked_meals' | 'water_sanitation'
  | 'medical_supplies' | 'shelter' | 'admin' | 'fundraising'
  | 'travel' | 'education' | 'emergency_relief' | string;

export interface Mandate {
  fund: string;
  version: number;
  donorIntent: string;
  purposes: MandatePurpose[];
  excluded: MandatePurpose[];
  vendors: { allow?: string[]; block?: string[] };
  caps: {
    perPayoutHardUsd: number;
    perPayoutHumanUsd: number;
    perDayUsd: number;
    adminMaxPct: number;
  };
  priceGuard: { maxOverMarketPct: number; requireBenchmark: boolean };
  tranches: { advanceMaxPct: number; balanceOn: string };
  window: { spendBy: string };   // ISO date
  approvals: {
    humanIf: string[];
    twoPersonOverUsd: number;
  };
  containment: { freezeIf: string[] };
  amendments: { loosen: string; tighten: string };
  rulesHash?: string;
  signature?: string;
  signedBy?: string;
  signedAt?: string;
}

// ─── Ledger Events ────────────────────────────────────────────────────────────

export type EventType =
  | 'MANDATE_SIGNED'
  | 'DONATION_CAPTURED'
  | 'DONATION_CONFIRMED'
  | 'LOT_CREATED'
  | 'PROPOSAL'
  | 'VERDICT'
  | 'APPROVAL'
  | 'EXECUTION_INTENT'
  | 'PAYPAL_CALL'
  | 'WEBHOOK'
  | 'SETTLED'
  | 'RECONCILED'
  | 'REFUND'
  | 'DISPUTE_HOLD'
  | 'INCIDENT'
  | 'FREEZE'
  | 'CONSENT'
  | 'REALLOCATED';

export interface LedgerEntry {
  seq: number;
  eventType: EventType;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: string; // ISO
}

// ─── Fund Projection ──────────────────────────────────────────────────────────

export interface FundProjection {
  fundId: string;
  raisedCents: Cents;
  refundedCents: Cents;
  atRiskCents: Cents;      // under dispute
  committedCents: Cents;   // reserved for approved proposals not yet settled
  settledCents: Cents;
  availableCents: Cents;   // = raised - refunded - atRisk - committed - settled
  seqNo: number;           // for compare-and-set
  version: number;         // ES version
  frozenAt?: string;
  frozenReason?: string;
}

// ─── Donation Lots ────────────────────────────────────────────────────────────

export interface DonationLot {
  lotId: string;
  donationId: string;      // matches Orders invoice_id
  donorEmail?: string;
  fundId: string;
  amountCents: Cents;
  spentCents: Cents;
  status: 'PENDING' | 'CONFIRMED' | 'FULLY_SPENT' | 'REFUNDED';
  mandateRef: string;      // fund:version
  captureId?: string;      // PayPal capture ID
  createdAt: string;
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export type LineCategory = MandatePurpose;

export interface ProposalLine {
  description: string;
  category: LineCategory;
  quantity: number;
  unitCents: Cents;
  totalCents: Cents;
  vendorId: string;
  marketPriceCents?: Cents; // from Channel3
}

export interface Proposal {
  proposalId: string;
  fundId: string;
  mandateVersion: number;
  requestedBy: string;      // role / user ID
  lines: ProposalLine[];
  totalCents: Cents;
  payeeVendorId: string;    // resolved server-side from registry
  payeeEmail: string;       // from vendor registry only
  proposalHash: string;     // SHA-256 of canonical proposal
  status: 'STAGED' | 'PENDING_APPROVAL' | 'APPROVED' | 'DENIED' | 'EXECUTED' | 'FAILED';
  createdAt: string;
  expiresAt: string;        // approvals bind until this time (24h)
}

// ─── Policy Verdicts ──────────────────────────────────────────────────────────

export type VerdictDecision = 'AUTO_APPROVE' | 'REQUIRE_HUMAN' | 'DENY' | 'FREEZE';

export interface PolicyVerdict {
  decision: VerdictDecision;
  firedRules: string[];     // e.g. ['H1', 'H3']
  reason: string;
  reservationCents?: Cents;
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export interface Approval {
  approvalId: string;
  proposalId: string;
  proposalHash: string;
  approvedBy: string;
  role: string;
  approvedAt: string;
  expiresAt: string;
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

export interface Vendor {
  vendorId: string;
  name: string;
  email: string;            // payee resolved server-side
  categories: LineCategory[];
  status: 'ACTIVE' | 'UNVERIFIED' | 'BLOCKED';
  priceHistory?: Array<{ date: string; itemId: string; priceCents: Cents }>;
  description?: string;    // for catalog search (untrusted for payee purposes)
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Incident {
  incidentId: string;
  severity: IncidentSeverity;
  type: string;
  fundId?: string;
  proposalId?: string;
  description: string;
  aiRationale?: string;
  resolvedAt?: string;
  createdAt: string;
}
