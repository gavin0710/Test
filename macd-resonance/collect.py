#!/usr/bin/env python3
"""Collect index OHLC bars for MACD resonance. No third-party dependency."""
import datetime as dt
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

INDICES = [
    ("1.000001", "上证指数"),
    ("0.399001", "深证成指"),
    ("0.399006", "创业板指"),
    ("1.000688", "科创50"),
]
PERIODS = {"15": 1800, "101": 500, "102": 350}
DEST = Path(__file__).resolve().parent / "data" / "latest.json"

def get(secid, klt, limit):
    params = urllib.parse.urlencode({
        "secid": secid,
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
        "klt": klt,
        "fqt": 0,
        "beg": "0",
        "end": "20500101",
        "lmt": limit,
    })
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params
    request = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/", "Accept": "application/json"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=13) as res:
                data = json.load(res)
            lines = data["data"]["klines"]
            rows = []
            for line in lines:
                arr = line.split(",")
                stamp = arr[0].replace(" ", "T")
                o, c, h, l = [float(arr[k]) for k in (1, 2, 3, 4)]
                if o <= 0 or c <= 0 or h < l:
                    continue
                rows.append({"t": stamp, "o": o, "c": c, "h": h, "l": l})
            if len(rows) < 65:
                raise ValueError("Too few validated bars: " + str(len(rows)))
            rows.sort(key=lambda x: x["t"])
            unique = list({x["t"]: x for x in rows}.values())
            return sorted(unique, key=lambda x: x["t"])
        except (OSError, ValueError, KeyError, TypeError) as exc:
            last = exc
            time.sleep(1.8 * (attempt + 1))
    raise RuntimeError(f"{secid} {klt} failed: {last}")

def main():
    collected = []
    for code, name in INDICES:
        p = {}
        for klt, limit in PERIODS.items():
            p[klt] = get(code, klt, limit)
            print(f"{name} {klt}: {len(p[klt])} bars, latest {p[klt][-1]['t']}", flush=True)
            time.sleep(.22)
        collected.append(p)
    old = {}
    if DEST.exists():
        try:
            old = json.loads(DEST.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    if old.get("data") == collected:
        print("No new bars, preserving previous snapshot.")
        return
    payload = {
        "source": "Eastmoney public historical K-line endpoint; raw unadjusted index OHLC",
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data": collected,
        "codes": [x[0] for x in INDICES],
        "periods": list(PERIODS),
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = DEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, DEST)
    print(f"Updated {DEST} ({DEST.stat().st_size} bytes).")

if __name__ == "__main__":
    main()
