import moment from "moment";
import chalk from "chalk";
import tulind from "tulind";
import fs from "fs";
// const createCsvWriter = require("csv-writer").createObjectCsvWriter;
// import { createObjectCsvWriter } from "csv-writer";
import csv from "csv-parser";
import path from "path";
import Ichimoku from "./ichimoku";

import { TradeItem, OpenOrderResponse } from "./model/index";

const filePath = path.resolve(`output/trades_${moment().format("YYYY-MM-DD")}.json`);

const purchaseTypes = {
    BREAKTHROUGH: "breakthrough",
    CROSSING: "crossing",
    BOUNCE: "bounce",
};

class TradingBot {
    client: any;
    hasStockBeenSold: boolean;
    configInitialized: boolean;
    tradingData: any[];
    buySignal: string;
    sellSignal: boolean;

    constructor(client: any) {
        this.client = client;
        this.hasStockBeenSold = true;
        this.configInitialized = false;
        this.tradingData = [];

        this.buySignal = "";
        this.sellSignal = false;

        console.log(chalk.yellow("Starting..."));
    }

    async run(config: any, backtestData?: any) {
        if (!this.configInitialized && !backtestData) {
            await this.client.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            if (backtestData) {
                this.tradingData = backtestData;
            } else {
                const data = await this.client.getLatestTickerData(config.symbol, "15m");
                this.tradingData = data;
            }

            const { isBullish, timestamp } = await this.handleTrade(config, this.tradingData, false);

            if (isBullish) {
                if (backtestData) {
                    const result = await getTradeDataFromFile(config, timestamp);
                    await this.handleTrade(config, result);
                } else {
                    const tradeData = await this.client.getLatestTickerData(config.symbol, "5m");
                    await this.handleTrade(config, tradeData);
                }
            }
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject(errMsg);
        }

        return this.getResults();
    }

    async handleTrade(stock: any, histData: any, doTrade = true) {
        const closePrices: number[] = [];
        const highPrices: number[] = [];
        const lowPrices: number[] = [];
        const dates: string[] = [];
        let rsi: number[];
        let atr: number[];
        const lengthDiff = 53;

        histData.forEach((bar: { close: number; high: number; low: number; time: any }) => {
            closePrices.push(bar.close);
            highPrices.push(bar.high);
            lowPrices.push(bar.low);
            dates.push(moment.unix(bar.time).utc().format("YYYY-MM-DD HH:mm"));
        });

        const ichimoku = new Ichimoku(highPrices, lowPrices, closePrices);
        const ichimokuResult = ichimoku.getResults();
        const inchimokuData = ichimokuResult.data.slice(0, ichimokuResult.startIndex);

        await tulind.indicators.rsi.indicator([closePrices], [14], (err: string, result: any[]) => {
            const diff = lengthDiff - 14;
            rsi = result[0];
            rsi.splice(0, diff);
        });

        await tulind.indicators.atr.indicator([highPrices, lowPrices, closePrices], [20], (err: any, result: number[][]) => {
            const diff = lengthDiff - 19;
            atr = result[0];
            atr.splice(0, diff);
        });

        closePrices.splice(0, lengthDiff);
        highPrices.splice(0, lengthDiff);
        lowPrices.splice(0, lengthDiff);
        dates.splice(0, lengthDiff);
        histData.splice(0, lengthDiff);

        const tradeData = histData.map((x: any, i: number) => ({
            symbol: stock.symbol,
            date: dates[i],
            close: closePrices[i],
            high: highPrices[i],
            low: lowPrices[i],
            rsi: rsi[i],
            atr: atr[i],
            ichimoku: inchimokuData[i],
        }));

        const last10Bars = tradeData.slice(-20);

        const hasRsiBeenBelow30Last10Bars = last10Bars.some((bar: { rsi: number }) => bar.rsi <= stock.rsiLow);
        const hasRsiBeenAbove70Last10Bars = last10Bars.some((bar: { rsi: number }) => bar.rsi >= stock.rsiHigh);

        const mostRecentData = tradeData.slice(-1)[0];

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
            bounceOffCloudSupport,
            isTrendReversalComing,
        } = this.getIchimokuSignals(tradeData, ichimokuResult);

        const openOrders = await this.client.getOpenOrders(stock.symbol);

