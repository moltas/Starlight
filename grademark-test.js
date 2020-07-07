const dataForge = require("data-forge");
require("data-forge-fs"); // For loading files.
require("data-forge-indicators"); // For the moving average indicator.
require("data-forge-plot"); // For rendering charts.
const { backtest, analyze } = require("grademark");
const moment = require("moment");

async function main() {
    console.log("Loading and preparing data.");

    let inputSeries = dataForge
        .readFileSync("./data/NVDA.csv")
        .parseCSV()
        .parseDates("date", "YYYY-MM-DD")
        .parseFloats(["open", "high", "low", "close", "adj close", "volume"])
        .setIndex("date") // Index so we can later merge on date.
        .renameSeries({ date: "time" });

    // Add whatever indicators and signals you want to your data.
    const movingAverage = inputSeries
        .deflate((bar) => bar.close) // Extract closing price series.
        .ema(9);

    inputSeries = inputSeries
        .withSeries("sma", movingAverage) // Integrate moving average into data, indexed on date.
        .skip(9); // Skip blank sma entries.

    // This is a very simple and very naive mean reversion strategy:
    const strategy = {
        entryRule: (enterPosition, args) => {
            if (args.bar.close < args.bar.sma) {
                // Buy when price is below average.
                enterPosition();
            }
        },

        exitRule: (exitPosition, args) => {
            if (args.bar.close > args.bar.sma) {
                exitPosition(); // Sell when price is above average.
            }
        },

        stopLoss: (args) => {
            // Intrabar stop loss.
            return args.entryPrice * (5 / 100); // Stop out on 5% loss from entry price.
        },
    };

    console.log("Backtesting...");

    // Backtest your strategy, then compute and print metrics:
    const trades = backtest(strategy, inputSeries);
    console.log("Made " + trades.count() + " trades!");

    trades
        .transformSeries({
            entryTime: (d) => moment(d).format("YYYY-MM-DD"),
            exitTime: (d) => moment(d).format("YYYY-MM-DD"),
        })
        .asCSV()
        .writeFileSync("./output/trades.csv");

    console.log(trades);

    const startingCapital = 1000;
    const analysis = analyze(startingCapital, trades);

    console.table(analysis);
}

main()
    .then(() => console.log("Finished"))
    .catch((err) => {
        console.error("An error occurred.");
        console.error((err && err.stack) || err);
    });
