/**
 * Ponte Híbrida Pilar 2: Motor Local do Escritório (127.0.0.1:8015) + Retaguarda Cloud Hetzner
 * (EVO-06 Importador e-Fatura <-> EVO-05 API + EVO-12 Gestor de Entidades)
 *
 * Arquitetura Híbrida Inteligente:
 * 1. Sonda silenciosamente em background `http://127.0.0.1:8015/` (timeout 800ms, sem bloquear a UI).
 * 2. Se o Motor Local estiver ativo no PC do cliente, prioriza o Motor Local (0 carga no Hetzner,
 *    IP residencial do escritório perante a AT e gravação direta nas pastas locais BdsefaturaV4/V3/BdsRV).
 * 3. Se o Motor Local não estiver ativo (ou acesso fora do escritório), encaminha em 0ms para o
 *    Motor Cloud Hetzner (`/api/...`), garantindo disponibilidade 24/7 sem qualquer espera.
 */

import {
  sincronizarSqlitesParaPastaLocal,
  obterWorkspaceIdIsolado,
  hidratarSessaoIsoladaLocal,
  obterDeviceIdPosto,
  resetarCacheHidratacaoNifs,
} from './localFsBridge';
import { readSharedSandboxMeta, readSharedSsoCookie } from './evoCrossAppBridge';

export type MotorSourceType = 'local' | 'cloud';

declare global {
  interface Window {
    __GEXCEL_MOTOR_SOURCE__?: MotorSourceType;
  }
}

const LOCAL_API_PREFIX = /^https?:\/\/(127\.0\.0\.1|localhost):8015(\/.*)?$/i;
const LOCAL_PB_PREFIX = /^https?:\/\/(127\.0\.0\.1|localhost):(8090|8095)(\/.*)?$/i;

const isCloudHost =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1';

const origFetch = window.fetch.bind(window);

let localMotorAvailable = !isCloudHost;
let currentMotorSource: MotorSourceType = isCloudHost ? 'cloud' : 'local';
let lastSyncedJobId = '';
let lastEmptyRehydrateAt = 0;
let rehydratingNow = false;

let _bootHydrationPromise: Promise<void> | null = null;
function ensureBootHydration(): Promise<void> {
  if (!isCloudHost || typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (!obterTokenSessaoAtiva()) {
    return Promise.resolve();
  }
  if (!_bootHydrationPromise) {
    _bootHydrationPromise = Promise.race([
      hidratarSessaoIsoladaLocal(true).then(() => undefined).catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3500)),
    ]);
  }
  return _bootHydrationPromise;
}

function shouldBypassHydrationWait(urlStr: string): boolean {
  return (
    urlStr.includes('/api/entidades/importar-tcredenciais') ||
    urlStr.includes('/api/efatura/hidratar-sqlites-locais') ||
    urlStr.includes('/api/bridge/workspace/') ||
    urlStr.includes('/api/auth/') ||
    urlStr.includes('/api/licenca/estado') ||
    urlStr.includes('/api/efatura/health') ||
    urlStr.includes('/api/health') ||
    urlStr.includes('/version.json')
  );
}

function obterTokenSessaoAtiva(): string {
  try {
    if (typeof window !== 'undefined') {
      const ssoUrl = (new URLSearchParams(window.location.search).get('sso') || '').trim();
      if (ssoUrl) return ssoUrl;
    }
    const raw = sessionStorage.getItem('gexcel_evo06_auth_session') || localStorage.getItem('gexcel_evo06_auth_session');
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.token && typeof p.token === 'string') {
        return p.token.trim();
      }
    }
    const shared = readSharedSsoCookie();
    if (shared?.token && typeof shared.token === 'string') {
      return shared.token.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

function withWorkspaceHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || undefined);
  const sbx = readSharedSandboxMeta();
  if (sbx?.sandboxId) {
    headers.set('X-Evo-Sandbox-Id', sbx.sandboxId);
    headers.set('X-Evo-Workspace-Id', `sbx_${sbx.sandboxId}`);
  } else if (!headers.has('X-Evo-Workspace-Id')) {
    headers.set('X-Evo-Workspace-Id', obterWorkspaceIdIsolado());
  }
  if (!headers.has('X-Evo-Device-Id')) {
    headers.set('X-Evo-Device-Id', obterDeviceIdPosto());
  }
  if (!headers.has('Authorization')) {
    const tok = obterTokenSessaoAtiva();
    if (tok) {
      headers.set('Authorization', `Bearer ${tok}`);
    }
  }
  return { ...(init || {}), headers };
}

