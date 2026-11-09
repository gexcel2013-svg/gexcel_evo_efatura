import { useState, useEffect } from 'react';
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
  const { currentUser, showLoginModal, showSetupWizard, setShowLoginModal, setExternalSession } = useAuth();
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
      <main className="flex-1 flex flex-col p-3.5 min-h-0 overflow-hidden relative z-10">
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
