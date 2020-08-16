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

const purchaseTypes = {
    BREAKTHROUGH: "breakthrough",
    CROSSING: "crossing",
};

class TradingBot {
    constructor(client) {
        this.client = client;
        this.hasStockBeenSold = true;
        this.configInitialized = false;
        this.tradingData = [];
        this.buySignal = "";
        this.sellSignal = false;

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
            dates.push(moment.unix(bar.time).utc().format("YYYY-MM-DD HH:mm"));
        });

        const ichimoku = new Ichimoku(highPrices, lowPrices, closePrices);
        const ichimokuResult = ichimoku.getResults();
        const inchimokuData = ichimokuResult.data.slice(0, ichimokuResult.startIndex);

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

        const last10Bars = tradeData.slice(-10);

        const hasRsiBeenBelow30Last10Bars = last10Bars.some((bar) => bar.rsi <= stock.rsiLow);
        const hasRsiBeenAbove70Last10Bars = last10Bars.some((bar) => bar.rsi >= stock.rsiHigh);

        const mostRecentData = tradeData[tradeData.length - 1];

        await writeToFile(stock, mostRecentData);

        const {
            isBullishCloudComing,
            isBearishCloudComing,
            kumoCloudBeneathPrice,
            tenkanCrossedKijunUp,
            tenkanCrossedKijunDown,
            chikouSpanTouchesPrice,
            chikouSpanLong,
            isCloudThin,
            priceCrossedKijunSupport,
            cloudBreakthroughUp,
        } = this.getIchimokuSignals(tradeData, ichimokuResult);

        // const openOrders = await this.client.getOpenOrders(stock.symbol);

        if (cloudBreakthroughUp && isBullishCloudComing) {
            this.buySignal = purchaseTypes.BREAKTHROUGH;
        } else if (tenkanCrossedKijunUp && isBullishCloudComing && kumoCloudBeneathPrice) {
            this.buySignal = purchaseTypes.CROSSING;
        }

        // console.log(
        //     `${tenkanCrossedKijun && chalk.green(tenkanCrossedKijun)}, ${!isCloudThin && chalk.green(!isCloudThin)}, ${
        //         isBullishCloudComing && chalk.green(isBullishCloudComing)
        //     }, ${kumoCloudBeneathPrice && chalk.green(kumoCloudBeneathPrice)} - ${mostRecentData.date}`
        // );

        // breakthrough is a big risk because no bullish trend is yet established. Sell condition should be more loose

        switch (this.buySignal) {
            case purchaseTypes.BREAKTHROUGH:
                this.sellSignal = chikouSpanTouchesPrice && isBearishCloudComing;

                if (this.hasStockBeenSold) {
                    this.hasStockBeenSold = false;
                    await this.buy(mostRecentData, stock);
                }
                break;
            case purchaseTypes.CROSSING:
                this.sellSignal = chikouSpanTouchesPrice && chikouSpanLong;

                if (this.hasStockBeenSold) {
                    this.hasStockBeenSold = false;
                    await this.buy(mostRecentData, stock);
                }
                break;
            default:
                this.sellSignal = "";
        }

        if (this.sellSignal && !this.hasStockBeenSold) {
            await this.sell(mostRecentData, stock);
            this.buySignal = "";
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
            this.waitList = this.waitList.filter((x) => x !== stock.symbol);
            return false;
        }

        if (qty * item.close > balance) {
            console.log(
                chalk.red(`Buy validation failed. Not enough balance (${balance}) to buy - ${stock.symbol} at price ${qty * item.close}`)
            );
            this.waitList = this.waitList.filter((x) => x !== stock.symbol);
            return false;
        }

        await this.client.createBuyOrder(item, qty, stock);
        // await this.client.createOcoSellOrder(item, qty, stock);

        console.log(chalk.green(`Buying ${item.symbol} for price: ${parseFloat(item.close * qty).toFixed(2)}$. Timestamp: ${item.date}`));
        console.log("Remaining balance", balance);
        console.log(chalk.yellow(`${this.buySignal}`));
        console.log(item);

        // await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

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

            const openOrders = await this.client.getOpenOrders(item.symbol);
            if (openOrders.length > 0) {
                await this.client.cancelOpenOrders(item.symbol);
            }

            // await this.client.createOcoSellOrder(item, qty, stock);
            await this.client.createSellOrder(item, qty, stock);

            console.log(
                chalk.yellow(`Selling ${item.symbol} for price: ${parseFloat(item.close * qty).toFixed(2)}$. Timestamp: ${item.date}`)
            );

            // await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });

            this.hasStockBeenSold = true;
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

    getIchimokuSignals(tradeData, { data, startIndex, chikouIndex }) {
        const mostRecentData = tradeData[tradeData.length - 1];
        const { tenkan, kijun, kumo } = mostRecentData.ichimoku;

        // Kumo cloud
        const futureCloud = data.slice(startIndex + 1, data.length).map((x) => ({ ssa: x.kumo.ssa, ssb: x.kumo.ssb }));

        const isBullishCloudComing = futureCloud.slice(-1).every((x) => x.ssa > x.ssb);
        const isBearishCloudComing = futureCloud.slice(-1).every((x) => x.ssa < x.ssb);

        const last10BarsOfData = tradeData.slice(-10);
        const last5BarsOfData = tradeData.slice(-5);

        const kumoCloudBeneathPrice = last5BarsOfData.every((x) => x.ichimoku.kumo.ssa < x.close && x.ichimoku.kumo.ssb < x.close);
        const cloudThickness = parseFloat(kumo.ssa) - parseFloat(kumo.ssb);
        const isCloudThin = cloudThickness < 20 && cloudThickness > -20;

        const cloudBreakthroughUp =
            last10BarsOfData.slice(0, -4).every((x) => x.ichimoku.kumo.ssa > x.close || x.ichimoku.kumo.ssb > x.close) &&
            last10BarsOfData.slice(-2).every((x) => x.ichimoku.kumo.ssa < x.close && x.ichimoku.kumo.ssb < x.close);

        // if last 8 bars i beneath or inside cloud && last two bars are above topside of cloud

        // Tenkan & Kijun
        const last3Bars = tradeData.slice(-3);

        const tenkanCrossedKijunUp = last3Bars.slice(0, -1).every((x) => x.ichimoku.tenkan < x.ichimoku.kijun) && tenkan > kijun;
        const tenkanCrossedKijunDown = last3Bars.slice(0, -1).every((x) => x.ichimoku.tenkan > x.ichimoku.kijun) && kijun > tenkan;

        const priceCrossedKijunSupport = mostRecentData.close - kijun < -100;

        // chikouSpan signals
        const chikouLength = tradeData.length - chikouIndex;
        const { close: chikouClosePrice, ichimoku: ichimokuAtChikou } = tradeData[chikouLength];
        const last15BarsBehindChikou = tradeData.slice(chikouLength - 15, chikouLength);
        const last4BarsBehindChikou = tradeData.slice(chikouLength - 4, chikouLength);

        const chikouSpanLong = last15BarsBehindChikou.every(
            (x) =>
                x.ichimoku.chikouSpan > x.close &&
                x.ichimoku.chikouSpan > x.ichimoku.kumo.ssa &&
                x.ichimoku.chikouSpan > x.ichimoku.kumo.ssb
        );

        const chikouSpanTouchesPrice =
            last4BarsBehindChikou
                .slice(0, -1)
                .every(
                    (x) =>
                        x.ichimoku.chikouSpan > x.close &&
                        x.ichimoku.chikouSpan > x.ichimoku.kumo.ssa &&
                        x.ichimoku.chikouSpan > x.ichimoku.kumo.ssb
                ) && chikouClosePrice > ichimokuAtChikou.chikouSpan;

        return {
            isBullishCloudComing,
            isBearishCloudComing,
            kumoCloudBeneathPrice,
            tenkanCrossedKijunUp,
            tenkanCrossedKijunDown,
            chikouSpanTouchesPrice,
            chikouSpanLong,
            isCloudThin,
            priceCrossedKijunSupport,
            cloudBreakthroughUp,
        };
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
