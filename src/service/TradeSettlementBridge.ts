import crypto from 'node:crypto';
import type { Trade } from '../domain/types.js';

export interface LedgerPosting {
  accountCode: string;
  userId?: string;
  asset: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
}

export interface TradeSettlementJournal {
  journalId: string;
  tradeId: string;
  pair: string;
  postings: LedgerPosting[];
  timestamp: string;
}

export class TradeSettlementBridge {
  private takerFeeBps = 10; // 0.10% (10 bps)
  private makerFeeBps = 5; // 0.05% (5 bps)

  public constructDoubleEntryJournal(trade: Trade): TradeSettlementJournal {
    const [baseAsset, quoteAsset] = trade.pair.split('/');
    const notionalQuote = trade.price * trade.quantity;

    // Buyer acquires Base Asset, pays Quote Asset
    // Seller delivers Base Asset, receives Quote Asset
    const takerFeeQuote = (notionalQuote * this.takerFeeBps) / 10000;
    const makerFeeQuote = (notionalQuote * this.makerFeeBps) / 10000;

    const postings: LedgerPosting[] = [];

    // --- 1. Base Asset Settlement (Symmetric Exchange) ---
    // Seller: Debit 2101 (Client liability decreases: seller gave base)
    // Buyer: Credit 2101 (Client liability increases: buyer received base)
    postings.push({
      accountCode: '2101', // Client Spot Trading Balance
      userId: trade.makerUserId, // Assuming maker sold base
      asset: baseAsset,
      direction: 'DEBIT',
      amount: trade.quantity.toFixed(8),
    });
    postings.push({
      accountCode: '2101',
      userId: trade.takerUserId,
      asset: baseAsset,
      direction: 'CREDIT',
      amount: trade.quantity.toFixed(8),
    });

    // --- 2. Quote Asset Settlement (Symmetric Exchange) ---
    // Buyer pays quote: Debit 2101
    // Seller receives net quote: Credit 2101
    // Exchange receives fee revenue: Credit 4101
    const netSellerQuote = notionalQuote - makerFeeQuote;
    const totalDebitedFromBuyer = notionalQuote + takerFeeQuote;
    const totalFeesCollected = takerFeeQuote + makerFeeQuote;

    postings.push({
      accountCode: '2101',
      userId: trade.takerUserId,
      asset: quoteAsset,
      direction: 'DEBIT',
      amount: totalDebitedFromBuyer.toFixed(8),
    });
    postings.push({
      accountCode: '2101',
      userId: trade.makerUserId,
      asset: quoteAsset,
      direction: 'CREDIT',
      amount: netSellerQuote.toFixed(8),
    });
    postings.push({
      accountCode: '4101', // Spot Taker & Maker Fee Revenue
      asset: quoteAsset,
      direction: 'CREDIT',
      amount: totalFeesCollected.toFixed(8),
    });

    // Invariant Verification: Debits == Credits per asset
    this.verifyInvariants(baseAsset, postings);
    this.verifyInvariants(quoteAsset, postings);

    return {
      journalId: `jrnl_trade_${trade.id}_${crypto.randomBytes(4).toString('hex')}`,
      tradeId: trade.id,
      pair: trade.pair,
      postings,
      timestamp: new Date().toISOString(),
    };
  }

  private verifyInvariants(asset: string, postings: LedgerPosting[]): void {
    const assetPostings = postings.filter((p) => p.asset === asset);
    const debits = assetPostings
      .filter((p) => p.direction === 'DEBIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const credits = assetPostings
      .filter((p) => p.direction === 'CREDIT')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    if (Math.abs(debits - credits) > 0.0000001) {
      throw new Error(
        `CRITICAL ACCOUNTING ERROR: Trade double-entry mismatch for ${asset}. Debits=${debits}, Credits=${credits}`
      );
    }
  }
}
