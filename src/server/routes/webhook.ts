// src/server/routes/webhook.ts — POST /api/paypal/webhook
// Receives raw Buffer (set up in server/index.ts before express.json()).
// Verifies signature → dedupes by event ID (ES op_type=create) → routes → appends to ledger.

import { Router, Request, Response } from 'express';
import { verifyWebhookSignature, WEBHOOK_EVENTS } from '../../paypal/webhooks.js';
import { getElasticClient, INDICES } from '../../elastic/client.js';
import { appendLedgerEntry } from '../../ledger/append.js';
import { creditDonation } from '../../ledger/funds.js';
import { createLot, getLotByDonationId } from '../../ledger/lots.js';

export const webhookRouter = Router();

webhookRouter.post('/', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  // ── 1. Signature verification ────────────────────────────────────────────
  // Note: PayPal sandbox simulator events are unsigned — only use real sandbox transactions.
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

  // ── 3. Dedupe by event ID in Elasticsearch (op_type=create) ─────────────
  const es = getElasticClient();
  try {
    await es.index({
      index: INDICES.WEBHOOKS,
      id: eventId,
      op_type: 'create',
      document: {
        eventId,
        eventType,
        payload: event,
        receivedAt: new Date().toISOString(),
        handled: false,
      },
    });
  } catch (err: any) {
    if (err?.meta?.statusCode === 409) {
      console.log(`[webhook] Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    throw err;
  }

  // ── 4. Append raw webhook to ledger ─────────────────────────────────────
  await appendLedgerEntry('WEBHOOK', {
    eventId,
    eventType,
    summary: `PayPal event ${eventType}`,
  });

  console.log(`[webhook] Processing: ${eventType} (${eventId})`);

  // ── 5. Route to domain handler ───────────────────────────────────────────
  try {
    await routeEvent(eventType, event);

    // Mark handled
    await es.update({
      index: INDICES.WEBHOOKS,
      id: eventId,
      doc: { handled: true },
    });
  } catch (err) {
    console.error(`[webhook] Handler error for ${eventType}:`, err);
    // Return 200 to avoid PayPal retry storm; error is logged and can be replayed
  }

  res.status(200).json({ received: true });
});

// ── Event handlers ────────────────────────────────────────────────────────────

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
      console.log(`[webhook] ${eventType} — payout handler wired in commit 7`);
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
    console.log(`[webhook] Capture ${captureId} is ${captureStatus} — not crediting yet`);
    return;
  }

  // Extract donation context from the order's custom_id and invoice_id
  // PayPal returns supplementary_data.related_ids.order_id on captures
  const amountValue: string = resource.amount?.value ?? '0';
  const currency: string = resource.amount?.currency_code ?? 'USD';

  if (currency !== 'USD') {
    console.warn(`[webhook] Non-USD capture ignored: ${currency}`);
    return;
  }

  // Convert to integer cents (safe — no floating point)
  const amountCents = Math.round(parseFloat(amountValue) * 100);

  // The invoice_id on the purchase_unit is our donationId
  // The custom_id is "fundId:mandateVersion"
  // We retrieve these from the supplementary data or by querying the order
  // For now, extract from the resource's custom_id if present
  const customId: string = resource.custom_id ?? '';
  const invoiceId: string = resource.invoice_id ?? '';
  const [fundId, mandateVersionStr] = customId.split(':');
  const mandateVersion = parseInt(mandateVersionStr ?? '1', 10);
  const donationId = invoiceId;

  if (!fundId || !donationId) {
    console.warn(`[webhook] Cannot extract fundId/donationId from capture ${captureId}. custom_id="${customId}" invoice_id="${invoiceId}"`);
    return;
  }

  // Guard: don't double-credit if lot already exists
  const existing = await getLotByDonationId(donationId);
  if (existing) {
    console.log(`[webhook] Lot already exists for donation ${donationId}, skipping credit`);
    return;
  }

  // ── Append DONATION_CONFIRMED ledger entry ────────────────────────────────
  await appendLedgerEntry('DONATION_CONFIRMED', {
    fundId,
    donationId,
    captureId,
    amountCents,
    mandateVersion,
  });

  // ── Create the donation lot ───────────────────────────────────────────────
  const lot = await createLot({
    donationId,
    captureId,
    fundId,
    amountCents,
    mandateRef: `${fundId}:${mandateVersion}`,
  });

  // ── Append LOT_CREATED ledger entry ───────────────────────────────────────
  await appendLedgerEntry('LOT_CREATED', {
    lotId: lot.lotId,
    donationId,
    fundId,
    amountCents,
  });

  // ── Credit the fund projection ────────────────────────────────────────────
  await creditDonation(fundId, amountCents);

  console.log(`[webhook] ✓ Lot created: ${lot.lotId} | fund=${fundId} | +${amountCents}¢`);
}
