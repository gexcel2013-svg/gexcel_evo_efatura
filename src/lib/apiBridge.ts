/**
 * Ponte Híbrida Local-First + Cloud Zero-Storage (EVO-06 Importador e-Fatura <-> EVO-05 API + EVO-12 Gestor de Entidades)
 *
 * Interceta de forma transparente os pedidos a `http://127.0.0.1:8015` e `http://127.0.0.1:8090`:
 * 1. Quando acedido via plataforma Web (`*.evogex.com`), encaminha instantaneamente para a API da plataforma (`/api/...`)
 *    ou utiliza o motor local (`127.0.0.1:8015`) se este estiver ativo na máquina do cliente.
 * 2. Garante interligação contínua com os dados do Gestor de Entidades (EVO-12) tanto na Cloud Hetzner como localmente.
 */

const LOCAL_API_PREFIX = /^https?:\/\/(127\.0\.0\.1|localhost):8015(\/.*)?$/i;
const LOCAL_PB_PREFIX = /^https?:\/\/(127\.0\.0\.1|localhost):(8090|8095)(\/.*)?$/i;

const isCloudHost =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1';

const origFetch = window.fetch.bind(window);

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

      // Na Cloud (*.evogex.com), usar exclusivamente o motor do servidor Hetzner para todas as rotas exceto ações locais do PC
      if (isCloudHost && !isLocalOnlyAction) {
        const cloudRes = await origFetch(cloudUrl, init);
        return isEntidades ? await checkAndEnrichEntidadesResponse(cloudRes) : cloudRes;
      }

      // Ações locais (abrir explorador / abrir browser visível no PC) ou execução local em localhost
      if (!isCloudHost || isLocalOnlyAction) {
        try {
          const localRes = await origFetch(rawUrl, init);
          if (localRes.ok) {
            return isEntidades ? await checkAndEnrichEntidadesResponse(localRes) : localRes;
          }
        } catch {
          // Segue para fallback Cloud
        }
      }

      // Fallback para o endpoint Cloud na mesma origem
      const fallbackRes = await origFetch(cloudUrl, init);
      return isEntidades ? await checkAndEnrichEntidadesResponse(fallbackRes) : fallbackRes;
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

export {};
