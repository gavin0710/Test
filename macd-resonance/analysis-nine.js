/* Consecutive nine/ten observations. Shared by archive generation and the page. */
"use strict";
const NineAnalysis = (() => {
  const metrics = typeof module === "object" && module.exports ? require("./analysis-metrics.js") : SuccessAnalysis;
  const { horizons, day, sampleRange } = metrics;
  const trends = { up: "上升趋势", down: "下降趋势", flat: "均线走平", unknown: "趋势预热不足" };
  const sides = { low: "低", high: "高" };
  const definition = {
    count: "收盘价严格高于/低于前4根，连续计数；每段首次到9记录一次，下一根继续满足同向条件才到10。持平中断。不是TD13。",
    trend: "序列第1根之前，MA60高于5根前MA60为上升，低于为下降，相等为走平；不足65根历史为未知。9和10沿用同一趋势分组。",
    endpoint: "低序列默认看后N根上涨，高序列看后N根下跌；持平不命中。按各自信号收盘价计算，不模拟成交或卖空。"
  };
  function buildNineRows(series, periods) {
    const observations = [];
    for (const { id: period } of periods) for (let index = 0; index < series.length; index++) {
      const bars = series[index][period].bars;
      const sums = [0];
      for (const bar of bars) sums.push(sums.at(-1) + bar.c);
      const ma = i => i >= 59 ? (sums[i + 1] - sums[i - 59]) / 60 : null;
      let run = 0, direction = 0;
      for (let i = 4; i < bars.length; i++) {
        const next = Math.sign(bars[i].c - bars[i - 4].c);
        run = next ? next === direction ? run + 1 : 1 : 0;
        direction = next;
        if (run !== 9) continue;
        const before = i - 9, currentMa = ma(before), previousMa = ma(before - 5);
        const slope = currentMa === null || previousMa === null ? null : currentMa - previousMa;
        // Sum-roundoff on a genuinely constant window must not manufacture a trend.
        const epsilon = Math.max(Math.abs(currentMa || 0), 1) * 1e-12;
        const trend = slope === null ? "unknown" : slope > epsilon ? "up" : slope < -epsilon ? "down" : "flat";
        const check = bars[i + 1], validTen = check ? Math.sign(check.c - bars[i - 3].c) === direction : false;
        const endpoint = (at, n) => bars[at + n] ? [bars[at + n].t, bars[at + n].c] : null;
        observations.push({
          period, index, side: direction < 0 ? "low" : "high", time: bars[i].t, close: bars[i].c, barIndex: i,
          sequenceStart: bars[i - 8].t, trend, trendAt: bars[before]?.t || null,
          trendMa: [currentMa, previousMa], forward: horizons.map(n => endpoint(i, n)),
          tenCheck: check ? [check.t, check.c, validTen] : null,
          tenForward: validTen ? horizons.map(n => endpoint(i + 1, n)) : horizons.map(() => null)
        });
      }
    }
    return observations;
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
    return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null;
  };
  function evaluate(data, options = {}) {
    const { index = "all", scope = "all", horizon = 10, period = "all", trend = "all", side = "all", stage = "nine", goal = "reversal", minBars = 0 } = options;
    if (!horizons.includes(horizon) || !["nine", "eligibleNine", "ten", "pairedNine", "pairedTen"].includes(stage) || !["reversal", "up", "down"].includes(goal)) throw Error("Invalid nine observation");
    return (data.nineSamples || []).flatMap(row => {
      const range = sampleRange(data, row.period, scope);
      if (!range || day(row.time) < range.from || day(row.time) > range.to || row.barIndex + 1 < minBars ||
          (index !== "all" && row.index !== index) || (period !== "all" && row.period !== period) ||
          (trend !== "all" && row.trend !== trend) || (side !== "all" && row.side !== side)) return [];
      const observedCheck = row.tenCheck && day(row.tenCheck[0]) <= range.to ? row.tenCheck : null;
      const tenStatus = observedCheck ? observedCheck[2] ? "valid" : "invalid" : "waiting";
      if (stage !== "nine" && tenStatus !== "valid") return [];
      const h = horizons.indexOf(horizon), tenEntry = [observedCheck?.[0], observedCheck?.[1]];
      const entry = stage === "ten" || stage === "pairedTen" ? tenEntry : [row.time, row.close];
      const raw = stage === "ten" ? row.tenForward[h] : row.forward[h];
      const outcome = raw && day(raw[0]) <= range.to ? raw : null;
      // Paired views have identical signals and the original nine's endpoint.
      if (stage.startsWith("paired") && !outcome) return [];
      const priceMove = outcome ? 100 * (outcome[1] / entry[1] - 1) : null;
      const direction = goal === "up" ? 1 : goal === "down" ? -1 : row.side === "low" ? 1 : -1;
      return [{ ...row, stage, entry, outcome, priceMove, result: priceMove === null ? null : priceMove * direction, tenStatus, observedCheck }];
    });
  }
  function summarize(rows) {
    const evaluated = rows.filter(r => r.result !== null), wins = evaluated.filter(r => r.result > 0).length;
    return { total: rows.length, evaluated: evaluated.length, pending: rows.length - evaluated.length,
      wins, rate: evaluated.length ? wins / evaluated.length : null, medianReturn: median(evaluated.map(r => r.priceMove)),
      signalDays: new Set(evaluated.map(r => day(r.time))).size };
  }
  function continuation(rows) {
    const observed = rows.filter(r => r.tenStatus !== "waiting"), valid = observed.filter(r => r.tenStatus === "valid").length;
    return { total: rows.length, evaluated: observed.length, valid, invalid: observed.length - valid,
      waiting: rows.length - observed.length, rate: observed.length ? valid / observed.length : null };
  }
  return { buildNineRows, definition, trends, sides, evaluate, summarize, continuation, median };
})();
if (typeof module === "object" && module.exports) module.exports = NineAnalysis;

