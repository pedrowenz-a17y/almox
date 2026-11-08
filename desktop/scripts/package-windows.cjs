const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const desktop = path.resolve(__dirname, '..');

// On Unix, extract the embedded uninstaller with electron-builder's own PE/NSIS reader.
// This is the same reader upstream uses for builds on macOS Catalina. It avoids executing
// an intermediate Windows binary just to write its already-compiled uninstaller to disk.
// Keep the exact builder pin: these are internal, version-specific APIs.
if (process.platform !== 'win32') {
  const version = require('app-builder-lib/package.json').version;
  if (version !== '26.18.0') throw new Error('Revise a extração NSIS antes de atualizar electron-builder.');
  const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
  const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const expected = path.join(desktop, 'dist', `Almox-ERP-${require('../package.json').version}-Windows-x64-Setup.exe`);
  WineVmManager.prototype.exec = async function (file, args) {
    if (path.resolve(file) !== expected || args?.length) throw new Error('A extração Unix aceita somente o instalador intermediário deste projeto.');
    const uninstaller = path.join(path.dirname(file), `${path.basename(file, 'exe')}__uninstaller.exe`);
    await UninstallerReader.exec(file, uninstaller);
    console.log('Desinstalador NSIS extraído e validado pelo leitor oficial.');
    return '';
  };
}
build({ projectDir: desktop, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never' })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
