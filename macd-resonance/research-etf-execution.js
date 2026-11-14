#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const etfFile = process.argv[2];
assert(etfFile, "Usage: node research-etf-execution.js <Eastmoney 510210 unadjusted daily JSON>");
const start = "2011-03-25";
const cutoff = "2026-11-13"; // Corporate actions and both price series have been checked through this date.

const cashAtStart = 100_000;
const unitFraction = 0.10;
const exposureCap = 0.50;
const cashDividends = [
 {record: "2023-06-19", ex: "2023-06-20", pay: "2023-06-27", perShare: 0.076},
 {record: "2023-08-22", ex: "2023-08-23", pay: "2023-08-28", perShare: 0.036},
 {record: "2023-12-19", ex: "2023-12-20", pay: "2023-12-25", perShare: 0.063}
];
const split = {date: "2021-01-22", ratio: 5};

function dailySignalSeries() {
 const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
 const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 const cut = script?.indexOf('byId("refresh").onclick=load;');
 assert(cut > 0, "Unable to load the dashboard signal engine");
 const {calculate, completedPeriodBars, mergeHistoricalBars} = vm.runInNewContext(
  script.slice(0, cut) + ";({calculate,completedPeriodBars,mergeHistoricalBars});",
  {window: {}, document: {}, console}, {timeout: 5000}
 );
 const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
 const daily = mergeHistoricalBars(read("history-101.json").data[0]["101"], read("latest.json").data[0]["101"]);
 return calculate(completedPeriodBars({"101": daily}, cutoff + "T23:59").D);
}

const etfPayload = fs.readFileSync(etfFile);
const etfData = JSON.parse(etfPayload).data;
assert.equal(etfData?.code, "510210", "Expected Eastmoney K-lines for 510210");
const quotes = new Map();
let previousQuote = null;
for (const line of etfData.klines) {
 const [t, ...fields] = line.split(",");
 const [o, c, h, l, volume] = fields.map(Number);
 assert(/^\d{4}-\d{2}-\d{2}$/.test(t) && (!previousQuote || previousQuote.t < t), "ETF dates must be sorted and unique");
 assert([o, c, h, l, volume].every(Number.isFinite) && l > 0 && l <= Math.min(o, c) &&
  h >= Math.max(o, c) && volume >= 0, "Invalid ETF bar " + t);
 const corporateAction = cashDividends.find(x => x.ex === t);
 const previousClose = previousQuote ? previousQuote.c / (previousQuote.t < split.date && split.date <= t ? split.ratio : 1) : null;
 const reference = previousClose && previousClose - (corporateAction?.perShare || 0);
 quotes.set(t, {t, o, c, h, l, volume, reference});
 previousQuote = {t, c};
}
assert(quotes.get("2011-03-25")?.o === 2.932 && quotes.get("2021-01-21")?.c === 5.019 &&
 quotes.get("2021-01-25")?.o === 0.998, "The historical ETF prices must be unadjusted and include the 2021 split");

const signal = dailySignalSeries();
assert.equal(signal.bars.at(-1)?.t, cutoff, "Check the index data cutoff");
assert(quotes.has(cutoff), "The ETF archive must cover the same cutoff");
const calendar = signal.bars.map(b => b.t).filter(t => t >= start);
const calendarDates = new Set(calendar);
for (const t of quotes.keys()) {
 if (t >= start && t <= cutoff) assert(calendarDates.has(t), "ETF quote has no matching index session " + t);
}

const ordersByDate = new Map();
const allLegs = [...signal.trades, ...signal.positions].sort((a, b) => a.entryI - b.entryI || a.campaignI - b.campaignI);
const legId = leg => leg.structureId + "@" + leg.entryT;
const parentId = (structureId, exitI) => structureId + "@" + signal.bars[exitI].t;
function addOrder(t, order) {
 if (!ordersByDate.has(t)) ordersByDate.set(t, []);
 ordersByDate.get(t).push(order);
}
for (const leg of allLegs) {
 if (leg.entryT < start) continue;
 const id = legId(leg);
 const parent = leg.entryType === "correctionBuy" ? parentId(leg.structureId, leg.correctionFromExitI) : null;
 addOrder(leg.entryT, {id, side: "buy", parent, type: leg.entryType});
 if (leg.exitT) addOrder(leg.exitT, {
  id, side: "sell", parent: leg.exitType === "topSell" ? parentId(leg.structureId, leg.exitI) : null,
  type: leg.exitType
 });
}

