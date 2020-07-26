const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs").promises;

const config = require("./config");

const BASE_URL = "https://api.binance.com/api/v3";
const API_KEY = "UFXm47ecR6IaD2hMlFDclbNxQF9dVPVnssYFAm99VUtoPI65EYgAaOai4nuEwHSC";
const API_SECRET = "6rVeGsEWErt0Vbfb8DeMYn9xwPOnNfa8zdshB49lMfq4tnnfnq2KXOfDwpGxDlb5";
const filePath = "output/trades.json";

class TradingBot {
    constructor() {
        this.stockWaitlist = [];
        this.configInitialized = false;
        this.numberOfTrades = 0;
        this.totalProfit = 0;
    }

    results() {
        return {
            numberOfTrades: this.numberOfTrades,
            totalProfits: `${this.totalProfit}$`,
        };
    }

    async run() {
        console.time("timer");
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

        console.timeEnd("timer");
        console.log(chalk.yellow("Running..."));
        console.log(this.results());

        await writeToFile({ test: 123 });
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
            macd: parseFloat(macdLine[i]).toFixed(4),
            signal: parseFloat(signalLine[i]).toFixed(4),
            histogram: histogram[i],
            date: dates[i],
            close: closePrices[i],
            rsi: parseFloat(rsi[i]).toFixed(4),
        }));

        const hasRsiBeenBelow30Last10Bars = tradeData.slice(tradeData.length - 10, tradeData.length).some((bar) => bar.rsi <= stock.rsiLow);
        const hasRsiBeenAbove70Last10Bars = tradeData
            .slice(tradeData.length - 10, tradeData.length)
            .some((bar) => bar.rsi >= stock.rsiHigh);

        const lastThreeBars = tradeData.slice(tradeData.length - 3, tradeData.length);
        const isHistogramTrendingUp =
            lastThreeBars && lastThreeBars.length === 3 && lastThreeBars[0].histogram > lastThreeBars[2].histogram;

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        const avgPrice = await this.getCurrentAvgPrice(stock.symbol);
        let priceAboveAvgPrice = avgPrice < mostRecentData.close;
        let priceBelowAvgPrice = avgPrice > mostRecentData.close;

        console.log(
            `{symbol: ${chalk.magenta(mostRecentData.symbol)}, rsi: ${
                hasRsiBeenAbove70Last10Bars || hasRsiBeenBelow30Last10Bars
                    ? chalk.green(mostRecentData.rsi)
                    : chalk.cyan(mostRecentData.rsi)
            }, macd: ${
                (hasRsiBeenAbove70Last10Bars && mostRecentData.macd < mostRecentData.signal) ||
                (hasRsiBeenBelow30Last10Bars && mostRecentData.macd > mostRecentData.signal)
                    ? chalk.green(mostRecentData.macd)
                    : chalk.cyan(mostRecentData.macd)
            }, histogram: ${chalk.yellow(mostRecentData.histogram)}, close: ${chalk.greenBright(mostRecentData.close)}, date: ${
                mostRecentData.date
            }}`
        );

        if (
            priceBelowAvgPrice &&
            mostRecentData.macd > mostRecentData.signal &&
            hasRsiBeenBelow30Last10Bars &&
            mostRecentData.histogram <= -0.3
        ) {
            console.log(chalk.cyan("Buy signal reached"));
            if (!this.stockWaitlist.includes(stock.symbol)) {
                await this.buyStock(mostRecentData, stock);
                this.stockWaitlist.push(stock.symbol);
            }
        } else if (
            (priceAboveAvgPrice && mostRecentData.macd < mostRecentData.signal && hasRsiBeenAbove70Last10Bars) ||
            mostRecentData.histogram >= 0.5
        ) {
            console.log(chalk.cyan("Sell signal reached"));
            await this.sellStock(mostRecentData, stock);
            this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
        }
    }

    async buyStock(item, stock) {
        const balance = await this.getAccountBalance();
        const tenPercent = balance / 10;
        let qty = stock.minQty;

        while (qty * item.close * 0.9 < stock.minNotional) {
            qty += stock.stepSize;
        }

        if (qty * item.close < stock.minNotional) {
            console.log(
                chalk.red(
                    `Buy validation failed. MinNotional not reached. Amount is ${qty * item.close} and minNotional is ${stock.minNotional}`
                )
            );
            return;
        }

        if (qty * item.close * 0.99 > balance) {
            console.log(
                chalk.red(`Buy validation failed. Not enough balance (${balance}) to buy - ${stock.symbol} at price ${qty * item.close}`)
            );
            return;
        }

        await this.createBuyOrder(item, qty, stock);

        console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}`));
        console.log("Remaining balance", balance);

        await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        this.numberOfTrades += 1;

        return;
    }

    async sellStock(item, stock) {
        const positions = await this.getPositions(item.symbol);
        const positionWithTicker = positions && positions.length > 0 ? positions[0] : null;

        if (positionWithTicker && positionWithTicker.free > 0) {
            let qty = stock.minQty;

            while (qty < positionWithTicker.free) {
                qty += stock.stepSize;
            }

            console.log(`total value to sell is: ${positionWithTicker.free * item.close}`);

            if (qty > positionWithTicker.free) qty -= stock.stepSize;

            console.log(`total sell value - ${qty * item.close}`);

            if (qty * item.close < stock.minNotional) {
                console.log(
                    chalk.red(
                        `Sell validation failed. MinNotional not reached. Amount is ${qty * item.close} and minNotional is ${
                            stock.minNotional
                        }`
                    )
                );
                return;
            }

            const openOrders = await this.getOpenOrders(item.symbol);
            if (openOrders.length > 0) {
                await this.cancelOpenOrders(item.symbol);
            }

            const { price: buyPrice, qty: buyQty } = await this.getLastBuy(item.symbol);
            const profit = buyQty * item.close - buyPrice * buyQty;
            console.log("profit is", profit);

            if (profit > -0.1) {
                await this.createSellOrder(item, qty, stock);
                console.log(chalk.green(`selling ${item.symbol} in quantity: ${qty}`));
                this.totalProfit += profit;
                this.numberOfTrades += 1;
                await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });
            }
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
            // "order",
            // `symbol=${item.symbol}&side=SELL&type=STOP_LOSS_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(config.precision)}&price=${(
            //     item.close * 0.9997
            // ).toFixed(config.decimals)}&stopPrice=${(item.close * 0.9998).toFixed(config.decimals)}&timestamp=${timeInMilliseconds}`,
            // isSigned
        );
    }

    async getHistorialData(symbol, useSeconds) {
        if (useSeconds) {
            const currentTimeMS = moment().valueOf();
            const fiveMinutesBackMS = moment().subtract(3, "minutes").valueOf();
            const data = await getRequest("aggTrades", `symbol=${symbol}&startTime=${fiveMinutesBackMS}&endTime=${currentTimeMS}`);
            const formattedData = data.map((bar) => ({ close: bar.p, date: moment(bar.T).format("YYYY-MM-DD hh:mm:ss") }));
            const dataWithoutDuplicates = mergeObjectsInUnique(formattedData, "date");
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
            item.minNotional = parseFloat(minNotional);
            item.minPrice = parseFloat(minPrice);
            item.maxPrice = parseFloat(maxPrice);
            item.minQty = parseFloat(minQty);
            item.stepSize = parseFloat(stepSize);
        });

        return;
    }

    async getLastBuy(symbol) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const data = await getRequest("myTrades", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);
        const buyTrades = data.filter((x) => x.isBuyer);
        return buyTrades[buyTrades.length - 1];
    }
}

async function writeToFile(stock, obj) {
    if (!stock.symbol) return;

    const fileContent = await fs.readFile(filePath, "utf-8");
    const fileObj = JSON.parse(fileContent);

    if (!Object.keys(fileObj).includes(stock.symbol)) {
        fileObj[stock.symbol] = [obj];
    } else {
        fileObj[stock.symbol].push(obj);
    }

    const writeContent = JSON.stringify(fileObj);
    await fs.writeFile(filePath, writeContent);
}

async function getRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const { data } = await axios.get(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return data;
    } catch (err) {
        const errMsg = err.response ? err.response.data.msg : err;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

async function postRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.post(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, null, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

async function deleteRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.delete(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
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
