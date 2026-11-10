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

let currentMotorSource: MotorSourceType = 'local';

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
        setMotorSource('local');
        return true;
      }
    }
  } catch {
    // Motor local não disponível neste posto
  } finally {
    window.clearTimeout(timer);
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
      const allowCloudFallback =
        pathPart.startsWith('/api/auth/') ||
        pathPart.startsWith('/api/sistema/instalador-centro-dados') ||
        pathPart.startsWith('/api/sistema/pacote-motor.zip');

      try {
        const localRes = await origFetch(rawUrl, init);
        if (localRes.ok || !allowCloudFallback) {
          setMotorSource('local');
          return localRes;
        }
      } catch (err) {
        if (!allowCloudFallback) {
          throw err;
        }
      }

      // Apenas autenticação SSO e download do instalador usam a Cloud quando o motor local ainda não está instalado
      const safeInit: RequestInit | undefined =
        init?.signal && init.signal.aborted ? { ...init, signal: undefined } : init;
      return origFetch(pathPart, safeInit);
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
