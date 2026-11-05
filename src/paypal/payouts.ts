// src/paypal/payouts.ts — Payouts v1 API (money OUT: vendor payments)
// One item per batch. sender_batch_id = PayPal-Request-Id = proposalId (idempotent).
// Never read payee from agent args — always from vendor registry.

import { getAccessToken } from './auth.js';

const BASE = process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com';

export interface PayoutParams {
  proposalId: string;       // used as sender_batch_id and PayPal-Request-Id
  payeeEmail: string;       // from vendor registry only
  amountUsd: string;        // decimal string e.g. "123.45"
  note: string;             // includes EARMARK anchor: EARMARK#<seq>:<hash>
  vendorName?: string;
}

export interface PayoutResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    sender_batch_header: { sender_batch_id: string };
  };
  links: Array<{ href: string; rel: string; method: string }>;
}

export async function createPayout(params: PayoutParams): Promise<PayoutResponse> {
  const token = await getAccessToken();
  const { proposalId, payeeEmail, amountUsd, note } = params;

  const body = {
    sender_batch_header: {
      sender_batch_id: proposalId,
      email_subject: 'EARMARK: Payment from restricted fund',
      email_message: note,
    },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver: payeeEmail,
        amount: { value: amountUsd, currency: 'USD' },
        note: note.slice(0, 4000), // PayPal note field limit
        sender_item_id: proposalId,
      },
    ],
  };

  const res = await fetch(`${BASE}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': proposalId, // idempotency key
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`createPayout failed: ${res.status} ${err}`);
  }

  return res.json() as Promise<PayoutResponse>;
}

export async function getPayoutBatch(batchId: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v1/payments/payouts/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getPayoutBatch failed: ${res.status}`);
  return res.json();
}

export async function getPayoutItem(itemId: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v1/payments/payouts-item/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getPayoutItem failed: ${res.status}`);
  return res.json();
}

