import Ichimoku from "../ichimoku";

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
    amount: number;
    price: string;
    stopPrice?: string;
    origQty: string;
    status: string = "NEW";
    timeInForce: string = "GTC";
    type: string;
    side: string = "SELL";

    constructor(symbol: string, amount: number, price: string, qty: string, type: string, side?: string, stopPrice?: string) {
        this.symbol = symbol;
        this.amount = amount;
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

export interface ConfigItem {
    symbol: string;
    decimals: number;
    stepSize: number;
    minQty: number;
    minNotional: number;
    precision: number;
    rsiLow: number;
    rsiHigh: number;
    stopLossMultiplier: number;
    stopLimitMultiplier: number;
    takeProfitMultiplier: number;
    atrMod: number;
}

export enum PurchaseTypes {
    BREAKTHROUGH = "breakthrough",
    CROSSING = "crossing",
    BOUNCE = "bounce",
}

export class WriteObj {
    numberOfTrades: number = 0;
    numberOfProfitableTrades: number = 0;
    startBalance: number = 0;
    currentBalance: number = 0;
    trades: LogTrade[] = [];
}

export class LogTrade {
    side: string;
    orderType: string;
    amount: number;
    quantity: number;
    price: number;
    time: Date;
    tradeSignal: string = "none";

    constructor(side: string, orderType: string, quantity: number, tradeItem: TradeItem, tradeSignal?: string) {
        this.side = side;
        this.orderType = orderType;
        this.quantity = quantity;
        this.amount = quantity * tradeItem.close;
        this.price = tradeItem.close;
        this.time = tradeItem.date;
        this.tradeSignal = tradeSignal;
    }
}

export interface HandleTrade {
    entrySignal: boolean;
    exitSignal: boolean;
    timestamp: number;
}
