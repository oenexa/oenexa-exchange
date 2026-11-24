/**
 * AutomatedRiskGuard — Banking-Grade Pre-Trade & Algorithmic Risk Controls.
 * Enforces position limits, daily loss limits, gross exposure caps, volatility circuit breakers,
 * and emergency manual stop.
 */

export interface RiskGuardConfig {
  maxNetPosition: number;
  maxGrossExposure: number;
  maxDailyLoss: number;
  circuitBreakerThresholdPercent: number; // e.g. 5.0 for 5%
  circuitBreakerWindowMs: number; // e.g. 60_000 for 60s
}

export interface ProposedOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  strategyId: string;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  reason?: string;
  circuitBreakerTripped?: boolean;
  emergencyStopActive?: boolean;
}

export class AutomatedRiskGuard {
  private config: RiskGuardConfig;
  private emergencyStopActive = false;
  private circuitBreakerTripped = false;
  private circuitBreakerTripTime = 0;
  private netPositions = new Map<string, number>(); // symbol -> net position
  private dailyRealizedLoss = 0;
  private priceHistory: Array<{ timestamp: number; price: number }> = [];

  constructor(config: RiskGuardConfig) {
    this.config = config;
  }

  public setEmergencyStop(active: boolean): void {
    this.emergencyStopActive = active;
  }

  public isEmergencyStopActive(): boolean {
    return this.emergencyStopActive;
  }

  public recordMarketPrice(price: number, now = Date.now()): void {
    this.priceHistory.push({ timestamp: now, price });
    // Prune entries older than window
    const cutoff = now - this.config.circuitBreakerWindowMs;
    this.priceHistory = this.priceHistory.filter((p) => p.timestamp >= cutoff);

    if (this.priceHistory.length >= 2) {
      const oldest = this.priceHistory[0].price;
      const deviation = Math.abs((price - oldest) / oldest) * 100;
      if (deviation >= this.config.circuitBreakerThresholdPercent) {
        this.circuitBreakerTripped = true;
        this.circuitBreakerTripTime = now;
      }
    }
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.circuitBreakerTripTime = 0;
    this.priceHistory = [];
  }

  public recordRealizedPnl(pnl: number): void {
    if (pnl < 0) {
      this.dailyRealizedLoss += Math.abs(pnl);
    }
  }

  public updateNetPosition(symbol: string, deltaQty: number): void {
    const current = this.netPositions.get(symbol) || 0;
    this.netPositions.set(symbol, current + deltaQty);
  }

  public getNetPosition(symbol: string): number {
    return this.netPositions.get(symbol) || 0;
  }

  public evaluateOrder(order: ProposedOrder, now = Date.now()): RiskEvaluationResult {
    // 1. Manual Emergency Stop Check
    if (this.emergencyStopActive) {
      return {
        allowed: false,
        emergencyStopActive: true,
        reason: 'CRITICAL: Manual Emergency Stop is ACTIVE. All trading orders rejected.',
      };
    }

    // 2. Volatility Circuit Breaker Check
    if (this.circuitBreakerTripped) {
      return {
        allowed: false,
        circuitBreakerTripped: true,
        reason: `CIRCUIT BREAKER TRIPPED: Volatility exceeded ${this.config.circuitBreakerThresholdPercent}%. Trading halted.`,
      };
    }

    // 3. Daily Loss Limit Check
    if (this.dailyRealizedLoss >= this.config.maxDailyLoss) {
      return {
        allowed: false,
        reason: `DAILY LOSS LIMIT BREACHED: Cumulative loss ($${this.dailyRealizedLoss.toFixed(2)}) >= Cap ($${this.config.maxDailyLoss.toFixed(2)}).`,
      };
    }

    // 4. Net Position Limit Check
    const currentPos = this.getNetPosition(order.symbol);
    const orderDelta = order.side === 'BUY' ? order.quantity : -order.quantity;
    const projectedNet = currentPos + orderDelta;

    if (Math.abs(projectedNet) > this.config.maxNetPosition) {
      return {
        allowed: false,
        reason: `NET POSITION LIMIT BREACHED: Projected position (${projectedNet}) exceeds ceiling (${this.config.maxNetPosition}).`,
      };
    }

    // 5. Gross Exposure Limit Check
    const orderNominal = order.price * order.quantity;
    if (orderNominal > this.config.maxGrossExposure) {
      return {
        allowed: false,
        reason: `GROSS EXPOSURE LIMIT BREACHED: Order nominal ($${orderNominal.toFixed(2)}) exceeds single-order exposure limit ($${this.config.maxGrossExposure.toFixed(2)}).`,
      };
    }

    return { allowed: true };
  }
}
