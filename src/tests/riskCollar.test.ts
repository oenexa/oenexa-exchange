import { describe, it, expect, beforeEach } from 'vitest';
import { PreTradeRiskCollarEngine, type PriceBandReference } from '../engine/PreTradeRiskCollarEngine.js';
import type { Order } from '../domain/types.js';

describe('PreTradeRiskCollarEngine Self-Trade Prevention & Volatility Collars', () => {
  let riskEngine: PreTradeRiskCollarEngine;
  let referencePrice: PriceBandReference;

  beforeEach(() => {
    riskEngine = new PreTradeRiskCollarEngine();
    referencePrice = {
      lastTradedPrice: 100.0,
      bestBid: 99.8,
      bestAsk: 100.2,
    };
  });

  it('approves orders within the dynamic volatility price collar', () => {
    const res = riskEngine.evaluateOrder(
      {
        userId: 'usr_trader_1',
        pair: 'ONXC/USDT',
        side: 'BUY',
        price: 105.0, // +5% within 15% collar
        quantity: 10,
      },
      referencePrice,
      []
    );

    expect(res.allowed).toBe(true);
  });

  it('rejects fat-finger orders that breach the volatility collar bounds', () => {
    const res = riskEngine.evaluateOrder(
      {
        userId: 'usr_trader_1',
        pair: 'ONXC/USDT',
        side: 'BUY',
        price: 120.0, // +20% (Exceeds 15% collar)
        quantity: 10,
      },
      referencePrice,
      []
    );

    expect(res.allowed).toBe(false);
    expect(res.rejectReason).toContain('Price Collar Violation');
  });

  it('prevents self-trading (STP) when a buy order crosses a resting sell order of the same user', () => {
    const restingSell: Order = {
      id: 'ord_resting_sell_1',
      userId: 'usr_market_maker',
      pair: 'BTC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 100.0,
      quantity: 1.0,
      filledQuantity: 0,
      status: 'NEW',
      createdAt: new Date().toISOString(),
    };

    const res = riskEngine.evaluateOrder(
      {
        userId: 'usr_market_maker',
        pair: 'BTC/USDT',
        side: 'BUY',
        price: 102.0, // Crosses self-sell price (100.0)
        quantity: 0.5,
      },
      referencePrice,
      [restingSell]
    );

    expect(res.allowed).toBe(false);
    expect(res.rejectReason).toContain('Self-Trade Prevention');
  });

  it('rejects single orders exceeding the $1,000,000 notional threshold', () => {
    const res = riskEngine.evaluateOrder(
      {
        userId: 'usr_whale',
        pair: 'BTC/USDT',
        side: 'BUY',
        price: 100.0,
        quantity: 20000, // 100 * 20000 = $2,000,000
      },
      referencePrice,
      []
    );

    expect(res.allowed).toBe(false);
    expect(res.rejectReason).toContain('exceeds maximum limit');
  });
});
