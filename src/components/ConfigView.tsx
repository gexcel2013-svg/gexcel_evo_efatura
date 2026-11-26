import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  SlidersHorizontal, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Edit2, 
  Trash2, 
  X, 
  User, 
  RefreshCw,
  LogOut,
  FolderOpen,
  Copy,
  Plus,
  Building2,
  Laptop,
  Wifi,
  ShieldAlert,
  ArrowUpRight
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getEvoSubdomainUrl } from '../lib/evoCrossAppBridge';
import { validateEmail, validatePhone, formatPhoneDisplay } from '../lib/contactValidation';
import type {
  AppUser,
  CentroDadosItem,
  LicensedOfficeInfo,
  OfficeTrustedIpInfo,
  ClientSecurityAlertInfo,
  PendingTransferInfo,
} from '../types/auth';
import {
  obterLocalFsCentroConfig,
  obterLocalFsTodosCentrosMap,
  selecionarLocalFsCentroAtivo,
  sugerirPastaEvogexPorEscritorio,
  guardarLocalFsCentroConfig,
  escolherEInstalarPastaDadosEvogex,
  escolherPastaDadosGexcelAntigos,
  sincronizarSqlitesParaPastaLocal,
  abrirPastaNoExploradorNativo,
  type LocalFsCentroConfig,
} from '../lib/localFsBridge';

type UserSortColumn = 'nome' | 'email' | 'role' | 'centros' | 'modulos' | 'teletrabalho' | 'ativo' | 'ultimo_login';

const DEFAULT_AVAILABLE_APPS: Array<{ code: string; label: string }> = [
  { code: 'EVO-12', label: 'Entidades & Cofre' },
  { code: 'EVO-07', label: 'Conciliação Global' },
  { code: 'EVO-06', label: 'e-Fatura' },
  { code: 'EVO-04', label: 'Portais & Submissões' },
  { code: 'EVO-16', label: 'PDF Finder' },
];

function isWindowsPath(p?: string): boolean {
  if (!p) return false;
  return /^[A-Za-z]:\\/.test(p) || /^\\\\/.test(p);
}

