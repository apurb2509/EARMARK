// scripts/seed.ts — seed Elasticsearch with funds, vendors and test data
// Run with: npm run seed
// Requires ELASTIC_URL and ELASTIC_API_KEY in .env

import 'dotenv/config';
import { Client } from '@elastic/elasticsearch';

const client = new Client({
  node: process.env.ELASTIC_URL ?? 'http://localhost:9200',
  auth: process.env.ELASTIC_API_KEY
    ? { apiKey: process.env.ELASTIC_API_KEY }
    : undefined,
});

const VENDORS = [
  {
    vendorId: 'vendor-annapurna',
    name: 'Annapurna Food Supplies',
    email: 'annapurna@sandbox.paypal.com', // replace with real sandbox payee
    categories: ['food_staples', 'cooked_meals'],
    status: 'ACTIVE',
    description: 'Trusted local food supplier with verified pricing',
  },
  {
    vendorId: 'vendor-wholesale',
    name: 'City Wholesale Mart',
    email: 'wholesale@sandbox.paypal.com',
    categories: ['food_staples', 'medical_supplies', 'water_sanitation'],
    status: 'ACTIVE',
    description: 'Bulk wholesale supplier — good market rates',
  },
  {
    vendorId: 'vendor-newunverified',
    name: 'Quick Supply Co.',
    email: 'quicksupply@sandbox.paypal.com',
    categories: ['food_staples', 'shelter'],
    status: 'UNVERIFIED',
    description: 'New vendor, not yet verified by treasurer',
  },
  {
    vendorId: 'vendor-overpriced',
    name: 'Premium Provisions Ltd',
    email: 'premium@sandbox.paypal.com',
    categories: ['food_staples', 'cooked_meals'],
    status: 'ACTIVE',
    description: 'High-quality premium supplier — typically 35% above market',
  },
  {
    vendorId: 'vendor-blocked',
    name: 'Blocked Vendor',
    email: 'blocked@sandbox.paypal.com',
    categories: [],
    status: 'BLOCKED',
    description: 'Blocked — do not use',
  },
  {
    vendorId: 'vendor-medplus',
    name: 'MedPlus Supplies',
    email: 'medplus@sandbox.paypal.com',
    categories: ['medical_supplies', 'emergency_relief'],
    status: 'ACTIVE',
    description: 'Medical and emergency supplies specialist',
  },
];

async function seed() {
  console.log('[seed] Connecting to Elasticsearch…');
  const info = await client.info();
  console.log(`[seed] Connected: ${info.name} v${info.version.number}`);

  // Create vendors index if not exists
  const vendorExists = await client.indices.exists({ index: 'vendors' });
  if (!vendorExists) {
    await client.indices.create({
      index: 'vendors',
      mappings: {
        properties: {
          vendorId: { type: 'keyword' },
          name: { type: 'text' },
          email: { type: 'keyword' },
          categories: { type: 'keyword' },
          status: { type: 'keyword' },
          description: { type: 'text' },
        },
      },
    });
    console.log('[seed] Created vendors index');
  }

  // Index vendors
  for (const v of VENDORS) {
    await client.index({ index: 'vendors', id: v.vendorId, document: v });
    console.log(`[seed] Vendor: ${v.vendorId}`);
  }

  // Create funds projection index if not exists
  const fundsExists = await client.indices.exists({ index: 'funds' });
  if (!fundsExists) {
    await client.indices.create({
      index: 'funds',
      mappings: {
        properties: {
          fundId: { type: 'keyword' },
          raisedCents: { type: 'long' },
          refundedCents: { type: 'long' },
          atRiskCents: { type: 'long' },
          committedCents: { type: 'long' },
          settledCents: { type: 'long' },
          availableCents: { type: 'long' },
          seqNo: { type: 'long' },
          frozenAt: { type: 'date' },
          frozenReason: { type: 'keyword' },
        },
      },
    });
    console.log('[seed] Created funds index');
  }

  // Seed initial fund projections
  const FUNDS = ['SCHOOL-MEALS', 'FLOOD-MEDICAL', 'GENERAL'];
  for (const fundId of FUNDS) {
    await client.index({
      index: 'funds',
      id: fundId,
      document: {
        fundId,
        raisedCents: 0,
        refundedCents: 0,
        atRiskCents: 0,
        committedCents: 0,
        settledCents: 0,
        availableCents: 0,
        seqNo: 0,
      },
    });
    console.log(`[seed] Fund: ${fundId}`);
  }

  await client.indices.refresh({ index: ['vendors', 'funds'] });
  console.log('[seed] Done ✓');
}

seed().catch(e => { console.error(e); process.exit(1); });

