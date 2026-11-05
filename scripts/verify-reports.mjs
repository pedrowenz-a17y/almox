import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, request } from '@playwright/test';
import ExcelJS from 'exceljs';

import { qaConfig, qaCredentials } from './qa-config.mjs';
const { baseURL, unitId } = qaConfig();
const credentials = qaCredentials('ADMIN');
const out = path.resolve('artifacts');
const evidence = { startedAt: new Date().toISOString(), unitId, environment: 'isolated', checks: [], result: 'running', limitations: ['Câmera física, impressão em papel e calibração da impressora exigem homologação real.'] };
const types = ['position', 'low', 'zero', 'entry', 'exit', 'transfer', 'adjustments', 'by-user', 'by-location', 'counts', 'divergences'];
let api;
let browser;
async function check(name, action) {
  try { const detail = await action(); evidence.checks.push({ name, passed: true, detail }); console.log(`PASS ${name}`); }
  catch (error) { evidence.checks.push({ name, passed: false, error: error.message }); throw error; }
}
function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && character === ';') { row.push(field); field = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  assert.equal(quoted, false, 'CSV com aspas não encerradas');
  return rows;
}
function expectedCsv(value) {
  const text = String(value ?? '');
  return typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
}

try {
  await mkdir(out, { recursive: true });
  api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL }, timeout: 30000 });
  await check('Relatórios exigem sessão', async () => { assert.equal((await api.get('/api/reports?format=json')).status(), 401); });
  const login = await api.post('/api/auth/login', { data: { email: credentials.email, password: credentials.password } });
  assert.equal(login.status(), 200, await login.text());
  const selection = await api.post('/api/unit', { data: { unitId } });
  assert.equal(selection.status(), 200, await selection.text());
  const dataResponse = await api.get('/api/data');
  assert.equal(dataResponse.status(), 200, await dataResponse.text());
  const { data } = await dataResponse.json();
  assert.equal(data.unitId, unitId);
  assert.ok(data.locations.length, 'Prepare localizações na unidade exclusiva de homologação antes deste teste.');

  for (const type of types) {
    await check(`Relatório ${type}: JSON, CSV e XLSX correspondem ao banco`, async () => {
      const jsonResponse = await api.get(`/api/reports?type=${type}&format=json`);
      assert.equal(jsonResponse.status(), 200, await jsonResponse.text());
      assert.match(jsonResponse.headers()['cache-control'], /no-store/);
      const report = (await jsonResponse.json()).data;
      assert.ok(report.title && report.generatedAt && report.columns.length > 0);
      assert.ok(Array.isArray(report.rows));
      if (type === 'counts' || type === 'divergences') {
        for (const count of data.counts) {
          for (const item of count.items) {
            if (type === 'divergences' && Number(item.difference) === 0) continue;
            const row = report.rows.find(row => row.id === count.id && row.code === item.product.internalCode);
            assert.ok(row, `Inventário ${count.id} deve aparecer no relatório ${type}; conferir escopo dos itens.`);
            assert.equal(String(row.expected), String(item.expectedQuantity));
            assert.equal(String(row.counted), String(item.countedQuantity));
            assert.equal(String(row.difference), String(item.difference));
          }
        }
      }
      const csvResponse = await api.get(`/api/reports?type=${type}&format=csv`);
      assert.equal(csvResponse.status(), 200, await csvResponse.text());
      assert.match(csvResponse.headers()['content-type'], /text\/csv/);
      assert.match(csvResponse.headers()['content-disposition'], /attachment.*\.csv/);
      const csv = parseCsv(await csvResponse.text());
      assert.deepEqual(csv[0], report.columns.map(column => column.label));
      assert.equal(csv.length - 1, report.rows.length);
      report.rows.forEach((row, index) => assert.deepEqual(csv[index + 1], report.columns.map(column => expectedCsv(row[column.key] ?? '')), `${type}: linha CSV ${index + 1}`));
      const xlsxResponse = await api.get(`/api/reports?type=${type}&format=xlsx`);
      assert.equal(xlsxResponse.status(), 200);
      assert.match(xlsxResponse.headers()['content-type'], /spreadsheetml\.sheet/);
      assert.match(xlsxResponse.headers()['content-disposition'], /attachment.*\.xlsx/);
      const buffer = await xlsxResponse.body();
      assert.equal(buffer.subarray(0, 2).toString(), 'PK');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.getWorksheet('Relatório');
      assert.ok(sheet);
      assert.equal(sheet.rowCount, report.rows.length + 1);
      report.columns.forEach((column, index) => assert.equal(sheet.getCell(1, index + 1).value, column.label));
      report.rows.forEach((row, rowIndex) => report.columns.forEach((column, columnIndex) => {
        const cell = sheet.getCell(rowIndex + 2, columnIndex + 1);
        assert.equal(cell.formula, undefined, 'Exportação não deve gerar fórmulas a partir de conteúdo');
        assert.equal(String(cell.value ?? ''), String(row[column.key] ?? ''));
      }));
      if (type === 'position') { assert.ok(report.columns.some(column => column.key === 'unitCost')); await writeFile(path.join(out, 'uca-estoque-exportado.xlsx'), buffer); }
      return { rows: report.rows.length, columns: report.columns.length };
    });
  }
  await check('Filtros de relatório e validação de datas', async () => {
    for (const query of ['from=2026-02-31', 'from=2026-10-20&to=2026-10-19', 'locationId=invalido', 'type=inexistente']) assert.equal((await api.get(`/api/reports?format=json&${query}`)).status(), 400, query);
    const future = await api.get('/api/reports?type=entry&format=json&from=2099-01-01&to=2099-01-02');
    assert.equal(future.status(), 200);
    assert.equal((await future.json()).data.rows.length, 0);
    const location = data.locations.find(location => data.balances.some(balance => balance.locationId === location.id)) || data.locations[0];
    const response = await api.get(`/api/reports?type=by-location&format=json&locationId=${location.id}`);
    assert.equal(response.status(), 200);
    const report = (await response.json()).data;
    assert.ok(report.rows.every(row => row.locationCode === location.code));
  });

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: await api.storageState() });
  await context.addInitScript(() => { window.print = () => { window.__printRequested = true; }; });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`${baseURL}/imprimir-etiquetas`);
  await page.locator('.labels-module').waitFor({ timeout: 30000 });
  const selected = data.locations.filter(location => location.active).slice(0, 6);
  assert.ok(selected.length >= 3, 'O teste A4 requer ao menos três localizações ativas.');
  for (const location of selected) await page.getByRole('checkbox', { name: `Selecionar ${location.code}`, exact: true }).check();
  for (const size of ['50x30', 'A4']) {
    await check(`Impressão ${size}: QR carregados, textos dentro da etiqueta e PDF`, async () => {
      await page.getByLabel('Tamanho da etiqueta').selectOption(size);
      const popupPromise = page.waitForEvent('popup');
      await page.locator('.labels-tools button').click();
      const popup = await popupPromise;
      await popup.waitForFunction(() => { const button = document.getElementById('print'); return button && !button.textContent.includes('Carregando'); });
      const printButton = popup.locator('#print');
      assert.equal(await printButton.isDisabled(), false, await printButton.textContent());
      await popup.emulateMedia({ media: 'print' });
      const metrics = await popup.evaluate(async () => {
        await Promise.all(Array.from(document.images).map(image => image.decode()));
        const articles = Array.from(document.querySelectorAll('article'));
        return articles.map(article => {
          const text = article.querySelector('.text');
          const image = article.querySelector('img');
          const box = article.getBoundingClientRect();
          const textBox = text.getBoundingClientRect();
          const imageBox = image.getBoundingClientRect();
          return { code: text.querySelector('span').textContent, width: box.width, height: box.height, left: box.left, right: box.right, top: box.top, textFits: text.scrollHeight <= text.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1, withinLabel: textBox.top >= box.top - 1 && textBox.bottom <= box.bottom + 1 && textBox.left >= box.left - 1 && textBox.right <= box.right + 1 && imageBox.top >= box.top - 1 && imageBox.bottom <= box.bottom + 1, qrLoaded: image.complete && image.naturalWidth > 0 };
        });
      });
      assert.equal(metrics.length, selected.length);
      assert.deepEqual(metrics.map(metric => metric.code), selected.map(location => location.code));
      for (const metric of metrics) { assert.ok(metric.textFits && metric.withinLabel && metric.qrLoaded, JSON.stringify(metric)); assert.ok(Math.abs(metric.width - (size === '50x30' ? 50 : 63) * 96 / 25.4) < 1); assert.ok(Math.abs(metric.height - (size === '50x30' ? 30 : 46) * 96 / 25.4) < 1); }
      if (size === 'A4') { assert.equal(metrics[0].top, metrics[2].top); assert.ok(metrics[2].right - metrics[0].left <= 194 * 96 / 25.4 + 1, 'Três colunas excederam os 194 mm úteis da folha'); }
      const pdf = await popup.pdf({ path: path.join(out, `uca-etiquetas-${size}.pdf`), printBackground: true, preferCSSPageSize: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
      assert.ok(pdf.length > 1000);
      await popup.screenshot({ path: path.join(out, `uca-etiquetas-${size}.png`), fullPage: true });
      await popup.close();
      return { labels: metrics.length, pdfBytes: pdf.length, metrics };
    });
  }
  assert.deepEqual(browserErrors, []);
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed'; evidence.error = error.message; process.exitCode = 1; console.error(error);
} finally {
  if (browser) await browser.close();
  if (api) { await api.post('/api/auth/logout').catch(() => {}); await api.dispose(); }
  evidence.finishedAt = new Date().toISOString();
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'uca-reports-labels-checks.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Reports/labels: ${evidence.result}; ${evidence.checks.filter(check => check.passed).length}/${evidence.checks.length} checks passed.`);
}
