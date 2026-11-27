import {ScanLine} from 'lucide-react';
import {Action, Demo, Headline, Item, Rise, Stage, ramp, useShot} from '../design';
import {Dashboard} from '../screens';

export const Opening = ({seconds = 5, still = false}: {seconds?: number; still?: boolean}) => {
  const {frame, fps, progress} = useShot(seconds);
  const enter = still ? 1 : ramp(frame, 0.05 * fps, 1.52 * fps);
  const angle = -19 + enter * 11 + progress * 3;
  return (
    <Stage seconds={seconds} end still={still}>
      <div className="opening-beam" style={{translate: (enter * 315 - 225) + 'px 0', opacity: enter * 0.54}}/>
      <div className="opening-desktop" style={{
        opacity: enter,
        transform: 'perspective(1460px) translate3d(' + (146 - 146 * enter) + 'px,' + (100 - 100 * enter) +
          'px,0) rotateY(' + angle + 'deg) rotateX(' + (12 - 8 * enter) + 'deg) rotateZ(' + (-4 + 2 * enter) + 'deg)',
      }}>
        <Dashboard/>
        <div className="rim-light"/>
      </div>
      <Headline label="Gestão de almoxarifado" lines={['Almox', 'ERP']} body="Do estoque à operação." size={142} still={still} style={{top: 242, maxWidth: 515}}/>
      <Rise at={1.25} still={still} style={{position: 'absolute', left: 1042, top: 795, zIndex: 14, translate: '0 ' + (-progress * 11) + 'px'}}>
        <div className="surface opening-float"><Item name="Escanear QR Code" meta="Localização de materiais" icon="scan"/><Action variant="quiet"><ScanLine size={21}/></Action></div>
      </Rise>
      <Demo/>
    </Stage>
  );
};

export const Thumbnail = () => <Opening seconds={5} still/>;
