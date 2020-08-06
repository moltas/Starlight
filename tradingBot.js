const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");
var path = require("path");

const { mergeObjectsInUnique, timeout, getRequest, postRequest, deleteRequest } = require("./utils");

const filePath = path.resolve(`output/trades_${moment().format("YYYY-MM-DD")}.json`);

class TradingBot {
    constructor() {
        this.stockWaitlist = [];
        this.configInitialized = false;
        this.numberOfTrades = 0;
        this.totalProfit = 0;
        this.tradingData = [];
        this.positions = [];
        this.balance = 300;
        this.amountOwned = 0;

        const fileContent = {
            BTCUSDT: [],
            ETHUSDT: [],
            LTCUSDT: [],
        };
        fs.writeFile(filePath, JSON.stringify(fileContent), () => {
            console.log("Resetting file");
        });
    }

    results() {
        return {
            numberOfTrades: this.numberOfTrades,
            totalProfits: this.totalProfit,
            amountOwned: this.amountOwned,
            balance: this.balance,
        };
    }

    async run(config, backtestData) {
        if (!this.configInitialized && !backtestData) {
            await this.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            if (backtestData) {
                this.tradingData = backtestData;
            } else {
                const tradingData = await this.getLatestTickerData(config.symbol);
                this.tradingData = tradingData;
            }

            await this.handleTrade(config, this.tradingData, !!backtestData);
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject(errMsg);
        }

        return this.results();
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
        const hasRsiBeenAbove70Last10Bars = last10Bars.some((bar) => bar.rsi >= stock.rsiHigh);

        const hasHistogramBeenHigh = last10Bars.some((bar) => bar.histogram >= stock.histogramHigh);
        const hasHistogramBeenLow = last10Bars.some((bar) => bar.histogram <= -stock.histogramHigh);
        const isHistogramMidpointReached =
            (last3Bars[2].histogram > 0 && last3Bars[1].histogram < 0) || (last3Bars[2].histogram < 0 && last3Bars[1].histogram > 0);

        const isPriceTrendingUp = last3Bars[2] > last3Bars[0];

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        // const avgPrice = await this.getCurrentAvgPrice(stock.symbol, tradeData, isBacktest);
        // let priceAboveAvgPrice = avgPrice < mostRecentData.close;
        // let priceBelowAvgPrice = avgPrice > mostRecentData.close;

        const buySignal = hasHistogramBeenLow && hasRsiBeenBelow30Last10Bars && isHistogramMidpointReached;
        // const sellSignal = hasHistogramBeenHigh && hasRsiBeenAbove70Last10Bars && isHistogramMidpointReached && priceAboveAvgPrice;

        const openOrders = await this.getOpenOrders(stock.symbol);

        if (buySignal && openOrders.length === 0) {
            console.log(chalk.cyan(`Buy signal reached - ${stock.symbol}`));
            if (!this.stockWaitlist.includes(stock.symbol)) {
                await this.buyStock(mostRecentData, stock, isBacktest);
                this.stockWaitlist.push(stock.symbol);
            }
        }
        // } else if (sellSignal) {
        //     console.log(chalk.cyan(`Sell signal reached - ${stock.symbol}`));
        //     await this.sellStock(mostRecentData, stock, isBacktest);
        //     this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
        else if (isPriceTrendingUp && openOrders.length > 0 && openOrders[0].price < mostRecentData.close) {
            await this.setStopLimit(mostRecentData, stock, isBacktest);
        }
    }

    async buyStock(item, stock, isBacktest) {
        this.stockWaitlist.push(stock.symbol);

        const balance = await this.getAccountBalance(isBacktest);
        let qty = stock.minQty;

        while (qty * item.close * 0.9 < stock.minNotional * 2) {
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

        if (isBacktest) {
            this.positions.push({ price: item.close, qty: qty, amount: item.close * qty });
            this.amountOwned += qty;
            this.balance -= item.close * qty;
        } else {
            await this.createBuyOrder(item, qty, stock);
            await this.createStopLimitOrder(item, qty, stock);
        }

        console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}`));
        console.log("Remaining balance", balance);

        await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        this.numberOfTrades += 1;

        this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
        return true;
    }

    async setStopLimit(item, stock, isBacktest) {
        const positions = await this.getPositions(item.symbol, isBacktest);
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
                const openOrders = await this.getOpenOrders(item.symbol);
                if (openOrders.length > 0) {
                    await this.cancelOpenOrders(item.symbol);
                }

                await this.createStopLimitOrder(item, qty, stock);
            }

            this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);

            console.log(chalk.green(`Setting stop limit for ${item.symbol} in quantity: ${qty}`));
            // this.totalProfit += profit;
            // this.numberOfTrades += 1;
            // this.amountOwned = this.amountOwned - qty;
            // this.amountOwned = this.amountOwned < 0 ? 0 : this.amountOwned;
            // this.balance += qty * item.close;
            await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });
            return true;
        }

        return false;
    }

    async getAccountBalance(isBacktest) {
        if (isBacktest) return this.balance;

        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const { balances } = await getRequest("account", `timestamp=${timeInMilliseconds}`, isSigned);
        const obj = balances.filter((coin) => coin.asset === "USDT");
        return obj[0].free;
    }

    async getPositions(symbol, isBacktest) {
        if (isBacktest) {
            if (symbol) {
                return [{ free: this.amountOwned }];
            }
            return [{ free: 0 }];
        }

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

    async getCurrentAvgPrice(symbol, priceData, isBacktest) {
        if (isBacktest) {
            let totalAmount = 0;
            priceData.forEach((x) => (totalAmount += parseFloat(x.close)));
            return totalAmount / priceData.length;
        }

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

    async createTakeProfitLimitOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        console.log(`close price: ${item.close}`);
        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=BUY&type=TAKE_PROFIT_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(config.precision)}&price=${(
                item.close * config.takeProfitMultiplier
            ).toFixed(config.decimals)}&stopPrice=${(item.close * 1.002).toFixed(config.decimals)}&timestamp=${timeInMilliseconds}`,
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

    async getLastBuy(symbol, isBacktest) {
        if (isBacktest) {
            let totalAmount = 0;
            this.positions.forEach((x) => (totalAmount += parseFloat(x.amount)));
            this.positions = [];
            return totalAmount;
        }

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

        // for (let i = 0; i < 100; i++) {
        //     await this.getLatestTickerData(symbol, csvWriter);
        //     await timeout(1000);
        // }

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
            await this.getLatestTickerData(symbol, csvWriter);
            await timeout(1000);
        }
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
