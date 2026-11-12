import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';
import { id } from './theme-data.mjs';

export async function verifyOperationalResponsibility({ page, fixtureURL, data, user, check, output, noOverflow }) {
  const original = { user: data.user, permissions: data.permissions };
  const supervisor = { ...user }, incoming = { ...user, id: id(401), name: 'Marina — almoxarife' };
  const people = [supervisor, incoming];
  const now = new Date().toISOString(), warehouseId = data.warehouses[0].id;
  let ready = false, active = null, history = [], posts = 0, rejectAssignment = false;
  const makeShift = (person, previousId = 410) => ({ id: id(previousId), unitId: user.unitId, warehouseId,
    responsibleId: person.id, responsible: { id: person.id, name: person.name }, openedBy: { id: person.id, name: person.name }, openedById: person.id,
    startedAt: now, endedAt: null, endedById: null, endedBy: null, handoverToId: null, handoverTo: null, handoverNote: '', handoverRequestedAt: null, closeNote: '', version: 1 });
  const rows = [
    { id: id(420) + ':UNAPPLIED', type: 'UNAPPLIED', orderId: id(421), orderKind: 'SERVICE', code: 'OS-1042', title: 'Manutenção de implemento',
      productCode: 'ROL-6204', productName: 'Rolamento rígido 6204', unit: 'UN', quantity: '4.000', creatorId: null, creatorName: null,
      assigneeId: null, assigneeName: null, assignmentVersion: 0, assignmentNote: null, dueAt: null, overdue: false, openedAt: now },
    { id: id(422) + ':COUNT', type: 'COUNT', orderId: null, orderKind: null, code: 'CONTAGEM-01', title: 'Contagem aguardando aprovação',
      productCode: null, productName: null, unit: null, quantity: null, creatorId: supervisor.id, creatorName: supervisor.name,
      assigneeId: null, assigneeName: null, assignmentVersion: 0, assignmentNote: null, dueAt: null, overdue: false, openedAt: now },
    { id: id(423) + ':RETURN', type: 'RETURN', orderId: id(424), orderKind: 'PRODUCTION', code: 'OP-2098', title: 'Montagem de pulverizador',
      productCode: 'COR-B72', productName: 'Correia de transmissão B-72', unit: 'UN', quantity: '2.000', creatorId: null, creatorName: null,
      assigneeId: incoming.id, assigneeName: incoming.name, assignmentVersion: 1, assignmentNote: 'Conferir a sobra devolvida pelo setor de montagem.', dueAt: '2020-01-01T12:00:00Z', overdue: true, openedAt: now },
  ].map(item => ({ ...item, warehouseId, locationCode: data.locations[0].code, createdAt: now, missingHandoff: false, occurrenceKey: id(430 + (item.type === 'COUNT' ? 1 : item.type === 'RETURN' ? 2 : 0)), assigneeEligible: true }));
  const canManage = () => data.permissions.includes('inventory:adjust') || data.permissions.includes('users:manage');
  const readOnly = () => !data.permissions.includes('stock:move');
  const apiPattern = fixtureURL + '/api/**';
  const handler = async route => {
    const request = route.request(), url = new URL(request.url());
    let value;
    if (url.pathname === '/api/operational-pending' && request.method() === 'GET') {
      const focus = url.searchParams.get('focus'), type = url.searchParams.get('type');
      const filtered = rows.filter(row => (!type || type === 'ALL' || row.type === type) && (!focus || focus === 'ALL' || (focus === 'MINE' && row.assigneeId === data.user.id) || (focus === 'UNASSIGNED' && !row.assigneeId) || (focus === 'OVERDUE' && row.overdue)));
      value = { items: filtered, total: filtered.length, page: 1, pageSize: 25, totals: { UNAPPLIED: 1, COUNT: 1, RETURN: 1 }, serverTime: now,
        coordinationReady: ready, canManage: ready && canManage(), overdueTotal: rows.filter(row => row.overdue).length,
        unassignedTotal: rows.filter(row => !row.assigneeId).length, mineTotal: rows.filter(row => row.assigneeId === data.user.id).length };
    } else if (url.pathname === '/api/warehouse-shifts') {
      if (request.method() === 'POST') {
        posts++; const body = request.postDataJSON(); assert.equal(body.warehouseId, warehouseId);
        if (body.action === 'START') active = makeShift(data.user);
        else if (body.action === 'REQUEST_HANDOVER') { active = { ...active, handoverToId: body.toId, handoverTo: people.find(person => person.id === body.toId), handoverNote: body.note, handoverRequestedAt: now, version: active.version + 1 }; }
        else if (body.action === 'ACCEPT_HANDOVER') { assert.equal(data.user.id, active.handoverToId); history = [{ ...active, endedAt: now, endedById: data.user.id, endedBy: data.user, closeNote: body.note }]; active = makeShift(data.user, 411); }
        else throw new Error('Ação fictícia não esperada: ' + body.action);
        value = { id: active.id };
      } else value = { ready, active, history, warehouseId, canTake: !readOnly(), canManage: canManage(), people, peopleTruncated: false };
    } else if (url.pathname === '/api/operational-pending/people') value = { people: people.map(person => ({ id: person.id, name: person.name, types: ['UNAPPLIED', 'COUNT', 'RETURN'] })), truncated: false };
    else if (url.pathname === '/api/operational-pending/assignment' && request.method() === 'POST') {
      posts++; if (rejectAssignment) return route.fulfill({ status: 409, json: { error: 'Outra pessoa atualizou a atribuição. Reabra a pendência para conferir.', code: 'RESPONSIBILITY_VERSION_CONFLICT' } });
      const body = request.postDataJSON(), item = rows.find(row => row.id === body.pendingId); assert.equal(body.dueAt, '2090-11-20T18:00:00.000Z'); assert.equal(body.occurrenceKey, item.occurrenceKey); assert.equal(body.expectedVersion, item.assignmentVersion);
      const person = people.find(person => person.id === body.assigneeId); Object.assign(item, { assigneeId: person.id, assigneeName: person.name, dueAt: body.dueAt, assignmentNote: body.note, assignmentVersion: item.assignmentVersion + 1, overdue: false }); value = { id: id(440), version: item.assignmentVersion };
    } else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(apiPattern, handler);
  const view = async (person = supervisor, permissions = user.permissions) => {
    data.user = { ...person, permissions }; data.permissions = permissions;
    await page.goto(fixtureURL + '/pendencias'); await page.getByRole('heading', { name: 'Pendências da operação' }).waitFor(); await page.getByRole('cell', { name: /O.S. OS-1042/ }).waitFor();
  };
  const row = code => page.locator('tbody tr').filter({ hasText: code });
  const submitNote = async (text, button) => { const dialog = page.getByRole('dialog'); await dialog.locator('textarea').fill(text); await dialog.getByRole('button', { name: button, exact: true }).click(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check('Migração ausente preserva a lista e oferece SQL somente ao administrador', async () => {
      await view(); await expect(page.getByText('Etapa 3: preparar o banco', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Baixar SQL da etapa 3' })).toHaveAttribute('href', '/api/operations-setup');
      await expect(page.getByRole('button', { name: 'Assumir turno', exact: true })).toHaveCount(0); assert.equal(posts, 0);
    });
    await check('Assumir turno mostra pessoa autenticada e horário, sem criar responsabilidade automática nas pendências', async () => {
      ready = true; await view(); await page.getByRole('button', { name: 'Assumir turno', exact: true }).click();
      await expect(page.locator('.shift-current')).toContainText(supervisor.name); await expect(row('OS-1042')).toContainText('Sem responsável definido'); assert.equal(posts, 1);
    });
    await check('Passagem mantém titular atual e exibe orientações enquanto aguarda aceite', async () => {
      await page.getByRole('button', { name: 'Passar turno', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Quem vai assumir').selectOption(incoming.id);
      await submitNote('Conferir devolução da OP-2098 e liberar a OS-1042.', 'Passar turno');
      await expect(page.locator('.shift-handover')).toContainText('Aguardando aceite de ' + incoming.name);
      await expect(page.locator('.shift-current')).toContainText(supervisor.name);
      await expect(page.getByRole('button', { name: 'Aceitar e assumir turno', exact: true })).toHaveCount(0);
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'passagem-turno-desktop.png'), fullPage: true });
    });
    await check('Pessoa indicada aceita com seu acesso e o histórico identifica os dois turnos', async () => {
      await view(incoming); await page.getByRole('button', { name: 'Aceitar e assumir turno', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Conferir devolução da OP-2098');
      await submitNote('Recebi as orientações e assumo o almoxarifado.', 'Aceitar e assumir turno');
      await expect(page.locator('.shift-current')).toContainText(incoming.name); await page.locator('.shift-history summary').click(); await expect(page.locator('.shift-history')).toContainText(supervisor.name);
    });
    await check('Atribuição pede prazo escolhido pela equipe e atualiza a linha somente após confirmação', async () => {
      await view(); await row('OS-1042').getByRole('button', { name: 'Definir responsável', exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('Prazo para regularização')).toHaveValue('');
      await dialog.getByLabel('Responsável pela etapa').selectOption(incoming.id); await dialog.getByLabel('Prazo para regularização').fill('2090-11-20T15:00');
      await dialog.getByLabel('Orientação ou motivo da alteração').fill('Separar os quatro rolamentos para a oficina.');
      await dialog.screenshot({ animations: 'disabled', path: path.join(output, 'atribuir-pendencia-desktop.png') });
      await dialog.getByRole('button', { name: 'Salvar responsável e prazo', exact: true }).click();
      await expect(row('OS-1042')).toContainText(incoming.name); await expect(row('OS-1042')).toContainText('Prazo definido'); await expect(page.getByRole('status')).toContainText('Responsável e prazo registrados');
    });
    await check('Conflito de versão preserva o erro na tela e não indica sucesso', async () => {
      rejectAssignment = true; await row('OS-1042').getByRole('button', { name: 'Reatribuir', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Orientação ou motivo da alteração').fill('Prazo revisado pela equipe.');
      await dialog.getByRole('button', { name: 'Salvar responsável e prazo', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Outra pessoa atualizou'); await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); rejectAssignment = false;
    });
    await check('Aprovação da contagem exclui o autor da lista de responsáveis', async () => {
      await row('Contagem aguardando aprovação').getByRole('button', { name: 'Definir responsável', exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('option', { name: supervisor.name, exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('option', { name: incoming.name, exact: true })).toHaveCount(1); await expect(dialog).toContainText('diferente de quem registrou'); await page.keyboard.press('Escape');
    });
    await check('Filtros de responsabilidade mostram atrasadas, minhas e sem responsável', async () => {
      await page.getByRole('button', { name: /Atrasadas/ }).click(); await expect(page.locator('tbody tr')).toHaveCount(1); await expect(row('OP-2098')).toContainText('Em atraso');
      await page.getByRole('button', { name: /Sem responsável/ }).click(); await expect(page.locator('tbody tr')).toHaveCount(1); await expect(row('Contagem aguardando aprovação')).toBeVisible();
      await page.getByRole('button', { name: /^Minhas/ }).click(); await expect(page.locator('tbody tr')).toHaveCount(0);
    });
    await check('Auditor consulta turnos e prazos sem controles de alteração, nos temas claro e escuro', async () => {
      await view({ ...user, id: id(450), name: 'Auditoria teste' }, ['orders:read', 'inventory:read']);
      await expect(page.getByRole('button', { name: 'Definir responsável', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reatribuir', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Passar turno', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Ativar modo claro', exact: true }).click(); await noOverflow(page);
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'pendencias-claro-desktop.png'), fullPage: true });
      await page.getByRole('button', { name: 'Ativar modo escuro', exact: true }).click();
    });
    await check('Turno, filtros e formulário cabem em celulares de 390 e 320 pixels', async () => {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 }); await view(); await page.locator('.shift-current').waitFor(); await noOverflow(page);
        assert.ok(await page.locator('.pending-table').evaluate(element => element.parentElement.scrollWidth <= element.parentElement.clientWidth + 1), 'Pendências no celular devem mostrar cartões sem rolagem lateral.');
        if (width === 390) await page.screenshot({ animations: 'disabled', path: path.join(output, 'pendencias-dark-mobile.png'), fullPage: true });
        await row('OS-1042').getByRole('button', { name: 'Reatribuir', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await noOverflow(page); await page.keyboard.press('Escape');
      }
    });
  } finally {
    await page.unroute(apiPattern, handler); Object.assign(data, original);
  }
}
