const moment = require("moment");
const { mergeObjectsInUnique, getRequest, postRequest, deleteRequest } = require("./utils");

class BinanceClient {
    constructor() {}

    async getAccountBalance() {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const { balances } = await getRequest("account", `timestamp=${timeInMilliseconds}`, isSigned);
        const obj = balances.filter((coin) => coin.asset === "USDT");
        return obj[0].free;
    }

    async getPositions(symbol) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;

        const { balances } = await getRequest("account", `timestamp=${timeInMilliseconds}`, isSigned);

        if (symbol) {
            const symbolBalance = balances.filter((coin) => coin.asset === symbol.slice(0, 3));
            return symbolBalance;
        }

        return balances;
    }

    async getOpenOrders(symbol) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const data = await getRequest("openOrders", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        if (symbol) {
            const orderBySymbol = data.filter((order) => order.symbol === symbol);
            return orderBySymbol;
        }

        return data;
    }

    async cancelOpenOrders(symbol) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const status = await deleteRequest("openOrders", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        return status;
    }

    async getCurrentAvgPrice(symbol) {
        const { price } = await getRequest("avgPrice", `symbol=${symbol}`);
        return price;
    }

    async createBuyOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;

        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=BUY&type=MARKET&quantity=${quantity.toFixed(config.precision)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createSellOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;

        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=MARKET&quantity=${quantity.toFixed(config.precision)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createStopLimitOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;

        const atrStopLoss = item.close - item.atr * config.stopLossMultiplier;
        const atrStopLimit = item.close - item.atr * config.stopLimitMultiplier;

        const stopPrice = parseFloat(atrStopLoss);
        const stopLimitPrice = parseFloat(atrStopLimit);

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

    async createOcoSellOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;

        const atrTakeProfit = parseFloat(item.close) + item.atr * config.takeProfitMultiplier;
        const atrStopLoss = item.close - item.atr * config.stopLossMultiplier;
        const atrStopLimit = item.close - item.atr * config.stopLimitMultiplier;

        const price = parseFloat(atrTakeProfit);
        const stopPrice = parseFloat(atrStopLoss);
        const stopLimitPrice = parseFloat(atrStopLimit);

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

    async getHistorialData(symbol, useSeconds) {
        if (useSeconds) {
            const data = await getRequest("aggTrades", `symbol=${symbol}&limit=300`);
            const formattedData = data.map((bar) => ({ close: bar.p, date: moment(bar.T).format("YYYY-MM-DD HH:mm:ss") }));
            const dataWithoutDuplicates = mergeObjectsInUnique(formattedData, "date");
            return dataWithoutDuplicates;
        } else {
            const data = await getRequest("klines", `symbol=${symbol}&interval=1m&limit=100`);
            const formattedData = data.map((bar) => ({ close: bar[4], date: moment(bar[6]).format("YYYY-MM-DD HH:mm") }));

            return formattedData;
        }
    }

    async getLatestTickerData(symbol, writer) {
        const data = await getRequest("klines", `symbol=${symbol}&interval=1m&limit=100`);

        const formattedData = data.map((x) => ({
            close: x[4],
            high: x[2],
            low: x[3],
            date: moment(x[6]).format("YYYY-MM-DD HH:mm"),
            // date: moment().format("YYYY-MM-DD HH:mm:ss"),
        }));

        // if (writer) {
        //     await writer.writeRecords([formattedData]);
        // }

        return formattedData;
    }

    async getExchangeData(config) {
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

    async getLastBuy(symbol) {
        const timeInMilliseconds = moment().valueOf();
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
}

module.exports = BinanceClient;
