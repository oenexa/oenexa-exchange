# OENEXA Exchange Service (`oenexa-exchange`)

> **Institutional In-Memory Order Book Matching Engine & Trade Execution Gateway**  
> Governed by the OENEXA FinTech Architecture & Exchange Engineering Organizations.

## 1. Domain Ownership
This repository authoritatively owns the **Exchange & Order Matching Domain**:
- **Owned Data**: Active Order Books (L2/L3 Depth), Order History, Trade Execution Logs, Tickers, Candle Aggregations.
- **Owned APIs**: `POST /v1/orders`, `DELETE /v1/orders/:id`, `GET /v1/orderbook/:pair`, `GET /v1/trades/:pair`.
- **Owned Events**: `com.oenexa.exchange.trade.executed.v1`, `com.oenexa.exchange.order.filled.v1`.
- **Database Boundary**: Isolated `oenexa-exchange-prod-db`. Zero shared databases.

## 2. Matching Engine Architecture
- **Price-Time Priority (FIFO)**: High-performance deterministic matching algorithm.
- **Sub-Millisecond Execution**: In-memory execution loop without blocking I/O or database locks.
- **Self-Trade Prevention (STP)**: Prevents wash trading and internal crossed books.
