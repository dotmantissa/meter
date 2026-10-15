"""Concurrent independent Neon requests against the exact reservation function.
Creates and removes only a unique test schema; never spends funds or uses app users.
"""
import concurrent.futures
import json
from pathlib import Path
import re
import sys
import uuid
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from migrate import query


def test_real_postgres_global_and_per_user_allowance():
    schema='meter_review_'+uuid.uuid4().hex
    migration=(ROOT/'web/migrations/002_review_lifecycle.sql').read_text()
    base=(ROOT/'web/migrations/001_meter.sql').read_text()
    query('CREATE SCHEMA '+schema)
    proof={}
    try:
        users=re.search(r'CREATE TABLE IF NOT EXISTS meter_sponsorships \(.*?\);',base,re.S).group(0)
        budget=re.search(r'CREATE TABLE IF NOT EXISTS meter_sponsor_budgets \(.*?\);',migration,re.S).group(0)
        query(users.replace('meter_sponsorships',schema+'.meter_sponsorships',1))
        query(budget.replace('meter_sponsor_budgets',schema+'.meter_sponsor_budgets',1))
        function=re.search(r'CREATE OR REPLACE FUNCTION meter_reserve_sponsorship.*?\$\$;',migration,re.S).group(0)
        function=function.replace('FUNCTION meter_reserve_sponsorship','FUNCTION '+schema+'.meter_reserve_sponsorship',1).replace('LANGUAGE plpgsql AS','LANGUAGE plpgsql SET search_path='+schema+' AS',1)
        query(function)
        def reserve(user):
            rows=query('SELECT '+schema+'.meter_reserve_sponsorship($1) AS reserved',[user])['rows']
            return rows[0]['reserved'] in (True,'t','true')
        query('INSERT INTO '+schema+'.meter_sponsor_budgets VALUES(CURRENT_DATE,99)')
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            reserved=list(pool.map(reserve,['unique-user-'+str(i) for i in range(12)]))
        assert sum(reserved)==1
        count=query('SELECT reserved FROM '+schema+'.meter_sponsor_budgets')['rows'][0]['reserved']
        assert int(count)==100
        proof['distinct_users']={'requests':12,'grants_reserved':sum(reserved),'daily_reserved':int(count)}
        query('TRUNCATE '+schema+'.meter_sponsor_budgets,'+schema+'.meter_sponsorships')
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            reserved=list(pool.map(reserve,['same-test-user']*12))
        assert sum(reserved)==1
        count=query('SELECT reserved FROM '+schema+'.meter_sponsor_budgets')['rows'][0]['reserved']
        assert int(count)==1
        proof['duplicate_user']={'requests':12,'grants_reserved':sum(reserved),'daily_reserved':int(count)}
        (ROOT/'.contract-build/review-db-concurrency.json').write_text(json.dumps(proof,indent=2)+'\n')
    finally:
        query('DROP SCHEMA '+schema+' CASCADE')
