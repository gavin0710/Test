/* Buy1 features and entry timing, shared by archive generation and the dashboard. */
"use strict";
const BuyPatterns = (() => {
  const metrics = typeof module === "object" && module.exports ? require("./analysis-metrics.js") : SuccessAnalysis;
  const { horizons, day, sampleRange, summarize } = metrics;
  const higherPeriods = { "15":"60", "60":"120", "90":"D", "120":"D", D:"W" };
  const rules = [
    ["all","全部买1","不筛选买1形态。","base"],
    ["cross_now","当根DIF金叉","买1当根DIF上穿DEA，前一根DIF不高于DEA。","main"],
    ["negative_hist_contract2","绿柱连续缩短","连续3根MACD柱为负，最近两次均向零轴缩短。","main"],
    ["low9_recent3","近3根出现低9","买1当根或此前2根首次达到低9，延续显示不重复计。","main"],
    ["resonance2","四指同向≥2","四指同期行情齐全，当根及此前2根至少2指有同向买点。","main"],
    ["below0_and_contract2","零轴下＋绿柱缩短","DIF<0，且绿柱连续两次缩短。","combo"],
    ["contract2_and_low9","绿柱缩短＋低9","绿柱连续两次缩短，且近3根首次出现低9。","combo"],
    ["higher_up_and_contract2","大周期上行＋绿柱缩短","最近已完成大周期DIF上行，且本周期绿柱连续两次缩短。","combo"],
    ["higher_up_and_low9","大周期上行＋低9","最近已完成大周期DIF上行，且本周期近3根首次出现低9。","combo"],
    ["resonance_and_low9","共振＋低9","四指同向≥2，且本周期近3根首次出现低9。","combo"],
    ["higher_up_and_resonance","大周期上行＋共振","最近已完成大周期DIF上行，且四指同向≥2。","combo"],
    ["dif_below0","DIF在零轴下","买1当根DIF<0。","other"],
    ["dif_above0","DIF在零轴上","买1当根DIF>0。","other"],
    ["dif_above_dea","DIF已在DEA上方","买1当根DIF>DEA，不要求当根才上穿。","other"],
    ["cross_recent3","近3根DIF金叉","买1当根或此前2根出现DIF上穿DEA。","other"],
    ["dea_rising","DEA上行","买1当根DEA高于前一根。与DIF>DEA数学等价，不算独立共振。","other"],
    ["negative_hist_contract","绿柱开始缩短","买1当根MACD柱<0，且高于前一根。","other"],
    ["low_setup6to9","低位计数6至9","本周期九转当前向下计数为6至9。","other"],
    ["higher_dif_rising","大周期DIF上行","只用买1确认时已完成的大周期，DIF高于其前一根。","other"],
    ["higher_above_dea","大周期DIF>DEA","只用买1确认时已完成的大周期，DIF在DEA上方。","other"]
  ].map(([id,label,definition,family]) => ({ id,label,definition,family }));
  const ruleMap = Object.fromEntries(rules.map(rule => [rule.id,rule]));
  const knownAt = (period,time) => period === "D" || period === "W" ? day(time) + "T15:08" : time;
  const stamp = time => Date.parse((time.length===10 ? time+"T15:00" : time)+"+08:00");
  const cross = (v,i) => i>0 && v.dif[i]>v.dea[i] && v.dif[i-1]<=v.dea[i-1];
  const and = (...values) => values.some(v=>v===null) ? null : values.every(Boolean);
  function latestKnown(bars,period,time) {
    let lo=0,hi=bars.length;
    while(lo<hi) { const mid=(lo+hi)>>>1; if(knownAt(period,bars[mid].t)<=time) lo=mid+1; else hi=mid; }
    return lo-1;
  }
  function enrich(samples,series) {
    return samples.map(row => {
      if(row.signal!=="buy") return row;
      const v=series[row.index][row.period].result, i=row.barIndex, bars=v.bars;
      const higherPeriod=higherPeriods[row.period], higher=higherPeriod ? series[row.index][higherPeriod].result : null;
      const confirmedAt=knownAt(row.period,row.time), h=higher ? latestKnown(higher.bars,higherPeriod,confirmedAt) : -1;
      const contract2=i>=2 && [i,i-1,i-2].every(j=>v.hist[j]<0) && v.hist[i]>v.hist[i-1] && v.hist[i-1]>v.hist[i-2];
      const higherUp=h>=1 ? higher.dif[h]>higher.dif[h-1] : null;
      const features={
        all:true, dif_below0:v.dif[i]<0, dif_above0:v.dif[i]>0,
        dif_above_dea:v.dif[i]>v.dea[i], cross_now:cross(v,i),
        cross_recent3:[i,i-1,i-2].some(j=>cross(v,j)),
        dea_rising:i>0 && v.dea[i]>v.dea[i-1],
        negative_hist_contract:i>0 && v.hist[i]<0 && v.hist[i]>v.hist[i-1],
        negative_hist_contract2:contract2, low9_recent3:row.nineAge!==null,
        low_setup6to9:v.nine[i]<=-6, resonance2:row.covered===4 ? row.matched>=2 : null,
        higher_dif_rising:higherUp, higher_above_dea:h>=0 ? higher.dif[h]>higher.dea[h] : null
      };
      Object.assign(features,{
        below0_and_contract2:and(features.dif_below0,contract2),
        contract2_and_low9:and(contract2,features.low9_recent3),
        higher_up_and_contract2:and(higherUp,contract2),
        higher_up_and_low9:and(higherUp,features.low9_recent3),
        resonance_and_low9:and(features.resonance2,features.low9_recent3),
        higher_up_and_resonance:and(higherUp,features.resonance2)
      });
      let entryAt=v.dif[i]>v.dea[i] ? i : null;
      const checks=Array.from(bars.slice(i+1,i+6),bar=>bar.t);
      if(entryAt===null) for(let j=i+1;j<=Math.min(i+5,bars.length-1);j++) if(cross(v,j)) {entryAt=j;break;}
      const delayed={
        checks, status:entryAt!==null ? "entered" : checks.length===5 ? "expired" : "waiting",
        entry:entryAt!==null ? [bars[entryAt].t,bars[entryAt].c] : null,
        delay:entryAt!==null ? entryAt-i : null,
        forward:horizons.map(n=>entryAt!==null && bars[entryAt+n] ? [bars[entryAt+n].t,bars[entryAt+n].c] : null)
      };
      return {...row,pattern:{knownAt:confirmedAt,features,values:{
        dif:v.dif[i],dea:v.dea[i],hist:v.hist[i],nine:v.nine[i],
        higher:h>=0 ? {period:higherPeriod,time:higher.bars[h].t,knownAt:knownAt(higherPeriod,higher.bars[h].t),dif:higher.dif[h],dea:higher.dea[h]} : null
      },delayed}};
    });
  }
  function evaluate(data,options={}) {
    const {index="all",scope="all",horizon=10,rule="all",entryMode="signal",minBars=0}=options;
    if(!ruleMap[rule] || !horizons.includes(horizon)) throw new Error("Invalid pattern observation");
    const rows=metrics.evaluate(data,{mode:"buy",index,scope,horizon}).filter(row=>row.barIndex+1>=minBars && row.pattern);
    return rows.flatMap(row=>{
      const flag=row.pattern.features[rule];
      if(flag!==true) return [];
      const entry=[row.time,row.close];
      if(entryMode!=="delayed") return [{...row,entry,delay:0,entryStatus:"entered"}];
      const d=row.pattern.delayed, range=sampleRange(data,row.period,scope);
      const observed=d.entry && day(d.entry[0])<=range.to;
      const status=observed ? "entered" : d.checks.filter(t=>day(t)<=range.to).length===5 ? "expired" : "waiting";
      const outcome=observed && d.forward[horizons.indexOf(horizon)] && day(d.forward[horizons.indexOf(horizon)][0])<=range.to ? d.forward[horizons.indexOf(horizon)] : null;
      return [{...row,entry:observed ? d.entry : null,delay:observed ? d.delay : null,entryStatus:status,outcome,
        result:outcome ? (outcome[1]/d.entry[1]-1)*100 : null,
        minutes:outcome ? (stamp(outcome[0])-stamp(d.entry[0]))/60000 : null}];
    });
  }
  function compare(data,options={}) {
    const {rule="all"}=options;
    const baseline=evaluate(data,{...options,rule:"all"}).filter(row=>row.pattern.features[rule]!==null);
    const rows=evaluate(data,options);
    return {rows,eligibleRows:baseline,stats:summarize(rows),baseline:summarize(baseline)};
  }
  function delayedSummary(rows) {
    const entered=rows.filter(row=>row.entryStatus==="entered");
    return {...summarize(entered),signals:rows.length,entered:entered.length,
      expired:rows.filter(row=>row.entryStatus==="expired").length,
      waiting:rows.filter(row=>row.entryStatus==="waiting").length};
  }
  function paired(rows,horizon=10) {
    return rows.flatMap(row=>{
      const end=row.forward[horizons.indexOf(horizon)];
      // The original endpoint has already been censored by scope when unavailable.
      if(!row.entry || !end || !row.rangeEnd || day(end[0])>row.rangeEnd || row.entry[0]>end[0]) return [];
      return [{...row,outcome:end,result:(end[1]/row.entry[1]-1)*100,minutes:(stamp(end[0])-stamp(row.entry[0]))/60000,
        earlyResult:(end[1]/row.close-1)*100}];
    });
  }
  function evaluateDelayed(data,options={}) {
    return evaluate(data,{...options,rule:"all",entryMode:"delayed"}).map(row=>({...row,rangeEnd:sampleRange(data,row.period,options.scope||"all").to}));
  }
  return {rules,ruleMap,higherPeriods,knownAt,latestKnown,enrich,evaluate,compare,delayedSummary,evaluateDelayed,paired};
})();
if(typeof module==="object" && module.exports) module.exports=BuyPatterns;

