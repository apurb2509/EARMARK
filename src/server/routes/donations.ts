// src/server/routes/donations.ts — POST /api/donations/order and /:orderId/capture

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createOrder, captureOrder } from '../../paypal/orders.js';

export const donationsRouter = Router();

const CreateOrderSchema = z.object({
  fundId: z.string().min(1),
  amountUsd: z.string().regex(/^\d+\.\d{2}$/),
  donorEmail: z.string().email().optional(),
  donorNote: z.string().max(500).optional(),
  mandateVersion: z.number().int().default(1),
});

/**
 * POST /api/donations/order
 * Creates a PayPal Orders v2 order. Browser approves via JS SDK v6.
 * Returns orderId + our donationId. Does NOT credit funds.
 */
donationsRouter.post('/order', async (req, res) => {
  try {
    const body = CreateOrderSchema.parse(req.body);
    const donationId = uuidv4();

    const order = await createOrder({
      donationId,
      fundId: body.fundId,
      mandateVersion: body.mandateVersion,
      amountUsd: body.amountUsd,
      donorNote: body.donorNote,
    });

    console.log(
      `[donations] Order created: ${order.id} donationId=${donationId} fund=${body.fundId}`
    );

    res.json({ orderId: order.id, donationId, status: order.status });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('[donations/order]', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * POST /api/donations/:orderId/capture
 * Called by browser after PayPal JS SDK approval.
 * Captures the payment but does NOT credit the fund.
 * Funds are credited ONLY when PAYMENT.CAPTURE.COMPLETED webhook arrives with status COMPLETED.
 */
donationsRouter.post('/:orderId/capture', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { donationId } = z.object({ donationId: z.string().uuid() }).parse(req.body);

    const capture = await captureOrder(orderId, donationId);
    const captureStatus: string =
      capture?.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? 'UNKNOWN';

    console.log(`[donations] Capture ${captureStatus} orderId=${orderId} donationId=${donationId}`);

    res.json({
      orderId,
      donationId,
      captureStatus,
      message:
        captureStatus === 'COMPLETED'
          ? 'Captured. Funds credited upon webhook confirmation.'
          : `Capture is ${captureStatus}. Awaiting settlement.`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('[donations/capture]', err);
    res.status(500).json({ error: 'Capture failed' });
  }
});

