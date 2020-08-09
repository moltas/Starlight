module.exports = [
    {
        symbol: "BTCUSDT",
        quantity: 1,
        decimals: 2,
        stepSize: 0.000001,
        minQty: 0.000001,
        minNotional: 10.0,
        rsiLow: 25,
        rsiHigh: 65,
        // histogramLow: -2.5,
        // histogramHigh: 3.0,
        histogramLow: -0.3,
        histogramHigh: 0.3,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 2,
        // atrMod: 0.05,
        atrMod: 20,
    },
    {
        symbol: "ETHUSDT",
        quantity: 1,
        decimals: 2,
        stepSize: 0.00001,
        minQty: 0.00001,
        minNotional: 10.0,
        rsiLow: 35,
        rsiHigh: 71,
        // histogramLow: -0.2,
        // histogramHigh: 0.25,
        histogramLow: -0.02,
        histogramHigh: 0.02,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 2,
        // atrMod: 15,
        atrMod: 40,
    },
    // {
    //     symbol: "LTCUSDT",
    //     quantity: 1,
    //     decimals: 2,
    //     stepSize: 0.00001,
    //     minQty: 0.00001,
    //     minNotional: 10.0,
    //     rsiLow: 35,
    //     rsiHigh: 65,
    //     histogramLow: -0.03,
    //     histogramHigh: 0.005,
    //     stopLossMultiplier: 2,
    //     stopLimitMultiplier: 2.2,
    //     takeProfitMultiplier: 2,
    //     atrMod: 40,
    // },
];
