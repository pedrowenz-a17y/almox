import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {
  Archive, Bell, Boxes, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Command,
  FileSpreadsheet, House, LayoutDashboard, ListChecks, MapPin, Package, PackageCheck,
  QrCode, ScanLine, Search, Settings, ShoppingCart, Sparkles, Users,
} from 'lucide-react';
import './film.css';

export const color = {
  background: '#0b0c10',
  text: '#f7f4f2',
  accent: '#ed2c55',
};

export type Tone = 'red' | 'green' | 'amber' | 'blue' | 'neutral';

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const ramp = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {...clamp, easing: ease});

export const linear = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], clamp);

export const useShot = (seconds: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = Math.max(0, Math.min(1, frame / (seconds * fps)));
  return {frame, fps, progress};
};

export const Rise = ({children, at = 0, distance = 24, style, still = false}: {
  children: ReactNode; at?: number; distance?: number; style?: CSSProperties; still?: boolean;
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = still ? 1 : ramp(frame, at * fps, (at + 0.57) * fps);
  return <div style={{opacity: p, translate: `0 ${(1 - p) * distance}px`, ...style}}>{children}</div>;
};

export const Logo = ({size = 52}: {size?: number}) => (
  <div className="logo-tile" style={{width: size, height: Math.round(size * 0.74), borderRadius: Math.round(size * 0.115)}}>
    <Img src={staticFile('brand/uca.png')} style={{width: '83%', height: '88%', objectFit: 'contain'}} />
  </div>
);

export const Brand = () => (
  <div className="brand"><Logo size={47} /><span>Almox ERP</span></div>
);

export const Stage = ({children, seconds, mood = 'right', end = false, brand = true, still = false, style}: {
  children: ReactNode; seconds: number; mood?: 'left' | 'right' | 'center';
  end?: boolean; brand?: boolean; still?: boolean; style?: CSSProperties;
}) => {
  const {frame, fps, progress} = useShot(seconds);
  const fade = still ? 1 : linear(frame, 0, 0.31 * fps);
  const out = end ? 1 : 1 - linear(frame, (seconds - 0.18) * fps, seconds * fps) * 0.59;
  return (
    <AbsoluteFill className={`stage stage-${mood}`} style={{background: color.background, color: color.text, ...style}}>
      <div className="stage-light" style={{translate: `${progress * 38}px 0`}} />
      <div className="stage-horizon" />
      <div className="stage-texture" />
      <div className="stage-content" style={{opacity: fade * out}}>
        {brand && <div className="stage-brand"><Brand /></div>}
        {children}
      </div>
    </AbsoluteFill>
  );
};

export const Headline = ({label, lines, body, style, size = 83, align = 'left', still = false}: {
  label?: string; lines: string[]; body?: string; style?: CSSProperties; size?: number;
  align?: 'left' | 'center'; still?: boolean;
}) => (
  <div className={`headline headline-${align}`} style={style}>
    {label && <Rise at={0.1} still={still}><div className="eyebrow"><span style={{background: color.accent}} />{label}</div></Rise>}
    <h1 style={{fontSize: size}}>
      {lines.map((line, index) => (
        <div className="text-mask" key={line}>
          <Rise at={0.2 + index * 0.08} distance={58} still={still}>{line}</Rise>
        </div>
      ))}
    </h1>
    {body && <Rise at={0.39} still={still}><p>{body}</p></Rise>}
  </div>
);

export const Demo = ({style}: {style?: CSSProperties}) => (
  <div className="demo" style={style}><i /> Dados demonstrativos</div>
);

export const Pill = ({children, tone = 'neutral'}: {children: ReactNode; tone?: Tone}) => (
  <span className={`pill tone-${tone}`}><i />{children}</span>
);

export const Action = ({children, variant = 'red', style}: {
  children: ReactNode; variant?: 'red' | 'quiet' | 'green'; style?: CSSProperties;
}) => <div className={`action action-${variant}`} style={style}>{children}</div>;

const menu = [
  ['Visão geral', LayoutDashboard], ['Produtos', Package], ['Localizações', MapPin],
  ['Leitor QR', QrCode], ['Reposição', ShoppingCart], ['Inventário', Archive],
  ['O.S. / O.P.', ClipboardList], ['Recebimentos', PackageCheck], ['Pendências', ListChecks],
  ['Conciliação ERP', FileSpreadsheet], ['Alertas', Bell], ['Gerencial', Users],
] as const;

export const Desktop = ({active, title, subtitle, children, style, hideMenu = false, topAction}: {
  active: string; title: string; subtitle?: string; children: ReactNode;
  style?: CSSProperties; hideMenu?: boolean; topAction?: ReactNode;
}) => (
  <div className="desktop" style={style}>
    <div className="windowbar">
      <div className="windowdots"><i/><i/><i/></div>
      <div className="windowaddress"><Command size={14}/> Almox ERP</div>
      <div className="windowright"><CircleHelp size={17}/><Bell size={17}/><div className="avatar">D</div></div>
    </div>
    <div className="desktop-main">
      {!hideMenu && <div className="sidebar">
        <div className="sidebar-brand"><Logo size={40}/><div>Almox ERP<small>U.C.A.</small></div></div>
        <div className="unit"><Boxes size={16} /> Unidade A <ChevronDown size={14}/></div>
        <div className="menu">
          {menu.map(([label, Icon]) => <div key={label} className={active === label ? 'selected' : ''}><Icon size={18}/>{label}</div>)}
        </div>
      </div>}
      <div className="desktop-body">
        <div className="breadcrumbs"><House size={13}/> Almox ERP <ChevronRight size={13}/> {active}</div>
        <div className="screen-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{topAction}</div>
        {children}
      </div>
    </div>
  </div>
);

export const Phone = ({children, title, style}: {
  children: ReactNode; title: string; style?: CSSProperties;
}) => (
  <div className="phone" style={style}>
    <div className="phone-screen">
      <div className="phone-island"/>
      <div className="phone-status"><b>09:41</b><span>● ◒ ▰</span></div>
      <div className="phone-bar"><Logo size={34}/><b>Almox ERP</b><Settings size={16}/></div>
      <div className="phone-content"><h2>{title}</h2>{children}</div>
      <div className="phone-home"/>
    </div>
  </div>
);

export const SearchBox = ({text, active = false, caret = false}: {
  text: string; active?: boolean; caret?: boolean;
}) => (
  <div className={`searchbox ${active ? 'search-active' : ''}`}>
    <Search size={22}/><span>{text}{caret && <i className="caret"/>}</span>
  </div>
);

export const DataTable = ({headers, rows, widths}: {
  headers: string[]; rows: ReactNode[][]; widths?: string;
}) => (
  <div className="data-table" style={{'--columns': widths ?? `repeat(${headers.length}, 1fr)`} as CSSProperties}>
    <div className="table-head">{headers.map((header) => <div key={header}>{header}</div>)}</div>
    {rows.map((row, index) => (
      <div className="table-row" key={index}>{row.map((cell, cellIndex) => <div key={cellIndex}>{cell}</div>)}</div>
    ))}
  </div>
);

export const Stat = ({label, value, note, tone = 'neutral'}: {
  label: string; value: ReactNode; note?: string; tone?: Tone;
}) => <div className={`stat tone-${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;

export const Item = ({name, meta, icon = 'package'}: {name: string; meta?: string; icon?: 'package'|'map'|'spark'|'scan'}) => {
  const Icon = {package: Package, map: MapPin, spark: Sparkles, scan: ScanLine}[icon];
  return <div className="item"><div className="item-icon"><Icon size={23}/></div><div><b>{name}</b>{meta && <small>{meta}</small>}</div></div>;
};

export const Cursor = ({x, y, pulse = 0, opacity = 1}: {x: number; y: number; pulse?: number; opacity?: number}) => (
  <div className="cursor" style={{left: x, top: y, opacity}}>
    <div className="cursor-ring" style={{scale: 0.45 + pulse * 1.3, opacity: (1 - pulse) * 0.75}} />
    <svg width="30" height="34" viewBox="0 0 30 34" fill="none"><path d="M3 2L26 20L16 21L12 31L3 2Z" fill="#f7f4f2" stroke="#0b0c10" strokeWidth="2.3" strokeLinejoin="round"/></svg>
  </div>
);
