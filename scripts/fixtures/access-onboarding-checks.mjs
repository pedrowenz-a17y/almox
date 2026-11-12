import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';
import { id } from './theme-data.mjs';

export async function verifyAccessOnboarding({ page, fixtureURL, baseURL, data, user, check, output, noOverflow }) {
  const originalUsers = data.users, now = new Date().toISOString();
  const people = [
    { id: id(500), name: 'Marina Souza', email: 'marina@example.invalid', authUserId: id(501), accessState: 'INVITED', invitationAt: now, passwordDefinedAt: null, lastLoginAt: null, lastMailState: 'ACCEPTED' },
    { id: id(502), name: 'Renato Lima', email: 'renato@example.invalid', authUserId: id(503), accessState: 'PENDING', invitationAt: null, passwordDefinedAt: null, lastLoginAt: null, lastMailState: 'FAILED' },
    { id: id(504), name: 'Ana da Montagem', email: 'ana@example.invalid', authUserId: id(505), accessState: 'ACTIVE', invitationAt: now, passwordDefinedAt: now, lastLoginAt: now, lastMailState: 'ACCEPTED' },
  ].map(person => ({ ...person, roleId: user.roleId, role: user.role, active: true, identityActive: true }));
  data.users = people;
  const privatePattern = fixtureURL + '/api/**', publicPattern = baseURL + '/api/**';
  let sends = 0, creates = 0, passwordUpdates = 0, recoveries = 0, completions = 0, transientLink = false, missing = false, validContext = false;
  const mailWait = new Map(), unexpected = [];
  const privateHandler = async route => {
    const req = route.request(), url = new URL(req.url()); let result;
    if (url.pathname === '/api/user-access/setup') result = { origin: 'https://almox.example.invalid', administrativeKeyPresent: true,
      redirectUrls: ['https://almox.example.invalid/auth/callback?next=/recuperar-senha', 'https://almox.example.invalid/auth/confirm'] };
    else if (url.pathname.startsWith('/api/user-access/')) {
      const person = people.find(person => person.id === url.pathname.split('/').at(-1)); assert.ok(person);
      if (req.method() === 'POST') {
        sends++; assert.deepEqual(req.postDataJSON(), { authUserId: person.authUserId });
        mailWait.set(person.id, new Date(Date.now() + 60000).toISOString());
        if (person.id === people[0].id) { person.lastMailState = 'FAILED'; return route.fulfill({ status: 429, json: { error: 'O serviço de e-mail atingiu o limite de envio. Aguarde e, se continuar, procure o administrador.', code: 'AUTH_EMAIL_LIMIT', retryAfter: 60 } }); }
        person.lastMailState = 'ACCEPTED'; result = { kind: 'RECOVERY', retryAfter: 60, message: 'Link de recuperação solicitado ao serviço de e-mail. Confira a caixa de entrada e o spam.' };
      } else result = { ...person, providerState: missing && person.id === people[2].id ? 'MISSING' : 'READY',
        identity: { emailConfirmed: person.id !== people[0].id, invitedAt: person.invitationAt, lastSignInAt: person.lastLoginAt, blocked: false },
        canSend: !(missing && person.id === people[2].id), nextAttemptAt: mailWait.get(person.id) ?? null };
    } else if (url.pathname === '/api/catalog/users' && req.method() === 'POST') {
      creates++; const body = req.postDataJSON(); assert.equal(body.authUserId, undefined);
      const person = { ...people[1], id: id(506), authUserId: id(507), name: body.name, email: body.email };
      people.push(person); result = { ...person, accessNotice: 'Acesso cadastrado; o envio do convite não foi confirmado. O serviço de e-mail atingiu o limite. Acompanhe pelo botão Acesso do usuário.', notification: { state: 'PENDING' } };
      return route.fulfill({ status: 201, json: { data: result } });
    } else return route.fallback();
    return route.fulfill({ json: { data: result } });
  };
  const publicHandler = async route => {
    const req = route.request(), url = new URL(req.url()); let result;
    if (url.pathname === '/api/auth/password-context') {
      if (!validContext) return route.fulfill({ status: 401, json: { error: 'Abra um link válido de convite ou recuperação para definir sua senha.', code: 'PASSWORD_LINK_REQUIRED' } });
      result = { email: 'marina@example.invalid', identityId: id(501), units: ['U.C.A.', 'Capacle'] };
    } else if (url.pathname === '/api/auth/update-password' && req.method() === 'POST') { passwordUpdates++; assert.equal(typeof req.postDataJSON().password, 'string'); assert.equal(req.postDataJSON().expectedIdentityId, id(501)); result = { ok: true }; }
    else if (url.pathname === '/api/auth/recover' && req.method() === 'POST') {
      recoveries++; if (recoveries === 1) return route.fulfill({ status: 429, json: { error: 'O serviço de e-mail atingiu o limite de envio. Aguarde e, se continuar, procure o administrador.', code: 'AUTH_EMAIL_LIMIT', retryAfter: 2 } });
      result = { message: 'Se houver uma conta habilitada, você receberá instruções.', retryAfter: 60 };
    } else if (url.pathname === '/api/auth/complete-link' && req.method() === 'POST') { completions++; assert.equal(req.postDataJSON().type, 'invite'); if (transientLink === 'offline') return route.abort(); if (transientLink) return route.fulfill({ status: 503, json: { error: 'O serviço de login está temporariamente indisponível. Aguarde e tente validar este link novamente.', code: 'AUTH_UNAVAILABLE' } }); result = { next: '/primeiro-acesso' }; }
    else { unexpected.push(req.method() + ' ' + url.pathname); return route.abort(); }
    return route.fulfill({ json: { data: result } });
  };
  await page.route(privatePattern, privateHandler); await page.route(publicPattern, publicHandler);
  const row = name => page.locator('tbody tr').filter({ hasText: name });
  const open = async name => { await page.getByRole('button', { name: 'Acompanhar acesso de ' + name, exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(name); await page.getByRole('dialog').locator('.access-facts').waitFor(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check('Usuários distinguem habilitação da unidade, convite e primeiro login sem enviar mensagens', async () => {
      await page.goto(fixtureURL + '/usuarios'); await expect(row('Marina Souza')).toContainText('Convite solicitado'); await expect(row('Renato Lima')).toContainText('Primeiro acesso pendente');
      await expect(row('Ana da Montagem')).toContainText('Acesso confirmado'); await expect(row('Marina Souza')).toContainText('Habilitado na unidade'); assert.equal(sends, 0); await noOverflow(page);
      await page.screenshot({ animations: 'disabled', path: path.join(output, 'usuarios-acesso-desktop.png'), fullPage: true });
    });
    await check('Busca e filtro localizam convites pendentes sem consultar outra unidade', async () => {
      await page.getByLabel('Filtrar primeiro acesso', { exact: true }).selectOption('INVITED'); await expect(page.locator('tbody tr')).toHaveCount(1);
      await page.getByLabel('Filtrar primeiro acesso', { exact: true }).selectOption('ALL'); await page.getByLabel('Buscar pessoa', { exact: true }).fill('renato@'); await expect(page.locator('tbody tr')).toHaveCount(1); await page.getByLabel('Buscar pessoa', { exact: true }).fill('');
    });
    await check('Cadastro com falha no e-mail permanece salvo e orienta acompanhar o envio', async () => {
      await page.getByRole('button', { name: 'Novo usuário', exact: true }).click(); const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('UUID da identidade confirmada', { exact: false })).toHaveCount(0);
      await dialog.getByLabel('Nome completo', { exact: false }).fill('Nova pessoa fictícia'); await dialog.getByLabel('E-mail de acesso', { exact: false }).fill('nova@example.invalid');
      await dialog.getByLabel('Perfil nesta unidade', { exact: false }).selectOption(user.roleId); await dialog.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
      await expect(row('Nova pessoa fictícia')).toContainText('Primeiro acesso pendente'); await expect(page.locator('.toast')).toContainText('envio do convite não foi confirmado'); assert.equal(creates, 1);
    });
    await check('Vínculo de identidade existente é uma escolha explícita e não dispara convite ao selecionar', async () => {
      await page.getByRole('button', { name: 'Novo usuário', exact: true }).click(); const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Como esta pessoa vai acessar', { exact: false }).selectOption('existing');
      await expect(dialog.getByLabel('UUID da identidade confirmada', { exact: false })).toBeVisible(); await expect(dialog).toContainText('nenhum novo convite será enviado'); assert.equal(sends, 0); await page.keyboard.press('Escape');
    });
    await check('Acompanhamento consulta o estado e explica o primeiro acesso antes de qualquer envio', async () => {
      await open('Marina Souza'); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('marina@example.invalid'); await expect(dialog).toContainText('Ainda sem confirmação registrada');
      await expect(dialog.getByRole('button', { name: 'Reenviar convite', exact: true })).toBeEnabled(); assert.equal(sends, 0); await noOverflow(page);
      await dialog.screenshot({ animations: 'disabled', path: path.join(output, 'acompanhar-convite-desktop.png') });
    });
    await check('Limite do provedor permanece visível e bloqueia reenvio repetido, inclusive após reabrir', async () => {
      let dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Reenviar convite', exact: true }).click();
      await expect(dialog.locator('.notice[role="alert"]')).toContainText('limite de envio'); await expect(dialog.getByRole('button', { name: /Nova tentativa em/ })).toBeDisabled(); await expect(dialog.getByRole('status')).toHaveCount(0);
      await page.keyboard.press('Escape'); await open('Marina Souza'); dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: /Nova tentativa em/ })).toBeDisabled(); assert.equal(sends, 1); await page.keyboard.press('Escape');
    });
    await check('Envio confirmado pelo provedor não inventa senha definida ou primeiro login', async () => {
      await open('Renato Lima'); let dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Enviar link para definir senha', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('status')).toContainText('Link de recuperação solicitado'); dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Primeiro acesso pendente'); await expect(dialog).toContainText('Ainda sem confirmação registrada'); await page.keyboard.press('Escape');
    });
    await check('Identidade ausente impede reenvio e orienta revisão do vínculo', async () => {
      missing = true; await open('Ana da Montagem'); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('identidade vinculada não foi encontrada'); await expect(dialog.getByRole('button', { name: 'Enviar link para definir senha', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); missing = false;
    });
    await check('Configuração mostra endereços esperados e distingue painel externo de verificação efetiva', async () => {
      await page.locator('.access-email-settings summary').click(); await expect(page.getByLabel('Site URL', { exact: true })).toHaveValue('https://almox.example.invalid');
      await expect(page.locator('.access-email-settings')).toContainText('não confirma as configurações do painel externo'); await expect(page.locator('.access-email-settings')).toContainText('Confira APP_URL');
    });
    await check('Lista de pessoas e acompanhamento cabem em 390 e 320 pixels sem rolagem lateral', async () => {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 }); await page.goto(fixtureURL + '/usuarios'); await row('Marina Souza').waitFor(); await noOverflow(page);
        assert.ok(await page.locator('.users-access-table').evaluate(element => element.parentElement.scrollWidth <= element.parentElement.clientWidth + 1));
        await open('Renato Lima'); await noOverflow(page); if (width === 390) await page.getByRole('dialog').screenshot({ animations: 'disabled', path: path.join(output, 'acompanhamento-mobile.png') }); await page.keyboard.press('Escape');
      }
    });
    await check('Primeiro acesso sem link válido orienta convite e não habilita cadastro de senha', async () => {
      await page.goto(baseURL + '/primeiro-acesso'); await expect(page.locator('.notice[role="alert"]')).toContainText('abra o convite recebido por e-mail'); await expect(page.getByRole('button', { name: 'Criar minha senha', exact: true })).toHaveCount(0);
    });
    await check('Link com fragmento limpa a URL antes de validar e não persiste tokens no navegador', async () => {
      validContext = true; await page.goto(baseURL + '/auth/retorno#access_token=fixture.access.token-for-ui&refresh_token=fixture.refresh.token-for-ui&type=invite');
      await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).waitFor(); assert.equal(new URL(page.url()).hash, ''); assert.equal(completions, 0);
      await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).click(); await page.waitForURL(baseURL + '/primeiro-acesso'); await expect(page.locator('.password-identity')).toContainText('marina@example.invalid');
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('sb-'))), false); assert.equal(completions, 1);
    });
    await check('Falha temporária mantém o link em memória para nova validação sem solicitar outro e-mail', async () => {
      transientLink = true; await page.goto(baseURL + '/auth/retorno#access_token=fixture.access.token-for-ui&refresh_token=fixture.refresh.token-for-ui&type=invite');
      await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText('temporariamente indisponível'); await expect(page.getByRole('button', { name: 'Validar link e continuar', exact: true })).toBeEnabled();
      await expect(page.getByRole('link', { name: 'Solicitar novo link', exact: true })).toHaveCount(0); assert.equal(new URL(page.url()).hash, '');
      transientLink = 'offline'; await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText('Não foi possível acessar o servidor'); await expect(page.getByRole('button', { name: 'Validar link e continuar', exact: true })).toBeEnabled();
      transientLink = false; await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).click(); await page.waitForURL(baseURL + '/primeiro-acesso'); await expect(page.locator('.password-identity')).toContainText('marina@example.invalid');
    });
    await check('Primeira senha mostra identidade, rejeita divergência e confirma o próximo login', async () => {
      await page.setViewportSize({ width: 1440, height: 1000 }); await noOverflow(page); await page.screenshot({ animations: 'disabled', path: path.join(output, 'primeiro-acesso-desktop.png'), fullPage: true });
      await page.getByLabel('Nova senha', { exact: true }).fill('Senha-ficticia-12345'); await page.getByLabel('Confirme a nova senha', { exact: true }).fill('Outra-ficticia-12345'); await page.getByRole('button', { name: 'Criar minha senha', exact: true }).click();
      await expect(page.locator('.notice[role="alert"]')).toHaveText('As senhas precisam ser iguais.'); assert.equal(passwordUpdates, 0);
      await page.getByLabel('Confirme a nova senha', { exact: true }).fill('Senha-ficticia-12345'); await page.getByRole('button', { name: 'Criar minha senha', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sua senha está pronta' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Ir para o login', exact: true })).toBeVisible(); assert.equal(passwordUpdates, 1);
    });
    await check('Recuperação trata limite com espera e mantém resposta genérica quando o envio é aceito', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(baseURL + '/esqueci-senha'); await page.getByLabel('E-mail', { exact: true }).fill('marina@example.invalid'); await page.getByRole('button', { name: 'Enviar link de recuperação', exact: true }).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText('limite de envio'); await expect(page.getByRole('button', { name: /Nova tentativa em/ })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Enviar link de recuperação', exact: true })).toBeEnabled({ timeout: 6000 }); await page.getByRole('button', { name: 'Enviar link de recuperação', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Se houver uma conta habilitada'); await noOverflow(page);
    });
    await check('Link expirado apresenta saída clara sem solicitar e-mail automaticamente', async () => {
      await page.goto(baseURL + '/acesso-invalido?reason=expired'); await expect(page.getByRole('heading', { name: 'Não foi possível validar o link' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Solicitar novo link', exact: true })).toBeVisible(); assert.equal(recoveries, 2);
      await noOverflow(page); assert.deepEqual(unexpected, []);
    });
  } finally { await page.unroute(privatePattern, privateHandler); await page.unroute(publicPattern, publicHandler); data.users = originalUsers; }
}
