import { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, ExternalLink, LogOut, Lock, ArrowLeft } from 'lucide-react';
import { Sidebar, MobileBottomNav } from './components/Sidebar';
import { InicioHubView } from './components/InicioHubView';
import CommandCenter from './components/CommandCenter';
import { PendentesView } from './components/PendentesView';
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
import { EvoGestorSetupGate } from './components/EvoGestorSetupGate';
import type { CentroDadosItem } from './types/auth';
import { aguardarSondaMotorLocal } from './lib/apiBridge';
import {
  guardarLocalFsCentroConfig,
  obterLocalFsCentroConfig,
  obterLocalFsTodosCentrosMap,
  obterWorkspaceIdIsolado,
  reconectarPastaEscritorioNoEfatura,
  selecionarLocalFsCentroAtivo,
  sugerirPastaEvogexPorEscritorio,
} from './lib/localFsBridge';
import {
  clearSharedSandboxMeta,
  getEvoSubdomainUrl,
  readSharedCentroMeta,
  readSharedSandboxMeta,
  type SharedSandboxMeta,
} from './lib/evoCrossAppBridge';

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
    logout,
    isTeleworkExternal,
    teleworkExpiresAt,
    moduleAccessDenied,
  } = useAuth();
  const [centroKey, setCentroKey] = useState<number>(0);
  const [localFsRev, setLocalFsRev] = useState<number>(0);
  const [gateState, setGateState] = useState<'checking' | 'ready' | 'reconnect' | 'setup_required'>('checking');
  const [gateEntidadesTotal, setGateEntidadesTotal] = useState<number>(0);
  const [gateOfficeConfirmed, setGateOfficeConfirmed] = useState<boolean>(false);
  const [gateRecheckTick, setGateRecheckTick] = useState<number>(0);
  const [activeSandbox, setActiveSandbox] = useState<SharedSandboxMeta | null>(() => readSharedSandboxMeta());

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
    selecionarLocalFsCentroAtivo(centroId, {
      nome: alvo?.nome,
      pastaEvogex: alvo?.pasta_evogex,
      pastaGexcelAntiga: alvo?.pasta_gexcel_antiga,
      officeSeq: alvo?.office_seq,
    });
    setLocalFsRev(prev => prev + 1);
    setCentroKey(prev => prev + 1);
    setGateState('checking');
    setGateRecheckTick(prev => prev + 1);

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

  // Porteiro Obrigatório de Prontidão (Ligação ao Escritório + Carteira de Entidades no Gestor)
  useEffect(() => {
    if (!currentUser || !token) {
      setGateState('checking');
      return;
    }
    let cancel = false;

    const verificarProntidao = async () => {
      try {
        const curSbx = readSharedSandboxMeta();
        if (curSbx?.sandboxId) {
          try {
            const sbxRes = await fetch(`/api/bridge/sandbox/status?sandbox_id=${encodeURIComponent(curSbx.sandboxId)}`, {
              cache: 'no-store',
            });
            const sbxData = await sbxRes.json().catch(() => null);
            if (sbxData?.active) {
              if (!cancel) {
                setActiveSandbox(curSbx);
                setGateEntidadesTotal(Number(sbxData.entidades_count || 1));
                setGateOfficeConfirmed(true);
                setGateState('ready');
              }
              return;
            }
          } catch {
            // fallback
          }
          clearSharedSandboxMeta();
          if (!cancel) setActiveSandbox(null);
        }

        await aguardarSondaMotorLocal();

        const [entSettled, bridgeSettled] = await Promise.allSettled([
          fetch('http://127.0.0.1:8015/api/entidades', { cache: 'no-store' }),
          fetch('http://127.0.0.1:8095/api/bridge/health', {
            headers: { 'X-Evo-Local-Only': '1' },
            signal: AbortSignal.timeout(900),
          }),
        ]);

        let entidadesTotal = 0;
        if (entSettled.status === 'fulfilled' && entSettled.value.ok) {
          const entData = await entSettled.value.json().catch(() => null);
          entidadesTotal = Number(entData?.total ?? entData?.entidades?.length ?? 0);
        }

        let localBridgeOk = false;
        if (bridgeSettled.status === 'fulfilled' && bridgeSettled.value.ok) {
          const bData = await bridgeSettled.value.json().catch(() => null);
          localBridgeOk = Boolean(
            bData &&
            bData.status === 'ok' &&
            bData.signature === 'Gexcel SafeDrive Bridge' &&
            bData.cloud_mode !== true
          );
        }

        if (
          !cancel &&
          entidadesTotal === 0 &&
          localBridgeOk &&
          window.__GEXCEL_MOTOR_SOURCE__ !== 'local'
        ) {
          try {
            const expRes = await fetch('http://127.0.0.1:8095/api/bridge/workspace/export-sqlite', {
              headers: { 'X-Evo-Local-Only': '1' },
              signal: AbortSignal.timeout(4000),
            });
            const expData = await expRes.json().catch(() => null);
            if (expData?.ok && expData?.sqlite_b64 && Number(expData?.entidades_count || 0) > 0) {
              const hydRes = await fetch('/api/bridge/workspace/hydrate-sqlite', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Evo-Workspace-Id': obterWorkspaceIdIsolado(),
                },
                body: JSON.stringify({ sqlite_b64: expData.sqlite_b64 }),
              });
              if (hydRes.ok) {
                const entRetry = await fetch('http://127.0.0.1:8015/api/entidades', { cache: 'no-store' });
                if (entRetry.ok) {
                  const entRetryData = await entRetry.json().catch(() => null);
                  entidadesTotal = Number(entRetryData?.total ?? entRetryData?.entidades?.length ?? 0);
                }
              }
            }
          } catch {
            // fallback para o porteiro normal
          }
        }

        if (cancel) return;

        const localCfg = obterLocalFsCentroConfig();
        const sharedMeta = readSharedCentroMeta(centroAtivo?.id);
        const localServiceConfirmed = Boolean(localBridgeOk || window.__GEXCEL_MOTOR_SOURCE__ === 'local');
        const officeConfirmed =
          localServiceConfirmed ||
          isTeleworkExternal ||
          Boolean(localCfg?.evogex_confirmado) ||
          Boolean(sharedMeta?.evogexConfirmado);

        setGateEntidadesTotal(entidadesTotal);
        setGateOfficeConfirmed(officeConfirmed);

        if (entidadesTotal > 0 && officeConfirmed) {
          if (!localCfg?.evogex_confirmado && sharedMeta?.evogexConfirmado) {
            guardarLocalFsCentroConfig({
              id: localCfg?.id || centroAtivo?.id || sharedMeta.id || 'escritorio-principal',
              nome: sharedMeta.nome || localCfg?.nome || centroAtivo?.nome || 'Escritório Principal',
              hostname: localCfg?.hostname || 'COMPUTADOR-LOCAL',
              pasta_evogex_display: sharedMeta.pastaEvogex || localCfg?.pasta_evogex_display || 'C:\\Dados_evoGex',
              pasta_motor_display: `${sharedMeta.pastaEvogex || localCfg?.pasta_evogex_display || 'C:\\Dados_evoGex'}\\motor`,
              pasta_v4_display: `${sharedMeta.pastaEvogex || localCfg?.pasta_evogex_display || 'C:\\Dados_evoGex'}\\BdsefaturaV4`,
              pasta_v3_display: localCfg?.pasta_v3_display || 'C:\\Dados_GexcelApps\\BdsefaturaV3',
              pasta_bdsrv_display: localCfg?.pasta_bdsrv_display || 'C:\\Dados_GexcelApps\\BdsRV',
              pasta_pdfs_display: `${sharedMeta.pastaEvogex || localCfg?.pasta_evogex_display || 'C:\\Dados_evoGex'}\\PDFs_Recibos`,
              pasta_gexcel_antiga_display: sharedMeta.pastaAntiga || localCfg?.pasta_gexcel_antiga_display || '',
              ligado: true,
              evogex_confirmado: true,
              antiga_confirmada: Boolean(sharedMeta.pastaAntiga || localCfg?.antiga_confirmada),
              total_entidades_carregadas: entidadesTotal,
              updated_at: new Date().toISOString(),
            });
          }
          setGateState('ready');
          return;
        }

        if (
          entidadesTotal === 0 &&
          !localServiceConfirmed &&
          !isTeleworkExternal &&
          (Boolean(localCfg?.evogex_confirmado) ||
            (Boolean(sharedMeta?.evogexConfirmado) && Number(sharedMeta?.entidadesCount || 0) > 0))
        ) {
          setGateState('reconnect');
          return;
        }

        setGateState('setup_required');
      } catch {
        if (!cancel) {
          setGateState('setup_required');
        }
      }
    };

    void verificarProntidao();
    return () => {
      cancel = true;
    };
  }, [currentUser, token, centroAtivo?.id, isTeleworkExternal, gateRecheckTick]);

  useEffect(() => {
    if (!currentUser || !token || gateState === 'ready') return;
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') {
        setGateRecheckTick(prev => prev + 1);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [currentUser, token, gateState]);

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
            session_context: u.session_context || 'OFFICE',
            telework_expires_at: u.telework_expires_at || '',
            created_at: new Date().toISOString(),
          };
          setExternalSession(mappedUser, u.token, {
            offices: u.offices,
            clientCode: u.client_code,
            preferredOfficeId: u.preferred_office_id,
          });
          setLocalFsRev(prev => prev + 1);
          setGateState('checking');
          setGateRecheckTick(prev => prev + 1);
        }}
      />
    );
  }

  const sharedMetaGate = readSharedCentroMeta(centroAtivo?.id);
  const localCfgGate = obterLocalFsCentroConfig();

  const handleOpenGestorEntidades = () => {
    const base = getEvoSubdomainUrl('entidades');
    const ret = `${window.location.origin}/`;
    const officeId = centroAtivo?.id || '';
    const qs = new URLSearchParams();
    if (token) qs.set('sso', token);
    qs.set('return_to', ret);
    qs.set('setup', '1');
    if (officeId) qs.set('office_id', officeId);
    window.location.href = `${base}/?${qs.toString()}`;
  };

  if (moduleAccessDenied) {
    return (
      <div className="min-h-screen bg-background text-foreground relative flex flex-col justify-between overflow-hidden font-sans select-none">
        <div className="workspace-ledger absolute inset-0 pointer-events-none" />
        <header className="h-14 flex items-center justify-between px-6 relative z-10 border-b border-border bg-white dark:bg-[#0c1520]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-[#0a1929] font-mono text-[11px] font-bold text-primary">
              GE
            </span>
            <span className="font-mono text-xs font-semibold tracking-tight text-foreground">
              evoGex.com · EVO-06
            </span>
          </div>
          <span className="font-mono text-[11px] px-2.5 py-1 rounded-md border border-border bg-slate-50 dark:bg-[#081019] text-slate-700 dark:text-slate-300">
            {currentUser.email || currentUser.username}
          </span>
        </header>
        <main className="flex-1 flex items-center justify-center px-4 relative z-10 py-8">
          <div className="w-full max-w-[480px] bg-white dark:bg-[#0c1520] border border-border rounded-xl p-7 shadow-2xl relative before:absolute before:left-0 before:top-6 before:h-5 before:w-0.5 before:bg-rose-600">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-mono text-[11px] uppercase tracking-wider mb-2">
              <Lock size={13} />
              <span>Acesso Restrito ao Módulo</span>
            </div>
            <h1 className="font-display text-2xl font-light tracking-tight text-foreground">
              Sem Permissão para o EVO e-Fatura
            </h1>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mt-2">
              {moduleAccessDenied}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => {
                  window.location.href = getEvoSubdomainUrl('painel');
                }}
                className="flex-1 py-2.5 px-4 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <ArrowLeft size={14} />
                <span>Voltar ao Painel de Navegação</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="py-2.5 px-4 rounded-lg border border-border bg-white dark:bg-[#0c1520] hover:border-rose-400 text-slate-700 dark:text-slate-200 text-xs font-mono flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut size={13} />
                <span>Terminar Sessão</span>
              </button>
            </div>
          </div>
        </main>
        <footer className="h-10 px-6 flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-400 border-t border-border bg-white dark:bg-[#0c1520] relative z-10">
          <span>Ecossistema Gexcel EVO · Zero-Storage Cloud</span>
          <span>Controlo de Acesso por Módulo</span>
        </footer>
      </div>
    );
  }

  if (gateState === 'checking') {
    return (
      <div className="min-h-screen w-screen bg-background text-foreground flex items-center justify-center font-sans select-none relative">
        <div className="workspace-ledger absolute inset-0 pointer-events-none" />
        <div className="relative z-10 px-5 py-3.5 rounded-xl bg-white dark:bg-[#0c1520] border border-border shadow-xl font-mono text-xs text-slate-700 dark:text-slate-200">
          A verificar configuração do escritório e entidades...
        </div>
      </div>
    );
  }

  if (gateState === 'reconnect' || gateState === 'setup_required') {
    return (
      <EvoGestorSetupGate
        mode={gateState}
        theme={theme}
        onToggleTheme={toggleTheme}
        userEmail={currentUser.email || currentUser.username}
        userName={currentUser.nome || currentUser.username}
        officeName={
          localCfgGate?.nome ||
          sharedMetaGate?.nome ||
          centroAtivo?.nome ||
          'Escritório Principal'
        }
        pastaDisplay={
          localCfgGate?.pasta_evogex_display ||
          sharedMetaGate?.pastaEvogex ||
          centroAtivo?.pasta_evogex ||
          'C:\\Dados_evoGex'
        }
        officeConfirmed={gateOfficeConfirmed}
        entidadesTotal={gateEntidadesTotal}
        entidadesPrevias={Number(
          sharedMetaGate?.entidadesCount || localCfgGate?.total_entidades_carregadas || 0
        )}
        onOpenGestor={handleOpenGestorEntidades}
        onRecheck={() => {
          setGateRecheckTick(prev => prev + 1);
        }}
        onReconnectFolder={async () => {
          const res = await reconectarPastaEscritorioNoEfatura();
          if (res.ok && res.totalEntidades > 0) {
            setLocalFsRev(prev => prev + 1);
            setGateEntidadesTotal(res.totalEntidades);
            setGateOfficeConfirmed(true);
            setGateState('ready');
          } else if (res.precisaGestor) {
            setGateState('setup_required');
          }
          return res;
        }}
        onLogout={logout}
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
        {activeSandbox && (
          <div className="mb-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-[#221a09] border border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded bg-amber-600 text-white text-[11px]">
                <ShieldCheck size={12} />
                <span>ESPELHO HETZNER · {activeSandbox.sandboxId}</span>
              </span>
              <span className="font-semibold">{activeSandbox.clientLabel}</span>
              <span className="font-mono text-[11px]">
                Isolado na Hetzner · Zero ficheiros no teu PC
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={getEvoSubdomainUrl('entidades')}
                className="h-6 px-2 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-[#0c1520] text-[11px] font-semibold inline-flex items-center gap-1"
              >
                <span>Entidades</span>
                <ExternalLink size={10} />
              </a>
              <a
                href={getEvoSubdomainUrl('portais')}
                className="h-6 px-2 rounded border border-amber-400 dark:border-amber-700 bg-white dark:bg-[#0c1520] text-[11px] font-semibold inline-flex items-center gap-1"
              >
                <span>Portais</span>
                <ExternalLink size={10} />
              </a>
              <button
                type="button"
                onClick={() => {
                  clearSharedSandboxMeta();
                  setActiveSandbox(null);
                  setGateState('checking');
                  setGateRecheckTick(prev => prev + 1);
                  setCentroKey(prev => prev + 1);
                }}
                className="h-6 px-2 rounded bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut size={10} />
                <span>Sair</span>
              </button>
            </div>
          </div>
        )}
        {isTeleworkExternal && (
          <div className="mb-2 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-[#241a08] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-mono text-[11px] flex items-center justify-between gap-2 shrink-0">
            <span className="font-semibold">
              🏠 Teletrabalho Blindado · Sessão externa protegida{teleworkExpiresAt ? ` (válida até ${teleworkExpiresAt.slice(0, 10).split('-').reverse().join('-')})` : ''}
            </span>
            <span className="text-[10px] font-medium">
              Senhas AT e exportações em lote desativadas fora do escritório
            </span>
          </div>
        )}
        <div key={centroKey} className="flex-1 flex flex-col min-h-0 overflow-y-auto md:overflow-hidden">
          {activeTab === 'inicio' ? (
            <InicioHubView
              ano={anoGlobal}
              modoPrivacidade={modoPrivacidade}
              onNavigateTab={setActiveTab}
              onNavegarParaDados={handleNavegarParaDados}
              onUnreadCountChange={setStartHubUnreadCount}
            />
          ) : activeTab === 'pendentes' ? (
            <PendentesView
              ano={anoGlobal}
              onAnoChange={setAnoGlobal}
              onApiStatusChange={setApiOnline}
              modoPrivacidade={modoPrivacidade}
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
