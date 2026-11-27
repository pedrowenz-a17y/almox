import {PackageCheck} from 'lucide-react';
import {Item, Logo, Phone, Pill, Rise, Stage, linear, ramp, useShot} from '../design';
import {Dashboard, demoMaterial, demoOrder} from '../screens';

export const Closing = ({seconds = 5, devices = false}: {seconds?: number; devices?: boolean}) => {
  const {frame, fps, progress} = useShot(seconds);
  const montage = devices ? 1 - linear(frame, 0.91 * fps, 1.82 * fps) : 0;
  const logoStart = devices ? 1.45 : 0.16;
  const reveal = ramp(frame, logoStart * fps, (logoStart + 1.04) * fps);
  return (
    <Stage seconds={seconds} mood="center" end brand={false}>
      {devices && <div className="closing-devices" style={{opacity: montage, scale: 1 - 0.075 * (1 - montage)}}>
        <div className="closing-desktop"><Dashboard/></div>
        <div className="closing-phone"><Phone title="Recebimentos">
          <div className="card"><Item name={demoMaterial} meta={demoOrder}/><div className="divider"/><Pill tone="green"><PackageCheck size={13}/> Recebimento confirmado</Pill></div>
        </Phone></div>
      </div>}
      <div className="closing-light" style={{opacity: reveal * .74, scale: 0.94 + reveal * 0.06 + progress * 0.04}}/>
      <div className="closing-lockup" style={{opacity: reveal, translate: '0 ' + ((1 - reveal) * 23) + 'px'}}>
        <Logo size={155}/>
        <span className="closing-divider"/>
        <div><h2>Almox ERP</h2><p>Do estoque à operação.</p></div>
      </div>
      <Rise at={logoStart + .69} style={{position: 'absolute', left: 0, right: 0, top: 735}}>
        <div className="closing-rule"/>
      </Rise>
    </Stage>
  );
};
