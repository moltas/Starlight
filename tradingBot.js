const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");

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
        this.tradingData = [];
    }

    results() {
        return {
            numberOfTrades: this.numberOfTrades,
            totalProfits: `${this.totalProfit}$`,
        };
    }

    async collectTradeData(symbol) {
        console.log(chalk.yellow("Collecting data..."));
        const csvWriter = createCsvWriter({
            path: `output/${symbol}.csv`,
            header: [
                { id: "symbol", title: "symbol" },
                { id: "close", title: "close" },
                { id: "date", title: "date" },
            ],
        });

        // for (let i = 0; i < 100; i++) {
        //     await this.getLatestTickerData(symbol, csvWriter);
        //     await timeout(1000);
        // }

        return new Promise((resolve, reject) => {
            try {
                fs.createReadStream(`output/${symbol}.csv`)
                    .pipe(csv())
                    .on("data", (row) => {
                        this.tradingData.push(row);
                    })
                    .on("end", () => {
                        console.log(chalk.green("Data collected!"));
                        resolve();
                    });
            } catch (error) {
                reject(error);
            }
        });
    }

    async run(config) {
        if (!this.configInitialized) {
            await this.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            const latestTickerData = await this.getLatestTickerData(config.symbol);
            this.tradingData.push(latestTickerData);
            await this.handleTrade(config, this.tradingData);
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject();
        }

        return this.results();
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

        const last10Bars = tradeData.slice(tradeData.length - 15, tradeData.length);
        const last3Bars = tradeData.slice(tradeData.length - 3, tradeData.length);

        const hasRsiBeenBelow30Last10Bars = last10Bars.some((bar) => bar.rsi <= stock.rsiLow);
        const hasRsiBeenAbove70Last10Bars = last10Bars.some((bar) => bar.rsi >= stock.rsiHigh);

        const hasHistogramBeenHigh = last10Bars.some((bar) => bar.histogram >= stock.histogramHigh);
        const hasHistogramBeenLow = last10Bars.some((bar) => bar.histogram <= -stock.histogramHigh);

        const isHisogramTrendingUp = last3Bars[0].histogram < last3Bars[2].histogram;
        const isHisogramTrendingDown = last3Bars[0].histogram < last3Bars[2].histogram;

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        // const avgPrice = await this.getCurrentAvgPrice(stock.symbol);
        // let priceAboveAvgPrice = avgPrice < mostRecentData.close;
        // let priceBelowAvgPrice = avgPrice > mostRecentData.close;

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
            }, signal: ${chalk.yellow(mostRecentData.signal)}, histogram: ${chalk.yellow(
                mostRecentData.histogram
            )}, close: ${chalk.greenBright(mostRecentData.close)}, date: ${mostRecentData.date}}`
        );

        const buySignal = mostRecentData.macd > mostRecentData.signal && hasHistogramBeenLow && hasRsiBeenBelow30Last10Bars;
        const sellSignal = mostRecentData.macd < mostRecentData.signal && hasHistogramBeenHigh && hasRsiBeenAbove70Last10Bars;

        if (buySignal) {
            console.log(chalk.cyan("Buy signal reached"));
            if (!this.stockWaitlist.includes(stock.symbol)) {
                await this.buyStock(mostRecentData, stock);
                this.stockWaitlist.push(stock.symbol);
            }
        } else if (sellSignal) {
            console.log(chalk.cyan("Sell signal reached"));
            const stockSold = await this.sellStock(mostRecentData, stock);
            if (stockSold) {
                this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
            }
        }
    }

    async buyStock(item, stock) {
        const balance = await this.getAccountBalance();
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

        // set stop loss order
        // await this.createStopLimitSellOrder(item, qty, stock);

        console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}`));
        console.log("Remaining balance", balance);

        await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        this.numberOfTrades += 1;

        return;
    }

    async sellStock(item, stock) {
        const positions = await this.getPositions(item.symbol);
        const positionWithTicker = positions && positions.length > 0 ? positions[0] : null;

        if (positionWithTicker && positionWithTicker.free > 0 && positionWithTicker.free * item.close > stock.minNotional) {
            let qty = stock.minQty;

            while (qty < positionWithTicker.free) {
                qty += stock.stepSize;
            }

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

            const buyPrice = await this.getLastBuy(item.symbol);
            const profit = qty * item.close - qty * buyPrice;
            console.log("profit is", profit);

            if (profit > -0.1) {
                await this.createSellOrder(item, qty, stock);
                console.log(chalk.green(`selling ${item.symbol} in quantity: ${qty}`));
                this.totalProfit += profit;
                this.numberOfTrades += 1;
                await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });
                return true;
            }
        }

        return false;
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
        );
    }

    async createStopLimitSellOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=STOP_LOSS_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(config.precision)}&price=${(
                item.close * config.priceDropMultiplier
            ).toFixed(config.decimals)}&stopPrice=${(item.close * config.priceDropMultiplier + 0.00002).toFixed(
                config.decimals
            )}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async getHistorialData(symbol, useSeconds) {
        if (useSeconds) {
            const data = await getRequest("aggTrades", `symbol=${symbol}&limit=300`);
            const formattedData = data.map((bar) => ({ close: bar.p, date: moment(bar.T).format("YYYY-MM-DD hh:mm:ss") }));
            const dataWithoutDuplicates = mergeObjectsInUnique(formattedData, "date");
            return dataWithoutDuplicates;
        } else {
            const data = await getRequest("klines", `symbol=${symbol}&interval=1m&limit=100`);
            const formattedData = data.map((bar) => ({ close: bar[4], date: moment(bar[6]).format("YYYY-MM-DD hh:mm") }));

            return formattedData;
        }
    }

    async getLatestTickerData(symbol, writer) {
        const data = await getRequest("ticker/price", `symbol=${symbol}`);
        const formattedData = { symbol: data.symbol, close: data.price, date: moment().format("YYYY-MM-DD hh:mm:ss") };

        if (writer) {
            await writer.writeRecords([formattedData]);
        }

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
        const data = await getRequest("myTrades", `symbol=${symbol}&timestamp=${timeInMilliseconds}`, isSigned);

        const buyTrades = data.filter((x) => x.isBuyer);
        return buyTrades[buyTrades.length - 1].price;
    }
}

async function writeToFile(stock, obj) {
    if (!stock.symbol) return;

    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    const fileObj = JSON.parse(fileContent);

    if (!Object.keys(fileObj).includes(stock.symbol)) {
        fileObj[stock.symbol] = [obj];
    } else {
        fileObj[stock.symbol].push(obj);
    }

    const writeContent = JSON.stringify(fileObj);
    await fs.promises.writeFile(filePath, writeContent);
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

function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = TradingBot;
