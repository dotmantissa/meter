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
    for path in sorted((root/'web/migrations').glob('*.sql')):
        content=path.read_text()
        statements=content.split('-- meter:statement') if '-- meter:statement' in content else content.split(';')
        for sql in statements:
            if sql.strip():query(sql)
        print('Applied',path.name)
    print('Meter schema is ready.')
