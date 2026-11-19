const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, screen, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serverOrigin, importEnvironment, saveConfiguration, loadConfiguration, startLocalServer, isWithinOrigin, cameraAllowed, isSetupFile } = require('./runtime.cjs');

let window, setupWindow, localServer, activeOrigin, changing = false, shuttingDown = false;
let setupError = '', setupMessage = '', setupOrigin = '';
const setupFile = path.join(__dirname, 'setup', 'index.html');
const configFile = () => path.join(app.getPath('userData'), 'connection.json');
const icon = path.join(__dirname, 'assets', 'icon.png');
const allowedContents = new Map();
const initializedSessions = new WeakSet();

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const target = setupWindow || window; if (target) { if (target.isMinimized()) target.restore(); target.focus(); } });
  app.whenReady().then(initialize).catch(() => { dialog.showErrorBox('Almox ERP', 'Não foi possível iniciar o aplicativo. Abra novamente.'); app.quit(); });
}
app.on('before-quit', () => { shuttingDown = true; localServer?.stop(); });
app.on('window-all-closed', () => { if (!changing) app.quit(); });

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Arquivo', submenu: [
      { label: 'Configurar conexão…', click: () => { setupError = ''; openSetup(); } },
      { type: 'separator' }, { label: 'Sair', role: 'quit' },
    ] },
    { label: 'Exibir', submenu: [
      { label: 'Recarregar', role: 'reload' }, { type: 'separator' },
      { label: 'Tamanho original', role: 'resetZoom' }, { label: 'Aumentar', role: 'zoomIn' },
      { label: 'Diminuir', role: 'zoomOut' }, { label: 'Tela cheia', role: 'togglefullscreen' },
    ] },
    { label: 'Ajuda', submenu: [{ label: 'Sobre o Almox', click: () => dialog.showMessageBox({
      type: 'info', title: 'Almox ERP', message: `Almox ERP ${app.getVersion()}`,
      detail: 'Gestão de materiais · U.C.A.\nO modo local inicia o servidor automaticamente. Login e operações precisam de acesso ao banco e ao serviço de autenticação.',
    }) }] },
  ]));
}

async function initialize() {
  app.setAppUserModelId('br.uca.almox.desktop');
  menu();
  ipcMain.handle('almox:status', event => {
    assertSetup(event);
    return { version: app.getVersion(), error: setupError, message: setupMessage, origin: setupOrigin, configured: Boolean(activeOrigin) };
  });
  ipcMain.handle('almox:connect', async (event, origin) => {
    assertSetup(event);
    return configure(async () => ({ mode: 'remote', origin: serverOrigin(typeof origin === 'string' ? origin : '') }));
  });
  ipcMain.handle('almox:import-local', async event => {
    assertSetup(event);
    return configure(async () => {
      const selected = await dialog.showOpenDialog(setupWindow, { title: 'Importar configuração do servidor Almox', properties: ['openFile'], filters: [{ name: 'Configuração (.env)', extensions: ['env', '*'] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const file = selected.filePaths[0];
      const stat = await fs.stat(file);
      if (stat.size > 64 * 1024) throw new Error('Escolha um arquivo de configuração de até 64 KB.');
      return { mode: 'local', env: importEnvironment(await fs.readFile(file, 'utf8')) };
    });
  });
  try {
    changing = true;
    const config = await loadConfiguration(configFile(), safeStorage);
    if (!config) return openSetup();
    setupOrigin = config.mode === 'remote' ? config.origin : '';
    openSetup('Abrindo o Almox…');
    await launch(config);
  } catch (error) { setupError = safeMessage(error); openSetup(); }
  finally { changing = false; }
}

function assertSetup(event) {
  const frame = event.senderFrame, mainFrame = event.sender.mainFrame;
  if (!setupWindow || event.sender.id !== setupWindow.webContents.id || !frame || frame.processId !== mainFrame.processId ||
    frame.routingId !== mainFrame.routingId || !isSetupFile(frame.url, setupFile))
    throw new Error('Ação não autorizada.');
}

function safeMessage(error) {
  // All operational messages are fixed strings from our own runtime. Never return driver/provider values.
  const message = error instanceof Error ? error.message : '';
  const allowed = ['Informe o endereço', 'Confira ', 'Configure uma chave', 'ASSISTANT_PROVIDER deve', 'O arquivo de configuração', 'Escolha um arquivo', 'A proteção de credenciais', 'O servidor local não iniciou', 'Não foi possível ler a configuração', 'A configuração tem', 'Escolha novamente', 'Não foi possível abrir as credenciais', 'Não foi possível acessar o ERP'];
  return allowed.some(prefix => message.startsWith(prefix)) ? message : 'Não foi possível abrir a conexão. Confira a configuração e tente novamente.';
}

function windowSize(preferredWidth, preferredHeight, minWidth, minHeight) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
  const width = Math.max(1, Math.min(preferredWidth, area.width - 24));
  const height = Math.max(1, Math.min(preferredHeight, area.height - 24));
  return { width, height, minWidth: Math.min(minWidth, width), minHeight: Math.min(minHeight, height) };
}

function openSetup(message = '') {
  setupMessage = message;
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.webContents.reload(); setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({ ...windowSize(920, 700, 640, 440), title: 'Configurar Almox ERP', icon, backgroundColor: '#f6f7fa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupWindow.webContents.on('will-navigate', event => event.preventDefault());
  setupWindow.on('closed', () => { setupWindow = null; });
  void setupWindow.loadFile(setupFile);
}

async function configure(create) {
  if (changing) return { ok: false, error: 'Aguarde a conexão em andamento.' };
  changing = true;
  try {
    const config = await create();
    if (!config) return { ok: false, canceled: true };
    await launch(config, true);
    return { ok: true };
  } catch (error) { return { ok: false, error: safeMessage(error) }; }
  finally {
    changing = false;
    if (!window && !setupWindow && !shuttingDown) app.quit();
  }
}

async function launch(config, persist = false) {
  let nextServer, nextWindow, nextOrigin;
  try {
    if (config.mode === 'local') {
      const serverDirectory = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, 'server');
      nextServer = await startLocalServer({ executable: process.execPath, serverDirectory, env: config.env });
    }
    nextOrigin = nextServer?.origin || config.origin;
    nextWindow = new BrowserWindow({ ...windowSize(1440, 960, 640, 420), title: 'Almox ERP', icon, show: false, backgroundColor: '#1e1f24',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: `persist:almox-${config.mode}` } });
    secureContents(nextWindow, nextOrigin);
    await loadLogin(nextWindow, nextOrigin);
    if (persist) await saveConfiguration(configFile(), config, safeStorage);
  } catch (error) {
    if (nextWindow && !nextWindow.isDestroyed()) nextWindow.destroy();
    nextServer?.stop();
    throw error;
  }
  const previous = window, previousServer = localServer;
  window = nextWindow;
  activeOrigin = nextOrigin;
  localServer = nextServer;
  setupOrigin = config.mode === 'remote' ? nextOrigin : '';
  nextWindow.on('closed', () => { if (window === nextWindow) { window = null; localServer?.stop(); localServer = null; } });
  nextWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || shuttingDown || window !== nextWindow) return;
    setupError = 'Não foi possível acessar o ERP. Confira se o servidor está disponível e use Configurar conexão para tentar novamente.';
    openSetup();
  });
  nextServer?.child.once('exit', () => {
    if (!shuttingDown && localServer === nextServer && window) {
      setupError = 'O servidor local foi encerrado. Use Configurar conexão para abrir novamente.';
      openSetup();
    }
  });
  nextWindow.show();
  if (previous && !previous.isDestroyed()) previous.close();
  previousServer?.stop();
  if (setupWindow) setupWindow.close();
}

