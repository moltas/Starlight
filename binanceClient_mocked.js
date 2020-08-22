class BinanceClientMocked {
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

    async getPositions(symbol) {
        const position = this.positions[symbol.split("USDT")[0]];
        return [position];
    }

    async getOpenOrders(symbol) {
        return this.openOrders.filter((x) => x.symbol === symbol);
    }

    async cancelOpenOrders(symbol) {
        this.openOrders = this.openOrders.filter((x) => x.symbol !== symbol);
        return;
    }

    async createBuyOrder(item, quantity, config) {
        this.positions[config.symbol.split("USDT")[0]].free += quantity;
        this.balance -= item.close * quantity;
        this.lastPosition = item.close * quantity;
    }

    async createSellOrder(item, quantity, config) {
        this.positions[config.symbol.split("USDT")[0]].free -= quantity;
        this.balance += item.close * quantity;
        this.numberOfTrades++;
        if (item.close * quantity > this.lastPosition) {
            this.numberOfProfitableTrades++;
        }
    }

    async createStopLimitOrder(item, quantity, config) {
        // TBD
    }

    async createOcoSellOrder(item, quantity, config) {
        // TBD
    }

    async getLatestTickerData(symbol) {
        return [];
    }

    async getExchangeData(config) {
        return;
    }

    async getLastBuy(symbol) {
        return 0.0;
    }
}

module.exports = BinanceClientMocked;
