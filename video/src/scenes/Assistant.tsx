import {ArrowUp, MapPin, Sparkles} from 'lucide-react';
import {Action, Demo, Desktop, Headline, Item, Pill, Stage, linear, ramp, useShot} from '../design';
import {demoLocation, demoMaterial} from '../screens';

const question = 'Onde está o rolamento 6205?';
const answer = 'O rolamento 6205 está no corredor A, prateleira 03. Há 16 unidades disponíveis na Unidade A.';

export const Assistant = ({seconds = 10}: {seconds?: number}) => {
  const {frame, fps} = useShot(seconds);
  const type = linear(frame, seconds * 0.13 * fps, seconds * 0.37 * fps);
  const sent = frame >= seconds * 0.41 * fps;
  const response = linear(frame, seconds * 0.49 * fps, seconds * 0.72 * fps);
  const result = ramp(frame, seconds * 0.69 * fps, seconds * 0.84 * fps);
  const enter = ramp(frame, 0, 0.66 * fps);
  return (
    <Stage seconds={seconds} mood="left">
      <div style={{position: 'absolute', opacity: 0.28, left: -236, top: 234,
        transform: 'perspective(1600px) rotateY(13deg) scale(.92)'}}>
        <Desktop active="Produtos" title="Produtos" subtitle="Catálogo da Unidade A">
          <div className="card"><Item name={demoMaterial} meta="MAT-042"/></div>
          <div className="card" style={{marginTop: 14}}><Item name="Filtro hidráulico" meta="MAT-117"/></div>
        </Desktop>
      </div>
      <div className="surface assistant" style={{opacity: enter, translate: '0 ' + ((1 - enter) * 66) + 'px'}}>
        <div className="assistant-top"><div className="assistant-icon"><Sparkles size={24}/></div><div><b>Assistente do almoxarifado</b><small>Consultas da unidade</small></div><Pill tone="neutral">Modo local</Pill></div>
        <div className="assistant-body">
          <div className="assistant-intro">Como posso ajudar com os materiais?</div>
          {sent && <div className="assistant-question">{question}</div>}
          {sent && <div className="assistant-answer">
            <Sparkles size={20}/>
            <span>{response > 0 ? answer.slice(0, Math.ceil(answer.length * response)) : 'Consultando a unidade…'}</span>
          </div>}
          <div className="assistant-location" style={{opacity: result, translate: '0 ' + ((1 - result) * 16) + 'px'}}><MapPin size={18}/>{demoLocation}</div>
        </div>
        <div className="assistant-input"><span>{sent ? 'Pergunte sobre um material' : question.slice(0, Math.ceil(question.length * type))}{type > 0 && !sent && <i className="caret"/>}</span><Action variant="red"><ArrowUp size={23}/></Action></div>
      </div>
      <Headline label="Assistente inteligente" lines={['Pergunte', 'ao Almox.']} body="Consulte saldos, localizações e pendências em português." size={88} style={{left: 1123, top: 343, maxWidth: 690}}/>
      <Demo/>
    </Stage>
  );
};
