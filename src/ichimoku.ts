class Ichimoku {
    data: any[];
    highs: any;
    lows: any;
    closes: any;
    result: any[];

    constructor(high: any[], low: any[], close: any[]) {
        this.data = [];
        high.forEach((x: any, i: number) =>
            this.data.push({ high: parseFloat(high[i]), low: parseFloat(low[i]), close: parseFloat(close[i]) })
        );

        this.highs = high;
        this.lows = low;
        this.closes = close;
        this.result = [];
    }

    getResults() {
        const tenkan = this.getAverages(9);
        const kijun = this.getAverages(26);
        const kumo = this.getKumoCloud(tenkan, kijun);
        const chikou = this.getChikouSpan();

        return {
            startIndex: tenkan.length,
            chikouIndex: 26,
            data: kumo.map((x, i) => ({
                tenkan: tenkan[i] ? tenkan[i].toFixed(3) : tenkan[i],
                kijun: kijun[i] ? kijun[i].toFixed(3) : kijun[i],
                kumo: x,
                chikouSpan: chikou[i],
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

    getKumoCloud(tenkan: any[], kijun: any[]) {
        const ssa = tenkan.map((x, i) => (tenkan[i] + kijun[i]) / 2);

        const ssb = this.getAverages(52);

        const filledArray = Array.from({ length: 25 }, () => ({ ssa: 0, ssb: 0 }));
        const combined = ssa.map((x, i) => ({ ssa: x ? Number(x.toFixed(3)) : x, ssb: ssb[i] ? ssb[i].toFixed(3) : ssb[i] }));

        const result = filledArray.concat(combined);

        return result;
    }

    getChikouSpan() {
        const arr = this.closes;
        const filledArray = Array(25).fill(undefined);
        const result = arr.slice(78).concat(filledArray);

        return result;
    }
}

export default Ichimoku;
