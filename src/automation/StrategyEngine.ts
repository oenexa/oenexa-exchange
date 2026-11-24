import crypto from 'node:crypto';
import type { Order, Trade, OrderSide } from '../domain/types.js';
import { OrderBook } from '../engine/OrderBook.js';
import { AutomatedRiskGuard, type ProposedOrder } from './AutomatedRiskGuard.js';

export type StrategyType = 'MARKET_MAKING' | 'TWAP' | 'MOMENTUM';
export type StrategyState = 'IDLE' | 'RUNNING' | 'HALTED' | 'COMPLETED';

export interface StrategyPortfolio {
  cashBalance: number;
  assetPosition: number;
  realizedPnl: number;
  totalVolume: number;
  tradesCount: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  pair: string;
  type: StrategyType;
  generateOrders: (currentPrice: number, portfolio: StrategyPortfolio) => ProposedOrder[];
}

export class StrategyEngine {
  private strategies = new Map<string, StrategyDefinition>();
  private states = new Map<string, StrategyState>();
  private portfolios = new Map<string, StrategyPortfolio>();
  private riskGuard: AutomatedRiskGuard;
  private orderBooks: Map<string, OrderBook>;

  constructor(riskGuard: AutomatedRiskGuard, orderBooks: Map<string, OrderBook>) {
    this.riskGuard = riskGuard;
    this.orderBooks = orderBooks;
  }

  public registerStrategy(strategy: StrategyDefinition, initialCash = 100_000): void {
    this.strategies.set(strategy.id, strategy);
    this.states.set(strategy.id, 'IDLE');
    this.portfolios.set(strategy.id, {
      cashBalance: initialCash,
      assetPosition: 0,
      realizedPnl: 0,
      totalVolume: 0,
      tradesCount: 0,
    });
  }

  public startStrategy(id: string): void {
    if (!this.strategies.has(id)) throw new Error(`Strategy ${id} not found`);
    this.states.set(id, 'RUNNING');
  }

  public stopStrategy(id: string): void {
    if (!this.strategies.has(id)) throw new Error(`Strategy ${id} not found`);
    this.states.set(id, 'HALTED');
  }

  public stopAll(): void {
    for (const id of this.strategies.keys()) {
      this.states.set(id, 'HALTED');
    }
  }

  public getStrategyState(id: string): StrategyState {
    return this.states.get(id) || 'IDLE';
  }

  public getPortfolio(id: string): StrategyPortfolio {
    const portfolio = this.portfolios.get(id);
    if (!portfolio) throw new Error(`Portfolio for ${id} not found`);
    return { ...portfolio };
  }

  public processMarketTick(
    pair: string,
    currentPrice: number
  ): { executedTrades: Trade[]; rejectedOrders: Array<{ order: ProposedOrder; reason: string }> } {
    // 1. Ingest price into risk guard (triggers circuit breaker if high volatility)
    this.riskGuard.recordMarketPrice(currentPrice);

    const executedTrades: Trade[] = [];
    const rejectedOrders: Array<{ order: ProposedOrder; reason: string }> = [];

    const orderBook = this.orderBooks.get(pair.toUpperCase());
    if (!orderBook) {
      throw new Error(`OrderBook for pair ${pair} does not exist`);
    }

    for (const [id, strategy] of this.strategies.entries()) {
      if (strategy.pair.toUpperCase() !== pair.toUpperCase()) continue;
      if (this.states.get(id) !== 'RUNNING') continue;

      const portfolio = this.portfolios.get(id)!;
      const proposedOrders = strategy.generateOrders(currentPrice, portfolio);

      for (const proposed of proposedOrders) {
        // Evaluate pre-trade automated risk rules
        const riskResult = this.riskGuard.evaluateOrder(proposed);
        if (!riskResult.allowed) {
          rejectedOrders.push({
            order: proposed,
            reason: riskResult.reason || 'Risk limit rejected',
          });
          continue;
        }

        // Risk check passed -> Execute order in orderbook
        const orderId = `strat-${strategy.id}-${crypto.randomUUID().slice(0, 8)}`;
        const order: Order = {
          id: orderId,
          userId: `algo-bot-${strategy.id}`,
          pair: strategy.pair.toUpperCase(),
          side: proposed.side,
          type: 'LIMIT',
          price: proposed.price,
          quantity: proposed.quantity,
          filledQuantity: 0,
          status: 'NEW',
          createdAt: new Date().toISOString(),
        };

        const { trades } = orderBook.submitOrder(order);
        if (trades.length > 0) {
          for (const trade of trades) {
            executedTrades.push(trade);
            this.handleTradeExecution(id, trade, proposed.side);
          }
        }
      }
    }

    return { executedTrades, rejectedOrders };
  }

  private handleTradeExecution(strategyId: string, trade: Trade, side: OrderSide): void {
    const portfolio = this.portfolios.get(strategyId);
    if (!portfolio) return;

    const notional = trade.price * trade.quantity;
    portfolio.totalVolume += notional;
    portfolio.tradesCount += 1;

    if (side === 'BUY') {
      portfolio.cashBalance -= notional;
      portfolio.assetPosition += trade.quantity;
      this.riskGuard.updateNetPosition(trade.pair, trade.quantity);
    } else {
      portfolio.cashBalance += notional;
      portfolio.assetPosition -= trade.quantity;
      this.riskGuard.updateNetPosition(trade.pair, -trade.quantity);
    }

    // Rough PnL calculation: if trade completes round-trip or sells
    if (side === 'SELL' && portfolio.assetPosition >= 0) {
      const pnl = notional - (trade.quantity * (portfolio.totalVolume / Math.max(1, portfolio.tradesCount)));
      portfolio.realizedPnl += pnl;
      this.riskGuard.recordRealizedPnl(pnl);
    }
  }

  /**
   * Factory: Standard Market Making Strategy
   */
  public static createMarketMaker(
    id: string,
    pair: string,
    spreadPercent: number,
    quoteQty: number
  ): StrategyDefinition {
    return {
      id,
      name: `MarketMaker-${pair}`,
      pair,
      type: 'MARKET_MAKING',
      generateOrders: (currentPrice: number) => {
        const halfSpread = (currentPrice * spreadPercent) / 200;
        const bidPrice = Number((currentPrice - halfSpread).toFixed(2));
        const askPrice = Number((currentPrice + halfSpread).toFixed(2));
        return [
          { symbol: pair, side: 'BUY', price: bidPrice, quantity: quoteQty, strategyId: id },
          { symbol: pair, side: 'SELL', price: askPrice, quantity: quoteQty, strategyId: id },
        ];
      },
    };
  }

  /**
   * Factory: Time-Weighted Average Price (TWAP) Slice Strategy
   */
  public static createTwap(
    id: string,
    pair: string,
    side: OrderSide,
    totalQty: number,
    totalSlices: number
  ): StrategyDefinition {
    let executedSlices = 0;
    const sliceQty = totalQty / totalSlices;

    return {
      id,
      name: `TWAP-${side}-${pair}`,
      pair,
      type: 'TWAP',
      generateOrders: (currentPrice: number) => {
        if (executedSlices >= totalSlices) {
          return [];
        }
        executedSlices += 1;
        return [
          {
            symbol: pair,
            side,
            price: currentPrice,
            quantity: sliceQty,
            strategyId: id,
          },
        ];
      },
    };
  }
}
