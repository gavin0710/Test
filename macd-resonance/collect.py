#!/usr/bin/env python3
"""Collect authenticated-by-source (public API) raw A-share index K-lines.
All rows must be genuine OHLC data. Never synthesize quotes on provider failure.
"""
import datetime as dt
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

INDICES = [
    ("1.000001", "sh000001", "上证指数"),
    ("0.399001", "sz399001", "深证成指"),
    ("0.399006", "sz399006", "创业板指"),
    ("1.000688", "sh000688", "科创50"),
]
PERIODS = {"15": 1800, "60": 900, "101": 500, "102": 350}
DEST = Path(__file__).resolve().parent / "data" / "latest.json"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/", "Accept": "application/json,text/plain,*/*"}

def retrieve_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=16) as res:
        raw = res.read().decode("utf-8", errors="replace")
    if raw.startswith("var ") and "=" in raw:
        raw = raw.split("=", 1)[1].strip().rstrip(";")
    return json.loads(raw)

def normalize(rows):
    unique = {}
    for row in rows:
        try:
            date, o, c, h, l = row[:5]
            o, c, h, l = map(float, [o,c,h,l])
            if not all(map(lambda x: x == x and abs(x) < 1e10, (o,c,h,l))):
                continue
            if o <= 0 or c <= 0 or h < l or min(o,c) < l-.01 or max(o,c) > h+.01:
                continue
            unique[str(date)] = {"t": str(date), "o": o, "c": c, "h": h, "l": l}
        except (ValueError, TypeError, IndexError):
            continue
    return [unique[k] for k in sorted(unique)]

def eastmoney(secid, klt, count):
    beg = "0" if klt in ("15","60") else ("20220101" if klt=="101" else "20180101")
    params = urllib.parse.urlencode({
        "secid": secid, "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
        "klt": klt, "fqt": 0, "beg": beg, "end": "20500101", "lmt": count})
    obj = retrieve_json("https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params)
    lines = obj["data"]["klines"]
    return normalize([[x.split(",")[0].replace(" ","T")] + x.split(",")[1:5] for x in lines])

def shift_tencent_minute(t, minute_length, start_times):
    digits = t.replace("-","").replace("T","").replace(":","").replace(" ","")
    if len(digits) < 12:
        raise ValueError("Unexpected Tencent minute stamp: " + t)
    date = dt.datetime.strptime(digits[:12],"%Y%m%d%H%M")
    if start_times:
        date += dt.timedelta(minutes=minute_length)
    return date.strftime("%Y-%m-%dT%H:%M")

def tencent(ticker, klt, count):
    if klt in ("15", "60"):
        typ="m"+klt
        param=f"{ticker},{typ},,,{min(640,count)}"
        url="https://web.ifzq.gtimg.cn/appstock/app/kline/mkline?"+urllib.parse.urlencode({"param":param})
    else:
        typ="day" if klt=="101" else "week"
        param=f"{ticker},{typ},,,{min(640,count)}"
        url="https://web.ifzq.gtimg.cn/appstock/app/kline/kline?"+urllib.parse.urlencode({"param":param})
    obj=retrieve_json(url)
    lines=obj["data"][ticker][typ]
    if not lines:raise ValueError("Empty Tencent K-line")
    if klt in ("15", "60"):
        observed=[str(z[0])[-4:] for z in lines]
        start_times = ("0930" in observed or "1300" in observed)
        rows=[[shift_tencent_minute(str(z[0]),int(klt),start_times)]+list(z[1:5]) for z in lines]
    else:
        rows=[[str(z[0]).replace(" ","T")]+list(z[1:5]) for z in lines]
    return normalize(rows)

def get(secid,ticker,klt,count):
    errors=[]
    for fn,source in ((lambda: eastmoney(secid,klt,count),"东方财富"),(lambda:tencent(ticker,klt,count),"腾讯备用源")):
        for attempt in range(2):
            try:
                rows=fn()
                if len(rows)<65:raise ValueError(f"Only {len(rows)} usable bars")
                return rows,source
            except (OSError,ValueError,KeyError,TypeError,IndexError,json.JSONDecodeError) as exc:
                errors.append(f"{source} {type(exc).__name__}: {exc}")
                time.sleep(3+attempt*4)
    raise RuntimeError(f"Failed {secid}/{klt}: "+"; ".join(errors))


def archive_intraday(old_data, updated_data):
    """Append verified 15-minute bars over time; never truncate older history."""
    destination=DEST.parent/"history-15.json"
    try:
        archive=json.loads(destination.read_text("utf-8")) if destination.exists() else {}
    except (OSError,json.JSONDecodeError):
        archive={}
    existing=archive.get("data") if isinstance(archive.get("data"),list) and len(archive["data"])==4 else [{} for _ in INDICES]
    result=[]
    for i in range(len(INDICES)):
        combined={}
        for batch in [existing[i].get("15",[]),old_data[i].get("15",[]),updated_data[i].get("15",[])]:
            for b in batch:
                try:
                    t=b["t"]
                    o,c,h,l=(float(b[k]) for k in ("o","c","h","l"))
                    if not t or o<=0 or c<=0 or not(l<=min(o,c)<=h and l<=max(o,c)<=h):
                        continue
                    combined[t]={"t":t,"o":o,"c":c,"h":h,"l":l}
                except (KeyError,TypeError,ValueError):
                    continue
        result.append({"15":[combined[t] for t in sorted(combined)]})
    if archive.get("data")==result:return
    destination.parent.mkdir(parents=True,exist_ok=True)
    payload={"source":"Accumulated verified intraday OHLC, Eastmoney/Tencent",
            "period":"15",
            "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
            "data":result}
    tmp=destination.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    os.replace(tmp,destination)
    print("ARCHIVED_15M",[len(x["15"]) for x in result],flush=True)

def main():
    old={}
    if DEST.exists():
        try:old=json.loads(DEST.read_text(encoding="utf-8"))
        except (OSError,json.JSONDecodeError):pass
    data=old.get("data") if isinstance(old.get("data"),list) and len(old["data"])==4 else [{} for _ in INDICES]
    sources=old.get("providers") if isinstance(old.get("providers"),list) and len(old["providers"])==4 else [{} for _ in INDICES]
    failed=[]
    # Prioritize 15m and 60m for all four indexes. Stagger to reduce endpoint throttling.
    for klt,count in PERIODS.items():
        for i,(secid,ticker,name) in enumerate(INDICES):
            try:
                rows,provider=get(secid,ticker,klt,count)
                data[i][klt]=rows
                sources[i][klt]=provider
                print(f"{name} {klt} {provider}: {len(rows)} bars, latest {rows[-1]['t']}",flush=True)
            except Exception as exc:
                failed.append(str(exc))
                print("WARNING",str(exc),flush=True)
            time.sleep(2.0)
    good=sum(1 for index in data for p in PERIODS if len(index.get(p,[]))>=65)
    if good<4:
        raise RuntimeError(f"Insufficient raw market data ({good}/16): "+"; ".join(failed))
    payload={
        "source":"Eastmoney/Tencent public index OHLC endpoints; unadjusted",
        "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "data":data,"providers":sources,"codes":[x[0] for x in INDICES],"periods":list(PERIODS),
        "failed_sources":failed,
    }
    archive_intraday(old.get("data") if isinstance(old.get("data"),list) and len(old["data"])==4 else [{} for _ in INDICES],data)
    old_compare={k:old.get(k) for k in ("data","providers","failed_sources")}
    new_compare={k:payload.get(k) for k in old_compare}
    if old_compare==new_compare:
        print("No K-line data changes; preserving existing snapshot.")
        return
    DEST.parent.mkdir(parents=True,exist_ok=True)
    tmp=DEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    os.replace(tmp,DEST)
    print(f"Saved {good}/16 source series; {len(failed)} requests failed; bytes={DEST.stat().st_size}")

if __name__=="__main__":
    main()
