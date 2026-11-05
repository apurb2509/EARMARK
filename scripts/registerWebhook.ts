// scripts/registerWebhook.ts
// One-time script to register the webhook endpoint with PayPal sandbox.
// Run with: npx tsx scripts/registerWebhook.ts
// Make sure PUBLIC_BASE_URL and PAYPAL_* are set in .env

import 'dotenv/config';
import { getAccessToken } from '../src/paypal/auth.js';
import { WEBHOOK_EVENTS } from '../src/paypal/webhooks.js';

const BASE = process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com';
const PUBLIC_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';

async function registerWebhook() {
  const token = await getAccessToken();
  const url = `${PUBLIC_URL}/api/paypal/webhook`;

  const body = {
    url,
    event_types: Object.values(WEBHOOK_EVENTS).map(name => ({ name })),
  };

  console.log(`[registerWebhook] Registering ${url} for ${body.event_types.length} events…`);

  const res = await fetch(`${BASE}/v1/notifications/webhooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as any;
  if (!res.ok) {
    console.error('[registerWebhook] Failed:', data);
    process.exit(1);
  }

  console.log('[registerWebhook] ✓ Success!');
  console.log(`  Webhook ID: ${data.id}`);
  console.log(`  URL: ${data.url}`);
  console.log(`  Status: ${data.status}`);
  console.log('\n👉 Copy this Webhook ID into your .env as PAYPAL_WEBHOOK_ID');
}

registerWebhook().catch(e => { console.error(e); process.exit(1); });

