import {ArrowRight, Bell, CalendarClock, Check, Clock3, FileSpreadsheet, Users} from 'lucide-react';
import {Action, Demo, Headline, Item, Pill, Rise, Stage, Stat, linear, ramp, useShot} from '../design';
import {AlertDetail, Alerts, CsvTable, Management} from '../screens';

export const Shift = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const pass = ramp(frame, seconds * 0.32 * fps, seconds * 0.55 * fps);
  const accept = ramp(frame, seconds * 0.62 * fps, seconds * 0.78 * fps);
  return (
    <Stage seconds={seconds}>
      <Headline label="Passagem de turno" lines={['O próximo turno', 'segue informado.']} body="Transfira pendências com responsável e prazo definidos." size={77} style={{top: 326, maxWidth: 765}}/>
      <div className="surface shifts-board">
        <div className="card-kicker"><Users size={21}/> Passagem de responsabilidade</div>
        <div className="shift-route">
          <div className="card"><Clock3 size={22}/><b>Turno A</b><small>Equipe anterior</small></div>
          <div className="shift-arrow" style={{opacity: 0.27 + pass * 0.73}}><ArrowRight size={30}/></div>
          <div className="card" style={{borderColor: accept > 0.8 ? '#43755b' : '#494b59'}}><Clock3 size={22}/><b>Turno B</b><small>Próxima equipe</small></div>
        </div>
        <div className="card shift-task" style={{translate: (pass * 21) + 'px 0'}}>
          <div className="flex-between"><Item name="Conferir localização A-03" meta="Pendência de inventário"/><Pill tone="amber">Alta prioridade</Pill></div>
          <div className="divider"/>
          <div className="activity"><CalendarClock size={18}/> Prazo · 17:00 <small>{accept > 0.70 ? 'Responsável: turno B' : 'Responsável: turno A'}</small></div>
        </div>
        <div className="flex-between" style={{marginTop: 22}}>
          <span className="micro-label">Aceite na conta do responsável</span>
          <Action variant={accept > 0.70 ? 'green' : 'quiet'}>{accept > 0.70 ? <><Check size={18}/> Passagem aceita</> : 'Aguardando aceite'}</Action>
        </div>
      </div>
      <Demo/>
    </Stage>
  );
};

export const Csv = ({seconds = 7}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const insert = ramp(frame, seconds * 0.18 * fps, seconds * 0.49 * fps);
  const result = ramp(frame, seconds * 0.48 * fps, seconds * 0.69 * fps);
  return (
    <Stage seconds={seconds} mood="left">
      <Headline label="Conferência CSV" lines={['Compare.', 'Depois revise.']} body="Identifique registros correspondentes e divergências no arquivo." size={77} style={{left: 1260, top: 326, maxWidth: 594}}/>
      <div style={{position: 'absolute', left: 22, top: 258, opacity: 0.42 + result * 0.58,
        transform: 'perspective(1550px) rotateY(' + (13 - result * 9) + 'deg) scale(.9)'}}>
        <CsvTable/>
      </div>
      <div className="surface csv-file" style={{opacity: 1 - insert, translate: (insert * 112) + 'px ' + (insert * 44) + 'px', scale: 1 - insert * 0.29}}>
        <div className="csv-file-icon"><FileSpreadsheet size={38}/></div>
        <div><b>estoque_demo.csv</b><small>Arquivo de conferência</small></div>
        <ArrowRight size={23}/>
      </div>
      <div className="surface csv-result" style={{opacity: result, translate: '0 ' + ((1 - result) * 42) + 'px'}}>
        <div className="flex-between"><div className="card-kicker"><FileSpreadsheet size={19}/> Diferença encontrada</div><Pill tone="amber">Para revisão</Pill></div>
        <h3>Correia em V A42</h3>
        <div className="stats"><Stat label="Almox ERP" value="4 un."/><Stat label="Arquivo CSV" value="6 un." tone="amber"/></div>
      </div>
      <Demo/>
    </Stage>
  );
};

export const AlertCenter = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const focus = ramp(frame, seconds * 0.22 * fps, seconds * 0.52 * fps);
  const read = frame > seconds * 0.72 * fps;
  return (
    <Stage seconds={seconds}>
      <Headline label="Alertas e pendências" lines={['Veja o que', 'pede atenção.']} body="Priorize por prazo e acompanhe a situação na origem." size={78} style={{top: 320}}/>
      <div style={{position: 'absolute', left: 706, top: 224, opacity: 1 - focus * 0.36,
        transform: 'perspective(1560px) rotateY(' + (-11 + focus * 5) + 'deg) scale(.96)'}}>
        <Alerts read={read}/>
      </div>
      <div className="alert-float" style={{opacity: focus, translate: '0 ' + ((1 - focus) * 48) + 'px'}}><AlertDetail read={read}/></div>
      <Demo/>
    </Stage>
  );
};

export const UnitView = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps, progress} = useShot(seconds);
  const reveal = ramp(frame, 0.22 * fps, 1.05 * fps);
  const compare = ramp(frame, seconds * 0.28 * fps, seconds * 0.59 * fps);
  return (
    <Stage seconds={seconds} mood="center">
      <Headline label="Visão gerencial" lines={['Compare as unidades.']} size={89} style={{top: 116, maxWidth: 1400}}/>
      <div className="management-desktop" style={{opacity: reveal, transform:
        'perspective(1650px) translateY(' + ((1 - reveal) * 88) + 'px) rotateX(' + (11 - reveal * 6) + 'deg) scale(' + (1.04 - progress * 0.05) + ')'}}>
        <Management/>
      </div>
      <div className="surface units-focus" style={{opacity: compare, translate: ((1 - compare) * 34) + 'px 0'}}>
        <div className="card-kicker"><Users size={18}/> Filas por unidade</div>
        <h3>Inventários em revisão</h3>
        <div className="unit-compare"><span>Unidade A</span><i><b style={{width: compare * 45 + '%'}}/></i><strong>1</strong></div>
        <div className="unit-compare"><span>Unidade B</span><i><b style={{width: compare * 90 + '%'}}/></i><strong>2</strong></div>
      </div>
      <Demo/>
    </Stage>
  );
};

export const OperationsLaunch = ({seconds = 4}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const enter = linear(frame, seconds * 0.17 * fps, seconds * 0.50 * fps);
  return (
    <Stage seconds={seconds} mood="center">
      <Headline label="Alertas e visão gerencial" lines={['Gerencie a operação.']} size={87} style={{top: 146, maxWidth: 1400}}/>
      <Rise at={0.22} style={{position: 'absolute', left: 104, top: 371}}>
        <div className="surface operations-card">
          <div className="card-kicker"><Bell size={20}/> Central de alertas</div>
          <h3>Conferir localização A-03</h3>
          <Pill tone="amber">Prazo hoje</Pill>
          <div className="divider"/>
          <div className="activity"><CalendarClock size={20}/> Equipe de inventário</div>
        </div>
      </Rise>
      <div className="surface operations-card" style={{position: 'absolute', left: 941, top: 416, opacity: enter, translate: ((1 - enter) * 70) + 'px 0'}}>
        <div className="card-kicker"><Users size={20}/> Visão da operação</div>
        <h3>Recebimentos pendentes</h3>
        <div className="stats"><Stat label="Unidade A" value="2"/><Stat label="Unidade B" value="1" tone="blue"/></div>
      </div>
      <Demo/>
    </Stage>
  );
};
