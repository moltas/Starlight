import fs from "fs";
import csv from "csv-parser";
import { asyncForEach } from "./utils";

import config from "./config";
import TradingBot from "./tradingBot";

import BinanceClientMocked from "./clients/binanceClient_mocked";

class BackTesting {
    tradingData: any[];

    constructor() {
        this.tradingData = [];
    }

    async run(symbol: string) {
        const client = new BinanceClientMocked(symbol);
        const tradingBot = new TradingBot(client);

        await this.initializedData(symbol);

        let results = null;

        await asyncForEach(this.tradingData, async (x: any, i: number) => {
            const slice = this.tradingData.slice(i, i + 200);

            if (slice.length === 200) {
                results = await tradingBot.run(config.filter((x: any) => x.symbol === symbol)[0], slice);
            }
        });

        console.log("results: ", results);
    }

    async initializedData(symbol: string) {
        return new Promise((resolve, reject) => {
            try {
                fs.createReadStream(`data/BINANCE_${symbol}_15_3.csv`)
                    .pipe(csv())
                    .on("data", (row: any) => {
                        return this.tradingData.push(row);
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
// testing.run("ETHUSDT");
// testing.run("LTCUSDT");
