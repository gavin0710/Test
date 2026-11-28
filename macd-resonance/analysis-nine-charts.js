"use strict";
const NineCharts=(()=>{
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function examples(rows,{trend,side}){
  const done=rows.filter(r=>r.trend===trend&&r.side===side&&r.outcome).sort((a,b)=>b.time.localeCompare(a.time)||a.index-b.index);
  return {success:done.find(r=>r.result>0)||null,failure:done.find(r=>r.result<=0)||null};
 }
 function snapshot(data,row){
  const history=data.nineHistory?.[row.index]?.[row.period];
  if(!history||history[row.barIndex]?.[0]!==row.time||history[row.barIndex]?.[4]!==row.close)throw Error('Chart archive does not match signal');
  const entryIndex=row.barIndex+(['ten','pairedTen'].includes(row.stage)?1:0),endIndex=history.findIndex(b=>b[0]===row.outcome?.[0]);
  if(endIndex<entryIndex||history[endIndex][4]!==row.outcome[1]||history[entryIndex][4]!==row.entry[1])throw Error('Chart endpoint does not match evaluated sample');
  const from=Math.max(0,row.barIndex-65),to=endIndex;
  let sum=0;const averages=history.slice(0,to+1).map((b,i)=>{sum+=b[4];if(i>=60)sum-=history[i-60][4];return i>=59?sum/60:null;});
  const bars=history.slice(from,to+1).map((b,j)=>({t:b[0],o:b[1],h:b[2],l:b[3],c:b[4],ma:averages[from+j],i:from+j}));
  return {bars,row,from,to,entryIndex,endIndex,nineIndex:row.barIndex,tenIndex:row.tenStatus==='valid'?row.barIndex+1:null,trendIndex:row.barIndex-9,
   indexName:data.indices[row.index],periodName:data.periods.find(p=>p.id===row.period)?.label||row.period};
 }
 function svg(s){
  const {bars,row,from,to,entryIndex,endIndex,nineIndex,tenIndex,trendIndex}=s;
  const W=960,H=400,L=62,R=24,T=64,B=72,PW=W-L-R,PH=H-T-B;
  const values=bars.flatMap(b=>[b.h,b.l,...(b.ma===null?[]:[b.ma])]);let lo=Math.min(...values),hi=Math.max(...values);const pad=(hi-lo||hi*.01||1)*.12;lo-=pad;hi+=pad;
  const x=i=>L+(i-from+.5)*PW/bars.length,y=v=>T+(hi-v)*PH/(hi-lo),bw=Math.max(2,Math.min(9,PW/bars.length*.65));
  let chart=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(s.indexName+' '+s.periodName+' '+row.time+' 真实历史K线')}" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif;background:white"><rect width="960" height="400" fill="#ffffff"/><text x="20" y="25" font-size="17" fill="#203e50" font-weight="700">${esc(s.indexName+' · '+s.periodName+' · '+(row.side==='low'?'低':'高')+(entryIndex===nineIndex?'9':'10')+(row.side==='low'?'看涨':'看跌')+' · '+row.time.replace('T',' '))}</text><text x="20" y="47" font-size="12" fill="#536d7b">${esc(row.trend==='up'?'序列前MA60上行':row.trend==='down'?'序列前MA60下行':'趋势未知')} · 红涨绿跌 · 金线 MA60 · 淡色区为信号后的观察区间</text>`;
  chart+=`<rect x="${x(entryIndex)+PW/bars.length/2}" y="${T}" width="${Math.max(0,x(endIndex)-x(entryIndex))}" height="${PH}" fill="#eff8f8"/>`;
  for(let k=0;k<=4;k++){const value=lo+(hi-lo)*k/4,Y=y(value);chart+=`<path d="M${L},${Y}H${W-R}" stroke="#e8eff2"/><text x="${L-8}" y="${Y+4}" text-anchor="end" font-size="11" fill="#617786">${value.toFixed(0)}</text>`;}
  chart+=`<path d="M${L},${y(row.entry[1])}H${W-R}" stroke="#839aaa" stroke-dasharray="5 4"/>`;
  let maPath='';for(const b of bars)if(b.ma!==null)maPath+=(maPath?'L':'M')+x(b.i).toFixed(2)+','+y(b.ma).toFixed(2);if(maPath)chart+=`<path d="${maPath}" fill="none" stroke="#b58a2d" stroke-width="2"/>`;
  for(const b of bars){const X=x(b.i),color=b.c>=b.o?'#c35b53':'#25847c',top=y(Math.max(b.o,b.c)),bottom=y(Math.min(b.o,b.c));chart+=`<path d="M${X},${y(b.h)}V${y(b.l)}" stroke="${color}" stroke-width="1.2"/><rect x="${X-bw/2}" y="${top}" width="${bw}" height="${Math.max(1,bottom-top)}" fill="${color}"/>`;const count=b.i-(nineIndex-8)+1;if(count>=1&&count<=8)chart+=`<text x="${X}" y="${Math.max(T+12,y(b.h)-6)}" text-anchor="middle" font-size="10" fill="#587481">${count}</text>`;}
  const marker=(at,text,color,Y)=>{if(at<from||at>to)return '';const X=x(at);return `<path d="M${X},${Y+7}V${T+PH}" stroke="${color}" stroke-dasharray="3 4" opacity=".7"/><rect x="${X-15}" y="${Y-14}" width="30" height="22" rx="4" fill="${color}"/><text x="${X}" y="${Y+1}" text-anchor="middle" font-size="13" font-weight="700" fill="white">${text}</text>`;};
  chart+=marker(nineIndex,'9','#96618c',T+9);if(tenIndex!==null)chart+=marker(tenIndex,'10','#426ca3',T+36);
  chart+=`<circle cx="${x(endIndex)}" cy="${y(row.outcome[1])}" r="4.5" fill="#233e50" stroke="white" stroke-width="2"/>`;
  const trendX=x(trendIndex);chart+=`<path d="M${trendX},${T+PH-9}V${T+PH+9}" stroke="#a07f3a"/><text x="${trendX}" y="${T+PH+17}" text-anchor="middle" font-size="11" fill="#876b32">趋势判定</text>`;
  chart+=`<text x="${L}" y="${H-14}" font-size="11" fill="#536d7b">${esc(bars[0].t.replace('T',' '))}</text><text x="${W-R}" y="${H-14}" text-anchor="end" font-size="11" fill="#203e50">终点：${esc(row.outcome[0].replace('T',' '))}</text>`;
  const change=100*(row.outcome[1]/row.entry[1]-1);chart+=`<text x="${W-R}" y="${H-32}" text-anchor="end" font-size="13" font-weight="700" fill="${row.result>0?'#0f6f74':'#8e4d42'}">信号 ${row.entry[1].toFixed(2)} → 终点 ${row.outcome[1].toFixed(2)}：${change>0?'+':''}${change.toFixed(2)}%</text></svg>`;
  return chart;
 }
 async function png(svgElement){
  const source=new XMLSerializer().serializeToString(svgElement),url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=800;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawImage(image,0,0,960,400);return canvas.toDataURL('image/png');}finally{URL.revokeObjectURL(url);}
 }
 return {examples,snapshot,svg,png};
})();
if(typeof module==='object'&&module.exports)module.exports=NineCharts;
