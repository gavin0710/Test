"use strict";
const AnalysisCatalog = [
 {id:"early",href:"analysis-early.html",title:"MACD＋九转提前入场",primary:true,featured:true,question:"钝化后结合低9提前买，省下多少价差，又多承担多少失败风险？",detail:"核心研究 · 同批三方案 · 失败样本 · K线与MACD复核"},
 {id:"macd",href:"analysis-macd.html",title:"MACD操作基准",primary:true,question:"按原来的钝化、结构形成和退出规则，表现怎样？",detail:"操作主线 · 钝化到结构 · 独立止损与卖点 · 六周期"},
 {id:"nine",href:"analysis-nine.html",title:"九转独立观察",primary:true,question:"上升、下降趋势中的低9上涨、高9下跌，各有多大概率？",detail:"辅助观察 · 四种趋势情况 · 成功/失败图例 · 连续10"},
 {id:"buy-baseline",href:"analysis-buy-baseline.html",title:"买1方向基准明细",extensionOf:"macd"},
 {id:"buy-patterns",href:"analysis-buy-patterns.html",title:"形态与指标组合",extensionOf:"early"},
 {id:"buy-confirm",href:"analysis-buy-confirm.html",title:"等待金叉扩展研究",extensionOf:"early"},
 {id:"history-compare",href:"analysis-history-compare.html",title:"历史范围对照",extensionOf:"early"},
 {id:"trades",href:"analysis-trades.html",title:"原交易与卖点统计",extensionOf:"macd"}
];
if(typeof module==="object"&&module.exports)module.exports=AnalysisCatalog;
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",async()=>{
 const el=id=>document.getElementById(id),page=document.body.dataset.analysis;
 const aliases={"#nine-study":"nine","#buy-study":"buy-baseline","#shape-study":"buy-patterns","#wait-study":"buy-confirm","#history-study":"history-compare","#legacy-study":"trades"};
 const oldLink=()=>{if(page!=="hub"||!aliases[location.hash])return false;location.replace(AnalysisCatalog.find(p=>p.id===aliases[location.hash]).href+location.search);return true;};
 if(page==="hub")window.addEventListener("hashchange",oldLink);
 if(oldLink())return;
 const active=AnalysisCatalog.find(p=>p.id===page)?.extensionOf||page;
 el("analysis-nav").innerHTML=AnalysisCatalog.filter(p=>p.primary).map(p=>'<a href="./'+p.href+'"'+(p.id===active?' aria-current="page"':'')+'>'+p.title+'</a>').join("");
 if(page==="hub")el("analysis-grid").innerHTML=AnalysisCatalog.filter(p=>p.primary).map(p=>'<a class="analysis-link'+(p.featured?' featured':'')+'" href="./'+p.href+'"><h2>'+p.title+'</h2><p>'+p.question+'</p><span>'+p.detail+'</span><b>打开分析</b></a>').join("");
 try{
  const response=await fetch("./analysis-data.json",{cache:"no-store"});if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();
  if(data.periods?.length!==6||data.coverage?.length!==24||!Array.isArray(data.samples))throw Error("Invalid archive");
  el("asof").textContent="统计截至 "+data.asOf.replace("T"," ")+" · 北京时间";
  if(page!=="hub"){
   el("index").insertAdjacentHTML("beforeend",data.indices.map((name,i)=>'<option value="'+i+'">'+name+'</option>').join(""));
   const params=new URLSearchParams(location.search);
   const research=page==="early"||page==="macd";
   const fields={index:"index",scope:"scope",n:research?"research-horizon":page==="nine"?"nine-horizon":"study-horizon",period:research?"research-period":"nine-period",warmup:"study-warmup",cohort:"research-cohort",trend:"research-trend",higher:"research-higher",resonance:"research-resonance"};
   for(const id of ["nine-period","research-period"])if(el(id)){el(id).innerHTML=data.periods.map(p=>'<option value="'+p.id+'">'+p.label+'</option>').join("");el(id).value="D";}
   for(const[key,id]of Object.entries(fields)){const e=el(id),v=params.get(key);if(e&&v!==null&&[...e.options].some(o=>o.value===v))e.value=v;}
   if(page==="early")mountEarlyStudy(data);else if(page==="macd")mountMacdBaseline(data);else if(page==="nine")mountNineAnalysis(data);else if(page==="trades")mountTradeAnalysis(data);else mountBuyPatternStudy(data);
   function shared(){
    const selected=el("index").value;
    el("coverage").innerHTML=data.periods.map(p=>{const rows=data.coverage.filter(r=>r.period===p.id&&(selected==="all"||r.index===Number(selected))),from=rows.map(r=>r.from).sort()[0],to=rows.map(r=>r.to).sort().at(-1),lengths=rows.map(r=>r.bars),min=Math.min(...lengths),max=Math.max(...lengths);return '<tr><th>'+p.label+'</th><td>'+from.slice(0,10)+' 至 '+to.slice(0,10)+'</td><td>'+min.toLocaleString('zh-CN')+(min===max?'':'–'+max.toLocaleString('zh-CN'))+'</td></tr>';}).join("");
    const query=new URLSearchParams();for(const[key,id]of Object.entries(fields))if(el(id))query.set(key,el(id).value);
    history.replaceState(null,"",location.pathname+"?"+query.toString()+location.hash);
    for(const link of [...el("analysis-nav").querySelectorAll('a'),...document.querySelectorAll('.extension-links a')]){const u=new URL(link.href);u.search=query.toString();link.href=u.href;}
   }
   for(const id of Object.values(fields))el(id)?.addEventListener("change",shared);shared();
  }
  el("dashboard").hidden=false;el("status").hidden=true;
 }catch(error){el("status").textContent="历史样本暂时无法读取，请刷新重试。";console.error(error);}
});
