import type {CSSProperties} from 'react';
import {
  ArrowDown, ArrowRight, Bell, Boxes, Check, ChevronRight, ClipboardCheck, Clock3, FileSpreadsheet,
  ListChecks, Package, PackageCheck, QrCode, RefreshCw, Search, TriangleAlert,
} from 'lucide-react';
import {Action, DataTable, Desktop, Item, Pill, SearchBox, Stat} from './design';

export const demoMaterial = 'Rolamento 6205';
export const demoLocation = 'Corredor A · Prateleira 03';
export const demoOrder = 'OS-DEMO-024';

export const Dashboard = ({style}: {style?: CSSProperties}) => (
  <Desktop active="Visão geral" title="Seu almoxarifado, hoje" subtitle="Acompanhe materiais e operações da unidade." style={style}>
    <div className="stats">
      <Stat label="Produtos" value="24" note="Materiais cadastrados"/>
      <Stat label="Localizações" value="8" note="Locais ativos"/>
      <Stat label="Pendências" value="3" note="Na unidade atual" tone="amber"/>
    </div>
    <div className="dashboard-banner">
      <div className="dashboard-banner-icon"><Search size={32}/></div>
      <div><b>Encontre um material</b><small>Busque por descrição, código ou localização.</small></div>
      <Action variant="quiet">Consultar <ArrowRight size={16}/></Action>
    </div>
    <div className="dashboard-shortcuts">
      <div className="card"><QrCode size={23}/><b>Escanear QR Code</b><ChevronRight size={16}/></div>
      <div className="card"><PackageCheck size={23}/><b>Recebimentos</b><ChevronRight size={16}/></div>
      <div className="card"><ListChecks size={23}/><b>Pendências</b><ChevronRight size={16}/></div>
    </div>
    <div className="card" style={{marginTop: 15}}>
      <h3>Atividade recente</h3>
      <div className="activity"><Package size={17}/><span>Entrega registrada · {demoOrder}</span><small>Hoje</small></div>
      <div className="activity"><ClipboardCheck size={17}/><span>Contagem enviada para revisão</span><small>Hoje</small></div>
    </div>
  </Desktop>
);

export const Products = ({query, typing, found, style}: {
  query: string; typing: boolean; found: boolean; style?: CSSProperties;
}) => (
  <Desktop active="Produtos" title="Produtos" subtitle="Consulte materiais cadastrados e seus saldos." style={style}>
    <SearchBox text={query || 'Buscar por produto ou código'} active={typing || found} caret={typing}/>
    <div style={{marginTop: 20}}>
      <DataTable
        headers={['Produto', 'Código', 'Localização', 'Disponível']}
        widths="1.37fr .75fr 1.25fr .6fr"
        rows={[
          [demoMaterial, 'MAT-042', 'A-03-02', <Pill tone="green">16 un.</Pill>],
          ...(!found ? [
            ['Correia em V A42', 'MAT-081', 'B-01-01', '4 un.'],
            ['Filtro hidráulico', 'MAT-117', 'B-02-01', '8 un.'],
            ['Retentor 35 mm', 'MAT-072', 'C-01-01', '12 un.'],
          ] : []),
        ]}
      />
    </div>
  </Desktop>
);

export const Replenishment = ({style}: {style?: CSSProperties}) => (
  <Desktop active="Reposição" title="Reposição de materiais" subtitle="Revise as sugestões antes de preparar a compra." style={style}>
    <div className="dashboard-banner stock-banner">
      <div className="dashboard-banner-icon"><Boxes size={28}/></div>
      <div><b>1 material com compra sugerida</b><small>Compare o saldo disponível com o estoque mínimo.</small></div>
      <Pill tone="amber">Estoque baixo</Pill>
    </div>
    <DataTable headers={['Material', 'Disponível', 'Mínimo', 'Sugestão']} widths="1.45fr .8fr .7fr .8fr"
      rows={[
        ['Correia em V A42', '4 un.', '10 un.', <Pill tone="amber">Comprar 6 un.</Pill>],
        [demoMaterial, '16 un.', '12 un.', '—'],
        ['Filtro hidráulico', '8 un.', '6 un.', '—'],
      ]}
    />
  </Desktop>
);

export const Receipts = ({confirmed, refresh, style}: {
  confirmed: boolean; refresh: number; style?: CSSProperties;
}) => (
  <Desktop active="Recebimentos" title="Recebimentos de materiais" subtitle="Acompanhe o retorno de cada entrega registrada." style={style}
    topAction={<Action variant="quiet"><RefreshCw size={17} style={{rotate: refresh * 330 + 'deg'}}/> Atualizar</Action>}>
    <div className="tabline"><span>Acompanhar unidade</span><span>Para mim</span></div>
    <div className="stats" style={{marginBottom: 16}}>
      <Stat label="Aguardando confirmação" value={confirmed ? '0' : '1'} tone={confirmed ? 'neutral' : 'amber'}/>
      <Stat label="Recebimentos confirmados" value={confirmed ? '1' : '0'} tone="green"/>
    </div>
    <div className="card" style={{borderColor: confirmed ? '#426853' : '#4f424c'}}>
      <div className="flex-between" style={{gap: 12}}>
        <Item name={demoMaterial} meta={demoOrder + ' · 4 unidades · Local A-03-02'}/>
        <Pill tone={confirmed ? 'green' : 'amber'}>{confirmed ? 'Recebimento confirmado' : 'Aguardando confirmação'}</Pill>
      </div>
      <div className="divider"/>
      <div className="activity">
        {confirmed ? <Check size={19} color="#82deb3"/> : <Clock3 size={19} color="#f2bf7c"/>}
        <span>{confirmed ? 'Confirmação registrada pela conta destinatária' : 'Entrega registrada · confirmação pela conta do ERP'}</span>
      </div>
    </div>
  </Desktop>
);

