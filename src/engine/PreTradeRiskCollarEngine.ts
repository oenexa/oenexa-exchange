import type { Order, OrderSide } from '../domain/types.js';

export interface PriceBandReference {
  lastTradedPrice: number;
  bestBid: number;
  bestAsk: number;
}

export interface PreTradeRiskResult {
  allowed: boolean;
  rejectReason?: string;
}

export class PreTradeRiskCollarEngine {
  private readonly DEFAULT_COLLAR_PERCENT = 0.15; // +- 15% Max Price Deviation from Mid
  private readonly MAX_ORDER_NOTIONAL_USD = 1000000; // $1M single order cap

  public evaluateOrder(
    order: {
      userId: string;
      pair: string;
      side: OrderSide;
      price: number;
      quantity: number;
    },
    reference: PriceBandReference,
    openOrdersByUser: Order[]
  ): PreTradeRiskResult {
    const notional = order.price * order.quantity;

    // 1. Single Order Notional Ceiling Check
    if (notional > this.MAX_ORDER_NOTIONAL_USD) {
      return {
        allowed: false,
        rejectReason: `Order notional ($${notional.toFixed(2)}) exceeds maximum limit ($${this.MAX_ORDER_NOTIONAL_USD})`,
      };
    }

    // 2. Self-Trade Prevention (STP - Cancel New / Reject Cross)
    const oppositeSide: OrderSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const restingOppositeUserOrders = openOrdersByUser.filter(
      (o) => o.userId === order.userId && o.pair === order.pair && o.side === oppositeSide && o.status === 'NEW'
    );

    for (const resting of restingOppositeUserOrders) {
      // Check for self-crossing price overlap
      if (order.side === 'BUY' && order.price >= resting.price) {
        return {
          allowed: false,
          rejectReason: `Self-Trade Prevention (STP): Buy price (${order.price}) crosses resting sell order (${resting.id} @ ${resting.price})`,
        };
      } else if (order.side === 'SELL' && order.price <= resting.price) {
        return {
          allowed: false,
          rejectReason: `Self-Trade Prevention (STP): Sell price (${order.price}) crosses resting buy order (${resting.id} @ ${resting.price})`,
        };
      }
    }

    // 3. Dynamic Volatility Price Collar (Banding)
    if (reference.lastTradedPrice > 0) {
      const lowerCollar = reference.lastTradedPrice * (1 - this.DEFAULT_COLLAR_PERCENT);
      const upperCollar = reference.lastTradedPrice * (1 + this.DEFAULT_COLLAR_PERCENT);

      if (order.price < lowerCollar || order.price > upperCollar) {
        return {
          allowed: false,
          rejectReason: `Price Collar Violation: Price ${order.price} is outside dynamic collar range [${lowerCollar.toFixed(2)} - ${upperCollar.toFixed(2)}]`,
        };
      }
    }

    return { allowed: true };
  }
}
