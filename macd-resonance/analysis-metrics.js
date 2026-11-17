/* Shared by the analysis page and its reproducible research scripts. */
"use strict";

const SuccessAnalysis = (() => {
  const horizons = [5, 10, 20];
  const groups = {
    all: { label: "全部信号", includes: () => true },
    single: { label: "单指", includes: row => row.covered === 4 && row.matched === 1 },
    resonance: { label: "同向 ≥2 指", includes: row => row.covered === 4 && row.matched >= 2 },
    noNine: { label: "无同向 9", includes: row => row.nineAge === null },
    nine: { label: "有同向 9", includes: row => row.nineAge !== null },
    both: { label: "共振且有 9", includes: row => groups.resonance.includes(row) && groups.nine.includes(row) },
    resonanceOnly: { label: "共振、无 9", includes: row => groups.resonance.includes(row) && groups.noNine.includes(row) },
    nineOnly: { label: "单指、有 9", includes: row => groups.single.includes(row) && groups.nine.includes(row) },
    neither: { label: "单指、无 9", includes: row => groups.single.includes(row) && groups.noNine.includes(row) }
  };
  const day = time => time.slice(0, 10);
  const toMillis = time => Date.parse((time.length === 10 ? time + "T15:00" : time) + "+08:00");

  function bounds(coverage) {
    if (!coverage.length) return null;
    const from = coverage.map(row => day(row.from)).sort().at(-1);
    const to = coverage.map(row => day(row.to)).sort()[0];
    return from <= to ? { from, to } : null;
  }

  function sampleRange(data, period, scope) {
    if (scope === "all") return { from: "0000-01-01", to: day(data.asOf) };
    return bounds(scope === "same" ? data.coverage : data.coverage.filter(row => row.period === period));
  }

  function evaluate(data, options) {
    const { mode, index, scope, horizon } = options;
    const ranges = Object.fromEntries(data.periods.map(({ id }) => [id, sampleRange(data, id, scope)]));
    return data.samples.flatMap(sample => {
      const range = ranges[sample.period], signalDay = day(sample.time);
      if (!range || signalDay < range.from || signalDay > range.to ||
          (index !== "all" && sample.index !== index) ||
          sample.signal !== (mode === "sell" ? "sell" : "buy")) return [];
      const observed = mode === "trade" ? sample.exit : sample.forward[horizons.indexOf(horizon)];
      const outcome = observed && day(observed[0]) <= range.to ? observed : null;
      const result = outcome ? (outcome[1] / sample.close - 1) * (mode === "sell" ? -100 : 100) : null;
      const minutes = outcome ? (toMillis(outcome[0]) - toMillis(sample.time)) / 60000 : null;
      return [{ ...sample, outcome, result, minutes }];
    });
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    if (!sorted.length) return null;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function summarize(rows) {
    const evaluated = rows.filter(row => row.result !== null);
    const wins = evaluated.filter(row => row.result > 0).length;
    return {
      total: rows.length,
      evaluated: evaluated.length,
      pending: rows.length - evaluated.length,
      wins,
      signalDays: new Set(evaluated.map(row => day(row.time))).size,
      rate: evaluated.length ? wins / evaluated.length : null,
      medianMove: median(evaluated.map(row => row.result)),
      medianMinutes: median(evaluated.map(row => row.minutes))
    };
  }

  return { bounds, day, evaluate, groups, horizons, sampleRange, summarize };
})();

if (typeof module === "object" && module.exports) module.exports = SuccessAnalysis;
