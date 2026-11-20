"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const money = x => Math.round((x + Number.EPSILON) * 100) / 100;
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const variance = xs => xs.length > 1 ? xs.reduce((s,x)=>s+(x-mean(xs))**2,0)/(xs.length-1) : 0;
const sum = xs => xs.reduce((a,b)=>a+b,0);
const yearsBetween = (a,b) => Math.max(1/365.2425,(Date.parse(b)-Date.parse(a))/86400000/365.2425);

function loadEngine(html) {
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 const at=script?.indexOf('byId("refresh").onclick=load;');
 assert(at>0,'Signal engine boundary missing');
 return vm.runInNewContext(script.slice(0,at)+';({calculate,completedPeriodBars,mergeHistoricalBars});',
  {window:{},document:{},console},{timeout:10000});
}

function parseQuotes(payload, market) {
 assert.equal(payload.data?.code,market.etf,'ETF identity mismatch');
 const result=[];
 for(const line of payload.data.klines){
  const [date,...fields]=line.split(','),[o,c,h,l,volume]=fields.slice(0,5).map(Number);
  const amount=fields[5]===undefined||fields[5]===''?null:Number(fields[5]);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date)&&(!result.length||result.at(-1).date<date),'Duplicate/unordered ETF date');
  assert([o,c,h,l,volume].every(Number.isFinite)&&(amount===null||Number.isFinite(amount)&&amount>=0)&&l>0&&l<=Math.min(o,c)&&h>=Math.max(o,c)&&volume>=0,'Invalid ETF OHLCV '+date);
  const previous=result.at(-1);
  const factor=previous?(market.splits||[]).filter(s=>previous.date<s.date&&s.date<=date).reduce((a,s)=>a*s.ratio,1):1;
  const reference=previous?previous.c/factor-(market.dividends||[]).filter(d=>previous.date<d.ex&&d.ex<=date).reduce((s,d)=>s+d.perShare,0):null;
  // Only preceding observations enter the capacity estimate, never today's volume.
  const trailing=result.slice(-20);
  result.push({date,o,c,h,l,volume,amount,reference,laggedAverageShares:trailing.length?mean(trailing.map(q=>q.volume*100)):null});
 }
 assert.equal(result[0].date,market.listing,'Do not invent pre-listing ETF prices');
 return result;
}

function compileOrders(signal, from, to, includeCorrections=true) {
 const orders=new Map();
 const add=(date,o)=>{if(date<from||date>to)return;if(!orders.has(date))orders.set(date,[]);orders.get(date).push(o)};
 const legs=[...signal.trades,...signal.positions].sort((a,b)=>a.entryI-b.entryI||a.campaignI-b.campaignI);
 for(const leg of legs){
  if(leg.entryT<from||!includeCorrections&&leg.entryType==='correctionBuy')continue;
  const id=leg.structureId+'@'+leg.entryT;
  const parent=leg.entryType==='correctionBuy'?leg.structureId+'@'+signal.bars[leg.correctionFromExitI].t:null;
  add(leg.entryT,{id,structureId:leg.structureId,side:'buy',type:leg.entryType,parent,signalT:leg.entryT});
  if(leg.exitT)add(leg.exitT,{id,structureId:leg.structureId,side:'sell',type:leg.exitType,
   parent:leg.exitType==='topSell'?leg.structureId+'@'+leg.exitT:null,signalT:leg.exitT});
 }
 return orders;
}

function priceFor(q,side,market,costs){
 if(!q)return {reason:'missing_quote'};
 if(q.volume<=0)return {reason:'zero_volume'};
 const limitPct=market.etf==='588000'||market.etf==='159915'&&q.date>='2020-08-24'?.2:.1;
 const tick=x=>Math.round((x+1e-10)*1000)/1000;
 const limit=q.reference?tick(q.reference*(side==='buy'?1+limitPct:1-limitPct)):null;
 if(limit&&(side==='buy'?q.o>=limit:q.o<=limit))return {reason:'opening_at_adverse_limit'};
 const slipped=q.o*(1+(side==='buy'?1:-1)*costs.slippage);
 let price=(side==='buy'?Math.ceil(slipped*1000-1e-8):Math.floor(slipped*1000+1e-8))/1000;
 price=Math.max(.001,price);
 if(limit)price=side==='buy'?Math.min(price,limit):Math.max(price,limit);
 return {price,outsideObservedRange:price>q.h+1e-8||price<q.l-1e-8};
}

