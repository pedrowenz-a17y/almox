import {Composition, Folder, Still} from 'remotion';
import {Full, Launch} from './Film';
import {Opening, Thumbnail} from './scenes/Opening';
import {ProductSearch} from './scenes/Products';
import {QrScan} from './scenes/QR';
import {Assistant} from './scenes/Assistant';
import {Inventory, Restock, StockLaunch} from './scenes/Stock';
import {Delivery} from './scenes/Delivery';
import {AlertCenter, Csv, OperationsLaunch, Shift, UnitView} from './scenes/Operations';
import {Closing} from './scenes/Closing';

const fullHD = {width: 1920, height: 1080, fps: 30};

export const Root = () => (
  <>
    <Composition id="AlmoxERP-Full" component={Full} width={1920} height={1080} fps={30} durationInFrames={2340} defaultProps={{sound: true}}/>
    <Composition id="AlmoxERP-Launch" component={Launch} width={1920} height={1080} fps={30} durationInFrames={1050} defaultProps={{sound: true}}/>
    <Still id="AlmoxERP-Thumbnail" component={Thumbnail} width={1920} height={1080}/>
    <Folder name="Cenas">
      <Composition id="Abertura" component={Opening} {...fullHD} durationInFrames={150} defaultProps={{seconds: 5}}/>
      <Composition id="Consulta" component={ProductSearch} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Leitor-QR" component={QrScan} {...fullHD} durationInFrames={240} defaultProps={{seconds: 8}}/>
      <Composition id="Assistente" component={Assistant} {...fullHD} durationInFrames={300} defaultProps={{seconds: 10}}/>
      <Composition id="Reposicao" component={Restock} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Inventario" component={Inventory} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Entrega" component={Delivery} {...fullHD} durationInFrames={210} defaultProps={{seconds: 7}}/>
      <Composition id="Passagem-de-turno" component={Shift} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Conferencia-CSV" component={Csv} {...fullHD} durationInFrames={210} defaultProps={{seconds: 7}}/>
      <Composition id="Alertas" component={AlertCenter} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Visao-gerencial" component={UnitView} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6}}/>
      <Composition id="Encerramento" component={Closing} {...fullHD} durationInFrames={150} defaultProps={{seconds: 5}}/>
    </Folder>
    <Folder name="Montagem-institucional">
      <Composition id="Estoque" component={StockLaunch} {...fullHD} durationInFrames={120} defaultProps={{seconds: 4}}/>
      <Composition id="Operacao" component={OperationsLaunch} {...fullHD} durationInFrames={120} defaultProps={{seconds: 4}}/>
      <Composition id="Encerramento-institucional" component={Closing} {...fullHD} durationInFrames={180} defaultProps={{seconds: 6, devices: true}}/>
    </Folder>
  </>
);
