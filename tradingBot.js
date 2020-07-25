const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const axios = require("axios");
const crypto = require("crypto");
// const fs = require("fs").promises;

const config = require("./config");

const BASE_URL = "https://api.binance.com/api/v3";
const API_KEY = "UFXm47ecR6IaD2hMlFDclbNxQF9dVPVnssYFAm99VUtoPI65EYgAaOai4nuEwHSC";
const API_SECRET = "6rVeGsEWErt0Vbfb8DeMYn9xwPOnNfa8zdshB49lMfq4tnnfnq2KXOfDwpGxDlb5";
// const filePath = "output/trades.json";

axios.interceptors.response.use(
    function (response) {
        return response;
    },
    function (error) {
        console.log(Object.keys(error.response));
        console.log(error.response);
        return Promise.reject(error);
    }
);

class TradingBot {
    constructor() {
        this.stockWaitlist = [];
        this.configInitialized = false;
    }

    async run() {
        if (!this.configInitialized) {
            await this.getExchangeData(config);
            this.configInitialized = true;
        }

        const promiseArray = [];

        config.forEach((item) => {
            const promise = new Promise((resolve, reject) => {
                try {
                    this.getHistorialData(item.symbol, true).then((data) => {
                        this.handleTrade(item, data).then(() => resolve());
                    });
                } catch (error) {
                    const errMsg = error.message;
                    console.log(errMsg);
                    reject(error.message);
                }
            });
            promiseArray.push(promise);
        });

        await Promise.all(promiseArray);

        console.log(chalk.yellow("Running..."));
    }

    async handleTrade(stock, histData) {
        const closePrices = [];
        const dates = [];

        histData.forEach((bar) => {
            closePrices.push(bar.close);
            dates.push(bar.date);
        });

        let macdLine = [];
        let signalLine = [];
        let histogram = [];
        let rsi = [];

        const lengthDiff = 25;
        dates.splice(0, lengthDiff);

        await tulind.indicators.rsi.indicator([closePrices], [14], (err, result) => {
            const diff = lengthDiff - 14;
            rsi = result[0];
            rsi.splice(0, diff);
        });

        await tulind.indicators.macd.indicator([closePrices], [12, 26, 9], (err, result) => {
            macdLine = result[0];
            signalLine = result[1];
            histogram = result[2];
        });

        closePrices.splice(0, lengthDiff);

        const tradeData = macdLine.map((x, i) => ({
            symbol: stock.symbol,
            macd: macdLine[i],
            signal: signalLine[i],
            histogram: histogram[i],
            date: dates[i],
            close: closePrices[i],
            rsi: rsi[i],
        }));

        const hasRsiBeenBelow30Last10Bars = tradeData.slice(tradeData.length - 10, tradeData.length).some((bar) => bar.rsi <= 31);
        const hasRsiBeenAbove70Last10Bars = tradeData.slice(tradeData.length - 10, tradeData.length).some((bar) => bar.rsi >= 69);

        const lastThreeBars = tradeData.slice(tradeData.length - 3, tradeData.length);
        const isHistogramTrendingUp =
            lastThreeBars && lastThreeBars.length === 3 && lastThreeBars[0].histogram > lastThreeBars[2].histogram;

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        const avgPrice = await this.getCurrentAvgPrice(stock.symbol);
        let priceAboveAvgPrice = avgPrice < mostRecentData.close;
        let priceBelowAvgPrice = avgPrice > mostRecentData.close;

        console.log(
            `{symbol: ${chalk.magenta(mostRecentData.symbol)}, rsi: ${chalk.cyan(mostRecentData.rsi)}, macd: ${chalk.cyan(
                mostRecentData.macd
            )}, signal: ${chalk.yellow(mostRecentData.signal)}, close: ${chalk.greenBright(mostRecentData.close)}}`
        );

        if (hasRsiBeenBelow30Last10Bars && mostRecentData.macd > mostRecentData.signal && isHistogramTrendingUp) {
            console.log(chalk.green("RSI and MACD is true"));
        }

        if (priceBelowAvgPrice && mostRecentData.macd > mostRecentData.signal && hasRsiBeenBelow30Last10Bars && isHistogramTrendingUp) {
            if (!this.stockWaitlist.includes(stock.symbol)) {
                await this.buyStock(mostRecentData, stock);
                this.stockWaitlist.push(stock.symbol);
            }
        } else if (priceAboveAvgPrice && mostRecentData.macd < mostRecentData.signal && hasRsiBeenAbove70Last10Bars) {
            await this.sellStock(mostRecentData, stock);
            this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
        }
    }

