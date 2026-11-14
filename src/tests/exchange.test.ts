import { describe, it, expect } from 'vitest';
import { ExchangeService } from '../service/ExchangeService.js';
import { OrderBook } from '../engine/OrderBook.js';

describe('OENEXA Institutional Order Book Matching Engine', () => {
  it('places resting limit orders and generates accurate L2 depth', () => {
    const exchange = new ExchangeService();

    exchange.placeOrder({
      userId: 'usr_maker_1',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 2.50,
      quantity: 100,
    });

    exchange.placeOrder({
      userId: 'usr_maker_2',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 2.45,
      quantity: 200,
    });

    exchange.placeOrder({
      userId: 'usr_maker_3',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.60,
      quantity: 150,
    });

    const depth = exchange.getDepth('ONXC/USDT');
    expect(depth.bids).toHaveLength(2);
    expect(depth.bids[0].price).toBe(2.50);
    expect(depth.bids[0].quantity).toBe(100);
    expect(depth.asks).toHaveLength(1);
    expect(depth.asks[0].price).toBe(2.60);
    expect(depth.asks[0].quantity).toBe(150);
  });

  it('matches aggressive market order against resting limit liquidity', () => {
    const exchange = new ExchangeService();

    // Resting sell order at 2.50
    exchange.placeOrder({
      userId: 'usr_seller',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.50,
      quantity: 50,
    });

    // Aggressive market buy order for 50 ONXC
    const { order, trades } = exchange.placeOrder({
      userId: 'usr_buyer',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 50,
    });

    expect(order.status).toBe('FILLED');
    expect(trades).toHaveLength(1);
    expect(trades[0].price).toBe(2.50);
    expect(trades[0].quantity).toBe(50);
    expect(exchange.getDepth('ONXC/USDT').asks).toHaveLength(0);
    expect(exchange.getOutbox()).toHaveLength(1);
  });

  it('cancels resting limit orders cleanly from the book', () => {
    const book = new OrderBook('ONXC/USDT');
    const { remainingOrder } = book.submitOrder({
      id: 'ord_test_cancel',
      userId: 'usr_cancel',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 2.30,
      quantity: 20,
      filledQuantity: 0,
      status: 'NEW',
      createdAt: new Date().toISOString(),
    });

    expect(remainingOrder).toBeDefined();
    expect(book.getDepth().bids).toHaveLength(1);

    const cancelled = book.cancelOrder('ord_test_cancel');
    expect(cancelled).toBe(true);
    expect(book.getDepth().bids).toHaveLength(0);
  });
});
