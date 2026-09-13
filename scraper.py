from __future__ import annotations

import json, re, sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

TZ = ZoneInfo('Asia/Shanghai')
TODAY = datetime.now(TZ).date()
TARGET = TODAY - timedelta(days=1)
OUT = Path('data/live.json')
DEBUG = Path('data/matched_article.txt')
OUT.parent.mkdir(parents=True, exist_ok=True)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36'
OFFICIAL_LANDING = 'https://www.fangdi.com.cn/old_house/old_house.html'
OFFICIAL_API = 'https://www.fangdi.com.cn/oldhouse/getSHYesterdaySell.action'
SOHU_PROFILE = 'https://mp.sohu.com/profile?_trans_=000019_wzwza%3D&xpt=MUJGMDZBRjZENTY3RUNGMDI1OEZCNjY0NURDNzQwOUNAcXEuc29odS5jb20%3D'


def num(s): return int(s.replace(',', ''))
def flt(s): return float(s.replace(',', ''))


def date_matches(text: str, d) -> bool:
    vals=[f'{d.month}月{d.day}日',f'{d.month}月{d.day}号',f'{d.year}年{d.month}月{d.day}日',d.isoformat(),f'{d.month}/{d.day}',f'{d.month}-{d.day}']
    return any(x in text for x in vals)


def context(text: str, keyword: str, radius=120):
    out=[]
    for m in re.finditer(keyword,text):
        a=max(0,m.start()-radius); b=min(len(text),m.end()+radius)
        out.append(text[a:b].replace('\n',' '))
        if len(out)>=12: break
    return out


def parse_units_area(text: str):
    # Strong preference for explicit single-day phrases. Never use cumulative/截至 values as daily.
    sh_units=new_units=sh_area=new_area=None
    sh_patterns=[
        r'(?:当日|昨日|今日)?\s*二手(?:房)?(?:成交|网签|签约)[^\d]{0,10}(\d[\d,]*)\s*套',
        r'二手(?:房)?[^\n]{0,18}?(?:成交|网签)[^\d]{0,8}(\d[\d,]*)\s*套'
    ]
    new_patterns=[
        r'(?:当日|昨日|今日)?\s*(?:一手|新房|新建商品房)(?:成交|网签|签约)[^\d]{0,10}(\d[\d,]*)\s*套',
        r'(?:一手|新房)[^\n]{0,18}?(?:成交|网签)[^\d]{0,8}(\d[\d,]*)\s*套'
    ]
    def first_valid(patterns):
        for p in patterns:
            for m in re.finditer(p,text,re.S|re.I):
                snippet=text[max(0,m.start()-35):min(len(text),m.end()+35)]
                if re.search(r'累计|截至|月内|本月',snippet):
                    continue
                try:
                    v=num(m.group(1))
                except: continue
                # daily Shanghai market counts should not be in the many-thousands; reject obvious cumulative values
                if v>2500: continue
                return v
        return None
    sh_units=first_valid(sh_patterns)
    new_units=first_valid(new_patterns)
    for p in [r'二手(?:房)?(?:成交|网签|签约)?面积[^\d]{0,12}([\d,]+(?:\.\d+)?)\s*(?:㎡|平方米)']:
        m=re.search(p,text,re.S|re.I)
        if m:
            sh_area=flt(m.group(1)); break
    for p in [r'(?:一手|新房|新建商品房)(?:成交|网签|签约)?面积[^\d]{0,12}([\d,]+(?:\.\d+)?)\s*(?:㎡|平方米)']:
        m=re.search(p,text,re.S|re.I)
        if m:
            new_area=flt(m.group(1)); break
    return sh_units,new_units,sh_area,new_area


