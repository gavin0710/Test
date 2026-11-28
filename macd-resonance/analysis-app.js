"use strict";
const AnalysisCatalog = [
 {id:"nine",href:"analysis-nine.html",title:"九转跟踪",question:"9出现以后，第N根收盘上涨的比例是多少？",detail:"总体9 · 四种趋势情况 · 成功/失败K线 · 连续10"},
 {id:"buy-baseline",href:"analysis-buy-baseline.html",title:"买1后上涨基准",question:"买1之后，各周期有多大比例继续上涨？",detail:"各周期基准 · 5/10/20根终点 · 原始样本"},
 {id:"buy-patterns",href:"analysis-buy-patterns.html",title:"买1形态与指标组合",question:"哪些MACD、九转或多周期条件下，更常上涨？",detail:"单项形态 · 双指标组合 · 可比基准"},
 {id:"buy-confirm",href:"analysis-buy-confirm.html",title:"等待金叉再买",question:"买1直接买，还是等DIF金叉以后再买？",detail:"确认价重新计算 · 同批样本 · 共同终点"},
 {id:"history-compare",href:"analysis-history-compare.html",title:"历史范围对照",question:"同一种形态，换一段历史还成立吗？",detail:"各周期全历史 · 四指共同历史 · 样本覆盖"},
 {id:"trades",href:"analysis-trades.html",title:"交易胜率与卖点统计",question:"按结构账本退出，交易结果和方向命中怎样？",detail:"交易胜率 · 买卖点方向 · 共振与九转分组"}
];
if(typeof module==="object"&&module.exports)module.exports=AnalysisCatalog;
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",async()=>{
 const el=id=>document.getElementById(id),page=document.body.dataset.analysis;
 const aliases={"#nine-study":"nine","#buy-study":"buy-baseline","#shape-study":"buy-patterns","#wait-study":"buy-confirm","#history-study":"history-compare","#legacy-study":"trades"};
 const oldLink=()=>{if(page!=="hub"||!aliases[location.hash])return false;location.replace(AnalysisCatalog.find(p=>p.id===aliases[location.hash]).href+location.search);return true;};
 if(page==="hub")window.addEventListener("hashchange",oldLink);
 if(oldLink())return;
 el("analysis-nav").innerHTML=AnalysisCatalog.map(p=>'<a href="./'+p.href+'"'+(p.id===page?' aria-current="page"':'')+'>'+p.title+'</a>').join("");
 if(page==="hub")el("analysis-grid").innerHTML=AnalysisCatalog.map(p=>'<a class="analysis-link" href="./'+p.href+'"><h2>'+p.title+'</h2><p>'+p.question+'</p><span>'+p.detail+'</span><b>打开分析</b></a>').join("");
 try{
  const response=await fetch("./analysis-data.json",{cache:"no-store"});if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();
  if(data.periods?.length!==6||data.coverage?.length!==24||!Array.isArray(data.samples))throw Error("Invalid archive");
  el("asof").textContent="统计截至 "+data.asOf.replace("T"," ")+" · 北京时间";
  if(page!=="hub"){
   el("index").insertAdjacentHTML("beforeend",data.indices.map((name,i)=>'<option value="'+i+'">'+name+'</option>').join(""));
   const params=new URLSearchParams(location.search);
   const fields={index:"index",scope:"scope",n:page==="nine"?"nine-horizon":"study-horizon",period:"nine-period",warmup:"study-warmup"};
   if(page==="nine"){el("nine-period").innerHTML=data.periods.map(p=>'<option value="'+p.id+'">'+p.label+'</option>').join("");el("nine-period").value="D";}
   for(const[key,id]of Object.entries(fields)){const e=el(id),v=params.get(key);if(e&&v!==null&&[...e.options].some(o=>o.value===v))e.value=v;}
   if(page==="nine")mountNineAnalysis(data);else if(page==="trades")mountTradeAnalysis(data);else mountBuyPatternStudy(data);
   function shared(){
    const selected=el("index").value;
    el("coverage").innerHTML=data.periods.map(p=>{const rows=data.coverage.filter(r=>r.period===p.id&&(selected==="all"||r.index===Number(selected))),from=rows.map(r=>r.from).sort()[0],to=rows.map(r=>r.to).sort().at(-1),lengths=rows.map(r=>r.bars),min=Math.min(...lengths),max=Math.max(...lengths);return '<tr><th>'+p.label+'</th><td>'+from.slice(0,10)+' 至 '+to.slice(0,10)+'</td><td>'+min.toLocaleString('zh-CN')+(min===max?'':'–'+max.toLocaleString('zh-CN'))+'</td></tr>';}).join("");
    const query=new URLSearchParams();for(const[key,id]of Object.entries(fields))if(el(id))query.set(key,el(id).value);
    history.replaceState(null,"",location.pathname+"?"+query.toString()+location.hash);
    for(const link of el("analysis-nav").querySelectorAll('a')){const u=new URL(link.href);u.search=query.toString();link.href=u.href;}
   }
   for(const id of Object.values(fields))el(id)?.addEventListener("change",shared);shared();
  }
  el("dashboard").hidden=false;el("status").hidden=true;
 }catch(error){el("status").textContent="历史样本暂时无法读取，请刷新重试。";console.error(error);}
});