/* Browser view; archive generation never invokes this function. */
function mountNineAnalysis(data) {
  const el = id => document.getElementById(id), model = NineAnalysis;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  const pct = value => value === null ? "—" : (value * 100).toFixed(1) + "%";
  const move = value => value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  const periodName = id => data.periods.find(p => p.id === id)?.label || id;
  const stages = { nine:"第9根", eligibleNine:"会续数到10的第9根", ten:"第10根", pairedNine:"同终点·第9根价格", pairedTen:"同终点·第10根价格" };
  const scopeNames = { all:"各周期全历史", four:"四指共同历史", same:"六周期同窗" };
  const quadrants = [{trend:"up",side:"low"},{trend:"up",side:"high"},{trend:"down",side:"low"},{trend:"down",side:"high"}];
  if (data.nineSchema !== 1 || !Array.isArray(data.nineSamples)) {
    el("nine-status").textContent = "九转跟踪归档尚未就绪，请稍后刷新。";
    return;
  }
  el("nine-status").hidden = true;
  el("nine-period").innerHTML = data.periods.map(p => '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>').join("");
  el("nine-period").value = "D";
  el("nine-horizon").value = el("study-horizon").value;
  el("nine-definitions").innerHTML = Object.entries({"9与10":model.definition.count,"趋势分组":model.definition.trend,"方向命中":model.definition.endpoint,
    "统计范围":"继承顶部指数、范围和预热筛选，范围按第9根信号日选取；超过范围截止日的10确认和观察终点仍按未知处理。",
    "趋势预热":"序列开始前需要65根行情。预热不足和均线走平单列，不强行归入上升或下降。微小浮点误差视为走平。",
    "同样本对照":"同批9只取10成立的序列；各自后N根的终点相差一根。折叠的同终点对照进一步固定为9后第N根。"})
    .map(([label,text])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(text)+'</dd></div>').join("");
  const options = () => ({ index:el("index").value === "all" ? "all" : Number(el("index").value), scope:el("scope").value,
    horizon:Number(el("study-horizon").value), minBars:Number(el("study-warmup").value), goal:el("nine-goal").value });
  let casePage = 0, selected = null;
  const selectedStage = () => el("nine-stage").value;
  const target = side => el("nine-goal").value === "up" ? "上涨" : el("nine-goal").value === "down" ? "下跌" : side === "low" ? "上涨" : "下跌";
  const labelFor = (trend,side) => model.trends[trend] + "·" + model.sides[side] + "序列";
  const attr = (period,trend,side,stage,title="") => ' data-nine-period="'+period+'" data-nine-trend="'+trend+'" data-nine-side="'+side+'" data-nine-stage="'+stage+'" data-nine-title="'+esc(title)+'"';
  function rateButton(period,trend,side,stage,rows,title="") {
    const s=model.summarize(rows), text=pct(s.rate)+"，"+s.wins+"/"+s.evaluated+"，待"+s.pending;
    return '<button type="button" class="nine-rate'+(s.evaluated<20 ? " small" : "")+'"'+attr(period,trend,side,stage,title)+
      ' aria-label="'+esc(periodName(period)+" "+labelFor(trend,side)+" "+stages[stage]+" "+text+"，查看样本")+'"'+(s.total ? "" : " disabled")+'><strong>'+pct(s.rate)+'</strong><span>'+s.wins+' / '+s.evaluated+' · 待'+s.pending+'</span></button>';
  }
  function render() {
    const o=options(), period=el("nine-period").value, stage=selectedStage();
    const stageRows=model.evaluate(data,{...o,stage}), allNine=model.evaluate(data,{...o,period,stage:"nine"});
    const by=(rows,p,t,s)=>rows.filter(r=>r.period===p && r.trend===t && r.side===s);
    const unknown=allNine.filter(r=>r.trend==="unknown").length, flat=allNine.filter(r=>r.trend==="flat").length;
    el("nine-scope").textContent=scopeNames[o.scope];
    el("nine-description").textContent=periodName(period)+" · "+stages[stage]+"后第"+o.horizon+"根收盘，"+
      (o.goal==="reversal" ? "低序列看上涨，高序列看下跌" : o.goal==="up" ? "所有序列统一看上涨" : "所有序列统一看下跌")+
      "。趋势按序列开始前MA60相对5根前的方向固定，9和10使用同一分组。本周期共有"+allNine.length+"个9；趋势预热不足"+unknown+"个、均线走平"+flat+"个不进入四组对照。";
    el("nine-scorecards").innerHTML=["up","down"].map(trend=>'<div class="nine-trend-panel"><h3>'+model.trends[trend]+'<small>序列开始前MA60方向</small></h3><div class="nine-score-grid">'+["low","high"].map(side=>{
      const rows=by(stageRows,period,trend,side),s=model.summarize(rows),name=model.sides[side]+(stage==="ten" ? "10" : "9");
      return '<button type="button" class="nine-score'+(s.evaluated<20 ? " small" : "")+'"'+attr(period,trend,side,stage)+
       ' aria-label="'+esc(periodName(period)+" "+model.trends[trend]+" "+name+" 后"+o.horizon+"根"+target(side)+"率 "+pct(s.rate)+"，查看样本")+'"'+(s.total ? "" : " disabled")+'><span class="nine-label">'+name+'</span><span class="nine-direction">后'+o.horizon+'根'+target(side)+'率</span><strong>'+pct(s.rate)+'</strong><span class="track" aria-hidden="true"><span class="fill" style="width:'+((s.rate||0)*100)+'%"></span></span><span class="nine-count">命中 '+s.wins+' / '+s.evaluated+' · 待'+s.pending+'</span><span class="nine-count">涨跌幅中位 '+move(s.medianReturn)+'</span></button>';
    }).join("")+'</div></div>').join("");
    el("nine-matrix-heading").textContent="六周期对照 · "+stages[stage]+"后"+o.horizon+"根";
    el("nine-matrix").innerHTML=data.periods.map(p=>'<tr class="'+(p.id===period ? "nine-selected" : "")+'"><th scope="row">'+esc(p.label)+'</th>'+quadrants.map(q=>'<td>'+rateButton(p.id,q.trend,q.side,stage,by(stageRows,p.id,q.trend,q.side))+'</td>').join("")+'</tr>').join("");
    const eligible=model.evaluate(data,{...o,period,stage:"eligibleNine"}), tens=model.evaluate(data,{...o,period,stage:"ten"});
    el("nine-compare").innerHTML=quadrants.map(q=>{
      const rows=by(allNine,period,q.trend,q.side), c=model.continuation(rows);
      const continuation='<button type="button" class="nine-rate'+(c.evaluated<20 ? " small" : "")+'"'+attr(period,q.trend,q.side,"nine","续数到10的观察")+(rows.length ? "" : " disabled")+' aria-label="'+esc(labelFor(q.trend,q.side)+" 续数到10成立率 "+pct(c.rate)+"，查看全部9")+'"><strong>'+pct(c.rate)+'</strong><span>'+c.valid+' / '+c.evaluated+' · 待'+c.waiting+'</span></button>';
      return '<tr><th scope="row">'+model.trends[q.trend]+'<span>'+model.sides[q.side]+'序列 · 看'+target(q.side)+'</span></th><td>'+rateButton(period,q.trend,q.side,"nine",rows)+'</td><td>'+continuation+'</td><td>'+rateButton(period,q.trend,q.side,"eligibleNine",by(eligible,period,q.trend,q.side))+'</td><td>'+rateButton(period,q.trend,q.side,"ten",by(tens,period,q.trend,q.side))+'</td></tr>';
    }).join("");
    const pairedNine=model.evaluate(data,{...o,period,stage:"pairedNine"}), pairedTen=model.evaluate(data,{...o,period,stage:"pairedTen"});
    el("nine-paired-body").innerHTML=quadrants.map(q=>{
      const early=by(pairedNine,period,q.trend,q.side),late=by(pairedTen,period,q.trend,q.side);
      const change=model.median(early.map(r=>100*(r.observedCheck[1]/r.close-1)));
      return '<tr><th scope="row">'+model.trends[q.trend]+'<span>'+model.sides[q.side]+'序列</span></th><td>'+early.length+'</td><td>'+rateButton(period,q.trend,q.side,"pairedNine",early)+'</td><td>'+rateButton(period,q.trend,q.side,"pairedTen",late)+'</td><td>'+move(change)+'</td></tr>';
    }).join("");
    renderCases();
  }
  function renderCases() {
    const o=options(), c=selected||{period:el("nine-period").value,trend:"all",side:"all",stage:selectedStage(),title:"近期全部序列"};
    const rows=model.evaluate(data,{...o,...c}).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index),s=model.summarize(rows);
    el("nine-case-caption").textContent=periodName(c.period)+" · "+(c.title||[c.trend==="all" ? "所有趋势" : model.trends[c.trend],c.side==="all" ? "高／低序列" : model.sides[c.side]+"序列"].join(" · "))+
      " · "+stages[c.stage]+" · "+rows.length+"个样本，已评估"+s.evaluated+"，待评估"+s.pending+"，已评估信号分布"+s.signalDays+"日。"+
      (c.stage.startsWith("paired") ? "终点固定为9后第"+o.horizon+"根。" : "观察终点为各自信号后第"+o.horizon+"根。");
    const pages=Math.max(1,Math.ceil(rows.length/10));casePage=Math.min(casePage,pages-1);
    const point=p=>p ? esc(p[0].replace("T"," "))+'<span class="sub">'+p[1].toFixed(2)+'</span>' : "待评估";
    el("nine-records").innerHTML=rows.slice(casePage*10,(casePage+1)*10).map(row=>{
      const check=row.observedCheck, status=row.tenStatus==="valid" ? "10成立" : row.tenStatus==="invalid" ? "未续数到10" : "待下一根";
      const ma=row.trendMa.every(v=>v!==null) ? '<span class="sub">序列前MA60 '+row.trendMa[0].toFixed(2)+' / 5根前 '+row.trendMa[1].toFixed(2)+'</span>' : '<span class="sub">序列前历史不足</span>';
      return '<tr><td>'+esc(data.indices[row.index])+'<span class="sub">'+esc(periodName(row.period))+'</span></td><td>'+model.sides[row.side]+'9 · '+model.trends[row.trend]+ma+'</td><td>'+point([row.time,row.close])+'</td><td>'+status+(check ? '<span class="sub">'+esc(check[0].replace("T"," "))+' · '+check[1].toFixed(2)+'</span>' : "")+'</td><td>'+point(row.entry)+'</td><td>'+point(row.outcome)+'</td><td class="'+(row.priceMove>0 ? "win" : row.priceMove<0 ? "loss" : "")+'">'+move(row.priceMove)+'</td><td>'+(row.result===null ? "待评估" : row.result>0 ? "命中" : "未命中")+'</td></tr>';
    }).join("")||'<tr><td class="empty" colspan="8">当前筛选没有符合条件的序列</td></tr>';
    el("nine-pagination").hidden=pages<2;el("nine-prev").disabled=casePage===0;el("nine-next").disabled=casePage+1>=pages;el("nine-page").textContent=(casePage+1)+" / "+pages;
  }
  el("nine-study").addEventListener("click",event=>{
    const b=event.target.closest("button[data-nine-period]");if(!b||b.disabled)return;
    el("nine-period").value=b.dataset.ninePeriod;
    selected={period:b.dataset.ninePeriod,trend:b.dataset.nineTrend,side:b.dataset.nineSide,stage:b.dataset.nineStage,title:b.dataset.nineTitle};
    casePage=0;render();el("nine-cases").open=true;
    const summary=el("nine-cases").querySelector("summary");summary.focus({preventScroll:true});summary.scrollIntoView({block:"start"});
  });
  for(const id of ["index","scope","study-warmup","nine-goal"])el(id).addEventListener("change",()=>{casePage=0;render();});
  el("nine-stage").addEventListener("change",()=>{selected=null;casePage=0;render();});
  el("nine-period").addEventListener("change",()=>{selected=null;casePage=0;render();});
  el("study-horizon").addEventListener("change",()=>{el("nine-horizon").value=el("study-horizon").value;casePage=0;render();});
  el("nine-horizon").addEventListener("change",()=>{el("study-horizon").value=el("nine-horizon").value;el("study-horizon").dispatchEvent(new Event("change"));});
  el("nine-reset").addEventListener("click",()=>{selected=null;casePage=0;renderCases();});
  el("nine-prev").addEventListener("click",()=>{casePage--;renderCases();});
  el("nine-next").addEventListener("click",()=>{casePage++;renderCases();});
  render();
}
