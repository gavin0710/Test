#!/usr/bin/env python3
"""Rebuild the 2026-11-21 minute backfill from frozen, genuine source responses.

Existing archive rows win on overlap. Incomplete source days are excluded rather
than padded. This changes market-data coverage, never the trading engine.
"""
import argparse
from collections import defaultdict
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUNDLE = ROOT / 'data/minute-sources-20261121.json.gz'
AUDIT = ROOT / 'data/minute-backfill-20261121.json'
ARCHIVE = ROOT / 'data/history-15.json'
TICKERS = ['sh000001', 'sz399001', 'sz399006', 'sh000688']
SLOTS = [f'{h:02}:{m:02}' for h, minutes in [(9, [45]), (10, [0, 15, 30, 45]),
         (11, [0, 15, 30]), (13, [15, 30, 45]), (14, [0, 15, 30, 45]), (15, [0])] for m in minutes]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def aggregate(bars):
    return dict(o=bars[0]['o'], c=bars[-1]['c'], h=max(b['h'] for b in bars), l=min(b['l'] for b in bars))


def differences(a, b, tolerance=.011):
    return {k: round(a[k] - b[k], 6) for k in ['o', 'c', 'h', 'l'] if abs(a[k] - b[k]) > tolerance}


def read_source(bundle, name):
    record = bundle['responses'][name]
    assert hashlib.sha256(record['body'].encode()).hexdigest() == record['sha256'], name
    return json.loads(record['body'])


def normalized(rows):
    result = []
    for row in rows:
        stamp = row['day'][:16].replace(' ', 'T')
        dt.datetime.strptime(stamp, '%Y-%m-%dT%H:%M')
        b = dict(t=stamp, **{k: float(row[s]) for k, s in [('o', 'open'), ('c', 'close'), ('h', 'high'), ('l', 'low')]})
        assert all(math.isfinite(b[k]) for k in ['o', 'c', 'h', 'l'])
        assert 0 < b['l'] <= min(b['o'], b['c']) <= max(b['o'], b['c']) <= b['h'], stamp
        assert not result or result[-1]['t'] < stamp, stamp
        result.append(b)
    return result


