// src/server/routes/webhook.ts — POST /api/paypal/webhook
// Receives raw Buffer (set up in server/index.ts before express.json()).
// Verifies signature, dedupes by event ID, routes to handlers.

import { Router, Request, Response } from 'express';
import { verifyWebhookSignature, WEBHOOK_EVENTS } from '../../paypal/webhooks.js';

export const webhookRouter = Router();

// In-memory dedupe for dev; commit 3 replaces with Elasticsearch op_type=create
const seenEventIds = new Set<string>();

webhookRouter.post('/', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  // ── 1. Signature verification ────────────────────────────────────────────
  try {
    await verifyWebhookSignature(
      {
        'paypal-auth-algo': req.headers['paypal-auth-algo'] as string,
        'paypal-cert-url': req.headers['paypal-cert-url'] as string,
        'paypal-transmission-id': req.headers['paypal-transmission-id'] as string,
        'paypal-transmission-sig': req.headers['paypal-transmission-sig'] as string,
        'paypal-transmission-time': req.headers['paypal-transmission-time'] as string,
      },
      rawBody
    );
  } catch (err) {
    console.error('[webhook] Signature verification FAILED:', err);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  // ── 2. Parse event ───────────────────────────────────────────────────────
  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventId: string = event.id;
  const eventType: string = event.event_type;

  // ── 3. Dedupe by event ID ────────────────────────────────────────────────
  if (seenEventIds.has(eventId)) {
    console.log(`[webhook] Duplicate event ignored: ${eventId}`);
    return res.status(200).json({ received: true, duplicate: true });
  }
  seenEventIds.add(eventId);

  console.log(`[webhook] Received: ${eventType} (${eventId})`);

  // ── 4. Route to handler ──────────────────────────────────────────────────
  try {
    await routeEvent(eventType, event);
  } catch (err) {
    console.error(`[webhook] Handler error for ${eventType}:`, err);
    // Still return 200 so PayPal doesn't retry endlessly; log the error
  }

  res.status(200).json({ received: true });
});

async function routeEvent(eventType: string, event: any): Promise<void> {
  switch (eventType) {
    case WEBHOOK_EVENTS.CAPTURE_COMPLETED:
      await handleCaptureCompleted(event);
      break;
    case WEBHOOK_EVENTS.CAPTURE_REFUNDED:
      console.log('[webhook] CAPTURE_REFUNDED — handler wired in commit 7');
      break;
    case WEBHOOK_EVENTS.DISPUTE_CREATED:
      console.log('[webhook] DISPUTE_CREATED — handler wired in commit 10');
      break;
    case WEBHOOK_EVENTS.DISPUTE_RESOLVED:
      console.log('[webhook] DISPUTE_RESOLVED — handler wired in commit 10');
      break;
    case WEBHOOK_EVENTS.PAYOUT_ITEM_SUCCEEDED:
    case WEBHOOK_EVENTS.PAYOUT_ITEM_FAILED:
    case WEBHOOK_EVENTS.PAYOUT_ITEM_HELD:
    case WEBHOOK_EVENTS.PAYOUT_ITEM_UNCLAIMED:
    case WEBHOOK_EVENTS.PAYOUT_ITEM_RETURNED:
    case WEBHOOK_EVENTS.PAYOUT_ITEM_BLOCKED:
    case WEBHOOK_EVENTS.PAYOUT_BATCH_SUCCESS:
    case WEBHOOK_EVENTS.PAYOUT_BATCH_DENIED:
      console.log(`[webhook] ${eventType} — handler wired in commit 7`);
      break;
    default:
      console.log(`[webhook] Unhandled event type: ${eventType}`);
  }
}

async function handleCaptureCompleted(event: any): Promise<void> {
  const resource = event.resource;
  const captureId: string = resource.id;
  const captureStatus: string = resource.status;

  if (captureStatus !== 'COMPLETED') {
    console.log(`[webhook] Capture ${captureId} status is ${captureStatus} — not crediting`);
    return;
  }

  // Extract donation context from supplementary_data or custom_id
  const purchaseUnit = resource.supplementary_data?.related_ids?.order_id;
  const amountValue: string = resource.amount?.value;
  const currency: string = resource.amount?.currency_code;

  console.log(`[webhook] ✓ CAPTURE COMPLETED: captureId=${captureId} amount=${currency} ${amountValue}`);

  // Commit 3 wires this into the ledger to create the lot and credit the fund.
  // For now, log the event so the sandbox wiring is proven.
}

