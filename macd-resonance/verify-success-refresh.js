#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { refreshSnapshot } = require("./research-success");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "macd-success-refresh-"));
try {
  fs.mkdirSync(path.join(root, "data"));
  fs.copyFileSync(path.join(__dirname, "index.html"), path.join(root, "index.html"));
  const names = ["latest", "history-15", "history-101", "history-102"];
  for (const name of names) fs.copyFileSync(path.join(__dirname, "data", name + ".json"), path.join(root, "data", name + ".json"));
  const current = refreshSnapshot(root);
  const file = path.join(root, "analysis-data.json"), original = fs.readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(original), current);
  refreshSnapshot(root);
  assert.equal(fs.readFileSync(file, "utf8"), original, "Same inputs produce the same archive");

  // Truncate real archived OHLC to an earlier observed session, then restore it.
  const minute = current.coverage.find(row => row.period === "15");
  const previousDay = current.coverage.find(row => row.period === "15").to.slice(0, 10);
  for (const name of names) {
    const input = path.join(root, "data", name + ".json"), data = JSON.parse(fs.readFileSync(input));
    data.generated_at_utc = previousDay + "T00:00:00+00:00";
    for (const index of data.data) for (const [period, bars] of Object.entries(index)) {
      if (Array.isArray(bars)) index[period] = bars.filter(bar => bar.t.slice(0, 10) < previousDay);
    }
    fs.writeFileSync(input, JSON.stringify(data));
  }
  const earlier = refreshSnapshot(root);
  assert.equal(earlier.asOf, previousDay + "T08:00");
  assert(earlier.coverage.find(row => row.period === "15").bars < minute.bars);
  assert.notDeepEqual(earlier.sources, current.sources);
  for (const name of names) fs.copyFileSync(path.join(__dirname, "data", name + ".json"), path.join(root, "data", name + ".json"));
  assert.deepEqual(refreshSnapshot(root), current, "Restoring actual inputs restores all statistics");
  fs.writeFileSync(path.join(root, "data", "history-15.json"), '{}');
  assert.throws(() => refreshSnapshot(root), /Incomplete market data/);
  assert.equal(fs.readFileSync(file, "utf8"), original, "Failed calculation must retain the last valid snapshot");
  console.log("SUCCESS_REFRESH_PASS: archive cutoff, new OHLC, reproducibility and failed-write preservation");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
