import bodyParser from "body-parser";
import express from "express";
import { setIntervalAsync, clearIntervalAsync } from "set-interval-async/dynamic";

import config from "./config";
import TradingBot from "./tradingBot";
import BinanceClient from "./clients/binanceClient";
import BinanceClientMocked from "./clients/binanceClient_mocked";
import { ConfigItem } from "./model";

const app = express();
const port = 5000;

app.use(bodyParser.json({ strict: false }));

let intervalObj = {};

app.get("/start", async (req, res) => {
    const promiseArray = [];

    config.forEach((item: ConfigItem) => {
        // const client = new BinanceClient();
        const testClient = new BinanceClientMocked(item.symbol);

        const promise = new Promise((resolve) => {
            const strategy = new TradingBot(testClient);
            intervalObj[item.symbol] = setIntervalAsync(async () => {
                await strategy.run(item);
                resolve();
            }, 30000);
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
