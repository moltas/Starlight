const serverless = require("serverless-http");
const bodyParser = require("body-parser");
const express = require("express");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/dynamic");

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

const strategy = new TradingBot();

setIntervalAsync(async () => {
    await strategy.run();
}, 500);

// strategy.run();

module.exports.trade_api = serverless(app);