async function loadLogin(target, origin) {
  const contents = target.webContents;
  let status, timer;
  const checkStatus = (_event, _url, httpStatus) => { status = httpStatus; };
  contents.on('did-navigate', checkStatus);
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Tempo limite da conexão.')), 20000);
    });
    await Promise.race([target.loadURL(`${origin}/login`), timeout]);
    if (status >= 400) throw new Error('Página indisponível.');
  } catch {
    throw new Error('Não foi possível acessar o ERP. Confira o endereço e tente novamente.');
  } finally {
    clearTimeout(timer);
    contents.removeListener('did-navigate', checkStatus);
  }
}

function secureContents(target, origin) {
  const contents = target.webContents, currentSession = contents.session;
  allowedContents.set(contents.id, origin);
  contents.once('destroyed', () => allowedContents.delete(contents.id));
  if (!initializedSessions.has(currentSession)) {
    initializedSessions.add(currentSession);
  // A server can use media only after Windows and the user allow the camera. Microphones are never granted.
  currentSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    permission === 'media' && cameraAllowed(requestingOrigin, allowedContents.get(webContents?.id), details) && details.mediaType === 'video');
  currentSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    if (permission !== 'media' || !cameraAllowed(details.requestingUrl, allowedContents.get(webContents?.id), details) ||
      !details.mediaTypes?.length || details.mediaTypes.some(type => type !== 'video')) return callback(false);
    const owner = BrowserWindow.fromWebContents(webContents);
    if (!owner) return callback(false);
    const { response } = await dialog.showMessageBox(owner, { type: 'question', title: 'Câmera do Almox',
      message: 'Permitir a câmera para ler QR Codes?', detail: 'A câmera será usada nesta janela do ERP.', buttons: ['Permitir câmera', 'Cancelar'], defaultId: 1, cancelId: 1 });
    callback(response === 0);
  });
  currentSession.on('will-download', (_event, item, webContents) => {
    const permittedOrigin = allowedContents.get(webContents?.id);
    const url = item.getURL();
    if (!permittedOrigin || !isWithinOrigin(url, permittedOrigin) && !url.startsWith(`blob:${permittedOrigin}/`)) { item.cancel(); return; }
    item.setSaveDialogOptions({ title: 'Salvar arquivo do Almox', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  }
  contents.on('will-navigate', (event, url) => { if (!isWithinOrigin(url, origin)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isWithinOrigin(url, origin)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    // Existing QR/label printing writes into an inherited about:blank child window.
    if (url === 'about:blank' || isWithinOrigin(url, origin)) return { action: 'allow', overrideBrowserWindowOptions: { icon, parent: target, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } };
    if (/^https:\/\//i.test(url)) void dialog.showMessageBox(target, { type: 'question', message: 'Abrir este link no navegador?', detail: new URL(url).hostname,
      buttons: ['Abrir navegador', 'Cancelar'], defaultId: 1, cancelId: 1 }).then(({ response }) => { if (response === 0) void shell.openExternal(url); });
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => secureContents(child, origin));
  contents.on('page-title-updated', event => { event.preventDefault(); target.setTitle('Almox ERP'); });
}
