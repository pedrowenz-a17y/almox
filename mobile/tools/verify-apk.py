"""Verify the actual release APK/merged manifest, and write a public, credential-free report."""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

apk, manifest, output = map(Path, sys.argv[1:4])
ns = '{http://schemas.android.com/apk/res/android}'
root = ET.parse(manifest).getroot()
assert root.attrib['package'] == 'br.uca.almox.mobile', 'Package incorreto'
app = root.find('application')
assert app.get(ns + 'debuggable', 'false') == 'false', 'APK release depurável'
assert app.get(ns + 'allowBackup') == 'false', 'Backup não desativado'
assert app.get(ns + 'usesCleartextTraffic') == 'false', 'HTTP não bloqueado'
permissions = [item.get(ns + 'name') for item in root.findall('uses-permission')]
allowed = {'android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.CAMERA',
           'br.uca.almox.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'}
assert set(permissions) <= allowed, 'Permissão inesperada'
assert 'android.permission.CAMERA' in permissions
sdk = root.find('uses-sdk')
assert int(sdk.get(ns + 'minSdkVersion')) == 26
assert int(sdk.get(ns + 'targetSdkVersion')) == 36
with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None
    assert {'classes.dex', 'AndroidManifest.xml', 'resources.arsc'} <= set(archive.namelist())
    for name in archive.namelist():
        assert not Path(name).name.startswith('.env'), 'Arquivo .env no APK'
        assert not name.endswith(('.jks', '.keystore', 'store-password.txt')), 'Chave privada no APK'
report = {'applicationId': root.attrib['package'], 'version': root.get(ns + 'versionName'),
          'minAndroidApi': 26, 'targetAndroidApi': 36, 'bytes': apk.stat().st_size,
          'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'permissions': permissions,
          'debuggable': False, 'cleartextTraffic': False, 'backup': False, 'privateEnvFiles': 0,
          'scope': 'APK release e manifesto inspecionados. A assinatura é feita separadamente, fora do CI.'}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
