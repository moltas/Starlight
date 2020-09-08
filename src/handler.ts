import bodyParser from "body-parser";
import express from "express";
import { setIntervalAsync, clearIntervalAsync } from "set-interval-async/dynamic";
import fs from "fs";
import path from "path";

import config from "./config";
import TradingBot from "./tradingBot";
import BinanceClient from "./clients/binanceClient";
import BinanceClientMocked from "./clients/binanceClient_mocked";
import { ConfigItem } from "./model";
import { asyncForEach } from "./utils";

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

app.get("/data", async (req, res) => {
    try {
        const symbols = ["BTCUSDT", "ETHUSDT", "LTCUSDT", "LINKUSDT"];
        const data = {};

        await asyncForEach(symbols, async (symbol: string) => {
            const filepath = path.resolve(`output/${symbol}_backtest.json`);
            const fileContent = await fs.promises.readFile(filepath, "utf-8");
            const fileObj = JSON.parse(fileContent);
            data[symbol] = fileObj;
        });

        res.send(data);
    } catch (err) {
        res.send(err);
    }
});

app.listen(port, () => console.log(`Running at port:${port}`));