function simulate(options){
 const {market,signal,quotes,protocol}=options;
 const start=options.from>market.listing?options.from:market.listing;
 const to=options.to||protocol.cutoff,costs=options.costs||protocol.baseCosts;
 const calendar=signal.bars.map(b=>b.t).filter(d=>d>=start&&d<=to);
 assert(calendar.length>0,'Empty simulation calendar');
 const initial=protocol.initialCash,passiveWeight=options.passiveWeight||0,delay=options.delay||1;
 const capacityFraction=options.capacityFraction??null;
 const from=calendar[0],last=calendar.at(-1),quoteMap=new Map(quotes.map(q=>[q.date,q]));
 const orders=passiveWeight?new Map():compileOrders(signal,from,last,options.includeCorrections!==false);
 const positions=new Map(),allUnits=new Map(),completedTopSales=new Set();
 const fills=[],skipped=[],attempts=[],corporate=[],equity=[],receivables=[];
 let pending=passiveWeight?[{id:'benchmark',structureId:'benchmark',side:'buy',type:'benchmark',signalT:null,due:0}]:[];
 let cash=initial,fees=0,slippageCost=0,paidDividends=0,peak=initial,maxDD=0,staleRun=0,maxStale=0;
 const before=quotes.filter(q=>q.date<from).at(-1);
 let previousClose=before?.c||null;
 if(before)for(const split of market.splits||[])if(before.date<split.date&&split.date<from)previousClose/=split.ratio;
 const mark=spot=>sum([...positions.values()].map(p=>p.shares*(spot||0)));
 const accrued=day=>sum(receivables.filter(d=>d.ex<=day).map(d=>d.amount));
 const commission=value=>money(Math.max(costs.minimumFee,money(value*costs.fee)));
 const reject=(order,day,reason,action)=>{
  const row={id:order.id,structureId:order.structureId,side:order.side,type:order.type,signalT:order.signalT,attempt:day,reason,action};
  attempts.push(row);if(action==='cancel')skipped.push(row);
 };

 for(let i=0;i<calendar.length;i++){
  const day=calendar[i],q=quoteMap.get(day);
  for(const split of market.splits||[])if(split.date===day){
   for(const p of positions.values()){
    const old=p.shares;p.shares*=split.ratio;p.totalSharesAdjusted*=split.ratio;
    assert(Number.isInteger(p.shares),'Fractional split requires an explicit settlement policy');
    corporate.push({date:day,kind:'split',id:p.id,before:old,after:p.shares,ratio:split.ratio});
   }
   if(previousClose)previousClose/=split.ratio;
  }
  for(let n=receivables.length-1;n>=0;n--){
   const d=receivables[n];
   if(d.ex===day){allUnits.get(d.id).dividends+=d.amount;corporate.push({date:day,kind:'ex_dividend',id:d.id,amount:d.amount});}
   if(d.pay<=day){cash=money(cash+d.amount);paidDividends+=d.amount;corporate.push({date:day,kind:'dividend_payment',id:d.id,amount:d.amount});receivables.splice(n,1);}
  }
  const spot=q?.o||previousClose||0;
  let capacity=capacityFraction!==null&&q?.laggedAverageShares!==null&&q?.laggedAverageShares!==undefined
   ?Math.floor(q.laggedAverageShares*capacityFraction/100)*100:Infinity;
  const carry=pending.filter(o=>o.due>i);
  for(const order of pending.filter(o=>o.due<=i&&o.side==='sell')){
   const p=positions.get(order.id);
   if(!p){reject(order,day,'no_executed_position','cancel');continue;}
   const result=priceFor(q,'sell',market,costs);
   if(!result.price||p.bought>=day){reject(order,day,result.reason||'T+1_lock','defer');carry.push(order);continue;}
   const shares=Math.min(p.shares,capacity);
   if(shares<=0){reject(order,day,'lagged_volume_capacity','defer');carry.push(order);continue;}
   const amount=money(shares*result.price),fee=commission(amount);
   cash=money(cash+amount-fee);fees+=fee;slippageCost+=shares*(q.o-result.price);capacity-=shares;
   p.shares-=shares;p.saleNet+=amount-fee;p.saleGross+=amount;p.sellFees+=fee;p.rawSaleGross+=shares*q.o;
   p.exitType=p.exitType||order.type;p.exitSignalT=p.exitSignalT||order.signalT;
   fills.push({...order,date:day,rawOpen:q.o,price:result.price,shares,commission:fee,amount,remainingShares:p.shares,
    outsideObservedRange:result.outsideObservedRange,laggedAverageShares:q.laggedAverageShares});
   if(p.shares===0){p.exitDate=day;positions.delete(order.id);if(order.parent)completedTopSales.add(order.parent);}
   else{reject(order,day,'partial_lagged_volume_fill','defer');carry.push(order);}
  }
  const openNav=cash+mark(spot)+accrued(day);
  for(const order of pending.filter(o=>o.due<=i&&o.side==='buy')){
   if(order.parent&&!completedTopSales.has(order.parent)){reject(order,day,'parent_top_sale_unfilled','cancel');continue;}
   const result=priceFor(q,'buy',market,costs);
   if(!result.price){
    const action=options.buyFailure==='cancel'?'cancel':'defer';reject(order,day,result.reason,action);if(action==='defer')carry.push(order);continue;
   }
   if(capacity<100){reject(order,day,'lagged_volume_capacity','defer');carry.push(order);continue;}
   const marketValue=mark(spot),capital=cash+marketValue+accrued(day);
   const maxWeight=passiveWeight||protocol.entryExposureCap;
   const maxSpend=Math.min((passiveWeight||protocol.unitFraction)*openNav,cash);
   const room=maxWeight*capital-marketValue;
   let shares=Math.max(0,Math.floor(Math.min(room/spot,maxSpend/result.price,capacity)/100)*100);
   while(shares>0){
    const value=money(shares*result.price),fee=commission(value),after=capital-fee-shares*(result.price-spot);
    if(value+fee<=maxSpend+1e-8&&marketValue+shares*spot<=maxWeight*after+1e-8)break;
    shares-=100;
   }
   if(!shares){reject(order,day,'cash_allocation_or_entry_cap','cancel');continue;}
   const amount=money(shares*result.price),fee=commission(amount);
   cash=money(cash-amount-fee);fees+=fee;slippageCost+=shares*(result.price-q.o);capacity-=shares;
   const p={id:order.id,structureId:order.structureId,entryType:order.type,signalT:order.signalT,bought:day,
    shares,totalSharesAdjusted:shares,entryShares:shares,buyPrice:result.price,rawEntryGross:shares*q.o,
    cashOut:amount+fee,buyFees:fee,saleNet:0,saleGross:0,rawSaleGross:0,sellFees:0,dividends:0};
   positions.set(order.id,p);allUnits.set(order.id,p);
   fills.push({...order,date:day,rawOpen:q.o,price:result.price,shares,commission:fee,amount,
    outsideObservedRange:result.outsideObservedRange,laggedAverageShares:q.laggedAverageShares});
  }
  assert(cash>=-1e-6,'Negative cash '+market.etf+' '+day);
  previousClose=q?.c||previousClose;
  for(const d of market.dividends||[])if(d.record===day){
   for(const p of positions.values()){
    const amount=money(p.shares*d.perShare);
    receivables.push({id:p.id,ex:d.ex,pay:d.pay,amount});
    corporate.push({date:day,kind:'dividend_entitlement',id:p.id,amount,ex:d.ex,pay:d.pay});
   }
  }
  const value=mark(previousClose),nav=cash+value+accrued(day);
  peak=Math.max(peak,nav);maxDD=Math.max(maxDD,1-nav/peak);
  const prior=equity.at(-1)?.nav||initial;
  staleRun=!q&&positions.size?staleRun+1:0;maxStale=Math.max(maxStale,staleRun);
  equity.push({date:day,nav:money(nav),cash,marketValue:money(value),dividendReceivable:money(accrued(day)),
   exposure:value/nav,drawdown:1-nav/peak,dailyReturn:nav/prior-1,quotePresent:!!q,openUnits:positions.size});
  pending=carry;
  for(const order of orders.get(day)||[]){
   if(order.side==='sell'){
    const waiting=pending.filter(o=>o.id===order.id&&o.side==='buy');
    for(const item of waiting)reject(item,day,'exit_signalled_before_entry_filled','cancel');
    pending=pending.filter(o=>!(o.id===order.id&&o.side==='buy'));
   }
   pending.push({...order,due:i+delay});
  }
 }
 const ending=equity.at(-1).nav;
 const units=[...allUnits.values()].map(p=>({...p,markValue:money(p.shares*(previousClose||0)),
  totalNetPnl:money(p.saleNet+p.shares*(previousClose||0)+p.dividends-p.cashOut),
  totalNetReturn:(p.saleNet+p.shares*(previousClose||0)+p.dividends)/p.cashOut-1}));
 const closed=units.filter(p=>p.shares===0),open=units.filter(p=>p.shares>0);
 const wins=closed.filter(p=>p.totalNetPnl>0),losses=closed.filter(p=>p.totalNetPnl<0);
 const netSum=sum(units.map(p=>p.totalNetPnl));
 assert(Math.abs(ending-initial-netSum)<.03,'Unit PnL does not reconcile to account '+market.etf);
 const clusters=new Map();
 for(const p of units){const key=p.entryType+'@'+p.signalT;if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(p);}
 const independent=[...clusters].map(([id,ps])=>({id,signalT:ps[0].signalT,entryType:ps[0].entryType,
  completed:ps.every(p=>p.shares===0),units:ps.length,pnl:money(sum(ps.map(p=>p.totalNetPnl))),cashOut:money(sum(ps.map(p=>p.cashOut)))}));
 const completedIndependent=independent.filter(p=>p.completed);
 const contribution={};
 for(const p of units){const key=p.entryType+' / '+(p.exitType||(p.shares?'open':'unknown'));if(!contribution[key])contribution[key]={units:0,pnl:0};contribution[key].units++;contribution[key].pnl=money(contribution[key].pnl+p.totalNetPnl);}
 const returns=equity.map(e=>e.dailyReturn);
 const duration=yearsBetween(from,last);
 const summary={market:market.id,etf:market.etf,from,to:last,initialCash:initial,endingNav:ending,
  totalReturn:ending/initial-1,cagr:(ending/initial)**(1/duration)-1,maxDrawdown:maxDD,
  annualizedVolatility:Math.sqrt(variance(returns)*252),avgExposure:mean(equity.map(e=>e.exposure)),
  maxExposure:Math.max(...equity.map(e=>e.exposure)),daysInMarket:equity.filter(e=>e.openUnits>0).length/calendar.length,
  unitClosed:closed.length,unitOpen:open.length,unitWinRate:closed.length?wins.length/closed.length:null,
  independentClosedSignals:completedIndependent.length,independentWinRate:completedIndependent.length?completedIndependent.filter(x=>x.pnl>0).length/completedIndependent.length:null,
  averageWin:mean(wins.map(p=>p.totalNetPnl)),averageLoss:mean(losses.map(p=>p.totalNetPnl)),
  payoffRatio:wins.length&&losses.length?mean(wins.map(p=>p.totalNetPnl))/-mean(losses.map(p=>p.totalNetPnl)):null,
  profitFactor:losses.length?sum(wins.map(p=>p.totalNetPnl))/-sum(losses.map(p=>p.totalNetPnl)):null,
  entries:fills.filter(f=>f.side==='buy').length,exits:fills.filter(f=>f.side==='sell').length,
  entrySignalCount:new Set(fills.filter(f=>f.side==='buy').map(f=>f.type+'@'+f.signalT)).size,
  entriesPerYear:fills.filter(f=>f.side==='buy').length/duration,
  independentEntriesPerYear:new Set(fills.filter(f=>f.side==='buy').map(f=>f.type+'@'+f.signalT)).size/duration,
  fees:money(fees),modelSlippage:money(slippageCost),dividendsPaid:money(paidDividends),
  realizedClosedPnl:money(sum(closed.map(p=>p.totalNetPnl))),openUnitPnl:money(sum(open.map(p=>p.totalNetPnl))),
  missingQuoteDays:calendar.filter(d=>!quoteMap.has(d)).length,staleValuedHoldingDays:equity.filter(e=>!e.quotePresent&&e.openUnits>0).length,
  maxConsecutiveStaleHoldingDays:maxStale,unfilledBuyCancellations:skipped.filter(s=>s.side==='buy').length,
  deferredAttempts:attempts.filter(a=>a.action==='defer').length,pendingAtEnd:pending.length,
  modelPriceOutsideDailyRange:fills.filter(f=>f.outsideObservedRange).length,
  turnoverPerYear:sum(fills.map(f=>f.amount))/initial/duration,contribution};
 return {summary,equity,fills,skipped,attempts,units,independent,corporate,pending,options:{costs,passiveWeight,delay,capacityFraction,buyFailure:options.buyFailure||'defer',includeCorrections:options.includeCorrections!==false}};
}

function windowMetrics(equity,from,to,initial){
 const rows=equity.filter(e=>e.date>=from&&e.date<=to);
 if(!rows.length)return null;
 const previous=equity.filter(e=>e.date<from).at(-1)?.nav||initial;
 let peak=previous,dd=0;for(const e of rows){peak=Math.max(peak,e.nav);dd=Math.max(dd,1-e.nav/peak);}
 return {from:rows[0].date,to:rows.at(-1).date,totalReturn:rows.at(-1).nav/previous-1,maxDrawdown:dd,
  annualizedVolatility:Math.sqrt(variance(rows.map(e=>e.dailyReturn))*252),avgExposure:mean(rows.map(e=>e.exposure))};
}

module.exports={loadEngine,parseQuotes,compileOrders,priceFor,simulate,windowMetrics,money,mean,variance,sum,yearsBetween};
