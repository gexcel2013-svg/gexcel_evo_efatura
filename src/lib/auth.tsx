import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppUser, AppConfig } from '../types/auth';

interface AuthContextType {
  currentUser: AppUser | null;
  token: string | null;
  appConfig: AppConfig | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshConfig: () => Promise<void>;
  refreshUsers: () => Promise<AppUser[]>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  showSetupWizard: boolean;
  setShowSetupWizard: (show: boolean) => void;
  isSuperadmin: boolean;
  isAdmin: boolean;
  isSubutilizador: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'gexcel_app_auth_token';
const USER_KEY = 'gexcel_app_auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showSetupWizard, setShowSetupWizard] = useState<boolean>(false);

  // Carregar configuração da app a partir da API (:8015)
  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/config');
      if (res.ok) {
        const data = await res.json();
        const cfg: AppConfig = data.config;
        setAppConfig(cfg);

        // Se modo for autónomo e o setup não estiver completo (sem admins), abrir o wizard
        if (cfg.modo_dados === 'autonomo' && !cfg.setup_completo) {
          setShowSetupWizard(true);
        }
      }
    } catch (e) {
      console.warn('[AUTH] Falha ao carregar configuração da API:', e);
    }
  }, []);

  // Validar sessão ativa se existir token
  useEffect(() => {
    let cancel = false;
    async function validarSessao() {
      setLoading(true);
      await refreshConfig();

      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        try {
          const res = await fetch(`http://127.0.0.1:8015/api/app/auth/me?token=${encodeURIComponent(savedToken)}`);
          if (res.ok) {
            const data = await res.json();
            if (!cancel && data.user) {
              setCurrentUser(data.user);
              localStorage.setItem(USER_KEY, JSON.stringify(data.user));
            }
          } else {
            // Token inválido ou expirado
            if (!cancel) {
              setToken(null);
              setCurrentUser(null);
              localStorage.removeItem(TOKEN_KEY);
              localStorage.removeItem(USER_KEY);
            }
          }
        } catch {
          // Erro de rede: preserva o cache local para tolerância offline
        }
      }
      if (!cancel) setLoading(false);
    }

    validarSessao();
    return () => { cancel = true; };
  }, [refreshConfig]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        const tk = data.token;
        const usr = data.user;
        setToken(tk);
        setCurrentUser(usr);
        localStorage.setItem(TOKEN_KEY, tk);
        localStorage.setItem(USER_KEY, JSON.stringify(usr));
        setShowLoginModal(false);
        await refreshConfig();
        return { success: true };
      } else {
        const err = await res.json();
        return { success: false, error: err.detail || 'Falha na autenticação' };
      }
    } catch (e: any) {
      return { success: false, error: e.message || 'Sem ligação à API' };
    }
  };

  const logout = () => {
    if (token) {
      fetch(`http://127.0.0.1:8015/api/app/auth/logout?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
    }
    setToken(null);
    setCurrentUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

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

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isAdmin = isSuperadmin || currentUser?.role === 'admin';
  const isSubutilizador = currentUser?.role === 'subutilizador';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        token,
        appConfig,
        loading,
        login,
        logout,
        refreshConfig,
        refreshUsers,
        showLoginModal,
        setShowLoginModal,
        showSetupWizard,
        setShowSetupWizard,
        isSuperadmin,
        isAdmin,
        isSubutilizador
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