const money = value => Number(value.toFixed(2));
const tick = value => Math.round((value + 1e-10) * 1000) / 1000;
const pct = value => Number((100 * value).toFixed(3));
const commission = (amount, rate) => Math.max(5, money(amount * rate));

function openingPrice(quote, side, slippage) {
 if (!quote || quote.volume <= 0) return null;
 const buy = side === "buy";
 const limit = quote.reference ? tick(quote.reference * (buy ? 1.1 : 0.9)) : null;
 if (limit && (buy ? quote.o >= limit : quote.o <= limit)) return null;
 const slipped = quote.o * (1 + (buy ? slippage : -slippage));
 const units = buy ? Math.ceil(slipped * 1000 - 1e-8) : Math.floor(slipped * 1000 + 1e-8);
 const price = Math.max(0.001, units / 1000);
 return limit ? (buy ? Math.min(price, limit) : Math.max(price, limit)) : price;
}

function simulate({name, fee, slippage, passiveWeight = 0}) {
 let cash = cashAtStart;
 let previousClose = null;
 let peak = cashAtStart;
 let maxDrawdown = 0;
 let maxExposure = 0;
 let exposureSum = 0;
 let feesPaid = 0;
 let dividendsPaid = 0;
 let splitSharesAdded = 0;
 let pending = passiveWeight ? [{id: "benchmark", side: "buy", signalT: null, type: "benchmark"}] : [];
 const positions = new Map();
 const completedTopSales = new Set();
 const receivables = [];
 const fills = [];
 const skipped = [];
 const equity = [];
 const recordDates = new Map(cashDividends.map(x => [x.record, x]));
 const mark = spot => [...positions.values()].reduce((sum, p) => sum + p.shares * spot, 0);
 const dividendsDue = () => receivables.reduce((sum, d) => sum + d.amount, 0);

 for (const day of calendar) {
  const quote = quotes.get(day);
  if (day === split.date) {
   for (const p of positions.values()) {
    splitSharesAdded += p.shares * (split.ratio - 1);
    p.shares *= split.ratio;
   }
   if (previousClose) previousClose /= split.ratio;
  }
  for (let i = receivables.length - 1; i >= 0; i--) {
   if (receivables[i].pay <= day) {
    cash += receivables[i].amount;
    dividendsPaid += receivables[i].amount;
    receivables.splice(i, 1);
   }
  }
  const carry = [];
  // Orders on one opening auction are settled sell-first. Positions bought
  // that morning cannot satisfy a sale under stock-ETF T+1.
  for (const order of pending.filter(o => o.side === "sell")) {
   const position = positions.get(order.id);
   if (!position) continue;
   const price = openingPrice(quote, "sell", slippage);
   if (!price || position.bought === day) {
    carry.push(order);
    continue;
   }
   const amount = money(position.shares * price);
   const cost = commission(amount, fee);
   cash += amount - cost;
   feesPaid += cost;
   positions.delete(order.id);
   if (order.parent) completedTopSales.add(order.parent);
   fills.push({...order, date: day, open: quote.o, price, shares: position.shares, commission: cost});
  }
  const spot = quote?.o || previousClose;
  const buyPrice = openingPrice(quote, "buy", slippage);
  const openNav = cash + mark(spot) + dividendsDue();
  for (const order of pending.filter(o => o.side === "buy")) {
   if (order.parent && !completedTopSales.has(order.parent)) {
    skipped.push({...order, attempt: day, reason: "parent sale unfilled"});
    continue;
   }
   if (!buyPrice) {
    skipped.push({...order, attempt: day, reason: quote ? "opening price unavailable/at limit" : "ETF quote unavailable"});
    continue;
   }
   const marketValue = mark(spot);
   const capital = cash + marketValue + dividendsDue();
   const maxWeight = passiveWeight || exposureCap;
   const exposureRoom = maxWeight * capital - marketValue;
   const maxSpend = Math.min((passiveWeight || unitFraction) * openNav, cash);
   let shares = 100 * Math.max(0, Math.floor(Math.min(exposureRoom / spot, maxSpend / buyPrice) / 100));
   while (shares > 0) {
    const value = shares * buyPrice;
    const cost = commission(value, fee);
    const afterCosts = capital - cost - shares * (buyPrice - spot);
    if (value + cost <= maxSpend && marketValue + shares * spot <= maxWeight * afterCosts) break;
    shares -= 100;
   }
   if (!shares) {
    skipped.push({...order, attempt: day, reason: "insufficient allocation for one lot"});
    continue;
   }
   const amount = money(shares * buyPrice);
   const cost = commission(amount, fee);
   positions.set(order.id, {bought: day, shares});
   cash -= amount + cost;
   feesPaid += cost;
   fills.push({...order, date: day, open: quote.o, price: buyPrice, shares, commission: cost});
  }

  assert(cash >= -1e-6, "Cash account went negative " + day);
  previousClose = quote?.c || previousClose;
  const dividend = recordDates.get(day);
  if (dividend && positions.size) receivables.push({
   ex: dividend.ex, pay: dividend.pay,
   amount: money([...positions.values()].reduce((sum, p) => sum + p.shares * dividend.perShare, 0))
  });
  const value = mark(previousClose);
  const nav = cash + value + receivables.filter(d => d.ex <= day).reduce((sum, d) => sum + d.amount, 0);
  assert(Number.isFinite(nav) && nav > 0, "Invalid daily equity " + day);
  peak = Math.max(peak, nav);
  maxDrawdown = Math.max(maxDrawdown, 1 - nav / peak);
  maxExposure = Math.max(maxExposure, value / nav);
  exposureSum += value / nav;
  equity.push({date: day, nav: money(nav), exposurePct: pct(value / nav)});
  pending = carry;
  if (!passiveWeight) {
   for (const order of ordersByDate.get(day) || []) pending.push({...order, signalT: day});
  }
 }
 const nav = equity.at(-1).nav;
 const years = (Date.parse(cutoff) - Date.parse(start)) / (365.2425 * 86400000);
 const from2021 = equity.find(x => x.date === "2020-12-31")?.nav;
 const entries = fills.filter(f => f.side === "buy");
 const exits = fills.filter(f => f.side === "sell");
 return {
  name, feeBps: Math.round(fee * 10000), slippageBps: Math.round(slippage * 10000),
  endingNav: nav, returnPct: pct(nav / cashAtStart - 1), annualizedPct: pct((nav / cashAtStart) ** (1 / years) - 1),
  maxDrawdownPct: pct(maxDrawdown), avgExposurePct: pct(exposureSum / calendar.length), peakExposurePct: pct(maxExposure),
  returnSince2021Pct: from2021 ? pct(nav / from2021 - 1) : null,
  fees: money(feesPaid), dividends: money(dividendsPaid), splitSharesAdded,
  entries: entries.length, exits: exits.length, open: positions.size, pending: pending.length,
  buySignalDaysFilled: new Set(entries.filter(f => f.signalT).map(f => f.signalT)).size,
  sellSignalDaysFilled: new Set(exits.map(f => f.signalT)).size,
  correctionSignalDaysFilled: new Set(entries.filter(f => f.type === "correctionBuy").map(f => f.signalT)).size,
  fills, skipped, equity
 };
}

