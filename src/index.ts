import http from 'node:http';
import { ExchangeService } from './service/ExchangeService.js';
import { TradeSettlementBridge } from './service/TradeSettlementBridge.js';
import { PreTradeRiskCollarEngine } from './engine/PreTradeRiskCollarEngine.js';

export * from './domain/types.js';
export * from './domain/events.js';
export * from './engine/OrderBook.js';
export * from './engine/PreTradeRiskCollarEngine.js';
export * from './service/ExchangeService.js';
export * from './service/TradeSettlementBridge.js';
export * from './gateway/FixProtocolGateway.js';
export * from './benchmark/MatchingEngineBenchmark.js';
export * from './automation/AutomatedRiskGuard.js';
export * from './automation/StrategyEngine.js';
export * from './automation/BacktestingFramework.js';

const exchange = new ExchangeService();
const settlementBridge = new TradeSettlementBridge();
const riskCollarEngine = new PreTradeRiskCollarEngine();
const PORT = Number(process.env.PORT) || 8082;

export const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'UP', service: 'oenexa-exchange', timestamp: new Date().toISOString() }));
  }

  if (req.url?.startsWith('/api/exchange/orderbook') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pair = url.searchParams.get('pair') || 'ONXC/USDT';
    try {
      const depth = exchange.getDepth(pair);
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, data: depth }));
    } catch (err: any) {
      res.writeHead(400);
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ success: false, error: 'Endpoint Not Found' }));
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[oenexa-exchange] Trading Engine Microservice listening on port ${PORT}`);
  });
}
