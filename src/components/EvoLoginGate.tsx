import React, { useState, useEffect } from "react";
import { Lock, User, ShieldAlert, ArrowRight, Sun, Moon, ShieldCheck, KeyRound, Building2, Mail } from "lucide-react";

export interface AuthenticatedEvoUser {
  id: string;
  username: string;
  nome: string;
  role: string;
  email: string;
  token?: string;
}

interface EvoLoginGateProps {
  appCodigo: string;
  appTitle: string;
  appSubtitle: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onAuthenticated: (user: AuthenticatedEvoUser) => void;
}

interface InspectedTenant {
  id: string;
  token: string;
  nome_empresa: string;
  nif: string;
  max_users: number;
  users_count: number;
  has_admin: boolean;
  expires_at: string;
}

const BLOCKED_DEV_IDENTIFIERS = new Set([
  "@gexcel",
  "gexcel",
  "@evogex",
  "evogex",
  "dev",
  "superadmin",
  "gexcel2013@gmail.com",
]);

export const EvoLoginGate: React.FC<EvoLoginGateProps> = ({
  appCodigo,
  appTitle,
  appSubtitle,
  theme,
  onToggleTheme,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteToken, setInviteToken] = useState<string>("");
  const [inspectedTenant, setInspectedTenant] = useState<InspectedTenant | null>(null);
  const [firstAdminNome, setFirstAdminNome] = useState("");
  const [firstAdminEmail, setFirstAdminEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTok = (params.get("token") || "").trim().toUpperCase();
    if (!urlTok) return;
    setInviteToken(urlTok);
    fetch(`/api/auth/token/inspect?token=${encodeURIComponent(urlTok)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data?.tenant) {
          setInspectedTenant(data.tenant);
        } else if (data?.error) {
          setError(data.error);
        }
      })
      .catch(() => {
        // Silencioso se offline
      });
  }, []);

  const handleActivateFirstAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    const p = password.trim();
    const n = firstAdminNome.trim();
    if (!u || !p || !n) {
      setError("Preencha o nome completo, o utilizador e a palavra-passe.");
      return;
    }
    if (BLOCKED_DEV_IDENTIFIERS.has(u.toLowerCase())) {
      setError("Por motivos de segurança, identificadores de desenvolvimento não podem ser utilizados.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/auth/token/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          nome: n,
          username: u,
          password: p,
          email: firstAdminEmail.trim(),
          appCodigo,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.ok && data?.user) {
        onAuthenticated({
          ...data.user,
          token: data.token,
        });
        return;
      }
      setError(data?.error || data?.detail || "Não foi possível ativar o convite.");
    } catch {
      setError("Não foi possível comunicar com o servidor de autenticação.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setError("Introduza o utilizador e a palavra-passe.");
      return;
    }
    if (BLOCKED_DEV_IDENTIFIERS.has(u.toLowerCase())) {
      setError(
        "Por motivos de segurança, as credenciais de desenvolvedor são exclusivas da consola central DEV e estão bloqueadas nas aplicações de clientes."
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: u,
          password: p,
          appCodigo,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.ok && data?.user) {
        const logged: AuthenticatedEvoUser = {
          ...data.user,
          token: data.token,
        };
        onAuthenticated(logged);
        return;
      }
      setError(data?.error || data?.detail || "Credenciais inválidas.");
    } catch {
      setError("Não foi possível validar as credenciais no servidor central.");
    } finally {
      setLoading(false);
    }
  };

  const isFirstAdminOnboarding = Boolean(inspectedTenant && !inspectedTenant.has_admin);

  return (
    <div className="min-h-screen bg-background text-foreground relative flex flex-col justify-between overflow-hidden font-sans select-none">
      <div className="workspace-ledger absolute inset-0 pointer-events-none" />

      <header className="h-14 flex items-center justify-between px-6 relative z-10 border-b border-border bg-card">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-[#0a1929] font-mono text-[11px] font-bold text-primary">
            GE
          </span>
          <span className="font-mono text-xs font-semibold tracking-tight text-foreground">
            evoGex.com · {appCodigo}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          title="Alternar tema Claro / Escuro"
          className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 relative z-10 py-8">
        <div className="w-full max-w-[420px] bg-white dark:bg-[#0c1520] border border-border rounded-xl p-7 shadow-2xl relative before:absolute before:left-0 before:top-6 before:h-5 before:w-0.5 before:bg-primary">
          <div className="mb-5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-primary uppercase tracking-[0.14em] mb-1">
              <ShieldCheck size={12} />
              <span>ACESSO AUTENTICADO · {appCodigo}</span>
            </div>
            <h1 className="font-sans text-xl font-light tracking-tight text-foreground">
              {appTitle}
            </h1>
            <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400 mt-1">
              {appSubtitle}
            </p>
          </div>

          {inspectedTenant && (
            <div className="mb-4 p-3 rounded-lg bg-sky-50 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-700 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                  <Building2 size={14} />
                  {inspectedTenant.nome_empresa}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                  {inspectedTenant.token}
                </span>
              </div>
              <div className="text-[11px] text-slate-700 dark:text-slate-300">
                {isFirstAdminOnboarding
                  ? "Convite validado: crie abaixo a 1.ª conta de Administrador da sua empresa."
                  : "Ambiente ativo: inicie sessão com o seu utilizador e palavra-passe."}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-[#2a1218] border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
              <ShieldAlert size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={isFirstAdminOnboarding ? handleActivateFirstAdmin : handleSubmit} className="space-y-4">
            {isFirstAdminOnboarding && (
              <>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Nome Completo do Responsável
                  </label>
                  <input
                    type="text"
                    required
                    value={firstAdminNome}
                    onChange={(e) => setFirstAdminNome(e.target.value)}
                    placeholder="Ex.: Dr. Henrique Azevedo"
                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-slate-50 dark:bg-[#07121c] text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    E-mail Profissional (Opcional)
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={firstAdminEmail}
                      onChange={(e) => setFirstAdminEmail(e.target.value)}
                      placeholder="nome@empresa.pt"
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-slate-50 dark:bg-[#07121c] text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Utilizador ou Email
              </label>
              <div className="relative">
                <User
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  required
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="utilizador ou email@empresa.pt"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-slate-50 dark:bg-[#07121c] text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Palavra-passe
              </label>
              <div className="relative">
                <Lock
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-slate-50 dark:bg-[#07121c] text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isFirstAdminOnboarding ? <KeyRound size={14} /> : null}
              <span>
                {loading
                  ? "A validar..."
                  : isFirstAdminOnboarding
                  ? "Ativar Ambiente e Criar Administrador"
                  : "Iniciar Sessão Segura"}
              </span>
              <ArrowRight size={14} />
            </button>
          </form>
        </div>
      </main>

      <footer className="h-10 px-6 flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-400 border-t border-border bg-card relative z-10">
        <span>Ecossistema Gexcel EVO · Zero-Storage Cloud</span>
        <span>Proteção Perimetral Ativa</span>
      </footer>
    </div>
  );
};
