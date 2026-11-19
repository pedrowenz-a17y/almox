/* global almoxSetup */
const statusNode = document.getElementById('status');
const address = document.getElementById('origin');
const buttons = [...document.querySelectorAll('button')];
let busy = false;
async function perform(action) {
  if (busy) return;
  busy = true;
  buttons.forEach(button => { button.disabled = true; });
  statusNode.textContent = 'Preparando a conexão…';
  try {
    const result = await action();
    statusNode.textContent = result.ok ? 'Abrindo seu almoxarifado…' : result.canceled ? '' : result.error;
  } catch { statusNode.textContent = 'Não foi possível conectar. Tente novamente.'; }
  finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
}
document.getElementById('remote-form').addEventListener('submit', event => {
  event.preventDefault();
  void perform(() => almoxSetup.connect(address.value));
});
document.getElementById('import-local').addEventListener('click', () => { void perform(() => almoxSetup.importLocal()); });
almoxSetup.status().then(state => {
  document.getElementById('version').textContent = `Almox ERP ${state.version}`;
  if (!busy) {
    if (state.origin && !address.value) address.value = state.origin;
    statusNode.textContent = state.error || state.message || '';
  }
}).catch(() => { statusNode.textContent = 'Reabra o aplicativo para configurar a conexão.'; });
