"use strict";
function mountTradeAnalysis(data) {
  const el=id=>document.getElementById(id);
  const metrics = SuccessAnalysis;
  const { groups, day, summarize } = metrics;
  const columns = ["single", "resonance", "noNine", "nine", "both"];
  const modeNames = { trade: "交易胜率", buy: "买1后上涨率", sell: "卖1后下跌率" };
  const pageSize = 10;
  let mode = "trade", casePage = 0, evaluated = [];
  const fmt = new Intl.NumberFormat("zh-CN");
  const escape = val => String(val).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  const pct = rate => rate === null ? "—" : (100 * rate).toFixed(1) + "%";
  const move = value => value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  const duration = minutes => {
   if (minutes === null) return "—";
   if (minutes < 60) return minutes.toFixed(0) + " 分钟";
   if (minutes < 1440) return (minutes / 60).toFixed(minutes % 60 ? 1 : 0) + " 小时";
   return (minutes / 1440).toFixed(0) + " 天";
  };
  const periodTag = id => data.periods.find(period => period.id === id).label;
  const option = (value, label) => '<option value="' + escape(value) + '">' + escape(label) + '</option>';
  const selectedIndex = () => el("index").value === "all" ? "all" : Number(el("index").value);
  const filterOptions = () => ({ mode, index: selectedIndex(), scope: el("scope").value, horizon: Number(el("horizon").value) });
  const selection = (id, group) => ' data-period="' + id + '" data-group="' + group + '"';
  const mark = (id, group, text) => " aria-label=\"" + escape(periodTag(id) + " " + groups[group].label + " " + text + "，查看样本") + "\"";
  el("case-period").innerHTML = data.periods.map(({ id, label }) => option(id, label)).join("");
  el("case-period").value = "D";
  el("case-group").innerHTML = Object.entries(groups).map(([id, group]) => option(id, group.label)).join("");

  function render() {
   const options = filterOptions();
   evaluated = metrics.evaluate(data, options);
   const trade = mode === "trade", sell = mode === "sell";
   for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
   el("horizon-field").hidden = trade;
   el("period-heading").textContent = "各周期" + modeNames[mode];
   el("count-heading").textContent = trade ? "盈利 / 结束" : "命中 / 观察";
   el("result-heading").textContent = trade ? "胜率" : "命中率";
   el("time-heading").textContent = trade ? "持有中位" : "观察中位";
   el("exit-heading").textContent = trade ? "退出时间 / 收盘" : "观察时间 / 收盘";
   el("move-heading").textContent = trade ? "信号价收益" : "方向幅度";
   const same = metrics.bounds(data.coverage);
   const rangeLabel = options.scope === "same" ? same ? same.from + " 至 " + same.to + "。 " : "六周期无共同日期。 " :
    options.scope === "four" ? "各周期只取四指都有行情的日期范围。 " : "";
   el("context").textContent = rangeLabel + (trade ? "首次买1入账，退出收盘价高于买入收盘价记成功。"
    : (sell ? "卖1" : "买1") + "后第 " + options.horizon + " 根 K 线收盘" + (sell ? "下跌" : "上涨") + "记命中。");
   const byPeriod = new Map(data.periods.map(({ id }) => [id, evaluated.filter(row => row.period === id)]));
   const allStats = Object.fromEntries(data.periods.map(({ id }) => [id, summarize(byPeriod.get(id))]));
   const minute = data.coverage.filter(row => row.period === "15" && (options.index === "all" || options.index === row.index));
   const sessions = Math.min(...minute.map(row => row.sessions));
   el("history-span").textContent = "分钟归档 " + sessions + " 个交易日";
   el("overview").innerHTML = data.periods.map(({ id, label }) => {
    const values = allStats[id];
    const count = values.evaluated ? '<strong>' + values.wins + '</strong> / ' + values.evaluated : "—";
    const rate = pct(values.rate), fill = values.rate === null ? "" : '<span class="fill" style="width:' + values.rate * 100 + '%"></span>';
    const text = values.evaluated ? rate + "，" + values.wins + " / " + values.evaluated : "暂无已评估样本";
    return '<tr class="' + (id === "D" || id === "W" ? "cut" : "") + '"><th scope="row">' + escape(label) +
     '</th><td class="metric"><button type="button" class="rate-button ' + (values.evaluated < 20 ? "thin" : "") + '"' +
     selection(id, "all") + mark(id, "all", text) + (values.total ? "" : " disabled") + '>' +
     '<span class="track" aria-hidden="true">' + fill + '</span><span class="rate-text">' + rate + '</span></button></td>' +
     '<td class="count">' + count + '</td><td>' + values.pending + '</td><td>' + duration(values.medianMinutes) + '</td></tr>';
   }).join("");
   const periodNote = allStats.W.medianMinutes && allStats.D.medianMinutes && trade
    ? "周线持有中位时长约为日线的 " + (allStats.W.medianMinutes / allStats.D.medianMinutes).toFixed(1) + " 倍。胜率要和持有时间一起看。"
    : "";
   el("period-note").textContent = periodNote;
   el("period-note").hidden = !periodNote;

   el("matrix").innerHTML = data.periods.map(({ id, label }) =>
    '<tr class="' + (id === "D" || id === "W" ? "cut" : "") + '"><th scope="row">' + escape(label) + '</th>' +
    columns.map(group => {
     const values = summarize(byPeriod.get(id).filter(groups[group].includes));
     const count = values.evaluated ? values.wins + " / " + values.evaluated : values.pending ? "待 " + values.pending : "无样本";
     return '<td' + (group === "noNine" || group === "both" ? ' class="split"' : "") +
      '><button type="button" class="cell' + (values.evaluated < 20 ? " small" : "") + '"' + selection(id, group) +
      mark(id, group, pct(values.rate) + "，" + count) + (values.total ? "" : " disabled") +
      '><strong>' + pct(values.rate).replace(/^(0|100)\.0%$/, '$1%') + '</strong><span>' + count + '</span></button></td>';
    }).join("") + '</tr>'
   ).join("");
   renderReading(byPeriod, options);
   renderCoverage(options);
   renderCases();
  }

  function renderReading(byPeriod, options) {
   let reading = "";
   if (options.index === "all" && options.scope === "all" && mode === "trade") {
    const daily = byPeriod.get("D");
    const ten = metrics.evaluate(data, { ...options, mode: "buy", horizon: 10 }).filter(row => row.period === "D");
    const higher = (rows, a, b) => {
     const left = summarize(rows.filter(groups[a].includes)).rate;
     const right = summarize(rows.filter(groups[b].includes)).rate;
     return left !== null && right !== null && left > right;
    };
    const flips = [["resonance", "single"], ["nine", "noNine"]].every(([a, b]) => higher(daily, a, b) && higher(ten, b, a));
    if (flips) reading = "日线共振和有9组的交易胜率较高。改看买1后10根，两组上涨率均低于各自对照组。";
   }
   if (options.index === "all" && options.scope === "all" && mode === "buy") {
    const rows = byPeriod.get("15"), single = summarize(rows.filter(groups.single.includes));
    const matched = summarize(rows.filter(groups.resonance.includes));
    if (matched.rate !== null && single.rate !== null && matched.rate > single.rate) {
     reading = "15分钟共振组命中 " + matched.wins + " / " + matched.evaluated + "，触发分布在 " +
      matched.signalDays + " 个交易日。同期多个指数可能反映同一段行情。";
    }
   }
   el("factor-reading").textContent = reading;
   el("factor-reading").hidden = !reading;
  }

  function renderCoverage(options) {
   el("coverage").innerHTML = data.periods.map(({ id, label }) => {
    const rows = data.coverage.filter(row => row.period === id && (options.index === "all" || options.index === row.index));
    const from = rows.map(row => day(row.from)).sort()[0], to = rows.map(row => day(row.to)).sort().at(-1);
    const min = Math.min(...rows.map(row => row.bars)), max = Math.max(...rows.map(row => row.bars));
    return '<tr><th scope="row">' + escape(label) + '</th><td>' + escape(from) + ' 至 ' + escape(to) +
     '</td><td>' + fmt.format(min) + (min === max ? "" : "–" + fmt.format(max)) + '</td></tr>';
   }).join("");
  }

  function renderCases() {
   const group = groups[el("case-group").value], period = el("case-period").value;
   const rows = evaluated.filter(row => row.period === period && group.includes(row))
    .sort((a,b) => b.time.localeCompare(a.time) || a.index - b.index);
   const values = summarize(rows);
   el("case-caption").textContent = values.total + " 个信号 · 已评估 " + values.evaluated +
    " · 信号分布 " + values.signalDays + " 日 · 中位幅度 " + move(values.medianMove);
   const pages = Math.max(1, Math.ceil(rows.length / pageSize));
   casePage = Math.min(casePage, pages - 1);
   el("records").innerHTML = rows.slice(casePage * pageSize, (casePage + 1) * pageSize).map(row => {
    const picked = row.outcome, time = row.time.replace("T", " "), isTrade = mode === "trade";
    const exitLabel = isTrade ? picked?.[2] === "topSell" ? "顶部卖点" : "结构止损" : "";
    const exit = picked ? escape(picked[0].replace("T", " ")) + '<span class="sub">' +
     picked[1].toFixed(2) + (exitLabel ? " · " + exitLabel : "") + '</span>' : "待评估";
    const peers = row.covered < 4 ? "同期缺档" : row.matched + " / 4";
    const nine = row.nineAge === null ? "—" : (row.signal === "buy" ? "低9" : "高9") + " · " + (row.nineAge === 0 ? "当根" : row.nineAge + " 根前");
    return '<tr><td>' + escape(data.indices[row.index]) + '</td><td>' + escape(time) + '<span class="sub">' + row.close.toFixed(2) +
     '</span></td><td>' + peers + '</td><td>' + nine + '</td><td>' + exit + '</td><td class="' +
     (row.result > 0 ? "win" : row.result < 0 ? "loss" : "") + '">' + move(row.result) + '</td></tr>';
   }).join("") || '<tr><td class="empty" colspan="6">当前筛选没有符合条件的信号</td></tr>';
   el("case-footer").hidden = pages < 2;
   el("prev").disabled = casePage === 0;
   el("next").disabled = casePage + 1 >= pages;
   el("page-number").textContent = (casePage + 1) + " / " + pages;
  }

  function showCases(event) {
   const button = event.target.closest("button[data-period]");
   if (!button || button.disabled) return;
   el("case-period").value = button.dataset.period;
   el("case-group").value = button.dataset.group;
   el("cases").open = true;
   casePage = 0;
   renderCases();
   const summary = el("cases").querySelector("summary");
   summary.focus({ preventScroll: true });
   summary.scrollIntoView({ block: "start" });
  }

  for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => {
   mode = button.dataset.mode;
   casePage = 0;
   render();
  });
  for (const id of ["index", "scope", "horizon"]) el(id).addEventListener("change", () => { casePage = 0; render(); });
  for (const id of ["case-period", "case-group"]) el(id).addEventListener("change", () => { casePage = 0; renderCases(); });
  el("overview").addEventListener("click", showCases);
  el("matrix").addEventListener("click", showCases);
  el("prev").addEventListener("click", () => { if (casePage > 0) casePage--; renderCases(); });
  el("next").addEventListener("click", () => { casePage++; renderCases(); });
  render();




 }
