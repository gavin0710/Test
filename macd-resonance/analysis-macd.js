"use strict";
function mountMacdBaseline(data){
 const el=id=>document.getElementById(id),m=SuccessAnalysis,early=EarlyResearch,esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pct=v=>v===null?'—':(v*100).toFixed(1)+'%',move=v=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
 let page=0,records=[];
 const options=()=>({index:el('index').value==='all'?'all':Number(el('index').value),scope:el('scope').value,horizon:Number(el('research-horizon').value)});
 const stats=rows=>{const s=m.summarize(rows),done=rows.filter(r=>r.result!==null),wins=done.filter(r=>r.result>0).map(r=>r.result),losses=done.filter(r=>r.result<0).map(r=>r.result);return {...s,mean:early.avg(done.map(r=>r.result)),win:early.avg(wins),loss:early.avg(losses)};};
 function render(){
  const o=options(),cohort=early.observations(data,o),keys=new Set(cohort.filter(r=>r.formed!==null).map(r=>r.period+':'+r.index+':'+r.formed)),all=m.evaluate(data,{...o,mode:'trade'}).filter(r=>keys.has(r.period+':'+r.index+':'+r.barIndex)),period=el('research-period').value,s=stats(all.filter(r=>r.period===period)),episodes=early.observations(data,{...o,period}),formed=episodes.filter(r=>r.formed!==null).length,failed=episodes.filter(r=>r.resolution&&r.resolution.type!=='buy').length;
  el('macd-flow').innerHTML=[['底钝化',episodes.length],['DIF首次上拐形成',formed],['未形成即失效／结束',failed],['仍待形成',episodes.length-formed-failed]].map(([t,n])=>'<div><span>'+t+'</span><strong>'+n+'</strong></div>').join('');
  const ratio=s.win!==null&&s.loss!==null?s.win/-s.loss:null;
  el('macd-metrics').innerHTML=[['交易胜率',pct(s.rate),'盈利 '+s.wins+' / 已退出 '+s.evaluated],['平均每笔信号价收益',move(s.mean),'仅已退出交易，未含成本'],['平均盈亏比',ratio===null?'—':ratio.toFixed(2),'平均盈利 ÷ 平均亏损绝对值'],['待退出结构',String(s.pending),'不纳入已退出胜率分母']].map(([t,v,n])=>'<div class="research-metric'+(s.evaluated<20?' small':'')+'"><span>'+t+'</span><strong>'+v+'</strong><small>'+n+'</small></div>').join('');
  el('macd-context').textContent='钝化不等于已形成买点。形成后每个新底部买1独立记账，按所属结构止损或顶部卖点退出；小于20个已退出样本灰显。';
  el('macd-periods').innerHTML=data.periods.map(p=>{const v=stats(all.filter(r=>r.period===p.id));return '<tr><th><button class="period-link" type="button" data-macd-period="'+p.id+'">'+esc(p.label)+'</button></th><td>'+v.wins+' / '+v.evaluated+'</td><td>'+pct(v.rate)+'</td><td>'+move(v.mean)+'</td><td>'+move(v.win)+' / '+move(v.loss)+'</td><td>'+(v.medianMinutes===null?'—':(v.medianMinutes/1440).toFixed(1))+'</td><td>'+v.pending+'</td></tr>';}).join('');
  const directional=m.evaluate(data,{...o,mode:'buy'}).filter(r=>keys.has(r.period+':'+r.index+':'+r.barIndex));
  el('macd-direction').innerHTML=data.periods.map(p=>{const v=m.summarize(directional.filter(r=>r.period===p.id));return '<tr><th>'+esc(p.label)+'</th><td>'+pct(v.rate)+'</td><td>'+v.wins+' / '+v.evaluated+'</td><td>'+v.pending+'</td></tr>';}).join('');
  records=all.filter(r=>r.period===period).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index);page=0;renderRecords();
 }
 function renderRecords(){
  const pages=Math.max(1,Math.ceil(records.length/10));page=Math.max(0,Math.min(page,pages-1));
  el('macd-record-caption').textContent=records.length+'个首次买1结构，信号收盘价配对；此表不包含纠错买回单元。';
  const point=p=>p?esc(p[0].replace('T',' '))+'<span class="sub">'+p[1].toFixed(2)+'</span>':'待退出';
  el('macd-records').innerHTML=records.slice(page*10,(page+1)*10).map(r=>'<tr><td>'+esc(data.indices[r.index])+'</td><td>'+point([r.time,r.close])+'</td><td>'+point(r.outcome)+'</td><td>'+(r.outcome?r.outcome[2]==='topSell'?'顶部卖点':'结构止损':'待退出')+'</td><td>'+move(r.result)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">当前没有样本</td></tr>';
  el('macd-page').textContent=(page+1)+' / '+pages;el('macd-prev').disabled=page===0;el('macd-next').disabled=page+1>=pages;
 }
 for(const id of ['index','scope','research-period','research-horizon'])el(id).addEventListener('change',render);
 el('macd-periods').addEventListener('click',e=>{const b=e.target.closest('[data-macd-period]');if(!b)return;el('research-period').value=b.dataset.macdPeriod;el('research-period').dispatchEvent(new Event('change'));el('macd-records-panel').open=true;el('macd-records-panel').scrollIntoView({block:'start'});});
 el('macd-prev').addEventListener('click',()=>{page--;renderRecords();});el('macd-next').addEventListener('click',()=>{page++;renderRecords();});render();
}
