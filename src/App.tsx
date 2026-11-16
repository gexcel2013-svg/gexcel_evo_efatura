import { useState, useEffect, useMemo } from 'react';
import { Sidebar, MobileBottomNav } from './components/Sidebar';
import { InicioHubView } from './components/InicioHubView';
import CommandCenter from './components/CommandCenter';
import { RecibosVerdesView } from './components/RecibosVerdesView';
import { InconformidadesView } from './components/InconformidadesView';
import { FaturasView, type FiltroInicialDados } from './components/FaturasView';
import { MapasResumoView } from './components/MapasResumoView';
import { DevView } from './components/DevView';
import { AgendadorView } from './components/AgendadorView';
import { ConfigView } from './components/ConfigView';
import { LoginModal } from './components/LoginModal';
import { SetupWizardModal } from './components/SetupWizardModal';
import { AuthProvider, useAuth, EVO_SESSION_KEY } from './lib/auth';
import { EvoLoginGate } from './components/EvoLoginGate';
import type { CentroDadosItem } from './types/auth';
import {
  obterLocalFsCentroConfig,
  obterLocalFsTodosCentrosMap,
  selecionarLocalFsCentroAtivo,
  sugerirPastaEvogexPorEscritorio,
} from './lib/localFsBridge';

function AppContent() {
  const {
    currentUser,
    token,
    loading,
    appConfig,
    licensedOffices,
    refreshConfig,
    showLoginModal,
    showSetupWizard,
    setShowLoginModal,
    setExternalSession,
  } = useAuth();
  const [centroKey, setCentroKey] = useState<number>(0);
  const [localFsRev, setLocalFsRev] = useState<number>(0);

  useEffect(() => {
    const onFsUpdated = () => setLocalFsRev(prev => prev + 1);
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  const centrosDisponiveis = useMemo<CentroDadosItem[]>(() => {
    const localMap = obterLocalFsTodosCentrosMap();
    const activeLocalId = obterLocalFsCentroConfig()?.id || '';

    if (licensedOffices.length > 0) {
      const sorted = [...licensedOffices].sort((a, b) => (a.officeSeq || 1) - (b.officeSeq || 1));
      const activeId = sorted.some(o => o.officeId === activeLocalId) ? activeLocalId : sorted[0].officeId;
      return sorted.map(off => {
        const loc = localMap[off.officeId];
        const pastaEvo =
          loc?.pasta_evogex_display ||
          off.pastaEvogex ||
          sugerirPastaEvogexPorEscritorio(off.officeId, off.officeSeq);
        return {
          id: off.officeId,
          nome: loc?.nome || off.officeName || `Escritório ${off.officeSeq || 1}`,
          hostname: loc?.hostname || 'COMPUTADOR-LOCAL',
          pasta_evogex: pastaEvo,
          pasta_motor: loc?.pasta_motor_display || `${pastaEvo}\\motor`,
          pasta_v4_evogex: loc?.pasta_v4_display || `${pastaEvo}\\BdsefaturaV4`,
          pasta_gexcel_antiga: loc?.pasta_gexcel_antiga_display || off.pastaGexcelAntiga || '',
          ativo: off.active,
          selecionado: off.officeId === activeId,
          office_seq: off.officeSeq,
          client_code: off.clientCode,
          max_users: off.maxUsers,
          occupied_users: off.occupiedUsers,
          evogex_confirmado: Boolean(loc?.evogex_confirmado),
        };
      });
    }

    const todos = appConfig?.centros_dados || [];
    const perms = currentUser?.centros_permitidos || ['*'];
    const base =
      perms.includes('*') || currentUser?.role === 'admin' || currentUser?.role === 'superadmin'
        ? todos
        : todos.filter(c => perms.includes(c.id));
    const list = base.length > 0 ? base : todos;
    return list.map(c => {
      const loc = localMap[c.id];
      return {
        ...c,
        nome: loc?.nome || c.nome,
        pasta_evogex: loc?.pasta_evogex_display || c.pasta_evogex,
        pasta_gexcel_antiga: loc?.pasta_gexcel_antiga_display || c.pasta_gexcel_antiga,
        selecionado: activeLocalId ? c.id === activeLocalId : c.selecionado,
        evogex_confirmado: Boolean(loc?.evogex_confirmado),
      };
    });
  }, [licensedOffices, appConfig?.centros_dados, currentUser, localFsRev]);

  const centroAtivo = useMemo(() => {
    return centrosDisponiveis.find(c => c.selecionado) || centrosDisponiveis[0] || null;
  }, [centrosDisponiveis]);

  const handleSelecionarCentro = async (centroId: string) => {
    if (centroAtivo && centroId === centroAtivo.id) return;
    const alvo = centrosDisponiveis.find(c => c.id === centroId);
    const updatedLoc = selecionarLocalFsCentroAtivo(centroId, {
      nome: alvo?.nome,
      pastaEvogex: alvo?.pasta_evogex,
      pastaGexcelAntiga: alvo?.pasta_gexcel_antiga,
      officeSeq: alvo?.office_seq,
    });
    setLocalFsRev(prev => prev + 1);
    setCentroKey(prev => prev + 1);

    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/centros-dados/selecionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centro_id: centroId }),
      });
      if (res.ok) {
        await refreshConfig();
      }
    } catch {}

    if (!updatedLoc.evogex_confirmado && currentUser?.role !== 'subutilizador') {
      setActiveTab('config');
    }
  };

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Dark como padrão de fábrica
  });

  const [activeTab, setActiveTab] = useState<string>('inicio');
  const [startHubUnreadCount, setStartHubUnreadCount] = useState<number>(0);
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
    const applyZoom = () => {
      const targetZoom = window.innerWidth < 768 ? '1' : String(zoomLevel);
      (document.body.style as unknown as { zoom: string }).zoom = targetZoom;
    };
    applyZoom();
    localStorage.setItem('gexcel_zoom_level', zoomLevel.toFixed(2));
    window.addEventListener('resize', applyZoom);
    return () => window.removeEventListener('resize', applyZoom);
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

  if (loading) {
    return (
      <div className="min-h-screen w-screen bg-background text-foreground flex items-center justify-center font-sans select-none relative">
        <div className="workspace-ledger absolute inset-0 pointer-events-none" />
        <div className="relative z-10 px-5 py-3.5 rounded-xl bg-white dark:bg-[#0c1520] border border-border shadow-xl font-mono text-xs text-slate-700 dark:text-slate-200">
          A validar sessão autenticada...
        </div>
      </div>
    );
  }

  if (!currentUser || !token) {
    return (
      <EvoLoginGate
        appCodigo="EVO-06"
        appTitle="Importador e-Fatura & Motor V4"
        appSubtitle="Autenticação obrigatória de acesso ao sistema"
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(u) => {
          if (!u?.token || !u?.username) return;
          sessionStorage.setItem(EVO_SESSION_KEY, JSON.stringify(u));
          const rawRole = (u.role || '').toUpperCase();
          const mappedRole = (rawRole === 'DEV' || rawRole === 'SUPERADMIN' ? 'superadmin' : rawRole === 'ADMIN' ? 'admin' : 'subutilizador') as 'superadmin' | 'admin' | 'subutilizador';
          const mappedUser = {
            id: Number(u.id) || 1,
            cloud_id: u.id ? String(u.id) : undefined,
            username: u.username,
            nome: u.nome || u.username,
            email: u.email || '',
            role: mappedRole,
            ativo: true,
            is_system: rawRole === 'DEV' || rawRole === 'SUPERADMIN',
            client_code: u.client_code,
            created_at: new Date().toISOString(),
          };
          setExternalSession(mappedUser, u.token, {
            offices: u.offices,
            clientCode: u.client_code,
            preferredOfficeId: u.preferred_office_id,
          });
          setLocalFsRev(prev => prev + 1);
          if (u.preferred_office_id && mappedRole !== 'subutilizador') {
            const cfgAtivo = obterLocalFsCentroConfig();
            if (!cfgAtivo?.evogex_confirmado) {
              setActiveTab('config');
            }
          }
        }}
      />
    );
  }

  return (
    <div className="h-[100dvh] w-screen bg-background text-foreground flex flex-col md:flex-row font-sans overflow-hidden select-none relative">
      {/* Camada de Fundo Grelha Excel Subtil (Evo Grid) - z-0 atrás de todo o conteúdo */}
      <div className="workspace-ledger absolute inset-0 pointer-events-none z-0" />

      {/* Menu Lateral Esquerdo Canónico evoGex.com + Barra Superior Mobile (z-30) */}
      <div className="relative z-30 flex flex-col md:flex-row shrink-0">
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
          centrosDisponiveis={centrosDisponiveis}
          centroAtivoId={centroAtivo?.id}
          onSelecionarCentro={handleSelecionarCentro}
          startHubUnreadCount={startHubUnreadCount}
        />
      </div>

      {/* Área Principal de Trabalho Delimitada (z-10) */}
      <main className="flex-1 flex flex-col p-2 sm:p-3.5 min-h-0 overflow-hidden relative z-10">
        <div key={centroKey} className="flex-1 flex flex-col min-h-0 overflow-y-auto md:overflow-hidden">
          {activeTab === 'inicio' ? (
            <InicioHubView
              ano={anoGlobal}
              modoPrivacidade={modoPrivacidade}
              onNavigateTab={setActiveTab}
              onNavegarParaDados={handleNavegarParaDados}
              onUnreadCountChange={setStartHubUnreadCount}
            />
          ) : activeTab === 'recibos' ? (
            <RecibosVerdesView
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
            />
          ) : activeTab === 'anulados' ? (
            <InconformidadesView
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
            />
          ) : activeTab === 'faturas' ? (
            <FaturasView 
              onApiStatusChange={setApiOnline} 
              modoPrivacidade={modoPrivacidade}
              filtroInicial={faturasFiltroInicial}
            />
          ) : activeTab === 'mapas_resumo' ? (
            <MapasResumoView
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
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

      {/* Barra Inferior Mobile (< md) */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalCount={totalCount}
        startHubUnreadCount={startHubUnreadCount}
      />

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
