const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");
const path = require("path");
const Ichimoku = require("./ichimoku");

const { timeout } = require("./utils");

const filePath = path.resolve(`output/trades_${moment().format("YYYY-MM-DD")}.json`);

class TradingBot {
    constructor(client) {
        this.client = client;
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
            await this.client.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            if (backtestData) {
                this.tradingData = backtestData;
            } else {
                const data = await this.client.getLatestTickerData(config.symbol);
                this.tradingData = data;
            }

            await this.handleTrade(config, this.tradingData, !!backtestData);
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject(errMsg);
        }

        return this.getResults();
    }

    async handleTrade(stock, histData) {
        const closePrices = [];
        const highPrices = [];
        const lowPrices = [];
        const dates = [];
        const lengthDiff = 53;

        histData.forEach((bar) => {
            closePrices.push(bar.close);
            highPrices.push(bar.high);
            lowPrices.push(bar.low);
            dates.push(bar.time);
        });

        const ichimoku = new Ichimoku(highPrices, lowPrices, closePrices);
        const { data, startIndex } = ichimoku.getResults();

        const futureCloud = data.slice(startIndex + 1, data.length).map((x) => ({ ssa: x.kumu.ssa, ssb: x.kumu.ssb }));

        const isBullishCloudComing = !futureCloud.some((x) => x.ssa < x.ssb);
        const isBearishCloudComing = futureCloud.some((x) => x.ssa < x.ssb);

        const inchimokuData = data.slice(0, startIndex);

        let rsi = [];
        let atr = [];

        await tulind.indicators.rsi.indicator([closePrices], [14], (err, result) => {
            const diff = lengthDiff - 14;
            rsi = result[0];
            rsi.splice(0, diff);
        });

        await tulind.indicators.atr.indicator([highPrices, lowPrices, closePrices], [20], (err, result) => {
            const diff = lengthDiff - 19;
            atr = result[0];
            atr.splice(0, diff);
        });

        closePrices.splice(0, lengthDiff);
        highPrices.splice(0, lengthDiff);
        lowPrices.splice(0, lengthDiff);
        dates.splice(0, lengthDiff);
        histData.splice(0, lengthDiff);

        const tradeData = histData.map((x, i) => ({
            symbol: stock.symbol,
            date: dates[i],
            close: closePrices[i],
            high: highPrices[i],
            low: lowPrices[i],
            rsi: rsi[i],
            atr: atr[i],
            ichimoku: inchimokuData[i],
        }));

        console.log("ichimoku", inchimokuData.length);
        console.log("tradeData", tradeData.length);

        const last10Bars = tradeData.slice(tradeData.length - 10, tradeData.length);
        const last3Bars = tradeData.slice(tradeData.length - 3, tradeData.length);

        const hasRsiBeenBelow30Last10Bars = last10Bars.some((bar) => bar.rsi <= stock.rsiLow);
        const hasRsiBeenAbove70Last10Bars = last10Bars.some((bar) => bar.rsi >= stock.rsiHigh);

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        console.log(mostRecentData);

        await writeToFile(stock, mostRecentData);

        const { tenkan, kijun, kumu } = mostRecentData.ichimoku;

        const kumuCloudBeneathPrice = kumu.ssa < mostRecentData.close && kumu.ssb < mostRecentData.close;
        const tenkanCrossedKijun = tenkan > kijun && last3Bars[0].ichimoku.tenkan < last3Bars[0].ichimoku.kijun;
        const kijunCrossedTenkan = kijun > tenkan && last3Bars[0].ichimoku.kijun < last3Bars[0].ichimoku.tenkan;

        const buySignal = kumuCloudBeneathPrice && tenkanCrossedKijun && isBullishCloudComing;
        const sellSignal = kijunCrossedTenkan;

        const openOrders = await this.client.getOpenOrders(stock.symbol);

        if (buySignal && openOrders.length === 0) {
            if (!this.stockWaitlist.includes(stock.symbol)) {
                this.stockWaitlist.push(stock.symbol);
                await this.buy(mostRecentData, stock);
            }
        } else if (sellSignal) {
            await this.sell(mostRecentData, stock);
        }
    }

    async buy(item, stock) {
        const balance = await this.client.getAccountBalance();
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

        await this.client.createBuyOrder(item, qty, stock);
        // await this.client.createOcoSellOrder(item, qty, stock);

        console.log(chalk.green(`Buying ${item.symbol} for price: ${item.close * qty}$. Timestamp: ${item.date}`));
        console.log("Remaining balance", balance);
        console.log(item);

        // await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        // this.stockWaitlist = this.stockWaitlist.filter((x) => x !== stock.symbol);

        return true;
    }

    async sell(item, stock) {
        const positions = await this.client.getPositions(item.symbol);
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

            const openOrders = await this.client.getOpenOrders(item.symbol);
            if (openOrders.length > 0) {
                await this.client.cancelOpenOrders(item.symbol);
            }

            // await this.client.createOcoSellOrder(item, qty, stock);
            await this.client.createSellOrder(item, qty, stock);

            console.log(chalk.yellow(`Selling ${item.symbol} for price: ${item.close * qty}$. Timestamp: ${item.date}`));

            // await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });

            this.stockWaitlist = this.stockWaitlist.filter((x) => x !== stock.symbol);
            return true;
        }

        return false;
    }

    getPriceModifier(config, atr) {
        return config.atrMod * atr;
    }

    getResults() {
        return this.client.getResults();
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
