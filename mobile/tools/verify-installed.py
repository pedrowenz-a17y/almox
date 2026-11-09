"""Check the actual signed release's native first-open/reopen UI in the emulator."""
from pathlib import Path
import json
import sys
import xml.etree.ElementTree as ET

folder = Path(sys.argv[1])
for name in ['first-open.xml', 'reopened.xml']:
    nodes = list(ET.parse(folder / name).getroot().iter('node'))
    labels = {node.get('text') for node in nodes}
    assert 'Conectar à minha unidade' in labels, f'Connection screen absent in {name}'
    assert 'Endereço do ERP' in labels, f'Origin field absent in {name}'
    assert any(node.get('package') == 'br.uca.almox.mobile' for node in nodes), 'Wrong application'
log = (folder / 'logcat.txt').read_text(errors='replace')
assert 'FATAL EXCEPTION: main' not in log, 'Fatal main-thread error; inspect emulator logs'
assert 'android.view.WindowLeaked' not in log, 'Leaked Android dialog; inspect emulator logs'
report = {'scope': 'Instalação e abertura do APK release assinado; sem login ou dados reais.',
          'androidApi': 35, 'installed': True, 'firstOpen': True, 'reopened': True,
          'nativeConnectionScreen': True, 'mainThreadFatalErrors': 0, 'leakedDialogs': 0}
(folder / 'installation-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
