import fs from "fs";
import csv from "csv-parser";
import { fromUnixTime, format, getTime, getUnixTime } from "date-fns";
import { asyncForEach, timeout } from "./utils";

import config from "./config";
import TradingBot from "./tradingBot";

import BinanceClientMocked from "./clients/binanceClient_mocked";

class BackTesting {
    async run(symbol: string) {
        const client = new BinanceClientMocked(symbol);
        const tradingBot = new TradingBot(client);
        let tradingData: { close: string; high: string; low: string; time: number }[] = [];

        const startTime = getTime(new Date("2020-05-01"));
        const endTime = getTime(new Date("2020-10-01"));
        let newStartTime = startTime;

        do {
            const response = await client.getLatestTickerData(symbol, "30m", newStartTime, endTime, 1000);
            tradingData = tradingData.concat(response);
            newStartTime = tradingData[tradingData.length - 1].time * 1000;
        } while (newStartTime < endTime);

        let results = null;

        await asyncForEach(tradingData, async (x: any, i: number) => {
            const slice = tradingData.slice(i, i + 200);

            if (slice.length === 200) {
                results = await tradingBot.run(config.filter((x: any) => x.symbol === symbol)[0], slice);
            }
        });

        console.log("results: ", results);
    }
}

const testing = new BackTesting();
testing.run("BTCUSDT");
// testing.run("ETHUSDT");
// testing.run("LTCUSDT");
// testing.run("LINKUSDT");
