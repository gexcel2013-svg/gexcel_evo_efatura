/**
 * Ponte Cross-Subdomínio para SSO e Estado do Centro de Dados (evoGex.com)
 * Partilha entre painéis (painel / entidades / efatura / ...) apenas metadados técnicos
 * de sessão e workspace no mesmo canal (Dev / Beta / Prod), mantendo Zero-Storage fiscal.
 */

export type EvoChannelKey = 'dev' | 'beta' | 'prod';
export type EvoAppSubdomain = 'painel' | 'entidades' | 'efatura' | 'portais' | 'conciliacao';

export interface SharedEvoSsoSession {
  id: string;
  username: string;
  nome: string;
  role: string;
  email: string;
  telefone?: string;
  client_code?: string;
  session_context?: 'OFFICE' | 'TELEWORK';
  telework_expires_at?: string;
  preferred_office_id?: string;
  token: string;
}

export interface SharedCentroEntry {
  id: string;
  nome: string;
  pastaEvogex: string;
  pastaAntiga?: string;
  evogexConfirmado: boolean;
  entidadesCount: number;
  wsId: string;
  updatedAt: string;
}

export interface SharedSandboxMeta {
  sandboxId: string;
  clientLabel: string;
  expiresAt: string;
  entidadesCount: number;
  activatedAt: string;
}

interface SharedCentroStore {
  activeId: string;
  items: Record<string, SharedCentroEntry>;
}

const WS_LOCAL_PREFIX = 'gexcel_evo_ws_id_v1::';
const MAX_SHARED_CENTROS = 6;
const SSO_COOKIE_MAX_AGE = 30 * 24 * 3600;
const CENTRO_COOKIE_MAX_AGE = 90 * 24 * 3600;

export function getEvoChannelKey(): EvoChannelKey {
  if (typeof window === 'undefined') return 'dev';
  const h = window.location.hostname.toLowerCase();
  if (h.startsWith('dev.') || h === 'localhost' || h === '127.0.0.1') {
    return 'dev';
  }
  if (h.startsWith('beta.') || h.startsWith('staging.')) {
    return 'beta';
  }
  return 'prod';
}

export function getSharedCookieDomain(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hostname.toLowerCase();
  if (h === 'evogex.com' || h.endsWith('.evogex.com')) {
    return '.evogex.com';
  }
  if (h === 'gexcelapps.com' || h.endsWith('.gexcelapps.com')) {
    return '.gexcelapps.com';
  }
  return null;
}

export function getEvoSubdomainUrl(appSubdomain: EvoAppSubdomain): string {
  const ch = getEvoChannelKey();
  const prefix = ch === 'dev' ? 'dev.' : ch === 'beta' ? 'beta.' : '';
  const rootDomain =
    typeof window !== 'undefined' && window.location.hostname.toLowerCase().endsWith('gexcelapps.com')
      ? 'gexcelapps.com'
      : 'evogex.com';
  return `https://${prefix}${appSubdomain}.${rootDomain}`;
}

export function isSafeEvoReturnUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'https:') {
      return (
        host === 'evogex.com' ||
        host.endsWith('.evogex.com') ||
        host === 'gexcelapps.com' ||
        host.endsWith('.gexcelapps.com')
      );
    }
    if (parsed.protocol === 'http:') {
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  } catch {
    return false;
  }
}

function getSsoCookieName(): string {
  return `gevo_sso_${getEvoChannelKey()}`;
}

function getCentroCookieName(): string {
  return `gevo_centro_${getEvoChannelKey()}`;
}