        if (openOrders.length > 0) {
            const limitMakerOrder: OpenOrderResponse = openOrders.filter((x: OpenOrderResponse) => x.type === "LIMIT_MAKER")[0];
            const stopLossOrder: OpenOrderResponse = openOrders.filter((x: OpenOrderResponse) => x.type === "STOP_LOSS_LIMIT")[0];

            if (limitMakerOrder.price <= mostRecentData.close) {
                this.client.sellOrder(stock.symbol, limitMakerOrder.amount, limitMakerOrder.origQty);
            }

            if (stopLossOrder.stopPrice >= mostRecentData.close) {
                this.client.sellOrder(stock.symbol, stopLossOrder.amount, stopLossOrder.origQty);
            }
        }

        let isBullishTrend = openOrders.length === 0 ? isBullishCloudComing : true;

        if (doTrade) {
            if (tenkanCrossedKijunUp && chikouSpanLong && kumoCloudBeneathPrice) {
                this.buySignal = purchaseTypes.CROSSING;
            } else if (cloudBreakthroughUp && isTrendReversalComing) {
                this.buySignal = purchaseTypes.BREAKTHROUGH;
                stock.takeProfitMultiplier = 3;
            } else if (bounceOffCloudSupport) {
                // this.buySignal = purchaseTypes.BOUNCE;
            }

            switch (this.buySignal) {
                case purchaseTypes.BREAKTHROUGH:
                    this.sellSignal = chikouSpanTouchesPrice;

                    if (openOrders.length === 0) {
                        await this.buy(mostRecentData, stock);
                    }
                    break;
                case purchaseTypes.CROSSING:
                    this.sellSignal = tenkanCrossedKijunDown;

                    if (openOrders.length === 0) {
                        await this.buy(mostRecentData, stock);
                    }
                    break;
                case purchaseTypes.BOUNCE:
                    this.sellSignal = chikouSpanTouchesPrice;

                    if (openOrders.length === 0) {
                        await this.buy(mostRecentData, stock);
                    }
                    break;
                default:
                    this.sellSignal = false;
            }

            if (this.sellSignal && openOrders.length > 0) {
                await this.sell(mostRecentData, stock);
                this.buySignal = "";
            }
        }

