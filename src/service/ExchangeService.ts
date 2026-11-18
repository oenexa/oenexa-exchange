import crypto from 'node:crypto';
import { createCloudEvent, type CloudEvent } from '../domain/events.js';
import { OrderBook } from '../engine/OrderBook.js';
import type {
  Order,
  Trade,
  OrderSide,
  OrderType,
  OrderBookSnapshot,
  RiskConfig,
} from '../domain/types.js';

export class ExchangeService {
  private books = new Map<string, OrderBook>();
  private trades = new Map<string, Trade[]>(); // pair -> trades
  private outbox: CloudEvent<any>[] = [];
  private riskConfig: RiskConfig;

  constructor(customRisk?: Partial<RiskConfig>) {
    this.riskConfig = {
      maxOrderQuantity: 10000,
      minNotionalValue: 1.0,
      priceBandPercentage: 0.2, // 20% price band collar
      ...customRisk,
    };
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
    stopPrice?: number;
    limitPrice?: number;
    trailingDelta?: number;
  }): { order: Order; trades: Trade[] } {
    const key = params.pair.toUpperCase();
    const book = this.books.get(key);
    if (!book) {
      throw new Error(`Trading pair '${params.pair}' is not supported.`);
    }

    // Pre-trade risk validation
    this.validatePreTradeRisk(book, params);

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
      stopPrice: params.stopPrice,
      limitPrice: params.limitPrice,
      trailingDelta: params.trailingDelta,
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

  private validatePreTradeRisk(
    book: OrderBook,
    params: {
      type: OrderType;
      price: number;
      quantity: number;
      limitPrice?: number;
      stopPrice?: number;
    }
  ): void {
    if (params.quantity <= 0) {
      throw new Error('Order quantity must be strictly greater than 0.');
    }
    if (params.quantity > this.riskConfig.maxOrderQuantity) {
      throw new Error(
        `Pre-trade risk violation: Order quantity ${params.quantity} exceeds maximum limit of ${this.riskConfig.maxOrderQuantity}.`
      );
    }

    if (params.type === 'LIMIT' && params.price <= 0) {
      throw new Error('Limit order price must be strictly greater than 0.');
    }

    // Min notional value check
    const effectivePrice =
      params.type === 'LIMIT'
        ? params.price
        : params.limitPrice ?? params.stopPrice ?? params.price;

    if (effectivePrice > 0) {
      const notional = effectivePrice * params.quantity;
      if (notional < this.riskConfig.minNotionalValue) {
        throw new Error(
          `Pre-trade risk violation: Order notional value (${notional.toFixed(2)}) is below minimum of ${this.riskConfig.minNotionalValue} USDT.`
        );
      }
    }

    // Price band collar check against mid-market price
    if (params.type === 'LIMIT') {
      const depth = book.getDepth(1);
      if (depth.bids.length > 0 && depth.asks.length > 0) {
        const midPrice = (depth.bids[0].price + depth.asks[0].price) / 2;
        const deviation = Math.abs(params.price - midPrice) / midPrice;
        if (deviation > this.riskConfig.priceBandPercentage) {
          throw new Error(
            `Pre-trade risk violation: Limit price ${params.price} deviates by ${(deviation * 100).toFixed(1)}% from mid-market price ${midPrice.toFixed(2)} (max allowed: ${(this.riskConfig.priceBandPercentage * 100).toFixed(0)}%).`
          );
        }
      }
    }
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
