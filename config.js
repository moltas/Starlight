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
        histogramLow: -0.5,
        histogramHigh: 0.2,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 3.5,
        atrMod: 0.1,
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
        histogramLow: -0.03,
        histogramHigh: 0.02,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 3.5,
        atrMod: 30,
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