def official():
    s=requests.Session(); h={'User-Agent':UA,'Accept-Language':'zh-CN,zh;q=0.9'}
    r0=s.get(OFFICIAL_LANDING,headers=h,timeout=20)
    print('official landing',r0.status_code,len(r0.content))
    if r0.status_code>=400: return None
    h2={**h,'Referer':OFFICIAL_LANDING,'Origin':'https://www.fangdi.com.cn','X-Requested-With':'XMLHttpRequest','Accept':'application/json,text/javascript,*/*;q=0.01'}
    r=s.post(OFFICIAL_API,headers=h2,timeout=20)
    print('official api',r.status_code,r.text[:300])
    if not r.ok: return None
    obj=r.json(); sh_units=sh_area=None
    if isinstance(obj,dict):
        for k,v in obj.items():
            lk=k.lower()
            if lk=='sellcount' or ('count' in lk and sh_units is None):
                try: sh_units=int(float(v))
                except: pass
            if ('area' in lk or 'square' in lk) and sh_area is None:
                try: sh_area=float(v)
                except: pass
    if sh_units is None and sh_area is None: return None
    return dict(source_tier='official_raw',source_name='上海市房地产交易中心·网上房地产',source_url=OFFICIAL_API,secondhand_units=sh_units,new_units=None,secondhand_area_m2=sh_area,new_area_m2=None)


def relay_sohu():
    h={'User-Agent':UA,'Accept-Language':'zh-CN,zh;q=0.9'}
    r=requests.get(SOHU_PROFILE,headers=h,timeout=25)
    print('sohu profile',r.status_code,len(r.content),r.url)
    if not r.ok: return None
    soup=BeautifulSoup(r.text,'html.parser'); links=[]
    for a in soup.find_all('a',href=True):
        href=urljoin(r.url,a['href'])
        if ('sohu.com/a/' in href or 'mp.sohu.com/a/' in href) and href not in links: links.append(href)
    print('candidate links',len(links))
    for href in links[:40]:
        try:
            rr=requests.get(href,headers=h,timeout=20)
            if not rr.ok: continue
            txt=BeautifulSoup(rr.text,'html.parser').get_text('\n',strip=True)
            if '网上房地产' not in txt or not date_matches(txt,TARGET): continue
            DEBUG.write_text('URL: '+href+'\n\n'+'\n---\n'.join(context(txt,r'套|二手|一手|新房|累计|截至',150)),encoding='utf-8')
            sh,new,sha,newa=parse_units_area(txt)
            print('matched',href,sh,new,sha,newa)
            if sh is not None or new is not None:
                return dict(source_tier='official_relay',source_name='今日房产（上游：网上房地产）',source_url=href,secondhand_units=sh,new_units=new,secondhand_area_m2=sha,new_area_m2=newa)
        except Exception as e:
            print('article error',href,repr(e))
    return None


def build_result(payload):
    sh=payload.get('secondhand_units'); new=payload.get('new_units'); sha=payload.get('secondhand_area_m2'); newa=payload.get('new_area_m2')
    return {'schema_version':'1.2','dashboard_date':TODAY.isoformat(),'target_date':TARGET.isoformat(),'latest_date':TARGET.isoformat(),'status':'fresh','freshness_days':0,**payload,'secondhand_avg_area_m2':round(sha/sh,2) if sha and sh else None,'new_avg_area_m2':round(newa/new,2) if newa and new else None,'last_checked_at':datetime.now(TZ).isoformat(timespec='seconds')}


def main():
    payload=None; errors=[]
    try: payload=official()
    except Exception as e: errors.append('official:'+repr(e)); print(errors[-1])
    if payload is None:
        try: payload=relay_sohu()
        except Exception as e: errors.append('relay:'+repr(e)); print(errors[-1])
    if payload is None:
        result={'schema_version':'1.2','dashboard_date':TODAY.isoformat(),'target_date':TARGET.isoformat(),'latest_date':None,'status':'failed','freshness_days':None,'secondhand_units':None,'new_units':None,'secondhand_area_m2':None,'new_area_m2':None,'secondhand_avg_area_m2':None,'new_avg_area_m2':None,'source_tier':None,'source_name':None,'source_url':None,'errors':errors,'last_checked_at':datetime.now(TZ).isoformat(timespec='seconds')}
    else:
        result=build_result(payload); result['errors']=errors
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if result['status']!='fresh': sys.exit(2)

if __name__=='__main__': main()
