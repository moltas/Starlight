import moment from "moment";
import { getRequest, postRequest, deleteRequest } from "../utils";
import { TradeItem } from "../model";

class BinanceClient {
    constructor() {}

    async getAccountBalance() {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;
        const { balances } = await getRequest("account", `timestamp=${timeInMilliseconds}`, isSigned);
        const obj = balances.filter((coin) => coin.asset === "USDT");
        return obj[0].free;
    }

    async getPositions(symbol: string) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;

        const { balances } = await getRequest("account", `timestamp=${timeInMilliseconds}`, isSigned);

        if (symbol) {
            const symbolBalance = balances.filter((coin) => coin.asset === symbol.slice(0, 3));
            return symbolBalance;
        }

        return balances;
    }

    async getOpenOrders(symbol: string) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;
        const data = await getRequest("openOrders", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        if (symbol) {
            const orderBySymbol = data.filter((order) => order.symbol === symbol);
            return orderBySymbol;
        }

        return data;
    }

    async cancelOpenOrders(symbol: string) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;
        const status = await deleteRequest("openOrders", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        return status;
    }

    async getCurrentAvgPrice(symbol: string) {
        const { price } = await getRequest("avgPrice", `symbol=${symbol}`);
        return price;
    }

    async createBuyOrder(item: TradeItem, quantity: number, config: any) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;

        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=BUY&type=MARKET&quantity=${quantity.toFixed(config.precision)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createSellOrder(item: TradeItem, quantity: number, config: any) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;

        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=MARKET&quantity=${quantity.toFixed(config.precision)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createStopLimitOrder(item: TradeItem, quantity: number, config: any) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;

        const atrStopLoss = item.close - item.atr * config.stopLossMultiplier;
        const atrStopLimit = item.close - item.atr * config.stopLimitMultiplier;

        const stopPrice = parseFloat(String(atrStopLoss));
        const stopLimitPrice = parseFloat(String(atrStopLimit));

        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=STOP_LOSS_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(
                config.precision
            )}&price=${stopLimitPrice.toFixed(config.decimals)}&stopPrice=${stopPrice.toFixed(
                config.decimals
            )}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createOcoSellOrder(item: TradeItem, quantity: number, config: any) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;

        const atrTakeProfit = parseFloat(String(item.close)) + item.atr * config.takeProfitMultiplier;
        const atrStopLoss = item.close - item.atr * config.stopLossMultiplier;
        const atrStopLimit = item.close - item.atr * config.stopLimitMultiplier;

        const price = parseFloat(String(atrTakeProfit));
        const stopPrice = parseFloat(String(atrStopLoss));
        const stopLimitPrice = parseFloat(String(atrStopLimit));

        return await postRequest(
            "order/oco",
            `symbol=${item.symbol}&side=SELL&price=${price.toFixed(config.decimals)}&stopPrice=${stopPrice.toFixed(
                config.decimals
            )}&stopLimitPrice=${stopLimitPrice.toFixed(config.decimals)}&quantity=${quantity.toFixed(
                config.precision
            )}&timestamp=${timeInMilliseconds}&stopLimitTimeInForce=GTC`,
            isSigned
        );
    }

    async getLatestTickerData(symbol: string, interval: any) {
        const data = await getRequest("klines", `symbol=${symbol}&interval=${interval}&limit=200`);

        const formattedData = data.map((x) => ({
            close: x[4],
            high: x[2],
            low: x[3],
            time: x[6],
        }));

        return formattedData;
    }

    async getExchangeData(config: any) {
        const data = await getRequest("exchangeInfo", "");

        const coinInfo = data.symbols.filter((x) => x.symbol === config.symbol)[0];
        const { minNotional } = coinInfo.filters.filter((x) => x.filterType === "MIN_NOTIONAL")[0];
        const { minPrice, maxPrice } = coinInfo.filters.filter((x) => x.filterType === "PRICE_FILTER")[0];
        const { minQty, stepSize } = coinInfo.filters.filter((x) => x.filterType === "LOT_SIZE")[0];

        config.precision = coinInfo.quotePrecision;
        config.minNotional = parseFloat(minNotional);
        config.minPrice = parseFloat(minPrice);
        config.maxPrice = parseFloat(maxPrice);
        config.minQty = parseFloat(minQty);
        config.stepSize = parseFloat(stepSize);

        return;
    }

    async getLastBuy(symbol: string) {
        const timeInMilliseconds = moment().unix();
        const isSigned = true;
        let data = await getRequest("myTrades", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        let index = data.length - 1;

        while (index > 0) {
            if (data[index].isBuyer === false) {
                data = data.slice(index, data.length - 1);
                break;
            }
            index--;
        }

        let totalAmount = 0;
        data.forEach((x) => (totalAmount += parseFloat(x.price) * parseFloat(x.qty)));

        return totalAmount;
    }

    async sellOrder(symbol: string, price: string) {}

    getResults() {
        return null;
    }
}

export default BinanceClient;
