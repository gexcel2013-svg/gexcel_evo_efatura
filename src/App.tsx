import { useState, useEffect, useMemo } from 'react';
import { Building2, ChevronDown, Check, Plus, Download, HardDrive } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import CommandCenter from './components/CommandCenter';
import { RecibosVerdesView } from './components/RecibosVerdesView';
import { InconformidadesView } from './components/InconformidadesView';
import { FaturasView, type FiltroInicialDados } from './components/FaturasView';
import { DevView } from './components/DevView';
import { AgendadorView } from './components/AgendadorView';
import { ConfigView } from './components/ConfigView';
import { LoginModal } from './components/LoginModal';
import { SetupWizardModal } from './components/SetupWizardModal';
import { AuthProvider, useAuth } from './lib/auth';
import { EvoLoginGate, type AuthenticatedEvoUser } from './components/EvoLoginGate';

function AppContent() {
  const { currentUser, appConfig, refreshConfig, showLoginModal, showSetupWizard, setShowLoginModal, setExternalSession } = useAuth();
  const [dropdownCentroAberto, setDropdownCentroAberto] = useState<boolean>(false);
  const [trocandoCentro, setTrocandoCentro] = useState<boolean>(false);
  const [centroKey, setCentroKey] = useState<number>(0);

  const centrosDisponiveis = useMemo(() => {
    const todos = appConfig?.centros_dados || [];
    const perms = currentUser?.centros_permitidos || ['*'];
    if (perms.includes('*') || currentUser?.role === 'admin' || currentUser?.role === 'superadmin') {
      return todos;
    }
    const filtrados = todos.filter(c => perms.includes(c.id));
    return filtrados.length > 0 ? filtrados : todos;
  }, [appConfig?.centros_dados, currentUser]);

  const centroAtivo = useMemo(() => {
    return centrosDisponiveis.find(c => c.selecionado) || centrosDisponiveis[0] || {
      id: appConfig?.centro_dados_ativo_id || 'escritorio-principal',
      nome: appConfig?.centro_dados_nome || 'Escritório Principal',
      hostname: appConfig?.centro_dados_hostname || 'SERVIDOR-ESCRITORIO',
      pasta_evogex: appConfig?.centro_dados_pasta_evogex || 'C:\\Dados_evoGex',
      pasta_gexcel_antiga: appConfig?.centro_dados_pasta_gexcel_antiga || '',
      ativo: true,
      selecionado: true,
    };
  }, [centrosDisponiveis, appConfig]);

  const handleSelecionarCentro = async (centroId: string) => {
    setDropdownCentroAberto(false);
    if (centroId === centroAtivo.id) return;
    setTrocandoCentro(true);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/centros-dados/selecionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centro_id: centroId }),
      });
      if (res.ok) {
        await refreshConfig();
        setCentroKey(prev => prev + 1);
      }
    } catch {} finally {
      setTrocandoCentro(false);
    }
  };

  const handleDescarregarInstaladorCentro = (nome?: string, pastaEvogex?: string, pastaAntiga?: string) => {
    const n = encodeURIComponent(nome || centroAtivo.nome || 'Escritório Principal');
    const pEvo = encodeURIComponent(pastaEvogex || centroAtivo.pasta_evogex || 'C:\\Dados_evoGex');
    const pAnt = encodeURIComponent(pastaAntiga ?? centroAtivo.pasta_gexcel_antiga ?? '');
    window.open(`/api/sistema/instalador-centro-dados?nome=${n}&pasta_evogex=${pEvo}&pasta_gexcel_antiga=${pAnt}`, '_blank');
  };
  const [authUser, setAuthUser] = useState<AuthenticatedEvoUser | null>(() => {
    try {
      const saved = sessionStorage.getItem('gexcel_evo06_auth_session');
      return saved ? (JSON.parse(saved) as AuthenticatedEvoUser) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!currentUser && !sessionStorage.getItem('gexcel_evo06_auth_session') && authUser) {
      setAuthUser(null);
    }
  }, [currentUser, authUser]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Dark como padrão de fábrica
  });

  const [activeTab, setActiveTab] = useState<string>('matriz');
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [versaoMotor, setVersaoMotor] = useState<string>('');

  // Ano Fiscal ativo na sessão: inicia sempre no ano civil atual ao abrir a app,
  // mas preserva-se inalterado em memória durante a navegação entre separadores.
  const anoAtual = new Date().getFullYear();
  const [anoGlobal, setAnoGlobal] = useState<number>(anoAtual);

  // Verificação contínua do motor API (:8015) e da sua versão oficial
  useEffect(() => {
    const verificarMotor = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8015/", { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json();
          if (data.assinatura && data.assinatura.includes("API Importador e-Fatura Gexcel")) {
            setApiOnline(true);
            if (data.versao) setVersaoMotor(data.versao);
            return;
          }
        }
        setApiOnline(false);
      } catch {
        setApiOnline(false);
      }
    };
    verificarMotor();
    const interval = setInterval(verificarMotor, 8000);
    return () => clearInterval(interval);
  }, []);

  // Navegação contextual direta da Matriz/Importador para o separador Dados
  const [faturasFiltroInicial, setFaturasFiltroInicial] = useState<FiltroInicialDados | null>(null);

  const handleNavegarParaDados = (nif: string, ano: number, mes?: number, tipo: 'compras' | 'vendas' = 'compras') => {
    setFaturasFiltroInicial({ nif, ano, mes, tipo });
    setActiveTab('faturas');
  };

  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = localStorage.getItem('gexcel_zoom_level');
    return saved ? Math.min(Math.max(parseFloat(saved), 0.8), 1.3) : 1.0;
  });

  useEffect(() => {
    (document.body.style as unknown as { zoom: string }).zoom = String(zoomLevel);
    localStorage.setItem('gexcel_zoom_level', zoomLevel.toFixed(2));
  }, [zoomLevel]);

  const handleZoomIn = () => setZoomLevel(prev => Math.min(Number((prev + 0.05).toFixed(2)), 1.30));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(Number((prev - 0.05).toFixed(2)), 0.80));
  const handleResetZoom = () => setZoomLevel(1.0);

  // Memorização e restauro de posição e tamanho de janela (gexcel-desktop-ui)
  useEffect(() => {
    const saveWindowBounds = async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const appWindow = getCurrentWindow();
          const pos = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          localStorage.setItem('gexcel_window_bounds', JSON.stringify({
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
          }));
        } else {
          localStorage.setItem('gexcel_window_bounds', JSON.stringify({
            x: window.screenX,
            y: window.screenY,
            width: window.outerWidth,
            height: window.outerHeight,
          }));
        }
      } catch {}
    };

    const restoreWindowBounds = async () => {
      try {
        const saved = localStorage.getItem('gexcel_window_bounds');
        if (!saved) return;
        const { x, y, width, height } = JSON.parse(saved);
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          const { getCurrentWindow, PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/window');
          const appWindow = getCurrentWindow();
          if (width && height && width >= 800 && height >= 600) {
            await appWindow.setSize(new PhysicalSize(width, height));
          }
          if (x !== undefined && y !== undefined && x >= 0 && y >= 0) {
            await appWindow.setPosition(new PhysicalPosition(x, y));
          }
        }
      } catch {}
    };

    restoreWindowBounds();
    window.addEventListener('beforeunload', saveWindowBounds);
    return () => window.removeEventListener('beforeunload', saveWindowBounds);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Modo Demonstração / Privacidade (Ofuscação com quadradinhos ■)
  const [modoPrivacidade, setModoPrivacidade] = useState<boolean>(() => {
    return localStorage.getItem('gexcel_modo_privacidade') === 'true';
  });

  const toggleModoPrivacidade = () => {
    setModoPrivacidade(prev => !prev);
  };

  useEffect(() => {
    localStorage.setItem('gexcel_modo_privacidade', String(modoPrivacidade));
  }, [modoPrivacidade]);

  // Atalho de Teclado Global: Ctrl + Shift + P para ligar/desligar privacidade
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setModoPrivacidade(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!authUser && !currentUser) {
    return (
      <EvoLoginGate
        appCodigo="EVO-06"
        appTitle="Importador e-Fatura & Motor V4"
        appSubtitle="Autenticação obrigatória de acesso ao sistema"
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(u) => {
          sessionStorage.setItem('gexcel_evo06_auth_session', JSON.stringify(u));
          const mappedUser = {
            id: 1,
            username: u.username,
            nome: u.nome,
            email: u.email || '',
            role: (u.role === 'DEV' || u.role === 'superadmin' ? 'superadmin' : u.role === 'ADMIN' || u.role === 'admin' ? 'admin' : 'subutilizador') as 'superadmin' | 'admin' | 'subutilizador',
            ativo: true,
            is_system: u.role === 'DEV' || u.role === 'superadmin',
            created_at: new Date().toISOString(),
          };
          setExternalSession(mappedUser, u.token);
          setAuthUser(u);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-row font-sans overflow-hidden select-none relative">
      {/* Camada de Fundo Grelha Excel Subtil (Evo Grid) - z-0 atrás de todo o conteúdo */}
      <div className="workspace-ledger absolute inset-0 pointer-events-none z-0" />

      {/* Menu Lateral Esquerdo Canónico evoGex.com (z-20) */}
      <div className="relative z-20 flex">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          selectedCount={selectedCount}
          totalCount={totalCount}
          theme={theme}
          onToggleTheme={toggleTheme}
          apiOnline={apiOnline}
          versaoMotor={versaoMotor}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          modoPrivacidade={modoPrivacidade}
          onToggleModoPrivacidade={toggleModoPrivacidade}
        />
      </div>

      {/* Área Principal de Trabalho Delimitada (z-10) */}
      <main
        className="flex-1 flex flex-col p-3.5 min-h-0 overflow-hidden relative z-10"
        onClick={() => dropdownCentroAberto && setDropdownCentroAberto(false)}
      >
        {/* Barra Universal de Identificação e Troca Rápida de Centro de Dados (Transversal a todas as vistas) */}
        <div className="mb-2.5 px-3 py-1.5 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setDropdownCentroAberto(prev => !prev)}
                disabled={trocandoCentro}
                className="flex items-center space-x-2 px-2.5 py-1 rounded bg-sky-50 dark:bg-[#0a1929] hover:bg-sky-100 dark:hover:bg-[#11263d] border border-[#0284c7] text-xs font-mono text-foreground cursor-pointer transition"
                title="Clique para trocar de Centro de Dados (ex: Escritório da Maia, Porto, Empresas PHC / Sage)"
              >
                <Building2 className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <span className="text-slate-700 dark:text-slate-300">Centro de Dados:</span>
                <strong className="text-[#0284c7] dark:text-sky-300 font-bold">
                  {centroAtivo.nome}
                </strong>
                <ChevronDown className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
              </button>

              {dropdownCentroAberto && (
                <div className="absolute left-0 mt-1.5 w-88 bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md shadow-xl p-2 z-50 font-mono text-xs space-y-1.5">
                  <div className="px-2 py-1 border-b border-slate-200 dark:border-[#222f3e] flex items-center justify-between">
                    <span className="font-bold text-[10.5px] uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Selecionar Centro de Dados
                    </span>
                    <span className="text-[10px] text-[#0284c7] dark:text-sky-400 font-semibold">
                      {centrosDisponiveis.length} disponível(eis)
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {centrosDisponiveis.map(c => {
                      const isSel = c.id === centroAtivo.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelecionarCentro(c.id)}
                          className={`w-full text-left px-2.5 py-2 rounded border transition cursor-pointer flex items-start justify-between gap-2 ${
                            isSel
                              ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] text-foreground'
                              : 'bg-slate-50 dark:bg-[#132233] hover:bg-slate-100 dark:hover:bg-[#1c314a] border-slate-200 dark:border-[#222f3e] text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-bold text-xs text-foreground truncate">
                              {c.nome}
                            </div>
                            <div className="text-[10px] text-slate-700 dark:text-slate-300 break-all">
                              Dados evoGex: {c.pasta_evogex || 'C:\\Dados_evoGex'}
                            </div>
                            {c.pasta_gexcel_antiga && (
                              <div className="text-[10px] text-slate-600 dark:text-slate-400 break-all">
                                Dados Antigos: {c.pasta_gexcel_antiga}
                              </div>
                            )}
                          </div>
                          {isSel && (
                            <Check className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1 border-t border-slate-200 dark:border-[#222f3e] flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDropdownCentroAberto(false);
                        setActiveTab('config');
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-semibold text-[11px] flex items-center justify-center space-x-1 cursor-pointer transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo / Gerir Centros</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDropdownCentroAberto(false);
                        handleDescarregarInstaladorCentro();
                      }}
                      className="px-2.5 py-1.5 rounded bg-emerald-50 dark:bg-[#091e1a] hover:bg-emerald-100 dark:hover:bg-[#0e2d27] border border-emerald-400 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-semibold text-[11px] flex items-center space-x-1 cursor-pointer transition"
                      title="Descarregar instalador único (Centro de Dados + Motor) para um computador novo ou servidor"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Instalador PC Novo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden lg:flex items-center space-x-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
              <HardDrive className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="truncate" title={centroAtivo.pasta_evogex}>
                Pasta Unificada (Motor + SafeDrive + Bases): <strong className="text-foreground">{centroAtivo.pasta_evogex || 'C:\\Dados_evoGex'}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => handleDescarregarInstaladorCentro()}
              className="px-2.5 py-1 rounded bg-emerald-50 dark:bg-[#091e1a] hover:bg-emerald-100 dark:hover:bg-[#0e2d27] border border-emerald-400 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-semibold flex items-center space-x-1.5 cursor-pointer transition"
              title="Instalar a pasta Dados evoGex com Motor, SafeDrive, PocketBase e Bases SQLite num computador novo ou servidor"
            >
              <Download className="w-3 h-3 shrink-0" />
              <span>Instalar Centro + Motor</span>
            </button>
          </div>
        </div>

        <div key={centroKey} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {activeTab === 'recibos' ? (
            <RecibosVerdesView
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
            />
          ) : activeTab === 'anulados' ? (
            <InconformidadesView
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
            />
          ) : activeTab === 'faturas' ? (
            <FaturasView 
              onApiStatusChange={setApiOnline} 
              modoPrivacidade={modoPrivacidade}
              filtroInicial={faturasFiltroInicial}
            />
          ) : activeTab === 'agendador' ? (
            <AgendadorView 
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
            />
          ) : activeTab === 'config' ? (
            <ConfigView />
          ) : activeTab === 'dev' ? (
            <DevView 
              onApiStatusChange={setApiOnline}
              versaoMotor={versaoMotor}
            />
          ) : (
            <CommandCenter 
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onSelectionChange={(selected, total) => {
                setSelectedCount(selected);
                setTotalCount(total);
              }}
              onApiStatusChange={(online, versao) => {
                setApiOnline(online);
                if (versao) setVersaoMotor(versao);
              }}
              modoPrivacidade={modoPrivacidade}
              onNavegarParaDados={handleNavegarParaDados}
            />
          )}
        </div>
      </main>

      {/* Modais Globais de Autenticação e Configuração Inicial */}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
      {showSetupWizard && <SetupWizardModal />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
