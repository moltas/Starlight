const bodyParser = require("body-parser");
const express = require("express");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/dynamic");

const config = require("./config");
const TradingBot = require("./tradingBot");
const BinanceClient = require("./binanceClient");

const app = express();
const port = 5000;

app.use(bodyParser.json({ strict: false }));

let intervalObj = {};

const client = new BinanceClient();

app.get("/start", async (req, res) => {
    const promiseArray = [];

    config.forEach((item) => {
        const promise = new Promise((resolve) => {
            const strategy = new TradingBot(client);
            intervalObj[item.symbol] = setIntervalAsync(async () => {
                await strategy.run(item);
                resolve();
            }, 5000);
        });

        promiseArray.push(promise);
    });

    Promise.all(promiseArray);

    res.send("Trading started");
});

const strategy = new TradingBot();
strategy.run(config[1]);

app.get("/stop", (req, res) => {
    config.forEach((item) => {
        clearIntervalAsync(intervalObj[item.symbol]);
    });

    res.send("Trading stopped");
});

// app.listen(port, () => console.log(`Running at port:${port}`));
