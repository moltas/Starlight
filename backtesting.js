const bodyParser = require("body-parser");
const express = require("express");
const chalk = require("chalk");
const fs = require("fs");
const csv = require("csv-parser");

const { asyncForEach } = require("./utils");

const config = require("./config");
const TradingBot = require("./tradingBot");

const BinanceClientMocked = require("./binanceClient_mocked");

const app = express();
const port = 5050;

app.use(bodyParser.json({ strict: false }));

const client = new BinanceClientMocked();

class BackTesting {
    constructor() {
        this.tradingData = [];
    }

    async run(symbol) {
        const tradingBot = new TradingBot(client);

        await this.initializedData(symbol);

        let results = null;

        await asyncForEach(this.tradingData, async (x, i) => {
            const slice = this.tradingData.slice(i, i + 200);

            if (slice.length === 200) {
                results = await tradingBot.run(config.filter((x) => x.symbol === symbol)[0], slice);
            }
        });

        console.log("results: ", results);
    }

    async initializedData(symbol) {
        return new Promise((resolve, reject) => {
            try {
                fs.createReadStream(`data/BTCUSDT_30m.csv`)
                    .pipe(csv())
                    .on("data", (row) => {
                        this.tradingData.push(row);
                    })
                    .on("end", () => {
                        resolve();
                    });
            } catch (error) {
                reject(error);
            }
        });
    }
}

const testing = new BackTesting();
testing.run("BTCUSDT");
