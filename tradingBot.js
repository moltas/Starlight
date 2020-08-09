const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");
var path = require("path");

const { timeout } = require("./utils");
const BinanceClient = require("./binanceClient.js");

const filePath = path.resolve(`output/trades_${moment().format("YYYY-MM-DD")}.json`);

const client = new BinanceClient();

class TradingBot {
    constructor() {
        this.stockWaitlist = [];
        this.configInitialized = false;
        this.tradingData = [];

        const fileContent = {
            BTCUSDT: [],
            ETHUSDT: [],
            LTCUSDT: [],
        };
        fs.writeFile(filePath, JSON.stringify(fileContent), () => {
            console.log("Resetting file");
        });
    }

    async run(config, backtestData) {
        if (!this.configInitialized && !backtestData) {
            await client.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            if (backtestData) {
                this.tradingData = backtestData;
            } else {
                const data = await client.getLatestTickerData(config.symbol);
                this.tradingData.push(data);
            }

            await this.handleTrade(config, this.tradingData, !!backtestData);
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject(errMsg);
        }

        return null;
    }

    async handleTrade(stock, histData, isBacktest) {
        const shortenedHistData = histData.slice(histData.length - 100, histData.length);
        const closePrices = [];
        const highPrices = [];
        const lowPrices = [];
        const dates = [];

        shortenedHistData.forEach((bar) => {
            closePrices.push(bar.close);
            highPrices.push(bar.high);
            lowPrices.push(bar.low);
            dates.push(bar.date);
        });

        let macdLine = [];
        let signalLine = [];
        let histogram = [];
        let rsi = [];
        let atr = [];

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

        await tulind.indicators.atr.indicator([highPrices, lowPrices, closePrices], [20], (err, result) => {
            const diff = lengthDiff - 20;
            atr = result[0];
            atr.splice(0, diff);
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
            atr: atr[i],
        }));

        const last10Bars = tradeData.slice(tradeData.length - 15, tradeData.length);
        const last3Bars = tradeData.slice(tradeData.length - 3, tradeData.length);

        const hasRsiBeenBelow30Last10Bars = last10Bars.some((bar) => bar.rsi <= stock.rsiLow);

        const hasHistogramBeenLow = last10Bars.some((bar) => bar.histogram <= -stock.histogramHigh);
        const isHistogramMidpointReached =
            (last3Bars[2].histogram > 0 && last3Bars[1].histogram < 0) || (last3Bars[2].histogram < 0 && last3Bars[1].histogram > 0);

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        const buySignal = hasHistogramBeenLow && hasRsiBeenBelow30Last10Bars && isHistogramMidpointReached;
        // const sellSignal = hasHistogramBeenHigh && hasRsiBeenAbove70Last10Bars && isHistogramMidpointReached && priceAboveAvgPrice;

        const openOrders = await client.getOpenOrders(stock.symbol);

        if (buySignal && openOrders.length === 0) {
            console.log(chalk.cyan(`Buy signal reached - ${stock.symbol}`));
            if (!this.stockWaitlist.includes(stock.symbol)) {
                await this.buyStock(mostRecentData, stock, isBacktest);
            }
        } else if (
            openOrders.length > 0 &&
            openOrders[0].stopPrice < mostRecentData.close - mostRecentData.atr * stock.stopLossMultiplier
        ) {
            await this.setStopLimit(mostRecentData, stock);
        }
    }

    async buyStock(item, stock) {
        this.stockWaitlist.push(stock.symbol);

        const balance = await client.getAccountBalance();
        let qty = stock.minQty;

        while (qty * item.close * 0.9 < stock.minNotional * this.getPriceModifier(stock, item.atr)) {
            qty += stock.stepSize;
        }

        if (qty * item.close < stock.minNotional) {
            console.log(
                chalk.red(
                    `Buy validation failed. MinNotional not reached. Amount is ${qty * item.close} and minNotional is ${stock.minNotional}`
                )
            );
            this.stockWaitlist = this.stockWaitlist.filter((x) => x !== stock.symbol);
            return false;
        }

        if (qty * item.close > balance) {
            console.log(
                chalk.red(`Buy validation failed. Not enough balance (${balance}) to buy - ${stock.symbol} at price ${qty * item.close}`)
            );
            this.stockWaitlist = this.stockWaitlist.filter((x) => x !== stock.symbol);
            return false;
        }

        await client.createBuyOrder(item, qty, stock);
        await client.createOcoSellOrder(item, qty, stock);

        console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}`));
        console.log("Remaining balance", balance);

        await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        this.stockWaitlist = this.stockWaitlist.filter((x) => x !== stock.symbol);

        return true;
    }

    async setStopLimit(item, stock, isBacktest) {
        const positions = await client.getPositions(item.symbol);
        const positionWithTicker = positions && positions.length > 0 ? positions[0] : null;

        if (positionWithTicker && positionWithTicker.free > 0 && positionWithTicker.free * item.close > stock.minNotional) {
            let qty = stock.minQty;

            while (qty < positionWithTicker.free) {
                qty += stock.stepSize;
            }

            if (qty > positionWithTicker.free) qty -= stock.stepSize;

            // const buyPrice = await this.getLastBuy(item.symbol, isBacktest);
            // if (buyPrice === 0) return true;
            // console.log(chalk.yellow(buyPrice));

            // const profit = qty * item.close - buyPrice * qty;
            // console.log(`${item.symbol} profit is: ${profit}`);

            if (!isBacktest) {
                const openOrders = await client.getOpenOrders(item.symbol);
                if (openOrders.length > 0) {
                    await client.cancelOpenOrders(item.symbol);
                }

                await client.createOcoSellOrder(item, qty, stock);
            }

            console.log(chalk.green(`Setting stop limit for ${item.symbol} in quantity: ${qty}`));

            await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });
            return true;
        }

        return false;
    }

    async collectTradeData(symbol) {
        console.log(chalk.yellow("Collecting data..."));
        const csvWriter = createCsvWriter({
            path: path.resolve(`output/${symbol}.csv`),
            header: [
                { id: "close", title: "close" },
                { id: "high", title: "high" },
                { id: "low", title: "low" },
                { id: "date", title: "date" },
            ],
        });

        for (let i = 0; i < 100; i++) {
            await client.getLatestTickerData(symbol, csvWriter);
            await timeout(1000);
        }

        return new Promise((resolve, reject) => {
            try {
                fs.createReadStream(path.resolve(`output/${symbol}.csv`))
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

    async collectBackTestingData(symbol, times) {
        console.log(chalk.yellow("Collecting back test data..."));
        const csvWriter = createCsvWriter({
            path: path.resolve(`output/${symbol}_test.csv`),
            header: [
                { id: "close", title: "close" },
                { id: "high", title: "high" },
                { id: "low", title: "low" },
                { id: "date", title: "date" },
            ],
        });

        for (let i = 0; i < times; i++) {
            await client.getLatestTickerData(symbol, csvWriter);
            await timeout(1000);
        }
    }

    getPriceModifier(config, atr) {
        return config.atrMod * atr;
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

module.exports = TradingBot;
