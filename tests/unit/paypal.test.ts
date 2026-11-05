// tests/unit/paypal.test.ts — unit tests for PayPal client modules

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock fetch globally ──────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('PayPal Auth — getAccessToken', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  it('fetches a token and caches it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok_abc', expires_in: 32400 }),
    });

    const { getAccessToken, clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();

    const token = await getAccessToken();
    expect(token).toBe('tok_abc');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('uses cached token without refetching', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok_cached', expires_in: 32400 }),
    });

    const { getAccessToken, clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();

    await getAccessToken();
    const second = await getAccessToken();
    expect(second).toBe('tok_cached');
    expect(mockFetch).toHaveBeenCalledOnce(); // still just one call
  });

  it('throws on failed OAuth2 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { getAccessToken, clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();

    await expect(getAccessToken()).rejects.toThrow('PayPal OAuth2 failed: 401');
  });
});

describe('PayPal Orders — createOrder', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  it('creates an order and returns id + status', async () => {
    // First call: token; second call: createOrder
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ORDER-123', status: 'CREATED', links: [] }),
      });

    const { clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();
    const { createOrder } = await import('../../src/paypal/orders.js');

    const result = await createOrder({
      donationId: 'donation-uuid',
      fundId: 'SCHOOL-MEALS',
      mandateVersion: 1,
      amountUsd: '25.00',
    });

    expect(result.id).toBe('ORDER-123');
    expect(result.status).toBe('CREATED');
  });

  it('throws when createOrder returns non-ok', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => 'Unprocessable',
      });

    const { clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();
    const { createOrder } = await import('../../src/paypal/orders.js');

    await expect(
      createOrder({ donationId: 'x', fundId: 'F', mandateVersion: 1, amountUsd: '10.00' })
    ).rejects.toThrow('createOrder failed: 422');
  });
});

describe('PayPal Payouts — createPayout', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  it('creates a payout with idempotency key', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          batch_header: {
            payout_batch_id: 'BATCH-456',
            batch_status: 'PENDING',
            sender_batch_header: { sender_batch_id: 'proposal-uuid' },
          },
          links: [],
        }),
      });

    const { clearTokenCache } = await import('../../src/paypal/auth.js');
    clearTokenCache();
    const { createPayout } = await import('../../src/paypal/payouts.js');

    const result = await createPayout({
      proposalId: 'proposal-uuid',
      payeeEmail: 'vendor@sandbox.paypal.com',
      amountUsd: '123.45',
      note: 'EARMARK#42:a3f9b2c1d4e5',
    });

    expect(result.batch_header.payout_batch_id).toBe('BATCH-456');

    // Verify PayPal-Request-Id was set (idempotency)
    const callArgs = mockFetch.mock.calls[1];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['PayPal-Request-Id']).toBe('proposal-uuid');
  });
});

describe('Webhook event types', () => {
  it('exports all required event type constants', async () => {
    const { WEBHOOK_EVENTS } = await import('../../src/paypal/webhooks.js');
    expect(WEBHOOK_EVENTS.CAPTURE_COMPLETED).toBe('PAYMENT.CAPTURE.COMPLETED');
    expect(WEBHOOK_EVENTS.PAYOUT_ITEM_SUCCEEDED).toBe('PAYMENT.PAYOUTS-ITEM.SUCCEEDED');
    expect(WEBHOOK_EVENTS.DISPUTE_CREATED).toBe('CUSTOMER.DISPUTE.CREATED');
  });
});

