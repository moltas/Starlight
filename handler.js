const serverless = require("serverless-http");
const bodyParser = require("body-parser");
const express = require("express");
const chalk = require("chalk");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/dynamic");

const config = require("./config");
const TradingBot = require("./tradingBot");

const app = express();

app.use(bodyParser.json({ strict: false }));

app.get("/", async (req, res) => {
    const strategy = new TradingBot();

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

const promiseArray = [];
let results = {
    BTCUSDT: null,
    ETHUSDT: null,
    LTCUSDT: null,
    ADAUSDT: null,
};
console.log(results);

config.forEach((item) => {
    const promise = new Promise((resolve, reject) => {
        const strategy = new TradingBot();
        let interval = null;
        strategy
            .collectTradeData(item.symbol)
            .then(() => {
                resolve();
                interval = setIntervalAsync(async () => {
                    results[item.symbol] = await strategy.run(item);
                }, 1000);
            })
            .catch((err) => {
                clearIntervalAsync(interval);
                reject(err);
            });
    });

    promiseArray.push(promise);
});

Promise.all(promiseArray);

setInterval(() => {
    console.log(results);
}, 10000);

module.exports.trade_api = serverless(app);
