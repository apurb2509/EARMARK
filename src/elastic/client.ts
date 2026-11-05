// src/elastic/client.ts — Elasticsearch client singleton + index bootstrap

import { Client } from '@elastic/elasticsearch';

let _client: Client | null = null;

export function getElasticClient(): Client {
  if (_client) return _client;

  const node = process.env.ELASTIC_URL ?? 'http://localhost:9200';
  const apiKey = process.env.ELASTIC_API_KEY;

  _client = new Client({
    node,
    auth: apiKey ? { apiKey } : undefined,
  });

  return _client;
}

// ── Index definitions ─────────────────────────────────────────────────────────

export const INDICES = {
  LEDGER: 'ledger',
  FUNDS: 'funds',
  LOTS: 'lots',
  MANDATES: 'mandates',
  VENDORS: 'vendors',
  PROPOSALS: 'proposals',
  APPROVALS: 'approvals',
  EXECUTIONS: 'executions',
  WEBHOOKS: 'webhooks',   // _id = PayPal event ID → dedupe by op_type=create
  RECON: 'recon',
  INCIDENTS: 'incidents',
  NEEDS: 'needs',
} as const;

const INDEX_MAPPINGS: Record<string, object> = {
  [INDICES.LEDGER]: {
    properties: {
      seq:       { type: 'long' },
      eventType: { type: 'keyword' },
      payload:   { type: 'object', enabled: false }, // stored but not indexed
      prevHash:  { type: 'keyword' },
      hash:      { type: 'keyword' },
      createdAt: { type: 'date' },
    },
  },
  [INDICES.FUNDS]: {
    properties: {
      fundId:         { type: 'keyword' },
      raisedCents:    { type: 'long' },
      refundedCents:  { type: 'long' },
      atRiskCents:    { type: 'long' },
      committedCents: { type: 'long' },
      settledCents:   { type: 'long' },
      availableCents: { type: 'long' },
      seqNo:          { type: 'long' },
      frozenAt:       { type: 'date' },
      frozenReason:   { type: 'keyword' },
    },
  },
  [INDICES.LOTS]: {
    properties: {
      lotId:        { type: 'keyword' },
      donationId:   { type: 'keyword' },
      donorEmail:   { type: 'keyword' },
      fundId:       { type: 'keyword' },
      amountCents:  { type: 'long' },
      spentCents:   { type: 'long' },
      status:       { type: 'keyword' },
      mandateRef:   { type: 'keyword' },
      captureId:    { type: 'keyword' },
      createdAt:    { type: 'date' },
    },
  },
  [INDICES.WEBHOOKS]: {
    properties: {
      eventId:   { type: 'keyword' },
      eventType: { type: 'keyword' },
      payload:   { type: 'object', enabled: false },
      receivedAt:{ type: 'date' },
      handled:   { type: 'boolean' },
    },
  },
  [INDICES.PROPOSALS]: {
    properties: {
      proposalId:      { type: 'keyword' },
      fundId:          { type: 'keyword' },
      mandateVersion:  { type: 'integer' },
      requestedBy:     { type: 'keyword' },
      totalCents:      { type: 'long' },
      payeeVendorId:   { type: 'keyword' },
      payeeEmail:      { type: 'keyword' },
      proposalHash:    { type: 'keyword' },
      status:          { type: 'keyword' },
      createdAt:       { type: 'date' },
      expiresAt:       { type: 'date' },
    },
  },
  [INDICES.APPROVALS]: {
    properties: {
      approvalId:   { type: 'keyword' },
      proposalId:   { type: 'keyword' },
      proposalHash: { type: 'keyword' },
      approvedBy:   { type: 'keyword' },
      role:         { type: 'keyword' },
      approvedAt:   { type: 'date' },
      expiresAt:    { type: 'date' },
    },
  },
  [INDICES.INCIDENTS]: {
    properties: {
      incidentId:   { type: 'keyword' },
      severity:     { type: 'keyword' },
      type:         { type: 'keyword' },
      fundId:       { type: 'keyword' },
      proposalId:   { type: 'keyword' },
      description:  { type: 'text' },
      aiRationale:  { type: 'text' },
      resolvedAt:   { type: 'date' },
      createdAt:    { type: 'date' },
    },
  },
};

/**
 * Bootstrap: create all required indices if they don't exist.
 * Called once at server startup.
 */
export async function bootstrapIndices(): Promise<void> {
  const es = getElasticClient();

  for (const [name, mappings] of Object.entries(INDEX_MAPPINGS)) {
    const exists = await es.indices.exists({ index: name });
    if (!exists) {
      await es.indices.create({ index: name, mappings });
      console.log(`[elastic] Created index: ${name}`);
    }
  }

  // Create plain indices without special mappings
  const plainIndices = [
    INDICES.MANDATES, INDICES.VENDORS, INDICES.EXECUTIONS,
    INDICES.RECON, INDICES.NEEDS,
  ];
  for (const name of plainIndices) {
    const exists = await es.indices.exists({ index: name });
    if (!exists) {
      await es.indices.create({ index: name });
      console.log(`[elastic] Created index: ${name}`);
    }
  }

  console.log('[elastic] Index bootstrap complete');
}