function readCookieRaw(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const target = `${name}=`;
    const parts = document.cookie ? document.cookie.split(';') : [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(target)) {
        return decodeURIComponent(trimmed.slice(target.length));
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function writeCookieRaw(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return;
  try {
    const domain = getSharedCookieDomain();
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const pieces = [
      `${name}=${encodeURIComponent(value)}`,
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'SameSite=Lax',
    ];
    if (domain) {
      pieces.push(`Domain=${domain}`);
    }
    if (isHttps) {
      pieces.push('Secure');
    }
    document.cookie = pieces.join('; ');
  } catch {
    // ignore
  }
}

function deleteCookieRaw(name: string): void {
  if (typeof document === 'undefined') return;
  try {
    const domain = getSharedCookieDomain();
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const base = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
    if (isHttps) base.push('Secure');
    document.cookie = base.join('; ');
    if (domain) {
      document.cookie = [...base, `Domain=${domain}`].join('; ');
    }
  } catch {
    // ignore
  }
}

function isGxtkExpired(rawToken: string): boolean {
  try {
    const clean = (rawToken || '').trim();
    if (!clean.startsWith('gxtk.')) return false;
    const parts = clean.split('.');
    if (parts.length !== 3 || !parts[1]) return true;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binStr = atob(padded);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const exp = Number(payload.exp || 0);
    return !exp || exp <= Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

export function writeSharedSsoCookie(payload: SharedEvoSsoSession): void {
  const token = String(payload?.token || '').trim();
  const username = String(payload?.username || '').trim();
  if (!token || !username) return;
  if (token.startsWith('gxtk.') && isGxtkExpired(token)) return;

  const compact: SharedEvoSsoSession = {
    id: String(payload.id || '1'),
    username,
    nome: String(payload.nome || username).trim(),
    role: String(payload.role || 'OPERADOR').trim(),
    email: String(payload.email || '').trim(),
    ...(payload.telefone ? { telefone: String(payload.telefone).trim() } : {}),
    ...(payload.client_code ? { client_code: String(payload.client_code).trim().toUpperCase() } : {}),
    ...(payload.session_context ? { session_context: payload.session_context } : {}),
    ...(payload.telework_expires_at ? { telework_expires_at: String(payload.telework_expires_at).trim() } : {}),
    ...(payload.preferred_office_id ? { preferred_office_id: String(payload.preferred_office_id).trim() } : {}),
    token,
  };
  writeCookieRaw(getSsoCookieName(), JSON.stringify(compact), SSO_COOKIE_MAX_AGE);
}

export function readSharedSsoCookie(): SharedEvoSsoSession | null {
  try {
    const raw = readCookieRaw(getSsoCookieName());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SharedEvoSsoSession>;
    const token = String(parsed?.token || '').trim();
    const username = String(parsed?.username || '').trim();
    if (!token || !username) return null;
    if (token.startsWith('gxtk.') && isGxtkExpired(token)) {
      clearSharedSsoCookie();
      return null;
    }
    return {
      id: String(parsed.id || '1'),
      username,
      nome: String(parsed.nome || username).trim(),
      role: String(parsed.role || 'OPERADOR').trim(),
      email: String(parsed.email || '').trim(),
      telefone: parsed.telefone ? String(parsed.telefone).trim() : '',
      client_code: parsed.client_code ? String(parsed.client_code).trim().toUpperCase() : undefined,
      session_context: parsed.session_context === 'TELEWORK' ? 'TELEWORK' : 'OFFICE',
      telework_expires_at: parsed.telework_expires_at ? String(parsed.telework_expires_at).trim() : '',
      preferred_office_id: parsed.preferred_office_id ? String(parsed.preferred_office_id).trim() : undefined,
      token,
    };
  } catch {
    return null;
  }
}

export function clearSharedSsoCookie(): void {
  deleteCookieRaw(getSsoCookieName());
}

function readCentroStore(): SharedCentroStore {
  try {
    const raw = readCookieRaw(getCentroCookieName());
    if (!raw) return { activeId: '', items: {} };
    const parsed = JSON.parse(raw) as Partial<SharedCentroStore>;
    const items: Record<string, SharedCentroEntry> = {};
    if (parsed && parsed.items && typeof parsed.items === 'object') {
      for (const [k, v] of Object.entries(parsed.items)) {
        if (!v || typeof v !== 'object') continue;
        const id = String(v.id || k).trim();
        if (!id) continue;
        items[id] = {
          id,
          nome: String(v.nome || 'Escritório Principal').trim(),
          pastaEvogex: String(v.pastaEvogex || 'C:\\Dados_evoGex').trim(),
          ...(v.pastaAntiga ? { pastaAntiga: String(v.pastaAntiga).trim() } : {}),
          evogexConfirmado: Boolean(v.evogexConfirmado),
          entidadesCount: Math.max(0, Number(v.entidadesCount || 0)),
          wsId: String(v.wsId || '').trim(),
          updatedAt: String(v.updatedAt || new Date().toISOString()),
        };
      }
    }
    return {
      activeId: String(parsed?.activeId || '').trim(),
      items,
    };
  } catch {
    return { activeId: '', items: {} };
  }
}

function writeCentroStore(store: SharedCentroStore): void {
  const entries = Object.values(store.items);
  if (entries.length > MAX_SHARED_CENTROS) {
    entries.sort((a, b) => {
      if (a.id === store.activeId) return -1;
      if (b.id === store.activeId) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    const pruned: Record<string, SharedCentroEntry> = {};
    for (const item of entries.slice(0, MAX_SHARED_CENTROS)) {
      pruned[item.id] = item;
    }
    store.items = pruned;
  }
  writeCookieRaw(getCentroCookieName(), JSON.stringify(store), CENTRO_COOKIE_MAX_AGE);
}

function isPrimaryOfficeId(id: string): boolean {
  const clean = (id || '').trim();
  return !clean || clean === 'escritorio-principal' || /-E01$/i.test(clean);
}

function findMatchingStoreEntry(store: SharedCentroStore, centroId?: string): SharedCentroEntry | null {
  const cid = (centroId || '').trim();
  if (cid && store.items[cid]) {
    return store.items[cid];
  }
  if (!cid && store.activeId && store.items[store.activeId]) {
    return store.items[store.activeId];
  }
  if (!cid || isPrimaryOfficeId(cid)) {
    if (store.items['escritorio-principal']) return store.items['escritorio-principal'];
    const e01 = Object.values(store.items).find((it) => /-E01$/i.test(it.id));
    if (e01) return e01;
  }
  if (!cid) {
    const first = Object.values(store.items)[0];
    return first || null;
  }
  return null;
}

function generateWsId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9]/g, '');
  return `ws_${rand}`;
}

export function getOrCreateSharedWorkspaceId(centroId?: string): string {
  const cid = (centroId || 'escritorio-principal').trim() || 'escritorio-principal';
  const localKey = `${WS_LOCAL_PREFIX}${cid}`;
  try {
    const store = readCentroStore();
    const matched = findMatchingStoreEntry(store, cid);
    const cookieWs = matched?.wsId && matched.wsId.length >= 16 ? matched.wsId : '';
    const localWs = (localStorage.getItem(localKey) || '').trim();
    const validLocal = localWs.length >= 16 ? localWs : '';

    const resolved = cookieWs || validLocal || generateWsId();

    if (validLocal !== resolved) {
      localStorage.setItem(localKey, resolved);
    }

    const existingExact = store.items[cid];
    if (!existingExact || existingExact.wsId !== resolved) {
      store.items[cid] = {
        id: cid,
        nome: existingExact?.nome || matched?.nome || 'Escritório Principal',
        pastaEvogex: existingExact?.pastaEvogex || matched?.pastaEvogex || 'C:\\Dados_evoGex',
        ...(existingExact?.pastaAntiga || matched?.pastaAntiga
          ? { pastaAntiga: existingExact?.pastaAntiga || matched?.pastaAntiga }
          : {}),
        evogexConfirmado: Boolean(existingExact?.evogexConfirmado || matched?.evogexConfirmado),
        entidadesCount: Math.max(0, Number(existingExact?.entidadesCount ?? matched?.entidadesCount ?? 0)),
        wsId: resolved,
        updatedAt: new Date().toISOString(),
      };
      if (!store.activeId) {
        store.activeId = cid;
      }
      writeCentroStore(store);
    }
    return resolved;
  } catch {
    return 'ws_ephemeral_fallback';
  }
}

export function writeSharedCentroMeta(
  entry: Omit<SharedCentroEntry, 'wsId' | 'updatedAt'> & { wsId?: string; makeActive?: boolean }
): void {
  const cid = (entry.id || 'escritorio-principal').trim() || 'escritorio-principal';
  try {
    const store = readCentroStore();
    const prev = store.items[cid] || findMatchingStoreEntry(store, cid);
    const localKey = `${WS_LOCAL_PREFIX}${cid}`;
    const localWs = (localStorage.getItem(localKey) || '').trim();
    const wsId =
      (entry.wsId && entry.wsId.length >= 16 ? entry.wsId : '') ||
      (prev?.wsId && prev.wsId.length >= 16 ? prev.wsId : '') ||
      (localWs.length >= 16 ? localWs : '') ||
      generateWsId();

    localStorage.setItem(localKey, wsId);

    const nextEntry: SharedCentroEntry = {
      id: cid,
      nome: (entry.nome || prev?.nome || 'Escritório Principal').trim(),
      pastaEvogex: (entry.pastaEvogex || prev?.pastaEvogex || 'C:\\Dados_evoGex').trim(),
      ...(entry.pastaAntiga || prev?.pastaAntiga
        ? { pastaAntiga: String(entry.pastaAntiga || prev?.pastaAntiga || '').trim() }
        : {}),
      evogexConfirmado: Boolean(entry.evogexConfirmado),
      entidadesCount: Math.max(0, Number(entry.entidadesCount || 0)),
      wsId,
      updatedAt: new Date().toISOString(),
    };

    store.items[cid] = nextEntry;
    if (isPrimaryOfficeId(cid) && cid !== 'escritorio-principal' && store.items['escritorio-principal']) {
      store.items['escritorio-principal'] = {
        ...store.items['escritorio-principal'],
        evogexConfirmado: nextEntry.evogexConfirmado,
        entidadesCount: nextEntry.entidadesCount,
        pastaEvogex: nextEntry.pastaEvogex,
        wsId,
        updatedAt: nextEntry.updatedAt,
      };
    }
    if (entry.makeActive !== false) {
      store.activeId = cid;
    }
    writeCentroStore(store);
  } catch {
    // ignore
  }
}

export function readSharedCentroMeta(centroId?: string): SharedCentroEntry | null {
  try {
    const store = readCentroStore();
    return findMatchingStoreEntry(store, centroId);
  } catch {
    return null;
  }
}

export function removeSharedCentroMeta(centroId: string): void {
  const cid = (centroId || '').trim();
  if (!cid) return;
  try {
    const store = readCentroStore();
    delete store.items[cid];
    if (store.activeId === cid) {
      store.activeId = Object.keys(store.items)[0] || '';
    }
    writeCentroStore(store);
  } catch {
    // ignore
  }
}

function getSandboxCookieName(): string {
  return `gevo_sandbox_${getEvoChannelKey()}`;
}

export function writeSharedSandboxMeta(meta: SharedSandboxMeta): void {
  if (!meta?.sandboxId) return;
  try {
    writeCookieRaw(getSandboxCookieName(), JSON.stringify(meta), 7 * 24 * 3600);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gevo-sandbox-changed', { detail: meta }));
    }
  } catch {
    // ignore
  }
}

export function readSharedSandboxMeta(): SharedSandboxMeta | null {
  try {
    const raw = readCookieRaw(getSandboxCookieName());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SharedSandboxMeta>;
    const sid = String(parsed?.sandboxId || '').trim().toUpperCase();
    if (!sid || !/^SBX-[A-Z0-9]{6,16}$/.test(sid)) return null;
    if (parsed?.expiresAt) {
      const expMs = Date.parse(parsed.expiresAt);
      if (Number.isFinite(expMs) && expMs <= Date.now()) {
        clearSharedSandboxMeta();
        return null;
      }
    }
    return {
      sandboxId: sid,
      clientLabel: String(parsed?.clientLabel || 'Espelho Temporário').trim(),
      expiresAt: String(parsed?.expiresAt || '').trim(),
      entidadesCount: Math.max(0, Number(parsed?.entidadesCount || 0)),
      activatedAt: String(parsed?.activatedAt || '').trim(),
    };
  } catch {
    return null;
  }
}

export function clearSharedSandboxMeta(): void {
  deleteCookieRaw(getSandboxCookieName());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gevo-sandbox-changed', { detail: null }));
  }
}
