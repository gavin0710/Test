"use strict";
const ResearchCharts=(()=>{
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cache=new WeakMap();
 function indicators(bars){if(cache.has(bars))return cache.get(bars);const ema=(values,n)=>{const k=2/(n+1),out=[];for(let i=0;i<values.length;i++)out.push(i?out[i-1]*(1-k)+values[i]*k:values[i]);return out;},close=bars.map(b=>b[4]),fast=ema(close,12),slow=ema(close,26),dif=fast.map((v,i)=>v-slow[i]),dea=ema(dif,9),hist=dif.map((v,i)=>2*(v-dea[i]));let sum=0;const ma=close.map((v,i)=>{sum+=v;if(i>=60)sum-=close[i-60];return i>=59?sum/60:null;});const result={dif,dea,hist,ma};cache.set(bars,result);return result;}
 function svg(data,row){
  const all=data.nineHistory[row.index][row.period],v=indicators(all),from=Math.max(0,row.watch-40),to=row.available,bars=all.slice(from,to+1);
  if(!bars.length)return '';
  const W=1100,H=590,L=66,R=25,T=76,P=280,M=410,MH=115,PW=W-L-R,step=PW/bars.length;
  const values=bars.flatMap((b,j)=>[b[2],b[3],...(v.ma[from+j]===null?[]:[v.ma[from+j]])]);let lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo||1)*.1;lo-=pad;hi+=pad;
  const x=i=>L+(i-from+.5)*step,y=p=>T+(hi-p)*P/(hi-lo),mvals=bars.flatMap((_,j)=>[v.dif[from+j],v.dea[from+j],v.hist[from+j],row.refDif,0]);let ml=Math.min(...mvals),mh=Math.max(...mvals);const mp=(mh-ml||1)*.13;ml-=mp;mh+=mp;const my=n=>M+(mh-n)*MH/(mh-ml),bw=Math.max(1,Math.min(10,step*.65));
  const period=data.periods.find(p=>p.id===row.period)?.label;
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.indices[row.index]+' '+period+' 钝化、低9与MACD形成对照')}" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif;background:#fff"><rect width="${W}" height="${H}" fill="white"/><text x="22" y="27" font-size="18" fill="#203e50" font-weight="700">${esc(data.indices[row.index]+' · '+period+' · 底钝化 '+all[row.watch][0])}</text><text x="22" y="52" font-size="12" fill="#607887">红涨绿跌 · 金线MA60 · 紫色9 · 蓝色结构形成 · 入场三角按下一根开盘定位</text>`;
  if(row.plans.nine.entry)out+=`<rect x="${x(row.plans.nine.entry[2])-step/2}" y="${T}" width="${Math.max(0,x(to)-x(row.plans.nine.entry[2])+step/2)}" height="${P}" fill="#eff8f8"/>`;
  for(let k=0;k<5;k++){const value=lo+(hi-lo)*k/4;out+=`<path d="M${L},${y(value)}H${W-R}" stroke="#e9eff2"/><text x="${L-8}" y="${y(value)+4}" text-anchor="end" font-size="11" fill="#657e8b">${value.toFixed(0)}</text>`;}
  const line=(values,func,color,start=from)=>{let path='';for(let i=from;i<=to;i++)if(values[i]!==null&&i>=start)path+=(path?'L':'M')+x(i).toFixed(2)+','+func(values[i]).toFixed(2);return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;};
  out+=line(v.ma,y,'#b58a2d');
  bars.forEach((b,j)=>{const i=from+j,X=x(i),color=b[4]>=b[1]?'#c35b53':'#25847c',top=y(Math.max(b[1],b[4])),height=Math.max(1,y(Math.min(b[1],b[4]))-top);out+=`<path d="M${X},${y(b[2])}V${y(b[3])}" stroke="${color}" stroke-width="1.3"/><rect x="${X-bw/2}" y="${top}" width="${bw}" height="${height}" fill="${color}"/>`;});
  const marker=(i,label,color,offset)=>i===null||i===undefined||i<from||i>to?'':`<path d="M${x(i)},${T+offset}V${M+MH}" stroke="${color}" stroke-dasharray="4 4" opacity=".65"/><rect x="${x(i)-24}" y="${T+offset-18}" width="48" height="22" rx="4" fill="${color}"/><text x="${x(i)}" y="${T+offset-3}" text-anchor="middle" font-size="11" fill="white">${label}</text>`;
  out+=marker(row.watch,'钝化','#788e99',7)+marker(row.nine!==null&&row.nine<=to?row.nine:null,'低9','#96618c',32)+marker(row.formedInWindow,'形成','#426ca3',57);
  for(const[k,color]of [['nine','#147e82'],['standard','#426ca3']]){const p=row.plans[k];if(!p.entry)continue;const X=x(p.entry[2]),Y=y(p.entry[1]);out+=`<path d="M${X},${Y}l-6,10h12Z" fill="${color}" stroke="white" stroke-width="1"/>`;if(p.closed){const X2=x(p.exit[2]),Y2=y(p.exit[1]);out+=`<path d="M${X2-5},${Y2-5}l10,10m0,-10l-10,10" stroke="${color}" stroke-width="2"/>`;}}
  out+=`<text x="${L}" y="${M-17}" font-size="12" fill="#375b6e">MACD · DIF青 / DEA橙 / 柱=2×(DIF−DEA)</text><path d="M${L},${my(0)}H${W-R}" stroke="#cbdbe2"/>`;
  out+=`<path d="M${L},${my(row.refDif)}H${W-R}" stroke="#8c9dac" stroke-dasharray="5 4"/><text x="${W-R}" y="${M-17}" text-anchor="end" font-size="11" fill="#647e8c">参考DIF低点 ${row.refDif.toFixed(3)}</text>`;
  bars.forEach((_,j)=>{const i=from+j,X=x(i),a=my(v.hist[i]),z=my(0);out+=`<rect x="${X-bw/2}" y="${Math.min(a,z)}" width="${bw}" height="${Math.max(1,Math.abs(a-z))}" fill="${v.hist[i]>=0?'#cb7e75':'#6aaba4'}"/>`;});out+=line(v.dif,my,'#197c83')+line(v.dea,my,'#c4943f');
  out+=`<text x="${L}" y="${H-35}" font-size="11" fill="#647e8c">${esc(all[from][0].replace('T',' '))}</text><text x="${W-R}" y="${H-35}" text-anchor="end" font-size="11" fill="#647e8c">${row.complete?'共同终点':'目前已知'}：${esc(all[to][0].replace('T',' '))}</text><text x="${L}" y="${H-12}" font-size="11" fill="#647e8c">三角：开盘入场；叉号：已执行退出；未退出按共同终点收盘计价。图示为历史复核。</text></svg>`;
  return out;
 }
 async function png(svg){const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}));try{const im=new Image();await new Promise((ok,no)=>{im.onload=ok;im.onerror=no;im.src=url;});const canvas=document.createElement('canvas'),w=Number(svg.getAttribute('width')),h=Number(svg.getAttribute('height'));canvas.width=w*2;canvas.height=h*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawImage(im,0,0,w,h);return canvas.toDataURL('image/png');}finally{URL.revokeObjectURL(url);}}
 return {indicators,svg,png};
})();
if(typeof module==='object'&&module.exports)module.exports=ResearchCharts;
