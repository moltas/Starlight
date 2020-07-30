const moment = require("moment");
const chalk = require("chalk");
const tulind = require("tulind");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");
var path = require("path");

const { mergeObjectsInUnique, timeout, getRequest, postRequest, deleteRequest } = require("./utils");

const filePath = path.resolve("output/trades.json");

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

    async collectTradeData(symbol) {
        console.log(chalk.yellow("Collecting data..."));
        const csvWriter = createCsvWriter({
            path: path.resolve(`output/${symbol}.csv`),
            header: [
                { id: "symbol", title: "symbol" },
                { id: "close", title: "close" },
                { id: "date", title: "date" },
            ],
        });

        for (let i = 0; i < 100; i++) {
            await this.getLatestTickerData(symbol, csvWriter);
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

    async run(config, backtestData) {
        if (!this.configInitialized && !backtestData) {
            await this.getExchangeData(config);
            this.configInitialized = true;
        }

        try {
            if (backtestData) {
                this.tradingData = backtestData;
            } else {
                const latestTickerData = await this.getLatestTickerData(config.symbol);
                this.tradingData.push(latestTickerData);
            }

            await this.handleTrade(config, this.tradingData, !!backtestData);
        } catch (error) {
            const errMsg = error.message;
            console.log(errMsg);
            return Promise.reject();
        }

        return this.results();
    }

    async handleTrade(stock, histData, isBacktest) {
        const shortenedHistData = histData.slice(histData.length - 100, histData.length);
        const closePrices = [];
        const dates = [];

        shortenedHistData.forEach((bar) => {
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
        const isHistogramMidpointReached =
            (last3Bars[2].histogram > 0 && last3Bars[1].histogram < 0) || (last3Bars[2].histogram < 0 && last3Bars[1].histogram > 0);

        const mostRecentData = tradeData[tradeData.length - 1];
        if (!mostRecentData) return;

        // const avgPrice = await this.getCurrentAvgPrice(stock.symbol);
        // let priceAboveAvgPrice = avgPrice < mostRecentData.close;
        // let priceBelowAvgPrice = avgPrice > mostRecentData.close;

        const buySignal = hasHistogramBeenLow && hasRsiBeenBelow30Last10Bars && isHistogramMidpointReached;
        const sellSignal = hasHistogramBeenHigh && hasRsiBeenAbove70Last10Bars && isHistogramMidpointReached;

        if (buySignal) {
            console.log(chalk.cyan(`Buy signal reached - ${stock.symbol}`));
            if (!this.stockWaitlist.includes(stock.symbol)) {
                const stockBought = await this.buyStock(mostRecentData, stock, isBacktest);
                if (stockBought) this.stockWaitlist.push(stock.symbol);
            }
        } else if (sellSignal) {
            console.log(chalk.cyan(`Sell signal reached - ${stock.symbol}`));
            const stockSold = await this.sellStock(mostRecentData, stock, isBacktest);
            if (stockSold) this.stockWaitlist = this.stockWaitlist.filter((x) => x != stock.symbol);
        }
    }

    async buyStock(item, stock, isBacktest) {
        const balance = await this.getAccountBalance(isBacktest);
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
            // await this.createTakeProfitLimitOrder(item, qty, stock);
            await this.createStopLimitOrder(item, qty, stock);
        }

        console.log(chalk.green(`buying ${item.symbol} in quantity: ${qty}`));
        console.log("Remaining balance", balance);

        await writeToFile(stock, { side: "buy", price: item.close, qty: qty, amount: qty * item.close, date: item.date });

        this.numberOfTrades += 1;

        return true;
    }

    async sellStock(item, stock, isBacktest) {
        const positions = await this.getPositions(item.symbol, isBacktest);
        const positionWithTicker = positions && positions.length > 0 ? positions[0] : null;

        if (positionWithTicker && positionWithTicker.free > 0 && positionWithTicker.free * item.close > stock.minNotional) {
            let qty = stock.minQty;

            while (qty < positionWithTicker.free) {
                qty += stock.stepSize;
            }

            if (qty > positionWithTicker.free) qty -= stock.stepSize;

            if (!isBacktest) {
                const openOrders = await this.getOpenOrders(item.symbol);
                if (openOrders.length > 0) {
                    await this.cancelOpenOrders(item.symbol);
                }
            }

            const buyPrice = await this.getLastBuy(item.symbol, isBacktest);
            const profit = qty * item.close - buyPrice * qty;
            console.log(`${item.symbol} profit is: ${profit}`);

            if (profit > 0.01) {
                if (!isBacktest) await this.createSellOrder(item, qty, stock);

                console.log(chalk.green(`selling ${item.symbol} in quantity: ${qty}`));
                this.totalProfit += profit;
                this.numberOfTrades += 1;
                this.amountOwned = this.amountOwned - qty;
                this.amountOwned = this.amountOwned < 0 ? 0 : this.amountOwned;
                this.balance += qty * item.close;
                await writeToFile(stock, { side: "sell", close: item.close, qty: qty, amount: qty * item.close, date: item.date });
                return true;
            }
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

    async createStopLimitOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        return await postRequest(
            "order",
            `symbol=${item.symbol}&side=SELL&type=STOP_LOSS_LIMIT&timeInForce=gtc&quantity=${quantity.toFixed(config.precision)}&price=${(
                item.close * config.stopLimitMultiplier
            ).toFixed(config.decimals)}&stopPrice=${(item.close * config.stopLossMultiplier).toFixed(
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
            ).toFixed(config.decimals)}&stopPrice=${(item.close * 1.025).toFixed(config.decimals)}&timestamp=${timeInMilliseconds}`,
            isSigned
        );
    }

    async createSellOrder(item, quantity, config) {
        const timeInMilliseconds = moment().valueOf();
        const isSigned = true;
        const price = parseFloat(item.close * config.takeProfitMultiplier);
        const stopPrice = parseFloat(item.close * config.stopLossMultiplier);
        const stopLimitPrice = parseFloat(item.close * config.stopLimitMultiplier);

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
        const data = await getRequest("ticker/price", `symbol=${symbol}`);
        const formattedData = { symbol: data.symbol, close: data.price, date: moment().format("YYYY-MM-DD HH:mm:ss") };

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

    async collectBackTestingData(symbol, times) {
        console.log(chalk.yellow("Collecting back test data..."));
        const csvWriter = createCsvWriter({
            path: path.resolve(`output/${symbol}_test.csv`),
            header: [
                { id: "symbol", title: "symbol" },
                { id: "close", title: "close" },
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