function inspecionarSegurancaTeletrabalho(pathPart: string, res: Response) {
  if (res.status !== 403) return;
  if (
    pathPart.startsWith('/api/auth/login') ||
    pathPart.startsWith('/api/auth/token/activate') ||
    pathPart.startsWith('/api/auth/verify')
  ) {
    return;
  }
  res
    .clone()
    .json()
    .then((data) => {
      const code = String(data?.code || '');
      if (code.startsWith('TELEWORK_') && code !== 'TELEWORK_RESTRICTED') {
        try {
          sessionStorage.setItem(
            'gexcel_evo06_security_kick',
            String(data?.error || data?.detail || 'Sessão externa terminada por segurança.')
          );
        } catch {}
        window.dispatchEvent(new Event('gexcel-evo06-logout'));
      }
    })
    .catch(() => {});
}

function setMotorSource(source: MotorSourceType) {
  if (typeof window === 'undefined') return;
  const changed = currentMotorSource !== source || window.__GEXCEL_MOTOR_SOURCE__ !== source;
  currentMotorSource = source;
  window.__GEXCEL_MOTOR_SOURCE__ = source;
  if (changed) {
    window.dispatchEvent(new CustomEvent<MotorSourceType>('gexcel-motor-source', { detail: source }));
  }
}

export function getMotorSource(): MotorSourceType {
  if (typeof window !== 'undefined' && window.__GEXCEL_MOTOR_SOURCE__) {
    return window.__GEXCEL_MOTOR_SOURCE__;
  }
  return currentMotorSource;
}

export async function probeLocalMotor(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (readSharedSandboxMeta()) {
    localMotorAvailable = false;
    setMotorSource('cloud');
    return false;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 700);
  try {
    const res = await origFetch('http://127.0.0.1:8015/', {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('API Importador e-Fatura Gexcel')) {
        localMotorAvailable = true;
        setMotorSource('local');
        return true;
      }
    }
  } catch {
    // Motor local não disponível neste posto
  } finally {
    window.clearTimeout(timer);
  }
  localMotorAvailable = false;
  if (isCloudHost) {
    setMotorSource('cloud');
  }
  return false;
}

const initialLocalProbePromise: Promise<boolean> =
  typeof window !== 'undefined'
    ? probeLocalMotor()
    : Promise.resolve(false);

export function aguardarSondaMotorLocal(): Promise<boolean> {
  return initialLocalProbePromise;
}

if (typeof window !== 'undefined') {
  window.__GEXCEL_MOTOR_SOURCE__ = currentMotorSource;
  if (!isCloudHost) {
    // Em modo Desktop/Local monitoriza o motor local periodicamente
    window.setInterval(() => {
      void probeLocalMotor();
    }, 15000);
  }
}