const baseCosts = {fee: 0.0003, slippage: 0.0005};
const scenarios = [
 simulate({name: "MACD base", ...baseCosts}),
 simulate({name: "MACD higher costs", fee: 0.0005, slippage: 0.002}),
 simulate({name: "ETF 10% buy and hold", ...baseCosts, passiveWeight: 0.10}),
 simulate({name: "ETF 50% buy and hold", ...baseCosts, passiveWeight: 0.50}),
 simulate({name: "ETF buy and hold", ...baseCosts, passiveWeight: 1})
];
for (const scenario of scenarios) {
 assert(scenario.fills.every(f => !f.signalT || f.date > f.signalT), "A close signal cannot fill on itself");
 assert(scenario.fills.every(f => f.shares % 100 === 0), "All fills must use board lots");
 assert.equal(scenario.entries - scenario.exits, scenario.open, "Risk units must reconcile");
 const bought = new Map(scenario.fills.filter(f => f.side === "buy").map(f => [f.id, f.date]));
 assert(scenario.fills.filter(f => f.side === "sell").every(f => bought.get(f.id) < f.date), "Stock ETF sells must meet T+1");
}
const report = {
 market: "SSE Composite daily signals / 510210 ETF unadjusted OHLC",
 start, cutoff, indexSessions: calendar.length, etfSessions: calendar.filter(t => quotes.has(t)).length,
 etfSourceSHA256: createHash("sha256").update(etfPayload).digest("hex"),
 cashAtStart, unitFraction, exposureCap, split, cashDividends,
 indexFirstBuySignals: signal.events.filter(e => e.type === "buy" && e.t >= start).length,
 indexCorrectionSignals: signal.events.filter(e => e.type === "correctionBuy" && e.t >= start).length,
 scenarios
};
console.log(JSON.stringify(report, null, 2));
