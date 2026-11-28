"use strict";
function mountEarlyStudy(data){
 const m=EarlyResearch,el=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),move=v=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%',pct=v=>v===null?'—':(v*100).toFixed(1)+'%',num=v=>v===null?'—':v.toFixed(1).replace(/\.0$/,'');
 if(data.earlySchema!==1)throw Error('Early-entry archive is not ready');
 const o=()=>({index:el('index').value==='all'?'all':Number(el('index').value),period:el('research-period').value,scope:el('scope').value,horizon:Number(el('research-horizon').value),cohort:el('research-cohort').value,trend:el('research-trend').value,higher:el('research-higher').value,resonance:el('research-resonance').value,minBars:Number(el('study-warmup').value)});
 const periodName=id=>data.periods.find(p=>p.id===id)?.label||id;
 const point=(p,open=false)=>p?esc(p[0].replace('T',' '))+'<span class="sub">'+(open?'开盘 ':'收盘 ')+p[1].toFixed(2)+'</span>':'—';
 const at=(row,i)=>i===null?null:[data.nineHistory[row.index][row.period][i][0],data.nineHistory[row.index][row.period][i][4],i];
 let rows=[],casePage=0,selectedId=null,current=null,version=0;
 const recordResult=p=>p.result===null?'待终点':p.entry?move(p.result):'空仓 0.00%';
 const metrics=(title,value,caption,small=false)=>'<div class="research-metric'+(small?' small':'')+'"><span>'+title+'</span><strong>'+value+'</strong><small>'+caption+'</small></div>';
 function render(){
  const options=o();rows=m.evaluate(data,options).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index);const s=m.summarize(rows),all=m.observations(data,options),formed=all.filter(r=>r.formed!==null).length,failed=all.filter(r=>r.resolution&&r.resolution.type!=='buy').length,hasNine=all.filter(r=>r.nine!==null).length;
  el('early-context').textContent=options.cohort==='nine'?'主研究：从低9当根往后数'+options.horizon+'根，三种方案在同一终点比较；没形成结构的失败机会仍保留。':'全部钝化对照：从钝化当根往后数'+options.horizon+'根；期间没触发或没来得及入场的方案按空仓0%纳入同批均值。';
  el('early-flow').innerHTML=[['底钝化',all.length],['已形成结构',formed],['失效／观察结束',failed],['仍在等待',all.length-formed-failed],['形成前出现低9',hasNine]].map(([t,n])=>'<div><span>'+t+'</span><strong>'+n+'</strong></div>').join('')+'<p>全貌按指数、周期、范围统计；下方策略对照再应用所选样本和条件。</p>';
  el('early-summary').textContent=periodName(options.period)+' · 同批机会'+s.total+'个，已到共同终点'+s.evaluated+'个，待评估'+s.pending+'个。价格优势仅取两种入场都已执行的'+s.paired+'个样本；收益差包含未形成结构的失败机会。';
  el('early-metrics').innerHTML=metrics('提前入场根数中位',num(s.lead)+'根','仅两种方案均入场：'+s.paired+'例',s.paired<20)+metrics('入场价格优势中位',move(s.priceEdge),'标准开盘价÷提前开盘价−1；正数更便宜',s.paired<20)+metrics('形成前不利波动中位',move(s.preMae),'含未形成时至失败退出／截止的浮亏',s.entered<20)+metrics('提前－标准平均收益',s.delta===null?'—':(s.delta>0?'+':'')+s.delta.toFixed(2)+'<em>个百分点</em>','同批'+s.evaluated+'例，空仓按0%',s.evaluated<20);
  el('early-reading').textContent=s.evaluated?`窗内形成结构${s.formed}例，失效／观察结束${s.failed}例，仍未形成${s.unresolved}例；提前方案收益更高${s.positiveDelta}/${s.evaluated}例。入场便宜与最终收益更好是两个结果，失败机会已经纳入均值。`:'当前筛选没有已到共同终点的样本。';
  el('early-strategies').innerHTML=['standard','nine','watch'].map(kind=>{const v=m.summarize(rows,kind);return `<tr data-strategy="${kind}" class="${kind==='nine'?'research-focus':''}"><th>${m.plans[kind]}${kind==='watch'&&options.cohort==='nine'?'<span class="sub">仅事后同批对照</span>':''}</th><td>${move(v.mean)}</td><td>${move(v.median)}</td><td>${pct(v.winRate)}<span class="sub">${v.wins}/${v.entered}</span></td><td>${v.cash} / ${v.pending}</td><td>${move(v.meanWin)} / ${move(v.meanLoss)}</td><td>${move(v.worst)}</td></tr>`;}).join('');
  el('early-exposure').textContent=`提前方案已入场的${s.entered}例中，${s.closed}例已按退出信号执行，${s.marked}例按共同终点收盘计价。表中正收益比例只以已入场且到终点样本为分母，不把空仓算成亏损交易。少于20例灰显。${options.cohort==='nine'?'主研究中的钝化即入只作事后对照，筛选价值另看全部钝化。':''}`;
  el('early-periods').innerHTML=data.periods.map(p=>{const rs=m.evaluate(data,{...options,period:p.id}),s=m.summarize(rs),a=m.summarize(rs,'standard'),b=m.summarize(rs,'watch');return `<tr class="${s.evaluated<20?'research-small':''}"><th><button type="button" data-early-period="${p.id}">${esc(p.label)}</button></th><td>${s.evaluated} / ${s.pending}</td><td>${move(a.mean)}</td><td>${move(s.mean)}</td><td>${move(b.mean)}</td><td>${s.delta===null?'—':(s.delta>0?'+':'')+s.delta.toFixed(2)}</td><td>${s.formed} / ${s.failed}</td></tr>`;}).join('');
  selectedId=null;casePage=0;renderRecords();renderExamples();
 }
 function renderRecords(){
  const pages=Math.max(1,Math.ceil(rows.length/10));casePage=Math.max(0,Math.min(casePage,pages-1));
  el('early-record-caption').textContent=rows.length+'个机会；未到共同终点单列，未入场为空仓，均未从样本中删除。';
  el('early-records').innerHTML=rows.slice(casePage*10,(casePage+1)*10).map(r=>`<tr><td>${esc(data.indices[r.index])}</td><td>${point(at(r,r.watch))}</td><td>${r.nine!==null&&r.nine<=r.available?point(at(r,r.nine)):'窗内未触发'}</td><td>${r.formedInWindow!==null?'结构形成':r.resolutionInWindow?r.resolutionInWindow.type==='invalid'?'钝化失效':'观察结束':r.complete?'N窗内未形成':'尚在观察'}</td><td>${recordResult(r.plans.standard)}</td><td>${recordResult(r.plans.nine)}</td><td>${r.delta===null?'待终点':(r.delta>0?'+':'')+r.delta.toFixed(2)+'点'}</td><td><button class="record-chart" type="button" data-early-case="${r.id}">看K线</button></td></tr>`).join('')||'<tr><td class="empty" colspan="8">当前条件没有符合的机会</td></tr>';
  el('early-pagination').hidden=pages<2;el('early-prev').disabled=casePage===0;el('early-next').disabled=casePage+1>=pages;el('early-page').textContent=(casePage+1)+' / '+pages;
 }
 const categories=[['failed','最近钝化失败、未形成结构',r=>r.resolutionInWindow&&r.resolutionInWindow.type!=='buy'&&r.plans.nine.entry],['better','最近提前买得更低、收益更好',r=>r.priceEdge>0&&r.delta>0],['expensive','最近提前反而买贵',r=>r.priceEdge!==null&&r.priceEdge<0],['risk','确认前浮亏最大的一例',r=>r.plans.nine.entry],['latest','最近已到共同终点的机会',r=>true]];
 function renderExamples(){
  const last=el('early-example-type').value,done=rows.filter(r=>r.complete);
  el('early-example-type').innerHTML=categories.map(([id,t,test])=>'<option value="'+id+'"'+(done.some(test)?'':' disabled')+'>'+t+'</option>').join('');
  const available=categories.filter(([, ,test])=>done.some(test));
  el('early-example-type').value=available.some(c=>c[0]===last)?last:available[0]?.[0]||'failed';
  if(selectedId){const r=rows.find(r=>r.id===selectedId);if(r){showCase(r);return;}}
  const category=categories.find(c=>c[0]===el('early-example-type').value),matches=done.filter(category?.[2]||(()=>true));
  if(category?.[0]==='risk')matches.sort((a,b)=>a.plans.nine.preMae-b.plans.nine.preMae||b.time.localeCompare(a.time));
  showCase(matches[0]||done[0]||rows[0]||null);
 }
 async function showCase(row){
  const serial=++version;current=row;el('early-chart').dataset.sample=row?.id||'';el('early-download').hidden=true;el('early-chart').dataset.ready='false';
  if(!row){el('early-case-title').textContent='当前筛选没有符合条件的样本。';el('early-chart').innerHTML='';el('early-timeline').innerHTML='';el('early-case-plans').innerHTML='';el('early-zoom').disabled=true;el('early-chart').dataset.ready='true';return;}
  el('early-zoom').disabled=false;
  const names={up:'钝化前MA60上行',down:'钝化前MA60下行',flat:'均线走平',unknown:'趋势历史不足'};
  el('early-case-title').textContent=data.indices[row.index]+' · '+periodName(row.period)+' · '+names[row.trend]+' · '+(row.complete?'已到共同终点':'N根终点尚未到达')+'。时间沿用K线标签，入场取该根开盘，不是在标签所示收盘时刻成交。'+(row.confirmationMove===null?'窗内尚无结构形成。':'形成当根相对前收涨跌 '+move(row.confirmationMove)+'，不能直接当作提前入场新增收益。');
  const items=[['底钝化',at(row,row.watch)],['首次低9',row.nine!==null&&row.nine<=row.available?at(row,row.nine):null],['提前开盘入场',row.plans.nine.entry],['DIF上拐形成',at(row,row.formedInWindow)],['标准开盘入场',row.plans.standard.entry]];
  el('early-timeline').innerHTML=items.map(([t,p])=>'<div><b>'+t+'</b><span>'+point(p,t.includes('开盘'))+'</span></div>').join('');
  el('early-case-plans').innerHTML=['standard','nine','watch'].map(k=>{const p=row.plans[k];return `<tr data-case-plan="${k}"><th>${m.plans[k]}</th><td>${point(p.signal)}</td><td>${point(p.entry,true)}</td><td>${point(p.exit,p.closed)}<span class="sub">${esc(p.reason)}</span></td><td>${recordResult(p)}</td></tr>`;}).join('');
  const svg=ResearchCharts.svg(data,row);el('early-chart').innerHTML=svg;
  try{const png=await ResearchCharts.png(el('early-chart').querySelector('svg'));if(version!==serial)return;const image=new Image();image.src=png;image.alt=el('early-case-title').textContent;image.width=1100;image.height=590;el('early-chart').replaceChildren(image);el('early-download').href=png;el('early-download').download='macd-low9-'+row.id.replace(/:/g,'-')+'-N'+o().horizon+'.png';el('early-download').hidden=false;}catch(e){console.error('Research chart image unavailable',e);}if(serial===version)el('early-chart').dataset.ready='true';
 }
 el('early-rules').innerHTML=Object.entries(m.definition).map(([k,v],i)=>'<div><dt>'+['样本','入场','退出','同批终点','边界'][i]+'</dt><dd>'+esc(v)+'</dd></div>').join('');
 for(const id of ['index','scope','research-period','research-horizon','research-cohort','research-trend','research-higher','research-resonance','study-warmup'])el(id).addEventListener('change',render);
 el('early-example-type').addEventListener('change',()=>{selectedId=null;renderExamples();});
 el('early-periods').addEventListener('click',e=>{const b=e.target.closest('[data-early-period]');if(!b)return;el('research-period').value=b.dataset.earlyPeriod;el('research-period').dispatchEvent(new Event('change'));});
 el('early-records').addEventListener('click',e=>{const b=e.target.closest('[data-early-case]');if(!b)return;selectedId=b.dataset.earlyCase;if(!el('early-example-type').querySelector('option[value=record]'))el('early-example-type').insertAdjacentHTML('beforeend','<option value="record">逐条选中的样本</option>');el('early-example-type').value='record';showCase(rows.find(r=>r.id===selectedId));el('early-case').scrollIntoView({block:'start'});});
 el('early-prev').addEventListener('click',()=>{casePage--;renderRecords();});el('early-next').addEventListener('click',()=>{casePage++;renderRecords();});
 el('early-zoom').addEventListener('click',()=>{if(!current)return;el('research-dialog-chart').innerHTML=ResearchCharts.svg(data,current);el('research-dialog').showModal();});el('research-dialog-close').addEventListener('click',()=>el('research-dialog').close());
 render();
}
