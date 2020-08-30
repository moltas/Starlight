export interface StopLimitOrder {
    stopPrice: number;
    stopLimitPrice: number;
}

export interface OcoOrder {
    price: number;
    stopPrice: number;
    stopLimitPrice: number;
}

export class OpenOrderResponse {
    symbol: string;
    price: string;
    stopPrice?: string;
    origQty: string;
    status: string = "NEW";
    timeInForce: string = "GTC";
    type: string;
    side: string = "SELL";

    constructor(symbol: string, price: string, qty: string, type: string, side?: string, stopPrice?: string) {
        this.symbol = symbol;
        this.price = price;
        this.origQty = qty;
        this.type = type;
        this.side = side;
        this.stopPrice = stopPrice;
    }
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
