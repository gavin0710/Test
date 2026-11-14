#!/usr/bin/env python3
"""Backfill real daily/weekly index OHLC to earliest source-available history.

Never invent OHLC. Merge with previous archives and keep the largest verified
historical span. Intraday history is incrementally archived by collect.py.
"""
import datetime as dt
import json
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

from collect import INDICES, HEADERS, normalize

DIR=Path(__file__).resolve().parent/"data"
LATEST=DIR/"latest.json"
BASE="https://push2his.eastmoney.com/api/qt/stock/kline/get"

def merge(*series):
    rows={}
    for batch in series:
        for b in batch or []:
            if isinstance(b,dict) and isinstance(b.get("t"),str):
                try:
                    o,c,h,l=(float(b[k]) for k in ("o","c","h","l"))
                    if o>0 and c>0 and l<=min(o,c) and h>=max(o,c):
                        rows[b["t"]]={"t":b["t"],"o":o,"c":c,"h":h,"l":l}
                except (KeyError,TypeError,ValueError):
                    pass
    return [rows[k] for k in sorted(rows)]

def fetch_all(secid,period,count=20000):
    args={"secid":secid,"ut":"fa5fd1943c7b386f172d6893dbfba10b",
        "fields1":"f1,f2,f3,f4,f5,f6",
        "fields2":"f51,f52,f53,f54,f55,f56,f57",
        "klt":period,"fqt":0,"beg":"0","end":"20500101","lmt":count}
    url=BASE+"?"+urllib.parse.urlencode(args)
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=20) as resp:
        obj=json.loads(resp.read().decode("utf-8"))
    raw=(obj.get("data") or {}).get("klines") or []
    items=[r.split(",") for r in raw]
    result=normalize([[r[0].replace(" ","T")]+r[1:5] for r in items if len(r)>=5])
    if len(result)<65:raise RuntimeError("Only "+str(len(result))+" valid bars")
    return result

def run():
    old=json.loads(LATEST.read_text("utf-8")) if LATEST.exists() else {"data":[{}]*4}
    data=old.get("data") or [{} for _ in INDICES]
    successes=0
    for period in ("101","102"):
        dest=DIR/("history-"+period+".json")
        prior=json.loads(dest.read_text("utf-8")) if dest.exists() else {}
        existing=prior.get("data") if isinstance(prior.get("data"),list) and len(prior["data"])==4 else [{} for _ in INDICES]
        result=[]
        for i,(secid,ticker,name) in enumerate(INDICES):
            previous=existing[i].get(period,[])
            baseline=data[i].get(period,[])
            best=merge(previous,baseline)
            success=False
            for attempt in range(4):
                try:
                    remote=fetch_all(secid,period)
                    # Historical source should never replace longer valid archive with less.
                    best=merge(best,remote)
                    print("SUCCESS",name,period,"source bars",len(remote),"merged",len(best),best[0]["t"],best[-1]["t"],flush=True)
                    success=True
                    successes+=1
                    break
                except Exception as exc:
                    print("RETRY",name,period,attempt+1,type(exc).__name__,str(exc)[:140],flush=True)
                    time.sleep(4+attempt*4+random.random()*2)
            if not success:
                print("PRESERVE_EXISTING",name,period,len(best),best[0]["t"] if best else "-",flush=True)
            result.append({period:best})
            time.sleep(5+random.random()*2)
        payload={"source":"Eastmoney public index K-lines; fallback previous verified archive",
                 "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
                 "period":period,"data":result,
                 "counts":[len(r.get(period,[])) for r in result]}
        content=json.dumps(payload,ensure_ascii=False,separators=(",",":"))
        oldContent=dest.read_text("utf-8") if dest.exists() else ""
        if oldContent:
            priorCompare=json.loads(oldContent)
            if priorCompare.get("data")==payload["data"]:
                print("UNCHANGED",period,"avoided rewrite",flush=True)
                continue
        dest.write_text(content,encoding="utf-8")
        print("SAVED",dest,len(content),"bytes",payload["counts"],flush=True)
    print("BACKFILL_COMPLETE",successes,"/8 historical series fetched",flush=True)

if __name__=="__main__":run()
