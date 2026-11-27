import {Boxes, MapPin, Package, Search} from 'lucide-react';
import {Cursor, Demo, Headline, Item, Pill, Rise, Stage, linear, ramp, useShot} from '../design';
import {Products, demoLocation, demoMaterial} from '../screens';

export const ProductSearch = ({seconds = 6}: {seconds?: number}) => {
  const {frame, fps, progress} = useShot(seconds);
  const typed = linear(frame, seconds * 0.20 * fps, seconds * 0.49 * fps);
  const focus = ramp(frame, seconds * 0.08 * fps, seconds * 0.19 * fps);
  const detail = ramp(frame, seconds * 0.53 * fps, seconds * 0.75 * fps);
  const pulse = linear(frame, seconds * 0.19 * fps, seconds * 0.33 * fps);
  const query = demoMaterial.slice(0, Math.floor(typed * demoMaterial.length));
  return (
    <Stage seconds={seconds}>
      <Headline label="Consulta de materiais" lines={['Encontre', 'o material.']} body="Veja o saldo disponível e onde o item está guardado." style={{top: 328}}/>
      <div style={{position: 'absolute', left: 698, top: 233, transformOrigin: '42% 40%',
        transform: 'perspective(1670px) rotateY(' + (-10 + detail * 6) + 'deg) scale(' + (0.91 + detail * 0.09 + progress * 0.01) + ')',
        opacity: 1 - detail * 0.30}}>
        <Products query={query} typing={focus > 0.8 && typed < 1} found={typed === 1}/>
        <Cursor x={356 - 46 * focus} y={319 - 75 * focus} pulse={pulse} opacity={1 - linear(frame, seconds * 0.41 * fps, seconds * 0.50 * fps)}/>
      </div>
      <div className="surface product-detail" style={{left: 1005 + (1 - detail) * 65, top: 584 + (1 - detail) * 32, opacity: detail}}>
        <div className="card-kicker"><Search size={18}/> Material localizado</div>
        <Item name={demoMaterial} meta="MAT-042 · Peça de manutenção"/>
        <div className="divider"/>
        <div className="product-detail-meta">
          <div><MapPin size={21}/><span><small>Localização</small><b>{demoLocation}</b></span></div>
          <div><Boxes size={21}/><span><small>Disponível</small><b>16 unidades</b></span></div>
        </div>
        <Pill tone="green"><Package size={13}/> Em estoque</Pill>
      </div>
      <Rise at={0.46} style={{position: 'absolute', left: 94, top: 711}}><div className="headline-rule"/></Rise>
      <Demo/>
    </Stage>
  );
};
