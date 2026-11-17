import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppUser, AppConfig, LicensedOfficeInfo } from '../types/auth';
import {
  sincronizarLocalFsComAppConfig,
  sincronizarEscritoriosLocaisComLicenca,
  selecionarLocalFsCentroAtivo,
} from './localFsBridge';

interface AuthContextType {
  currentUser: AppUser | null;
  token: string | null;
  appConfig: AppConfig | null;
  licensedOffices: LicensedOfficeInfo[];
  clientCode: string;
  clientName: string;
  clientNif: string;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  setExternalSession: (
    user: AppUser,
    sessionToken?: string,
    extras?: { offices?: LicensedOfficeInfo[]; clientCode?: string; preferredOfficeId?: string }
  ) => void;
  logout: () => void;
  refreshConfig: () => Promise<void>;
  refreshClientCloudState: () => Promise<void>;
  refreshUsers: () => Promise<AppUser[]>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  showSetupWizard: boolean;
  setShowSetupWizard: (show: boolean) => void;
  isSuperadmin: boolean;
  isAdmin: boolean;
  isSubutilizador: boolean;
  isTeleworkExternal: boolean;
  teleworkExpiresAt: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'gexcel_app_auth_token';
const USER_KEY = 'gexcel_app_auth_user';
export const EVO_SESSION_KEY = 'gexcel_evo06_auth_session';

interface StoredEvoSession {
  id?: string | number;
  username: string;
  nome: string;
  role: string;
  email?: string;
  telefone?: string;
  client_code?: string;
  session_context?: 'OFFICE' | 'TELEWORK';
  telework_expires_at?: string;
  offices?: LicensedOfficeInfo[];
  token: string;
}

function decodeGxtkSsoToken(rawToken: string): StoredEvoSession | null {
  try {
    const clean = (rawToken || '').trim();
    if (!clean.startsWith('gxtk.')) return null;
    const parts = clean.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binStr = atob(padded);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const jsonText = new TextDecoder().decode(bytes);
    const payload = JSON.parse(jsonText) as Record<string, unknown>;
    const exp = Number(payload.exp || 0);
    if (!exp || exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    const username = String(payload.username || '').trim();
    if (!username) return null;
    return {
      id: (payload.id as string | number) ?? 1,
      username,
      nome: String(payload.nome || username).trim(),
      role: String(payload.role || 'OPERADOR'),
      email: String(payload.email || ''),
      telefone: String(payload.telefone || ''),
      client_code: String(payload.client_code || '').trim().toUpperCase() || undefined,
      session_context: payload.ctx === 'TELEWORK' ? 'TELEWORK' : 'OFFICE',
      telework_expires_at: String(payload.telework_expires_at || ''),
      offices: Array.isArray(payload.offices) ? (payload.offices as LicensedOfficeInfo[]) : undefined,
      token: clean,
    };
  } catch {
    return null;
  }
}

function readStoredEvoSession(): StoredEvoSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const ssoTok = (url.searchParams.get('sso') || '').trim();
    if (ssoTok) {
      const decoded = decodeGxtkSsoToken(ssoTok);
      url.searchParams.delete('sso');
      const cleanUrl = `${url.pathname}${url.search ? url.search : ''}${url.hash || ''}`;
      window.history.replaceState({}, document.title, cleanUrl || '/');
      if (decoded) {
        const serialized = JSON.stringify(decoded);
        sessionStorage.setItem(EVO_SESSION_KEY, serialized);
        localStorage.setItem(EVO_SESSION_KEY, serialized);
        return decoded;
      }
    }

    const raw = sessionStorage.getItem(EVO_SESSION_KEY) || localStorage.getItem(EVO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEvoSession>;
    if (
      !parsed ||
      typeof parsed.token !== 'string' ||
      parsed.token.trim().length === 0 ||
      typeof parsed.username !== 'string' ||
      parsed.username.trim().length === 0
    ) {
      return null;
    }
    if (parsed.token.startsWith('gxtk.') && !decodeGxtkSsoToken(parsed.token)) {
      sessionStorage.removeItem(EVO_SESSION_KEY);
      localStorage.removeItem(EVO_SESSION_KEY);
      return null;
    }
    const sessionObj: StoredEvoSession = {
      id: parsed.id ?? 1,
      username: parsed.username.trim(),
      nome: (parsed.nome || parsed.username).trim(),
      role: parsed.role || 'OPERADOR',
      email: parsed.email || '',
      telefone: parsed.telefone || '',
      client_code: parsed.client_code ? String(parsed.client_code).trim().toUpperCase() : undefined,
      offices: Array.isArray(parsed.offices) ? parsed.offices : undefined,
      token: parsed.token.trim(),
    };
    sessionStorage.setItem(EVO_SESSION_KEY, JSON.stringify(sessionObj));
    return sessionObj;
  } catch {
    return null;
  }
}

function mapEvoSessionToAppUser(u: StoredEvoSession): AppUser {
  const rawRole = (u.role || '').toUpperCase();
  const mappedRole: AppUser['role'] =
    rawRole === 'DEV' || rawRole === 'SUPERADMIN'
      ? 'superadmin'
      : rawRole === 'ADMIN'
      ? 'admin'
      : 'subutilizador';

  return {
    id: Number(u.id) || 1,
    cloud_id: u.id !== undefined ? String(u.id) : undefined,
    username: u.username,
    nome: u.nome || u.username,
    email: u.email || '',
    telefone: u.telefone || '',
    role: mappedRole,
    ativo: true,
    is_system: mappedRole === 'superadmin',
    client_code: u.client_code || undefined,
    session_context: u.session_context || 'OFFICE',
    telework_expires_at: u.telework_expires_at || '',
    centros_permitidos: u.offices?.length ? u.offices.map(o => o.officeId) : undefined,
    created_at: new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialSession = readStoredEvoSession();
  if (!initialSession && typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  const [token, setToken] = useState<string | null>(() => (initialSession ? initialSession.token : null));
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() =>
    initialSession ? mapEvoSessionToAppUser(initialSession) : null
  );

  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [licensedOffices, setLicensedOffices] = useState<LicensedOfficeInfo[]>(() => initialSession?.offices || []);
  const [clientCode, setClientCode] = useState<string>(() => initialSession?.client_code || '');
  const [clientName, setClientName] = useState<string>(() => initialSession?.offices?.[0]?.clientName || '');
  const [clientNif, setClientNif] = useState<string>(() => initialSession?.offices?.[0]?.clientNif || '');
  const [loading, setLoading] = useState<boolean>(() => Boolean(initialSession));
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showSetupWizard, setShowSetupWizard] = useState<boolean>(false);

  const applyLicensedOfficesState = useCallback(
    (
      officesInput?: LicensedOfficeInfo[],
      explicitClientCode?: string,
      explicitClientName?: string,
      explicitClientNif?: string,
      preferredOfficeId?: string
    ) => {
      const offs = Array.isArray(officesInput) ? officesInput : [];
      setLicensedOffices(offs);
      const cc = (explicitClientCode || offs[0]?.clientCode || '').trim().toUpperCase();
      setClientCode(cc);
      setClientName(explicitClientName || offs[0]?.clientName || '');
      setClientNif(explicitClientNif || offs[0]?.clientNif || '');
      if (offs.length > 0) {
        sincronizarEscritoriosLocaisComLicenca(offs);
        if (preferredOfficeId) {
          const match = offs.find(o => o.officeId === preferredOfficeId);
          if (match) {
            selecionarLocalFsCentroAtivo(match.officeId, {
              nome: match.officeName,
              pastaEvogex: match.pastaEvogex,
              pastaGexcelAntiga: match.pastaGexcelAntiga,
              officeSeq: match.officeSeq,
            });
          }
        }
      }
    },
    []
  );

  const clearSessionState = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setLicensedOffices([]);
    setClientCode('');
    setClientName('');
    setClientNif('');
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(EVO_SESSION_KEY);
      localStorage.removeItem(EVO_SESSION_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  // Carregar configuração da app a partir da API (:8015)
  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/config');
      if (res.ok) {
        const data = await res.json();
        const cfg: AppConfig = data.config;
        setAppConfig(cfg);
        sincronizarLocalFsComAppConfig(cfg);

        // Só abrir wizard de configuração autónoma se existir sessão autenticada válida
        if (readStoredEvoSession() && cfg.modo_dados === 'autonomo' && !cfg.setup_completo) {
          setShowSetupWizard(true);
        }
      }
    } catch (e) {
      console.warn('[AUTH] Falha ao carregar configuração da API:', e);
    }
  }, []);

  useEffect(() => {
    const onForceLogout = () => {
      clearSessionState();
    };
    window.addEventListener('gexcel-evo06-logout', onForceLogout);
    return () => window.removeEventListener('gexcel-evo06-logout', onForceLogout);
  }, [clearSessionState]);

  const refreshClientCloudState = useCallback(async () => {
    const activeTok = token || readStoredEvoSession()?.token || '';
    if (!activeTok || !activeTok.startsWith('gxtk.')) return;
    try {
      const res = await fetch('/api/auth/client/state', {
        headers: { Authorization: `Bearer ${activeTok}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.ok && Array.isArray(data.offices)) {
        applyLicensedOfficesState(data.offices, data.client_code, data.client_name, data.client_nif);
        const saved = readStoredEvoSession();
        if (saved) {
          const updatedSess: StoredEvoSession = {
            ...saved,
            client_code: data.client_code || saved.client_code,
            offices: data.offices,
          };
          const serialized = JSON.stringify(updatedSess);
          sessionStorage.setItem(EVO_SESSION_KEY, serialized);
          localStorage.setItem(EVO_SESSION_KEY, serialized);
        }
      }
    } catch {
      // manter estado atual se indisponível
    }
  }, [token, applyLicensedOfficesState]);

  // Validar sessão unificada EVO-11 ativa no arranque/atualização da página
  useEffect(() => {
    let cancel = false;
    async function validarSessao() {
      const savedEvo = readStoredEvoSession();
      if (!savedEvo) {
        clearSessionState();
        if (!cancel) setLoading(false);
        refreshConfig();
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(savedEvo.token)}`, {
          headers: { Authorization: `Bearer ${savedEvo.token}` },
          cache: 'no-store',
        });
        if (res.status === 401 || res.status === 403) {
          const errData = await res.json().catch(() => null);
          if (errData?.error || errData?.detail) {
            try {
              sessionStorage.setItem('gexcel_evo06_security_kick', String(errData.error || errData.detail));
            } catch {}
          }
          if (!cancel) {
            clearSessionState();
            setLoading(false);
          }
          return;
        }
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.ok === false) {
            if (!cancel) {
              clearSessionState();
              setLoading(false);
            }
            return;
          }
          if (!cancel && data?.ok && data?.user) {
            const offs: LicensedOfficeInfo[] = Array.isArray(data.offices)
              ? data.offices
              : Array.isArray(data.user.offices)
              ? data.user.offices
              : [];
            const cc = String(data.user.client_code || savedEvo.client_code || '').trim().toUpperCase();
            const refreshedSession: StoredEvoSession = {
              id: data.user.id ?? savedEvo.id ?? 1,
              username: String(data.user.username || savedEvo.username).trim(),
              nome: String(data.user.nome || savedEvo.nome || savedEvo.username).trim(),
              role: String(data.user.role || savedEvo.role || 'OPERADOR'),
              email: String(data.user.email ?? savedEvo.email ?? ''),
              telefone: String(data.user.telefone ?? savedEvo.telefone ?? ''),
              client_code: cc || undefined,
              session_context: data.user.session_context === 'TELEWORK' ? 'TELEWORK' : (savedEvo.session_context || 'OFFICE'),
              telework_expires_at: String(data.user.telework_expires_at ?? savedEvo.telework_expires_at ?? ''),
              offices: offs.length > 0 ? offs : undefined,
              token: savedEvo.token,
            };
            const mapped = mapEvoSessionToAppUser(refreshedSession);
            const serialized = JSON.stringify(refreshedSession);
            sessionStorage.setItem(EVO_SESSION_KEY, serialized);
            localStorage.setItem(EVO_SESSION_KEY, serialized);
            localStorage.setItem(TOKEN_KEY, refreshedSession.token);
            localStorage.setItem(USER_KEY, JSON.stringify(mapped));
            setToken(refreshedSession.token);
            setCurrentUser(mapped);
            applyLicensedOfficesState(offs, cc);
          }
        }
      } catch {
        // Se endpoint remoto não responder momentaneamente, mantém a sessão assinada da aba atual
        if (!cancel) {
          const mapped = mapEvoSessionToAppUser(savedEvo);
          setToken(savedEvo.token);
          setCurrentUser(mapped);
          if (savedEvo.offices?.length) {
            applyLicensedOfficesState(savedEvo.offices, savedEvo.client_code);
          }
        }
      }

      await refreshConfig();
      if (!cancel) setLoading(false);
    }

    validarSessao();
    return () => { cancel = true; };
  }, [clearSessionState, refreshConfig, applyLicensedOfficesState]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, appCodigo: 'EVO-06' })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data?.user && data?.token) {
        const offs: LicensedOfficeInfo[] = Array.isArray(data.offices)
          ? data.offices
          : Array.isArray(data.user.offices)
          ? data.user.offices
          : [];
        const cc = String(data.user.client_code || '').trim().toUpperCase();
        const evoSess: StoredEvoSession = {
          id: data.user.id ?? 1,
          username: String(data.user.username || username).trim(),
          nome: String(data.user.nome || username).trim(),
          role: String(data.user.role || 'OPERADOR'),
          email: String(data.user.email || ''),
          telefone: String(data.user.telefone || ''),
          client_code: cc || undefined,
          session_context: data.user.session_context === 'TELEWORK' ? 'TELEWORK' : 'OFFICE',
          telework_expires_at: String(data.user.telework_expires_at || ''),
          offices: offs.length > 0 ? offs : undefined,
          token: String(data.token).trim(),
        };
        const usr = mapEvoSessionToAppUser(evoSess);
        const serialized = JSON.stringify(evoSess);
        sessionStorage.setItem(EVO_SESSION_KEY, serialized);
        localStorage.setItem(EVO_SESSION_KEY, serialized);
        localStorage.setItem(TOKEN_KEY, evoSess.token);
        localStorage.setItem(USER_KEY, JSON.stringify(usr));
        setToken(evoSess.token);
        setCurrentUser(usr);
        applyLicensedOfficesState(offs, cc);
        setShowLoginModal(false);
        await refreshConfig();
        return { success: true };
      }
      return { success: false, error: data?.error || data?.detail || 'Falha na autenticação' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Sem ligação ao servidor de autenticação' };
    }
  };

  const setExternalSession = useCallback(
    (
      usr: AppUser,
      sessionToken?: string,
      extras?: { offices?: LicensedOfficeInfo[]; clientCode?: string; preferredOfficeId?: string }
    ) => {
      const cleanTok = (sessionToken || '').trim();
      if (!cleanTok || !usr?.username) {
        clearSessionState();
        return;
      }
      const existing = readStoredEvoSession();
      const offs = extras?.offices ?? existing?.offices ?? [];
      const cc = (extras?.clientCode || usr.client_code || existing?.client_code || '').trim().toUpperCase();
      const evoSess: StoredEvoSession = {
        id: usr.cloud_id ?? existing?.id ?? usr.id ?? 1,
        username: usr.username,
        nome: usr.nome || usr.username,
        role: usr.role === 'superadmin' ? 'DEV' : usr.role === 'admin' ? 'ADMIN' : existing?.role || 'OPERADOR',
        email: usr.email || '',
        telefone: usr.telefone || existing?.telefone || '',
        client_code: cc || undefined,
        session_context: usr.session_context || existing?.session_context || 'OFFICE',
        telework_expires_at: usr.telework_expires_at ?? existing?.telework_expires_at ?? '',
        offices: offs.length > 0 ? offs : undefined,
        token: cleanTok,
      };
      const serialized = JSON.stringify(evoSess);
      sessionStorage.setItem(EVO_SESSION_KEY, serialized);
      localStorage.setItem(EVO_SESSION_KEY, serialized);
      localStorage.setItem(USER_KEY, JSON.stringify(usr));
      localStorage.setItem(TOKEN_KEY, cleanTok);
      setCurrentUser({ ...usr, client_code: cc || usr.client_code });
      setToken(cleanTok);
      applyLicensedOfficesState(offs, cc, undefined, undefined, extras?.preferredOfficeId);
    },
    [clearSessionState, applyLicensedOfficesState]
  );

  const logout = useCallback(() => {
    clearSessionState();
  }, [clearSessionState]);

  const refreshUsers = async (): Promise<AppUser[]> => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/users');
      if (res.ok) {
        const data = await res.json();
        return data.utilizadores || [];
      }
    } catch {}
    return [];
  };

  useEffect(() => {
    if (!token || !token.startsWith('gxtk.')) return;
    let cancel = false;
    const verificarHeartbeat = async () => {
      try {
        const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (cancel) return;
        if (res.status === 401 || res.status === 403) {
          const d = await res.json().catch(() => null);
          if (d?.error || d?.detail) {
            try {
              sessionStorage.setItem('gexcel_evo06_security_kick', String(d.error || d.detail));
            } catch {}
          }
          clearSessionState();
        }
      } catch {
        // tolerar quebra transitória de rede
      }
    };
    const interval = window.setInterval(() => {
      void verificarHeartbeat();
    }, 30000);
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') {
        void verificarHeartbeat();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancel = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, clearSessionState]);

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isAdmin = isSuperadmin || currentUser?.role === 'admin';
  const isSubutilizador = currentUser?.role === 'subutilizador';
  const isTeleworkExternal = currentUser?.session_context === 'TELEWORK';
  const teleworkExpiresAt = currentUser?.telework_expires_at || '';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        token,
        appConfig,
        licensedOffices,
        clientCode,
        clientName,
        clientNif,
        loading,
        login,
        setExternalSession,
        logout,
        refreshConfig,
        refreshClientCloudState,
        refreshUsers,
        showLoginModal,
        setShowLoginModal,
        showSetupWizard,
        setShowSetupWizard,
        isSuperadmin,
        isAdmin,
        isSubutilizador,
        isTeleworkExternal,
        teleworkExpiresAt,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
