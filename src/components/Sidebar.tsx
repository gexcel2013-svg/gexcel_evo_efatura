import { useState, useEffect } from 'react';
import { 
  Table2, 
  FileSpreadsheet, 
  FileText,
  ShieldAlert,
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon, 
  ShieldCheck, 
  CheckSquare,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Code2,
  Calendar,
  SlidersHorizontal,
  User,
  LayoutGrid,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getMotorSource, type MotorSourceType } from '../lib/apiBridge';
import { EvoVersionWatchBadge } from './EvoVersionWatchBadge';
import { APP_BUILD, APP_CHANNEL, APP_VERSION } from '../lib/version';

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  selectedCount: number;
  totalCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  apiOnline: boolean | null;
  versaoMotor?: string;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  modoPrivacidade?: boolean;
  onToggleModoPrivacidade?: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  selectedCount,
  totalCount,
  theme,
  onToggleTheme,
  apiOnline,
  versaoMotor,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  modoPrivacidade = false,
  onToggleModoPrivacidade,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('gexcel_sidebar_collapsed') === 'true';
  });
  const [motorSource, setMotorSource] = useState<MotorSourceType>(() => getMotorSource());

  useEffect(() => {
    localStorage.setItem('gexcel_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const onSourceChange = (ev: Event) => {
      const customEv = ev as CustomEvent<MotorSourceType>;
      if (customEv.detail) {
        setMotorSource(customEv.detail);
      } else {
        setMotorSource(getMotorSource());
      }
    };
    window.addEventListener('gexcel-motor-source', onSourceChange);
    return () => window.removeEventListener('gexcel-motor-source', onSourceChange);
  }, []);

  const { currentUser, setShowLoginModal } = useAuth();
  const toggleCollapsed = () => setCollapsed(prev => !prev);

  const painelUrl =
    typeof window !== 'undefined' && window.location.hostname.startsWith('dev.')
      ? 'https://dev.painel.evogex.com'
      : 'https://painel.evogex.com';

  const navItems = [
    {
      id: 'matriz',
      label: 'e-Fatura',
      icon: <Table2 className="w-4 h-4 shrink-0" />,
      badge: `${totalCount}`,
    },
    {
      id: 'recibos',
      label: 'Recibos Verdes e Rendas',
      icon: <FileText className="w-4 h-4 shrink-0" />,
      badge: undefined,
    },
    {
      id: 'anulados',
      label: 'Anulados',
      icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
      badge: undefined,
    },
    {
      id: 'faturas',
      label: 'Dados',
      icon: <FileSpreadsheet className="w-4 h-4 shrink-0" />,
      badge: undefined,
    },
    {
      id: 'agendador',
      label: 'Agendador',
      icon: <Calendar className="w-4 h-4 shrink-0" />,
      badge: undefined,
    },
    {
      id: 'config',
      label: 'Configurações',
      icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
      badge: undefined,
    },
    ...(false ? [{
      id: 'dev',
      label: 'Desenvolvedor',
      icon: <Code2 className="w-4 h-4 shrink-0" />,
      badge: undefined,
    }] : []),
  ];

  const versaoExibida = versaoMotor || '4.2.27';

  return (
    <aside
      className={`h-screen bg-white dark:bg-[#0c1520] text-card-foreground border-r border-border flex flex-col justify-between transition-all duration-300 select-none z-30 shrink-0 ${
        collapsed ? 'w-16' : 'w-[280px]'
      }`}
    >
      {/* 1. Topo: Logótipo e Título da Aplicação */}
      <div className="p-3 border-b border-border/80 bg-white dark:bg-[#0c1520]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-[#ffffff] dark:bg-[#07121c] border border-border flex items-center justify-center p-0.5 shadow-sm shrink-0 overflow-hidden">
              <img
                src="/evogex_simbolo_fundo_branco.png"
                alt="evoGex.com"
                className="w-full h-full object-contain dark:hidden"
              />
              <img
                src="/evogex_simbolo_fundo_dark.png"
                alt="evoGex.com"
                className="w-full h-full object-contain hidden dark:block"
              />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-display font-light text-sm tracking-tight text-foreground truncate">
                  <span className="text-[#0284c7] dark:text-[#38bdf8]">evo</span>Gex<span className="text-[8.5px] font-normal ml-[1px] text-[#0284c7] dark:text-[#38bdf8]">.com</span> · e-Fatura
                </span>
                <span className="text-[9px] font-mono uppercase tracking-widest text-slate-700 dark:text-slate-300">
                  IMPORTADOR · ENGINE V4
                </span>
              </div>
            )}
          </div>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir Menu" : "Recolher Menu"}
            className="p-1 rounded-md text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-100 dark:hover:bg-[#132233] transition-colors shrink-0 cursor-pointer"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Resumo da Seleção de Empresas (100% Opaco) */}
        {!collapsed && (
          <div className="mt-3 p-2.5 rounded-md bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] text-xs shadow-2xs">
            <div className="flex items-center justify-between font-mono text-[10.5px]">
              <span className="text-slate-700 dark:text-slate-300 flex items-center">
                <CheckSquare className="w-3 h-3 mr-1 text-[#0284c7] dark:text-sky-400" />
                Selecionadas
              </span>
              <span className="font-semibold text-[#0284c7] dark:text-sky-400 font-mono tabular-nums">
                {selectedCount} de {totalCount}
              </span>
            </div>
            <div className="mt-1.5 w-full bg-slate-200 dark:bg-[#1b2b3d] h-1 rounded-full overflow-hidden">
              <div 
                className="bg-[#0284c7] dark:bg-sky-500 h-full transition-all duration-300"
                style={{ width: `${totalCount > 0 ? (selectedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Navegação Principal por Separadores Verticais */}
      <nav className="flex-1 px-2.5 py-3 space-y-1.5 overflow-y-auto">
        {navItems.map(item => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center px-3 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? 'bg-[#0284c7] text-white shadow-xs border border-[#0284c7]'
                  : 'bg-slate-50 hover:bg-slate-100 dark:bg-[#13202e] dark:hover:bg-[#1a2c40] text-slate-700 hover:text-foreground dark:text-slate-200 border border-slate-300 dark:border-[#2b415a]'
              } ${collapsed ? 'justify-center px-0' : 'justify-between'}`}
            >
              <div className="flex items-center space-x-2.5 overflow-hidden">
                {item.icon}
                {!collapsed && (
                  <span className="truncate font-sans font-medium text-xs">{item.label}</span>
                )}
              </div>
              {!collapsed && item.badge && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  isActive 
                    ? 'bg-[#0369a1] text-white font-bold border border-sky-300' 
                    : 'bg-white dark:bg-[#1a2c3f] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#304764]'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Atalho Direto para o Painel Central (EVO-00) */}
        <div className="pt-2 border-t border-slate-200 dark:border-[#222f3e]">
          <a
            href={painelUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir Painel Principal evoGex.com"
            className={`w-full flex items-center px-3 py-2 rounded-md text-xs font-semibold transition cursor-pointer bg-slate-100 hover:bg-sky-50 dark:bg-[#132233] dark:hover:bg-[#0a1929] text-slate-700 hover:text-[#0284c7] dark:text-slate-200 dark:hover:text-sky-400 border border-slate-300 dark:border-[#253a52] ${
              collapsed ? 'justify-center px-0' : 'justify-between'
            }`}
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <LayoutGrid className="w-4 h-4 shrink-0 text-[#0284c7] dark:text-sky-400" />
              {!collapsed && (
                <span className="truncate font-sans font-medium text-xs">Painel Principal</span>
              )}
            </div>
            {!collapsed && <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />}
          </a>
        </div>
      </nav>

      {/* 3. Rodapé Integrado (100% Opaco) */}
      <div className="p-3 border-t border-border/80 space-y-2.5 bg-white dark:bg-[#0c1520]">
        
        {/* Operador / Sessão Ativa */}
        <div 
          onClick={() => setShowLoginModal(true)}
          title={currentUser ? `Operador: ${currentUser.nome} · Clique para alternar` : "Clique para iniciar sessão"}
          className={`p-1.5 rounded-md bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] flex items-center cursor-pointer hover:border-[#0284c7] transition ${
            collapsed ? 'justify-center' : 'justify-between space-x-2'
          }`}
        >
          <div className="flex items-center space-x-2 overflow-hidden">
            <div className="w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold text-[10px] shrink-0 bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-400 border border-sky-300 dark:border-sky-800">
              {currentUser ? currentUser.nome.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
            </div>
            {!collapsed && (
              <span className="text-[11px] font-mono truncate text-foreground font-medium">
                {currentUser ? currentUser.nome.split(' ')[0] : 'Entrar'}
              </span>
            )}
          </div>
          {!collapsed && (
            <span className="text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded font-bold text-[#0284c7] dark:text-sky-300 bg-sky-100 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-800">
              {currentUser ? (currentUser.role === 'subutilizador' ? 'OPERADOR' : 'ADMIN') : 'LOGIN'}
            </span>
          )}
        </div>

        {/* Estado da Conexão e Origem do Motor (Local vs Cloud) */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} text-xs font-mono`}>
          <div className="flex items-center space-x-1.5" title="Licenciamento Gexcel Auth Ativo">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            {!collapsed && (
              <span className="text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Auth Ativo
              </span>
            )}
          </div>
          {!collapsed && (
            <div
              className="flex items-center space-x-1.5"
              title={
                apiOnline
                  ? motorSource === 'local'
                    ? `Motor Local do Gabinete Ativo (127.0.0.1:8015 · v${versaoExibida})`
                    : `Motor Cloud Hetzner Ativo (v${versaoExibida})`
                  : 'Motor Offline'
              }
            >
              <div className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] text-slate-700 dark:text-slate-300 font-mono">
                {apiOnline ? 'Centro Dados OK' : 'Centro Desligado'}
              </span>
            </div>
          )}
        </div>

        {/* Controlos de Zoom e Alternador de Tema */}
        <div className={`flex items-center ${collapsed ? 'flex-col space-y-2' : 'justify-between'} pt-1`}>
          {!collapsed ? (
            <div className="flex items-center space-x-1 border border-slate-300 dark:border-[#253a52] rounded-lg p-0.5 bg-slate-50 dark:bg-[#132233] shadow-2xs">
              <button
                onClick={onZoomOut}
                title="Diminuir Zoom (-5%)"
                className="h-6 w-6 rounded flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition-colors cursor-pointer"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <button
                onClick={onResetZoom}
                title="Repor Zoom Padrão (100%)"
                className="px-1 text-[10px] font-mono text-slate-700 dark:text-slate-300 hover:text-foreground tabular-nums cursor-pointer"
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <button
                onClick={onZoomIn}
                title="Aumentar Zoom (+5%)"
                className="h-6 w-6 rounded flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition-colors cursor-pointer"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col space-y-1">
              <button
                onClick={onZoomIn}
                title={`Aumentar Zoom (${Math.round(zoomLevel * 100)}%)`}
                className="h-6 w-6 rounded flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition-colors cursor-pointer"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <button
                onClick={onZoomOut}
                title={`Diminuir Zoom (${Math.round(zoomLevel * 100)}%)`}
                className="h-6 w-6 rounded flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition-colors cursor-pointer"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Botão de Modo Demonstração / Privacidade */}
          <button
            onClick={onToggleModoPrivacidade}
            title={modoPrivacidade 
              ? "Modo Demonstração ATIVO (NIFs e Nomes Ofuscados com ■) · Clique ou prima Ctrl+Shift+P para desativar" 
              : "Ativar Modo Demonstração (Ofuscar NIFs e Nomes com ■) · Ctrl+Shift+P"}
            className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
              modoPrivacidade
                ? 'bg-amber-100 dark:bg-[#241a08] border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                : 'border-slate-300 dark:border-[#253a52] bg-slate-50 dark:bg-[#132233] text-slate-700 dark:text-slate-300 hover:text-foreground'
            }`}
          >
            {modoPrivacidade ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Mudar para Modo Claro (Ardósia)' : 'Mudar para Modo Escuro (Cyber Navy)'}
            className="h-8 w-8 rounded-lg border border-slate-300 dark:border-[#253a52] bg-slate-50 dark:bg-[#132233] flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-foreground transition-colors cursor-pointer shrink-0"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Selo Oficial de Versão e Build no Rodapé c/ Deteção Automática */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-end'} pt-0.5`}>
          {collapsed ? (
            <span
              title={`Versão Oficial ${APP_VERSION} · ${APP_BUILD}`}
              className="text-[9.5px] font-mono text-slate-600 dark:text-slate-400 tracking-wider"
            >
              {APP_VERSION}
            </span>
          ) : (
            <EvoVersionWatchBadge
              currentVersion={APP_VERSION}
              currentBuild={APP_BUILD}
              channel={APP_CHANNEL}
              compact
            />
          )}
        </div>
      </div>
    </aside>
  );
}
