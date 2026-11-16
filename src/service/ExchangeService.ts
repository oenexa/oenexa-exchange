import crypto from 'node:crypto';
import { createCloudEvent, type CloudEvent } from '../domain/events.js';
import { OrderBook } from '../engine/OrderBook.js';
import type { Order, Trade, OrderSide, OrderType, OrderBookSnapshot } from '../domain/types.js';

export class ExchangeService {
  private books = new Map<string, OrderBook>();
  private trades = new Map<string, Trade[]>(); // pair -> trades
  private outbox: CloudEvent<any>[] = [];

  constructor() {
    this.registerPair('ONXC/USDT');
    this.registerPair('BTC/USDT');
    this.registerPair('ETH/USDT');
  }

  public registerPair(pair: string): void {
    const key = pair.toUpperCase();
    if (!this.books.has(key)) {
      this.books.set(key, new OrderBook(key));
      this.trades.set(key, []);
    }
  }

  public placeOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    type: OrderType;
    price: number;
    quantity: number;
  }): { order: Order; trades: Trade[] } {
    const key = params.pair.toUpperCase();
    const book = this.books.get(key);
    if (!book) {
      throw new Error(`Trading pair '${params.pair}' is not supported.`);
    }

    if (params.quantity <= 0) {
      throw new Error('Order quantity must be strictly greater than 0.');
    }
    if (params.type === 'LIMIT' && params.price <= 0) {
      throw new Error('Limit order price must be strictly greater than 0.');
    }

    const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const order: Order = {
      id: orderId,
      userId: params.userId,
      pair: key,
      side: params.side,
      type: params.type,
      price: params.price,
      quantity: params.quantity,
      filledQuantity: 0,
      status: 'NEW',
      createdAt: new Date().toISOString(),
    };

    const { trades } = book.submitOrder(order);

    if (trades.length > 0) {
      const pairTrades = this.trades.get(key) || [];
      pairTrades.push(...trades);
      this.trades.set(key, pairTrades);

      for (const trade of trades) {
        const event = createCloudEvent({
          type: 'com.oenexa.exchange.trade.executed.v1',
          source: 'https://api.oenexa.com/v1/exchange',
          data: trade,
          subject: trade.id,
        });
        this.outbox.push(event);
      }
    }

    return { order, trades };
  }

  public cancelOrder(pair: string, orderId: string): boolean {
    const book = this.books.get(pair.toUpperCase());
    if (!book) return false;
    return book.cancelOrder(orderId);
  }

  public getDepth(pair: string, limit?: number): OrderBookSnapshot {
    const book = this.books.get(pair.toUpperCase());
    if (!book) {
      throw new Error(`Trading pair '${pair}' is not supported.`);
    }
    return book.getDepth(limit);
  }

  public getRecentTrades(pair: string, limit: number = 50): Trade[] {
    const list = this.trades.get(pair.toUpperCase()) || [];
    return list.slice(-limit).reverse();
  }

  public getOutbox(): CloudEvent<any>[] {
    return [...this.outbox];
  }
}
