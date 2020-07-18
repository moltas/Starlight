const serverless = require("serverless-http");
const Alpaca = require("@alpacahq/alpaca-trade-api");
const moment = require("moment");
const chalk = require("chalk");
const bodyParser = require("body-parser");
const tulind = require("tulind");
const express = require("express");
const stocks = require("./config");

const app = express();

app.use(bodyParser.json({ strict: false }));

const API_KEY = "PK1S4W9F2FWO9697KMJQ";
const API_SECRET = "eKu/STVz8d1gSc00iqm3sJiLbRVabUTgS6jU9Jh8";
const PAPER = true;

class TradingBot {
    constructor(API_KEY, API_SECRET, PAPER) {
        this.alpaca = new Alpaca({
            keyId: API_KEY,
            secretKey: API_SECRET,
            paper: PAPER,
            usePolygon: false,
        });

        this.stockWaitlist = [];
    }

    async run() {
        await this.awaitMarketOpen();

        const data = await this.alpaca.getBars("1Min", [...stocks.map((x) => x.symbol)], {
            limit: 100,
        });

        this.handleTrade(data);
    }

    async handleTrade(histData) {
        stocks.forEach(async (stock) => {
            const closePrices = [];
            const dates = [];

            histData[stock.symbol].forEach((bar) => {
                closePrices.push(bar.closePrice);
                dates.push(moment.unix(bar.startEpochTime).format("YYYY-MM-DD hh:mm"));
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
            const isHistogramTrendingUp = lastThreeBars.some(() => {
                return lastThreeBars[0].histogram > lastThreeBars[2].histogram;
            });
            // const isHistogramTrendingDown = lastThreeBars.some(() => {
            //     return lastThreeBars[0].histogram < lastThreeBars[2].histogram;
            // });

            const mostRecentData = tradeData[tradeData.length - 1];

            if (mostRecentData.macd > mostRecentData.signal && hasRsiBeenBelow30Last10Bars && isHistogramTrendingUp) {
                console.log(chalk.green("should buy"));
                console.log(mostRecentData);

                if (!this.stockWaitlist.includes(stock.symbol)) {
                    this.buyStock(mostRecentData, stock.quantity);
                    this.stockWaitlist.push(stock.symbol);
                }
            } else if (mostRecentData.macd < mostRecentData.signal && hasRsiBeenAbove70Last10Bars) {
                this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
                console.log(chalk.red("should sell"));
                console.log(mostRecentData);

                this.sellStock(stock.symbol);
            } else {
                this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
            }
        });
    }

    async awaitMarketOpen() {
        return new Promise((resolve, reject) => {
            const check = async () => {
                try {
                    let clock = await this.alpaca.getClock();
                    if (clock.is_open) {
                        resolve();
                    } else {
                        let openTime = new Date(clock.next_open.substring(0, clock.next_close.length - 6));
                        let currTime = new Date(clock.timestamp.substring(0, clock.timestamp.length - 6));
                        this.timeToClose = Math.floor((openTime - currTime) / 1000 / 60);
                        console.log(`${this.timeToClose} minutes til next market open.`);
                    }
                } catch (err) {
                    console.log(err.error.message);
                    reject();
                }
            };
            check();
        });
    }

    async buyStock(item, quantity) {
        const balance = await this.getAccountBalance();
        const onePercent = balance / 100;

        let qty = quantity;

        while (qty * item.close < onePercent) {
            qty++;
        }

        if (balance > item.close) {
            const response = await this.alpaca.createOrder({
                symbol: item.symbol, // any valid ticker symbol
                qty: qty,
                side: "buy",
                type: "stop_limit",
                time_in_force: "gtc",
                limit_price: item.close,
                stop_price: item.close * 0.95,
            });

            console.log("stock successfully bought", response);
        }
    }

    async sellStock(symbol) {
        const positions = await this.alpaca.getPositions();
        const positionWithTicker = positions.filter((pos) => pos.symbol === symbol);

        const openOrders = await this.alpaca.getOrders({
            status: "open",
            after: moment().subtract(2, "days").format("YYYY-MM-DD"),
            until: moment().format("YYYY-MM-DD"),
            limit: 200,
            direction: "asc",
        });

        if (positionWithTicker.length > 0 || openOrders.some((order) => order.symbol === symbol)) {
            try {
                const response = await this.alpaca.createOrder({
                    symbol: symbol,
                    qty: positionWithTicker[0].qty,
                    side: "sell",
                    type: "market",
                    time_in_force: "gtc",
                });
                console.log(response.status);
            } catch (error) {
                this.stockWaitlist.push(symbol);
            }
        }
    }

    async getAccountBalance() {
        const response = await this.alpaca.getAccount();

        return response.buying_power;
    }

    async getQuotePrice(symbol) {
        const {
            last: { askprice },
        } = await this.alpaca.lastQuote(symbol);
        return askprice;
    }
}

app.get("/", async (req, res) => {
    const strategy = new TradingBot(API_KEY, API_SECRET, PAPER);

    await strategy.run();

    res.send("Trade check finished");
});

// let interval;

// app.get("/start", async (req, res) => {
//     const strategy = new TradingBot(API_KEY, API_SECRET, PAPER);

//     if (interval) clearInterval(interval);

//     interval = setInterval(() => {
//         strategy.run();
//     }, 60000);

//     console.log("Trading started");

//     res.send("Trading started");
// });

// app.get("/stop", async (req, res) => {
//     if (interval) clearInterval(interval);

//     console.log("Trading stopped");

//     res.send("Trading stopped");
// });

const strategy = new TradingBot(API_KEY, API_SECRET, PAPER);

setInterval(() => {
    strategy.run();
}, 60000);

module.exports.trade_api = serverless(app);
