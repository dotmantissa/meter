"""Bundle the pinned pure Python PDF reader into the audit's immutable code."""
from pathlib import Path
import json
import zipfile
import pypdf
import hashlib

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts'
output.mkdir(exist_ok=True)
reader = Path(pypdf.__file__).parent
with zipfile.ZipFile(output / 'meter_audit.zip', 'w', compression=zipfile.ZIP_STORED) as z:
    z.writestr('runner.json', json.dumps({'Depends': 'py-genlayer-multi:06zyvrlivjga0d5jlpdbprksc0pa6jmllxvp8s20hq1l512vh5yk'}))
    z.write(root / 'contracts/meter_audit.py', 'contract/__init__.py')
    for f in sorted(reader.rglob('*.py')):
        z.write(f, str(Path('pypdf')/f.relative_to(reader)))
    z.write(reader.parent / 'pypdf-6.10.2.dist-info/licenses/LICENSE', 'pypdf/LICENSE')
print('Audit bundle SHA256:', hashlib.sha256((output / 'meter_audit.zip').read_bytes()).hexdigest())
