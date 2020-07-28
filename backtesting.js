const chalk = require("chalk");
const fs = require("fs");
const csv = require("csv-parser");

const { asyncForEach } = require("./utils");

const config = require("./config");
const TradingBot = require("./tradingBot");

class BackTesting {
    constructor() {
        this.tradingData = [];
    }

    async run(symbol) {
        const tradingBot = new TradingBot();

        await this.initializedData(symbol);

        let results = {
            BTCUSDT: null,
            ETHUSDT: null,
            LTCUSDT: null,
        };

        let index = 101;

        let tradeData = this.tradingData.slice(100, this.tradingData.length - 1);

        await asyncForEach(tradeData, async () => {
            results[symbol] = await tradingBot.run(config.filter((x) => x.symbol === symbol)[0], this.tradingData.slice(0, index));
            index++;
        });

        console.log(results);
    }

    async initializedData(symbol) {
        return new Promise((resolve, reject) => {
            try {
                fs.createReadStream(`output/${symbol}_test.csv`)
                    .pipe(csv())
                    .on("data", (row) => {
                        this.tradingData.push(row);
                    })
                    .on("end", () => {
                        console.log(chalk.green("Data initialized!"));
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

// const promiseArray = [];

// config.forEach((item) => {
//     const promise = new Promise((resolve, reject) => {
//         const strategy = new TradingBot();
//         strategy
//             .collectBackTestingData(item.symbol)
//             .then(() => {
//                 console.log(chalk.green(`Fetching back testing data completed!`));
//                 resolve();
//             })
//             .catch((err) => {
//                 reject(err);
//             });
//     });

//     promiseArray.push(promise);
// });

// Promise.all(promiseArray);
