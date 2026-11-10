import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { qaConfig } from './qa-config.mjs';

const { baseURL } = qaConfig();
const output = path.resolve('artifacts/security-installation');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
async function prompt(outcome) {
  await page.evaluate(value => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {
      window.__installPromptCalls = (window.__installPromptCalls || 0) + 1;
      if (value === 'error') throw new Error('Synthetic browser refusal');
    };
    event.userChoice = Promise.resolve({ outcome: value });
    window.dispatchEvent(event);
  }, outcome);
}
try {
  await check('Página de instalação pública e responsiva, sem download de APK/EXE', async () => {
    assert.equal((await page.goto(baseURL + '/instalar')).status(), 200);
    await page.getByRole('heading', { name: /O trabalho continua/ }).waitFor();
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const links = await page.locator('a').evaluateAll(items => items.map(item => item.getAttribute('href')));
    assert.ok(links.every(link => !/\.(?:apk|exe)(?:$|\?)/i.test(link || '')));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width !== 320) await page.screenshot({ path: path.join(output, `installation-${width}.png`), fullPage: true });
    }
  });
  await check('Manifesto instalável e service worker com atualização sem cache', async () => {
    const manifest = await (await page.request.get(baseURL + '/manifest.webmanifest')).json();
    assert.equal(manifest.id, '/');
    assert.equal(manifest.display, 'standalone');
    for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some(icon => icon.sizes === size));
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const worker = await page.request.get(baseURL + '/sw.js');
    assert.match(worker.headers()['cache-control'], /no-store/);
    assert.match(worker.headers()['content-security-policy'], /script-src 'self'/);
    const cdp = await context.newCDPSession(page);
    const app = await cdp.send('Page.getAppManifest');
    assert.deepEqual(app.errors, []);
    await cdp.detach();
  });
  await check('Perfil normal do Chromium atende aos critérios de instalação', async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-installability-'));
    let normal;
    try {
      normal = await chromium.launchPersistentContext(profile, { executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
      const tab = normal.pages()[0] || await normal.newPage();
      await tab.goto(baseURL + '/instalar');
      await tab.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      const cdp = await normal.newCDPSession(tab);
      const result = await cdp.send('Page.getInstallabilityErrors');
      await fs.writeFile(path.join(output, 'installability.json'), JSON.stringify(result, null, 2) + '\n');
      assert.deepEqual(result.installabilityErrors, []);
    } finally {
      if (normal) await normal.close();
      await fs.rm(profile, { recursive: true, force: true });
    }
  });
  await check('Instalação só abre o consentimento do navegador após clique', async () => {
    await prompt('accepted');
    const button = page.getByRole('button', { name: 'Instalar Almox no dispositivo' });
    await button.waitFor();
    assert.equal(await page.evaluate(() => window.__installPromptCalls || 0), 0);
    await button.click();
    await button.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__installPromptCalls), 1);
    assert.equal(await page.getByText('O Almox já está instalado neste dispositivo.').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.getByText('O Almox já está instalado neste dispositivo.').waitFor();
    await prompt('accepted');
    assert.equal(await button.count(), 0);
  });
  await check('Cancelar ou recusar instalação mantém orientação e não causa erro JavaScript', async () => {
    for (const outcome of ['dismissed', 'error']) {
      await page.reload();
      await page.getByRole('heading', { name: /O trabalho continua/ }).waitFor();
      await page.waitForLoadState('networkidle');
      await prompt(outcome);
      await page.getByRole('button', { name: 'Instalar Almox no dispositivo' }).click();
      await page.getByRole('status').filter({ hasText: outcome === 'dismissed' ? 'Você pode instalar depois' : 'Não foi possível abrir a instalação' }).waitFor();
    }
  });
  await check('Login oferece acesso à instalação; páginas/API não entram no cache', async () => {
    await page.goto(baseURL + '/login');
    await page.getByRole('link', { name: 'Instalar o Almox neste dispositivo' }).click();
    await page.waitForURL('**/instalar');
    const status = await page.evaluate(async () => (await fetch('/api/data', { cache: 'no-store' })).status);
    assert.ok([401, 503].includes(status));
    await page.goto(baseURL + '/dashboard');
    await page.goto(baseURL + '/instalar');
    const paths = await page.evaluate(async () => {
      const urls = [];
      for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) urls.push(new URL(request.url).pathname);
      return urls;
    });
    assert.ok(paths.includes('/offline.html'));
    assert.ok(paths.every(value => value.startsWith('/_next/static/') || ['/offline.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'].includes(value)));
  });
  await check('Sem internet mostra aviso, sem recuperar dados de estoque do cache', async () => {
    await context.setOffline(true);
    await page.goto(baseURL + '/operacao');
    await page.getByRole('heading', { name: 'Sem conexão' }).waitFor();
    assert.equal(await page.locator('.sidebar').count(), 0);
    await context.setOffline(false);
  });
  await check('Sem exceções JavaScript nas telas de instalação', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}
const report = { scope: 'Navegador Chromium em ambiente isolado, sem login ou dados reais. Eventos de consentimento simulados; não instala no Android/Windows físico.', tests: results.length, passed: results.filter(result => result.passed).length, results };
await fs.writeFile(path.join(output, 'browser-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
