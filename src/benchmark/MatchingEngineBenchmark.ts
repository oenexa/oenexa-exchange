import { OrderBook } from '../engine/OrderBook.js';
import type { Order } from '../domain/types.js';

export interface LatencyDistribution {
  meanMicros: number;
  minMicros: number;
  p50Micros: number;
  p90Micros: number;
  p99Micros: number;
  p999Micros: number;
  maxMicros: number;
}

export interface BenchmarkMetrics {
  totalOrders: number;
  totalTrades: number;
  elapsedMs: number;
  throughputOpsPerSec: number;
  latencies: LatencyDistribution;
  memoryUsageMb: {
    heapUsedBefore: number;
    heapUsedAfter: number;
    heapDelta: number;
  };
  passedThresholds: boolean;
}

export class MatchingEngineBenchmark {
  public static run(totalOrders = 50000, pair = 'BTC/USDT'): BenchmarkMetrics {
    const book = new OrderBook(pair);
    const latenciesMicros: number[] = new Array(totalOrders);
    let totalTrades = 0;

    const memBefore = process.memoryUsage().heapUsed;
    const basePrice = 90000;

    const wallClockStart = Date.now();

    for (let i = 0; i < totalOrders; i++) {
      const isBuy = i % 2 === 0;
      // Crossing limit orders: Buyers bid basePrice + 10, Sellers ask basePrice
      // This immediately triggers matching executions against resting liquidity
      const price = isBuy ? basePrice + 10 : basePrice;
      const amount = 0.1;

      const order: Order = {
        id: `ord_${i}`,
        userId: `user_${i % 1000}`,
        pair,
        side: isBuy ? 'BUY' : 'SELL',
        type: 'LIMIT',
        price,
        quantity: 1.0,
        filledQuantity: 0,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      };

      const startNano = process.hrtime.bigint();
      const result = book.submitOrder(order);
      const endNano = process.hrtime.bigint();

      const elapsedMicro = Number(endNano - startNano) / 1000;
      latenciesMicros[i] = elapsedMicro;
      totalTrades += result.trades.length;
    }

    const wallClockEnd = Date.now();
    const elapsedMs = Math.max(1, wallClockEnd - wallClockStart);
    const throughputOpsPerSec = Math.round((totalOrders / elapsedMs) * 1000);

    const memAfter = process.memoryUsage().heapUsed;

    // Calculate percentiles
    latenciesMicros.sort((a, b) => a - b);
    const sum = latenciesMicros.reduce((acc, val) => acc + val, 0);
    const meanMicros = Number((sum / totalOrders).toFixed(2));
    const minMicros = Number(latenciesMicros[0].toFixed(2));
    const p50Micros = Number(latenciesMicros[Math.floor(totalOrders * 0.5)].toFixed(2));
    const p90Micros = Number(latenciesMicros[Math.floor(totalOrders * 0.9)].toFixed(2));
    const p99Micros = Number(latenciesMicros[Math.floor(totalOrders * 0.99)].toFixed(2));
    const p999Micros = Number(latenciesMicros[Math.floor(totalOrders * 0.999)].toFixed(2));
    const maxMicros = Number(latenciesMicros[totalOrders - 1].toFixed(2));

    const heapUsedBefore = Number((memBefore / 1024 / 1024).toFixed(2));
    const heapUsedAfter = Number((memAfter / 1024 / 1024).toFixed(2));
    const heapDelta = Number((heapUsedAfter - heapUsedBefore).toFixed(2));

    // Banking grade thresholds: Throughput >= 20,000 Ops/Sec, P99 <= 1000 micros (1ms)
    const passedThresholds = throughputOpsPerSec >= 20000 && p99Micros <= 1000;

    return {
      totalOrders,
      totalTrades,
      elapsedMs,
      throughputOpsPerSec,
      latencies: {
        meanMicros,
        minMicros,
        p50Micros,
        p90Micros,
        p99Micros,
        p999Micros,
        maxMicros,
      },
      memoryUsageMb: {
        heapUsedBefore,
        heapUsedAfter,
        heapDelta,
      },
      passedThresholds,
    };
  }
}
