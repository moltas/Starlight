import { OcoOrder, StopLimitOrder, TradeItem, OpenOrderResponse } from "../model/index";

class BinanceClientMocked {
    balance: number;
    openOrders: any[];
    positions: any;
    numberOfTrades: number;
    startingCapital: number;
    lastPosition: any;
    numberOfProfitableTrades: number;

    constructor() {
        this.balance = 10000;
        this.openOrders = [];
        this.positions = {
            BTC: {
                free: 0,
            },
            ETH: {
                free: 0,
            },
            LTC: {
                free: 0,
            },
            USDT: {
                free: 0,
            },
        };
        this.numberOfTrades = 0;
        this.startingCapital = this.balance;

        this.lastPosition = null;
        this.numberOfProfitableTrades = 0;
    }

    getResults() {
        const difference = this.balance - this.startingCapital;

        return {
            balance: this.balance,
            numberOfTrades: this.numberOfTrades,
            numberOfProfitableTrades: this.numberOfProfitableTrades,
            profitPercentage: `${Number((difference / this.startingCapital) * 100).toFixed(3)}%`,
        };
    }

    async getAccountBalance() {
        return this.balance;
    }

    async getPositions(symbol: string) {
        const position = this.positions[symbol.split("USDT")[0]];
        return [position];
    }

    async getOpenOrders(symbol: string) {
        return this.openOrders.filter((x) => x.symbol === symbol);
    }

    async cancelOpenOrders(symbol: string) {
        this.openOrders = this.openOrders.filter((x) => x.symbol !== symbol);
        return;
    }

    async createBuyOrder(item: TradeItem, quantity: number, config: any) {
        this.positions[config.symbol.split("USDT")[0]].free += quantity;
        this.balance -= item.close * quantity;
        this.lastPosition = item.close * quantity;
    }

    async createSellOrder(item: TradeItem, quantity: number, config: any) {
        this.positions[config.symbol.split("USDT")[0]].free -= quantity;
        this.balance += item.close * quantity;
        this.numberOfTrades++;
        if (item.close * quantity > this.lastPosition) {
            this.numberOfProfitableTrades++;
        }
    }

    async createStopLimitOrder(item: TradeItem, quantity: number, config: any) {
        // this.openOrders.push({ orderType });
    }

    async createOcoSellOrder(item: TradeItem, quantity: number, config: any) {
        const atrTakeProfit = parseFloat(String(item.close)) + item.atr * config.takeProfitMultiplier;
        const atrStopLoss = item.close - item.atr * config.stopLossMultiplier;
        const atrStopLimit = item.close - item.atr * config.stopLimitMultiplier;

        const price = parseFloat(String(atrTakeProfit));
        const stopPrice = parseFloat(String(atrStopLoss));
        const stopLimitPrice = parseFloat(String(atrStopLimit));

        const stopLossOrder = new OpenOrderResponse(
            item.symbol,
            Number(stopLimitPrice.toFixed(config.decimals)) * Number(quantity.toFixed(config.precision)),
            stopLimitPrice.toFixed(config.decimals),
            quantity.toFixed(config.precision),
            "STOP_LOSS_LIMIT",
            stopPrice.toFixed(config.decimals)
        );

        const limitMakerOrder = new OpenOrderResponse(
            item.symbol,
            Number(price.toFixed(config.decimals)) * Number(quantity.toFixed(config.precision)),
            price.toFixed(config.decimals),
            quantity.toFixed(config.precision),
            "LIMIT_MAKER"
        );

        this.openOrders.push(stopLossOrder);
        this.openOrders.push(limitMakerOrder);
    }

    getLatestTickerData(symbol: string): any[] {
        return [];
    }

    async getExchangeData(config: any) {
        return;
    }

    async getLastBuy(symbol: string) {
        return 0.0;
    }

    async sellOrder(symbol: string, amount: string, qty: string) {
        await this.cancelOpenOrders(symbol);
        this.balance += Number(amount);
        this.numberOfTrades++;
        this.positions[symbol.split("USDT")[0]].free -= Number(qty);
        if (amount > this.lastPosition) {
            this.numberOfProfitableTrades++;
        }
    }
}

export default BinanceClientMocked;
