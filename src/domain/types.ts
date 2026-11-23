export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'TRAILING_STOP';

export type OrderStatus =
  | 'NEW'
  | 'PENDING_TRIGGER'
  | 'TRIGGERED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  createdAt: string;
  stopPrice?: number;
  limitPrice?: number;
  trailingDelta?: number;
  highWatermark?: number;
  lowWatermark?: number;
}

export interface RiskConfig {
  maxOrderQuantity: number;
  minNotionalValue: number;
  priceBandPercentage: number; // e.g. 0.20 for +-20% collar
}

export interface Trade {
  id: string;
  pair: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId?: string;
  takerUserId?: string;
  price: number;
  quantity: number;
  takerSide: OrderSide;
  timestamp: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}
