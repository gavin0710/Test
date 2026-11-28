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
      return [{ ...row, stage, rangeEnd: range.to, entry, outcome, priceMove, result: priceMove === null ? null : priceMove * direction, tenStatus, observedCheck }];
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

/* Standalone reversal study: low looks up, high looks down. */
function mountNineAnalysis(data) {
 const el=id=>document.getElementById(id),model=NineAnalysis;
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pct=v=>v===null?'—':(100*v).toFixed(1)+'%',move=v=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
 const periodName=p=>data.periods.find(r=>r.id===p)?.label||p;
 const target=side=>side==='low'?'上涨':'下跌';
 const outcomeLabel=row=>row.result===null?'待评估':row.result>0?target(row.side)+'成功':'未'+target(row.side);
 const qs=[{trend:'up',side:'low'},{trend:'up',side:'high'},{trend:'down',side:'low'},{trend:'down',side:'high'}];
 const scopeNames={all:'各周期全历史',four:'四指共同历史',same:'六周期同窗'};
 const stages={nine:'9',eligibleNine:'同批9',ten:'10',pairedNine:'同终点·9',pairedTen:'同终点·10'};
 if(data.nineSchema!==1||data.chartSchema!==1||!Array.isArray(data.nineHistory))throw Error('Nine study archive not ready');
 const options=()=>({index:el('index').value==='all'?'all':Number(el('index').value),scope:el('scope').value,horizon:Number(el('nine-horizon').value),minBars:Number(el('study-warmup').value),goal:'reversal',period:el('nine-period').value});
 const rowsFor=(o,stage='nine',trend='all',side='all')=>model.evaluate(data,{...o,stage,trend,side});
 const label=(t,s)=>(t==='all'?'所有趋势':model.trends[t])+' · '+(s==='all'?'高低序列合计':model.sides[s]+'序列');
 const attributes=(o,stage,trend='all',side='all')=>` data-nine-period="${o.period}" data-nine-stage="${stage}" data-nine-trend="${trend}" data-nine-side="${side}"`;
 const facts=rows=>{const s=model.summarize(rows),done=rows.filter(r=>r.priceMove!==null);return {...s,down:done.filter(r=>r.priceMove<0).length,flat:done.filter(r=>r.priceMove===0).length};};
 let selected=null,casePage=0,chartRows=[],galleryVersion=0;
 const rate=(o,stage,trend,side,rows)=>{const s=facts(rows);return `<button type="button" class="nine-rate${s.evaluated<20?' small':''}"${attributes(o,stage,trend,side)} aria-label="${esc(periodName(o.period)+' '+label(trend,side)+' '+stages[stage]+'后'+target(side)+'率 '+pct(s.rate)+'，查看样本')}"${s.total?'':' disabled'}><strong>${pct(s.rate)}</strong><span>${s.wins} / ${s.evaluated} · 待${s.pending}</span></button>`;};
 function score(o,stage,side,rows){const s=facts(rows),name=side==='all'?'全部'+stages[stage]:model.sides[side]+stages[stage];return `<button type="button" class="overall-score${s.evaluated<20?' small':''}"${attributes(o,stage,'all',side)}${s.total?'':' disabled'}><span>${name}后第${o.horizon}根收盘${target(side)}</span><strong>${pct(s.rate)}</strong><b>${target(side)} ${s.wins} / 已评估 ${s.evaluated}</b><small>未${target(side)} ${s.evaluated-s.wins}（含持平${s.flat}）· 待评估 ${s.pending}</small><small>涨跌幅中位 ${move(s.medianReturn)}</small></button>`;}
 function render(){
  const o=options(),nine=rowsFor(o),ten=rowsFor(o,'ten');
  const unknown=nine.filter(r=>r.trend==='unknown').length,flat=nine.filter(r=>r.trend==='flat').length;
  el('nine-scope').textContent=scopeNames[o.scope];
  el('nine-description').textContent=`${periodName(o.period)} · ${o.index==='all'?'四指数合计':data.indices[o.index]} · 以9的收盘为起点，观察后第${o.horizon}根。低9看上涨，高9看下跌；各自命中数 ÷ 各自已到终点的样本数。${o.minBars?'信号前累计至少'+o.minBars+'根行情。':''}`;
  el('nine-overall-cards').innerHTML=['low','high'].map(side=>score(o,'nine',side,nine.filter(r=>side==='all'||r.side===side))).join('');
  el('nine-matrix').innerHTML=data.periods.map(p=>`<tr><th>${esc(p.label)}</th>${['low','high'].map(s=>`<td>${rate({...o,period:p.id},'nine','all',s,rowsFor({...o,period:p.id}).filter(r=>s==='all'||r.side===s))}</td>`).join('')}</tr>`).join('');
  el('nine-trend-description').textContent=`趋势固定取“序列第1根之前”的MA60相对5根前的方向：上行为上升，下降为下降；9与10沿用同一组。总体${nine.length}个9＝四组${nine.length-unknown-flat}个＋趋势预热不足${unknown}个＋均线走平${flat}个。这里的趋势是该量化定义，不是事后按图形判断。`;
  el('nine-scorecards').innerHTML=['up','down'].map(t=>`<div class="nine-trend-panel"><h3>${model.trends[t]}<small>序列开始前MA60方向</small></h3><div class="nine-score-grid">${['low','high'].map(side=>{const rows=nine.filter(r=>r.trend===t&&r.side===side),s=facts(rows);return `<button type="button" class="nine-score${s.evaluated<20?' small':''}"${attributes(o,'nine',t,side)}${s.total?'':' disabled'}><span class="nine-label">${model.sides[side]}9</span><span class="nine-direction">后第${o.horizon}根收盘${target(side)}率</span><strong>${pct(s.rate)}</strong><span class="track"><span class="fill" style="width:${100*(s.rate||0)}%"></span></span><span class="nine-count">${target(side)} ${s.wins} / ${s.evaluated} · 待${s.pending}</span><span class="nine-count">未${target(side)} ${s.evaluated-s.wins} · 持平 ${s.flat}</span></button>`;}).join('')}</div></div>`).join('');
  el('nine-ten-cards').innerHTML=['low','high'].map(side=>score(o,'ten',side,ten.filter(r=>side==='all'||r.side===side))).join('');
  const low9=facts(nine.filter(r=>r.side==='low')),high9=facts(nine.filter(r=>r.side==='high')),low10=facts(ten.filter(r=>r.side==='low')),high10=facts(ten.filter(r=>r.side==='high')),c=model.continuation(nine);
  el('nine-ten-reading').textContent=`${periodName(o.period)}：低9后上涨 ${pct(low9.rate)}，低10后上涨 ${pct(low10.rate)}；高9后下跌 ${pct(high9.rate)}，高10后下跌 ${pct(high10.rate)}。有下一根可判断的${c.evaluated}个9中，${c.valid}个续数到10（${pct(c.rate)}），${c.invalid}个中断，${c.waiting}个仍待下一根。9和10样本不同，不能仅凭两个总体比例认定等待10更好。`;
  el('nine-compare').innerHTML=qs.map(q=>{const r=nine.filter(r=>r.trend===q.trend&&r.side===q.side),c=model.continuation(r);return `<tr><th>${model.trends[q.trend]}<span>${model.sides[q.side]}序列 · 看${target(q.side)}</span></th><td>${rate(o,'nine',q.trend,q.side,r)}</td><td><span class="continuation-value">${pct(c.rate)}</span><span class="sub">${c.valid} / ${c.evaluated} · 待${c.waiting}</span></td><td>${rate(o,'eligibleNine',q.trend,q.side,rowsFor(o,'eligibleNine',q.trend,q.side))}</td><td>${rate(o,'ten',q.trend,q.side,rowsFor(o,'ten',q.trend,q.side))}</td></tr>`;}).join('');
  el('nine-paired-body').innerHTML=qs.map(q=>{const early=rowsFor(o,'pairedNine',q.trend,q.side),late=rowsFor(o,'pairedTen',q.trend,q.side);return `<tr><th>${model.trends[q.trend]}<span>${model.sides[q.side]}序列 · 看${target(q.side)}</span></th><td>${early.length}</td><td>${rate(o,'pairedNine',q.trend,q.side,early)}</td><td>${rate(o,'pairedTen',q.trend,q.side,late)}</td><td>${move(model.median(early.map(r=>100*(r.observedCheck[1]/r.close-1))))}</td></tr>`;}).join('');
  renderCases();renderGallery();
 }
 const chartCaption=row=>`${data.indices[row.index]} · ${periodName(row.period)} · ${label(row.trend,row.side)}。${stages[row.stage]}收盘 ${row.entry[0].replace('T',' ')}：${row.entry[1].toFixed(2)}；终点 ${row.outcome?.[0].replace('T',' ')||'未到'}：${row.outcome?.[1].toFixed(2)||'待评估'}；涨跌幅 ${move(row.priceMove)}。${outcomeLabel(row)}（${row.side==='low'?'低序列看上涨':'高序列看下跌'}）。`;
 function openChart(row){const snapshot=NineCharts.snapshot(data,row);el('nine-dialog-title').textContent=data.indices[row.index]+' · '+periodName(row.period)+' · '+model.sides[row.side]+stages[row.stage];el('nine-dialog-chart').innerHTML=NineCharts.svg(snapshot);el('nine-dialog-caption').textContent=chartCaption(row);el('nine-chart-dialog').showModal();}
 async function renderGallery(){
  const version=++galleryVersion,o=options(),stage=el('nine-example-stage').value,rows=rowsFor(o,stage);chartRows=[];el('nine-gallery').dataset.ready='false';
  el('nine-example-description').textContent=`${periodName(o.period)} · ${stage==='ten'?'10':'9'}后第${o.horizon}根；低序列以收盘上涨为成功，高序列以收盘下跌为成功；持平算未命中。切换周期、指数或N，图例一起更新。`;
  el('nine-gallery').innerHTML=qs.map(q=>{const examples=NineCharts.examples(rows,q);return `<section class="example-group"><h3>${model.trends[q.trend]} · ${model.sides[q.side]}${stage==='ten'?'10':'9'} · 看${target(q.side)}</h3><div class="example-pair">${[true,false].map(success=>{const row=examples[success?'success':'failure'];if(!row)return `<div class="example-empty">当前筛选没有已到终点的${success?target(q.side)+'成功':'未'+target(q.side)}图例。</div>`;const id=chartRows.push(row)-1;return `<figure class="example-card" data-example="${id}"><div class="example-heading"><span class="result-badge ${success?'win':'loss'}">${success?target(q.side)+'成功':'未'+target(q.side)}</span><strong>${move(row.priceMove)}</strong></div><div class="chart-preview" id="nine-image-${id}" aria-label="${esc(chartCaption(row))}">${NineCharts.svg(NineCharts.snapshot(data,row))}</div><figcaption>${esc(data.indices[row.index]+' · '+row.time.replace('T',' '))}<span>${esc(stages[stage]+'价 '+row.entry[1].toFixed(2)+' → 终点 '+row.outcome[1].toFixed(2))}</span><span>${row.tenStatus==='valid'?'连续10成立，图中标蓝色10':row.tenStatus==='invalid'?'下一根未续数到10，图中不标10':'仍待下一根判断10'}</span></figcaption><div class="example-actions"><button type="button" data-chart-open="${id}">放大看K线</button><a id="nine-download-${id}" download="nine-${row.index}-${row.period}-${row.time.replace(/[^0-9]/g,'')}-${stage}-N${o.horizon}.png" hidden>下载PNG</a></div></figure>`;}).join('')}</div></section>`;}).join('');
  const currentRows=[...chartRows];await Promise.all(currentRows.map(async(row,id)=>{
   const box=el('nine-image-'+id);if(!box)return;const svg=box.querySelector('svg');
   try{const png=await NineCharts.png(svg);if(version!==galleryVersion)return;const image=new Image();image.alt=chartCaption(row);image.width=960;image.height=400;image.src=png;box.replaceChildren(image);const a=el('nine-download-'+id);a.href=png;a.hidden=false;}catch(error){if(version===galleryVersion)console.error('K-line PNG generation failed',error);}
  }));
  if(version===galleryVersion)el('nine-gallery').dataset.ready='true';
 }
 function renderCases(){
  const o=options(),c=selected||{stage:'nine',trend:'all',side:'all'},rows=rowsFor(o,c.stage,c.trend,c.side).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index),s=facts(rows);
  el('nine-case-caption').textContent=`${periodName(o.period)} · ${label(c.trend,c.side)} · ${stages[c.stage]} · ${rows.length}个样本，已评估${s.evaluated}，待评估${s.pending}。${c.stage.startsWith('paired')?'共同终点固定为9后第'+o.horizon+'根。':'终点为各自信号后第'+o.horizon+'根。'}`;
  const point=p=>p?esc(p[0].replace('T',' '))+'<span class="sub">'+p[1].toFixed(2)+'</span>':'待评估';
  const pages=Math.max(1,Math.ceil(rows.length/10));casePage=Math.min(casePage,pages-1);
  el('nine-records').innerHTML=rows.slice(casePage*10,(casePage+1)*10).map(row=>`<tr><td>${esc(data.indices[row.index])}<span class="sub">${periodName(row.period)}</span></td><td>${model.sides[row.side]}9 · ${model.trends[row.trend]}<span class="sub">序列前MA60 ${row.trendMa[0]?.toFixed(2)||'不足'} / 5根前 ${row.trendMa[1]?.toFixed(2)||'不足'}</span></td><td>${point([row.time,row.close])}</td><td>${row.tenStatus==='valid'?'10成立':row.tenStatus==='invalid'?'未续数到10':'待下一根'}${row.observedCheck?'<span class="sub">'+point(row.observedCheck)+'</span>':''}</td><td>${point(row.entry)}</td><td>${point(row.outcome)}</td><td>${move(row.priceMove)}</td><td>${outcomeLabel(row)}${row.outcome?'<button class="record-chart" type="button" data-record-chart="'+rows.indexOf(row)+'">看K线</button>':''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">当前筛选没有序列</td></tr>';
  el('nine-records').querySelectorAll('[data-record-chart]').forEach(b=>b.addEventListener('click',()=>openChart(rows[Number(b.dataset.recordChart)])));
  el('nine-pagination').hidden=pages<2;el('nine-prev').disabled=casePage===0;el('nine-next').disabled=casePage+1>=pages;el('nine-page').textContent=(casePage+1)+' / '+pages;
 }
 el('nine-definitions').innerHTML=Object.entries({'9与10':model.definition.count,'反转方向命中':'低9/低10的终点收盘高于信号收盘才算上涨成功；高9/高10的终点收盘低于信号收盘才算下跌成功。持平不命中，没到终点单列待评估。这是定长方向命中，不等于趋势已彻底反转，也不是按下一根开盘成交的收益。','趋势分组':model.definition.trend,'趋势未知':'序列前至少65根行情才可比较MA60方向；不足或均线持平不硬分四组，但保留在总体统计中。','同批9':'只保留后来续数到10的那些9。这种筛选在9当时尚不可知，只作事后归因对照。','共同终点':'在同批样本中再把终点固定为9后第N根，分别用9价和10价计算，避免10多观察一根。','图例':'使用与统计完全同批的原始OHLC和收盘MA60；每段首次9记录一次，延续计数不会反复制造9信号。按日期取最近成功/失败，不按涨幅挑选。','范围':'以第9根日期选择样本，超过截止日的10和终点按未知。全部比例均未扣费用、滑点。'}).map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('');
 el('nine-study').addEventListener('click',event=>{
  const open=event.target.closest('[data-chart-open]');if(open){openChart(chartRows[Number(open.dataset.chartOpen)]);return;}
  const b=event.target.closest('button[data-nine-stage]');if(!b||b.disabled)return;
  el('nine-period').value=b.dataset.ninePeriod;selected={stage:b.dataset.nineStage,trend:b.dataset.nineTrend,side:b.dataset.nineSide};casePage=0;render();el('nine-cases').open=true;el('nine-cases').scrollIntoView({block:'start'});
 });
 for(const id of ['index','scope','study-warmup','nine-period','nine-horizon'])el(id).addEventListener('change',()=>{selected=null;casePage=0;render();});
 el('nine-example-stage').addEventListener('change',renderGallery);
 el('nine-reset').addEventListener('click',()=>{selected=null;casePage=0;renderCases();});
 el('nine-prev').addEventListener('click',()=>{casePage--;renderCases();});el('nine-next').addEventListener('click',()=>{casePage++;renderCases();});
 el('nine-dialog-close').addEventListener('click',()=>el('nine-chart-dialog').close());
 render();
}
