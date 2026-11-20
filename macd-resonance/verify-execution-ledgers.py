#!/usr/bin/env python3
"""Independent Decimal reconstruction of research accounts from fills and actions."""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import json,sys

root=Path(sys.argv[1] if len(sys.argv)>1 else Path(__file__).parent/'research/execution-20261120')
output=Path(sys.argv[2]) if len(sys.argv)>2 else root/'outputs'
protocol=json.loads((root/'protocol.json').read_text())
markets={m['etf']:m for m in protocol['markets']}
D=lambda x:Decimal(str(x))
cent=lambda x:x.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
checks=0;daily_rows=0;fills_checked=0
for file in sorted(output.glob('*-ledger.json')):
    run=json.loads(file.read_text());code=run['summary']['etf'];market=markets[code]
    if 'sina_ohlc_sensitivity' in file.name:
        source=json.loads((root/'sources'/(code+'-sina.json')).read_text())
        quotes={q['day']:D(q['close']) for q in source}
    else:
        source=json.loads((root/'inputs'/(code+'-unadjusted.json')).read_text())['data']['klines']
        quotes={line.split(',')[0]:D(line.split(',')[2]) for line in source}
    cash=D(protocol['initialCash']);shares={};claims=[]
    by_date={};actions={}
    for f in run['fills']:by_date.setdefault(f['date'],[]).append(f)
    for action in run['corporate']:actions.setdefault(action['date'],[]).append(action)
    before=[d for d in quotes if d<run['equity'][0]['date']]
    last_close=quotes[max(before)] if before else Decimal(0)
    if before:
        for split in market['splits']:
            if max(before)<split['date']<run['equity'][0]['date']:last_close/=D(split['ratio'])
    bought={}
    for e in run['equity']:
        day=e['date'];daily_rows+=1
        for split in market['splits']:
            if split['date']==day:
                for key in shares:shares[key]*=D(split['ratio'])
                last_close/=D(split['ratio'])
        for f in by_date.get(day,[]):
            fills_checked+=1
            assert f['signalT'] is None or f['date']>f['signalT'],(file.name,'same-day lookahead')
            assert f['date']>=market['listing'],(file.name,'prelisting trade')
            quantity=D(f['shares']);assert quantity%100==0
            assert D(f['price'])*1000==(D(f['price'])*1000).to_integral_value()
            amount=cent(quantity*D(f['price']));assert amount==D(f['amount'])
            cost=run['options']['costs'];fee=cent(max(D(cost['minimumFee']),cent(amount*D(cost['fee']))))
            assert fee==D(f['commission']),(file.name,'commission mismatch')
            if f['side']=='buy':
                assert f['id'] not in bought;cash-=amount+fee;shares[f['id']]=quantity;bought[f['id']]=day
            else:
                assert bought[f['id']]<day,(file.name,'T+1 violated')
                shares[f['id']]-=quantity;assert shares[f['id']]>=0
                cash+=amount-fee
        for action in actions.get(day,[]):
            if action['kind']=='dividend_entitlement':claims.append(action)
            elif action['kind']=='dividend_payment':cash+=D(action['amount'])
        last_close=quotes.get(day,last_close)
        assert cash>=0
        value=sum(shares.values(),Decimal(0))*last_close
        receivable=sum((D(c['amount']) for c in claims if c['ex']<=day<c['pay']),Decimal(0))
        nav=cent(cash+value+receivable)
        assert abs(nav-D(e['nav']))<=D('.01'),(file.name,day,str(nav),e['nav'])
        assert abs(cash-D(e['cash']))<=D('.01'),(file.name,day,'cash')
        assert abs(value-D(e['marketValue']))<=D('.01')
    assert abs(nav-D(run['summary']['endingNav']))<=D('.01')
    assert abs(sum((D(u['totalNetPnl']) for u in run['units']),Decimal(0))-(nav-D(protocol['initialCash'])))<=D('.03')
    checks+=1
result={'accounts':checks,'dailyRows':daily_rows,'fillsChecked':fills_checked,'status':'PASS','method':'Independent Python Decimal replay from fills, raw closes, splits and dividend entitlements/payments'}
(output/'independent-account-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result))
