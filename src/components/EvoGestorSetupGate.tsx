import React, { useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  LogOut,
  Moon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";

interface EvoGestorSetupGateProps {
  mode: "setup_required" | "reconnect";
  theme: "dark" | "light";
  onToggleTheme: () => void;
  userEmail: string;
  userName: string;
  officeName: string;
  pastaDisplay: string;
  officeConfirmed: boolean;
  entidadesTotal: number;
  entidadesPrevias: number;
  onOpenGestor: () => void;
  onRecheck: () => Promise<void> | void;
  onReconnectFolder: () => Promise<{
    ok: boolean;
    totalEntidades: number;
    precisaGestor: boolean;
    erro?: string;
  }>;
  onLogout: () => void;
}

export const EvoGestorSetupGate: React.FC<EvoGestorSetupGateProps> = ({
  mode,
  theme,
  onToggleTheme,
  userEmail,
  userName,
  officeName,
  pastaDisplay,
  officeConfirmed,
  entidadesTotal,
  entidadesPrevias,
  onOpenGestor,
  onRecheck,
  onReconnectFolder,
  onLogout,
}) => {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleReconnect = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await onReconnectFolder();
      if (!res.ok && res.erro && res.erro !== "Seleção cancelada.") {
        setErrorMsg(res.erro);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecheck = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await onRecheck();
    } finally {
      setBusy(false);
    }
  };

  const isReconnect = mode === "reconnect";

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

        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md border border-border bg-slate-50 dark:bg-[#081019] font-mono text-[11px] text-slate-700 dark:text-slate-300">
            {userEmail || userName}
          </span>
          <button
            type="button"
            onClick={onToggleTheme}
            title="Alternar tema Claro / Escuro"
            className="h-8 w-8 rounded-lg border border-border bg-white dark:bg-[#0c1520] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-foreground cursor-pointer"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="h-8 px-3 rounded-lg border border-border bg-white dark:bg-[#0c1520] hover:border-rose-400 text-slate-700 dark:text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <LogOut size={13} />
            <span>Terminar Sessão</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 relative z-10 py-8">
        <div className="w-full max-w-[520px] bg-white dark:bg-[#0c1520] border border-border rounded-xl p-7 shadow-2xl relative before:absolute before:left-0 before:top-6 before:h-5 before:w-0.5 before:bg-primary">
          <div className="mb-5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-primary uppercase tracking-[0.14em] mb-1">
              <ShieldCheck size={12} />
              <span>
                {isReconnect
                  ? "RECONEXÃO DO ESCRITÓRIO · EVO-06"
                  : "CONFIGURAÇÃO INICIAL OBRIGATÓRIA · EVO-06"}
              </span>
            </div>
            <h1 className="font-display text-2xl font-light tracking-tight text-foreground">
              {isReconnect
                ? "Ligar ao Escritório Configurado"
                : "Configuração Inicial no Gestor de Entidades"}
            </h1>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mt-2">
              {isReconnect
                ? "O seu escritório já foi configurado anteriormente. Confirme a ligação à pasta de dados neste navegador para entrar de imediato no Importador e-Fatura."
                : "Para utilizar o Importador e-Fatura neste computador, configure primeiro a ligação ao escritório e carregue as entidades no Gestor de Entidades."}
            </p>
          </div>

          <div className="mb-5 p-3.5 rounded-lg bg-sky-50 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-700 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sky-950 dark:text-sky-100 flex items-center gap-1.5">
                <Building2 size={14} className="text-[#0284c7] dark:text-[#38bdf8] shrink-0" />
                <span>{officeName || "Escritório Principal"}</span>
              </span>
              <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-sky-200 dark:border-sky-800 text-slate-800 dark:text-slate-200">
                {pastaDisplay || "C:\\Dados_evoGex"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                officeConfirmed
                  ? "bg-emerald-50 dark:bg-[#091e1a] border-emerald-400 dark:border-emerald-700"
                  : "bg-amber-50 dark:bg-[#241a08] border-amber-300 dark:border-amber-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <HardDrive
                  size={14}
                  className={
                    officeConfirmed
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-amber-700 dark:text-amber-300"
                  }
                />
                {officeConfirmed ? (
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span className="font-mono text-[10px] font-bold uppercase text-amber-900 dark:text-amber-200">
                    Pendente
                  </span>
                )}
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Ligação ao Computador
              </div>
              <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                {officeConfirmed ? "Pasta do escritório definida" : "Por configurar no Gestor"}
              </div>
            </div>

            <div
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                entidadesTotal > 0
                  ? "bg-emerald-50 dark:bg-[#091e1a] border-emerald-400 dark:border-emerald-700"
                  : "bg-amber-50 dark:bg-[#241a08] border-amber-300 dark:border-amber-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <Users
                  size={14}
                  className={
                    entidadesTotal > 0
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-amber-700 dark:text-amber-300"
                  }
                />
                <span className="font-mono text-[10px] font-bold uppercase text-slate-800 dark:text-slate-200 tabular-nums">
                  {entidadesTotal > 0
                    ? `${entidadesTotal} ativas`
                    : isReconnect && entidadesPrevias > 0
                    ? `${entidadesPrevias} no disco`
                    : "0 entidades"}
                </span>
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Carteira de Entidades
              </div>
              <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                {isReconnect && entidadesPrevias > 0
                  ? "Pronta a carregar do disco"
                  : "Excel ou credenciais antigas"}
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-[#2a1218] border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
              <ShieldAlert size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-2.5">
            {isReconnect ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReconnect()}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderOpen size={14} />
                  <span>
                    {busy ? "A ligar ao escritório..." : "Ligar ao Escritório Configurado e Entrar"}
                  </span>
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenGestor}
                  className="w-full py-2 px-4 rounded-lg border border-border bg-white dark:bg-[#0c1520] hover:bg-slate-50 dark:hover:bg-[#132233] text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>Abrir Gestor de Entidades</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenGestor}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>Abrir Gestor de Entidades</span>
                  <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRecheck()}
                  className="w-full py-2 px-4 rounded-lg border border-border bg-white dark:bg-[#0c1520] hover:bg-slate-50 dark:hover:bg-[#132233] text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                  <span>{busy ? "A verificar..." : "Voltar a Verificar"}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="h-10 px-6 flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-400 border-t border-border bg-white dark:bg-[#0c1520] relative z-10">
        <span>Ecossistema Gexcel EVO · Zero-Storage Cloud</span>
        <span>Proteção Perimetral Ativa</span>
      </footer>
    </div>
  );
};
