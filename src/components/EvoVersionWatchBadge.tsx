import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

export interface VersionManifestPayload {
  appCode?: string;
  version: string;
  build: string;
  releasedAt?: string;
}

interface EvoVersionWatchBadgeProps {
  currentVersion: string;
  currentBuild: string;
  channel?: "DEV" | "BETA" | "STABLE" | string;
  domainLabel?: string;
  compact?: boolean;
  showFloatingBanner?: boolean;
}

function detectChannelFromHost(): "DEV" | "BETA" | "STABLE" {
  if (typeof window === "undefined") return "STABLE";
  const h = window.location.hostname.toLowerCase();
  if (h.startsWith("dev.") || h === "localhost" || h === "127.0.0.1") return "DEV";
  if (h.startsWith("beta.") || h.startsWith("staging.")) return "BETA";
  return "STABLE";
}

function getInitialBundleSignature(): string {
  if (typeof document === "undefined") return "";
  const scripts = Array.from(document.querySelectorAll('script[src*="/assets/"]'));
  return scripts.map((s) => s.getAttribute("src") || "").join("|");
}

export function EvoVersionWatchBadge({
  currentVersion,
  currentBuild,
  channel,
  domainLabel,
  compact = false,
  showFloatingBanner = true,
}: EvoVersionWatchBadgeProps) {
  const activeChannel = channel || detectChannelFromHost();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<string>(currentVersion);
  const [remoteBuild, setRemoteBuild] = useState<string>(currentBuild);
  const [checking, setChecking] = useState(false);
  const [justCheckedOk, setJustCheckedOk] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const initialSignatureRef = useRef<string>("");

  useEffect(() => {
    initialSignatureRef.current = getInitialBundleSignature();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("simular_update") === "1") {
        const nextNum =
          parseInt(currentBuild.replace(/\D+/g, "") || "1", 10) + 1;
        const nextBuild = `Build #${String(nextNum).padStart(2, "0")}`;
        setRemoteVersion(currentVersion);
        setRemoteBuild(nextBuild);
        setUpdateAvailable(true);
      }
    }
  }, [currentBuild, currentVersion]);

  const checkRemoteVersion = useCallback(
    async (manual = false) => {
      if (typeof window === "undefined") return;
      if (manual) setChecking(true);
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });
        if (res.ok) {
          const data = (await res.json()) as VersionManifestPayload;
          if (data && data.build) {
            const remoteB = data.build.trim();
            const currentB = currentBuild.trim();
            if (remoteB !== currentB) {
              const appliedKey = `${data.version || currentVersion}|${remoteB}`;
              const alreadyApplied =
                typeof sessionStorage !== "undefined" &&
                sessionStorage.getItem("evogex_applied_build") === appliedKey;
              if (!alreadyApplied) {
                setRemoteVersion(data.version || currentVersion);
                setRemoteBuild(remoteB);
                setUpdateAvailable(true);
                setBannerDismissed(false);
                if (manual) setChecking(false);
                return;
              }
            }
            setUpdateAvailable(false);
            if (manual) {
              setJustCheckedOk(true);
              window.setTimeout(() => setJustCheckedOk(false), 2500);
              setChecking(false);
            }
            return;
          }
        }

        if (initialSignatureRef.current) {
          const htmlRes = await fetch(`/index.html?t=${Date.now()}`, {
            cache: "no-store",
          });
          if (htmlRes.ok) {
            const htmlText = await htmlRes.text();
            const matches = Array.from(
              htmlText.matchAll(/src="(\/assets\/[^"]+\.js)"/g)
            ).map((m) => m[1]);
            const remoteSig = matches.join("|");
            if (remoteSig && remoteSig !== initialSignatureRef.current) {
              const nextNum =
                parseInt(currentBuild.replace(/\D+/g, "") || "1", 10) + 1;
              setRemoteBuild(`Build #${String(nextNum).padStart(2, "0")}`);
              setUpdateAvailable(true);
              setBannerDismissed(false);
              if (manual) setChecking(false);
              return;
            }
          }
        }

        if (manual) {
          setJustCheckedOk(true);
          window.setTimeout(() => setJustCheckedOk(false), 2500);
        }
      } catch {
        // Silencioso em background
      } finally {
        if (manual) setChecking(false);
      }
    },
    [currentBuild, currentVersion]
  );

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void checkRemoteVersion(false);
    }, 4000);

    const interval = window.setInterval(() => {
      void checkRemoteVersion(false);
    }, 45000);

    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        void checkRemoteVersion(false);
      }
    };

    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [checkRemoteVersion]);

  const handleApplyUpdate = () => {
    try {
      sessionStorage.setItem(
        "evogex_applied_build",
        `${remoteVersion}|${remoteBuild.trim()}`
      );
    } catch {
      // ignore
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("simular_update");
    url.searchParams.set("_v", String(Date.now()));
    window.location.replace(url.toString());
  };

  const handleBadgeClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      const nextNum =
        parseInt(currentBuild.replace(/\D+/g, "") || "1", 10) + 1;
      const nextBuild = `Build #${String(nextNum).padStart(2, "0")}`;
      setRemoteVersion(currentVersion);
      setRemoteBuild(nextBuild);
      setUpdateAvailable(true);
      setBannerDismissed(false);
      return;
    }
    if (updateAvailable) {
      handleApplyUpdate();
    } else {
      void checkRemoteVersion(true);
    }
  };

  const channelBadgeStyle =
    activeChannel === "DEV" || String(activeChannel).includes("DEV")
      ? "bg-amber-100 text-amber-900 dark:bg-[#241a08] dark:text-amber-300 border-amber-400 dark:border-amber-700"
      : activeChannel === "BETA"
        ? "bg-sky-100 text-sky-900 dark:bg-[#0a1929] dark:text-sky-300 border-sky-400 dark:border-sky-700"
        : "bg-emerald-50 text-emerald-900 dark:bg-[#091e1a] dark:text-emerald-300 border-emerald-300 dark:border-emerald-700";

  return (
    <>
      {updateAvailable ? (
        <button
          type="button"
          onClick={handleApplyUpdate}
          title={`Nova versão disponível no canal ${activeChannel}: ${remoteVersion} · ${remoteBuild}. Clique para reiniciar o browser e atualizar já.`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold bg-amber-400 text-slate-950 dark:bg-amber-400 dark:text-slate-950 border-2 border-amber-600 shadow-md animate-pulse cursor-pointer shrink-0"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-950 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-950" />
          </span>
          <span>
            {compact
              ? `⚡ Atualizar (${remoteBuild})`
              : `⚡ Nova ${remoteBuild} disponível · Clique p/ atualizar`}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleBadgeClick}
          title={`Canal ${activeChannel} · ${currentVersion} · ${currentBuild}. Clique para verificar atualizações agora (Shift+Clique para testar aviso luminoso).`}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition-colors cursor-pointer shrink-0 ${channelBadgeStyle}`}
        >
          <RefreshCw
            size={10}
            className={checking ? "animate-spin" : "opacity-80"}
          />
          <span>
            {justCheckedOk
              ? `✓ Atualizado (${currentBuild})`
              : compact
                ? `${currentVersion} · ${currentBuild}`
                : `${domainLabel ? `${domainLabel} · ` : ""}${currentVersion} · ${currentBuild} · ${activeChannel}`}
          </span>
        </button>
      )}

      {showFloatingBanner && updateAvailable && !bannerDismissed && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border-2 border-amber-500 bg-white dark:bg-[#0c1520] p-3.5 shadow-2xl flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-[#241a08] border border-amber-400 dark:border-amber-600 flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0 animate-pulse">
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-amber-400 text-slate-950">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-950 animate-ping" />
                NOVA VERSÃO · {activeChannel}
              </span>
              <span className="text-[11px] font-mono font-bold text-slate-900 dark:text-slate-100">
                {remoteVersion} · {remoteBuild}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300 leading-snug">
              Foi publicada uma atualização neste canal. Atualize a página para carregar a nova versão.
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={handleApplyUpdate}
                className="h-7 px-3 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RefreshCw size={12} />
                <span>Atualizar Agora</span>
              </button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="h-7 px-2.5 rounded-md border border-slate-300 dark:border-[#222f3e] bg-slate-100 dark:bg-[#13202e] text-slate-700 dark:text-slate-300 text-[10.5px] font-mono hover:text-foreground cursor-pointer"
              >
                Mais tarde
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            title="Fechar aviso (o selo no topo continua a piscar)"
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