/* Browser view; not invoked by the Node archive generator. */
function mountBuyPatternStudy(data) {
 const el=id=>document.getElementById(id), model=BuyPatterns, metrics=SuccessAnalysis;
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const pct=value=>value===null ? "—" : (value*100).toFixed(1)+"%";
 const move=value=>value===null ? "—" : (value>0 ? "+" : "")+value.toFixed(2)+"%";
 const periodLabel=id=>data.periods.find(p=>p.id===id).label;
 const scopeLabel={all:"各周期全历史",four:"四指共同历史",same:"六周期同窗"};
 let casePage=0, selected={period:"D",rule:"all",stage:"signal",scope:"selected",title:"上涨基准"};
 const ready=data.patternSchema===1 && data.samples.filter(r=>r.signal==="buy").every(r=>r.pattern && model.rules.every(rule=>typeof r.pattern.features[rule.id]==="boolean" || r.pattern.features[rule.id]===null));
 if(!ready) {el("pattern-status").textContent="形态研究样本正在更新，请稍后刷新。下方原有交易统计仍可查看。";return;}
 if(el("history-rule")) el("history-rule").innerHTML=model.rules.filter(r=>r.id!=="all").map(r=>'<option value="'+r.id+'">'+esc(r.label)+'</option>').join("");
 if(el("history-rule")) el("history-rule").value="low9_recent3";
 const options=()=>({index:el("index").value==="all" ? "all" : Number(el("index").value),scope:el("scope").value,horizon:Number(el("study-horizon").value),minBars:Number(el("study-warmup").value)});
 function comparison(period,opts) {
  const c=model.compare(data,opts), rows=c.rows.filter(r=>r.period===period), eligible=c.eligibleRows.filter(r=>r.period===period);
  return {rows,stats:metrics.summarize(rows),baseline:metrics.summarize(eligible)};
 }
 function rateButton(period,stats,{rule="all",stage="signal",scope="selected",reference=null,title="",rateOnly=false}={}) {
  const count=stats.evaluated ? stats.wins+" / "+stats.evaluated : "0 / 0";
  const pending=" · 待"+stats.pending;
  const label=periodLabel(period)+" "+(title||model.ruleMap[rule].label)+" 上涨率 "+pct(stats.rate)+"，上涨 "+count+pending+"，查看样本";
  return '<button type="button" class="study-rate'+(stats.evaluated<20 ? " small" : "")+'" data-study-period="'+period+'" data-study-rule="'+rule+'" data-study-stage="'+stage+'" data-study-scope="'+scope+'" data-study-title="'+esc(title)+'" aria-label="'+esc(label)+'"'+((stats.signals??stats.total) ? "" : " disabled")+'><strong>'+pct(stats.rate)+'</strong>'+(rateOnly ? "" : '<span>'+count+pending+'</span>')+
    (reference ? '<span class="reference">可比基准 '+pct(reference.rate)+' · '+reference.wins+'/'+reference.evaluated+'</span>' : "")+'</button>';
 }
 function render() {
  const o=options(), rows=model.evaluate(data,o), summary=metrics.summarize(rows);
  if(el("buy-study")){
  el("study-scope").textContent=scopeLabel[o.scope];
  el("buy-description").textContent="买入价取买1收盘，终点取后第"+o.horizon+"根同周期已完成K线收盘。已评估"+summary.evaluated+"个买1，待评估"+summary.pending+"个。"+
   (o.minBars ? "仅保留买1当根已累计至少"+o.minBars+"根行情的信号。" : "");
  el("buy-baseline").innerHTML=data.periods.map(({id,label})=>{
   const s=metrics.summarize(rows.filter(r=>r.period===id));
   const duration=s.medianMinutes===null ? "—" : s.medianMinutes<1440 ? (s.medianMinutes/60).toFixed(1)+"小时" : (s.medianMinutes/1440).toFixed(0)+"天";
   return '<tr><th scope="row">'+esc(label)+'</th><td>'+rateButton(id,s,{title:"上涨基准",rateOnly:true})+'</td><td>'+s.wins+' / '+s.evaluated+'</td><td>'+s.pending+'</td><td>'+move(s.medianMove)+'</td><td>'+duration+'</td></tr>';
  }).join("");
  }
  if(el("shape-study")){
  const rules=model.rules.filter(r=>r.family===el("pattern-family").value);
  el("pattern-head").innerHTML='<tr><th scope="col">周期</th><th scope="col">全部买1<br><span class="sub">上涨基准</span></th>'+rules.map(r=>'<th scope="col">'+esc(r.label)+'</th>').join("")+'</tr>';
  el("pattern-head").parentElement.style.minWidth=Math.max(760,76+132*(rules.length+1))+"px";
  el("pattern-definitions").innerHTML=rules.map(r=>'<div><dt>'+esc(r.label)+'</dt><dd>'+esc(r.definition)+'</dd></div>').join("")+
   '<div><dt>大周期怎么对应</dt><dd>15→60分钟，60→120分钟，90/120分钟→日线，日线→周线。只使用当时已完成的大周期；周线无更高周期数据。</dd></div><div><dt>九转计数口径</dt><dd>沿用主图收盘价与前4根比较的连续计数，本研究不含TD13倒计数。</dd></div>';
  el("pattern-body").innerHTML=data.periods.map(({id,label})=>'<tr><th scope="row">'+esc(label)+'</th><td>'+rateButton(id,comparison(id,{...o,rule:"all"}).stats)+'</td>'+
   rules.map(rule=>{
    const c=comparison(id,{...o,rule:rule.id});
    return '<td>'+rateButton(id,c.stats,{rule:rule.id,reference:c.baseline})+'</td>';
   }).join("")+'</tr>').join("");
  }
  if(el("wait-study")){
  const delayed=model.evaluateDelayed(data,o);
  el("delay-end-label").textContent="实际入场后第"+o.horizon+"根";
  el("wait-body").innerHTML=data.periods.map(({id,label})=>{
   const group=delayed.filter(r=>r.period===id), s=model.delayedSummary(group), original=metrics.summarize(rows.filter(r=>r.period===id));
   return '<tr><th scope="row">'+esc(label)+'</th><td>'+rateButton(id,original,{title:"买1直接买"})+'</td><td>'+
    rateButton(id,s,{stage:"wait",title:"等金叉确认后买"})+'</td><td>'+s.entered+' / '+s.signals+'</td><td>'+s.expired+'</td><td>'+s.waiting+'</td></tr>';
  }).join("");
  const paired=model.paired(delayed,o.horizon);
  el("paired-body").innerHTML=data.periods.map(({id,label})=>{
   const group=paired.filter(r=>r.period===id), late=metrics.summarize(group);
   const early=metrics.summarize(group.map(r=>({...r,result:r.earlyResult})));
   const delays=group.map(r=>r.delay).sort((a,b)=>a-b), mid=Math.floor(delays.length/2), median=delays.length ? delays.length%2 ? delays[mid] : (delays[mid-1]+delays[mid])/2 : null;
   return '<tr><th scope="row">'+esc(label)+'</th><td>'+group.length+'</td><td>'+rateButton(id,early,{stage:"pairEarly",title:"共同样本·买1价"})+'</td><td>'+rateButton(id,late,{stage:"pairWait",title:"共同样本·确认价"})+'</td><td>'+(median===null ? "—" : median+"根")+'</td></tr>';
  }).join("");
  }
  if(el("history-study")){
  const historyRule=el("history-rule").value;
  el("history-body").innerHTML=data.periods.map(({id,label})=>'<tr><th scope="row">'+esc(label)+'</th>'+["all","four"].map(scope=>{
   const c=comparison(id,{...o,scope,rule:historyRule});
   const range=metrics.sampleRange(data,id,scope), coverage=data.coverage.filter(r=>r.period===id && (o.index==="all" || o.index===r.index));
   const from=scope==="all" ? coverage.map(r=>r.from.slice(0,10)).sort()[0] : range?.from;
   const to=scope==="all" ? coverage.map(r=>r.to.slice(0,10)).sort().at(-1) : range?.to;
   return '<td>'+rateButton(id,c.stats,{rule:historyRule,scope,reference:c.baseline,title:"历史对照·"+model.ruleMap[historyRule].label})+
    '<p class="history-range">行情 '+esc(from||"无共同历史")+(to ? " 至 "+esc(to) : "")+'<br>已评估信号分布 '+c.stats.signalDays+' 日</p></td>';
  }).join("")+'</tr>').join("");
  }
  renderCases();
 }
 function renderCases() {
  const o={...options(),scope:selected.scope==="selected" ? options().scope : selected.scope,rule:selected.rule};
  let rows;
  if(selected.stage==="wait") rows=model.evaluateDelayed(data,o);
  else if(selected.stage==="pairWait" || selected.stage==="pairEarly") {
   rows=model.paired(model.evaluateDelayed(data,o),o.horizon);
   if(selected.stage==="pairEarly") rows=rows.map(r=>({...r,entry:[r.time,r.close],delay:0,result:r.earlyResult}));
  } else rows=model.evaluate(data,o);
  rows=rows.filter(r=>r.period===selected.period).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index);
  const s=selected.stage==="wait" ? model.delayedSummary(rows) : metrics.summarize(rows);
  const title=selected.title || model.ruleMap[selected.rule].label;
  el("study-case-caption").textContent=periodLabel(selected.period)+" · "+title+" · "+scopeLabel[o.scope]+" · 后"+o.horizon+"根 · "+rows.length+"个原买1信号，已评估"+s.evaluated+"个，分布"+s.signalDays+"日。"+
   (selected.stage==="wait" ? "入场"+s.entered+"个，5根未确认"+s.expired+"个，仍在等待"+s.waiting+"个。" : "");
  const pages=Math.max(1,Math.ceil(rows.length/10));casePage=Math.min(casePage,pages-1);
  const price=point=>point ? esc(point[0].replace("T"," "))+'<span class="sub">'+point[1].toFixed(2)+'</span>' : "—";
  el("study-records").innerHTML=rows.slice(casePage*10,(casePage+1)*10).map(row=>{
   const v=row.pattern.values, higher=v.higher;
   let state=row.entryStatus==="expired" ? "5根内未确认" : row.entryStatus==="waiting" ? "等待金叉" : row.result===null ? "待观察终点" : row.result>0 ? "上涨" : "未上涨";
   const fact='DIF '+v.dif.toFixed(3)+' · DEA '+v.dea.toFixed(3)+'<span class="sub">MACD '+v.hist.toFixed(3)+' · 九转 '+v.nine+'</span>'+
    (selected.rule.includes("higher") ? '<span class="sub">已完成'+(higher ? periodLabel(higher.period)+" "+esc(higher.time) : "大周期缺档")+'</span>' : "");
   return '<tr><td>'+esc(data.indices[row.index])+'</td><td>'+price([row.time,row.close])+'</td><td>'+fact+'</td><td>'+price(row.entry)+
    (row.delay ? '<span class="sub">等待'+row.delay+'根</span>' : "")+'</td><td>'+price(row.outcome)+'</td><td class="'+(row.result>0 ? "win" : row.result<0 ? "loss" : "")+'">'+move(row.result)+'</td><td>'+state+'</td></tr>';
  }).join("") || '<tr><td class="empty" colspan="7">当前条件没有符合的信号</td></tr>';
  el("study-pagination").hidden=pages<2;el("study-prev").disabled=casePage===0;el("study-next").disabled=casePage+1>=pages;el("study-page").textContent=(casePage+1)+" / "+pages;
 }
 function drill(event) {
  const button=event.target.closest("button[data-study-period]");if(!button || button.disabled)return;
  selected={period:button.dataset.studyPeriod,rule:button.dataset.studyRule,stage:button.dataset.studyStage,scope:button.dataset.studyScope,title:button.dataset.studyTitle};
  casePage=0;renderCases();el("study-cases").open=true;
  const summary=el("study-cases").querySelector("summary");summary.focus({preventScroll:true});summary.scrollIntoView({block:"start"});
 }
 for(const id of ["buy-study","shape-study","wait-study","history-study"])el(id)?.addEventListener("click",drill);
 for(const id of ["index","scope","study-horizon","study-warmup","pattern-family","history-rule"])el(id)?.addEventListener("change",()=>{casePage=0;render();});
 el("study-prev").addEventListener("click",()=>{casePage--;renderCases();});el("study-next").addEventListener("click",()=>{casePage++;renderCases();});
 render();
}