function inspecionarRespostaESincronizarSqlite(pathPart: string, res: Response) {
  if (!res.ok) return;
  if (
    pathPart.startsWith('/api/pendentes/classificar') ||
    pathPart.startsWith('/api/pendentes/validar') ||
    pathPart.startsWith('/api/pendentes/entidades/modo-tudo-fora')
  ) {
    void sincronizarSqlitesParaPastaLocal();
    return;
  }
  if (
    pathPart.startsWith('/api/extracao/status/') ||
    pathPart.startsWith('/api/jobs/') ||
    pathPart.startsWith('/api/sincronizar') ||
    pathPart.startsWith('/api/anuladas/sincronizar-lote') ||
    pathPart.startsWith('/api/efatura/scrape/anuladas')
  ) {
    res
      .clone()
      .json()
      .then((data) => {
        if (pathPart.startsWith('/api/extracao/status/') || pathPart.startsWith('/api/jobs/')) {
          if (data && (data.status === 'concluido' || data.status === 'interrompido')) {
            const jobId = data.job_id || pathPart;
            if (lastSyncedJobId !== jobId) {
              lastSyncedJobId = jobId;
              const isMultiNif =
                data.fase === 'pendentes_recolha' ||
                data.fase === 'pendentes_submissao' ||
                (data.fase === 'anuladas' && String(data.nome_empresa || '').includes('entidade'));
              void sincronizarSqlitesParaPastaLocal(isMultiNif ? undefined : (data.nif || undefined));
            }
          }
        } else if (pathPart.startsWith('/api/anuladas/sincronizar-lote')) {
          if (!data?.job_id) {
            void sincronizarSqlitesParaPastaLocal();
          }
        } else if (pathPart.startsWith('/api/sincronizar') || pathPart.startsWith('/api/efatura/scrape/anuladas')) {
          void sincronizarSqlitesParaPastaLocal(data?.nif || undefined);
        }
      })
      .catch(() => {
        // ignore non-json
      });
  }
}

async function executarCloudRequest(targetUrl: string, pathPart: string, init?: RequestInit): Promise<Response> {
  if (!shouldBypassHydrationWait(targetUrl)) {
    await ensureBootHydration();
  }
  let cloudRes = await origFetch(targetUrl, withWorkspaceHeader(init));
  const methodUpper = (init?.method || 'GET').toUpperCase();
  if (
    cloudRes.headers.get('X-Evo-Ws-Empty') === '1' &&
    methodUpper === 'GET' &&
    obterTokenSessaoAtiva() &&
    !shouldBypassHydrationWait(targetUrl) &&
    !rehydratingNow &&
    Date.now() - lastEmptyRehydrateAt > 15000
  ) {
    rehydratingNow = true;
    lastEmptyRehydrateAt = Date.now();
    resetarCacheHidratacaoNifs();
    try {
      const ok = await hidratarSessaoIsoladaLocal(true);
      if (ok) {
        cloudRes = await origFetch(targetUrl, withWorkspaceHeader(init));
      }
    } finally {
      rehydratingNow = false;
    }
  }
  inspecionarSegurancaTeletrabalho(pathPart, cloudRes);
  inspecionarRespostaESincronizarSqlite(pathPart, cloudRes);
  return cloudRes;
}

if (typeof window !== 'undefined') {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const matchApi = rawUrl.match(LOCAL_API_PREFIX);
    if (matchApi) {
      const pathPart = matchApi[2] || '/';
      const activeSbx = readSharedSandboxMeta();

      if (isCloudHost && !activeSbx && !localMotorAvailable) {
        await initialLocalProbePromise;
      }

      if (!activeSbx && (localMotorAvailable || !isCloudHost)) {
        try {
          const localRes = await origFetch(rawUrl, init);
          if (localRes.ok || !isCloudHost) {
            localMotorAvailable = true;
            setMotorSource('local');
            inspecionarRespostaESincronizarSqlite(pathPart, localRes);
            return localRes;
          }
        } catch (err) {
          localMotorAvailable = false;
          if (!isCloudHost) {
            throw err;
          }
        }
      }

      setMotorSource('cloud');
      const cloudUrl = pathPart === '/' ? '/api/efatura/health' : pathPart;
      return executarCloudRequest(cloudUrl, pathPart, init);
    }

    const matchPb = rawUrl.match(LOCAL_PB_PREFIX);
    const isLocalOnly = new Headers(init?.headers || undefined).get('X-Evo-Local-Only') === '1';
    const pbPathPart = matchPb ? matchPb[3] || '/' : '';
    if (matchPb && isCloudHost && !isLocalOnly && !pbPathPart.startsWith('/api/bridge/health')) {
      const pathPart = pbPathPart;
      try {
        const cloudPbRes = await origFetch(pathPart, withWorkspaceHeader(init));
        if (cloudPbRes.ok) {
          return cloudPbRes;
        }
      } catch {
        // Fallback para URL original
      }
    }

    if (isCloudHost && rawUrl.startsWith('/api/')) {
      return executarCloudRequest(rawUrl, rawUrl, init);
    }

    return origFetch(input, init);
  };
}
