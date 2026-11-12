import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';
import { id } from './theme-data.mjs';

// These responses are synthetic. Business invariants are separately tested with PostgreSQL.
export async function verifyInventoryApproval({ page, fixtureURL, data, user, check, output, noOverflow }) {
  const base = {
    locationId: data.locations[0].id, location: data.locations[0],
    status: 'PENDING', createdAt: '2026-11-12T12:00:00Z', note: 'Contagem fictícia para verificar aprovação independente.',
    items: [{ id: id(110), productId: data.products[0].id, expectedQuantity: '24', countedQuantity: '23' }],
  };
  const own = { ...base, id: id(101), userId: user.id, user: { name: user.name } };
  const other = { ...base, id: id(102), userId: id(90), user: { name: 'Conferente de demonstração' } };
  const unknown = { ...base, id: id(103), user: { name: 'Responsável sem identificação — teste' } };
  const historical = { ...own, id: id(104), status: 'APPROVED', user: { name: 'Contagem histórica — teste' } };
  const original = { user: data.user, permissions: data.permissions, counts: data.counts };
  data.counts = [own, other, unknown, historical];
  let requests = 0;
  const approval = () => page.getByRole('button', { name: 'Confirmar aprovação e ajustar estoque', exact: true });
  const dialog = () => page.getByRole('dialog', { name: 'Conferir inventário', exact: true });
  const open = async name => {
    await page.goto(fixtureURL + '/inventario');
    await page.locator('tbody tr').filter({ hasText: name }).getByRole('button', { name: 'Conferir', exact: true }).click();
    await dialog().waitFor();
  };
  const writes = request => {
    const url = new URL(request.url());
    if (url.origin === fixtureURL && request.method() !== 'GET') requests++;
  };
  page.on('request', writes);
  try {
    await check('Autor com permissão de ajuste vê motivo do bloqueio e não envia aprovação', async () => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width > 900 ? 1000 : 844 });
        await open(user.name);
        await expect(dialog().getByRole('status')).toContainText('Você registrou esta contagem');
        await expect(approval()).toBeDisabled();
        await approval().evaluate(button => button.click());
        assert.equal(requests, 0);
        await noOverflow(page);
        await page.screenshot({ animations: 'disabled', path: path.join(output, `autoaprovacao-bloqueada-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape');
      }
    });
    await check('Contagem sem autoria identificada não habilita a aprovação na interface', async () => {
      await open(unknown.user.name);
      await expect(dialog().getByRole('status')).toContainText('Não foi possível identificar o responsável');
      await expect(approval()).toBeDisabled();
      assert.equal(requests, 0);
      await page.keyboard.press('Escape');
    });
    await check('Contagens históricas aprovadas continuam consultáveis sem nova ação de aprovação', async () => {
      await open(historical.user.name);
      await expect(approval()).toHaveCount(0);
      await expect(dialog().locator('#inventory-approval-help')).toHaveCount(0);
      assert.equal(requests, 0);
      await page.keyboard.press('Escape');
    });
    const url = fixtureURL + `/api/inventory/${other.id}/approve`;
    await check('Outra pessoa autorizada pode confirmar aprovação e a interface atualiza o estado', async () => {
      await page.route(url, route => {
        assert.equal(route.request().method(), 'POST');
        other.status = 'APPROVED';
        return route.fulfill({ json: { data: { ...other, approvedById: user.id } } });
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await open(other.user.name);
      await expect(approval()).toBeEnabled();
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'aprovacao-independente-desktop.png'), fullPage: true });
      await approval().click();
      await expect(dialog()).toBeHidden();
      await expect(page.locator('tbody tr').filter({ hasText: other.user.name })).toContainText('Aprovado');
      assert.equal(requests, 1);
      await page.unroute(url);
    });
    await check('Recusa do servidor mantém o diálogo e explica o erro sem confirmar o ajuste', async () => {
      other.status = 'PENDING';
      await page.route(url, route => route.fulfill({ status: 403, json: {
        error: 'Você registrou esta contagem. A aprovação deve ser feita por outra pessoa com permissão de aprovação nesta unidade.',
        code: 'INVENTORY_SELF_APPROVAL',
      } }));
      await open(other.user.name);
      await approval().click();
      await expect(dialog().getByRole('alert')).toContainText('A aprovação deve ser feita por outra pessoa');
      await expect(dialog()).toBeVisible();
      assert.equal(other.status, 'PENDING');
      assert.equal(requests, 2);
      await page.keyboard.press('Escape');
      await page.unroute(url);
    });
    await check('Ser outra pessoa não libera o botão para um perfil sem permissão de ajuste', async () => {
      data.user = { ...user, permissions: ['inventory:count'], role: { ...user.role, name: 'OPERADOR' } };
      data.permissions = data.user.permissions;
      await open(other.user.name);
      await expect(page.locator('.sidebar-user small')).toHaveText('operador');
      await expect(approval()).toHaveCount(0);
      assert.equal(requests, 2);
      await page.keyboard.press('Escape');
    });
  } finally {
    page.off('request', writes);
    data.user = original.user;
    data.permissions = original.permissions;
    data.counts = original.counts;
  }
}
