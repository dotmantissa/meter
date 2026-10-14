"""Index actual registered contract state, never a synthetic tariff response."""
from pathlib import Path
import json
from migrate import query
root=Path(__file__).resolve().parents[1]
rows=json.loads((root/'.contract-build/tariff-index.json').read_text())
for row in rows:
    query('''INSERT INTO meter_tariffs(id,utility_id,utility_name,schedule_id,state,source_url,regulator_url,order_url,effective_from,effective_to,content_hash,changed_without_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(id) DO UPDATE SET content_hash=EXCLUDED.content_hash,changed_without_date=EXCLUDED.changed_without_date,indexed_at=now()''',
    [row[k] for k in ('id','utility_id','utility_name','schedule_id','state','source_url','regulator_url','order_url','effective_from','effective_to','content_hash','changed_without_date')])
print('Indexed',len(rows),'actual registry entries.')
