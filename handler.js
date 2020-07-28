const bodyParser = require("body-parser");
const express = require("express");
const chalk = require("chalk");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/dynamic");

const config = require("./config");
const TradingBot = require("./tradingBot");

const app = express();
const port = 3000;

app.use(bodyParser.json({ strict: false }));

let intervalObj = {};

app.get("/", async (req, res) => {
    const promiseArray = [];
    let results = {
        BTCUSDT: null,
        ETHUSDT: null,
        LTCUSDT: null,
    };
    console.log(results);

    config.forEach((item) => {
        const promise = new Promise((resolve, reject) => {
            const strategy = new TradingBot();
            strategy
                .collectTradeData(item.symbol)
                .then(() => {
                    resolve();
                    intervalObj[item.symbol] = setIntervalAsync(async () => {
                        results[item.symbol] = await strategy.run(item);
                    }, 1000);
                })
                .catch((err) => {
                    clearIntervalAsync(intervalObj[item.symbol]);
                    reject(err);
                });
        });

        promiseArray.push(promise);
    });

    Promise.all(promiseArray);

    res.send("Trading started");
});

app.get("/stop", (req, res) => {
    config.forEach((item) => {
        clearIntervalAsync(intervalObj[item.symbol]);
    });

    res.send("Trading stopped");
});

app.listen(port, () => console.log(`Running at port:${port}`));
