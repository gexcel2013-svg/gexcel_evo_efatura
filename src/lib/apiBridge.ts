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

import { sincronizarSqlitesParaPastaLocal } from './localFsBridge';

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
let consecutiveLocalFailures = 0;

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
  const timer = window.setTimeout(() => controller.abort(), 700);
  try {
    const res = await origFetch('http://127.0.0.1:8015/', {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('API Importador e-Fatura Gexcel')) {
        consecutiveLocalFailures = 0;
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
  consecutiveLocalFailures += 1;
  localMotorAvailable = false;
  if (isCloudHost) {
    setMotorSource('cloud');
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.__GEXCEL_MOTOR_SOURCE__ = currentMotorSource;
  // Adia a sondagem local para depois do arranque inicial da página não bloquear o browser
  window.setTimeout(() => {
    void probeLocalMotor();
  }, 2500);
  window.setInterval(() => {
    // Se já falhou 3 vezes seguidas num portátil sem motor local, reduz a frequência para não saturar sockets do browser
    if (isCloudHost && !localMotorAvailable && consecutiveLocalFailures >= 3) {
      return;
    }
    void probeLocalMotor();
  }, 15000);
}

function inspecionarRespostaESincronizarSqlite(pathPart: string, res: Response) {
  if (!res.ok) return;
  if (pathPart.startsWith('/api/jobs/') || pathPart.startsWith('/api/sincronizar')) {
    res
      .clone()
      .json()
      .then((data) => {
        if (pathPart.startsWith('/api/jobs/')) {
          if (data && data.status === 'concluido') {
            const jobId = data.job_id || pathPart;
            if (lastSyncedJobId !== jobId) {
              lastSyncedJobId = jobId;
              void sincronizarSqlitesParaPastaLocal(data.nif || undefined);
            }
          }
        } else if (pathPart.startsWith('/api/sincronizar')) {
          void sincronizarSqlitesParaPastaLocal(data?.nif || undefined);
        }
      })
      .catch(() => {
        // ignore non-json
      });
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

      if (localMotorAvailable || !isCloudHost) {
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
      const safeInit: RequestInit | undefined = init ? { ...init, signal: undefined } : undefined;
      const cloudRes = await origFetch(cloudUrl, safeInit);
      inspecionarRespostaESincronizarSqlite(pathPart, cloudRes);
      return cloudRes;
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
