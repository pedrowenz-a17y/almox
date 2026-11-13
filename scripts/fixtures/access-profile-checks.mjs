import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';
import { id } from './theme-data.mjs';

export async function verifyAccessProfiles({ page, fixtureURL, data, user, models, check, output, noOverflow }) {
  const original = { user: data.user, permissions: data.permissions, roles: data.roles, suppliers: data.suppliers, counts: data.counts };
  const legacy = { ...user.role, permissions: user.permissions.map(key => ({ permission: { key } })) };
  const prepared = models.map((profile, i) => ({ id: id(200 + i), name: profile.name, permissions: profile.permissions.map(key => ({ permission: { key } })) }));
  data.roles = [legacy];
  data.suppliers = [{ id: id(210), legalName: 'Fornecedor de demonstração', active: true }];
  let preparations = 0, saves = 0, rejectPreparation = false;
  const comparison = { kind: 'STOCK', unitCode: 'UCA', sourceName: 'Arquivo fictício', referenceAt: new Date().toISOString(), comparedAt: new Date().toISOString(), scope: 'Somente linhas informadas.', criterion: 'Saldo contábil atual.', notice: 'Prévia fictícia; nenhum saldo alterado.', totals: { rows: 0, matches: 0, differences: 0, incomplete: 0 }, rows: [] };
  const order = { id: id(230), code: 'OP-DEMO', title: 'Ordem de demonstração', kind: 'PRODUCTION', status: 'OPEN', createdAt: new Date().toISOString(), events: [], materials: [{ id: id(231), productId: data.products[0].id, locationId: data.locations[0].id, product: data.products[0], location: data.locations[0], requestedQuantity: '10', reservedQuantity: '5', appliedQuantity: '0', consumedQuantity: '0', returnedQuantity: '0', pendingReturnQuantity: '0' }] };
  const apiPattern = fixtureURL + '/api/**';
  const handler = async route => {
    const request = route.request(); const url = new URL(request.url());
    let value;
    if (url.pathname === '/api/access-profiles' && request.method() === 'POST') {
      preparations++; assert.deepEqual(request.postDataJSON(), {});
      if (rejectPreparation) return route.fulfill({ status: 403, json: { error: 'Seu acesso administrativo à unidade foi alterado. Entre novamente.' } });
      const missing = prepared.filter(role => !data.roles.some(existing => existing.name === role.name));
      data.roles = [...data.roles, ...missing]; value = { created: missing.map(role => role.name), preserved: [legacy.name], customized: [] };
    } else if (url.pathname === '/api/inventory-schedules') value = { items: [{ id: id(220), title: 'Conferência fictícia', locationId: data.locations[0].id, location: data.locations[0], active: true, intervalDays: 7, nextDueAt: '2026-01-01T12:00:00Z', lastCount: null, pendingCount: null }], assignees: [], total: 1, truncated: false, serverTime: new Date().toISOString() };
    else if (url.pathname === '/api/reconciliation/setup') value = { unitCode: 'UCA', unitName: 'U.C.A. — demonstração' };
    else if (url.pathname === '/api/reconciliation/preview' && request.method() === 'POST') value = comparison;
    else if (url.pathname === '/api/reconciliation' && request.method() === 'POST') { saves++; value = { id: id(240), ...request.postDataJSON(), createdAt: new Date().toISOString(), result: comparison, review: { status: 'LEGACY', canReview: false } }; }
    else if (url.pathname === '/api/reconciliation') value = [];
    else if (url.pathname === '/api/order-costs') value = { orders: [], total: 0, page: 1, pageSize: 25, criterion: 'Estimativa fictícia.', totals: { completeCost: '0.00', incompleteOrders: 0 } };
    else if (url.pathname === '/api/orders/' + order.id) value = order;
    else if (url.pathname === '/api/orders') value = { items: [order], total: 1, page: 1, pageSize: 25 };
    else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(apiPattern, handler);
  const asProfile = async (name, view) => {
    const profile = prepared.find(profile => profile.name === name);
    data.user = { ...user, role: { id: profile.id, name }, roleId: profile.id, permissions: profile.permissions.map(link => link.permission.key) };
    data.permissions = data.user.permissions;
    await page.goto(fixtureURL + view);
    await expect(page.locator('.sidebar-user small')).toHaveText(models.find(profile => profile.name === name).title.toLocaleLowerCase('pt-BR'));
  };
  const preview = async () => {
    await page.getByRole('button', { name: 'Importar arquivo', exact: true }).click();
    await page.getByLabel('ERP de origem', { exact: true }).fill('ERP fictício');
    await page.getByLabel('Nome do relatório', { exact: true }).fill('Arquivo fictício');
    await page.getByLabel('Corte e observações', { exact: true }).fill('Lançamentos encerrados para esta conferência fictícia.');
    await page.getByLabel('Arquivo CSV', { exact: true }).setInputFiles({ name: 'estoque.csv', mimeType: 'text/csv', buffer: Buffer.from('unidade;produto;local;quantidade\nUCA;ROL-6204;A-P02;24') });
    await page.getByRole('checkbox', { name: /O relatório contém o saldo contábil/ }).check();
    await page.getByRole('button', { name: 'Visualizar conferência', exact: true }).click();
    await page.getByRole('dialog').waitFor();
  };
  try {
    await check('Administrador disponibiliza modelos pela tela sem associar usuários', async () => {
      data.user = original.user; data.permissions = original.permissions;
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(fixtureURL + '/usuarios');
      await page.getByRole('heading', { name: 'Perfis por responsabilidade', exact: true }).waitFor();
      await expect(page.getByText('Modelo para adicionar', { exact: true })).toHaveCount(5);
      await page.getByRole('button', { name: 'Disponibilizar perfis padrão', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Disponibilizar perfis padrão', exact: true })).toHaveCount(0);
      await expect(page.getByText('Disponível', { exact: true })).toHaveCount(6);
      assert.equal(preparations, 1); assert.equal(data.users?.length || 0, 0);
      await noOverflow(page); await page.screenshot({ animations: 'disabled', path: path.join(output, 'perfis-disponiveis-desktop.png'), fullPage: true });
    });
    await check('Seleção do perfil mostra permissões reais sem salvar acesso nem enviar convite', async () => {
      await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('combobox', { name: /Perfil nesta unidade/ }).selectOption(prepared.find(role => role.name === 'AUDITOR').id);
      await dialog.locator('.role-permissions summary').click();
      await expect(dialog.locator('.role-permissions')).toContainText('Consultar relatórios e histórico');
      await expect(dialog.locator('.role-permissions')).not.toContainText('Aprovar ajustes');
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'selecao-perfil-desktop.png'), fullPage: true });
      await page.keyboard.press('Escape');
    });
    await check('Auditor consulta conferências sem iniciar contagem ou preparar perfis', async () => {
      await asProfile('AUDITOR', '/conferencias');
      await page.getByText('Conferência fictícia', { exact: true }).waitFor();
      await expect(page.getByRole('button', { name: 'Iniciar contagem', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Usuários', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Nova programação', exact: true })).toHaveCount(0);
    });
    await check('Auditor visualiza prévia de conciliação sem opção de salvar documento', async () => {
      await asProfile('AUDITOR', '/conciliacao'); await preview();
      await expect(page.getByRole('button', { name: 'Registrar conferência', exact: true })).toHaveCount(0);
      assert.equal(saves, 0); await page.screenshot({ animations: 'disabled', path: path.join(output, 'auditor-consulta-desktop.png'), fullPage: true });
    });
    await check('Analista de custos pode salvar a conciliação sem ações de estoque', async () => {
      await asProfile('ANALISTA_CUSTOS', '/conciliacao'); await preview();
      await page.getByRole('button', { name: 'Registrar conferência', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('status')).toContainText('Conferência registrada'); assert.equal(saves, 1);
      await page.goto(fixtureURL + '/dashboard'); await page.locator('.stats-grid').waitFor();
      await expect(page.getByRole('button', { name: /^Registrar entrada/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Registrar saída/ })).toHaveCount(0);
    });
    await check('Comprador edita fornecedor sem botão de produto ou recebimento físico', async () => {
      await asProfile('COMPRADOR', '/fornecedores');
      await expect(page.getByRole('button', { name: 'Novo fornecedor', exact: true })).toBeVisible();
      await page.goto(fixtureURL + '/produtos'); await page.locator('tbody tr').first().waitFor();
      await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toHaveCount(0);
      await page.goto(fixtureURL + '/dashboard'); await page.locator('.stats-grid').waitFor();
      await expect(page.getByRole('button', { name: /^Registrar entrada/ })).toHaveCount(0);
    });
    await check('Almoxarife usa permissões específicas para estoque, reserva e entrega sem faturar', async () => {
      await asProfile('ALMOXARIFE', '/dashboard'); await page.locator('.stats-grid').waitFor();
      await expect(page.getByRole('button', { name: /^Registrar entrada/ })).toBeVisible();
      await page.goto(fixtureURL + '/ordens-producao?ordem=' + order.id);
      await expect(page.getByRole('button', { name: 'Entregar e aplicar', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirmar faturamento', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Requisitar material', exact: true })).toHaveCount(0);
    });
    await check('Perfil personalizado é sinalizado e mantém suas permissões no formulário', async () => {
      data.user = original.user; data.permissions = original.permissions;
      data.roles = data.roles.map(role => role.name === 'AUDITOR' ? { ...role, permissions: [{ permission: { key: 'stock:move' } }] } : role);
      await page.goto(fixtureURL + '/usuarios');
      await expect(page.getByText('Personalizado — preservado', { exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('option', { name: 'Auditor (personalizado)', exact: true })).toHaveCount(1);
      await dialog.getByRole('combobox', { name: /Perfil nesta unidade/ }).selectOption(prepared.find(role => role.name === 'AUDITOR').id);
      await dialog.locator('.role-permissions summary').click(); await expect(dialog.locator('.role-permissions')).toContainText('Entradas, saídas e transferências');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page); await page.screenshot({ animations: 'disabled', path: path.join(output, 'perfis-mobile.png'), fullPage: true });
    });
    await check('Falha de autorização na preparação não libera os perfis na interface', async () => {
      data.roles = [legacy]; rejectPreparation = true; await page.goto(fixtureURL + '/usuarios');
      await page.getByRole('button', { name: 'Disponibilizar perfis padrão', exact: true }).click();
      await expect(page.locator('.access-profiles').getByRole('alert')).toContainText('Seu acesso administrativo');
      assert.equal(data.roles.length, 1); assert.equal(preparations, 2);
    });
  } finally {
    await page.unroute(apiPattern, handler);
    Object.assign(data, original);
  }
}