export const Alerts = ({read, style}: {read: boolean; style?: CSSProperties}) => (
  <Desktop active="Alertas" title="Central de alertas" subtitle="Acompanhe prazos e situações da operação." style={style}>
    <div className="stats" style={{marginBottom: 15}}>
      <Stat label="Alertas na unidade" value="3"/>
      <Stat label="Não lidos" value={read ? '2' : '3'} tone="amber"/>
      <Stat label="Vencidos" value="1" tone="red"/>
    </div>
    <div className="tabline"><span>Em aberto</span><span>Todos</span><span>Leituras</span></div>
    <DataTable headers={['Alerta', 'Responsável', 'Prazo']} widths="1.35fr 1fr .72fr"
      rows={[
        [<Item name="Conferir localização A-03" meta="Inventário" icon="map"/>, 'Equipe de inventário', <Pill tone="red">Vencido</Pill>],
        [<Item name="Confirmar devolução" meta="Pendência operacional"/>, 'Equipe de almoxarifado', <Pill tone="amber">Hoje</Pill>],
        [<Item name="Revisar pedido de compra" meta="Reposição"/>, 'Equipe de compras', <Pill tone="blue">Nesta semana</Pill>],
      ]}
    />
  </Desktop>
);

export const Management = ({style}: {style?: CSSProperties}) => (
  <Desktop active="Gerencial" title="Visão da operação" subtitle="Compare as unidades autorizadas e acompanhe as filas." style={style}>
    <div className="tabline"><span>Todas as unidades</span><span>Posições diárias</span></div>
    <DataTable headers={['Fila operacional', 'Unidade A', 'Unidade B']} widths="1.55fr 1fr 1fr"
      rows={[
        ['Recebimentos pendentes', '2', '1'],
        ['Pendências vencidas', <Pill tone="amber">1</Pill>, '0'],
        ['Inventários em revisão', '1', '2'],
        ['Alertas em aberto', '3', '2'],
      ]}
    />
    <div className="card" style={{marginTop: 14}}>
      <div className="activity"><Clock3 size={20}/><span>Espera mais antiga conhecida</span><small>Por unidade</small></div>
    </div>
  </Desktop>
);

export const CsvTable = ({style}: {style?: CSSProperties}) => (
  <Desktop active="Conciliação ERP" title="Conferência de estoque" subtitle="Revise o arquivo importado e as diferenças encontradas." style={style}>
    <div className="tabline"><span>Conferência</span><span>Mapeamento</span><span>Histórico</span></div>
    <div className="card flex-between" style={{marginBottom: 15}}>
      <div className="activity"><FileSpreadsheet size={23} color="#8adcb3"/><span>estoque_demo.csv</span></div>
      <Pill tone="blue">Prévia da conferência</Pill>
    </div>
    <DataTable headers={['Material', 'Almox ERP', 'CSV', 'Situação']} widths="1.55fr .75fr .65fr .94fr"
      rows={[
        [demoMaterial, '16', '16', <Pill tone="green">Correspondente</Pill>],
        ['Correia em V A42', '4', '6', <Pill tone="amber">Divergência</Pill>],
        ['Filtro hidráulico', '8', '8', <Pill tone="green">Correspondente</Pill>],
      ]}
    />
  </Desktop>
);

export const AlertDetail = ({read}: {read: boolean}) => (
  <div className="surface alert-detail">
    <div className="card-kicker"><Bell size={18}/> Detalhe do alerta</div>
    <Pill tone="red">Prazo vencido</Pill>
    <h3>Conferir localização A-03</h3>
    <p>Equipe de inventário · Unidade A</p>
    <div className="divider"/>
    <div className="flex-between">
      <span className="micro-label">Situação em aberto</span>
      <Action variant={read ? 'quiet' : 'red'}>{read ? <><Check size={17}/> Lido</> : 'Marcar como lido'}</Action>
    </div>
  </div>
);

export const InventoryMetrics = () => (
  <div className="stats">
    <Stat label="Saldo registrado" value="120" note="unidades"/>
    <Stat label="Quantidade contada" value="118" note="unidades" tone="blue"/>
    <Stat label="Diferença" value={<><ArrowDown size={26}/> 2</>} note="unidades" tone="amber"/>
  </div>
);

export const ReviewNotice = () => (
  <div className="review-notice"><TriangleAlert size={23}/> A revisão deve ser feita por outra pessoa autorizada.</div>
);
