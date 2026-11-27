import {Audio} from '@remotion/media';
import {AbsoluteFill, Series, staticFile, useVideoConfig} from 'remotion';
import {color} from './design';
import {Opening} from './scenes/Opening';
import {ProductSearch} from './scenes/Products';
import {QrScan} from './scenes/QR';
import {Assistant} from './scenes/Assistant';
import {Inventory, Restock, StockLaunch} from './scenes/Stock';
import {Delivery} from './scenes/Delivery';
import {AlertCenter, Csv, OperationsLaunch, Shift, UnitView} from './scenes/Operations';
import {Closing} from './scenes/Closing';

export const Full = ({sound = true}: {sound?: boolean}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: color.background}}>
      <Series>
        <Series.Sequence name="Abertura" durationInFrames={5 * fps} premountFor={fps}><Opening seconds={5}/></Series.Sequence>
        <Series.Sequence name="Consulta de materiais" durationInFrames={6 * fps} premountFor={fps}><ProductSearch seconds={6}/></Series.Sequence>
        <Series.Sequence name="Leitura de QR Code" durationInFrames={8 * fps} premountFor={fps}><QrScan seconds={8}/></Series.Sequence>
        <Series.Sequence name="Assistente" durationInFrames={10 * fps} premountFor={fps}><Assistant seconds={10}/></Series.Sequence>
        <Series.Sequence name="Reposição" durationInFrames={6 * fps} premountFor={fps}><Restock seconds={6}/></Series.Sequence>
        <Series.Sequence name="Inventário" durationInFrames={6 * fps} premountFor={fps}><Inventory seconds={6}/></Series.Sequence>
        <Series.Sequence name="Entrega e recebimento" durationInFrames={7 * fps} premountFor={fps}><Delivery seconds={7}/></Series.Sequence>
        <Series.Sequence name="Passagem de turno" durationInFrames={6 * fps} premountFor={fps}><Shift seconds={6}/></Series.Sequence>
        <Series.Sequence name="Conferência CSV" durationInFrames={7 * fps} premountFor={fps}><Csv seconds={7}/></Series.Sequence>
        <Series.Sequence name="Alertas" durationInFrames={6 * fps} premountFor={fps}><AlertCenter seconds={6}/></Series.Sequence>
        <Series.Sequence name="Visão gerencial" durationInFrames={6 * fps} premountFor={fps}><UnitView seconds={6}/></Series.Sequence>
        <Series.Sequence name="Encerramento" durationInFrames={5 * fps} premountFor={fps}><Closing seconds={5}/></Series.Sequence>
      </Series>
      {sound && <Audio src={staticFile('audio/full.m4a')} name="Trilha e efeitos" premountFor={fps}/>}
    </AbsoluteFill>
  );
};

export const Launch = ({sound = true}: {sound?: boolean}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: color.background}}>
      <Series>
        <Series.Sequence name="Abertura" durationInFrames={3 * fps} premountFor={fps}><Opening seconds={3}/></Series.Sequence>
        <Series.Sequence name="Consulta de materiais" durationInFrames={4 * fps} premountFor={fps}><ProductSearch seconds={4}/></Series.Sequence>
        <Series.Sequence name="Leitura de QR Code" durationInFrames={3 * fps} premountFor={fps}><QrScan seconds={3}/></Series.Sequence>
        <Series.Sequence name="Assistente" durationInFrames={4 * fps} premountFor={fps}><Assistant seconds={4}/></Series.Sequence>
        <Series.Sequence name="Reposição e inventário" durationInFrames={4 * fps} premountFor={fps}><StockLaunch seconds={4}/></Series.Sequence>
        <Series.Sequence name="Entrega e recebimento" durationInFrames={7 * fps} premountFor={fps}><Delivery seconds={7} compact/></Series.Sequence>
        <Series.Sequence name="Alertas e gerencial" durationInFrames={4 * fps} premountFor={fps}><OperationsLaunch seconds={4}/></Series.Sequence>
        <Series.Sequence name="Dispositivos e encerramento" durationInFrames={6 * fps} premountFor={fps}><Closing seconds={6} devices/></Series.Sequence>
      </Series>
      {sound && <Audio src={staticFile('audio/launch.m4a')} name="Trilha e efeitos" premountFor={fps}/>}
    </AbsoluteFill>
  );
};
