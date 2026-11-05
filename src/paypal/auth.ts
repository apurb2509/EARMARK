// src/paypal/auth.ts — OAuth2 token manager with auto-refresh
// Sandbox tokens typically expire in 3–8 hours; we refresh 5 min before expiry.

import 'dotenv/config';

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}

let cache: TokenCache | null = null;

const BASE = process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? '';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min early

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt - REFRESH_BUFFER_MS > now) {
    return cache.accessToken;
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal OAuth2 failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  console.log(`[paypal/auth] Token refreshed; expires in ${data.expires_in}s`);
  return cache.accessToken;
}

export function clearTokenCache() {
  cache = null;
}
