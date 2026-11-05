// src/ledger/index.ts — barrel export
export { appendLedgerEntry, getLedgerHead, replayAndVerify, replayFundBalances, computeHash, canonicalize } from './append.js';
export { creditDonation, reserveFund, settleFund, holdAtRisk, releaseAtRisk, freezeFund, unfreezeFund, listFunds, getFundProjection, ensureFundProjection } from './funds.js';
export { createLot, getLot, getLotByDonationId, listLotsByFund, allocateLotsFIFO } from './lots.js';

