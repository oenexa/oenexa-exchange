import crypto from 'node:crypto';
import type {
  Order,
  Trade,
  OrderBookSnapshot,
  OrderBookLevel,
  OrderSide,
} from '../domain/types.js';

export class OrderBook {
  public readonly pair: string;
  private bids: Order[] = []; // sorted descending by price, then ascending by time
  private asks: Order[] = []; // sorted ascending by price, then ascending by time
  private orderIndex = new Map<string, Order>();

  constructor(pair: string) {
    this.pair = pair.toUpperCase();
  }

  /**
   * Submits an incoming order to the book and matches against resting liquidity
   */
  public submitOrder(order: Order): { trades: Trade[]; remainingOrder?: Order } {
    this.orderIndex.set(order.id, order);
    const trades: Trade[] = [];

    if (order.side === 'BUY') {
      this.matchBuyOrder(order, trades);
    } else {
      this.matchSellOrder(order, trades);
    }

    let remainingOrder: Order | undefined;
    if (order.status !== 'FILLED') {
      if (order.type === 'LIMIT') {
        this.addRestingOrder(order);
        remainingOrder = order;
      } else {
        // Unfilled market orders cancel immediately
        order.status = 'CANCELLED';
        this.orderIndex.delete(order.id);
      }
    } else {
      this.orderIndex.delete(order.id);
    }

    return { trades, remainingOrder };
  }

  private matchBuyOrder(taker: Order, trades: Trade[]): void {
    while (this.asks.length > 0 && taker.filledQuantity < taker.quantity) {
      const maker = this.asks[0];
      if (taker.type === 'LIMIT' && maker.price > taker.price) {
        break; // Resting price too high for limit buy
      }

      const matchQty = Math.min(
        taker.quantity - taker.filledQuantity,
        maker.quantity - maker.filledQuantity
      );

      taker.filledQuantity += matchQty;
      maker.filledQuantity += matchQty;

      trades.push({
        id: `trd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        pair: this.pair,
        makerOrderId: maker.id,
        takerOrderId: taker.id,
        price: maker.price,
        quantity: matchQty,
        takerSide: 'BUY',
        timestamp: new Date().toISOString(),
      });

      if (maker.filledQuantity >= maker.quantity) {
        maker.status = 'FILLED';
        this.asks.shift();
        this.orderIndex.delete(maker.id);
      } else {
        maker.status = 'PARTIALLY_FILLED';
      }
    }

    if (taker.filledQuantity >= taker.quantity) {
      taker.status = 'FILLED';
    } else if (taker.filledQuantity > 0) {
      taker.status = 'PARTIALLY_FILLED';
    }
  }

  private matchSellOrder(taker: Order, trades: Trade[]): void {
    while (this.bids.length > 0 && taker.filledQuantity < taker.quantity) {
      const maker = this.bids[0];
      if (taker.type === 'LIMIT' && maker.price < taker.price) {
        break; // Resting bid price too low for limit sell
      }

      const matchQty = Math.min(
        taker.quantity - taker.filledQuantity,
        maker.quantity - maker.filledQuantity
      );

      taker.filledQuantity += matchQty;
      maker.filledQuantity += matchQty;

      trades.push({
        id: `trd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        pair: this.pair,
        makerOrderId: maker.id,
        takerOrderId: taker.id,
        price: maker.price,
        quantity: matchQty,
        takerSide: 'SELL',
        timestamp: new Date().toISOString(),
      });

      if (maker.filledQuantity >= maker.quantity) {
        maker.status = 'FILLED';
        this.bids.shift();
        this.orderIndex.delete(maker.id);
      } else {
        maker.status = 'PARTIALLY_FILLED';
      }
    }

    if (taker.filledQuantity >= taker.quantity) {
      taker.status = 'FILLED';
    } else if (taker.filledQuantity > 0) {
      taker.status = 'PARTIALLY_FILLED';
    }
  }

  private addRestingOrder(order: Order): void {
    if (order.side === 'BUY') {
      this.bids.push(order);
      this.bids.sort((a, b) => {
        if (b.price !== a.price) return b.price - a.price; // highest price first
        return a.createdAt.localeCompare(b.createdAt); // FIFO
      });
    } else {
      this.asks.push(order);
      this.asks.sort((a, b) => {
        if (a.price !== b.price) return a.price - b.price; // lowest price first
        return a.createdAt.localeCompare(b.createdAt); // FIFO
      });
    }
  }

  /**
   * Cancels a resting limit order from the book
   */
  public cancelOrder(orderId: string): boolean {
    const order = this.orderIndex.get(orderId);
    if (!order) return false;

    order.status = 'CANCELLED';
    this.orderIndex.delete(orderId);

    if (order.side === 'BUY') {
      this.bids = this.bids.filter((o) => o.id !== orderId);
    } else {
      this.asks = this.asks.filter((o) => o.id !== orderId);
    }

    return true;
  }

  /**
   * Aggregates L2 order book depth
   */
  public getDepth(limit: number = 20): OrderBookSnapshot {
    const aggregate = (orders: Order[]): OrderBookLevel[] => {
      const map = new Map<number, { quantity: number; count: number }>();
      for (const ord of orders) {
        const remaining = ord.quantity - ord.filledQuantity;
        const entry = map.get(ord.price) || { quantity: 0, count: 0 };
        entry.quantity += remaining;
        entry.count += 1;
        map.set(ord.price, entry);
      }
      return Array.from(map.entries())
        .map(([price, val]) => ({
          price,
          quantity: val.quantity,
          orderCount: val.count,
        }))
        .slice(0, limit);
    };

    return {
      pair: this.pair,
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      timestamp: new Date().toISOString(),
    };
  }
}
