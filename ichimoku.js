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
            startIndex: tenkan.length,
            data: kumu.map((x, i) => ({
                tenkan: tenkan[i] ? tenkan[i].toFixed(3) : tenkan[i],
                kijun: kijun[i] ? kijun[i].toFixed(3) : kijun[i],
                kumu: x,
            })),
        };
    }

    getAverages(period) {
        let highs = [...this.highs];
        let lows = [...this.lows];

        let arr = [];

        this.highs.slice(53, this.highs.length).forEach(() => {
            let highestHigh = highs.slice(-period).reduce((a, b) => Math.max(a, b));
            let lowestLow = lows.slice(-period).reduce((a, b) => Math.min(a, b));
            let result = (highestHigh + lowestLow) / 2;

            arr.push(result);

            highs.pop();
            lows.pop();
        });

        return arr.reverse();
    }

    getKumuCloud(tenkan, kijun) {
        const ssa = tenkan.map((x, i) => (tenkan[i] + kijun[i]) / 2);

        const ssb = this.getAverages(52);

        const filledArray = Array.from({ length: 25 }, () => ({ ssa: 0, ssb: 0 }));
        const combined = ssa.map((x, i) => ({ ssa: x, ssb: ssb[i] }));

        const result = filledArray.concat(combined);

        return result;
    }
}

module.exports = Ichimoku;
