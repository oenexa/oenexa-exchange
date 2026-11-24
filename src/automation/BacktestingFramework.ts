/**
 * BacktestingFramework — Quantitative Simulation and Performance Engine.
 * Simulates algorithmic strategies across tick data and computes institutional metrics:
 * Total Return, Win Rate, Profit Factor, Max Drawdown (MDD), and Sharpe Ratio.
 */

export interface MarketTick {
  timestamp: number;
  price: number;
  volume: number;
}

export interface BacktestConfig {
  initialCapital: number;
  slippageBps?: number; // Slippage in basis points (1 bps = 0.01%)
  feeBps?: number; // Fee in basis points (e.g. 10 bps = 0.1%)
}

export interface BacktestTrade {
  timestamp: number;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
  pnl: number;
}

export interface BacktestReport {
  initialCapital: number;
  finalCapital: number;
  netProfit: number;
  returnPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // percentage, e.g. 66.67
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
}

export class BacktestingFramework {
  private config: Required<BacktestConfig>;

  constructor(config: BacktestConfig) {
    this.config = {
      initialCapital: config.initialCapital,
      slippageBps: config.slippageBps ?? 5,
      feeBps: config.feeBps ?? 10,
    };
  }

  public run(
    ticks: MarketTick[],
    signalGenerator: (
      tick: MarketTick,
      position: number,
      cash: number
    ) => { side: 'BUY' | 'SELL'; quantity: number } | null
  ): BacktestReport {
    if (ticks.length === 0) {
      return this.generateEmptyReport();
    }

    let cash = this.config.initialCapital;
    let position = 0;
    let avgCost = 0;
    let peakEquity = this.config.initialCapital;
    let maxDrawdownUsd = 0;
    let maxDrawdownPercent = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: number[] = [];
    let grossProfits = 0;
    let grossLosses = 0;

    for (const tick of ticks) {
      const signal = signalGenerator(tick, position, cash);

      if (signal && signal.quantity > 0) {
        // Apply slippage
        const slippageMultiplier =
          signal.side === 'BUY'
            ? 1 + this.config.slippageBps / 10_000
            : 1 - this.config.slippageBps / 10_000;
        const execPrice = Number((tick.price * slippageMultiplier).toFixed(4));
        const notional = execPrice * signal.quantity;
        const fee = Number(((notional * this.config.feeBps) / 10_000).toFixed(4));

        if (signal.side === 'BUY') {
          const totalCost = notional + fee;
          if (cash >= totalCost) {
            cash -= totalCost;
            avgCost = (position * avgCost + notional) / (position + signal.quantity);
            position += signal.quantity;
            trades.push({
              timestamp: tick.timestamp,
              side: 'BUY',
              price: execPrice,
              quantity: signal.quantity,
              fee,
              pnl: 0,
            });
          }
        } else if (signal.side === 'SELL') {
          const sellQty = Math.min(position, signal.quantity);
          if (sellQty > 0) {
            const proceeds = sellQty * execPrice - fee;
            cash += proceeds;
            const pnl = (execPrice - avgCost) * sellQty - fee;
            position -= sellQty;
            if (position === 0) avgCost = 0;

            if (pnl > 0) {
              grossProfits += pnl;
            } else {
              grossLosses += Math.abs(pnl);
            }

            trades.push({
              timestamp: tick.timestamp,
              side: 'SELL',
              price: execPrice,
              quantity: sellQty,
              fee,
              pnl: Number(pnl.toFixed(4)),
            });
          }
        }
      }

      // Mark to Market Equity
      const currentEquity = cash + position * tick.price;
      equityCurve.push(currentEquity);

      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const ddUsd = peakEquity - currentEquity;
      const ddPct = peakEquity > 0 ? (ddUsd / peakEquity) * 100 : 0;
      if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
      if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;
    }

    const finalCapital = equityCurve[equityCurve.length - 1] ?? this.config.initialCapital;
    const netProfit = finalCapital - this.config.initialCapital;
    const returnPercentage = (netProfit / this.config.initialCapital) * 100;

    const roundTrips = trades.filter((t) => t.side === 'SELL');
    const winningTrades = roundTrips.filter((t) => t.pnl > 0).length;
    const losingTrades = roundTrips.filter((t) => t.pnl <= 0).length;
    const winRate = roundTrips.length > 0 ? (winningTrades / roundTrips.length) * 100 : 0;
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : grossProfits > 0 ? 999 : 1;
    const sharpeRatio = this.calculateSharpeRatio(equityCurve);

    return {
      initialCapital: this.config.initialCapital,
      finalCapital: Number(finalCapital.toFixed(2)),
      netProfit: Number(netProfit.toFixed(2)),
      returnPercentage: Number(returnPercentage.toFixed(2)),
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      winRate: Number(winRate.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdownUsd: Number(maxDrawdownUsd.toFixed(2)),
      maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      trades,
    };
  }

  private calculateSharpeRatio(equityCurve: number[]): number {
    if (equityCurve.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1];
      if (prev > 0) {
        returns.push((equityCurve[i] - prev) / prev);
      }
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    // Annualize assuming daily steps sqrt(252)
    return (mean / stdDev) * Math.sqrt(252);
  }

  private generateEmptyReport(): BacktestReport {
    return {
      initialCapital: this.config.initialCapital,
      finalCapital: this.config.initialCapital,
      netProfit: 0,
      returnPercentage: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 1,
      maxDrawdownUsd: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      trades: [],
    };
  }
}