    async buyStock(item, stock) {
        const balance = await this.getAccountBalance();
        // const onePercent = balance / 100;

        console.log("balance", balance);

        let qty = stock.minQty;
        let times = stock.minNotional / stock.stepSize;
        qty = stock.stepSize * times;

        // while (qty * item.close < stock.minNotional && stock.stepSize > 0) {
        //     qty = qty + stock.stepSize;
        // }

        if (balance > qty * item.close) {
            const response = await this.createBuyOrder(item, qty, stock);

            console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}. Http status: ${response.status}`));
        }

        return;
    }

    async sellStock(item, stock) {
        const positions = await this.getPositions(item.symbol);
        const positionWithTicker = positions && positions.length > 0 ? positions[0] : null;

        if (positionWithTicker && positionWithTicker.free > 0) {
            const openOrders = await this.getOpenOrders(item.symbol);
            if (openOrders.length > 0) {
                const status = await this.cancelOpenOrders(item.symbol);
                console.log(`cancelling orders - ${status}`);
            }

            let times = positionWithTicker.free / stock.stepSize;
            let qty = stock.stepSize * times;

            if (qty * item.close * 0.98 < stock.minNotional) return;

            const response = await this.createSellOrder(item, qty, stock);
            console.log(chalk.green(`selling ${item.symbol} in quantity: ${qty}. Http status: ${response.status}`));
        }

        return;
    }

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
            const orderBySymbol = data.filter((order) => order.symbol === symbol.slice(0, 3));
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
            // `symbol=${item.symbol}&side=BUY&type=STOP_LOSS_LIMIT&timeInForce=GTC&quantity=${quantity}&price=${(item.close * 1).toFixed(
            //     config.decimals
            // )}&stopPrice=${(item.close * 0.8).toFixed(config.decimals)}&timestamp=${timeInMilliseconds}`,
            `symbol=${item.symbol}&side=BUY&type=MARKET&quantity=${quantity.toFixed(config.precision)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createSellOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=STOP_LOSS_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(config.precision)}&price=${(
                item.close * 0.998
            ).toFixed(config.decimals)}&stopPrice=${(item.close * 0.999).toFixed(config.decimals)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async getHistorialData(symbol, useSeconds) {
        if (useSeconds) {
            const currentTimeMS = moment().valueOf();
            const fiveMinutesBackMS = moment().subtract(3, "minutes").valueOf();
            const data = await getRequest("aggTrades", `symbol=${symbol}&startTime=${fiveMinutesBackMS}&endTime=${currentTimeMS}`);
            const formattedData = data.map((bar) => ({ close: bar.p, date: moment(bar.T).format("YYYY-MM-DD hh:mm:ss") }));
            const dataWithoutDuplicates = mergeObjectsInUnique(formattedData, "date");
            // console.log(symbol, dataWithoutDuplicates[dataWithoutDuplicates.length - 1]);
            return dataWithoutDuplicates;
        } else {
            const data = await getRequest("klines", `symbol=${symbol}&interval=1m&limit=100`);
            const formattedData = data.map((bar) => ({ close: bar[4], date: moment(bar[6]).format("YYYY-MM-DD hh:mm") }));

            return formattedData;
        }
    }

    async getExchangeData(config) {
        const data = await getRequest("exchangeInfo", "");

        config.forEach((item) => {
            const coinInfo = data.symbols.filter((x) => x.symbol === item.symbol)[0];
            const { minNotional } = coinInfo.filters.filter((x) => x.filterType === "MIN_NOTIONAL")[0];
            const { minPrice, maxPrice } = coinInfo.filters.filter((x) => x.filterType === "PRICE_FILTER")[0];
            const { minQty, stepSize } = coinInfo.filters.filter((x) => x.filterType === "LOT_SIZE")[0];

            item.precision = coinInfo.quotePrecision;
            item.minNotional = minNotional;
            item.minPrice = minPrice;
            item.maxPrice = maxPrice;
            item.minQty = parseFloat(minQty);
            item.stepSize = parseFloat(stepSize);
        });

        return;
    }
}

// async function asyncForEach(array, callback) {
//     for (let index = 0; index < array.length; index++) {
//         await callback(array[index], index, array);
//     }
// }

async function getRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    const { data } = await axios.get(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
        headers: { ...headers, "X-MBX-APIKEY": API_KEY },
    });
    return data;
}

async function postRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    const response = await axios.post(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, null, {
        headers: { ...headers, "X-MBX-APIKEY": API_KEY },
    });
    return response;
}

async function deleteRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    const response = await axios.delete(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
        headers: { ...headers, "X-MBX-APIKEY": API_KEY },
    });
    return response;
}

function mergeObjectsInUnique(array, property) {
    const newArray = new Map();

    array.forEach((item) => {
        const propertyValue = item[property];
        newArray.has(propertyValue)
            ? newArray.set(propertyValue, { ...item, ...newArray.get(propertyValue) })
            : newArray.set(propertyValue, item);
    });

    return Array.from(newArray.values());
}

module.exports = TradingBot;
