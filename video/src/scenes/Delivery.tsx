import {ArrowRight, Check, CircleCheck, ClipboardCheck, PackageCheck, RefreshCw, Smartphone} from 'lucide-react';
import {Action, Cursor, Demo, Headline, Item, Phone, Pill, Stage, linear, ramp, useShot} from '../design';
import {Receipts, demoMaterial, demoOrder} from '../screens';

export const Delivery = ({seconds = 7, compact = false}: {seconds?: number; compact?: boolean}) => {
  const {frame, fps, progress} = useShot(seconds);
  const desk = ramp(frame, 0, 0.75 * fps);
  const record = ramp(frame, seconds * 0.14 * fps, seconds * 0.28 * fps);
  const mobile = ramp(frame, seconds * 0.23 * fps, seconds * 0.44 * fps);
  const review = ramp(frame, seconds * 0.45 * fps, seconds * 0.55 * fps);
  const accepted = ramp(frame, seconds * 0.58 * fps, seconds * 0.68 * fps);
  const refresh = linear(frame, seconds * 0.71 * fps, seconds * 0.78 * fps);
  const confirmed = refresh === 1;
  const glow = ramp(frame, seconds * 0.68 * fps, seconds * 0.86 * fps);
  const tap = Math.sin(Math.PI * linear(frame, seconds * 0.54 * fps, seconds * 0.66 * fps));
  return (
    <Stage seconds={seconds} mood="center">
      <Headline label="Entrega e recebimento" lines={[compact ? 'Acompanhe cada entrega.' : 'Rastreie cada entrega.']} size={compact ? 78 : 84} style={{top: 137, maxWidth: 1210}}/>
      <div className="receipt-desktop" style={{opacity: desk, transform:
        'perspective(1500px) translateY(' + ((1 - desk) * 85) + 'px) rotateY(' + (-9 + desk * 5 + progress * 1.7) + 'deg) scale(.92)'}}>
        <Receipts confirmed={confirmed} refresh={refresh}/>
        <div className="surface register-delivery" style={{opacity: 1 - record, scale: 1 - record * 0.04}}>
          <div className="card-kicker"><PackageCheck size={21}/> Entregar e aplicar</div>
          <h3>Registrar entrega</h3>
          <Item name={demoMaterial} meta={demoOrder + ' · 4 unidades'}/>
          <div className="divider"/>
          <p>Conta do ERP · confirmação pelo destinatário</p>
          <Action variant="red">Registrar entrega <ArrowRight size={18}/></Action>
        </div>
        <Cursor x={1090} y={127} pulse={refresh} opacity={refresh > 0 && !confirmed ? 1 : 0}/>
      </div>
      <div className="receipt-link" style={{opacity: mobile}}>
        <div style={{scale: glow + ' 1'}}/>
        <ArrowRight size={27} style={{rotate: '180deg', opacity: glow}}/>
      </div>
      <div className="receipt-phone" style={{opacity: mobile, transform:
        'perspective(1400px) translate3d(' + ((1 - mobile) * 144) + 'px,' + ((1 - mobile) * 33) +
        'px,0) rotateY(' + (13 - mobile * 7) + 'deg) rotateZ(' + (7 - mobile * 4) + 'deg)'}}>
        <Phone title="Recebimentos">
          <div className="tabline"><span>Para mim</span></div>
          <div className="card phone-order">
            <Item name={demoMaterial} meta={demoOrder}/>
            <div className="divider"/>
            <p><b>4 unidades</b> · Local A-03-02</p>
            <div style={{marginTop: 12}}>
              <Pill tone={accepted > 0.7 ? 'green' : 'amber'}>
                {accepted > 0.7 ? 'Recebimento confirmado' : 'Aguardando confirmação'}
              </Pill>
            </div>
          </div>
          <div style={{opacity: 1 - review, marginTop: 16}}><Action variant="red">Conferir entrega <ArrowRight size={16}/></Action></div>
          <div className="receipt-review" style={{opacity: review * (1 - accepted), translate: '0 ' + ((1 - review) * 16) + 'px'}}>
            <h3>Conferir entrega</h3>
            <p><ClipboardCheck size={16}/> Conferi as 4 unidades recebidas.</p>
            <Action variant="red"><Check size={16}/> Confirmar recebimento</Action>
            <div className="touch" style={{opacity: tap * 0.92, scale: 0.68 + tap * 0.36}}/>
          </div>
          <div className="receipt-ok" style={{opacity: accepted, translate: '0 ' + ((1 - accepted) * 18) + 'px'}}>
            <CircleCheck size={42}/><b>Recebimento confirmado</b><span>Registrado pela sua conta</span>
          </div>
        </Phone>
      </div>
      <div className="delivery-label" style={{left: 109, top: 939, opacity: desk}}><PackageCheck size={21}/> {confirmed ? 'Acompanhamento da unidade atualizado' : 'Registro e acompanhamento no desktop'}</div>
      <div className="delivery-label" style={{left: 1358, top: 939, opacity: mobile}}><Smartphone size={21}/> Confirmação pelo destinatário</div>
      <div className="delivery-update" style={{opacity: glow}}><RefreshCw size={15}/> Consulta após atualizar</div>
      <Demo/>
    </Stage>
  );
};
