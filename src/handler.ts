import bodyParser from "body-parser";
import express from "express";
import cors from "cors";
import { setIntervalAsync, clearIntervalAsync } from "set-interval-async/dynamic";
import fs from "fs";
import csv from "csv-parser";
import path from "path";
import { fromUnixTime, format } from "date-fns";

import config from "./config";
import TradingBot from "./tradingBot";
import BinanceClient from "./clients/binanceClient";
import BinanceClientMocked from "./clients/binanceClient_mocked";
import { ConfigItem } from "./model";
import { asyncForEach } from "./utils";

const app = express();
const port = 8000;

app.use(bodyParser.json({ strict: false }));
app.use(cors());

let intervalObj = {};

app.get("/start", async (req, res) => {
    const promiseArray = [];

    config.forEach((item: ConfigItem) => {
        const client = new BinanceClient();
        // const testClient = new BinanceClientMocked(item.symbol);

        const promise = new Promise((resolve) => {
            const strategy = new TradingBot(client);
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

app.get("/graphData", async (req, res) => {
    try {
        const data = [];

        const promise = new Promise((resolve, reject) => {
            fs.createReadStream(`data/BTCUSDT_15m.csv`)
                .pipe(csv())
                .on("data", (row: any) => {
                    data.push(row);
                })
                .on("end", () => {
                    resolve();
                });
        });

        await promise;

        const onlyClosePrices = data.map((x) => ({ close: x.close, time: format(fromUnixTime(x.time), "yyyy-MM-dd H:m") }));

        const baselinePrice = onlyClosePrices[0].close;

        // starting value 10000
        // close price * amount

        const pricesAsPercentageOfBaseline = onlyClosePrices.map((x) => {
            const fraction = x.close - baselinePrice;
            const percentage = fraction / baselinePrice;
            const valueAsPercentage = (percentage * 100).toFixed(1);

            return { gain: valueAsPercentage, time: x.time };
        });

        let totalGain = onlyClosePrices.slice(-1)[0].close - baselinePrice;
        totalGain = totalGain / baselinePrice;

        res.send({
            gain: pricesAsPercentageOfBaseline.map((x) => x.gain),
            time: pricesAsPercentageOfBaseline.map((x) => x.time),
            totalGain: totalGain,
        });
    } catch (err) {
        res.send(err);
    }
});

app.listen(port, () => console.log(`Running at port:${port}`));
