#!/usr/bin/env python3
"""Refresh candidates separately; never overwrite frozen study inputs."""
import concurrent.futures,datetime,hashlib,json,sys,urllib.request
from pathlib import Path

destination=Path(sys.argv[1]) if len(sys.argv)>1 else None
if destination is None:raise SystemExit('Usage: python fetch-execution-inputs.py <new-empty-source-directory> [YYYY-MM-DD]')
destination.mkdir(parents=True,exist_ok=True)
if any(destination.iterdir()):raise SystemExit('Destination must be empty: frozen evidence must not be overwritten')
cutoff=sys.argv[2] if len(sys.argv)>2 else '2026-11-20'
jobs=[]
for code,market in [('510210','1'),('159903','0'),('159915','0'),('588000','1')]:
    url='https://push2his.eastmoney.com/api/qt/stock/kline/get?fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&beg=19900101&end='+cutoff.replace('-','')+'&lmt=10000&secid='+market+'.'+code+'&fqt=0'
    jobs.append((code+'-unadjusted.json',url))
    symbol=('sz' if market=='0' else 'sh')+code
    jobs.append((code+'-sina.json','https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol='+symbol+'&scale=240&ma=no&datalen=20000'))
    jobs.append((code+'-actions.html','https://fundf10.eastmoney.com/fhsp_'+code+'.html'))
def fetch(job):
    name,url=job
    try:
        with urllib.request.urlopen(url,timeout=30) as response:raw=response.read()
        if name.endswith('.json'):json.loads(raw)
        (destination/name).write_bytes(raw)
        return {'file':name,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'status':'saved'}
    except Exception as error:return {'file':name,'url':url,'status':'failed','error':str(error)}
results=list(concurrent.futures.ThreadPoolExecutor(6).map(fetch,jobs))
(destination/'acquisition.json').write_text(json.dumps({'retrievedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cutoff':cutoff,'files':results},ensure_ascii=False,indent=2)+'\n')
for result in results:print(result['file'],result['status'])
if any(r['status']!='saved' for r in results):raise SystemExit(1)
