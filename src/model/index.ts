export interface StopLimitOrder {
    stopPrice: number;
    stopLimitPrice: number;
}

export interface OcoOrder {
    price: number;
    stopPrice: number;
    stopLimitPrice: number;
}

export interface TradeItem {
    symbol: string;
    date: Date;
    close: number;
    high: number;
    low: number;
    rsi: number;
    atr: number;
    ichimoku: any;
}