def build(bundle):
    for name in bundle['responses']:
        read_source(bundle, name)
    before = bundle['baselineArchive']
    markets = []
    result = []
    for i, ticker in enumerate(TICKERS):
        rows = normalized(read_source(bundle, ticker + '-sina-1970'))
        days = defaultdict(list)
        for b in rows:
            assert b['t'] <= bundle['marketCutoff']
            days[b['t'][:10]].append(b)
        full = {d: v for d, v in days.items() if [b['t'][11:] for b in v] == SLOTS}
        skipped = [{'date': d, 'observedBars': len(v), 'reason': 'incomplete source day; no synthetic bars'}
                   for d, v in days.items() if d not in full]
        assert full and max(full) == bundle['marketCutoff'][:10]
        daily = {b['t']: b for b in bundle['baselineDaily'][i]}
        expected_days = sorted(d for d in daily if min(full) <= d <= max(full))
        assert sorted(full) == expected_days, (ticker, 'missing index trading sessions')
        day_diff = []
        hourly_diff = []
        hourly_closes = 0
        qq_rows = read_source(bundle, ticker + '-tencent-m60')['data'][ticker]['m60']
        qq = {dt.datetime.strptime(b[0], '%Y%m%d%H%M').strftime('%Y-%m-%dT%H:%M'):
              dict(zip(['o', 'c', 'h', 'l'], map(float, b[1:5]))) for b in qq_rows}
        for d, bars in full.items():
            assert abs(bars[-1]['c'] - daily[d]['c']) <= .011, (ticker, d, 'daily close conflict')
            delta = differences(aggregate(bars), daily[d])
            if delta:
                day_diff.append(dict(date=d, primary=aggregate(bars), daily=daily[d], delta=delta))
            # Independent hourly closing prices check symbol/date/time alignment.
            # Native hourly opens/extremes can have provider/session differences.
            for start in range(0, 16, 4):
                block = bars[start:start+4]
                stamp = block[-1]['t']
                assert stamp in qq, (ticker, stamp, 'missing independent hourly reference')
                assert abs(block[-1]['c'] - qq[stamp]['c']) <= .011, (ticker, stamp, 'hourly close conflict')
                hourly_closes += 1
                delta = differences(aggregate(block), qq[stamp])
                if delta:
                    hourly_diff.append(dict(t=stamp, primary=aggregate(block), independent=qq[stamp], delta=delta))
        incoming = {b['t']: b for d in sorted(full) for b in full[d]}
        previous = {b['t']: b for b in before['data'][i]['15']}
        overlap_diff = [dict(t=t, existing=previous[t], primary=incoming[t], delta=differences(incoming[t], previous[t]))
                        for t in sorted(incoming.keys() & previous.keys()) if differences(incoming[t], previous[t])]
        combined = {**incoming, **previous}
        merged = [combined[t] for t in sorted(combined)]
        assert all(combined[t] == b for t, b in previous.items()), 'existing prices must not change'
        added = [b for b in merged if b['t'] not in previous]
        # This frozen batch extends only the prefix; it must not revise old rows.
        assert all(b['t'] < min(previous) for b in added)
        result.append({'15': merged})
        markets.append(dict(ticker=ticker, beforeBars=len(previous), afterBars=len(merged), addedBars=len(added),
                            start=merged[0]['t'], end=merged[-1]['t'], completeTradingDays=len(full),
                            omittedIncompleteDays=skipped, preservedBaselineSHA256=digest(list(previous.values())),
                            existingOverlapDifferences=overlap_diff, dailyOHLCConflicts=day_diff,
                            independentlyCheckedHourlyCloses=hourly_closes, independentHourlyOHLCConflicts=hourly_diff))
    payload = dict(source='Verified intraday OHLC; Eastmoney/Tencent archive with frozen Sina historical backfill',
                   period='15', generated_at_utc=bundle['retrievedAt'],
                   backfills=[dict(id='20261121', source='Sina Finance', audit='minute-backfill-20261121.json',
                                   baselineCommit=bundle['baselineCommit'], policy='existing archive rows preserved')], data=result)
    audit = dict(id='20261121', baselineCommit=bundle['baselineCommit'], marketCutoff=bundle['marketCutoff'],
                 retrievedAt=bundle['retrievedAt'], sourceBundle='minute-sources-20261121.json.gz',
                 sources=[{k: r[k] for k in ['name', 'url', 'sha256', 'retrievedAt']} for r in bundle['responses'].values()],
                 policy={'overlap': 'preserve every existing archive OHLC row', 'incompleteDays': 'exclude; never pad',
                         'providerConflicts': 'retain genuine source values; record all differences above 0.011 points',
                         'signalRules': 'unchanged; longer indicator warm-up can change minute signals',
                         'executionResearch': '2026-11-20 frozen daily study inputs and outputs remain unchanged'},
                 markets=markets, outputDataSHA256=digest(result))
    return payload, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify the frozen backfill and preservation inside the current archive')
    args = parser.parse_args()
    bundle = json.loads(gzip.decompress(BUNDLE.read_bytes()))
    expected, audit = build(bundle)
    if args.check:
        current = json.loads(ARCHIVE.read_text())
        for i, item in enumerate(expected['data']):
            by_time = {b['t']: b for b in current['data'][i]['15']}
            old_start = bundle['baselineArchive']['data'][i]['15'][0]['t']
            assert all(by_time.get(b['t']) == b for b in item['15'] if b['t'] < old_start), 'frozen source backfill changed or lost'
        assert json.loads(AUDIT.read_text()) == audit, 'audit does not match frozen responses'
    else:
        ARCHIVE.write_text(json.dumps(expected, ensure_ascii=False, separators=(',', ':')) + '\n')
        AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'check': args.check, 'markets': [{k: m[k] for k in ['ticker', 'beforeBars', 'afterBars', 'addedBars', 'start', 'end', 'completeTradingDays', 'independentlyCheckedHourlyCloses']}
                                                      for m in audit['markets']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
