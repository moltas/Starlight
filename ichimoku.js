class Ichimoku {
    constructor(high, low, close) {
        this.data = [];
        high.forEach((x, i) => this.data.push({ high: parseFloat(high[i]), low: parseFloat(low[i]), close: parseFloat(close[i]) }));

        this.highs = high;
        this.lows = low;
        this.closes = close;
        this.result = [];
    }

    getResults() {
        const tenkan = this.getAverages(9);
        const kijun = this.getAverages(26);
        const kumu = this.getKumuCloud(tenkan, kijun);

        return {
            startIndex: tenkan.length - 1,
            data: kumu.map((x, i) => ({
                tenkan: tenkan[i] ? tenkan[i].toFixed(3) : tenkan[i],
                kijin: kijun[i] ? kijun[i].toFixed(3) : kijun[i],
                kumu: x,
            })),
        };
    }

    getAverages(period) {
        const arr = [];

        let periodIndex = period;

        for (let i in this.data.slice(52, this.data.length)) {
            let highestHigh = this.highs.slice(i, periodIndex).reduce((a, b) => Math.max(a, b));
            let lowestLow = this.lows.slice(i, periodIndex).reduce((a, b) => Math.min(a, b));
            let result = (highestHigh + lowestLow) / 2;

            arr.push(result);

            periodIndex++;
        }

        return arr;
    }

    getKumuCloud(tenkan, kijun) {
        const ssa = tenkan.map((x, i) => (tenkan[i] + kijun[i]) / 2);
        const ssb = this.getAverages(52);

        const filledArray = Array.from({ length: 26 }, () => ({ ssa: 0, ssb: 0, trend: "" }));
        const combined = ssa.map((x, i) => ({ ssa: x.toFixed(3), ssb: ssb[i].toFixed(3), trend: x > ssb[i] ? "bullish" : "bearish" }));

        const result = filledArray.concat(combined);

        return result;
    }
}

module.exports = Ichimoku;
