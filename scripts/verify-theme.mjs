import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { qaConfig } from './qa-config.mjs';
import { user, data } from './fixtures/theme-data.mjs';

const { baseURL } = qaConfig();
const root = process.cwd();
const output = path.join(root, 'artifacts/theme-audit');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-theme-'));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const cssNames = ['globals', 'uca', 'workshop', 'welcome', 'welcome-interactions', 'assistant', 'operational', 'login-screen', 'theme'];
const css = (await Promise.all(cssNames.map(name => fs.readFile(path.join(root, `src/app/${name}.css`), 'utf8')))).join('\n');
const fakeNavigation = `import {useSyncExternalStore} from 'react';
const subscribe = fn => { addEventListener('popstate', fn); return () => removeEventListener('popstate', fn) };
const go = p => { history.pushState(null, '', p); dispatchEvent(new Event('popstate')) };
export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname);
export const useSearchParams = () => new URLSearchParams(location.search);
export const useRouter = () => ({replace:go,push:go,refresh:()=>{}});`;
await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import ERP from '@/components/erp'; import {ThemeProvider} from '@/components/theme-preferences';
      import {MotionProvider} from '@/components/motion-preferences';
      createRoot(document.getElementById('root')).render(<ThemeProvider><MotionProvider><ERP initialUser={${JSON.stringify(user)}} /></MotionProvider></ThemeProvider>);`,
    loader: 'tsx', resolveDir: root,
  },
  outfile: path.join(temporary, 'fixture.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-next-adapters', setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link|dynamic)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: root, loader: 'tsx', contents:
      args.path === 'next/navigation' ? fakeNavigation : args.path === 'next/dynamic'
        ? `import React,{lazy,Suspense} from 'react'; export default function dynamic(load,options={}) {const Component=lazy(async()=>{const mod=await load();return {default:mod.default||mod}});return props=><Suspense fallback={options.loading?<options.loading/>:null}><Component {...props}/></Suspense>}`
        : `import React from 'react'; export default function Link({href,onNavigate,prefetch,replace,...props}) {return <a {...props} href={href} onClick={e=>{props.onClick?.(e);if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.button)return;onNavigate?.({preventDefault:()=>e.preventDefault()}); if(e.defaultPrevented){dispatchEvent(new Event('popstate'))}}}/>}`
    }));
  } }],
});
const html = '<!doctype html><html lang="pt-BR" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    let body, type;
    if (url.pathname === '/fixture.js') { body = await fs.readFile(path.join(temporary, 'fixture.js')); type = 'text/javascript'; }
    else if (url.pathname === '/fixture.css') { body = css; type = 'text/css'; }
    else if (/^\/(brand|fonts)\//.test(url.pathname)) {
      const file = path.resolve(root, 'public', `.${url.pathname}`);
      assert.ok(file.startsWith(path.join(root, 'public') + path.sep));
      body = await fs.readFile(file); type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    } else if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') { response.writeHead(404).end(); return; }
    else { body = html; type = 'text/html'; }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureURL = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const checks = [], errors = [], unexpected = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route(fixtureURL + '/api/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { unexpected.push(`${req.method()} ${url.pathname}`); return route.abort(); }
  if (url.pathname.startsWith('/api/qr/')) return route.fulfill({ contentType: 'image/svg+xml', body: await QRCode.toString(fixtureURL + '/localizacao/' + data.locations[0].id, { type: 'svg', margin: 4 }) });
  let value;
  if (url.pathname === '/api/data') value = data;
  else if (url.pathname === '/api/assistant') value = { mode: 'local', configured: true, includeUnit: true, description: 'Ajuda para consultar materiais e entender a rotina do almoxarifado.' };
  else if (url.pathname === '/api/search') value = { products: data.products.slice(0, 1), locations: [] };
  else if (url.pathname === '/api/operational-pending') value = { items: [], totals: {}, total: 0, page: 1, pageSize: 25, serverTime: new Date().toISOString() };
  else { unexpected.push(url.pathname); return route.abort(); }
  return route.fulfill({ json: { data: value } });
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const theme = (page, value) => expect(page.locator('html')).toHaveAttribute('data-theme', value);
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
async function contrast(page, selector) {
  const value = await page.locator(selector).first().evaluate(async element => {
    // Evaluate the settled colors rather than a frame within a focus/theme transition.
    await Promise.all(element.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    const rgb = text => text.match(/[\d.]+/g).map(Number);
    const lum = text => rgb(text).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    let parent = element;
    while (parent && (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)')) parent = parent.parentElement;
    const foreground = lum(getComputedStyle(element).color);
    const background = lum(getComputedStyle(parent || document.body).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  assert.ok(value >= 4.5, `${selector}: ${value.toFixed(2)} < 4.5`);
}
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.log('FAIL', name, error.message); }
}
try {
  await check('Tema escuro padrão no login, contraste e ajuste em desktop e celular', async () => {
    await page.goto(baseURL + '/login'); await theme(page, 'dark');
    await page.getByRole('button', { name: 'Ativar modo claro', exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width > 900 ? 768 : 844 });
      await noOverflow(page);
      for (const selector of ['.login-form h2', '.login-form label', '.login-form input', '.login-submit', '.login-form > p']) await contrast(page, selector);
      if (width === 1440) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
      await page.screenshot({ animations: 'disabled', path: path.join(output, `login-dark-${width}.png`), fullPage: true });
    }
  });
  await check('Preferência clara persiste ao recarregar e navegar para instalação', async () => {
    const button = page.getByRole('button', { name: 'Ativar modo claro', exact: true });
    await button.focus(); await page.keyboard.press('Enter'); await theme(page, 'light');
    await page.reload(); await theme(page, 'light');
    await page.goto(baseURL + '/instalar'); await theme(page, 'light'); await noOverflow(page);
    await page.getByRole('button', { name: 'Ativar modo escuro' }).click(); await theme(page, 'dark');
    await contrast(page, 'h1'); await noOverflow(page);
    await page.screenshot({ path: path.join(output, 'instalar-dark-mobile.png'), fullPage: true });
  });
  await check('Preferência sincronizada entre abas', async () => {
    const second = await context.newPage(); await second.goto(baseURL + '/login'); await theme(second, 'dark');
    await second.getByRole('button', { name: 'Ativar modo claro', exact: true }).click();
    await theme(page, 'light'); await second.close();
  });
  await check('Recuperação de acesso permite trocar tema sem enviar e-mail', async () => {
    await page.goto(baseURL + '/esqueci-senha'); await theme(page, 'light');
    await page.getByRole('button', { name: 'Ativar modo escuro', exact: true }).click(); await theme(page, 'dark');
    for (const selector of ['.login-form h2', '.login-form label', '.login-form input']) await contrast(page, selector);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'recuperacao-dark-mobile.png'), fullPage: true });
  });
  await check('Tema claro aplicado antes da hidratação', async () => {
    const noJS = await browser.newContext({ javaScriptEnabled: true });
    await noJS.addInitScript(() => localStorage.setItem('almox-theme', 'light'));
    await noJS.route('**/_next/**/*.js', route => route.abort());
    const initial = await noJS.newPage(); await initial.goto(baseURL + '/login');
    await theme(initial, 'light'); await noJS.close();
  });
  await check('Armazenamento indisponível permite alternar o tema na sessão', async () => {
    const denied = await browser.newContext();
    await denied.addInitScript(() => { for (const method of ['getItem', 'setItem']) Storage.prototype[method] = () => { throw new Error('Storage blocked for test'); }; });
    const isolated = await denied.newPage(); await isolated.goto(baseURL + '/login'); await theme(isolated, 'dark');
    await isolated.getByRole('button', { name: 'Ativar modo claro', exact: true }).click(); await theme(isolated, 'light'); await denied.close();
  });
  await check('Painel real com dados fictícios: contraste, fotografia preservada e temas', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(fixtureURL + '/dashboard');
    await page.locator('.stats-grid').waitFor(); await theme(page, 'dark');
    for (const selector of ['.stat-value', '.stat-top > span', '.today-chip', '.page-heading p']) await contrast(page, selector);
    assert.match(await page.locator('.scan-banner').evaluate(el => getComputedStyle(el, '::before').backgroundImage), /implemento-uca/);
    await noOverflow(page); await page.screenshot({ animations: 'disabled', path: path.join(output, 'dashboard-dark-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Ativar modo claro', exact: true }).click(); await theme(page, 'light');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'dashboard-light-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Ativar modo escuro', exact: true }).click();
  });
  await check('Tabela de estoque, etiquetas de estado e formulário legíveis no tema escuro', async () => {
    await page.goto(fixtureURL + '/produtos'); await page.locator('tbody tr').first().waitFor();
    for (const selector of ['td', 'td strong', 'th', '.badge.danger', '.badge.warning']) await contrast(page, selector);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'produtos-dark-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
    const modal = page.getByRole('dialog'); await modal.waitFor();
    for (const selector of ['.modal-heading h2', '.modal label', '.modal input']) await contrast(page, selector);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'formulario-dark-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
  });
  await check('Assistente e aviso de falha permanecem legíveis', async () => {
    await page.getByRole('button', { name: 'Abrir assistente', exact: true }).click();
    await page.locator('.ai-panel').waitFor();
    for (const selector of ['.ai-mode', '.ai-intro', '.ai-suggestions button', '.ai-composer label']) await contrast(page, selector);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'assistente-dark-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.route(fixtureURL + '/api/data', route => route.fulfill({ status: 503, json: { error: 'Falha simulada de conexão. Tente novamente.' } }));
    await page.getByRole('button', { name: 'Atualizar dados', exact: true }).click();
    await page.locator('.global-error').waitFor(); await contrast(page, '.global-error');
    await page.unroute(fixtureURL + '/api/data');
  });
  await check('Etiquetas adaptadas ao tema preservam o fundo branco do QR', async () => {
    await page.goto(fixtureURL + '/qrcodes'); await page.locator('.labels-module').waitFor();
    for (const selector of ['.labels-tools h2', '.labels-tools p', '.label-preview strong', '.label-preview button']) await contrast(page, selector);
    assert.equal(await page.locator('.label-preview img').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'etiquetas-dark-desktop.png'), fullPage: true });
  });
  await check('Leitor de QR e campo manual legíveis sem acesso a câmera real', async () => {
    await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied in isolated test', 'NotAllowedError'); }; });
    await page.goto(fixtureURL + '/dashboard'); await page.locator('.stats-grid').waitFor();
    await page.getByRole('button', { name: /Escanear QR Code/ }).click(); await page.locator('.scanner-card').waitFor();
    for (const selector of ['.scanner-heading h2', '.scanner-heading p', '.scanner-manual label', '.scanner-manual input']) await contrast(page, selector);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'scanner-dark-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
  });
  await check('Barra de ações e navegação cabem em 390 e 320 pixels', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.goto(fixtureURL + '/dashboard'); await page.locator('.stats-grid').waitFor();
      await noOverflow(page);
      const button = page.getByRole('button', { name: 'Ativar modo claro', exact: true }); await expect(button).toBeInViewport();
      const menu = page.getByRole('button', { name: 'Abrir menu', exact: true }); await expect(menu).toBeInViewport();
      const b = await button.boundingBox(), m = await menu.boundingBox(); assert.ok(b.x > m.x + m.width);
      await page.screenshot({ animations: 'disabled', path: path.join(output, `dashboard-dark-${width}.png`), fullPage: true });
    }
  });
  await check('Impressão usa fundo claro e oculta a troca de tema', async () => {
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('.theme-toggle').isVisible(), false);
    await page.emulateMedia({ media: 'screen' });
  });
  await check('Sem erros JavaScript ou operações de escrita durante a inspeção', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  });
} finally {
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ scope: 'Local production public pages and real workspace components with synthetic API responses; no live authentication or database writes.', checks, errors, unexpected }, null, 2) + '\n');
  await browser.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(temporary, { recursive: true, force: true });
}
if (checks.some(check => !check.passed)) process.exitCode = 1;
