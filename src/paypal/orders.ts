// src/paypal/orders.ts — Orders v2 API (money IN: create + capture)
// custom_id = fundId:mandateVersion
// invoice_id = unique donationId (UUID)

import { getAccessToken } from './auth.js';

const BASE = process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com';

export interface CreateOrderParams {
  donationId: string;    // our UUID, used as invoice_id
  fundId: string;
  mandateVersion: number;
  amountUsd: string;     // decimal string e.g. "25.00"
  donorNote?: string;
}

export interface OrderResponse {
  id: string;
  status: string;
  links: Array<{ href: string; rel: string; method: string }>;
}

export async function createOrder(params: CreateOrderParams): Promise<OrderResponse> {
  const token = await getAccessToken();
  const { donationId, fundId, mandateVersion, amountUsd, donorNote } = params;

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        custom_id: `${fundId}:${mandateVersion}`,
        invoice_id: donationId,
        description: donorNote ?? `Donation to ${fundId}`,
        amount: {
          currency_code: 'USD',
          value: amountUsd,
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'}/donate/success`,
          cancel_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'}/donate/cancel`,
        },
      },
    },
  };

  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': donationId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`createOrder failed: ${res.status} ${err}`);
  }

  return res.json() as Promise<OrderResponse>;
}

export async function captureOrder(orderId: string, donationId: string): Promise<any> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `capture-${donationId}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`captureOrder failed: ${res.status} ${err}`);
  }

  return res.json();
}

export async function getOrder(orderId: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getOrder failed: ${res.status}`);
  return res.json();
}

