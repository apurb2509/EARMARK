// src/paypal/webhooks.ts — Webhook signature verification + event routing
// IMPORTANT: Sandbox simulator events cannot be verified via verify-webhook-signature.
// Only test with real sandbox transactions for signature verification.

import { createHmac } from 'crypto';
import { getAccessToken } from './auth.js';

const BASE = process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID ?? '';

export interface WebhookHeaders {
  'paypal-auth-algo': string;
  'paypal-cert-url': string;
  'paypal-transmission-id': string;
  'paypal-transmission-sig': string;
  'paypal-transmission-time': string;
}

/**
 * Verify a PayPal webhook event using the verify-webhook-signature endpoint.
 * Throws if verification fails. Must receive the raw body Buffer.
 */
export async function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: Buffer
): Promise<void> {
  const token = await getAccessToken();

  const payload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody.toString('utf8')),
  };

  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`verify-webhook-signature call failed: ${res.status} ${err}`);
  }

  const result = (await res.json()) as { verification_status: string };
  if (result.verification_status !== 'SUCCESS') {
    throw new Error(`Webhook verification failed: ${result.verification_status}`);
  }
}

// Well-known webhook event types we subscribe to
export const WEBHOOK_EVENTS = {
  CAPTURE_COMPLETED: 'PAYMENT.CAPTURE.COMPLETED',
  CAPTURE_REFUNDED: 'PAYMENT.CAPTURE.REFUNDED',
  DISPUTE_CREATED: 'CUSTOMER.DISPUTE.CREATED',
  DISPUTE_RESOLVED: 'CUSTOMER.DISPUTE.RESOLVED',
  PAYOUT_BATCH_SUCCESS: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
  PAYOUT_BATCH_DENIED: 'PAYMENT.PAYOUTSBATCH.DENIED',
  PAYOUT_ITEM_SUCCEEDED: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  PAYOUT_ITEM_FAILED: 'PAYMENT.PAYOUTS-ITEM.FAILED',
  PAYOUT_ITEM_HELD: 'PAYMENT.PAYOUTS-ITEM.HELD',
  PAYOUT_ITEM_UNCLAIMED: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  PAYOUT_ITEM_RETURNED: 'PAYMENT.PAYOUTS-ITEM.RETURNED',
  PAYOUT_ITEM_BLOCKED: 'PAYMENT.PAYOUTS-ITEM.BLOCKED',
} as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

