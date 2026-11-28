/* Causal price experiment; it does not alter the live trading engine. */
"use strict";
const EarlyResearch=(()=>{
 const metrics=typeof module==='object'&&module.exports?require('./analysis-metrics.js'):SuccessAnalysis;
 const plans={standard:'等结构入场',nine:'钝化＋低9提前入场',watch:'钝化即入场'};
 const definition={
  sample:'与主图至少60根行情要求一致，只从第60根起出现的首次底钝化建档，含后来形成结构、钝化失效及仍在等待的样本。低9方案只取有效钝化内、买1之前首次达到的低9；与买1同根或钝化前的低9不算提前。',
  entry:'各方案信号收盘确认后，按下一根已完成K线开盘价计算。时间标记沿用该根K线的归档标签；分钟标签为收盘时刻，周线为周K线日期标记；均取该根开盘价，不表示在标签所示时刻成交。',
  exit:'结构形成前遇钝化失效/观察结束，下一根开盘退出；形成后沿用该买1独立单元的原始止损/顶部卖点，下一根开盘退出。截止仍持有则按统一终点收盘计价，不称为已平仓收益。',
  cohort:'主研究只取钝化内出现提前低9的同一批机会，统一终点为低9后第N根。低9到来前无法识别哪些钝化会进入主研究，因此其中钝化即入仅为事后同批对照，完整筛选价值看全部钝化。全部钝化对照统一从钝化后第N根截止；期间未触发/来不及执行的方案按空仓0%参与同批均值，但不计入入场正收益比例。',
  limits:'这是独立机会、等名义敞口的指数价格实验，未模拟ETF、资金约束、费用、滑点和真实成交。原正式MACD信号和仓位规则保持不变。'
 };
 function buildRows(series,periods,engine){
  const {higherPeriods,knownAt,latestKnown}=require('./analysis-patterns.js');
  const rows=[];
  for(const{id:period}of periods){
   const peers=series.map(s=>{const v=s[period];return {bars:v.bars,at:new Map(v.bars.map((b,i)=>[b.t,i])),buy:new Set((v.result?.events||[]).filter(e=>engine.BUY_EVENTS.has(e.type)).map(e=>e.i))};});
   for(let index=0;index<series.length;index++){
    const v=series[index][period],{bars,result}=v;if(!result)continue;const raw=engine.scanStructure(bars,result.dif,result.hist).events;
    const sums=[0];for(const b of bars)sums.push(sums.at(-1)+b.c);
    const ma=i=>i>=59?(sums[i+1]-sums[i-59])/60:null;
    const context=i=>{
     const hp=higherPeriods[period],higher=hp?series[index][hp]:null,h=higher?latestKnown(higher.bars,hp,knownAt(period,bars[i].t)):-1;
     let covered=0,matched=0;for(const p of peers){const at=p.at.get(bars[i].t);if(at===undefined||at<2||i<2||p.bars[at-1].t!==bars[i-1].t||p.bars[at-2].t!==bars[i-2].t)continue;covered++;if([at,at-1,at-2].some(j=>p.buy.has(j)))matched++;}
     return {higher:hp||null,higherAt:h>=0?higher.bars[h].t:null,higherUp:h>=1?higher.result.dif[h]>higher.result.dif[h-1]:null,covered,matched};
    };
    for(const w of raw.filter(e=>e.type==='watchBuy'&&e.i>=59)){
     const end=raw.find(e=>e.regionStart===w.regionStart&&e.i>=w.i&&['buy','invalid','expired'].includes(e.type));
     const stop=end?.type==='buy'?result.trades.find(t=>t.entryType==='buy'&&t.entryI===end.i):null;
     let nine=null;for(let i=w.i;i<(end?.i??bars.length);i++)if(result.nine[i]===-9&&result.nine[i-1]!==-9){nine=i;break;}
     const a=ma(w.i-1),b=ma(w.i-6),eps=Math.max(Math.abs(a||0),1)*1e-12;
     rows.push({index,period,id:period+':'+index+':'+w.i,watch:w.i,nine,formed:end?.type==='buy'?end.i:null,
      resolution:end?{i:end.i,type:end.type}:null,exit:stop?{i:stop.exitI,type:stop.exitType}:null,
      refDif:w.ref.dif,refClose:w.ref.close,regionStart:w.regionStart,trend:a===null||b===null?'unknown':a-b>eps?'up':a-b< -eps?'down':'flat',trendMa:[a,b],
      contextWatch:context(w.i),contextNine:nine!==null?context(nine):null});
    }
   }
  }
  return rows;
 }
 const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b),n=v.length;return n?(v[(n-1)>>1]+v[n>>1])/2:null;};
 const avg=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 function observations(data,options={}){
  const {index='all',period='all',scope='all',minBars=0}=options;
  return (data.earlySamples||[]).flatMap(row=>{
   const bars=data.nineHistory[row.index][row.period],range=metrics.sampleRange(data,row.period,scope),w=bars[row.watch];
   if(!w||!range||metrics.day(w[0])<range.from||metrics.day(w[0])>range.to||row.watch+1<minBars||(index!=='all'&&index!==row.index)||(period!=='all'&&period!==row.period))return [];
   const visible=i=>i!==null&&i!==undefined&&bars[i]&&metrics.day(bars[i][0])<=range.to;
   return [{...row,time:w[0],contextNine:visible(row.nine)?row.contextNine:null,nine:visible(row.nine)?row.nine:null,formed:visible(row.formed)?row.formed:null,
    resolution:row.resolution&&visible(row.resolution.i)?row.resolution:null,exit:row.exit&&visible(row.exit.i)?row.exit:null,rangeEnd:range.to}];
  });
 }
 function evaluate(data,options={}){
  const {horizon=10,cohort='nine',trend='all',higher='all',resonance='all'}=options;
  if(![5,10,20].includes(horizon)||!['nine','all'].includes(cohort))throw Error('Invalid early-entry observation');
  return observations(data,options).flatMap(row=>{
   const bars=data.nineHistory[row.index][row.period];
   if(cohort==='nine'&&row.nine===null)return [];
   const anchor=cohort==='nine'?row.nine:row.watch,ctx=cohort==='nine'?row.contextNine:row.contextWatch;
   if((trend!=='all'&&row.trend!==trend)||(higher==='up'&&ctx.higherUp!==true)||(resonance==='two'&&!(ctx.covered===4&&ctx.matched>=2)))return [];
   const limit=anchor+horizon,complete=!!bars[limit]&&metrics.day(bars[limit][0])<=row.rangeEnd;
   const available=Math.min(limit,bars.findLastIndex(b=>metrics.day(b[0])<=row.rangeEnd));
   const point=(i,field=4)=>i!==null&&i!==undefined&&bars[i]?[bars[i][0],bars[i][field],i]:null;
   const formed=row.formed!==null&&row.formed<=available?row.formed:null;
   const resolution=row.resolution&&row.resolution.i<=available?row.resolution:null;
   const beforeFailure=resolution&&resolution.type!=='buy'?resolution:null;
   const afterExit=row.exit&&row.exit.i<=available?row.exit:null;
   const exitSignal=beforeFailure||afterExit;
   const strategy=kind=>{
    const signal=kind==='watch'?row.watch:kind==='nine'?row.nine:formed;
    const i=signal===null?null:signal+1;
    const canEnter=i!==null&&i<=available&&bars[i]&&metrics.day(bars[i][0])<=row.rangeEnd;
    if(!canEnter)return {kind,signal:signal!==null&&signal<=available?point(signal):null,entry:null,exit:null,reason:signal!==null&&signal<=available?'等待下一根/窗口内未执行':'未触发',result:complete?0:null,mae:null,preMae:null,closed:false};
    // The stop is only executable after its close has been observed.
    const stop=exitSignal&&exitSignal.i>=i&&exitSignal.i+1<=available?exitSignal:null;
    const end=stop?stop.i+1:available,close=stop?bars[end][1]:bars[end][4],entry=bars[i][1];
    const path=bars.slice(i,stop?end:end+1).map(b=>b[3]);path.push(close,entry);
    const preEnd=Math.min(formed??available,end),prePath=bars.slice(i,preEnd+1).map(b=>b[3]);
    // If an exit has already executed at the open, its later intrabar low is unavailable to the position.
    if(stop&&preEnd===end)prePath.pop();prePath.push(entry,stop&&preEnd===end?close:bars[preEnd][4]);
    return {kind,signal:point(signal),entry:point(i,1),exit:[bars[end][0],close,end],reason:stop?(stop.type==='invalid'?'钝化失效':stop.type==='expired'?'钝化观察结束':stop.type==='stop'?'结构止损':'顶部卖点'):complete?'共同终点收盘计价':'尚未到共同终点',
     result:complete?100*(close/entry-1):null,mae:100*(Math.min(...path)/entry-1),preMae:kind==='standard'||(formed!==null&&formed<i)?0:100*(Math.min(...prePath)/entry-1),closed:!!stop};
   };
   const p=Object.fromEntries(Object.keys(plans).map(k=>[k,strategy(k)]));
   const early=p.nine.entry,standard=p.standard.entry;
   const comparable=!!early&&!!standard;
   return [{...row,cohort,anchor,limit,available,complete,formedInWindow:formed,resolutionInWindow:resolution,context:ctx,endpoint:complete?point(limit):null,plans:p,
    lead:comparable?standard[2]-early[2]:null,priceEdge:comparable?100*(standard[1]/early[1]-1):null,
    confirmationMove:formed!==null&&formed>0?100*(bars[formed][4]/bars[formed-1][4]-1):null,
    delta:complete?p.nine.result-p.standard.result:null}];
  });
 }
 function summarize(rows,kind='nine'){
  const mature=rows.filter(r=>r.complete),entered=mature.filter(r=>r.plans[kind].entry),returns=mature.map(r=>r.plans[kind].result),trades=entered.map(r=>r.plans[kind].result);
  const wins=trades.filter(v=>v>0),losses=trades.filter(v=>v<0);
  return {total:rows.length,evaluated:mature.length,pending:rows.length-mature.length,entered:entered.length,cash:mature.length-entered.length,
   mean:avg(returns),median:median(returns),winRate:entered.length?wins.length/entered.length:null,wins:wins.length,
   meanWin:avg(wins),meanLoss:avg(losses),worst:returns.length?Math.min(...returns):null,mae:median(entered.map(r=>r.plans[kind].mae)),preMae:median(entered.map(r=>r.plans[kind].preMae)),
   formed:mature.filter(r=>r.formedInWindow!==null).length,failed:mature.filter(r=>r.resolutionInWindow&&r.resolutionInWindow.type!=='buy').length,
   unresolved:mature.filter(r=>!r.resolutionInWindow).length,lead:median(mature.map(r=>r.lead)),priceEdge:median(mature.map(r=>r.priceEdge)),paired:mature.filter(r=>r.priceEdge!==null).length,
   delta:avg(mature.map(r=>r.delta)),positiveDelta:mature.filter(r=>r.delta>0).length,
   closed:entered.filter(r=>r.plans[kind].closed).length,marked:entered.filter(r=>!r.plans[kind].closed).length};
 }
 return {plans,definition,buildRows,observations,evaluate,summarize,median,avg};
})();
if(typeof module==='object'&&module.exports)module.exports=EarlyResearch;
