import {ArrowDown, ClipboardCheck, FileCheck2, ShoppingCart} from 'lucide-react';
import {Action, Demo, Desktop, Headline, Item, Pill, Rise, Stage, Stat, linear, ramp, useShot} from '../design';
import {InventoryMetrics, Replenishment, ReviewNotice} from '../screens';

export const Restock = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps, progress} = useShot(seconds);
  const focus = ramp(frame, seconds * 0.28 * fps, seconds * 0.57 * fps);
  const bar = ramp(frame, seconds * 0.40 * fps, seconds * 0.72 * fps);
  return (
    <Stage seconds={seconds}>
      <div style={{position: 'absolute', left: 726, top: 180, opacity: 1 - focus * 0.38,
        transform: 'perspective(1450px) rotateY(' + (-12 + 4 * focus) + 'deg) translateY(' + (-14 * progress) + 'px)'}}>
        <Replenishment/>
      </div>
      <Headline label="Planejamento de reposição" lines={['Antecipe', 'a reposição.']} body="Identifique o saldo baixo e revise a sugestão de compra." style={{top: 342}}/>
      <div className="surface stock-detail" style={{opacity: focus, translate: '0 ' + ((1 - focus) * 55) + 'px'}}>
        <div className="flex-between"><div className="card-kicker"><ShoppingCart size={20}/> Compra sugerida</div><Pill tone="amber">Estoque baixo</Pill></div>
        <h3>Correia em V A42</h3>
        <div className="stock-bar"><span style={{width: (bar * 40) + '%'}}/></div>
        <div className="flex-between stock-bar-label"><span>4 disponíveis</span><span>Mínimo de 10</span></div>
        <div className="divider"/>
        <div className="flex-between"><span className="micro-label">Quantidade sugerida</span><b className="stock-amount">6 unidades</b></div>
      </div>
      <Demo/>
    </Stage>
  );
};

export const Inventory = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const count = ramp(frame, seconds * 0.20 * fps, seconds * 0.44 * fps);
  const review = ramp(frame, seconds * 0.50 * fps, seconds * 0.69 * fps);
  const seen = linear(frame, seconds * 0.57 * fps, seconds * 0.68 * fps);
  return (
    <Stage seconds={seconds} mood="left">
      <div style={{position: 'absolute', left: -175, top: 266, opacity: 0.30,
        transform: 'perspective(1700px) rotateY(12deg) scale(.91)'}}>
        <Desktop active="Inventário" title="Inventário" subtitle="Contagens do almoxarifado">
          <div className="card"><Item name="Rolamento 6205" meta="Local A-03-02"/></div>
        </Desktop>
      </div>
      <Headline label="Inventário físico" lines={['Conte.', 'Revise.']} body="Compare o saldo registrado com a conferência física." size={104} style={{left: 1180, top: 314, maxWidth: 600}}/>
      <div className="surface inventory-detail" style={{translate: '0 ' + ((1 - count) * 38) + 'px'}}>
        <div className="flex-between"><div className="card-kicker"><ClipboardCheck size={21}/> Conferir inventário</div><Pill tone={seen === 1 ? 'amber' : 'neutral'}>{seen === 1 ? 'Em revisão' : 'Conferência física'}</Pill></div>
        <div className="inventory-item"><Item name="Rolamento 6205" meta="MAT-042 · Local A-03-02"/></div>
        {count > 0.86 ? <InventoryMetrics/> : <div className="stats"><Stat label="Saldo registrado" value="120" note="unidades"/><Stat label="Quantidade contada" value={count > 0 ? 118 : '—'} note="unidades"/><Stat label="Diferença" value={<ArrowDown size={22}/>}/></div>}
        <div style={{opacity: review, marginTop: 17}}><ReviewNotice/></div>
        <div className="flex-between" style={{marginTop: 15}}>
          <span className="micro-label">Validação independente</span>
          <Action variant={seen === 1 ? 'quiet' : 'red'}><FileCheck2 size={17}/>{seen === 1 ? 'Enviado para revisão' : 'Enviar contagem'}</Action>
        </div>
      </div>
      <Demo/>
    </Stage>
  );
};

export const StockLaunch = ({seconds = 4}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const slide = ramp(frame, seconds * 0.20 * fps, seconds * 0.52 * fps);
  return (
    <Stage seconds={seconds} mood="center">
      <Headline label="Reposição e inventário" lines={['Organize o estoque.']} size={87} style={{maxWidth: 1230, top: 157}}/>
      <Rise at={0.30} style={{position: 'absolute', left: 94, top: 365}}>
        <div className="surface launch-stock-card">
          <div className="card-kicker"><ShoppingCart size={19}/> Reposição</div>
          <h3>Correia em V A42</h3><Pill tone="amber">Estoque baixo</Pill>
          <div className="divider"/>
          <div className="stats"><Stat label="Disponível" value="4 un."/><Stat label="Compra sugerida" value="6 un." tone="amber"/></div>
        </div>
      </Rise>
      <div className="surface launch-stock-card launch-inventory-card" style={{opacity: slide, translate: ((1 - slide) * 105) + 'px 0'}}>
        <div className="card-kicker"><ClipboardCheck size={19}/> Inventário</div>
        <h3>Rolamento 6205</h3><Pill tone="blue">Contagem em revisão</Pill>
        <div className="divider"/>
        <InventoryMetrics/>
      </div>
      <Demo/>
    </Stage>
  );
};
