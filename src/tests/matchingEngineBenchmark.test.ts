import { describe, it, expect } from 'vitest';
import { MatchingEngineBenchmark } from '../benchmark/MatchingEngineBenchmark.js';

describe('MatchingEngineBenchmark Performance Suite', () => {
  it('executes high-throughput stress run and computes valid latency percentiles', () => {
    const metrics = MatchingEngineBenchmark.run(15000, 'BTC/USDT');

    expect(metrics.totalOrders).toBe(15000);
    expect(metrics.totalTrades).toBeGreaterThan(0);
    expect(metrics.throughputOpsPerSec).toBeGreaterThan(5000);
    expect(metrics.latencies.minMicros).toBeGreaterThanOrEqual(0);
    expect(metrics.latencies.p50Micros).toBeLessThanOrEqual(metrics.latencies.p90Micros);
    expect(metrics.latencies.p90Micros).toBeLessThanOrEqual(metrics.latencies.p99Micros);
    expect(metrics.latencies.p99Micros).toBeLessThanOrEqual(metrics.latencies.p999Micros);
    expect(metrics.latencies.p999Micros).toBeLessThanOrEqual(metrics.latencies.maxMicros);
    expect(metrics.memoryUsageMb.heapUsedAfter).toBeGreaterThan(0);
  });
});
