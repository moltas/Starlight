const Alpaca = require("@alpacahq/alpaca-trade-api");
const moment = require("moment");
const chalk = require("chalk");
// const fs = require("fs");
// const csv = require("csv-parser");
// const macd =  require('macd');
const tulind = require("tulind");

const stocks = require("./config");

// const API_KEY = "4f77d94b25b9e99c0b5cd4e8d55d10b2";
// const API_SECRET = "af5147b34468881bff4e1b33e2bcc7965156a3cc";
const API_KEY = "PKE6U90O58RBUBF7IZBJ";
const API_SECRET = "DCtc6YzLefkgfsYA/yR4soCYnaezgju8QIeq2JLD";
const PAPER = true;

class MovingAverage {
    constructor(API_KEY, API_SECRET, PAPER) {
        this.alpaca = new Alpaca({
            keyId: API_KEY,
            secretKey: API_SECRET,
            paper: PAPER,
            usePolygon: false,
        });

        // place stock here when bought and remove when signal changes
        this.stockWaitlist = [];
    }

    async run() {
        // await this.awaitMarketOpen();

        console.log(this.stockWaitlist);

        const data = await this.alpaca.getBars("1Min", [...stocks.map((x) => x.symbol)], { start: "2020-05-20", end: "2020-05-21" });

        this.handleTrade(data);
    }

    async handleTrade(histData) {
        stocks.forEach(async (stock) => {
            let stockPriceData;
            let closePrices = [];
            let dates = [];

            for (let stock in histData) {
                closePrices = histData[stock].map((bar) => bar.closePrice);
                dates = histData[stock].map((bar) => moment.unix(bar.startEpochTime).format("YYYY-MM-DD hh:mm"));
            }

            console.log(stockPriceData);

            let macdLine;
            let signalLine;
            let histogram;

            const lengthDiff = tulind.indicators.macd.start([12, 26, 9]);
            dates.splice(0, lengthDiff);

            let rsi;

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
            const isHistogramTrendingDown = lastThreeBars.some(() => {
                return lastThreeBars[0].histogram < lastThreeBars[2].histogram;
            });

            const mostRecentData = tradeData[tradeData.length - 1];

            // console.log(chalk.yellow(`-- ${stock.symbol} --`));

            if (mostRecentData.macd > mostRecentData.signal && hasRsiBeenBelow30Last10Bars && isHistogramTrendingUp) {
                console.log(chalk.green("should buy"));
                console.log(mostRecentData);

                if (!this.stockWaitlist.includes(stock.symbol)) {
                    this.buyStock(mostRecentData, stock.quantity);
                    this.stockWaitlist.push(stock.symbol);
                }
            } else if (mostRecentData.macd < mostRecentData.signal && hasRsiBeenAbove70Last10Bars && isHistogramTrendingDown) {
                this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);

                console.log(chalk.red("should sell"));
                console.log(mostRecentData);

                this.sellStock(stock.symbol);
            } else {
                this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
            }
        });
    }

    async backtest() {
        // read csv file
        // get close price and date
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
                        setTimeout(check, 60000);
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
        const balance = this.getAccountBalance();
        const onePercent = balance / 100;

        let qty = quantity;

        while (qty * item.close < onePercent) {
            qty++;
        }

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

        console.log(openOrders);

        if (positionWithTicker.length > 0) {
            const response = await this.alpaca.createOrder({
                symbol: symbol,
                qty: positionWithTicker[0].qty,
                side: "sell",
                type: "market",
                time_in_force: "gtc",
            });
            console.log(response.status);
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

const app = new MovingAverage(API_KEY, API_SECRET, PAPER);

// setInterval(() => {
//     app.run();
// }, 60000);

app.run();

// app.simulate();