export function ConfigView() {
  const { 
    currentUser, 
    token,
    appConfig,
    licensedOffices,
    clientCode,
    refreshConfig,
    refreshClientCloudState,
    refreshUsers, 
    logout 
  } = useAuth();

  const isLoggedIn = !!currentUser;
  const isSub = currentUser?.role === 'subutilizador';
  const isAdm = currentUser?.role === 'admin';
  const isSuper = currentUser?.role === 'superadmin';
  const canManage = isAdm || isSuper || !currentUser;
  const isCloudClient = Boolean(clientCode && token?.startsWith('gxtk.'));

  const getHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      h['X-Auth-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }, [token]);

  const [alimentarXmlLegado, setAlimentarXmlLegado] = useState<boolean>(() => {
    const saved = localStorage.getItem('gexcel_alimentar_xml_legado');
    return saved !== null ? saved === 'true' : true;
  });
  const [salvandoCentro, setSalvandoCentro] = useState<boolean>(false);
  const [sincronizandoSqlites, setSincronizandoSqlites] = useState<boolean>(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);
  const [passoAtivo, setPassoAtivo] = useState<1 | 2 | 3>(1);
  const [mostrarPastasTecnicas, setMostrarPastasTecnicas] = useState<boolean>(false);

  const [localFsCfg, setLocalFsCfg] = useState<LocalFsCentroConfig | null>(() => obterLocalFsCentroConfig());
  const [caminhoPropostoEvogex, setCaminhoPropostoEvogex] = useState<string>(
    () => obterLocalFsCentroConfig()?.pasta_evogex_display || 'C:\\Dados_evoGex'
  );
  const [caminhoPropostoAntiga, setCaminhoPropostoAntiga] = useState<string>(
    () => obterLocalFsCentroConfig()?.pasta_gexcel_antiga_display || 'C:\\Dados_GexcelApps'
  );

  useEffect(() => {
    const onFsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<LocalFsCentroConfig>).detail || obterLocalFsCentroConfig();
      setLocalFsCfg(detail);
      if (detail?.pasta_evogex_display) setCaminhoPropostoEvogex(detail.pasta_evogex_display);
      if (detail?.pasta_gexcel_antiga_display) setCaminhoPropostoAntiga(detail.pasta_gexcel_antiga_display);
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  // Modal de criação / edição de Centro de Dados Nomeado
  const [modalCentroAberto, setModalCentroAberto] = useState<boolean>(false);
  const [centroEmEdicao, setCentroEmEdicao] = useState<CentroDadosItem | null>(null);
  const [formCentroNome, setFormCentroNome] = useState<string>('');
  const [formCentroHost, setFormCentroHost] = useState<string>('');
  const [formCentroPastaEvogex, setFormCentroPastaEvogex] = useState<string>('');
  const [formCentroPastaAntiga, setFormCentroPastaAntiga] = useState<string>('');

  // Pastas locais resolvidas pela API
  const [pastasLocais, setPastasLocais] = useState<{
    pasta_evogex: string;
    pasta_motor: string;
    pasta_v4: string;
    pasta_v3: string;
    pasta_bdsrv: string;
    pasta_pdfs: string;
    db_path: string;
  }>({
    pasta_evogex: isWindowsPath(appConfig?.centro_dados_pasta_evogex) ? (appConfig?.centro_dados_pasta_evogex || '') : '',
    pasta_motor: isWindowsPath(appConfig?.centro_dados_pasta_motor) ? (appConfig?.centro_dados_pasta_motor || '') : '',
    pasta_v4: isWindowsPath(appConfig?.pasta_v4) ? (appConfig?.pasta_v4 || '') : '',
    pasta_v3: isWindowsPath(appConfig?.pasta_v3) ? (appConfig?.pasta_v3 || '') : '',
    pasta_bdsrv: isWindowsPath(appConfig?.pasta_bdsrv) ? (appConfig?.pasta_bdsrv || '') : '',
    pasta_pdfs: isWindowsPath(appConfig?.pasta_pdfs) ? (appConfig?.pasta_pdfs || '') : '',
    db_path: isWindowsPath(appConfig?.db_path) ? (appConfig?.db_path || '') : '',
  });

  // Lista de utilizadores, segurança escritório/teletrabalho e ordenação universal
  const [utilizadores, setUtilizadores] = useState<AppUser[]>([]);
  const [cloudOfficesSummary, setCloudOfficesSummary] = useState<LicensedOfficeInfo[]>([]);
  const [officeTrustedIps, setOfficeTrustedIps] = useState<OfficeTrustedIpInfo[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<ClientSecurityAlertInfo[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransferInfo[]>([]);
  const [activeExternalCount, setActiveExternalCount] = useState<number>(0);
  const [teleworkBusyId, setTeleworkBusyId] = useState<string | null>(null);
  const [teleworkPickerUserId, setTeleworkPickerUserId] = useState<string | null>(null);
  const [novoCodigoCasaBanner, setNovoCodigoCasaBanner] = useState<{ nome: string; code: string; expiresAt: string } | null>(null);
  const [carregandoUsers, setCarregandoUsers] = useState<boolean>(false);
  const [sortCol, setSortCol] = useState<UserSortColumn>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Modal de criação / edição de utilizador
  const [modalUserAberto, setModalUserAberto] = useState<boolean>(false);
  const [userEmEdicao, setUserEmEdicao] = useState<AppUser | null>(null);
  const [formNome, setFormNome] = useState<string>('');
  const [formUsername, setFormUsername] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formTelefone, setFormTelefone] = useState<string>('');
  const [formRole, setFormRole] = useState<'admin' | 'subutilizador' | 'superadmin'>('subutilizador');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formAtivo, setFormAtivo] = useState<boolean>(true);
  const [formTodosCentros, setFormTodosCentros] = useState<boolean>(true);
  const [formCentrosSelecionados, setFormCentrosSelecionados] = useState<string[]>([]);
  const [availableApps, setAvailableApps] = useState<Array<{ code: string; label: string }>>(DEFAULT_AVAILABLE_APPS);
  const [formAllowedApps, setFormAllowedApps] = useState<string[]>(() => DEFAULT_AVAILABLE_APPS.map(a => a.code));
  const [salvandoUser, setSalvandoUser] = useState<boolean>(false);
  const [erroFormUser, setErroFormUser] = useState<string | null>(null);

  const pastaRaizRealMotor = useMemo(() => {
    const pV4 = pastasLocais.pasta_v4 || (isWindowsPath(appConfig?.pasta_v4) ? (appConfig?.pasta_v4 || '') : '');
    if (pV4) return pV4.replace(/[\\/]BdsefaturaV4[\\/]?$/i, '');
    const pV3 = pastasLocais.pasta_v3 || (isWindowsPath(appConfig?.pasta_v3) ? (appConfig?.pasta_v3 || '') : '');
    if (pV3) return pV3.replace(/[\\/]BdsefaturaV3[\\/]?$/i, '');
    return '';
  }, [pastasLocais.pasta_v4, pastasLocais.pasta_v3, appConfig?.pasta_v4, appConfig?.pasta_v3]);

  const centrosDadosLista = useMemo<CentroDadosItem[]>(() => {
    const cloudOffices = cloudOfficesSummary.length > 0 ? cloudOfficesSummary : licensedOffices;
    if (cloudOffices.length > 0) {
      const localMap = obterLocalFsTodosCentrosMap();
      const sorted = [...cloudOffices].sort((a, b) => (a.officeSeq || 1) - (b.officeSeq || 1));
      const activeId =
        localFsCfg?.id && sorted.some(o => o.officeId === localFsCfg.id)
          ? localFsCfg.id
          : sorted[0].officeId;
      return sorted.map(off => {
        const loc = localMap[off.officeId];
        const pastaEvo =
          loc?.pasta_evogex_display ||
          off.pastaEvogex ||
          sugerirPastaEvogexPorEscritorio(off.officeId, off.officeSeq);
        const pastaAnt =
          loc?.pasta_gexcel_antiga_display || off.pastaGexcelAntiga || '';
        return {
          id: off.officeId,
          nome: loc?.nome || off.officeName || `Escritório ${off.officeSeq || 1}`,
          hostname: loc?.hostname || 'COMPUTADOR-LOCAL',
          pasta_evogex: pastaEvo,
          pasta_motor: loc?.pasta_motor_display || `${pastaEvo}\\motor`,
          pasta_gexcel_antiga: pastaAnt,
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
    if (localFsCfg && localFsCfg.pasta_evogex_display) {
      return [
        {
          id: localFsCfg.id || 'escritorio-principal',
          nome: localFsCfg.nome || 'Escritório Principal',
          hostname: localFsCfg.hostname || 'COMPUTADOR-LOCAL',
          pasta_evogex: localFsCfg.pasta_evogex_display,
          pasta_motor: localFsCfg.pasta_motor_display,
          pasta_gexcel_antiga: localFsCfg.pasta_gexcel_antiga_display || caminhoPropostoAntiga,
          ativo: true,
          selecionado: true,
        },
      ];
    }
    if (appConfig?.centros_dados && appConfig.centros_dados.length > 0) {
      return appConfig.centros_dados;
    }
    if (pastaRaizRealMotor) {
      const isEvogexFolder = /dados_evogex/i.test(pastaRaizRealMotor);
      return [
        {
          id: appConfig?.centro_dados_ativo_id || 'instalacao-local-atual',
          nome: appConfig?.centro_dados_nome || 'Escritório Principal',
          hostname: appConfig?.centro_dados_hostname || 'COMPUTADOR-LOCAL',
          pasta_evogex: isEvogexFolder ? pastaRaizRealMotor : (appConfig?.centro_dados_pasta_evogex || 'C:\\Dados_evoGex'),
          pasta_motor: isEvogexFolder ? `${pastaRaizRealMotor}\\motor` : (appConfig?.centro_dados_pasta_motor || 'C:\\Dados_evoGex\\motor'),
          pasta_gexcel_antiga: isEvogexFolder ? (appConfig?.centro_dados_pasta_gexcel_antiga || '') : pastaRaizRealMotor,
          ativo: true,
          selecionado: true,
        },
      ];
    }
    return [
      {
        id: 'escritorio-principal',
        nome: 'Escritório Principal',
        hostname: 'COMPUTADOR-LOCAL',
        pasta_evogex: caminhoPropostoEvogex || 'C:\\Dados_evoGex',
        pasta_motor: `${caminhoPropostoEvogex || 'C:\\Dados_evoGex'}\\motor`,
        pasta_gexcel_antiga: caminhoPropostoAntiga || 'C:\\Dados_GexcelApps',
        ativo: true,
        selecionado: true,
      },
    ];
  }, [cloudOfficesSummary, licensedOffices, localFsCfg, appConfig, pastaRaizRealMotor, caminhoPropostoEvogex, caminhoPropostoAntiga]);

  const activeCentroSelecionado = useMemo<CentroDadosItem | null>(() => {
    return centrosDadosLista.find(c => c.selecionado) || centrosDadosLista[0] || null;
  }, [centrosDadosLista]);

  const [nomePropostoEscritorio, setNomePropostoEscritorio] = useState<string>(
    () => activeCentroSelecionado?.nome || obterLocalFsCentroConfig()?.nome || 'Escritório Principal'
  );

  useEffect(() => {
    if (activeCentroSelecionado?.nome) {
      setNomePropostoEscritorio(activeCentroSelecionado.nome);
    }
  }, [activeCentroSelecionado?.id, activeCentroSelecionado?.nome]);

  useEffect(() => {
    setPastasLocais(prev => ({
      pasta_evogex: isWindowsPath(appConfig?.centro_dados_pasta_evogex) ? (appConfig?.centro_dados_pasta_evogex || '') : prev.pasta_evogex,
      pasta_motor: isWindowsPath(appConfig?.centro_dados_pasta_motor) ? (appConfig?.centro_dados_pasta_motor || '') : prev.pasta_motor,
      pasta_v4: isWindowsPath(appConfig?.pasta_v4) ? (appConfig?.pasta_v4 || '') : prev.pasta_v4,
      pasta_v3: isWindowsPath(appConfig?.pasta_v3) ? (appConfig?.pasta_v3 || '') : prev.pasta_v3,
      pasta_bdsrv: isWindowsPath(appConfig?.pasta_bdsrv) ? (appConfig?.pasta_bdsrv || '') : prev.pasta_bdsrv,
      pasta_pdfs: isWindowsPath(appConfig?.pasta_pdfs) ? (appConfig?.pasta_pdfs || '') : prev.pasta_pdfs,
      db_path: isWindowsPath(appConfig?.db_path) ? (appConfig?.db_path || '') : prev.db_path,
    }));

    // Restaurar automaticamente do servidor se o browser tiver sido limpo ou reaberto
    const srvAntiga = isWindowsPath(appConfig?.centro_dados_pasta_gexcel_antiga)
      ? (appConfig?.centro_dados_pasta_gexcel_antiga || '')
      : '';
    const srvEvo = isWindowsPath(appConfig?.centro_dados_pasta_evogex) && !/dados_gexcelapps/i.test(appConfig?.centro_dados_pasta_evogex || '')
      ? (appConfig?.centro_dados_pasta_evogex || 'C:\\Dados_evoGex')
      : 'C:\\Dados_evoGex';

    const atual = obterLocalFsCentroConfig();
    if (!atual && (srvAntiga || srvEvo)) {
      const recuperado: LocalFsCentroConfig = {
        id: appConfig?.centro_dados_ativo_id || 'escritorio-principal',
        nome: appConfig?.centro_dados_nome || 'Escritório Principal',
        hostname: appConfig?.centro_dados_hostname || 'COMPUTADOR-LOCAL',
        pasta_evogex_display: srvEvo,
        pasta_motor_display: `${srvEvo}\\motor`,
        pasta_v4_display: `${srvEvo}\\BdsefaturaV4`,
        pasta_v3_display: `${srvAntiga || 'C:\\Dados_GexcelApps'}\\BdsefaturaV3`,
        pasta_bdsrv_display: `${srvAntiga || 'C:\\Dados_GexcelApps'}\\BdsRV`,
        pasta_pdfs_display: `${srvEvo}\\PDFs_Recibos`,
        pasta_gexcel_antiga_display: srvAntiga,
        ligado: true,
        antiga_confirmada: Boolean(srvAntiga),
        updated_at: new Date().toISOString(),
      };
      setLocalFsCfg(recuperado);
      setCaminhoPropostoEvogex(srvEvo);
      if (srvAntiga) setCaminhoPropostoAntiga(srvAntiga);
    } else if (atual && !atual.pasta_gexcel_antiga_display && srvAntiga) {
      atual.pasta_gexcel_antiga_display = srvAntiga;
      atual.antiga_confirmada = true;
      guardarLocalFsCentroConfig(atual);
      setLocalFsCfg({ ...atual });
      setCaminhoPropostoAntiga(srvAntiga);
    }
  }, [appConfig]);

  const syncCloudOfficeMetadata = useCallback(
    async (officeId: string, officeName?: string, pastaEvogex?: string, pastaGexcelAntiga?: string) => {
      if (!isCloudClient || (!isAdm && !isSuper) || !officeId) return;
      try {
        const res = await fetch('/api/auth/client/office/update', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            officeId,
            officeName: officeName?.trim() || undefined,
            pastaEvogex: pastaEvogex?.trim() ?? undefined,
            pastaGexcelAntiga: pastaGexcelAntiga?.trim() ?? undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.ok && Array.isArray(data.offices)) {
            setCloudOfficesSummary(data.offices);
            await refreshClientCloudState();
          }
        }
      } catch {
        // tolerar se temporariamente offline
      }
    },
    [isCloudClient, isAdm, isSuper, getHeaders, refreshClientCloudState]
  );

  const aplicarEstadoNuvem = useCallback((data: any) => {
    if (!data?.ok) return;
    if (Array.isArray(data.offices)) {
      setCloudOfficesSummary(data.offices);
    }
    if (Array.isArray(data.office_trusted_ips)) {
      setOfficeTrustedIps(data.office_trusted_ips);
    }
    if (Array.isArray(data.security_alerts)) {
      setSecurityAlerts(data.security_alerts);
    }
    if (Array.isArray(data.pending_transfers)) {
      setPendingTransfers(data.pending_transfers);
    } else if (Array.isArray(data.users)) {
      setPendingTransfers([]);
    }
    if (typeof data.active_external_count === 'number') {
      setActiveExternalCount(data.active_external_count);
    }
    if (Array.isArray(data.available_apps) && data.available_apps.length > 0) {
      setAvailableApps(data.available_apps);
    }
    const rawUsers = Array.isArray(data.users) ? data.users : [];
    const mapped: AppUser[] = rawUsers.map((u: any, idx: number) => {
      const roleUp = String(u.role || 'OPERADOR').toUpperCase();
      const offs = Array.isArray(u.officeIds) ? u.officeIds.map(String) : [];
      const apps = roleUp === 'ADMIN'
        ? ['*']
        : Array.isArray(u.allowedApps) && u.allowedApps.length > 0
        ? u.allowedApps.map((a: unknown) => String(a).trim().toUpperCase())
        : ['*'];
      return {
        id: idx + 1,
        cloud_id: String(u.id),
        username: String(u.username || ''),
        nome: String(u.nome || u.username || ''),
        email: String(u.email || ''),
        telefone: String(u.telefone || ''),
        role: roleUp === 'ADMIN' ? 'admin' : 'subutilizador',
        ativo: Boolean(u.ativo),
        is_system: false,
        client_code: data.client_code,
        office_ids: offs,
        centros_permitidos: roleUp === 'ADMIN' ? ['*'] : offs,
        allowed_apps: apps,
        telework: u.telework,
        ultimo_login: u.ultimo_login || '',
        created_at: u.created_at || '',
      };
    });
    setUtilizadores(mapped);
  }, []);

  const carregarListaUtilizadores = useCallback(async () => {
    setCarregandoUsers(true);
    try {
      if (isCloudClient) {
        const res = await fetch('/api/auth/client/state', {
          headers: getHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.ok) {
            aplicarEstadoNuvem(data);
            setCarregandoUsers(false);
            return;
          }
        }
      }
      const users = await refreshUsers();
      setUtilizadores(users.filter(u => u.role !== 'superadmin' && !u.is_system));
    } finally {
      setCarregandoUsers(false);
    }
  }, [isCloudClient, getHeaders, refreshUsers, aplicarEstadoNuvem]);

  useEffect(() => {
    carregarListaUtilizadores();
    fetch('http://127.0.0.1:8015/api/recibos-verdes/config')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (cfg) {
          if (typeof cfg.alimentar_xml_legado === 'boolean') {
            setAlimentarXmlLegado(cfg.alimentar_xml_legado);
            localStorage.setItem('gexcel_alimentar_xml_legado', String(cfg.alimentar_xml_legado));
          }
          setPastasLocais(prev => ({
            ...prev,
            pasta_v4: isWindowsPath(cfg.pasta_v4) ? cfg.pasta_v4 : prev.pasta_v4,
            pasta_bdsrv: isWindowsPath(cfg.pasta_bdsrv) ? cfg.pasta_bdsrv : prev.pasta_bdsrv,
            pasta_pdfs: isWindowsPath(cfg.pasta_pdfs) ? cfg.pasta_pdfs : prev.pasta_pdfs,
          }));
        }
      })
      .catch(() => {});
  }, [carregarListaUtilizadores]);

  const activeOfficeMeta = useMemo(() => {
    const cloudList = cloudOfficesSummary.length > 0 ? cloudOfficesSummary : licensedOffices;
    if (cloudList.length === 0) return null;
    const activeId = localFsCfg?.id || cloudList[0].officeId;
    return cloudList.find(o => o.officeId === activeId) || cloudList[0];
  }, [cloudOfficesSummary, licensedOffices, localFsCfg?.id]);

  const maxUsers = isCloudClient ? (activeOfficeMeta?.maxUsers || 3) : (appConfig?.max_users || 5);
  const lugaresOcupados = isCloudClient ? (activeOfficeMeta?.occupiedUsers ?? utilizadores.length) : utilizadores.length;

  const hasAnyFreeSeat = useMemo(() => {
    if (!isCloudClient) return lugaresOcupados < maxUsers;
    const cloudList = cloudOfficesSummary.length > 0 ? cloudOfficesSummary : licensedOffices;
    if (cloudList.length === 0) return true;
    return cloudList.some(o => (o.occupiedUsers || 0) < (o.maxUsers || 0));
  }, [isCloudClient, lugaresOcupados, maxUsers, cloudOfficesSummary, licensedOffices]);

  const handleSortUsers = (col: UserSortColumn) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const formatarCentrosUser = useCallback((u: AppUser): string => {
    if (u.role === 'admin' || u.role === 'superadmin') return 'Todos os Escritórios (Auto)';
    const perms = u.office_ids && u.office_ids.length > 0 ? u.office_ids : (u.centros_permitidos || []);
    if (perms.includes('*')) return 'Todos os Escritórios (Auto)';
    const nomes = perms.map(cid => {
      const found = centrosDadosLista.find(c => c.id === cid);
      if (!found) return cid;
      return found.id !== 'escritorio-principal' ? `${found.id} · ${found.nome}` : found.nome;
    });
    return nomes.join(', ') || 'Sem escritório atribuído';
  }, [centrosDadosLista]);

  const formatarModulosUser = useCallback((u: AppUser): string => {
    if (u.role === 'admin' || u.role === 'superadmin') return 'Todos';
    const apps = u.allowed_apps;
    if (!Array.isArray(apps) || apps.length === 0 || apps.includes('*')) return 'Todos';
    return apps
      .map(c => availableApps.find(a => a.code === c.toUpperCase())?.label || c)
      .join(', ');
  }, [availableApps]);

  const utilizadoresOrdenados = useMemo(() => {
    const arr = [...utilizadores];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'nome') {
        cmp = `${a.nome} ${a.username}`.localeCompare(`${b.nome} ${b.username}`, 'pt');
      } else if (sortCol === 'email') {
        cmp = (a.email || '').localeCompare(b.email || '', 'pt');
      } else if (sortCol === 'role') {
        cmp = a.role.localeCompare(b.role, 'pt');
      } else if (sortCol === 'centros') {
        cmp = formatarCentrosUser(a).localeCompare(formatarCentrosUser(b), 'pt');
      } else if (sortCol === 'modulos') {
        cmp = formatarModulosUser(a).localeCompare(formatarModulosUser(b), 'pt');
      } else if (sortCol === 'teletrabalho') {
        const orderMap: Record<string, number> = { ACTIVE: 1, PENDING_PAIRING: 2, FROZEN: 3, OFFICE_ONLY: 4 };
        const ma = a.role === 'admin' ? 0 : (orderMap[a.telework?.mode || 'OFFICE_ONLY'] ?? 5);
        const mb = b.role === 'admin' ? 0 : (orderMap[b.telework?.mode || 'OFFICE_ONLY'] ?? 5);
        cmp = ma - mb;
      } else if (sortCol === 'ativo') {
        cmp = (a.ativo === b.ativo) ? 0 : a.ativo ? -1 : 1;
      } else if (sortCol === 'ultimo_login') {
        const isoA = a.ultimo_login || '';
        const isoB = b.ultimo_login || '';
        cmp = isoA.localeCompare(isoB);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [utilizadores, sortCol, sortDir, formatarCentrosUser, formatarModulosUser]);

  const handleCopiarCaminho = async (caminho: string, label: string) => {
    if (!caminho) return;
    try {
      await navigator.clipboard.writeText(caminho);
      setMensagemSucesso(`Endereço copiado para a área de transferência (${label}).`);
    } catch {
      setMensagemErro('Não foi possível copiar o endereço automaticamente.');
    }
  };

  const handleAbrirNoWindows = async (
    caminho: string,
    subpasta?: string,
    origem: 'evogex' | 'antiga' = 'evogex'
  ) => {
    if (!caminho) return;
    setMensagemErro(null);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho }),
      });
      if (res.ok) {
        const d = await res.json();
        if ((d.status === 'ok' || d.status === 'sucesso') && d.origem !== 'cloud') {
          return;
        }
      }
    } catch {
      // Fallback para o seletor nativo do Windows Explorer no browser
    }
    const abriu = await abrirPastaNoExploradorNativo(subpasta, origem);
    if (!abriu) {
      await handleCopiarCaminho(caminho, 'Pasta Local');
    }
  };

  const handleSelecionarEscritorioPasso1 = async (centro: CentroDadosItem) => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    const updated = selecionarLocalFsCentroAtivo(centro.id, {
      nome: centro.nome,
      pastaEvogex: centro.pasta_evogex,
      pastaGexcelAntiga: centro.pasta_gexcel_antiga,
      officeSeq: centro.office_seq,
    });
    setLocalFsCfg(updated);
    setNomePropostoEscritorio(updated.nome);
    setCaminhoPropostoEvogex(updated.pasta_evogex_display);
    if (updated.pasta_gexcel_antiga_display) {
      setCaminhoPropostoAntiga(updated.pasta_gexcel_antiga_display);
    }
    try {
      await fetch('http://127.0.0.1:8015/api/app/centros-dados/selecionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centro_id: centro.id }),
      });
      await refreshConfig();
    } catch {}
    setMensagemSucesso(`Escritório ativo alterado para '${updated.nome}' (${updated.pasta_evogex_display}).`);
  };

  const handleGuardarFixarConfiguracao = async () => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    const targetId = activeCentroSelecionado?.id || localFsCfg?.id || 'escritorio-principal';
    const nomeLimpo =
      nomePropostoEscritorio.trim() ||
      activeCentroSelecionado?.nome ||
      localFsCfg?.nome ||
      'Escritório Principal';
    const evoLimpo = (caminhoPropostoEvogex || sugerirPastaEvogexPorEscritorio(targetId, activeCentroSelecionado?.office_seq)).trim();
    const antLimpo = (localFsCfg?.pasta_gexcel_antiga_display || caminhoPropostoAntiga || '').trim();
    const novoCfg: LocalFsCentroConfig = {
      id: targetId,
      nome: nomeLimpo,
      hostname: localFsCfg?.hostname || 'COMPUTADOR-LOCAL',
      pasta_evogex_display: evoLimpo,
      pasta_motor_display: `${evoLimpo}\\motor`,
      pasta_v4_display: `${evoLimpo}\\BdsefaturaV4`,
      pasta_v3_display: `${antLimpo || 'C:\\Dados_GexcelApps'}\\BdsefaturaV3`,
      pasta_bdsrv_display: `${antLimpo || 'C:\\Dados_GexcelApps'}\\BdsRV`,
      pasta_pdfs_display: `${evoLimpo}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: antLimpo,
      ligado: true,
      evogex_confirmado: Boolean(localFsCfg?.evogex_confirmado || true),
      antiga_confirmada: Boolean(localFsCfg?.antiga_confirmada || antLimpo),
      total_entidades_carregadas: localFsCfg?.total_entidades_carregadas,
      total_sqlites_gravados: localFsCfg?.total_sqlites_gravados,
      updated_at: new Date().toISOString(),
    };
    guardarLocalFsCentroConfig(novoCfg);
    setLocalFsCfg(novoCfg);
    setNomePropostoEscritorio(nomeLimpo);
    if (isCloudClient) {
      await syncCloudOfficeMetadata(novoCfg.id, novoCfg.nome, novoCfg.pasta_evogex_display, novoCfg.pasta_gexcel_antiga_display);
    } else {
      try {
        await fetch('http://127.0.0.1:8015/api/app/centros-dados', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            centro_id: novoCfg.id,
            nome: novoCfg.nome,
            hostname: novoCfg.hostname,
            pasta_evogex: novoCfg.pasta_evogex_display,
            pasta_gexcel_antiga: novoCfg.pasta_gexcel_antiga_display,
            tornar_ativo: true,
          }),
        });
      } catch {}
    }
    await refreshConfig();
    setMensagemSucesso(
      `Configuração gravada para '${novoCfg.nome}'! Ao fechar e voltar a abrir a aplicação, o nome e as pastas (${evoLimpo}${antLimpo ? ` e ${antLimpo}` : ''}) mantêm-se ligados.`
    );
  };

  const handleEscolherPastaEvogexDireto = async (customCaminhoProposto?: string, paraModal = false) => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    const activeCentro = centroEmEdicao || activeCentroSelecionado || centrosDadosLista.find(c => c.selecionado) || centrosDadosLista[0];
    const targetId = activeCentro?.id || localFsCfg?.id || 'escritorio-principal';
    const prop =
      (customCaminhoProposto ?? (paraModal ? formCentroPastaEvogex : caminhoPropostoEvogex)).trim() ||
      sugerirPastaEvogexPorEscritorio(targetId, activeCentro?.office_seq);
    const res = await escolherEInstalarPastaDadosEvogex({
      centroId: targetId,
      officeSeq: activeCentro?.office_seq,
      nomeCentro: paraModal ? formCentroNome : (nomePropostoEscritorio.trim() || activeCentro?.nome || localFsCfg?.nome || 'Escritório Principal'),
      hostname: paraModal ? formCentroHost : (localFsCfg?.hostname || 'COMPUTADOR-LOCAL'),
      caminhoProposto: prop,
    });
    if (res.ok && res.config) {
      setLocalFsCfg(res.config);
      setNomePropostoEscritorio(res.config.nome);
      setCaminhoPropostoEvogex(res.config.pasta_evogex_display);
      if (paraModal) {
        setFormCentroPastaEvogex(res.config.pasta_evogex_display);
        if (res.config.pasta_gexcel_antiga_display) {
          setFormCentroPastaAntiga(res.config.pasta_gexcel_antiga_display);
        }
      }
      await syncCloudOfficeMetadata(
        res.config.id,
        res.config.nome,
        res.config.pasta_evogex_display,
        res.config.pasta_gexcel_antiga_display
      );
      await refreshConfig();
      setMensagemSucesso(
        `Pasta '${res.config.pasta_evogex_display}' criada e ligada ao escritório '${res.config.nome}'! Estrutura e bases SQLite gravadas no disco.`
      );
    } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
      setMensagemErro(res.erro);
    }
  };

  const handleEscolherPastaAntigaDireto = async (customCaminhoProposto?: string, paraModal = false) => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    const activeCentro = centroEmEdicao || activeCentroSelecionado || centrosDadosLista.find(c => c.selecionado) || centrosDadosLista[0];
    const targetId = activeCentro?.id || localFsCfg?.id || 'escritorio-principal';
    const prop = (customCaminhoProposto ?? (paraModal ? formCentroPastaAntiga : caminhoPropostoAntiga)).trim() || 'C:\\Dados_GexcelApps';
    const res = await escolherPastaDadosGexcelAntigos(prop, targetId);
    if (res.ok && res.config) {
      setLocalFsCfg(res.config);
      setCaminhoPropostoAntiga(res.config.pasta_gexcel_antiga_display);
      if (res.config.pasta_evogex_display) {
        setCaminhoPropostoEvogex(res.config.pasta_evogex_display);
      }
      if (paraModal) {
        setFormCentroPastaAntiga(res.config.pasta_gexcel_antiga_display);
        if (res.config.pasta_evogex_display && !formCentroPastaEvogex) {
          setFormCentroPastaEvogex(res.config.pasta_evogex_display);
        }
      }
      await syncCloudOfficeMetadata(
        res.config.id,
        res.config.nome,
        res.config.pasta_evogex_display,
        res.config.pasta_gexcel_antiga_display
      );
      await refreshConfig();
      if (res.erro) {
        setMensagemSucesso(res.erro);
      } else {
        setMensagemSucesso(
          `Pasta antiga '${res.config.pasta_gexcel_antiga_display}' ligada! ${res.totalEntidades || 0} empresas carregadas automaticamente para o sistema.`
        );
      }
    } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
      setMensagemErro(res.erro);
    }
  };

  const handleSincronizarSqlitesAgora = async () => {
    setSincronizandoSqlites(true);
    setMensagemErro(null);
    setMensagemSucesso(null);
    try {
      const total = await sincronizarSqlitesParaPastaLocal(undefined, true);
      if (total > 0) {
        setMensagemSucesso(`${total} ficheiro(s) SQLite (.db) atualizados e gravados diretamente na sua pasta BdsefaturaV4 local.`);
      } else {
        await handleEscolherPastaEvogexDireto();
      }
    } finally {
      setSincronizandoSqlites(false);
    }
  };

  const handleToggleXmlLegado = async (novoEstado: boolean) => {
    setAlimentarXmlLegado(novoEstado);
    localStorage.setItem('gexcel_alimentar_xml_legado', String(novoEstado));
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/config/xml-legado', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ alimentar_xml_legado: novoEstado }),
      });
      if (res.ok) {
        setMensagemSucesso(
          novoEstado
            ? 'Alimentação paralela dos ficheiros XML do evoGex Apps (BdsefaturaV3 e BdsRV) ATIVADA.'
            : 'Modo 100% SQLite (BdsefaturaV4) ativo — geração de ficheiros XML legados desativada.'
        );
      }
    } catch {}
  };

  const abrirModalNovoCentro = () => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório ser Administrador para adicionar Centros de Dados.');
      return;
    }
    const num = centrosDadosLista.length + 1;
    setCentroEmEdicao(null);
    setFormCentroNome(num === 1 ? 'Escritório Principal' : `Escritório ${num}`);
    setFormCentroHost(localFsCfg?.hostname || appConfig?.centro_dados_hostname || 'SERVIDOR-ESCRITORIO');
    setFormCentroPastaEvogex(localFsCfg?.pasta_evogex_display || caminhoPropostoEvogex || 'C:\\Dados_evoGex');
    setFormCentroPastaAntiga(localFsCfg?.pasta_gexcel_antiga_display || caminhoPropostoAntiga || 'C:\\Dados_GexcelApps');
    setModalCentroAberto(true);
  };

  const abrirModalEditarCentro = (centro: CentroDadosItem) => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório ser Administrador para editar Centros de Dados.');
      return;
    }
    setCentroEmEdicao(centro);
    setFormCentroNome(centro.nome);
    setFormCentroHost(centro.hostname || 'SERVIDOR-ESCRITORIO');
    setFormCentroPastaEvogex(centro.pasta_evogex || 'C:\\Dados_evoGex');
    setFormCentroPastaAntiga(centro.pasta_gexcel_antiga || 'C:\\Dados_GexcelApps');
    setModalCentroAberto(true);
  };

  const handleGuardarCentroModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoCentro(true);
    setMensagemSucesso(null);
    setMensagemErro(null);
    const targetId = centroEmEdicao?.id || activeCentroSelecionado?.id || localFsCfg?.id || 'escritorio-principal';
    const nomeLimpo = formCentroNome.trim() || 'Escritório Principal';
    const hostLimpo = formCentroHost.trim() || 'SERVIDOR-ESCRITORIO';
    const pastaEvoLimpa = formCentroPastaEvogex.trim() || sugerirPastaEvogexPorEscritorio(targetId, centroEmEdicao?.office_seq);
    const pastaAntLimpa = formCentroPastaAntiga.trim() || '';

    const novoCfg: LocalFsCentroConfig = {
      id: targetId,
      nome: nomeLimpo,
      hostname: hostLimpo,
      pasta_evogex_display: pastaEvoLimpa,
      pasta_motor_display: `${pastaEvoLimpa}\\motor`,
      pasta_v4_display: `${pastaEvoLimpa}\\BdsefaturaV4`,
      pasta_v3_display: `${pastaAntLimpa || 'C:\\Dados_GexcelApps'}\\BdsefaturaV3`,
      pasta_bdsrv_display: `${pastaAntLimpa || 'C:\\Dados_GexcelApps'}\\BdsRV`,
      pasta_pdfs_display: `${pastaEvoLimpa}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: pastaAntLimpa,
      ligado: true,
      evogex_confirmado: Boolean(centroEmEdicao?.evogex_confirmado || localFsCfg?.evogex_confirmado),
      antiga_confirmada: Boolean(pastaAntLimpa),
      total_entidades_carregadas: localFsCfg?.total_entidades_carregadas,
      total_sqlites_gravados: localFsCfg?.total_sqlites_gravados,
      updated_at: new Date().toISOString(),
    };
    guardarLocalFsCentroConfig(novoCfg);
    setLocalFsCfg(novoCfg);
    if (!activeCentroSelecionado || activeCentroSelecionado.id === targetId || centroEmEdicao?.selecionado) {
      setNomePropostoEscritorio(nomeLimpo);
    }
    setCaminhoPropostoEvogex(pastaEvoLimpa);
    if (pastaAntLimpa) setCaminhoPropostoAntiga(pastaAntLimpa);

    try {
      if (isCloudClient) {
        await syncCloudOfficeMetadata(targetId, nomeLimpo, pastaEvoLimpa, pastaAntLimpa);
      } else {
        await fetch('http://127.0.0.1:8015/api/app/centros-dados', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            centro_id: centroEmEdicao?.id,
            nome: nomeLimpo,
            hostname: hostLimpo,
            pasta_evogex: pastaEvoLimpa,
            pasta_gexcel_antiga: pastaAntLimpa,
            tornar_ativo: true,
          }),
        });
      }
      await refreshConfig();
    } catch {
      // guardado localmente no posto
    } finally {
      setModalCentroAberto(false);
      setSalvandoCentro(false);
      setMensagemSucesso(`Escritório '${nomeLimpo}' configurado em '${pastaEvoLimpa}'.`);
    }
  };

  const abrirCriacaoUser = (rolePredefinido: 'subutilizador' | 'admin' = 'subutilizador') => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
      return;
    }
    if (!hasAnyFreeSeat) {
      setMensagemErro(`Limite de vagas atingido em todos os escritórios (${lugaresOcupados}/${maxUsers}). Amplie as vagas do escritório na licença antes de adicionar novos colaboradores.`);
      return;
    }
    setUserEmEdicao(null);
    setFormNome('');
    setFormUsername('');
    setFormEmail('');
    setFormTelefone('');
    setFormRole(rolePredefinido);
    setFormPassword('');
    setFormAtivo(true);
    const activeCid = localFsCfg?.id || centrosDadosLista[0]?.id;
    setFormTodosCentros(!isCloudClient || centrosDadosLista.length <= 1);
    setFormCentrosSelecionados(
      isCloudClient && activeCid ? [activeCid] : centrosDadosLista.map(c => c.id)
    );
    setFormAllowedApps(availableApps.map(a => a.code));
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  const abrirEdicaoUser = (user: AppUser) => {
    if (!isLoggedIn) {
      setMensagemErro('Permissão negada. Inicie sessão para gerir o seu perfil.');
      return;
    }
    const isSelf =
      currentUser &&
      ((user.cloud_id && currentUser.cloud_id && user.cloud_id === currentUser.cloud_id) ||
        user.username.toLowerCase() === currentUser.username.toLowerCase() ||
        user.id === currentUser.id);

    if (isSub && !isSelf) {
      setMensagemErro('Permissão negada. Um subutilizador não tem permissão para editar outros utilizadores.');
      return;
    }

    if (isAdm && user.role === 'admin' && !isSelf) {
      setMensagemErro('Não é permitido editar a conta de outro Administrador.');
      return;
    }

    const perms = user.office_ids && user.office_ids.length > 0 ? user.office_ids : (user.centros_permitidos || ['*']);
    const isAll = perms.includes('*') || user.role === 'admin' || user.role === 'superadmin';

    setUserEmEdicao(user);
    setFormNome(user.nome);
    setFormUsername(user.username);
    setFormEmail(user.email || '');
    setFormTelefone(user.telefone || '');
    setFormRole(user.role as any);
    setFormPassword('');
    setFormAtivo(user.ativo);
    setFormTodosCentros(isAll);
    setFormCentrosSelecionados(isAll ? centrosDadosLista.map(c => c.id) : perms);
    const allCodes = availableApps.map(a => a.code);
    const userApps = user.allowed_apps;
    setFormAllowedApps(
      isAll || !Array.isArray(userApps) || userApps.length === 0 || userApps.includes('*')
        ? allCodes
        : userApps
    );
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  const toggleCentroUserCheckbox = (cid: string) => {
    setFormCentrosSelecionados(prev =>
      prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
    );
  };

  const toggleAllowedAppCheckbox = (code: string) => {
    setFormAllowedApps(prev =>
      prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]
    );
  };

  const handleGuardarUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoUser(true);
    setErroFormUser(null);

    const emailCheck = validateEmail(formEmail);
    if (!emailCheck.valid) {
      setErroFormUser(emailCheck.error);
      setSalvandoUser(false);
      return;
    }
    const phoneCheck = validatePhone(formTelefone, formRole === 'admin');
    if (!phoneCheck.valid) {
      setErroFormUser(phoneCheck.error);
      setSalvandoUser(false);
      return;
    }

    const centrosPayload =
      formRole === 'admin' || formTodosCentros
        ? ['*']
        : formCentrosSelecionados.length > 0
        ? formCentrosSelecionados
        : ['*'];

    try {
      if (isCloudClient) {
        const officeIdsCloud =
          formRole === 'admin'
            ? ['*']
            : formTodosCentros
            ? centrosDadosLista.map(c => c.id)
            : formCentrosSelecionados;
        if (formRole === 'subutilizador' && formAtivo && officeIdsCloud.length === 0) {
          setErroFormUser('Selecione pelo menos 1 escritório autorizado para este operador.');
          setSalvandoUser(false);
          return;
        }
        if (formRole === 'subutilizador' && formAtivo && formAllowedApps.length === 0) {
          setErroFormUser('Selecione pelo menos 1 módulo autorizado para este operador.');
          setSalvandoUser(false);
          return;
        }
        const allowedAppsPayload =
          formRole === 'admin'
            ? ['*']
            : formAllowedApps.length >= availableApps.length
            ? ['*']
            : formAllowedApps;
        if (!userEmEdicao && (!formPassword.trim() || formPassword.trim().length < 4)) {
          setErroFormUser('A palavra-passe deve ter pelo menos 4 caracteres.');
          setSalvandoUser(false);
          return;
        }
        const effectiveUname = userEmEdicao ? (formUsername.trim() || emailCheck.normalized) : emailCheck.normalized;
        const res = await fetch('/api/auth/client/users/save', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            id: userEmEdicao?.cloud_id,
            nome: formNome.trim(),
            username: effectiveUname,
            email: emailCheck.normalized,
            telefone: phoneCheck.normalized,
            role: formRole === 'admin' ? 'ADMIN' : 'OPERADOR',
            password: formPassword.trim(),
            ativo: formAtivo,
            officeIds: officeIdsCloud,
            allowedApps: allowedAppsPayload,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setModalUserAberto(false);
          aplicarEstadoNuvem(data);
          await refreshClientCloudState();
          if (data.transferPending) {
            setMensagemSucesso(
              data.message ||
                `Pedido de transferência criado para '${emailCheck.normalized}'. O colaborador deve confirmar no login com a palavra-passe anterior.`
            );
          } else if (data.transferredImmediate) {
            setMensagemSucesso(
              data.message ||
                `Utilizador '${emailCheck.normalized}' transferido de imediato e ativado neste escritório.`
            );
          } else {
            setMensagemSucesso(
              userEmEdicao
                ? `Utilizador '${emailCheck.normalized}' atualizado com sucesso.`
                : `Utilizador '${emailCheck.normalized}' criado e sincronizado na conta da empresa.`
            );
          }
        } else {
          setErroFormUser(data?.detail || data?.error || 'Falha ao guardar utilizador.');
        }
        return;
      }

      if (userEmEdicao) {
        const isSelf = currentUser && userEmEdicao.id === currentUser.id;

        if (isSub && !isSelf) {
          setErroFormUser('Permissão negada. Um subutilizador não pode editar contas de outros utilizadores.');
          setSalvandoUser(false);
          return;
        }

        const body: any = {
          nome: formNome.trim(),
          email: emailCheck.normalized,
          telefone: phoneCheck.normalized,
          role: isSub ? 'subutilizador' : formRole,
          ativo: isSub ? true : formAtivo,
          centros_permitidos: isSub ? undefined : centrosPayload,
        };
        if (formPassword.trim()) {
          body.nova_password = formPassword.trim();
        }

        const res = await fetch(`http://127.0.0.1:8015/api/app/users/${userEmEdicao.id}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(body)
        });

        if (res.ok) {
          setModalUserAberto(false);
          await carregarListaUtilizadores();
          await refreshConfig();
          setMensagemSucesso(`Utilizador '${formUsername}' atualizado com sucesso.`);
        } else {
          const err = await res.json();
          setErroFormUser(err.detail || 'Falha ao atualizar utilizador.');
        }
      } else {
        if (!canManage) {
          setErroFormUser('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
          setSalvandoUser(false);
          return;
        }

        if (lugaresOcupados >= maxUsers) {
          setErroFormUser(`Limite de utilizadores atingido (${lugaresOcupados}/${maxUsers}).`);
          setSalvandoUser(false);
          return;
        }

        if (!formPassword.trim() || formPassword.trim().length < 4) {
          setErroFormUser('A palavra-passe deve ter pelo menos 4 caracteres.');
          setSalvandoUser(false);
          return;
        }

        const effectiveUnameLocal = formUsername.trim() || emailCheck.normalized;
        const res = await fetch('http://127.0.0.1:8015/api/app/users', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            nome: formNome.trim(),
            username: effectiveUnameLocal,
            email: emailCheck.normalized,
            telefone: phoneCheck.normalized,
            role: formRole,
            password: formPassword.trim(),
            centros_permitidos: centrosPayload,
          })
        });

        if (res.ok) {
          setModalUserAberto(false);
          await carregarListaUtilizadores();
          await refreshConfig();
          setMensagemSucesso(`Utilizador '${effectiveUnameLocal}' criado com sucesso.`);
        } else {
          const err = await res.json();
          setErroFormUser(err.detail || 'Falha ao criar utilizador.');
        }
      }
    } catch (err: any) {
      setErroFormUser(err.message || 'Erro ao comunicar com a API.');
    } finally {
      setSalvandoUser(false);
    }
  };

  const handleEliminarUser = async (user: AppUser) => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para eliminar utilizadores.');
      return;
    }

    const isSelf =
      currentUser &&
      ((user.cloud_id && currentUser.cloud_id && user.cloud_id === currentUser.cloud_id) ||
        user.username.toLowerCase() === currentUser.username.toLowerCase() ||
        user.id === currentUser.id);
    if (isSelf) {
      setMensagemErro('Operação recusada: Não é permitido eliminar a sua própria conta enquanto a sua sessão estiver ativa.');
      return;
    }

    if (isAdm && user.role === 'admin') {
      setMensagemErro('Não tem permissão para eliminar outras contas de Administrador.');
      return;
    }

    const conf = window.confirm(`Tem a certeza de que deseja eliminar o utilizador '${user.nome}' (@${user.username})?`);
    if (!conf) return;

    try {
      if (isCloudClient && user.cloud_id) {
        const res = await fetch('/api/auth/client/users/delete', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ userId: user.cloud_id }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          await carregarListaUtilizadores();
          await refreshClientCloudState();
          setMensagemSucesso(`Utilizador '${user.username}' removido com sucesso.`);
        } else {
          setMensagemErro(data?.detail || data?.error || 'Falha ao remover utilizador.');
        }
        return;
      }

      const res = await fetch(`http://127.0.0.1:8015/api/app/users/${user.id}`, { 
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        await carregarListaUtilizadores();
        await refreshConfig();
        setMensagemSucesso(`Utilizador '${user.username}' removido com sucesso.`);
      } else {
        const err = await res.json();
        alert(err.detail || 'Falha ao remover utilizador.');
      }
    } catch (e: any) {
      alert(e.message || 'Erro de comunicação.');
    }
  };

  const handleCancelarTransferencia = async (transferId: string, email: string) => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    try {
      const res = await fetch('/api/auth/client/users/transfer/cancel', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ transferId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        aplicarEstadoNuvem(data);
        setMensagemSucesso(`Pedido de transferência para '${email}' cancelado.`);
      } else {
        setMensagemErro(data?.detail || data?.error || 'Não foi possível cancelar o pedido de transferência.');
      }
    } catch {
      setMensagemErro('Erro de comunicação ao cancelar o pedido de transferência.');
    }
  };

  const handleAutorizarCasa = async (u: AppUser, durationDays: 1 | 7 | 30) => {
    if (!u.cloud_id) return;
    setTeleworkBusyId(u.cloud_id);
    setMensagemErro(null);
    setMensagemSucesso(null);
    try {
      const res = await fetch('/api/auth/client/users/telework/authorize', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ userId: u.cloud_id, durationDays }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        aplicarEstadoNuvem(data);
        setTeleworkPickerUserId(null);
        setNovoCodigoCasaBanner({
          nome: u.nome,
          code: String(data.pairingCode || ''),
          expiresAt: String(data.expiresAt || ''),
        });
        setMensagemSucesso(
          `Teletrabalho autorizado para ${u.nome} (${durationDays} ${durationDays === 1 ? 'dia' : 'dias'}). Código de emparelhamento: ${data.pairingCode}`
        );
      } else {
        setMensagemErro(data?.detail || data?.error || 'Não foi possível autorizar o acesso externo.');
      }
    } finally {
      setTeleworkBusyId(null);
    }
  };

  const handleCortarCasa = async (u: AppUser) => {
    if (!u.cloud_id) return;
    setTeleworkBusyId(u.cloud_id);
    setMensagemErro(null);
    setMensagemSucesso(null);
    try {
      const res = await fetch('/api/auth/client/users/telework/revoke', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ userId: u.cloud_id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        aplicarEstadoNuvem(data);
        setTeleworkPickerUserId(null);
        setMensagemSucesso(`Acesso externo cortado de imediato. '${u.nome}' regressou a «Só no Escritório».`);
      } else {
        setMensagemErro(data?.detail || data?.error || 'Falha ao cortar sessão externa.');
      }
    } finally {
      setTeleworkBusyId(null);
    }
  };

  const handleAutorizarRedeAtualEscritorio = async () => {
    setMensagemErro(null);
    setMensagemSucesso(null);
    try {
      const res = await fetch('/api/auth/client/office/trust-current-ip', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ label: activeCentroSelecionado?.nome || 'Rede do Escritório' }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        aplicarEstadoNuvem(data);
        setMensagemSucesso(`Rede atual (${data.registeredIp || 'IP'}) registada como rede oficial do escritório.`);
      } else {
        setMensagemErro(data?.detail || data?.error || 'Não foi possível autorizar esta rede.');
      }
    } catch {
      setMensagemErro('Erro de comunicação ao registar a rede do escritório.');
    }
  };

  const handleArquivarAlertaSeguranca = async (alertId: string) => {
    try {
      const res = await fetch('/api/auth/client/alerts/dismiss', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ alertId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        aplicarEstadoNuvem(data);
      }
    } catch {}
  };

  const renderSortIndicator = (col: UserSortColumn) => {
    if (sortCol !== col) {
      return <span className="ml-1 opacity-40 text-[10px]">⇅</span>;
    }
    return <span className="ml-1 text-[#0284c7] dark:text-sky-400 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const baseEvogexAtiva =
    localFsCfg?.pasta_evogex_display ||
    pastasLocais.pasta_evogex ||
    (/dados_evogex/i.test(pastaRaizRealMotor) ? pastaRaizRealMotor : '') ||
    caminhoPropostoEvogex ||
    'C:\\Dados_evoGex';

  const baseAntigaAtiva =
    localFsCfg?.pasta_gexcel_antiga_display ||
    (!/dados_evogex/i.test(pastaRaizRealMotor) && pastaRaizRealMotor ? pastaRaizRealMotor : '') ||
    caminhoPropostoAntiga ||
    'C:\\Dados_GexcelApps';

  const itensPastas = [
    {
      id: 'evogex_raiz',
      subpasta: undefined as string | undefined,
      tipoSelecao: 'evogex' as const,
      titulo: 'Pasta Unificada do Centro de Dados (Dados evoGex)',
      subtitulo: 'Diretório central onde residem o Motor, SafeDrive, PocketBase e Bases SQLite',
      caminho: baseEvogexAtiva,
    },
    {
      id: 'evogex_motor',
      subpasta: 'motor',
      tipoSelecao: 'evogex' as const,
      titulo: 'Motor Local & Ponte do Centro de Dados (Dados_evoGex\\motor)',
      subtitulo: 'Motor instalado junto ao Centro de Dados (usado localmente e pelos portáteis em casa)',
      caminho: localFsCfg?.pasta_motor_display || pastasLocais.pasta_motor || `${baseEvogexAtiva}\\motor`,
    },
    {
      id: 'v4',
      subpasta: 'BdsefaturaV4',
      tipoSelecao: 'evogex' as const,
      titulo: 'Bases SQLite Modernas (BdsefaturaV4)',
      subtitulo: 'Faturas de compras, vendas, anuladas, recibos verdes e controlo geral',
      caminho: localFsCfg?.pasta_v4_display || pastasLocais.pasta_v4 || `${baseEvogexAtiva}\\BdsefaturaV4`,
    },
    {
      id: 'v3',
      subpasta: 'BdsefaturaV3',
      tipoSelecao: 'antiga' as const,
      titulo: 'Ficheiros XML e-Fatura Antigos (BdsefaturaV3)',
      subtitulo: 'Alimentação paralela de compatibilidade com os mapas Excel (Dados GexcelApps)',
      caminho: localFsCfg?.pasta_v3_display || pastasLocais.pasta_v3 || `${baseAntigaAtiva}\\BdsefaturaV3`,
    },
    {
      id: 'bdsrv',
      subpasta: 'BdsRV',
      tipoSelecao: 'antiga' as const,
      titulo: 'Ficheiros XML Recibos Verdes & Rendas (BdsRV)',
      subtitulo: 'Repositório estruturado de Recibos Verdes e Recibos de Renda por ano e NIF',
      caminho: localFsCfg?.pasta_bdsrv_display || pastasLocais.pasta_bdsrv || `${baseAntigaAtiva}\\BdsRV`,
    },
    {
      id: 'pdfs',
      subpasta: 'PDFs_Recibos',
      tipoSelecao: 'evogex' as const,
      titulo: 'Comprovativos PDF de Recibos Verdes & Rendas',
      subtitulo: 'Pasta destino dos documentos PDF oficiais descarregados da AT',
      caminho: localFsCfg?.pasta_pdfs_display || pastasLocais.pasta_pdfs || `${baseEvogexAtiva}\\PDFs_Recibos`,
    },
  ];

  return (
    <div className="h-full flex flex-col space-y-4 min-h-0 select-none overflow-y-auto pr-1">
      
      {/* 1. Cabeçalho Oficial evoGex.com */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Painel de Controlo · evoGex.com
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center">
            Configurações do Sistema & Centros de Dados
          </h1>
          <p className="page-description text-slate-700 dark:text-slate-300 text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Centros de Dados nomeados (Dados evoGex + Motor unificado), diretórios locais e acessos da equipa.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const base = getEvoSubdomainUrl('entidades');
              const qs = new URLSearchParams();
              if (token) qs.set('sso', token);
              qs.set('return_to', `${window.location.origin}/`);
              window.open(`${base}/?${qs.toString()}`, '_blank', 'noopener,noreferrer');
            }}
            className="flex items-center space-x-1.5 bg-sky-50 dark:bg-[#0a1929] hover:bg-sky-100 dark:hover:bg-[#0e243b] border border-sky-300 dark:border-sky-700 px-3 py-1.5 rounded-full text-xs font-mono font-semibold text-sky-900 dark:text-sky-200 cursor-pointer transition-colors"
          >
            <span>Abrir Gestor de Entidades</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <span className="text-slate-700 dark:text-slate-300">
              Centro Ativo: <strong className="text-foreground">{localFsCfg?.nome || appConfig?.centro_dados_nome || 'Escritório Principal'}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Alertas de Notificação (100% Opacos) */}
      {mensagemSucesso && (
        <div className="p-3 bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-800 rounded-md text-emerald-800 dark:text-emerald-300 font-mono text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{mensagemSucesso}</span>
          </div>
          <button type="button" onClick={() => setMensagemSucesso(null)} className="text-emerald-700 dark:text-emerald-400 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mensagemErro && (
        <div className="p-3 bg-rose-50 dark:bg-[#290f14] border border-rose-400 dark:border-rose-800 rounded-md text-rose-800 dark:text-rose-300 font-mono text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
          <button type="button" onClick={() => setMensagemErro(null)} className="text-rose-700 dark:text-rose-400 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Barra de Navegação Passo a Passo (1 passo de cada vez, ultra-limpo) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 shrink-0 font-mono text-xs">
        <button
          type="button"
          onClick={() => setPassoAtivo(1)}
          className={`p-3 rounded-md border text-left transition flex items-center justify-between cursor-pointer ${
            passoAtivo === 1
              ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-2xs'
              : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] hover:border-slate-400'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                passoAtivo === 1
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-slate-200 dark:bg-[#132233] text-slate-700 dark:text-slate-300'
              }`}
            >
              1
            </span>
            <div className="min-w-0">
              <span className="font-bold text-foreground block truncate">Onde Instalar Dados evoGex</span>
              <span className="text-[10.5px] text-slate-600 dark:text-slate-400 block truncate">
                {baseEvogexAtiva}
              </span>
            </div>
          </div>
          {localFsCfg?.evogex_confirmado ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />
          ) : (
            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-[#241a08] text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-bold shrink-0 ml-2">
              Ligar Pasta
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setPassoAtivo(2)}
          className={`p-3 rounded-md border text-left transition flex items-center justify-between cursor-pointer ${
            passoAtivo === 2
              ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-2xs'
              : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] hover:border-slate-400'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                passoAtivo === 2
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-slate-200 dark:bg-[#132233] text-slate-700 dark:text-slate-300'
              }`}
            >
              2
            </span>
            <div className="min-w-0">
              <span className="font-bold text-foreground block truncate">Carregar Empresas do Excel Antigo</span>
              <span className="text-[10.5px] text-slate-600 dark:text-slate-400 block truncate">
                {localFsCfg?.pasta_gexcel_antiga_display || 'Selecionar pasta antiga (GexcelApps)'}
              </span>
            </div>
          </div>
          {localFsCfg?.pasta_gexcel_antiga_display && (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setPassoAtivo(3)}
          className={`p-3 rounded-md border text-left transition flex items-center justify-between cursor-pointer ${
            passoAtivo === 3
              ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-2xs'
              : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] hover:border-slate-400'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                passoAtivo === 3
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-slate-200 dark:bg-[#132233] text-slate-700 dark:text-slate-300'
              }`}
            >
              3
            </span>
            <div className="min-w-0">
              <span className="font-bold text-foreground block truncate">Utilizadores & Acessos da Equipa</span>
              <span className="text-[10.5px] text-slate-600 dark:text-slate-400 block truncate">
                {lugaresOcupados} / {maxUsers} lugares ativos
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* PASSO 1: ONDE INSTALAR OS NOVOS DADOS EVOGEX */}
      {passoAtivo === 1 && (
        <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-5 space-y-5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#0284c7] dark:text-sky-400 font-bold block">
                Passo 1 de 3 · Instalação Principal
              </span>
              <h2 className="text-base font-display font-light text-foreground mt-0.5">
                Onde pretende instalar e guardar os novos dados (Dados_evoGex)?
              </h2>
            </div>
            {isCloudClient ? (
              <span className="px-3 py-1.5 rounded bg-sky-50 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200 font-mono text-xs font-semibold shrink-0">
                Conta {clientCode} · {centrosDadosLista.length} Escritório(s)
              </span>
            ) : canManage ? (
              <button
                type="button"
                onClick={abrirModalNovoCentro}
                className="px-3 py-1.5 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition"
              >
                <Plus className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                <span>+ Outro Escritório / Servidor</span>
              </button>
            ) : null}
          </div>

          <div className="p-4 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-3 font-mono text-xs">
            <div className="space-y-1.5 pb-2 border-b border-slate-200 dark:border-[#222f3e]">
              <label className="block text-xs font-bold text-foreground">
                Nome deste Escritório (visível no menu lateral e cabeçalhos):
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={nomePropostoEscritorio}
                  onChange={e => setNomePropostoEscritorio(e.target.value)}
                  disabled={!canManage}
                  placeholder="Ex: Escritório Principal, Escritório do Porto, Sede Maia..."
                  className="flex-1 min-w-[240px] h-9 px-3 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs outline-hidden focus:ring-1 focus:ring-[#0284c7] disabled:opacity-65 disabled:cursor-not-allowed"
                />
                {!canManage && (
                  <span className="text-[10.5px] text-slate-600 dark:text-slate-400">
                    Apenas o Administrador pode alterar o nome do escritório.
                  </span>
                )}
              </div>
            </div>

            <label className="block text-xs font-bold text-foreground">
              Pasta principal onde ficam as novas bases de dados SQLite (padrão recomendado: <code className="text-[#0284c7] dark:text-sky-400">C:\Dados_evoGex</code>):
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={caminhoPropostoEvogex}
                onChange={e => setCaminhoPropostoEvogex(e.target.value)}
                placeholder="C:\Dados_evoGex"
                className="flex-1 min-w-[240px] h-9 px-3 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs outline-hidden focus:ring-1 focus:ring-[#0284c7]"
              />
              <button
                type="button"
                onClick={() => handleEscolherPastaEvogexDireto()}
                className="h-9 px-4 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-xs font-semibold flex items-center space-x-2 shrink-0 cursor-pointer transition shadow-2xs"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Escolher / Ligar Pasta no Computador</span>
              </button>
              <button
                type="button"
                onClick={handleGuardarFixarConfiguracao}
                className="h-9 px-3.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center space-x-1.5 shrink-0 cursor-pointer transition shadow-2xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Guardar Configuração</span>
              </button>
              <button
                type="button"
                onClick={handleSincronizarSqlitesAgora}
                disabled={sincronizandoSqlites}
                className="h-9 px-3.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center space-x-1.5 shrink-0 cursor-pointer transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sincronizandoSqlites ? 'animate-spin' : ''}`} />
                <span>{sincronizandoSqlites ? 'A gravar SQLites...' : 'Atualizar Bases SQLite na Pasta'}</span>
              </button>
            </div>

            {localFsCfg?.evogex_confirmado ? (
              <div className="p-2.5 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  <strong>Pasta ligada e gravada permanentemente:</strong> {baseEvogexAtiva} (mantém-se ativa ao fechar e reabrir a aplicação).
                </span>
              </div>
            ) : (
              <div className="p-2.5 rounded bg-amber-50 dark:bg-[#241a08] border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>
                  Clique no botão azul <strong>"Escolher / Ligar Pasta no Computador"</strong> e selecione <code>C:\Dados_evoGex</code> para o navegador abrir diretamente essa pasta e gravar aí os ficheiros SQLite.
                </span>
              </div>
            )}
          </div>

          {/* Lista de Escritórios / Pastas Isoladas */}
          <div className="space-y-2">
            {centrosDadosLista.map(centro => {
              const pathEvogex = centro.pasta_evogex || baseEvogexAtiva;
              return (
                <div
                  key={centro.id}
                  className={`p-3.5 rounded-md border flex flex-wrap items-center justify-between gap-3 font-mono text-xs ${
                    centro.selecionado
                      ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7]'
                      : 'bg-slate-50 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e]'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />
                      {centro.id !== 'escritorio-principal' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-[#253a52] font-bold">
                          {centro.id}
                        </span>
                      )}
                      <span className="font-bold text-foreground">{centro.nome}</span>
                      {centro.max_users !== undefined && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] text-[#0284c7] dark:text-sky-300 font-bold border border-sky-300 dark:border-sky-800">
                          {centro.occupied_users ?? 0}/{centro.max_users} vagas
                        </span>
                      )}
                      {centro.selecionado && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800">
                          ATIVO
                        </span>
                      )}
                      {!centro.evogex_confirmado && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 dark:bg-[#241a08] text-amber-800 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-700">
                          Pasta por ligar
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-slate-700 dark:text-slate-300 break-all">
                      <span>Pasta Dados evoGex:</span>
                      <strong className="text-foreground break-all" title={pathEvogex}>
                        {pathEvogex}
                      </strong>
                      <button
                        type="button"
                        onClick={() => handleAbrirNoWindows(pathEvogex)}
                        title="Abrir no Explorador do Windows"
                        className="p-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-amber-600 dark:text-amber-400 cursor-pointer shrink-0"
                      >
                        <FolderOpen className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopiarCaminho(pathEvogex, centro.nome)}
                        title="Copiar endereço completo"
                        className="p-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300 cursor-pointer shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    {!centro.selecionado && (
                      <button
                        type="button"
                        onClick={() => handleSelecionarEscritorioPasso1(centro)}
                        className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-xs font-semibold cursor-pointer transition"
                      >
                        Selecionar Escritório
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAbrirNoWindows(`${pathEvogex}\\BdsefaturaV4`, 'BdsefaturaV4')}
                      className="px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs flex items-center space-x-1.5 cursor-pointer transition"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                      <span>Abrir SQLites</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => abrirModalEditarCentro(centro)}
                        className="px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition"
                        title="Editar nome ou pasta deste escritório"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                        <span>Editar Nome</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Subpastas Técnicas Opcionais (Recolhidas por defeito para não poluir a vista) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setMostrarPastasTecnicas(prev => !prev)}
              className="text-xs font-mono text-slate-600 dark:text-slate-400 hover:text-foreground underline cursor-pointer"
            >
              {mostrarPastasTecnicas
                ? 'Ocultar detalhe das 6 subpastas técnicas ▲'
                : 'Ver detalhe das 6 subpastas técnicas criadas automaticamente ▼'}
            </button>

            {mostrarPastasTecnicas && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3">
                {itensPastas.map(item => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] flex flex-col justify-between space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-xs text-foreground block">
                          {item.titulo}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAbrirNoWindows(item.caminho, item.subpasta, item.tipoSelecao)}
                          className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-[10px] font-mono text-foreground flex items-center space-x-1 cursor-pointer"
                        >
                          <FolderOpen className="w-3 h-3 text-amber-500" />
                          <span>Abrir</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopiarCaminho(item.caminho, item.titulo)}
                          className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-[10px] font-mono text-foreground flex items-center space-x-1 cursor-pointer"
                        >
                          <Copy className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                          <span>Copiar</span>
                        </button>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 bg-white dark:bg-[#0c1520] px-2.5 py-1 rounded border border-slate-200 dark:border-[#222f3e] break-all select-text">
                      {item.caminho}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-3 border-t border-slate-200 dark:border-[#222f3e]">
            <button
              type="button"
              onClick={() => setPassoAtivo(2)}
              className="px-4 py-2 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold cursor-pointer transition shadow-2xs"
            >
              Passo Seguinte: 2. Carregar Empresas do Excel Antigo →
            </button>
          </div>
        </div>
      )}

      {/* PASSO 2: CARREGAR EMPRESAS E DADOS ANTIGOS DO EXCEL (GEXCELAPPS) */}
      {passoAtivo === 2 && (
        <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-5 space-y-5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20">
          <div className="border-b border-slate-200 dark:border-[#222f3e] pb-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold block">
              Passo 2 de 3 · Ligação aos Dados Antigos do Excel
            </span>
            <h2 className="text-base font-display font-light text-foreground mt-0.5">
              Onde estão os dados antigos do Excel (GexcelApps / MultiIntegrador)?
            </h2>
          </div>

          <div className="p-4 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-3 font-mono text-xs">
            <label className="block text-xs font-bold text-foreground">
              Selecione a pasta antiga onde reside o ficheiro de empresas (<code className="text-emerald-600 dark:text-emerald-400">tCredenciais.xml</code>):
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={caminhoPropostoAntiga}
                onChange={e => setCaminhoPropostoAntiga(e.target.value)}
                placeholder="Ex: C:\Users\...\Dropbox\AA_MultiIntegrador ou C:\Dados_GexcelApps"
                className="flex-1 min-w-[240px] h-9 px-3 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs outline-hidden focus:ring-1 focus:ring-[#0284c7]"
              />
              <button
                type="button"
                onClick={() => handleEscolherPastaAntigaDireto()}
                className="h-9 px-4 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center space-x-2 shrink-0 cursor-pointer transition shadow-2xs"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Escolher Pasta Antiga e Carregar Empresas</span>
              </button>
              <button
                type="button"
                onClick={handleGuardarFixarConfiguracao}
                className="h-9 px-3.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-xs font-semibold flex items-center space-x-1.5 shrink-0 cursor-pointer transition shadow-2xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Guardar e Fixar Ligação</span>
              </button>
            </div>

            {localFsCfg?.pasta_gexcel_antiga_display && (
              <div className="p-3 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="truncate">
                    <strong>Gravado permanentemente:</strong> {localFsCfg.pasta_gexcel_antiga_display}
                    {localFsCfg.total_entidades_carregadas
                      ? ` (${localFsCfg.total_entidades_carregadas} empresas carregadas — mantém-se ligado ao fechar e reabrir a aplicação)`
                      : ' (mantém-se ligado ao fechar e reabrir a aplicação)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleAbrirNoWindows(localFsCfg.pasta_gexcel_antiga_display, undefined, 'antiga')}
                  className="px-2.5 py-1 rounded bg-white dark:bg-[#0c1520] border border-emerald-400 dark:border-emerald-800 text-xs flex items-center space-x-1 shrink-0 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                  <span>Abrir</span>
                </button>
              </div>
            )}
          </div>

          <label className="p-3.5 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-[#091e1a] flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={alimentarXmlLegado}
              onChange={e => handleToggleXmlLegado(e.target.checked)}
              className="mt-0.5 rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
            />
            <div className="space-y-0.5 font-mono">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-xs text-emerald-950 dark:text-emerald-200">
                  Alimentar em simultâneo os ficheiros antigos do Excel (BdsefaturaV3 e BdsRV)
                </span>
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                Mantém os mapas Excel antigos atualizados ao mesmo tempo que grava nas novas bases SQLite (<code className="text-[10.5px]">C:\Dados_evoGex\BdsefaturaV4</code>).
              </p>
            </div>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-[#222f3e]">
            <button
              type="button"
              onClick={() => setPassoAtivo(1)}
              className="px-4 py-2 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold cursor-pointer transition"
            >
              ← Passo Anterior: 1. Pasta Dados evoGex
            </button>
            <button
              type="button"
              onClick={() => setPassoAtivo(3)}
              className="px-4 py-2 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold cursor-pointer transition shadow-2xs"
            >
              Passo Seguinte: 3. Utilizadores & Acessos →
            </button>
          </div>
        </div>
      )}

      {/* PASSO 3: UTILIZADORES E ACESSOS DA EQUIPA */}
      {passoAtivo === 3 && (
        <div className="space-y-4">
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col justify-between before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                  Passo 3 de 3 · Sessão Ativa & Quota de Utilizadores ({lugaresOcupados} / {maxUsers})
                </span>
              </div>
              <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800">
                {currentUser ? (currentUser.role === 'admin' || currentUser.role === 'superadmin' ? 'ADMINISTRADOR' : 'OPERADOR') : 'SEM SESSÃO'}
              </span>
            </div>

            {currentUser && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e]">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-400 flex items-center justify-center font-mono font-bold text-sm border border-sky-300 dark:border-sky-800">
                    {currentUser.nome.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-semibold font-mono text-xs block text-foreground">
                      {currentUser.nome}
                    </span>
                    <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 block">
                      @{currentUser.username} {currentUser.email && `· ${currentUser.email}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={logout}
                    className="px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-xs font-mono transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <User className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
                    <span>Trocar de Operador</span>
                  </button>
                  <button
                    type="button"
                    onClick={logout}
                    className="px-3 py-1.5 rounded bg-rose-50 dark:bg-[#290f14] hover:bg-rose-100 dark:hover:bg-[#3b151d] border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Terminar Sessão</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-purple-500 before:z-20">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                  Utilizadores da Empresa & Perfis de Acesso ({lugaresOcupados}/{maxUsers})
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={carregarListaUtilizadores}
                  disabled={carregandoUsers}
                  className="p-1.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition cursor-pointer"
                  title="Atualizar lista de utilizadores"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${carregandoUsers ? 'animate-spin' : ''}`} />
                </button>

                {!isSub ? (
                  <>
                    <button
                      type="button"
                      onClick={() => abrirCriacaoUser('subutilizador')}
                      className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>+ Adicionar Operador</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => abrirCriacaoUser('admin')}
                      className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                      <span>+ Novo Administrador</span>
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e]">
                    Operador (Apenas Leitura)
                  </span>
                )}
              </div>
            </div>

            {isCloudClient && centrosDadosLista.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 font-mono text-xs">
                {centrosDadosLista.map(off => {
                  const occ = off.occupied_users ?? 0;
                  const max = off.max_users ?? maxUsers;
                  const full = occ >= max;
                  return (
                    <div
                      key={off.id}
                      className={`p-2.5 rounded border ${
                        off.selecionado
                          ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7]'
                          : 'bg-slate-50 dark:bg-[#132233] border-slate-300 dark:border-[#222f3e]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-foreground truncate">
                          {off.id !== 'escritorio-principal' ? `${off.id} · ` : ''}{off.nome}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                            full
                              ? 'bg-amber-100 dark:bg-[#241a08] text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                              : 'bg-emerald-100 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          }`}
                        >
                          {occ}/{max} vagas
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isCloudClient && (isAdm || isSuper) && (
              <div className="p-3 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-slate-800 dark:text-slate-200">
                    <Wifi className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    <span>
                      Rede do Escritório:{' '}
                      <strong>
                        {officeTrustedIps.length > 0
                          ? officeTrustedIps.map(item => item.ip).join(', ')
                          : 'Por registar'}
                      </strong>
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-semibold ${
                      activeExternalCount > 0
                        ? 'bg-emerald-50 dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                        : 'bg-white dark:bg-[#0c1520] border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5" />
                    <span>
                      {activeExternalCount > 0
                        ? `🟢 ${activeExternalCount} em Teletrabalho Ativo`
                        : '🔒 Todos Só no Escritório'}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAutorizarRedeAtualEscritorio}
                  className="px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-sky-50 dark:hover:bg-[#0a1929] border border-sky-300 dark:border-sky-700 text-[#0284c7] dark:text-sky-300 font-semibold cursor-pointer transition flex items-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Autorizar Rede Atual como Escritório</span>
                </button>
              </div>
            )}

            {isCloudClient && (isAdm || isSuper) && securityAlerts.length > 0 && (
              <div className="p-3 rounded-md bg-rose-50 dark:bg-[#290f14] border border-rose-300 dark:border-rose-800 space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-200">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Alertas de Segurança ({securityAlerts.length})</span>
                </div>
                <div className="space-y-1.5">
                  {securityAlerts.map(al => (
                    <div
                      key={al.id}
                      className="p-2 rounded bg-white dark:bg-[#0c1520] border border-rose-200 dark:border-rose-900 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-slate-800 dark:text-slate-200">{al.message}</span>
                      <button
                        type="button"
                        onClick={() => handleArquivarAlertaSeguranca(al.id)}
                        className="px-2 py-1 rounded bg-rose-100 dark:bg-[#3b151d] text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700 font-semibold shrink-0 cursor-pointer"
                      >
                        Arquivar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {novoCodigoCasaBanner && (
              <div className="p-3 rounded-md bg-emerald-50 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-700 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-emerald-950 dark:text-emerald-100">
                <div>
                  <span className="font-semibold">Código único para o portátil de {novoCodigoCasaBanner.nome}: </span>
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-emerald-400 dark:border-emerald-600 font-bold tracking-wider">
                    {novoCodigoCasaBanner.code}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopiarCaminho(novoCodigoCasaBanner.code, 'Código de Teletrabalho')}
                    className="px-2.5 py-1 rounded bg-white dark:bg-[#0c1520] border border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copiar Código</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNovoCodigoCasaBanner(null)}
                    className="p-1 rounded text-emerald-800 dark:text-emerald-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {isCloudClient && (isAdm || isSuper) && pendingTransfers.length > 0 && (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-[#241a08] border border-amber-300 dark:border-amber-700 space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>Transferências de Conta Pendentes ({pendingTransfers.length})</span>
                </div>
                <p className="text-[11px] text-amber-900 dark:text-amber-200">
                  Aguardam confirmação do colaborador no login com a palavra-passe da empresa antiga (ou código por e-mail) para cortar o vínculo anterior.
                </p>
                <div className="space-y-1.5">
                  {pendingTransfers.map(tr => (
                    <div
                      key={tr.id}
                      className="p-2 rounded bg-white dark:bg-[#0c1520] border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground">{tr.nome}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#132233] text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-[#222f3e]">
                          {tr.email}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700">
                          {tr.role === 'ADMIN' ? 'Administrador' : 'Operador'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCancelarTransferencia(tr.id, tr.email)}
                        className="px-2.5 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-rose-50 dark:hover:bg-[#2a1218] text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700 font-semibold cursor-pointer transition"
                      >
                        Cancelar Pedido
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded border border-slate-300 dark:border-[#222f3e]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-b border-slate-300 dark:border-[#222f3e] select-none">
                  <tr>
                    <th onClick={() => handleSortUsers('nome')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Nome / E-mail {renderSortIndicator('nome')}
                    </th>
                    <th onClick={() => handleSortUsers('email')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Contacto (E-mail / WhatsApp) {renderSortIndicator('email')}
                    </th>
                    <th onClick={() => handleSortUsers('role')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Perfil {renderSortIndicator('role')}
                    </th>
                    <th onClick={() => handleSortUsers('centros')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Centros Autorizados {renderSortIndicator('centros')}
                    </th>
                    <th onClick={() => handleSortUsers('modulos')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Módulos Autorizados {renderSortIndicator('modulos')}
                    </th>
                    <th onClick={() => handleSortUsers('teletrabalho')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Local / Teletrabalho {renderSortIndicator('teletrabalho')}
                    </th>
                    <th onClick={() => handleSortUsers('ativo')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Estado {renderSortIndicator('ativo')}
                    </th>
                    <th onClick={() => handleSortUsers('ultimo_login')} className="py-2 px-3 cursor-pointer hover:text-foreground transition">
                      Último Acesso {renderSortIndicator('ultimo_login')}
                    </th>
                    <th className="py-2 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#1b2b3d] bg-white dark:bg-[#0c1520]">
                  {utilizadoresOrdenados.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-600 dark:text-slate-400">
                        Nenhum operador adicional registado. Clique em &ldquo;+ Adicionar Operador&rdquo; para criar acessos para a sua equipa.
                      </td>
                    </tr>
                  ) : (
                    utilizadoresOrdenados.map(u => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-[#132233] transition">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-foreground">{u.nome}</span>
                            {u.username && u.username.toLowerCase() !== (u.email || '').toLowerCase() && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400">@{u.username}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                          <div>{u.email || '—'}</div>
                          {u.telefone && (
                            <div className="mt-0.5 inline-block text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                              WhatsApp: {formatPhoneDisplay(u.telefone)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            u.role === 'admin'
                              ? 'bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-800'
                              : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#222f3e]'
                          }`}>
                            {u.role === 'admin' ? 'ADMINISTRADOR' : 'OPERADOR'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-[10.5px] font-medium px-2 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-slate-800 dark:text-slate-200 border border-sky-200 dark:border-sky-900">
                            {formatarCentrosUser(u)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {u.role === 'admin' || !Array.isArray(u.allowed_apps) || u.allowed_apps.length === 0 || u.allowed_apps.includes('*') ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                              Todos
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {u.allowed_apps.map(code => (
                                <span
                                  key={code}
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800"
                                >
                                  {availableApps.find(a => a.code === code.toUpperCase())?.label || code}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {(() => {
                            if (u.role === 'admin') {
                              return (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800">
                                  🏢 Escritório & Gestão
                                </span>
                              );
                            }
                            const tw = u.telework;
                            if (tw?.mode === 'FROZEN') {
                              return (
                                <span
                                  title={tw.freezeReason || 'Sessão externa congelada por segurança'}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 dark:bg-[#290f14] text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800"
                                >
                                  🚨 Congelado
                                </span>
                              );
                            }
                            if (tw?.mode === 'PENDING_PAIRING') {
                              return (
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-[#241a08] text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                                    🔑 {tw.pendingCode || 'A emparelhar'}
                                  </span>
                                  {tw.pendingCode && (
                                    <button
                                      type="button"
                                      onClick={() => handleCopiarCaminho(tw.pendingCode || '', 'Código de Teletrabalho')}
                                      title="Copiar código para enviar ao colaborador"
                                      className="p-1 rounded bg-white dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300 cursor-pointer"
                                    >
                                      <Copy className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            }
                            if (tw?.mode === 'ACTIVE') {
                              const expDatePt = tw.expiresAt
                                ? tw.expiresAt.slice(0, 10).split('-').reverse().slice(0, 2).join('/')
                                : '';
                              return (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                                    🏠 Casa{expDatePt ? ` até ${expDatePt}` : ''}
                                  </span>
                                  {tw.activeExternalNow && (
                                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">
                                      🟢 Online fora
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#222f3e]">
                                🏢 Só no Escritório
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-semibold flex items-center space-x-1 ${
                            u.ativo ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${u.ativo ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            <span>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-700 dark:text-slate-300">
                          {u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('pt-PT') : 'Nunca'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {isCloudClient && (isAdm || isSuper) && u.role === 'subutilizador' && u.cloud_id && (
                              <>
                                {teleworkPickerUserId === u.cloud_id ? (
                                  <div className="inline-flex items-center gap-1 p-1 rounded bg-amber-50 dark:bg-[#241a08] border border-amber-300 dark:border-amber-700">
                                    {([1, 7, 30] as const).map(d => (
                                      <button
                                        key={d}
                                        type="button"
                                        disabled={teleworkBusyId === u.cloud_id}
                                        onClick={() => handleAutorizarCasa(u, d)}
                                        className="px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] hover:bg-sky-50 border border-amber-300 dark:border-amber-700 text-[10px] font-bold text-foreground cursor-pointer"
                                      >
                                        {d}d
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => setTeleworkPickerUserId(null)}
                                      className="p-0.5 text-slate-600 dark:text-slate-300 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={teleworkBusyId === u.cloud_id}
                                    onClick={() => setTeleworkPickerUserId(u.cloud_id || null)}
                                    className="px-2 py-1 rounded bg-sky-50 dark:bg-[#0a1929] hover:bg-sky-100 dark:hover:bg-[#132b45] border border-sky-300 dark:border-sky-700 text-[#0284c7] dark:text-sky-300 text-[10px] font-semibold cursor-pointer"
                                  >
                                    Autorizar Casa
                                  </button>
                                )}
                                {u.telework && u.telework.mode !== 'OFFICE_ONLY' && (
                                  <button
                                    type="button"
                                    disabled={teleworkBusyId === u.cloud_id}
                                    onClick={() => handleCortarCasa(u)}
                                    className="px-2 py-1 rounded bg-rose-50 dark:bg-[#290f14] hover:bg-rose-100 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-[10px] font-semibold cursor-pointer"
                                  >
                                    Cortar Casa
                                  </button>
                                )}
                              </>
                            )}
                            {(() => {
                              const isSelf = currentUser && u.id === currentUser.id;
                              const podeEditar = isSuper || isAdm || (isSub && isSelf) || !currentUser;
                              if (podeEditar) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => abrirEdicaoUser(u)}
                                    className="p-1 rounded text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] cursor-pointer transition"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const isSelf = currentUser && u.id === currentUser.id;
                              const podeEliminar = !isSelf && !isSub && (isSuper || (isAdm && u.role === 'subutilizador'));
                              if (podeEliminar) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleEliminarUser(u)}
                                    className="p-1 rounded text-slate-700 dark:text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-[#290f14] cursor-pointer transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setPassoAtivo(2)}
                className="px-4 py-2 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold cursor-pointer transition"
              >
                ← Passo Anterior: 2. Carregar Empresas do Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação / Edição de Centro de Dados Nomeado */}
      {modalCentroAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
          <div className="bg-white dark:bg-[#0c1520] w-full max-w-lg rounded-lg border border-slate-300 dark:border-[#222f3e] shadow-2xl p-5 space-y-4 relative text-foreground">
            <button
              type="button"
              onClick={() => setModalCentroAberto(false)}
              className="absolute right-3.5 top-3.5 text-slate-600 dark:text-slate-400 hover:text-foreground cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-200 dark:border-[#222f3e] pb-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-[#0a1929] flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0 border border-sky-300 dark:border-sky-800">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-display font-light text-foreground tracking-tight">
                  {centroEmEdicao ? `Editar Escritório: ${centroEmEdicao.nome}` : 'Novo Escritório Nomeado'}
                </h3>
                <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  Isole escritórios ou grupos de empresas (ex: Escritório da Maia, Porto, Empresas PHC, Empresas Sage)
                </p>
              </div>
            </div>

            <form onSubmit={handleGuardarCentroModal} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome do Escritório (Visível no Topo e Menu Lateral)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Escritório da Maia, Escritório do Porto, Empresas PHC..."
                  value={formCentroNome}
                  onChange={e => setFormCentroNome(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Computador ou Servidor onde Reside
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: SERVIDOR-MAIA ou PC-ESCRITORIO"
                  value={formCentroHost}
                  onChange={e => setFormCentroHost(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Pasta Nova Unificada — Dados evoGex (Motor + SafeDrive + PocketBase + SQLite)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Ex: C:\Dados_evoGex ou \\Servidor\Dados_evoGex"
                    value={formCentroPastaEvogex}
                    onChange={e => setFormCentroPastaEvogex(e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                  />
                  <button
                    type="button"
                    onClick={() => handleEscolherPastaEvogexDireto(formCentroPastaEvogex, true)}
                    className="h-8 px-2.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-[11px] font-semibold flex items-center space-x-1 shrink-0 cursor-pointer transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Escolher</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Pasta Antiga do Excel — Dados GexcelApps (Opcional, para carregar empresas/XMLs)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Ex: C:\Dados_GexcelApps ou \\Servidor\Dados_GexcelApps"
                    value={formCentroPastaAntiga}
                    onChange={e => setFormCentroPastaAntiga(e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                  />
                  <button
                    type="button"
                    onClick={() => handleEscolherPastaAntigaDireto(formCentroPastaAntiga, true)}
                    className="h-8 px-2.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold flex items-center space-x-1 shrink-0 cursor-pointer transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Escolher</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setModalCentroAberto(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#222f3e] text-foreground hover:bg-slate-100 dark:hover:bg-[#132233] font-mono text-xs cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoCentro}
                  className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {salvandoCentro ? 'A guardar...' : 'Guardar Centro de Dados'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criação / Edição de Utilizador */}
      {modalUserAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
          <div className="bg-white dark:bg-[#0c1520] w-full max-w-md rounded-lg border border-slate-300 dark:border-[#222f3e] shadow-2xl p-5 space-y-4 relative text-foreground">
            
            <button
              type="button"
              onClick={() => setModalUserAberto(false)}
              className="absolute right-3.5 top-3.5 text-slate-600 dark:text-slate-400 hover:text-foreground cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-200 dark:border-[#222f3e] pb-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-[#0a1929] flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0 border border-sky-300 dark:border-sky-800">
                {userEmEdicao ? <Edit2 className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="text-base font-display font-light text-foreground tracking-tight">
                  {userEmEdicao 
                    ? (isSub && userEmEdicao.id === currentUser?.id ? 'Alterar A Minha Palavra-passe / Perfil' : `Editar: ${userEmEdicao.nome}`)
                    : formRole === 'subutilizador'
                    ? 'Adicionar Novo Operador'
                    : 'Adicionar Novo Administrador'}
                </h3>
                <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  {userEmEdicao ? 'Atualize os dados ou redefina a palavra-passe' : 'Defina os dados de acesso do novo elemento da equipa'}
                </p>
              </div>
            </div>

            {erroFormUser && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-[#290f14] border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroFormUser}</span>
              </div>
            )}

            <form onSubmit={handleGuardarUser} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome do colaborador"
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              {userEmEdicao && formUsername && formUsername.toLowerCase() !== formEmail.toLowerCase() && (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Identificador Interno
                  </label>
                  <input
                    type="text"
                    disabled
                    value={formUsername}
                    className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden disabled:opacity-50"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    E-mail Único de Login *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="colaborador@empresa.pt"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Telemóvel / WhatsApp {formRole === 'admin' ? '*' : '(Facultativo)'}
                  </label>
                  <input
                    type="tel"
                    required={formRole === 'admin'}
                    placeholder="+351 912 345 678"
                    value={formTelefone}
                    onChange={e => setFormTelefone(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-snug">
                {formRole === 'admin'
                  ? 'E-mail e WhatsApp obrigatórios no Administrador para suporte e avisos críticos.'
                  : 'Nos operadores o telemóvel é facultativo — pode repetir o número do escritório sem duplicar avisos.'}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Perfil de Acesso
                  </label>
                  <select
                    value={formRole}
                    onChange={e => setFormRole(e.target.value as any)}
                    disabled={isSub}
                    className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    <option value="subutilizador">Operador (Subutilizador)</option>
                    {!isSub && <option value="admin">Administrador (Gestor)</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Estado da Conta
                  </label>
                  <select
                    value={formAtivo ? '1' : '0'}
                    onChange={e => setFormAtivo(e.target.value === '1')}
                    disabled={isSub}
                    className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    <option value="1">Ativo (Permite Login)</option>
                    <option value="0">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Escritórios / Centros de Dados Autorizados */}
              {!isSub && formRole === 'admin' && isCloudClient && (
                <div className="p-2.5 rounded bg-sky-50 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-800 text-[11px] font-mono text-sky-900 dark:text-sky-200">
                  <strong>Acesso Automático a Todos os Escritórios:</strong> Os Administradores acedem automaticamente a todos os escritórios da conta e ocupam 1 vaga em cada escritório.
                </div>
              )}

              {!isSub && formRole === 'subutilizador' && (
                <div className="p-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formTodosCentros}
                      onChange={e => setFormTodosCentros(e.target.checked)}
                      className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7]"
                    />
                    <span className="font-semibold text-foreground text-[11px]">
                      Acesso a Todos os Escritórios da Empresa
                    </span>
                  </label>

                  {!formTodosCentros && (
                    <div className="pl-5 space-y-1.5 pt-1 border-t border-slate-200 dark:border-[#222f3e]">
                      <span className="block text-[10px] text-slate-600 dark:text-slate-400">
                        Selecione os escritórios autorizados para este operador:
                      </span>
                      {centrosDadosLista.map(c => (
                        <label key={c.id} className="flex items-center justify-between gap-2 cursor-pointer">
                          <span className="flex items-center space-x-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={formCentrosSelecionados.includes(c.id)}
                              onChange={() => toggleCentroUserCheckbox(c.id)}
                              className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7]"
                            />
                            <span className="text-[11px] text-foreground truncate">
                              {c.id !== 'escritorio-principal' ? `${c.id} · ` : ''}{c.nome}
                            </span>
                          </span>
                          {c.max_users !== undefined && (
                            <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 shrink-0">
                              {c.occupied_users ?? 0}/{c.max_users} vagas
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isSub && isCloudClient && (
                <div className="p-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground text-[11px]">
                      Módulos Autorizados
                    </span>
                    {formRole === 'admin' ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
                        Admin: todos os módulos
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setFormAllowedApps(availableApps.map(a => a.code))}
                          className="text-[10px] font-mono text-[#0284c7] hover:underline cursor-pointer"
                        >
                          Todos
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormAllowedApps([])}
                          className="text-[10px] font-mono text-slate-600 dark:text-slate-400 hover:underline cursor-pointer"
                        >
                          Limpar
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableApps.map(appOpt => {
                      const checked = formRole === 'admin' || formAllowedApps.includes(appOpt.code);
                      return (
                        <label
                          key={appOpt.code}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] ${
                            formRole === 'admin' ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            checked
                              ? 'bg-emerald-50 dark:bg-[#091e1a] border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 font-medium'
                              : 'bg-white dark:bg-[#0c1520] border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={formRole === 'admin'}
                            checked={checked}
                            onChange={() => toggleAllowedAppCheckbox(appOpt.code)}
                            className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7]"
                          />
                          <span>{appOpt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  {userEmEdicao ? 'Nova Palavra-passe (Opcional)' : 'Palavra-passe'}
                </label>
                <input
                  type="password"
                  placeholder={userEmEdicao ? 'Deixe em branco para manter a atual' : 'Mínimo 4 caracteres'}
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setModalUserAberto(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#222f3e] text-foreground hover:bg-slate-100 dark:hover:bg-[#132233] font-mono text-xs cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoUser}
                  className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {salvandoUser ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>A guardar...</span>
                    </>
                  ) : (
                    <span>{userEmEdicao ? 'Guardar Alterações' : 'Criar Utilizador'}</span>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
