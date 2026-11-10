/**
 * Ponte Híbrida Pilar 2: Motor Local do Gabinete (127.0.0.1:8015) + Retaguarda Cloud Hetzner
 * (EVO-06 Importador e-Fatura <-> EVO-05 API + EVO-12 Gestor de Entidades)
 *
 * Arquitetura Híbrida Inteligente:
 * 1. Sonda silenciosamente em background `http://127.0.0.1:8015/` (timeout 800ms, sem bloquear a UI).
 * 2. Se o Motor Local estiver ativo no PC do cliente, prioriza o Motor Local (0 carga no Hetzner,
 *    IP residencial do gabinete perante a AT e gravação direta nas pastas locais BdsefaturaV4/V3/BdsRV).
 * 3. Se o Motor Local não estiver ativo (ou acesso fora do escritório), encaminha em 0ms para o
 *    Motor Cloud Hetzner (`/api/...`), garantindo disponibilidade 24/7 sem qualquer espera.
 */

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

let localMotorOnline = !isCloudHost;
let currentMotorSource: MotorSourceType = isCloudHost ? 'cloud' : 'local';

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

async function probeLocalMotor(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 800);
  try {
    const res = await origFetch('http://127.0.0.1:8015/', {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('API Importador e-Fatura Gexcel')) {
        localMotorOnline = true;
        setMotorSource('local');
        return true;
      }
    }
  } catch {
    // Motor local não disponível neste posto
  } finally {
    window.clearTimeout(timer);
  }
  localMotorOnline = false;
  if (isCloudHost) {
    setMotorSource('cloud');
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.__GEXCEL_MOTOR_SOURCE__ = currentMotorSource;
  void probeLocalMotor();
  window.setInterval(() => {
    void probeLocalMotor();
  }, 10000);
}

function toCloudUrl(pathPart: string): string {
  const cleanPath = pathPart || '/';
  if (cleanPath === '/' || cleanPath === '') {
    return '/api/efatura/health';
  }
  return cleanPath;
}

async function fallbackEntidadesFromPocketBase(): Promise<Response | null> {
  const candidateUrls = isCloudHost
    ? [
        '/api/collections/entidades_base/records?perPage=500&sort=nomecli',
        'http://127.0.0.1:8090/api/collections/entidades_base/records?perPage=500&sort=nomecli',
      ]
    : [
        'http://127.0.0.1:8090/api/collections/entidades_base/records?perPage=500&sort=nomecli',
        '/api/collections/entidades_base/records?perPage=500&sort=nomecli',
      ];

  for (const pbUrl of candidateUrls) {
    try {
      const res = await origFetch(pbUrl);
      if (!res.ok) continue;
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) continue;

      const entidades = items
        .map((item: Record<string, unknown>) => {
          const nifRaw = String(item.nif || '').replace(/\D/g, '').slice(0, 9);
          if (nifRaw.length !== 9) return null;
          return {
            id: nifRaw,
            pb_id: String(item.id || nifRaw),
            cod: String(item.cod || nifRaw),
            nif: nifRaw,
            nif_cc: nifRaw,
            nomecli: String(item.nomecli || item.nome || `Empresa ${nifRaw}`).trim(),
            ativo: item.ativo !== false && item.ativo !== 0,
            tem_credenciais_at: true,
          };
        })
        .filter(Boolean);

      return new Response(
        JSON.stringify({
          status: 'sucesso',
          assinatura: 'API Importador e-Fatura Gexcel',
          entidades,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch {
      // Tentar próximo candidato
    }
  }
  return null;
}

async function checkAndEnrichEntidadesResponse(res: Response): Promise<Response> {
  if (!res.ok) {
    const fb = await fallbackEntidadesFromPocketBase();
    return fb || res;
  }
  try {
    const cloned = res.clone();
    const data = await cloned.json();
    if (Array.isArray(data?.entidades) && data.entidades.length > 0) {
      return res;
    }
    const fb = await fallbackEntidadesFromPocketBase();
    return fb || res;
  } catch {
    return res;
  }
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
      const cloudUrl = toCloudUrl(pathPart);
      const isEntidades = pathPart.startsWith('/api/entidades');
      const isLocalOnlyAction =
        pathPart.startsWith('/api/sistema/abrir-explorador') ||
        pathPart.startsWith('/api/efatura/login-browser');

      // 1. Se o Motor Local do PC estiver ativo (Pilar 2) ou for ação exclusiva do PC local:
      if (!isCloudHost || localMotorOnline || isLocalOnlyAction) {
        try {
          const localRes = await origFetch(rawUrl, init);
          if (localRes.ok || !isCloudHost) {
            setMotorSource('local');
            return isEntidades ? await checkAndEnrichEntidadesResponse(localRes) : localRes;
          }
        } catch {
          localMotorOnline = false;
          if (isCloudHost) {
            setMotorSource('cloud');
          }
        }
      }

      // 2. Retaguarda Cloud Hetzner em 0ms (sem reutilizar signal abortado se o local falhou)
      setMotorSource('cloud');
      const safeInit: RequestInit | undefined =
        init?.signal && init.signal.aborted ? { ...init, signal: undefined } : init;
      const cloudRes = await origFetch(cloudUrl, safeInit);
      return isEntidades ? await checkAndEnrichEntidadesResponse(cloudRes) : cloudRes;
    }

    const matchPb = rawUrl.match(LOCAL_PB_PREFIX);
    if (matchPb && isCloudHost) {
      const pathPart = matchPb[3] || '/';
      try {
        const cloudPbRes = await origFetch(pathPart, init);
        if (cloudPbRes.ok) {
          return cloudPbRes;
        }
      } catch {
        // Fallback para URL original
      }
    }

    return origFetch(input, init);
  };
}
