"""Bundle the pinned pure Python PDF reader into the audit's immutable code."""
from pathlib import Path
import json
import zipfile
import pypdf
import hashlib
import python_minifier
import zlib
import base64

root = Path(__file__).resolve().parents[1]
output = root / '.contract-build'
output.mkdir(exist_ok=True)
reader = Path(pypdf.__file__).parent
manifest_file = root / 'deployments/studio.json'
metadata = {}
if manifest_file.exists():
    metadata = json.loads(manifest_file.read_text()).get('contracts', {}).get('audit', {}).get('archive_entry_metadata', {})

with zipfile.ZipFile(output / 'meter_audit.zip', 'w', compression=zipfile.ZIP_STORED) as z:
    def entry(name, data):
        saved = metadata.get(name, {})
        info = zipfile.ZipInfo(name, tuple(saved.get('date_time', (1980, 1, 1, 0, 0, 0))))
        info.external_attr = saved.get('external_attr', 0o600 << 16)
        info.create_system = saved.get('create_system', 3)
        z.writestr(info, data)
    entry('runner.json', json.dumps({'Depends': 'py-genlayer-multi:06zyvrlivjga0d5jlpdbprksc0pa6jmllxvp8s20hq1l512vh5yk'}))
    entry('contract/__init__.py', (root / 'contracts/meter_audit.py').read_text().replace('from pypdf import PdfReader', 'from .pypdf import PdfReader'))
    for f in sorted(reader.rglob('*.py')):
        source = python_minifier.minify(f.read_text().replace('from pypdf', 'from contract.pypdf').replace('import pypdf', 'from contract import pypdf'), rename_locals=False, rename_globals=False, remove_literal_statements=True)
        # ZIP entries must be stored by GenVM. Compress module source inside a
        # deterministic stdlib bootstrap to stay within Studio upload limits.
        encoded = base64.b85encode(zlib.compress(source.encode(), 9)).decode()
        wrapper = 'import zlib,base64\nexec(zlib.decompress(base64.b85decode('+repr(encoded)+')),globals())\n'
        entry(str(Path('contract/pypdf')/f.relative_to(reader)), wrapper)
    entry('contract/pypdf/LICENSE', (reader.parent / 'pypdf-6.10.2.dist-info/licenses/LICENSE').read_bytes())
print('Audit bundle SHA256:', hashlib.sha256((output / 'meter_audit.zip').read_bytes()).hexdigest())
