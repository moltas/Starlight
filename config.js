module.exports = [
    {
        symbol: "BTCUSDT",
        decimals: 2,
        stepSize: 0.000001,
        minQty: 0.000001,
        minNotional: 10.0,
        rsiLow: 35,
        rsiHigh: 65,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 4,
        // atrMod: 0.05,
        atrMod: 0.5,
    },
    {
        symbol: "ETHUSDT",
        decimals: 2,
        stepSize: 0.00001,
        minQty: 0.00001,
        minNotional: 10.0,
        rsiLow: 35,
        rsiHigh: 71,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 8,
        // atrMod: 15,
        atrMod: 10,
    },
    {
        symbol: "LTCUSDT",
        decimals: 2,
        stepSize: 0.00001,
        minQty: 0.00001,
        minNotional: 10.0,
        rsiLow: 35,
        rsiHigh: 65,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 8,
        atrMod: 10,
    },
    {
        symbol: "LINKUSDT",
        decimals: 2,
        stepSize: 0.00001,
        minQty: 0.00001,
        minNotional: 10.0,
        rsiLow: 30,
        rsiHigh: 65,
        stopLossMultiplier: 2,
        stopLimitMultiplier: 2.2,
        takeProfitMultiplier: 8,
        atrMod: 10,
    },
];
