import { OcoOrder, StopLimitOrder, TradeItem } from "../model/index";

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
        return {
            balance: this.balance,
            numberOfTrades: this.numberOfTrades,
            numberOfProfitableTrades: this.numberOfProfitableTrades,
            profitPercentage: (this.balance / this.startingCapital).toFixed(3),
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
        // TBD
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
}

export default BinanceClientMocked;
