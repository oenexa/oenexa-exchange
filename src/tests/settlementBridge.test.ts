import { describe, it, expect } from 'vitest';
import { TradeSettlementBridge } from '../service/TradeSettlementBridge.js';
import type { Trade } from '../domain/types.js';

describe('TradeSettlementBridge Banking-Grade Double-Entry', () => {
  const bridge = new TradeSettlementBridge();

  it('constructs perfectly balanced double-entry ledger postings for executed trades', () => {
    const trade: Trade = {
      id: 'tr_sample_101',
      pair: 'BTC/USDT',
      price: 65000.0,
      quantity: 1.5,
      makerOrderId: 'ord_maker_1',
      takerOrderId: 'ord_taker_1',
      makerUserId: 'usr_seller',
      takerUserId: 'usr_buyer',
      takerSide: 'BUY',
      timestamp: new Date().toISOString(),
    };

    const journal = bridge.constructDoubleEntryJournal(trade);

    expect(journal.tradeId).toBe('tr_sample_101');
    expect(journal.postings.length).toBe(5);

    // Verify BTC (Base Asset) Invariant
    const btcPostings = journal.postings.filter((p) => p.asset === 'BTC');
    const btcDebits = btcPostings
      .filter((p) => p.direction === 'DEBIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const btcCredits = btcPostings
      .filter((p) => p.direction === 'CREDIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    expect(btcDebits).toBeCloseTo(1.5, 6);
    expect(btcCredits).toBeCloseTo(1.5, 6);

    // Verify USDT (Quote Asset) Invariant
    const usdtPostings = journal.postings.filter((p) => p.asset === 'USDT');
    const usdtDebits = usdtPostings
      .filter((p) => p.direction === 'DEBIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const usdtCredits = usdtPostings
      .filter((p) => p.direction === 'CREDIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    expect(usdtDebits).toBeCloseTo(usdtCredits, 6);
  });
});
