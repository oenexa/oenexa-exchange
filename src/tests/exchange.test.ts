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

  it('triggers Stop-Limit order when market trades at or through stopPrice', () => {
    const exchange = new ExchangeService();

    // 1. Submit resting sell at 2.80
    exchange.placeOrder({
      userId: 'usr_resting_seller',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.80,
      quantity: 100,
    });

    // 2. Place conditional Stop-Limit BUY: trigger when price reaches 2.50, limit price 2.80
    const { order: stopOrder } = exchange.placeOrder({
      userId: 'usr_breakout_buyer',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'STOP_LIMIT',
      price: 2.80,
      quantity: 50,
      stopPrice: 2.50,
      limitPrice: 2.80,
    });

    expect(stopOrder.status).toBe('PENDING_TRIGGER');

    // 3. Trade occurs at 2.40 (should NOT trigger)
    exchange.placeOrder({
      userId: 'usr_seller_1',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.40,
      quantity: 10,
    });
    exchange.placeOrder({
      userId: 'usr_buyer_1',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 10,
    });
    expect(stopOrder.status).toBe('PENDING_TRIGGER');

    // 4. Trade occurs at 2.50 (hits stopPrice -> triggers and matches against resting 2.80 ask)
    exchange.placeOrder({
      userId: 'usr_seller_2',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.50,
      quantity: 10,
    });
    exchange.placeOrder({
      userId: 'usr_buyer_2',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 10,
    });

    // The Stop-Limit order has been triggered and filled against resting 2.80 ask
    expect(stopOrder.status).toBe('FILLED');
    expect(stopOrder.filledQuantity).toBe(50);
  });

  it('ratchets Trailing-Stop high watermark and triggers market sell on reversal', () => {
    const exchange = new ExchangeService();

    // Seed resting buyers at various price levels
    exchange.placeOrder({
      userId: 'usr_buyer_low',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 2.40,
      quantity: 100,
    });

    // Place Trailing Stop SELL order with trailingDelta = 0.20
    const { order: trailingOrder } = exchange.placeOrder({
      userId: 'usr_profit_holder',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'TRAILING_STOP',
      price: 2.50,
      quantity: 40,
      trailingDelta: 0.20,
    });

    expect(trailingOrder.status).toBe('PENDING_TRIGGER');

    // Price pushes up: trade at 3.00 (high watermark becomes 3.00, stop is 2.80)
    exchange.placeOrder({
      userId: 'usr_resting_ask',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 3.00,
      quantity: 10,
    });
    exchange.placeOrder({
      userId: 'usr_market_buyer',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 10,
    });

    expect(trailingOrder.highWatermark).toBe(3.00);
    expect(trailingOrder.status).toBe('PENDING_TRIGGER');

    // Price pushes higher: trade at 3.20 (high watermark becomes 3.20, stop is 3.00)
    exchange.placeOrder({
      userId: 'usr_resting_ask_2',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 3.20,
      quantity: 10,
    });
    exchange.placeOrder({
      userId: 'usr_market_buyer_2',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 10,
    });
    expect(trailingOrder.highWatermark).toBe(3.20);

    // Price reverses down: trade at 2.95 (<= 3.20 - 0.20 = 3.00 -> triggers Trailing Stop!)
    exchange.placeOrder({
      userId: 'usr_resting_ask_3',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.95,
      quantity: 10,
    });
    exchange.placeOrder({
      userId: 'usr_market_buyer_3',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'MARKET',
      price: 0,
      quantity: 10,
    });

    // Trailing stop executed against resting 2.40 liquidity
    expect(trailingOrder.status).toBe('FILLED');
    expect(trailingOrder.filledQuantity).toBe(40);
  });

  it('enforces institutional pre-trade risk controls and rejections', () => {
    const exchange = new ExchangeService({
      maxOrderQuantity: 5000,
      minNotionalValue: 10.0,
      priceBandPercentage: 0.15, // 15% collar
    });

    // 1. Fat-finger quantity rejection
    expect(() => {
      exchange.placeOrder({
        userId: 'usr_fat_finger',
        pair: 'ONXC/USDT',
        side: 'BUY',
        type: 'LIMIT',
        price: 2.50,
        quantity: 10000,
      });
    }).toThrow('Pre-trade risk violation: Order quantity 10000 exceeds maximum limit of 5000');

    // 2. Minimum notional value rejection
    expect(() => {
      exchange.placeOrder({
        userId: 'usr_dust',
        pair: 'ONXC/USDT',
        side: 'BUY',
        type: 'LIMIT',
        price: 1.00,
        quantity: 2, // 2.00 USDT < 10.00 USDT minNotional
      });
    }).toThrow('Pre-trade risk violation: Order notional value (2.00) is below minimum of 10 USDT');

    // 3. Price band collar rejection
    // Establish a 2.00 bid / 2.10 ask book (midpoint = 2.05)
    exchange.placeOrder({
      userId: 'usr_b1',
      pair: 'ONXC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 2.00,
      quantity: 50,
    });
    exchange.placeOrder({
      userId: 'usr_a1',
      pair: 'ONXC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: 2.10,
      quantity: 50,
    });

    // Placing a bid at 3.00 is ~46% above mid price (max allowed 15%)
    expect(() => {
      exchange.placeOrder({
        userId: 'usr_collar_breaker',
        pair: 'ONXC/USDT',
        side: 'BUY',
        type: 'LIMIT',
        price: 3.00,
        quantity: 20,
      });
    }).toThrow('Pre-trade risk violation: Limit price 3 deviates by 46.3% from mid-market price 2.05');
  });
});
