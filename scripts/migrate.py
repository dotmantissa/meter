"""Apply only Meter's namespaced schema through Neon HTTPS."""
from pathlib import Path
from dotenv import dotenv_values
import json
import urllib.request
import re
from urllib.parse import urlparse
root=Path(__file__).resolve().parents[1]
connection=dotenv_values(root/'.env')['DATABASE_URL']
host=urlparse(connection).hostname
endpoint='https://'+re.sub(r'^[^.]+\.', 'api.', host)+'/sql'

def query(sql, params=None):
    request=urllib.request.Request(endpoint,data=json.dumps({'query':sql,'params':params or []}).encode(),headers={'Content-Type':'application/json','Neon-Connection-String':connection})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

if __name__=='__main__':
    for sql in (root/'web/migrations/001_meter.sql').read_text().split(';'):
        if sql.strip():query(sql)
    print('Meter schema is ready.')
