import { describe, it, expect } from 'vitest';
import { AutomatedRiskGuard } from '../automation/AutomatedRiskGuard.js';
import { StrategyEngine } from '../automation/StrategyEngine.js';
import { BacktestingFramework, type MarketTick } from '../automation/BacktestingFramework.js';
import { OrderBook } from '../engine/OrderBook.js';
import type { Order } from '../domain/types.js';

describe('Trading Automation & Risk Controls (Phase 4)', () => {
  describe('AutomatedRiskGuard', () => {
    it('should allow valid orders within risk limits', () => {
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 10,
        maxGrossExposure: 50_000,
        maxDailyLoss: 5_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      const evalResult = riskGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 3000,
        quantity: 2,
        strategyId: 'strat-1',
      });
      expect(evalResult.allowed).toBe(true);
    });

    it('should reject orders exceeding net position limit', () => {
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 10,
        maxGrossExposure: 50_000,
        maxDailyLoss: 5_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      riskGuard.updateNetPosition('BTC/USDT', 9);
      const evalResult = riskGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 3000,
        quantity: 2, // 9 + 2 = 11 > 10
        strategyId: 'strat-1',
      });
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toMatch(/NET POSITION LIMIT BREACHED/i);
    });

    it('should reject orders exceeding gross exposure limit', () => {
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 10,
        maxGrossExposure: 50_000,
        maxDailyLoss: 5_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      const evalResult = riskGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 20_000,
        quantity: 3, // 60,000 > 50,000
        strategyId: 'strat-1',
      });
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toMatch(/GROSS EXPOSURE LIMIT BREACHED/i);
    });

    it('should reject orders when daily loss limit is breached', () => {
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 10,
        maxGrossExposure: 50_000,
        maxDailyLoss: 5_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      riskGuard.recordRealizedPnl(-5_500);
      const evalResult = riskGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 100,
        quantity: 1,
        strategyId: 'strat-1',
      });
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toMatch(/DAILY LOSS LIMIT BREACHED/i);
    });

    it('should trip volatility circuit breaker on sudden price movement', () => {
      const cbGuard = new AutomatedRiskGuard({
        maxNetPosition: 100,
        maxGrossExposure: 500_000,
        maxDailyLoss: 50_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      const now = Date.now();
      cbGuard.recordMarketPrice(100, now);
      cbGuard.recordMarketPrice(106, now + 1000); // 6% move > 5% threshold

      const evalResult = cbGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 106,
        quantity: 1,
        strategyId: 'strat-1',
      });
      expect(evalResult.allowed).toBe(false);
      expect(evalResult.circuitBreakerTripped).toBe(true);
      expect(evalResult.reason).toMatch(/CIRCUIT BREAKER TRIPPED/i);

      // Reset and verify recovery
      cbGuard.resetCircuitBreaker();
      const afterReset = cbGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 106,
        quantity: 1,
        strategyId: 'strat-1',
      });
      expect(afterReset.allowed).toBe(true);
    });

    it('should enforce emergency stop and block all orders immediately', () => {
      const esGuard = new AutomatedRiskGuard({
        maxNetPosition: 100,
        maxGrossExposure: 500_000,
        maxDailyLoss: 50_000,
        circuitBreakerThresholdPercent: 5.0,
        circuitBreakerWindowMs: 60_000,
      });

      esGuard.setEmergencyStop(true);
      expect(esGuard.isEmergencyStopActive()).toBe(true);

      const res = esGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 100,
        quantity: 1,
        strategyId: 'strat-1',
      });
      expect(res.allowed).toBe(false);
      expect(res.emergencyStopActive).toBe(true);
      expect(res.reason).toMatch(/Manual Emergency Stop is ACTIVE/i);

      esGuard.setEmergencyStop(false);
      const resAllowed = esGuard.evaluateOrder({
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: 100,
        quantity: 1,
        strategyId: 'strat-1',
      });
      expect(resAllowed.allowed).toBe(true);
    });
  });

  describe('StrategyEngine', () => {
    it('should execute market making orders against resting order book', () => {
      const orderBook = new OrderBook('ONXC/USDT');
      const orderBooks = new Map([['ONXC/USDT', orderBook]]);
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 500,
        maxGrossExposure: 100_000,
        maxDailyLoss: 10_000,
        circuitBreakerThresholdPercent: 10.0,
        circuitBreakerWindowMs: 60_000,
      });

      const engine = new StrategyEngine(riskGuard, orderBooks);
      const mmStrat = StrategyEngine.createMarketMaker('mm-1', 'ONXC/USDT', 2.0, 5);
      engine.registerStrategy(mmStrat, 50_000);
      expect(engine.getStrategyState('mm-1')).toBe('IDLE');

      // Add a resting sell order to allow our buy quote to execute
      const restingSell: Order = {
        id: 'seller-1',
        userId: 'maker-user',
        pair: 'ONXC/USDT',
        side: 'SELL',
        type: 'LIMIT',
        price: 99.0,
        quantity: 5,
        filledQuantity: 0,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      };
      orderBook.submitOrder(restingSell);

      engine.startStrategy('mm-1');
      expect(engine.getStrategyState('mm-1')).toBe('RUNNING');

      // Process tick at mid 100
      const result = engine.processMarketTick('ONXC/USDT', 100);
      expect(result.executedTrades.length).toBeGreaterThanOrEqual(1);
      expect(result.executedTrades[0].quantity).toBe(5);

      const portfolio = engine.getPortfolio('mm-1');
      expect(portfolio.tradesCount).toBe(1);
      expect(portfolio.assetPosition).toBe(5);

      // Stop strategy
      engine.stopStrategy('mm-1');
      expect(engine.getStrategyState('mm-1')).toBe('HALTED');
    });

    it('should slice orders correctly with TWAP strategy', () => {
      const orderBook = new OrderBook('ETH/USDT');
      const orderBooks = new Map([['ETH/USDT', orderBook]]);
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 100,
        maxGrossExposure: 100_000,
        maxDailyLoss: 10_000,
        circuitBreakerThresholdPercent: 10.0,
        circuitBreakerWindowMs: 60_000,
      });

      const engine = new StrategyEngine(riskGuard, orderBooks);
      const twap = StrategyEngine.createTwap('twap-1', 'ETH/USDT', 'BUY', 10, 2);
      engine.registerStrategy(twap);
      engine.startStrategy('twap-1');

      // Slice 1
      engine.processMarketTick('ETH/USDT', 2500);
      // Slice 2
      engine.processMarketTick('ETH/USDT', 2510);
      // Slice 3 (exceeded max slices, should generate 0 orders)
      const res3 = engine.processMarketTick('ETH/USDT', 2520);
      expect(res3.executedTrades.length).toBe(0);
      expect(res3.rejectedOrders.length).toBe(0);

      engine.stopAll();
      expect(engine.getStrategyState('twap-1')).toBe('HALTED');
    });

    it('should reject strategy orders when emergency stop is engaged', () => {
      const orderBook = new OrderBook('SOL/USDT');
      const orderBooks = new Map([['SOL/USDT', orderBook]]);
      const riskGuard = new AutomatedRiskGuard({
        maxNetPosition: 100,
        maxGrossExposure: 100_000,
        maxDailyLoss: 10_000,
        circuitBreakerThresholdPercent: 10.0,
        circuitBreakerWindowMs: 60_000,
      });

      const engine = new StrategyEngine(riskGuard, orderBooks);
      const twap = StrategyEngine.createTwap('twap-sol', 'SOL/USDT', 'BUY', 10, 2);
      engine.registerStrategy(twap);
      engine.startStrategy('twap-sol');

      riskGuard.setEmergencyStop(true);

      const tickResult = engine.processMarketTick('SOL/USDT', 150);
      expect(tickResult.executedTrades.length).toBe(0);
      expect(tickResult.rejectedOrders.length).toBe(1);
      expect(tickResult.rejectedOrders[0].reason).toMatch(/Emergency Stop/i);
    });
  });

  describe('BacktestingFramework', () => {
    it('should execute backtest and compute quantitative metrics accurately', () => {
      const backtester = new BacktestingFramework({
        initialCapital: 10_000,
        slippageBps: 0,
        feeBps: 0,
      });

      const ticks: MarketTick[] = [
        { timestamp: 1000, price: 100, volume: 1000 },
        { timestamp: 2000, price: 110, volume: 1200 },
        { timestamp: 3000, price: 120, volume: 1500 },
        { timestamp: 4000, price: 90, volume: 800 },
        { timestamp: 5000, price: 100, volume: 1100 },
      ];

      // Trend Following: Buy when price <= 100, sell when price >= 120
      const report = backtester.run(ticks, (tick, position) => {
        if (tick.price <= 100 && position === 0) {
          return { side: 'BUY', quantity: 10 };
        }
        if (tick.price >= 120 && position > 0) {
          return { side: 'SELL', quantity: position };
        }
        return null;
      });

      expect(report.initialCapital).toBe(10_000);
      expect(report.winningTrades).toBe(1);
      expect(report.losingTrades).toBe(0);
      expect(report.winRate).toBe(100);
      expect(report.netProfit).toBeGreaterThan(0);
      expect(report.finalCapital).toBeGreaterThan(report.initialCapital);
      expect(report.trades.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty tick dataset gracefully', () => {
      const backtester = new BacktestingFramework({ initialCapital: 50_000 });
      const report = backtester.run([], () => null);
      expect(report.totalTrades).toBe(0);
      expect(report.netProfit).toBe(0);
      expect(report.winRate).toBe(0);
    });
  });
});