        return { isBullish: isBullishTrend, timestamp: mostRecentData.date };
    }

    async buy(
        item: { close: number; atr: any; symbol: any; date: any },
        stock: { minQty: any; minNotional: number; stepSize: any; symbol: any }
    ) {
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
            return false;
        }

        if (qty * item.close > balance) {
            console.log(
                chalk.red(`Buy validation failed. Not enough balance (${balance}) to buy - ${stock.symbol} at price ${qty * item.close}`)
            );
            return false;
        }

        await this.client.createBuyOrder(item, qty, stock);
        await this.client.createOcoSellOrder(item, qty, stock);

        console.log(
            chalk.green(`Buying ${item.symbol} for price: ${parseFloat(String(item.close * qty)).toFixed(2)}$. Timestamp: ${item.date}`)
        );
        console.log("Remaining balance", balance);
        console.log(chalk.yellow(`${this.buySignal}`));
        console.log(item);

        // await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        return true;
    }

    async sell(item: { symbol: any; close: number; date: any }, stock: { minNotional: number; minQty: any; stepSize: number }) {
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

            await this.client.createSellOrder(item, qty, stock);

            console.log(
                chalk.yellow(
                    `Selling ${item.symbol} for price: ${parseFloat(String(item.close * qty)).toFixed(2)}$. Timestamp: ${item.date}`
                )
            );

            // await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });

            this.hasStockBeenSold = true;
            return true;
        }

        return false;
    }

    getPriceModifier(config: any, atr: number) {
        return config.atrMod * atr;
    }

    getResults() {
        return this.client.getResults();
    }

    getIchimokuSignals(tradeData: TradeItem[], { data, startIndex, chikouIndex }: any) {
        const mostRecentData = tradeData[tradeData.length - 1];
        const { tenkan, kijun, kumo } = mostRecentData.ichimoku;

        // Kumo cloud
        const futureCloud = data
            .slice(startIndex + 1, data.length)
            .map((x: { kumo: { ssa: any; ssb: any } }) => ({ ssa: x.kumo.ssa, ssb: x.kumo.ssb }));
        const last10BarsOfData: TradeItem[] = tradeData.slice(-10);
        const last5BarsOfData: TradeItem[] = tradeData.slice(-5);
        const last3Bars: TradeItem[] = tradeData.slice(-3);

        const isBullishCloudComing = futureCloud.slice(-1).every((x: { ssa: number; ssb: number }) => x.ssa > x.ssb);
        const isBearishCloudComing = futureCloud.slice(-1).every((x: { ssa: number; ssb: number }) => x.ssa < x.ssb);

        const isBullishCloud = last5BarsOfData.every(
            (x: { ichimoku: { kumo: { ssa: number; ssb: number } } }) => x.ichimoku.kumo.ssa > x.ichimoku.kumo.ssb
        );
        const isBearishCloud = last5BarsOfData.every(
            (x: { ichimoku: { kumo: { ssa: number; ssb: number } } }) => x.ichimoku.kumo.ssa < x.ichimoku.kumo.ssb
        );

        const kumoCloudBeneathPrice = isBullishCloud
            ? last5BarsOfData.every((x: { ichimoku: { kumo: { ssa: number } }; close: number }) => x.ichimoku.kumo.ssa < x.close)
            : last5BarsOfData.every((x: { ichimoku: { kumo: { ssb: number } }; close: number }) => x.ichimoku.kumo.ssb < x.close);
        const cloudThickness = parseFloat(kumo.ssa) - parseFloat(kumo.ssb);
        const isCloudThin = cloudThickness < 20 && cloudThickness > -20;

        const cloudBreakthroughUp =
            last10BarsOfData
                .slice(0, -4)
                .every(
                    (x: { ichimoku: { kumo: { ssa: number; ssb: number } }; close: number }) =>
                        x.ichimoku.kumo.ssa > x.close && x.ichimoku.kumo.ssb > x.close
                ) &&
            last10BarsOfData
                .slice(-2)
                .every(
                    (x: { ichimoku: { kumo: { ssa: number; ssb: number } }; close: number }) =>
                        x.ichimoku.kumo.ssa < x.close && x.ichimoku.kumo.ssb < x.close
                );

        const bounceOffCloudSupport =
            last10BarsOfData[0].close > last10BarsOfData[3].close &&
            last10BarsOfData[last10BarsOfData.length - 1].close > last10BarsOfData[last10BarsOfData.length - 2].close &&
            mostRecentData.close > mostRecentData.ichimoku.kumo.ssb &&
            last10BarsOfData.some(
                (x: { close: number; ichimoku: { kumo: { ssb: number; ssa: number } } }) =>
                    Math.abs(x.close - x.ichimoku.kumo.ssb) < 0.4 || Math.abs(x.close - x.ichimoku.kumo.ssa) < 0.4
            );

        const isTrendReversalComing = isBearishCloud && isBullishCloudComing;

        // Tenkan & Kijun

        const tenkanCrossedKijunUp = last10BarsOfData.some(
            (x: { ichimoku: { tenkan: number; kijun: number } }) => x.ichimoku.tenkan > x.ichimoku.kijun
        );

        const tenkanCrossedKijunDown =
            last3Bars.slice(0, -1).every((x: { ichimoku: { tenkan: number; kijun: number } }) => x.ichimoku.tenkan > x.ichimoku.kijun) &&
            kijun > tenkan;

        const priceCrossedKijunSupport = mostRecentData.close - kijun < -100;

        // chikouSpan signals
        const chikouLength = tradeData.length - chikouIndex;
        const { close: chikouClosePrice, ichimoku: ichimokuAtChikou } = tradeData[chikouLength];
        const last5BarsBehindChikou = tradeData.slice(chikouLength - 5, chikouLength);
        const last4BarsBehindChikou = tradeData.slice(chikouLength - 4, chikouLength);

        const chikouSpanLong = last5BarsBehindChikou.every(
            (x: { ichimoku: { chikouSpan: number; kumo: { ssa: number; ssb: number } }; close: number }) =>
                x.ichimoku.chikouSpan > x.close &&
                x.ichimoku.chikouSpan > x.ichimoku.kumo.ssa &&
                x.ichimoku.chikouSpan > x.ichimoku.kumo.ssb
        );

        const chikouSpanTouchesPrice =
            last4BarsBehindChikou
                .slice(0, -1)
                .every(
                    (x: { ichimoku: { chikouSpan: number; kumo: { ssa: number; ssb: number } }; close: number }) =>
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
            bounceOffCloudSupport,
            isTrendReversalComing,
        };
    }
}

async function getTradeDataFromFile(stock: { symbol: any }, timestamp: any) {
    if (!stock.symbol) return;

    let data: any[] = [];
    let unixTime = moment(timestamp).unix();

    return new Promise((resolve) => {
        fs.createReadStream(`data/BINANCE_${stock.symbol}_5.csv`)
            .pipe(csv())
            .on("data", (row: any) => {
                data.push(row);
            })
            .on("end", () => {
                const filteredData = data
                    .filter((x) => {
                        return x.time <= unixTime;
                    })
                    .slice(-200);
                resolve(filteredData);
            });
    });
}

async function writeToFile(stock: { symbol: string }, obj: any) {
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

export default TradingBot;
