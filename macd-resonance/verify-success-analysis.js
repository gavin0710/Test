#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { buildSnapshot, readSeries } = require("./research-success");
const { bounds, day, evaluate, groups, horizons, summarize } = require("./analysis-metrics");
const published = require("./analysis-data.json");

const actual = buildSnapshot(__dirname, published.asOf);
const { series, engine } = readSeries(__dirname, published.asOf);
if (published.sources.every((source, i) => source.sha256 === actual.sources[i].sha256)) {
  assert.deepEqual(actual, published, "Pinned inputs must reproduce the deployed snapshot");
}
assert.equal(actual.coverage.length, 24);
assert.equal(actual.indices.length, 4);
assert.equal(actual.samples.length, new Set(actual.samples.map(row => [row.index, row.period, row.signal, row.time].join("/"))).size);

function matchesFirstNine(bars, at, signal) {
  const s = signal === "buy" ? -1 : 1;
  const same = i => i >= 4 && Math.sign(bars[i].c - bars[i - 4].c) === s;
  return [0, 1, 2].find(age => at - age >= 12 && !same(at - age - 9) &&
    Array.from({ length: 9 }, (_, j) => same(at - age - j)).every(Boolean)) ?? null;
}

for (const row of actual.samples) {
  const v = series[row.index][row.period].result, { barIndex: at, signal, time } = row;
  assert.equal(v.bars[at].t, time);
  assert.equal(v.bars[at].c, row.close);
  assert.equal(row.nineAge, matchesFirstNine(v.bars, at, signal), "First nine uses only prior closes");
  assert(row.covered >= 1 && row.covered <= 4);
  assert(row.matched >= 1 && row.matched <= row.covered);
  assert.deepEqual(row.forward, horizons.map(n => {
    const bar = v.bars[at + n];
    return bar ? [bar.t, bar.c] : null;
  }));
  if (signal === "buy") {
    const trade = v.trades.find(t => t.entryType === "buy" && t.entryI === at);
    assert.deepEqual(row.exit, trade ? [trade.exitT, trade.exitClose, trade.exitType] : null);
  } else {
    assert.equal(row.exit, null);
  }

  // Replay the signal with only the bars actually available at the anchor.
  const bars = v.bars.slice(0, at + 1), closes = bars.map(bar => bar.c);
  const fast = engine.ema(closes, 12), slow = engine.ema(closes, 26);
  const dif = fast.map((ema, i) => ema - slow[i]);
  const dea = engine.ema(dif, 9), hist = dif.map((value, i) => 2 * (value - dea[i]));
  const base = engine.scanStructure(bars, dif, hist);
  const prefix = engine.analyzeLifecycle(bars, dif, hist, base.events, { enableCorrectionStop: true });
  assert(prefix.events.some(event => event.i === at && event.type === signal), "Signal requires no future bars");

  let covered = 0, matched = 0;
  const times = bars.slice(-3).map(b => b.t).join("/");
  for (const peer of series) {
    const p = peer[row.period].result;
    const i = p?.bars.findIndex(b => b.t === time);
    if (i < 2 || i === undefined || p.bars.slice(i - 2, i + 1).map(b => b.t).join("/") !== times) continue;
    covered++;
    const types = signal === "buy" ? engine.BUY_EVENTS : engine.SELL_EVENTS;
    if (p.events.some(e => types.has(e.type) && e.i >= i - 2 && e.i <= i)) matched++;
  }
  assert.deepEqual([row.covered, row.matched], [covered, matched]);
}

for (const scope of ["all", "four", "same"]) for (const mode of ["trade", "buy", "sell"]) for (const horizon of horizons) {
  const rows = evaluate(published, { scope, mode, horizon, index: "all" });
  const common = bounds(published.coverage);
  for (const { id } of published.periods) {
    const group = rows.filter(x => x.period === id);
    const summary = summarize(group);
    assert.equal(summary.evaluated + summary.pending, group.length);
    assert.equal(summary.rate, summary.evaluated ? summary.wins / summary.evaluated : null);
    assert.equal(group.filter(groups.nine.includes).length + group.filter(groups.noNine.includes).length, group.length);
    assert.equal(group.filter(groups.single.includes).length + group.filter(groups.resonance.includes).length,
      group.filter(x => x.covered === 4).length);
    assert(group.every(x => x.minutes === null || x.minutes > 0));
    if (scope === "same") {
      assert(group.every(x => day(x.time) >= common.from && day(x.time) <= common.to));
      assert(group.every(x => !x.outcome || day(x.outcome[0]) <= common.to), "Shared window censors later outcomes");
    }
  }
}
console.log("MACD_SUCCESS_ANALYSIS_PASS", JSON.stringify({ series: published.coverage.length, samples: published.samples.length, asOf: published.asOf }));
