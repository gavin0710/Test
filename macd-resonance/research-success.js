#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { horizons } = require("./analysis-metrics.js");

function loadArchive(root) {
  const names = ["latest", "history-15", "history-101", "history-102"];
  return Object.fromEntries(names.map(name => {
    const source = fs.readFileSync(path.join(root, "data", name + ".json"));
    const payload = JSON.parse(source);
    if (!Array.isArray(payload.data) || payload.data.length !== 4) {
      throw new Error("Incomplete market data: " + name);
    }
    const sha256 = createHash("sha256").update(source).digest("hex");
    return [name, { ...payload, sha256 }];
  }));
}

function loadEngine(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
  const end = script.indexOf('byId("refresh").onclick=load;');
  if (end < 0) throw new Error("Could not isolate the chart engine");
  return vm.runInNewContext(script.slice(0, end) +
    ";({ IDX, PERIODS, calculate, completedPeriodBars, mergeHistoricalBars, BUY_EVENTS, SELL_EVENTS, ema, scanStructure, analyzeLifecycle })");
}

function readSeries(root, asOf) {
  const archive = loadArchive(root);
  const engine = loadEngine(root);
  const { IDX, PERIODS, calculate, completedPeriodBars, mergeHistoricalBars } = engine;
  const periods = Array.from(PERIODS, ([id, label]) => ({ id, label }));
  const indices = Array.from(IDX, ({ name }) => name);
  const series = indices.map((_, index) => {
    const recent = archive.latest.data[index];
    const raw = { "60": recent["60"] };
    for (const id of ["15", "101", "102"]) {
      const history = archive["history-" + id].data[index]?.[id];
      if (!Array.isArray(history) || !history.length) throw new Error("Missing archive series " + index + ":" + id);
      raw[id] = mergeHistoricalBars(history, recent[id]);
    }
    const completed = completedPeriodBars(raw, asOf);
    return Object.fromEntries(periods.map(({ id }) => [id, {
      bars: completed[id], result: calculate(completed[id])
    }]));
  });
  const sources = Object.entries(archive).map(([name, source]) => ({
    file: "data/" + name + ".json", generatedAt: source.generated_at_utc, sha256: source.sha256
  }));
  return { periods, indices, series, sources, engine };
}

function signalIndex(series, engine) {
  const signals = { buy: new Set(), sell: new Set() };
  for (const event of series.result?.events || []) {
    if (engine.BUY_EVENTS.has(event.type)) signals.buy.add(event.i);
    if (engine.SELL_EVENTS.has(event.type)) signals.sell.add(event.i);
  }
  const observed = series.result ? series.bars : [];
  return { bars: observed, signals, at: new Map(observed.map((bar, i) => [bar.t, i])) };
}

function resonance(event, anchorBars, peers) {
  let matched = 0, covered = 0;
  for (const peer of peers) {
    const at = peer.at.get(event.t);
    // A different or missing timestamp could make a two-bar lookback span a gap.
    if (at === undefined || at < 2 ||
        peer.bars[at - 1].t !== anchorBars[event.i - 1]?.t ||
        peer.bars[at - 2].t !== anchorBars[event.i - 2]?.t) continue;
    covered++;
    const signals = peer.signals[event.type];
    if ([at, at - 1, at - 2].some(i => signals.has(i))) matched++;
  }
  return { matched, covered };
}

function nineAge(nine, index, direction) {
  const target = direction === "buy" ? -9 : 9;
  for (let age = 0; age <= 2 && age <= index; age++) {
    const i = index - age;
    if (nine[i] === target && nine[i - 1] !== target) return age;
  }
  return null;
}

function buildSnapshot(root, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(asOf)) {
    throw new Error("Use a Beijing time in YYYY-MM-DDTHH:mm format");
  }
  const { periods, indices, series, sources, engine } = readSeries(root, asOf);
  const coverage = [], samples = [];
  for (const { id: period } of periods) {
    const peers = series.map(index => signalIndex(index[period], engine));
    for (const [index, data] of series.entries()) {
      const { bars, result } = data[period];
      if (!bars.length) throw new Error("No historical bars for " + index + ":" + period);
      coverage.push({
        period, index, from: bars[0].t, to: bars.at(-1).t, bars: bars.length,
        sessions: new Set(bars.map(bar => bar.t.slice(0, 10))).size
      });
      if (!result) continue;
      const exits = new Map(result.trades.filter(trade => trade.entryType === "buy")
        .map(trade => [trade.entryI, trade]));
      for (const event of result.events) {
        if (event.type !== "buy" && event.type !== "sell") continue;
        const at = event.i, signal = event.type;
        const trade = signal === "buy" ? exits.get(at) : null;
        samples.push({
          period, index, signal, time: event.t, close: bars[at].c, barIndex: at,
          ...resonance(event, bars, peers),
          nineAge: nineAge(result.nine, at, signal),
          exit: trade ? [trade.exitT, trade.exitClose, trade.exitType] : null,
          forward: horizons.map(n => bars[at + n] ? [bars[at + n].t, bars[at + n].c] : null)
        });
      }
    }
  }
  return { asOf, periods, indices, coverage, sources, samples };
}

function serializeSnapshot(snapshot) {
  // One observation per line keeps archive changes easy to inspect in a diff.
  const { samples, ...metadata } = snapshot;
  const head = JSON.stringify(metadata, null, 2).slice(0, -2);
  return head + ',\n  "samples": [\n' +
    samples.map(sample => "    " + JSON.stringify(sample)).join(",\n") + "\n  ]\n}\n";
}

function refreshSnapshot(root) {
  const archive = loadArchive(root);
  const timestamps = Object.values(archive).map(source => Date.parse(source.generated_at_utc));
  if (!timestamps.every(Number.isFinite)) throw new Error("Missing archive generation timestamp");
  // Archive time, rather than the runner's clock, defines what was observable.
  const asOf = new Date(Math.max(...timestamps) + 8 * 3600000).toISOString().slice(0, 16);
  const snapshot = buildSnapshot(root, asOf);
  const output = path.join(root, "analysis-data.json"), body = serializeSnapshot(snapshot);
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== body) {
    const temporary = output + ".tmp";
    fs.writeFileSync(temporary, body);
    fs.renameSync(temporary, output);
  }
  return snapshot;
}

if (require.main === module) {
  const date = process.argv[2];
  if (date === "--refresh") {
    const snapshot = refreshSnapshot(__dirname);
    console.log("SUCCESS_SNAPSHOT_REFRESHED", snapshot.asOf, snapshot.samples.length);
  } else {
    if (!date) throw new Error("Usage: node research-success.js YYYY-MM-DD[THH:mm] | --refresh");
    const asOf = date.length === 10 ? date + "T23:59" : date;
    process.stdout.write(serializeSnapshot(buildSnapshot(__dirname, asOf)));
  }
}

module.exports = { buildSnapshot, readSeries, nineAge, resonance, refreshSnapshot };
