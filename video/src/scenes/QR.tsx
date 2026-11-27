import {Img, staticFile} from 'remotion';
import {ArrowRight, Check, LocateFixed, QrCode, ScanLine} from 'lucide-react';
import {Action, Demo, Headline, Item, Phone, Pill, Stage, linear, ramp, useShot} from '../design';
import {demoLocation, demoMaterial} from '../screens';

export const QrScan = ({seconds = 8}: {seconds?: number}) => {
  const {frame, fps, progress} = useShot(seconds);
  const enter = ramp(frame, 0.02 * fps, 0.93 * fps);
  const scanned = ramp(frame, seconds * 0.48 * fps, seconds * 0.69 * fps);
  const scanLine = linear(frame, seconds * 0.22 * fps, seconds * 0.47 * fps);
  return (
    <Stage seconds={seconds} mood="center">
      <Headline label="Leitor QR Code" lines={['Escaneie.', 'Localize.']} body="Abra a localização e veja os materiais cadastrados ali." style={{top: 308}}/>
      <div className="qr-floor" style={{opacity: enter}}/>
      <div className="qr-plate" style={{
        opacity: enter * (1 - 0.60 * scanned),
        transform: 'translate(' + ((1 - enter) * 95) + 'px,' + (scanned * 46) + 'px) rotate(-9deg) scale(' + (1 - 0.06 * scanned) + ')',
      }}>
        <Img src={staticFile('brand/qr-demo.png')} style={{width: 135, height: 135, borderRadius: 7}}/>
        <div><QrCode size={22}/><b>A-03-02</b><small>Etiqueta de localização</small></div>
      </div>
      <div style={{position: 'absolute', left: 980 - scanned * 95, top: 193,
        transform: 'perspective(1450px) translateX(' + ((1 - enter) * 200) + 'px) rotateY(' + (-15 + enter * 8 + scanned * 4) +
          'deg) rotateZ(' + (-8 + scanned * 8) + 'deg) scale(' + (1.01 + progress * 0.04) + ')', opacity: enter}}>
        <Phone title={scanned > 0.75 ? 'Localizações' : 'Leitor QR Code'}>
          <div className="qr-mobile-view" style={{opacity: 1 - scanned}}>
            <p>Enquadre a etiqueta no leitor.</p>
            <div className="qr-viewport">
              <i/><i/><i/><i/>
              <Img src={staticFile('brand/qr-demo.png')} style={{width: 185, height: 185, borderRadius: 8}}/>
              <span className="scanline" style={{top: 36 + 168 * scanLine, opacity: scanLine > 0 && scanLine < 1 ? 1 : 0}}/>
            </div>
            <Action variant="quiet"><ScanLine size={17}/> Inserir código manualmente</Action>
          </div>
          <div className="qr-mobile-result" style={{opacity: scanned, translate: '0 ' + ((1 - scanned) * 20) + 'px'}}>
            <Pill tone="green"><Check size={14}/> Localização encontrada</Pill>
            <h3>A-03-02</h3><p>{demoLocation}</p>
            <div className="divider"/>
            <Item name={demoMaterial} meta="16 unidades disponíveis"/>
          </div>
        </Phone>
      </div>
      <div className="surface qr-result" style={{opacity: scanned, translate: ((1 - scanned) * 75) + 'px 0'}}>
        <div className="card-kicker"><LocateFixed size={22}/> Leitura concluída</div>
        <h3>{demoLocation}</h3>
        <div className="divider"/>
        <div className="flex-between"><Item name={demoMaterial} meta="MAT-042" icon="map"/><ArrowRight size={25}/></div>
      </div>
      <Demo/>
    </Stage>
  );
};
