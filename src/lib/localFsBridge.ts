/**
 * Ponte Direta de Sistema de Ficheiros no Browser (File System Access API — Zero .bat / Zero Atrito)
 * Permite ao utilizador escolher no Explorador do Windows onde instalar/ligar a pasta Dados_evoGex
 * e onde ler a pasta antiga Gexcel (tCredenciais.xml), criando automaticamente toda a
 * estrutura de subpastas e gravando os ficheiros SQLite (.db) diretamente no disco do cliente.
 */

import {
  getOrCreateSharedWorkspaceId,
  readSharedCentroMeta,
  readSharedSandboxMeta,
  writeSharedCentroMeta,
} from './evoCrossAppBridge';

export interface LocalFsCentroConfig {
  id: string;
  nome: string;
  hostname: string;
  pasta_evogex_display: string;
  pasta_motor_display: string;
  pasta_v4_display: string;
  pasta_v3_display: string;
  pasta_bdsrv_display: string;
  pasta_pdfs_display: string;
  pasta_gexcel_antiga_display: string;
  ligado: boolean;
  evogex_confirmado?: boolean;
  antiga_confirmada?: boolean;
  total_entidades_carregadas?: number;
  total_sqlites_gravados?: number;
  updated_at: string;
}

export interface ResumoDestinosConfigurados {
  id: string;
  nome: string;
  hostname: string;
  pastaEvogex: string;
  pastaV4: string;
  pastaGexcelAntiga: string;
  pastaV3: string;
  pastaBdsrv: string;
  pastaPdfs: string;
  evogexConfirmado: boolean;
  antigaConfirmada: boolean;
}

export function isWindowsPath(p?: string | null): boolean {
  if (!p) return false;
  const s = p.trim();
  return /^[A-Za-z]:\\/.test(s) || /^\\\\/.test(s);
}

const STORAGE_KEY = 'gexcel_local_fs_centro_v1';
const MAP_STORAGE_KEY = 'gexcel_local_fs_centros_map_v2';
const ACTIVE_ID_STORAGE_KEY = 'gexcel_local_fs_active_id_v2';
const DEVICE_ID_STORAGE_KEY = 'gexcel_evo_device_id_v1';
const IDB_NAME = 'gexcel_evogex_fs_db';
const IDB_STORE = 'dir_handles';

let activeEvogexHandle: any = null;
let activeEvogexHandleId: string | null = null;
let activeAntigaHandle: any = null;
let activeAntigaHandleId: string | null = null;

export function obterDeviceIdPosto(): string {
  try {
    const existing = (localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '').trim();
    if (existing.length >= 12) {
      return existing;
    }
    const rand =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9]/g, '');
    const novo = `dev_${rand}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, novo);
    return novo;
  } catch {
    return 'dev_ephemeral_fallback';
  }
}

export function obterWorkspaceIdIsolado(): string {
  try {
    const sbx = readSharedSandboxMeta();
    if (sbx?.sandboxId) {
      return `sbx_${sbx.sandboxId}`;
    }
    const centroId =
      (readSharedCentroMeta()?.id || localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || 'escritorio-principal').trim() ||
      'escritorio-principal';
    return getOrCreateSharedWorkspaceId(centroId);
  } catch {
    return 'ws_ephemeral_fallback';
  }
}

export function sugerirPastaEvogexPorEscritorio(officeId?: string, officeSeq?: number): string {
  const oid = (officeId || '').trim();
  if (!oid || oid === 'escritorio-principal' || (officeSeq !== undefined && officeSeq <= 1) || /-E01$/i.test(oid)) {
    return 'C:\\Dados_evoGex';
  }
  const safeSuffix = oid.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || `E${officeSeq || 2}`;
  return `C:\\Dados_evoGex_${safeSuffix}`;
}

function normalizeLocalFsCentro(raw: Partial<LocalFsCentroConfig>, fallbackId = 'escritorio-principal', officeSeq?: number): LocalFsCentroConfig {
  const cfg = { ...raw } as LocalFsCentroConfig;
  cfg.id = (cfg.id || fallbackId || 'escritorio-principal').trim();
  cfg.nome = (cfg.nome || 'Escritório Principal').trim();
  cfg.hostname = (cfg.hostname || 'COMPUTADOR-LOCAL').trim();
  if (
    !isWindowsPath(cfg.pasta_evogex_display) ||
    /dados_gexcelapps[\\/]dados_evogex/i.test(cfg.pasta_evogex_display)
  ) {
    cfg.pasta_evogex_display = sugerirPastaEvogexPorEscritorio(cfg.id, officeSeq);
  }
  const baseEvo = cfg.pasta_evogex_display;
  if (!isWindowsPath(cfg.pasta_motor_display) || !cfg.pasta_motor_display.toLowerCase().startsWith(baseEvo.toLowerCase())) {
    cfg.pasta_motor_display = `${baseEvo}\\motor`;
  }
  if (!isWindowsPath(cfg.pasta_v4_display) || !cfg.pasta_v4_display.toLowerCase().startsWith(baseEvo.toLowerCase())) {
    cfg.pasta_v4_display = `${baseEvo}\\BdsefaturaV4`;
  }
  if (!isWindowsPath(cfg.pasta_pdfs_display) || !cfg.pasta_pdfs_display.toLowerCase().startsWith(baseEvo.toLowerCase())) {
    cfg.pasta_pdfs_display = `${baseEvo}\\PDFs_Recibos`;
  }
  if (cfg.pasta_gexcel_antiga_display && !isWindowsPath(cfg.pasta_gexcel_antiga_display)) {
    cfg.pasta_gexcel_antiga_display = '';
  }
  const baseAntiga = isWindowsPath(cfg.pasta_gexcel_antiga_display)
    ? cfg.pasta_gexcel_antiga_display
    : 'C:\\Dados_GexcelApps';
  if (!isWindowsPath(cfg.pasta_v3_display)) {
    cfg.pasta_v3_display = `${baseAntiga}\\BdsefaturaV3`;
  }
  if (!isWindowsPath(cfg.pasta_bdsrv_display)) {
    cfg.pasta_bdsrv_display = `${baseAntiga}\\BdsRV`;
  }
  cfg.ligado = cfg.ligado ?? true;
  cfg.updated_at = cfg.updated_at || new Date().toISOString();
  return cfg;
}

function readRawCentrosMap(): Record<string, LocalFsCentroConfig> {
  try {
    const rawMap = localStorage.getItem(MAP_STORAGE_KEY);
    if (rawMap) {
      const parsed = JSON.parse(rawMap) as Record<string, Partial<LocalFsCentroConfig>>;
      const out: Record<string, LocalFsCentroConfig> = {};
      for (const [k, v] of Object.entries(parsed || {})) {
        if (v && typeof v === 'object') {
          const norm = normalizeLocalFsCentro(v, k);
          out[norm.id] = norm;
        }
      }
      return out;
    }
    const rawLegacy = localStorage.getItem(STORAGE_KEY);
    if (rawLegacy) {
      const leg = JSON.parse(rawLegacy) as Partial<LocalFsCentroConfig>;
      const norm = normalizeLocalFsCentro(leg, leg.id || 'escritorio-principal');
      const initMap = { [norm.id]: norm };
      localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(initMap));
      localStorage.setItem(ACTIVE_ID_STORAGE_KEY, norm.id);
      return initMap;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeCentrosMap(map: Record<string, LocalFsCentroConfig>): void {
  try {
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleIdb(key: string, handle: any): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

async function loadHandleIdb(key: string): Promise<any | null> {
  try {
    const db = await openIdb();
    return await new Promise<any>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function obterLocalFsTodosCentrosMap(): Record<string, LocalFsCentroConfig> {
  return readRawCentrosMap();
}

export function obterLocalFsCentroPorId(officeId: string): LocalFsCentroConfig | null {
  const oid = (officeId || '').trim();
  if (!oid) return null;
  const map = readRawCentrosMap();
  return map[oid] || null;
}

export function obterLocalFsCentroConfig(): LocalFsCentroConfig | null {
  try {
    const map = readRawCentrosMap();
    const activeId = (localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || '').trim();
    if (activeId && map[activeId]) {
      return map[activeId];
    }
    const keys = Object.keys(map);
    if (keys.length > 0) {
      localStorage.setItem(ACTIVE_ID_STORAGE_KEY, keys[0]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map[keys[0]]));
      return map[keys[0]];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeLocalFsCentro(JSON.parse(raw) as LocalFsCentroConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  }
}

export function selecionarLocalFsCentroAtivo(
  officeId: string,
  defaults?: { nome?: string; pastaEvogex?: string; pastaGexcelAntiga?: string; officeSeq?: number }
): LocalFsCentroConfig {
  const oid = (officeId || 'escritorio-principal').trim();
  const prevId = (localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || '').trim();
  if (prevId !== oid) {
    activeEvogexHandle = null;
    activeEvogexHandleId = null;
    activeAntigaHandle = null;
    activeAntigaHandleId = null;
  }
  const map = readRawCentrosMap();
  const existing = map[oid];
  const baseEvo =
    (existing?.evogex_confirmado && isWindowsPath(existing.pasta_evogex_display) ? existing.pasta_evogex_display : '') ||
    (isWindowsPath(defaults?.pastaEvogex) ? defaults!.pastaEvogex! : '') ||
    (existing && isWindowsPath(existing.pasta_evogex_display) ? existing.pasta_evogex_display : '') ||
    sugerirPastaEvogexPorEscritorio(oid, defaults?.officeSeq);
  const baseAnt =
    (existing?.antiga_confirmada && isWindowsPath(existing.pasta_gexcel_antiga_display) ? existing.pasta_gexcel_antiga_display : '') ||
    (isWindowsPath(defaults?.pastaGexcelAntiga) ? defaults!.pastaGexcelAntiga! : '') ||
    (existing?.pasta_gexcel_antiga_display || '');

  const updated = normalizeLocalFsCentro({
    ...existing,
    id: oid,
    nome: defaults?.nome?.trim() || existing?.nome || 'Escritório Principal',
    hostname: existing?.hostname || 'COMPUTADOR-LOCAL',
    pasta_evogex_display: baseEvo,
    pasta_gexcel_antiga_display: baseAnt,
    evogex_confirmado: Boolean(existing?.evogex_confirmado),
    antiga_confirmada: Boolean(existing?.antiga_confirmada || baseAnt),
    updated_at: existing?.updated_at || new Date().toISOString(),
  }, oid, defaults?.officeSeq);

  map[oid] = updated;
  writeCentrosMap(map);
  localStorage.setItem(ACTIVE_ID_STORAGE_KEY, oid);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  const sharedPrev = readSharedCentroMeta(oid);
  writeSharedCentroMeta({
    id: updated.id,
    nome: updated.nome,
    pastaEvogex: updated.pasta_evogex_display,
    pastaAntiga: updated.pasta_gexcel_antiga_display,
    evogexConfirmado: Boolean(updated.evogex_confirmado || sharedPrev?.evogexConfirmado),
    entidadesCount: Number(updated.total_entidades_carregadas ?? sharedPrev?.entidadesCount ?? 0),
    makeActive: true,
  });
  window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: updated }));
  if (prevId !== oid) {
    window.setTimeout(() => {
      void hidratarSessaoIsoladaLocal();
    }, 50);
  }
  return updated;
}

export function sincronizarEscritoriosLocaisComLicenca(
  offices: Array<{
    officeId: string;
    officeSeq?: number;
    officeName?: string;
    pastaEvogex?: string;
    pastaGexcelAntiga?: string;
  }>
): LocalFsCentroConfig | null {
  const valid = (offices || []).filter(o => o && o.officeId && o.officeId.trim().length > 0);
  if (valid.length === 0) return obterLocalFsCentroConfig();
  const ordered = [...valid].sort((a, b) => (a.officeSeq || 1) - (b.officeSeq || 1));
  const map = readRawCentrosMap();
  const legacyDefault = map['escritorio-principal'];
  const licensedIds = new Set(ordered.map(o => o.officeId.trim()));

  ordered.forEach((off, idx) => {
    const oid = off.officeId.trim();
    const oseq = off.officeSeq || idx + 1;
    let existing = map[oid];
    if (!existing && idx === 0 && legacyDefault) {
      existing = { ...legacyDefault, id: oid };
    }
    const cloudEvo = isWindowsPath(off.pastaEvogex) ? off.pastaEvogex!.trim() : '';
    const cloudAnt = isWindowsPath(off.pastaGexcelAntiga) ? off.pastaGexcelAntiga!.trim() : '';

    const pastaEvoFinal =
      (existing?.evogex_confirmado && isWindowsPath(existing.pasta_evogex_display) ? existing.pasta_evogex_display : '') ||
      cloudEvo ||
      (existing && isWindowsPath(existing.pasta_evogex_display) ? existing.pasta_evogex_display : '') ||
      sugerirPastaEvogexPorEscritorio(oid, oseq);
    const pastaAntFinal =
      (existing?.antiga_confirmada && isWindowsPath(existing.pasta_gexcel_antiga_display) ? existing.pasta_gexcel_antiga_display : '') ||
      cloudAnt ||
      (existing?.pasta_gexcel_antiga_display || '');

    map[oid] = normalizeLocalFsCentro({
      ...existing,
      id: oid,
      nome: off.officeName?.trim() || existing?.nome || `Escritório ${oseq}`,
      hostname: existing?.hostname || 'COMPUTADOR-LOCAL',
      pasta_evogex_display: pastaEvoFinal,
      pasta_gexcel_antiga_display: pastaAntFinal,
      evogex_confirmado: Boolean(existing?.evogex_confirmado),
      antiga_confirmada: Boolean(existing?.antiga_confirmada || pastaAntFinal),
      updated_at: existing?.updated_at || new Date().toISOString(),
    }, oid, oseq);
  });

  if (legacyDefault && !licensedIds.has('escritorio-principal')) {
    delete map['escritorio-principal'];
  }

  writeCentrosMap(map);

  const curActive = (localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || '').trim();
  const activeOid = licensedIds.has(curActive) ? curActive : ordered[0].officeId.trim();
  if (curActive !== activeOid) {
    activeEvogexHandle = null;
    activeEvogexHandleId = null;
    activeAntigaHandle = null;
    activeAntigaHandleId = null;
  }
  localStorage.setItem(ACTIVE_ID_STORAGE_KEY, activeOid);
  const activeCfg = map[activeOid];
  if (activeCfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeCfg));
    window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: activeCfg }));
  }
  return activeCfg || null;
}

export function sincronizarLocalFsComAppConfig(appConfig: any): LocalFsCentroConfig {
  const atual = obterLocalFsCentroConfig();
  const activeIdStored = (localStorage.getItem(ACTIVE_ID_STORAGE_KEY) || '').trim();
  const centros = Array.isArray(appConfig?.centros_dados) ? appConfig.centros_dados : [];
  const centroMatchingActual = activeIdStored ? centros.find((c: any) => c?.id === activeIdStored) : null;
  const centroAtivo = centroMatchingActual || centros.find((c: any) => c?.selecionado) || centros[0] || null;
  const preserveCloudOfficeId =
    Boolean(activeIdStored && activeIdStored !== 'escritorio-principal' && !centroMatchingActual && atual?.id === activeIdStored);

  const candidatoEvo = preserveCloudOfficeId
    ? ''
    : (isWindowsPath(centroAtivo?.pasta_evogex) && !/dados_gexcelapps/i.test(centroAtivo.pasta_evogex)
        ? centroAtivo.pasta_evogex
        : '') ||
      (isWindowsPath(appConfig?.centro_dados_pasta_evogex) && !/dados_gexcelapps/i.test(appConfig.centro_dados_pasta_evogex)
        ? appConfig.centro_dados_pasta_evogex
        : '') ||
      (isWindowsPath(appConfig?.pasta_v4) && !/dados_gexcelapps/i.test(appConfig.pasta_v4)
        ? String(appConfig.pasta_v4).replace(/[\\/]BdsefaturaV4[\\/]?$/i, '')
        : '');

  const candidatoAntiga = preserveCloudOfficeId
    ? ''
    : (isWindowsPath(centroAtivo?.pasta_gexcel_antiga) ? centroAtivo.pasta_gexcel_antiga : '') ||
      (isWindowsPath(appConfig?.centro_dados_pasta_gexcel_antiga) ? appConfig.centro_dados_pasta_gexcel_antiga : '') ||
      (isWindowsPath(appConfig?.pasta_v3)
        ? String(appConfig.pasta_v3).replace(/[\\/]BdsefaturaV3[\\/]?$/i, '')
        : '');

  const targetId = preserveCloudOfficeId
    ? atual!.id
    : centroAtivo?.id || atual?.id || appConfig?.centro_dados_ativo_id || 'escritorio-principal';

  const pastaEvoFinal =
    (atual?.evogex_confirmado && isWindowsPath(atual.pasta_evogex_display) ? atual.pasta_evogex_display : '') ||
    candidatoEvo ||
    (atual && isWindowsPath(atual.pasta_evogex_display) ? atual.pasta_evogex_display : '') ||
    sugerirPastaEvogexPorEscritorio(targetId);

  const pastaAntigaFinal =
    (atual?.antiga_confirmada && isWindowsPath(atual.pasta_gexcel_antiga_display) ? atual.pasta_gexcel_antiga_display : '') ||
    candidatoAntiga ||
    (atual && isWindowsPath(atual.pasta_gexcel_antiga_display) ? atual.pasta_gexcel_antiga_display : '') ||
    '';

  const pastaV4Final =
    (isWindowsPath(atual?.pasta_v4_display) && atual?.evogex_confirmado ? atual.pasta_v4_display : '') ||
    `${pastaEvoFinal}\\BdsefaturaV4`;

  const baseAntigaDisplay = pastaAntigaFinal || 'C:\\Dados_GexcelApps';
  const pastaV3Final =
    (isWindowsPath(appConfig?.pasta_v3) && !preserveCloudOfficeId ? appConfig.pasta_v3 : '') ||
    `${baseAntigaDisplay}\\BdsefaturaV3`;
  const pastaBdsrvFinal =
    (isWindowsPath(appConfig?.pasta_bdsrv) && !preserveCloudOfficeId ? appConfig.pasta_bdsrv : '') ||
    `${baseAntigaDisplay}\\BdsRV`;
  const pastaPdfsFinal =
    (isWindowsPath(atual?.pasta_pdfs_display) && atual?.evogex_confirmado ? atual.pasta_pdfs_display : '') ||
    `${pastaEvoFinal}\\PDFs_Recibos`;

  const merged: LocalFsCentroConfig = {
    id: targetId,
    nome: (preserveCloudOfficeId ? atual?.nome : centroAtivo?.nome) || appConfig?.centro_dados_nome || atual?.nome || 'Escritório Principal',
    hostname: (preserveCloudOfficeId ? atual?.hostname : centroAtivo?.hostname) || appConfig?.centro_dados_hostname || atual?.hostname || 'COMPUTADOR-LOCAL',
    pasta_evogex_display: pastaEvoFinal,
    pasta_motor_display: `${pastaEvoFinal}\\motor`,
    pasta_v4_display: pastaV4Final,
    pasta_v3_display: pastaV3Final,
    pasta_bdsrv_display: pastaBdsrvFinal,
    pasta_pdfs_display: pastaPdfsFinal,
    pasta_gexcel_antiga_display: pastaAntigaFinal,
    ligado: true,
    evogex_confirmado: Boolean(atual?.evogex_confirmado),
    antiga_confirmada: Boolean(atual?.antiga_confirmada || pastaAntigaFinal),
    total_entidades_carregadas: atual?.total_entidades_carregadas,
    total_sqlites_gravados: atual?.total_sqlites_gravados,
    updated_at: atual?.updated_at || new Date().toISOString(),
  };

  try {
    const map = readRawCentrosMap();
    map[merged.id] = merged;
    writeCentrosMap(map);
    localStorage.setItem(ACTIVE_ID_STORAGE_KEY, merged.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: merged }));
  } catch {
    // ignore storage quota errors
  }

  return merged;
}

export function obterResumoDestinosConfigurados(appConfig?: any): ResumoDestinosConfigurados {
  const local = appConfig ? sincronizarLocalFsComAppConfig(appConfig) : obterLocalFsCentroConfig();
  const pastaEvogex = local && isWindowsPath(local.pasta_evogex_display) ? local.pasta_evogex_display : 'C:\\Dados_evoGex';
  const pastaV4 = local && isWindowsPath(local.pasta_v4_display) ? local.pasta_v4_display : `${pastaEvogex}\\BdsefaturaV4`;
  const pastaGexcelAntiga =
    local && isWindowsPath(local.pasta_gexcel_antiga_display) ? local.pasta_gexcel_antiga_display : '';
  const baseAntiga = pastaGexcelAntiga || 'C:\\Dados_GexcelApps';
  const pastaV3 = local && isWindowsPath(local.pasta_v3_display) ? local.pasta_v3_display : `${baseAntiga}\\BdsefaturaV3`;
  const pastaBdsrv = local && isWindowsPath(local.pasta_bdsrv_display) ? local.pasta_bdsrv_display : `${baseAntiga}\\BdsRV`;
  const pastaPdfs = local && isWindowsPath(local.pasta_pdfs_display) ? local.pasta_pdfs_display : `${pastaEvogex}\\PDFs_Recibos`;

  return {
    id: local?.id || 'escritorio-principal',
    nome: local?.nome || 'Escritório Principal',
    hostname: local?.hostname || 'COMPUTADOR-LOCAL',
    pastaEvogex,
    pastaV4,
    pastaGexcelAntiga,
    pastaV3,
    pastaBdsrv,
    pastaPdfs,
    evogexConfirmado: Boolean(local?.evogex_confirmado),
    antigaConfirmada: Boolean(local?.antiga_confirmada || pastaGexcelAntiga),
  };
}

export function guardarLocalFsCentroConfig(cfg: LocalFsCentroConfig): void {
  const norm = normalizeLocalFsCentro(cfg, cfg.id || 'escritorio-principal');
  const map = readRawCentrosMap();
  map[norm.id] = norm;
  writeCentrosMap(map);
  localStorage.setItem(ACTIVE_ID_STORAGE_KEY, norm.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(norm));
  const sharedPrev = readSharedCentroMeta(norm.id);
  writeSharedCentroMeta({
    id: norm.id,
    nome: norm.nome,
    pastaEvogex: norm.pasta_evogex_display,
    pastaAntiga: norm.pasta_gexcel_antiga_display,
    evogexConfirmado: Boolean(norm.evogex_confirmado || sharedPrev?.evogexConfirmado),
    entidadesCount: Number(norm.total_entidades_carregadas ?? sharedPrev?.entidadesCount ?? 0),
    makeActive: true,
  });
  window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: norm }));
}

async function limparMotorDescompiladoSeExistir(evogexHandle: any): Promise<void> {
  if (!evogexHandle) return;
  try {
    const motorHandle = await evogexHandle.getDirectoryHandle('motor', { create: false });
    // Segurança Industrial Gexcel: elimina imediatamente qualquer pasta 'app' descompilada com ficheiros .py
    for (const dirLegado of ['app', 'venv', 'libs', 'python_engine']) {
      try {
        await motorHandle.removeEntry(dirLegado, { recursive: true });
      } catch {
        // já limpo
      }
    }
    for (const fichLegado of ['uv.exe', 'iniciar_motor_evogex.bat', 'pacote-motor.zip']) {
      try {
        await motorHandle.removeEntry(fichLegado);
      } catch {
        // já limpo
      }
    }
  } catch {
    // pasta motor ainda não existe
  }
}

async function garantirPermissaoHandle(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === 'function') {
      const perm = await handle.queryPermission({ mode });
      if (perm === 'granted') return true;
    }
    if (typeof handle.requestPermission === 'function') {
      const req = await handle.requestPermission({ mode });
      return req === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

export async function obterHandleEvogexAtivo(pedirPermissao = false): Promise<any | null> {
  const curId = obterLocalFsCentroConfig()?.id || 'escritorio-principal';
  if (!activeEvogexHandle || activeEvogexHandleId !== curId) {
    activeEvogexHandle = await loadHandleIdb(`evogex_root::${curId}`);
    if (!activeEvogexHandle && (curId === 'escritorio-principal' || /-E01$/i.test(curId))) {
      activeEvogexHandle = await loadHandleIdb('evogex_root');
    }
    activeEvogexHandleId = activeEvogexHandle ? curId : null;
  }
  if (!activeEvogexHandle) return null;
  if (pedirPermissao) {
    const ok = await garantirPermissaoHandle(activeEvogexHandle, 'readwrite');
    if (!ok) return null;
  }
  return activeEvogexHandle;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function escreverFicheiroNoHandle(rootHandle: any, subParts: string[], fileName: string, content: Uint8Array | string): Promise<void> {
  let curr = rootHandle;
  for (const part of subParts) {
    if (part) {
      curr = await curr.getDirectoryHandle(part, { create: true });
    }
  }
  const fileHandle = await curr.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export interface EstadoPastaLocalV4 {
  autoritativo: boolean;
  comprasNifs: Set<string>;
  vendasNifs: Set<string>;
  todosNifs: Set<string>;
}

let sqliteSyncQueue: Promise<unknown> = Promise.resolve();

function obterTokenSessaoLimpeza(): string {
  try {
    const rawEvo =
      sessionStorage.getItem('gexcel_evo06_auth_session') ||
      localStorage.getItem('gexcel_evo06_auth_session');
    if (rawEvo) {
      const parsed = JSON.parse(rawEvo);
      if (parsed?.token && typeof parsed.token === 'string') {
        return parsed.token.trim();
      }
    }
  } catch {
    // ignore
  }
  try {
    const legacyTok = localStorage.getItem('gexcel_app_auth_token');
    if (legacyTok) return legacyTok.trim();
  } catch {
    // ignore
  }
  return '';
}

async function chamarLimparBaseServidor(queryString: string): Promise<void> {
  const url = `http://127.0.0.1:8015/api/base-dados/limpar?${queryString}`;
  const tok = obterTokenSessaoLimpeza();
  const headers: Record<string, string> = {};
  if (tok) {
    headers['X-Auth-Token'] = tok;
    headers['Authorization'] = `Bearer ${tok}`;
  }
  try {
    const res = await fetch(url, { method: 'POST', headers });
    if (res.status === 401 && tok) {
      await fetch(url, { method: 'POST' });
    }
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao limpar cache no servidor:', err);
  }
}

async function temFicheiroDbValido(dirHandle: any, fileName: string): Promise<boolean> {
  try {
    const fh = await dirHandle.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

async function lerEstadoRealPastaLocalV4DeHandle(rootHandle: any): Promise<EstadoPastaLocalV4> {
  const vazio: EstadoPastaLocalV4 = {
    autoritativo: false,
    comprasNifs: new Set<string>(),
    vendasNifs: new Set<string>(),
    todosNifs: new Set<string>(),
  };
  if (!rootHandle) return vazio;

  try {
    if (typeof rootHandle.queryPermission === 'function') {
      const perm = await rootHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return vazio;
    }
  } catch {
    return vazio;
  }

  const comprasNifs = new Set<string>();
  const vendasNifs = new Set<string>();
  const todosNifs = new Set<string>();

  try {
    let v4Handle: any = null;
    try {
      v4Handle = await rootHandle.getDirectoryHandle('BdsefaturaV4', { create: false });
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        return { autoritativo: true, comprasNifs, vendasNifs, todosNifs };
      }
      return vazio;
    }

    if (!v4Handle || typeof v4Handle.entries !== 'function') {
      return vazio;
    }

    for await (const [name, entry] of v4Handle.entries()) {
      if (entry?.kind === 'directory' && /^\d{9}$/.test(name)) {
        const [temCompras, temVendas] = await Promise.all([
          temFicheiroDbValido(entry, `compras_${name}.db`),
          temFicheiroDbValido(entry, `vendas_${name}.db`),
        ]);
        if (temCompras) {
          comprasNifs.add(name);
          todosNifs.add(name);
        }
        if (temVendas) {
          vendasNifs.add(name);
          todosNifs.add(name);
        }
      }
    }

    return {
      autoritativo: true,
      comprasNifs,
      vendasNifs,
      todosNifs,
    };
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao ler BdsefaturaV4 local:', err);
    return vazio;
  }
}

export async function lerEstadoRealPastaLocalV4(): Promise<EstadoPastaLocalV4> {
  const rootHandle = await obterHandleEvogexAtivo(false);
  return lerEstadoRealPastaLocalV4DeHandle(rootHandle);
}

export async function purgarNifsAusentesNoServidor(
  nifsServidor: string[],
  nifsLocaisPresentes: Set<string>,
  tipo: 'compras' | 'vendas' | 'tudo'
): Promise<void> {
  const ausentes = nifsServidor.filter(n => n && !nifsLocaisPresentes.has(n));
  if (ausentes.length === 0) return;

  if (nifsLocaisPresentes.size === 0 && nifsServidor.length > 0) {
    await chamarLimparBaseServidor(`tipo=${encodeURIComponent(tipo)}`);
    return;
  }

  for (const nif of ausentes) {
    await chamarLimparBaseServidor(`tipo=${encodeURIComponent(tipo)}&nif=${encodeURIComponent(nif)}`);
  }
}

export async function tentarRestaurarPermissaoSilenciosaNoClique(): Promise<boolean> {
  const rootHandle = await obterHandleEvogexAtivo(false);
  if (!rootHandle) return false;
  try {
    if (typeof rootHandle.queryPermission === 'function') {
      const current = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (current === 'granted') return true;
      if (typeof rootHandle.requestPermission === 'function') {
        const req = await rootHandle.requestPermission({ mode: 'readwrite' });
        return req === 'granted';
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function garantirAcessoPastaLocalNoClique(): Promise<boolean> {
  const win = window as any;
  const rootHandle = await obterHandleEvogexAtivo(false);
  if (rootHandle) {
    let estavaGranted = false;
    try {
      if (typeof rootHandle.queryPermission === 'function') {
        estavaGranted = (await rootHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
      }
    } catch {
      estavaGranted = false;
    }

    const ok = estavaGranted || (await garantirPermissaoHandle(rootHandle, 'readwrite'));
    if (ok) {
      if (!estavaGranted) {
        const estadoLocal = await lerEstadoRealPastaLocalV4DeHandle(rootHandle);
        if (estadoLocal.autoritativo && estadoLocal.todosNifs.size === 0) {
          await chamarLimparBaseServidor('tipo=tudo');
        } else {
          await hidratarSessaoIsoladaLocal(true);
        }
      }
      return true;
    }
  }

  if (typeof win.showDirectoryPicker !== 'function') {
    return false;
  }

  const cfgAtual = obterLocalFsCentroConfig();
  const res = await escolherEInstalarPastaDadosEvogex({
    nomeCentro: cfgAtual?.nome || 'Escritório Principal',
    hostname: cfgAtual?.hostname || 'COMPUTADOR-LOCAL',
    caminhoProposto: cfgAtual?.pasta_evogex_display || 'C:\\Dados_evoGex',
    naoDescarregarDoServidorSeVazio: true,
    limparServidorSePastaVazia: true,
  });
  return res.ok;
}

/**
 * Descarrega os ficheiros SQLite (.db) da empresa (ou todos) e grava-os fisicamente
 * na pasta Dados_evoGex\BdsefaturaV4 escolhida pelo utilizador no computador/servidor.
 */
export function sincronizarSqlitesParaPastaLocal(nif?: string, pedirPermissao = false): Promise<number> {
  const exec = async (): Promise<number> => {
    try {
      if (typeof window !== 'undefined' && (window as any).__GEXCEL_MOTOR_SOURCE__ === 'local') {
        return 0;
      }
      if (readSharedSandboxMeta()) return 0;
      const rootHandle = await obterHandleEvogexAtivo(pedirPermissao);
      if (!rootHandle) return 0;

      if (!pedirPermissao && typeof rootHandle.queryPermission === 'function') {
        const perm = await rootHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return 0;
      }

      const url = nif
        ? `/api/efatura/exportar-sqlite/${encodeURIComponent(nif)}`
        : '/api/efatura/exportar-todos-sqlites';
      const res = await fetch(url);
      if (!res.ok) return 0;
      const data = await res.json();
      const ficheiros: Array<{ rel_path: string; base64: string }> = data.ficheiros || [];
      if (ficheiros.length === 0) return 0;

      const v4Handle = await rootHandle.getDirectoryHandle('BdsefaturaV4', { create: true });
      let gravados = 0;
      for (const f of ficheiros) {
        const parts = f.rel_path.split('/').filter(Boolean);
        const fname = parts.pop();
        if (!fname) continue;
        const bytes = base64ToUint8Array(f.base64);
        await escreverFicheiroNoHandle(v4Handle, parts, fname, bytes);
        gravados++;
      }

      const cfg = obterLocalFsCentroConfig();
      if (cfg) {
        cfg.evogex_confirmado = true;
        cfg.total_sqlites_gravados = gravados;
        cfg.updated_at = new Date().toISOString();
        guardarLocalFsCentroConfig(cfg);
      }
      return gravados;
    } catch (err) {
      console.warn('[LOCAL FS] Aviso ao gravar SQLite na pasta local:', err);
      return 0;
    }
  };

  const run = sqliteSyncQueue.then(exec, exec);
  sqliteSyncQueue = run;
  return run;
}

export async function abrirPastaNoExploradorNativo(
  subpasta?: string,
  origem: 'evogex' | 'antiga' = 'evogex'
): Promise<boolean> {
  const win = window as any;
  if (typeof win.showDirectoryPicker !== 'function') return false;
  try {
    if (origem === 'antiga') {
      const curId = obterLocalFsCentroConfig()?.id || 'escritorio-principal';
      let antHandle = activeAntigaHandle && activeAntigaHandleId === curId ? activeAntigaHandle : null;
      if (!antHandle) {
        antHandle = await loadHandleIdb(`gexcel_antiga_root::${curId}`);
        if (!antHandle && (curId === 'escritorio-principal' || /-E01$/i.test(curId))) {
          antHandle = await loadHandleIdb('gexcel_antiga_root');
        }
      }
      if (antHandle) {
        activeAntigaHandle = antHandle;
        activeAntigaHandleId = curId;
        let targetHandle = antHandle;
        if (subpasta) {
          try {
            targetHandle = await antHandle.getDirectoryHandle(subpasta, { create: true });
          } catch {
            targetHandle = antHandle;
          }
        }
        await win.showDirectoryPicker({ mode: 'readwrite', startIn: targetHandle });
        return true;
      }
      const resAnt = await escolherPastaDadosGexcelAntigos();
      return resAnt.ok;
    }

    const rootHandle = await obterHandleEvogexAtivo(true);
    if (rootHandle) {
      await limparMotorDescompiladoSeExistir(rootHandle);
      let startHandle = rootHandle;
      if (subpasta) {
        try {
          startHandle = await rootHandle.getDirectoryHandle(subpasta, { create: true });
        } catch {
          startHandle = rootHandle;
        }
      }
      await win.showDirectoryPicker({ mode: 'readwrite', startIn: startHandle });
      return true;
    }

    // Se a pasta Dados_evoGex ainda não tinha sido ligada no Passo 1, ao selecioná-la aqui fica imediatamente ligada e gravada!
    const resEvo = await escolherEInstalarPastaDadosEvogex();
    return resEvo.ok;
  } catch {
    return false;
  }
}

async function tentarLerTCredenciaisDeHandle(dirHandle: any): Promise<string | null> {
  // 1. Direto na pasta escolhida: tCredenciais.xml
  try {
    const fh = await dirHandle.getFileHandle('tCredenciais.xml');
    const file = await fh.getFile();
    return await file.text();
  } catch {
    // ignore
  }
  // 2. Subpasta Dados_GexcelApps/tCredenciais.xml ou Dados GexcelApps/tCredenciais.xml
  for (const subName of ['Dados_GexcelApps', 'Dados GexcelApps', 'AA_MultiIntegrador']) {
    try {
      const sub = await dirHandle.getDirectoryHandle(subName);
      const fh = await sub.getFileHandle('tCredenciais.xml');
      const file = await fh.getFile();
      return await file.text();
    } catch {
      // ignore
    }
  }
  return null;
}

function inferirCaminhoCompletoAntiga(pickedName: string, xmlContent: string | null, caminhoProposto?: string): string {
  const cleanPicked = (pickedName || 'Dados_GexcelApps').trim();
  const prop = (caminhoProposto || '').trim();

  // 1. Se o utilizador escreveu manualmente um caminho que já termina com o nome da pasta escolhida, preserva-o
  if (prop && prop.toLowerCase().endsWith(cleanPicked.toLowerCase())) {
    return prop;
  }

  // 2. Tenta inferir a pasta pai real (ex: C:\Users\...\Dropbox) a partir do próprio tCredenciais.xml
  if (xmlContent) {
    const matchDropbox = xmlContent.match(/([A-Za-z]:\\[^<>"]*?\\Dropbox)(?:\\|<)/i);
    if (matchDropbox && matchDropbox[1]) {
      return `${matchDropbox[1]}\\${cleanPicked}`;
    }
    const matchUser = xmlContent.match(/([A-Za-z]:\\Users\\[^\\<>"]+)/i);
    if (matchUser && matchUser[1] && /dropbox|onedrive|desktop|document/i.test(xmlContent)) {
      if (/dropbox/i.test(xmlContent)) {
        return `${matchUser[1]}\\Dropbox\\${cleanPicked}`;
      }
    }
  }

  // 3. Caso contrário, mostra diretamente o nome real da pasta selecionada pelo utilizador no Windows Explorer
  if (/^[A-Za-z]:\\?$/i.test(cleanPicked)) {
    return 'C:\\Dados_GexcelApps';
  }
  return `C:\\${cleanPicked}`;
}

/**
 * Abre a janela nativa do Windows Explorer para o utilizador escolher onde instalar/criar
 * a pasta Dados_evoGex (no computador ou servidor), cria imediatamente todas as subpastas
 * (BdsefaturaV4, safedrive, index_core, motor, BdsRV, PDFs) e sincroniza os SQLites.
 */
export async function escolherEInstalarPastaDadosEvogex(opcoes?: {
  centroId?: string;
  officeSeq?: number;
  subpastaSugerida?: string;
  nomeCentro?: string;
  hostname?: string;
  caminhoProposto?: string;
  naoDescarregarDoServidorSeVazio?: boolean;
  limparServidorSePastaVazia?: boolean;
  sincronizarDoServidor?: boolean;
}): Promise<{ ok: boolean; config?: LocalFsCentroConfig; erro?: string }> {
  const win = window as any;
  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      erro: 'O seu navegador não suporta seleção direta de pastas. Utilize o Google Chrome ou Microsoft Edge.',
    };
  }

  try {
    const cfgAtivo = obterLocalFsCentroConfig();
    const targetId = (opcoes?.centroId || cfgAtivo?.id || 'escritorio-principal').trim();
    const cfgAlvo = obterLocalFsCentroPorId(targetId) || cfgAtivo;
    const isPrimary = targetId === 'escritorio-principal' || /-E01$/i.test(targetId) || (opcoes?.officeSeq !== undefined && opcoes.officeSeq <= 1);
    const defaultEvoPath = sugerirPastaEvogexPorEscritorio(targetId, opcoes?.officeSeq);
    const prop = (opcoes?.caminhoProposto || cfgAlvo?.pasta_evogex_display || '').trim();
    const defaultFolderName =
      opcoes?.subpastaSugerida?.trim() ||
      (isPrimary
        ? 'Dados_evoGex'
        : defaultEvoPath.split(/[\\/]/).filter(Boolean).pop() || `Dados_evoGex_${targetId.replace(/[^A-Za-z0-9_-]+/g, '_')}`);

    const pickedHandle = await win.showDirectoryPicker({ mode: 'readwrite' });
    const pickedName: string = (pickedHandle.name || defaultFolderName).trim();

    let evogexHandle = pickedHandle;
    let displayRoot = defaultEvoPath;

    if (/^dados_evogex/i.test(pickedName)) {
      evogexHandle = pickedHandle;
      displayRoot = prop && prop.toLowerCase().endsWith(pickedName.toLowerCase()) ? prop : `C:\\${pickedName}`;
    } else if (/^[A-Za-z]:\\?$/i.test(pickedName) || pickedName.includes('(')) {
      // Utilizador escolheu a raiz do disco (ex: "Disco Local (C:)")
      evogexHandle = await pickedHandle.getDirectoryHandle(defaultFolderName, { create: true });
      displayRoot = `C:\\${defaultFolderName}`;
    } else {
      // Utilizador escolheu uma pasta específica onde quer criar a pasta deste escritório
      evogexHandle = await pickedHandle.getDirectoryHandle(defaultFolderName, { create: true });
      if (prop && prop.toLowerCase().endsWith(pickedName.toLowerCase())) {
        displayRoot = `${prop}\\${defaultFolderName}`;
      } else {
        displayRoot = `C:\\${pickedName}\\${defaultFolderName}`;
      }
    }

    // Criar toda a estrutura oficial automaticamente dentro da pasta deste escritório
    for (const sub of ['BdsefaturaV4', 'BdsefaturaV3', 'BdsRV', 'PDFs_Recibos', 'safedrive', 'index_core', 'motor', 'logs']) {
      await evogexHandle.getDirectoryHandle(sub, { create: true });
    }

    // Limpar de imediato qualquer pasta 'motor\app' descompilada (.py) se tiver ficado de testes anteriores
    await limparMotorDescompiladoSeExistir(evogexHandle);

    const nomeFinal = opcoes?.nomeCentro?.trim() || cfgAlvo?.nome || 'Escritório Principal';
    const hostFinal = opcoes?.hostname?.trim() || cfgAlvo?.hostname || 'COMPUTADOR-LOCAL';

    const totalEntidades = cfgAlvo?.total_entidades_carregadas || 0;
    const pastaAntigaDisplay = cfgAlvo?.pasta_gexcel_antiga_display || '';

    const novoCfg: LocalFsCentroConfig = {
      id: targetId,
      nome: nomeFinal,
      hostname: hostFinal,
      pasta_evogex_display: displayRoot,
      pasta_motor_display: `${displayRoot}\\motor`,
      pasta_v4_display: `${displayRoot}\\BdsefaturaV4`,
      pasta_v3_display: pastaAntigaDisplay ? `${pastaAntigaDisplay}\\BdsefaturaV3` : `${displayRoot}\\BdsefaturaV3`,
      pasta_bdsrv_display: pastaAntigaDisplay ? `${pastaAntigaDisplay}\\BdsRV` : `${displayRoot}\\BdsRV`,
      pasta_pdfs_display: `${displayRoot}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: pastaAntigaDisplay,
      ligado: true,
      evogex_confirmado: true,
      antiga_confirmada: Boolean(cfgAlvo?.antiga_confirmada || pastaAntigaDisplay),
      total_entidades_carregadas: totalEntidades,
      updated_at: new Date().toISOString(),
    };

    // Gravar manifesto centro_dados.json dentro da pasta escolhida
    await escreverFicheiroNoHandle(
      evogexHandle,
      [],
      'centro_dados.json',
      JSON.stringify(novoCfg, null, 2)
    );

    activeEvogexHandle = evogexHandle;
    activeEvogexHandleId = targetId;
    await saveHandleIdb(`evogex_root::${targetId}`, evogexHandle);
    if (isPrimary) {
      await saveHandleIdb('evogex_root', evogexHandle);
    }
    guardarLocalFsCentroConfig(novoCfg);

    const estadoV4Local = await lerEstadoRealPastaLocalV4DeHandle(evogexHandle);
    if (opcoes?.sincronizarDoServidor) {
      await sincronizarSqlitesParaPastaLocal();
    } else if (estadoV4Local.todosNifs.size === 0) {
      // Pasta BdsefaturaV4 local vazia: nunca despejar dados antigos do servidor para a pasta vazia.
      if (opcoes?.limparServidorSePastaVazia || opcoes?.naoDescarregarDoServidorSeVazio !== false) {
        await chamarLimparBaseServidor('tipo=tudo');
      }
    } else if (opcoes?.naoDescarregarDoServidorSeVazio === false) {
      await sincronizarSqlitesParaPastaLocal();
    }

    return { ok: true, config: novoCfg };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, erro: 'Seleção de pasta cancelada.' };
    }
    return { ok: false, erro: err?.message || 'Não foi possível configurar a pasta selecionada.' };
  }
}

/**
 * Abre a janela nativa do Windows Explorer para o utilizador apontar à pasta antiga
 * Dados_GexcelApps (onde está tCredenciais.xml, BdsefaturaV3 e BdsRV), carregando
 * automaticamente todas as empresas e senhas da AT para o novo sistema.
 */
export async function escolherPastaDadosGexcelAntigos(
  caminhoProposto?: string,
  centroId?: string
): Promise<{ ok: boolean; totalEntidades?: number; config?: LocalFsCentroConfig; erro?: string }> {
  const win = window as any;
  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      erro: 'O seu navegador não suporta seleção direta de pastas. Utilize o Google Chrome ou Microsoft Edge.',
    };
  }

  try {
    const pickedHandle = await win.showDirectoryPicker({ mode: 'readwrite' });
    const cfgAtualPrev = (centroId ? obterLocalFsCentroPorId(centroId) : null) || obterLocalFsCentroConfig();
    const targetId = (centroId || cfgAtualPrev?.id || 'escritorio-principal').trim();
    activeAntigaHandle = pickedHandle;
    activeAntigaHandleId = targetId;
    await saveHandleIdb(`gexcel_antiga_root::${targetId}`, pickedHandle);
    if (targetId === 'escritorio-principal' || /-E01$/i.test(targetId)) {
      await saveHandleIdb('gexcel_antiga_root', pickedHandle);
    }

    const pickedName: string = (pickedHandle.name || 'Dados_GexcelApps').trim();
    const xmlContent = await tentarLerTCredenciaisDeHandle(pickedHandle);
    const displayAntiga = inferirCaminhoCompletoAntiga(pickedName, xmlContent, caminhoProposto);

    let totalEntidades = 0;

    if (xmlContent) {
      await saveHandleIdb(`tcred_xml_text::${targetId}`, xmlContent);
      const res = await fetch('/api/entidades/importar-tcredenciais', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Evo-Workspace-Id': obterWorkspaceIdIsolado(),
        },
        body: JSON.stringify({ xml_content: xmlContent, nome_pasta: displayAntiga }),
      });
      if (res.ok) {
        const data = await res.json();
        totalEntidades = data.total_entidades || 0;
      }
    }

    // NUNCA colocar Dados_evoGex dentro de Dados_GexcelApps por defeito
    let cfgAtual = cfgAtualPrev;
    const evoPath = cfgAtual?.pasta_evogex_display || sugerirPastaEvogexPorEscritorio(targetId);

    cfgAtual = {
      id: targetId,
      nome: cfgAtual?.nome || 'Escritório Principal',
      hostname: cfgAtual?.hostname || 'COMPUTADOR-LOCAL',
      pasta_evogex_display: evoPath,
      pasta_motor_display: `${evoPath}\\motor`,
      pasta_v4_display: `${evoPath}\\BdsefaturaV4`,
      pasta_v3_display: `${displayAntiga}\\BdsefaturaV3`,
      pasta_bdsrv_display: `${displayAntiga}\\BdsRV`,
      pasta_pdfs_display: `${evoPath}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: displayAntiga,
      ligado: true,
      evogex_confirmado: Boolean(cfgAtual?.evogex_confirmado),
      antiga_confirmada: true,
      total_entidades_carregadas: totalEntidades || cfgAtual?.total_entidades_carregadas,
      updated_at: new Date().toISOString(),
    };

    guardarLocalFsCentroConfig(cfgAtual);
    const estLocal = await lerEstadoRealPastaLocalV4();
    if (!estLocal.autoritativo || estLocal.todosNifs.size > 0) {
      await sincronizarSqlitesParaPastaLocal();
    }

    if (!xmlContent) {
      return {
        ok: true,
        totalEntidades: 0,
        config: cfgAtual,
        erro: `Pasta '${displayAntiga}' ligada (nota: não foi encontrado tCredenciais.xml nesta pasta; foram mantidas as empresas atuais).`,
      };
    }

    return { ok: true, totalEntidades, config: cfgAtual };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, erro: 'Seleção de pasta cancelada.' };
    }
    return { ok: false, erro: err?.message || 'Falha ao ler a pasta antiga do Excel.' };
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    bin += String.fromCharCode(...slice);
  }
  return window.btoa(bin);
}

async function lerBytesDataDbDeHandle(evogexHandle: any): Promise<Uint8Array | null> {
  if (!evogexHandle) return null;
  const caminhos: string[][] = [
    ['index_core', 'pb_data', 'data.db'],
    ['pb_data', 'data.db'],
  ];
  for (const parts of caminhos) {
    try {
      let curr = evogexHandle;
      for (const dirName of parts.slice(0, -1)) {
        curr = await curr.getDirectoryHandle(dirName, { create: false });
      }
      const fh = await curr.getFileHandle(parts[parts.length - 1], { create: false });
      const file = await fh.getFile();
      if (file.size > 0 && file.size <= 45 * 1024 * 1024) {
        return new Uint8Array(await file.arrayBuffer());
      }
    } catch {
      // continua
    }
  }
  return null;
}

async function lerCentroJsonDoHandle(evogexHandle: any): Promise<Partial<LocalFsCentroConfig> | null> {
  try {
    const fh = await evogexHandle.getFileHandle('centro_dados.json', { create: false });
    const file = await fh.getFile();
    const txt = await file.text();
    return JSON.parse(txt) as Partial<LocalFsCentroConfig>;
  } catch {
    return null;
  }
}

/**
 * Hidrata em RAM na Cloud Hetzner apenas a base oficial index_core (Gestor de Entidades),
 * entidades (tCredenciais.xml) e bases SQLite (controlo_geral.db / pendentes_efatura.db)
 * pertencentes a este posto local.
 */
export async function hidratarSessaoIsoladaLocal(silentEvent = false): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (readSharedSandboxMeta()) return false;
  const curCfg = obterLocalFsCentroConfig();
  const curId = (curCfg?.id || 'escritorio-principal').trim() || 'escritorio-principal';
  const wsId = obterWorkspaceIdIsolado();
  let algoHidratado = false;

  // A0. Hidratar base oficial index_core/pb_data/data.db a partir da pasta Dados_evoGex autorizada
  try {
    const evoHandle = await obterHandleEvogexAtivo(false);
    if (evoHandle) {
      let readOk = true;
      if (typeof evoHandle.queryPermission === 'function') {
        const perm = await evoHandle.queryPermission({ mode: 'read' });
        readOk = perm === 'granted';
      }
      if (readOk) {
        const dbBytes = await lerBytesDataDbDeHandle(evoHandle);
        if (dbBytes && dbBytes.length > 0) {
          const hRes = await fetch('/api/bridge/workspace/hydrate-sqlite', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Evo-Workspace-Id': wsId,
            },
            body: JSON.stringify({ sqlite_b64: arrayBufferToBase64(dbBytes.buffer as ArrayBuffer) }),
          });
          if (hRes.ok) {
            const hData = await hRes.json().catch(() => null);
            const entCount = Number(hData?.entidades_count || 0);
            if (entCount > 0 || curCfg) {
              const baseCfg = curCfg || normalizeLocalFsCentro({ id: curId }, curId);
              const nextCfg: LocalFsCentroConfig = {
                ...baseCfg,
                evogex_confirmado: true,
                total_entidades_carregadas: entCount || baseCfg.total_entidades_carregadas,
                updated_at: new Date().toISOString(),
              };
              const map = readRawCentrosMap();
              map[nextCfg.id] = nextCfg;
              writeCentrosMap(map);
              localStorage.setItem(ACTIVE_ID_STORAGE_KEY, nextCfg.id);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCfg));
              writeSharedCentroMeta({
                id: nextCfg.id,
                nome: nextCfg.nome,
                pastaEvogex: nextCfg.pasta_evogex_display,
                pastaAntiga: nextCfg.pasta_gexcel_antiga_display,
                evogexConfirmado: true,
                entidadesCount: entCount,
                makeActive: true,
              });
            }
            if (entCount > 0) {
              algoHidratado = true;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao hidratar data.db do Gestor de Entidades:', err);
  }

  // A. Hidratar entidades (tCredenciais.xml) do posto ativo
  try {
    let antHandle = activeAntigaHandle && activeAntigaHandleId === curId ? activeAntigaHandle : null;
    if (!antHandle) {
      antHandle = await loadHandleIdb(`gexcel_antiga_root::${curId}`);
      if (!antHandle && (curId === 'escritorio-principal' || /-E01$/i.test(curId))) {
        antHandle = await loadHandleIdb('gexcel_antiga_root');
      }
    }

    let xmlContent: string | null = null;
    if (antHandle && typeof antHandle.queryPermission === 'function') {
      try {
        const perm = await antHandle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          xmlContent = await tentarLerTCredenciaisDeHandle(antHandle);
          if (xmlContent) {
            await saveHandleIdb(`tcred_xml_text::${curId}`, xmlContent);
          }
        }
      } catch {
        // fallback para cache local IndexedDB
      }
    }

    if (!xmlContent) {
      const cached = await loadHandleIdb(`tcred_xml_text::${curId}`);
      if (typeof cached === 'string' && cached.trim()) {
        xmlContent = cached;
      }
    }

    if (xmlContent && xmlContent.trim()) {
      const resXml = await fetch('/api/entidades/importar-tcredenciais', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Evo-Workspace-Id': wsId,
        },
        body: JSON.stringify({
          xml_content: xmlContent,
          nome_pasta: curCfg?.pasta_gexcel_antiga_display || '',
        }),
      });
      if (resXml.ok) {
        algoHidratado = true;
      }
    }
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao hidratar tCredenciais local:', err);
  }

  // B. Hidratar controlo_geral.db e pendentes_efatura.db da pasta BdsefaturaV4 local (se já autorizada)
  try {
    const evoHandle = await obterHandleEvogexAtivo(false);
    if (evoHandle) {
      let readOk = true;
      if (typeof evoHandle.queryPermission === 'function') {
        const perm = await evoHandle.queryPermission({ mode: 'read' });
        readOk = perm === 'granted';
      }
      if (readOk) {
        const v4Handle = await evoHandle.getDirectoryHandle('BdsefaturaV4', { create: false }).catch(() => null);
        if (v4Handle) {
          const ficheiros: Array<{ rel_path: string; base64: string }> = [];
          for (const dbName of ['controlo_geral.db', 'pendentes_efatura.db']) {
            try {
              const fh = await v4Handle.getFileHandle(dbName, { create: false });
              const file = await fh.getFile();
              if (file.size > 0 && file.size <= 35 * 1024 * 1024) {
                const buf = await file.arrayBuffer();
                ficheiros.push({ rel_path: dbName, base64: arrayBufferToBase64(buf) });
              }
            } catch {
              // ficheiro ainda não existe localmente
            }
          }
          if (ficheiros.length > 0) {
            const resSql = await fetch('/api/efatura/hidratar-sqlites-locais', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Evo-Workspace-Id': wsId,
              },
              body: JSON.stringify({ ficheiros }),
            });
            if (resSql.ok) {
              algoHidratado = true;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao hidratar SQLites locais:', err);
  }

  if (algoHidratado && !silentEvent) {
    window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: obterLocalFsCentroConfig() }));
  }
  return algoHidratado;
}

export async function reconectarPastaEscritorioNoEfatura(): Promise<{
  ok: boolean;
  totalEntidades: number;
  precisaGestor: boolean;
  erro?: string;
}> {
  if (typeof window === 'undefined') {
    return { ok: false, totalEntidades: 0, precisaGestor: true };
  }
  const win = window as any;
  const cfgAtual = obterLocalFsCentroConfig();
  const sharedMeta = readSharedCentroMeta(cfgAtual?.id);
  const targetId = (cfgAtual?.id || sharedMeta?.id || 'escritorio-principal').trim() || 'escritorio-principal';
  const wsId = getOrCreateSharedWorkspaceId(targetId);

  try {
    let evogexHandle = await obterHandleEvogexAtivo(true);

    if (!evogexHandle) {
      if (typeof win.showDirectoryPicker !== 'function') {
        return {
          ok: false,
          totalEntidades: 0,
          precisaGestor: true,
          erro: 'Utilize o Google Chrome ou Microsoft Edge para ligar a pasta do escritório.',
        };
      }
      const picked = await win.showDirectoryPicker({ mode: 'readwrite' });
      const pickedName = String(picked.name || 'Dados_evoGex').trim();
      if (/^dados_evogex/i.test(pickedName)) {
        evogexHandle = picked;
      } else {
        const subEvo = await picked.getDirectoryHandle('Dados_evoGex', { create: false }).catch(() => null);
        const subIdx = await picked.getDirectoryHandle('index_core', { create: false }).catch(() => null);
        evogexHandle = subEvo || (subIdx ? picked : picked);
      }

      activeEvogexHandle = evogexHandle;
      activeEvogexHandleId = targetId;
      await saveHandleIdb(`evogex_root::${targetId}`, evogexHandle);
      if (targetId === 'escritorio-principal' || /-E01$/i.test(targetId)) {
        await saveHandleIdb('evogex_root', evogexHandle);
      }
    }

    const manifest = await lerCentroJsonDoHandle(evogexHandle);
    const dbBytes = await lerBytesDataDbDeHandle(evogexHandle);
    if (dbBytes && dbBytes.length > 0) {
      await fetch('/api/bridge/workspace/hydrate-sqlite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Evo-Workspace-Id': wsId,
        },
        body: JSON.stringify({ sqlite_b64: arrayBufferToBase64(dbBytes.buffer as ArrayBuffer) }),
      }).catch(() => null);
    }

    await hidratarSessaoIsoladaLocal(true);

    const entRes = await fetch('/api/entidades', {
      headers: { 'X-Evo-Workspace-Id': wsId },
      cache: 'no-store',
    }).catch(() => null);
    let totalEntidades = 0;
    if (entRes && entRes.ok) {
      const entData = await entRes.json().catch(() => null);
      totalEntidades = Number(entData?.total ?? entData?.entidades?.length ?? 0);
    }

    const displayPath =
      manifest?.pasta_evogex_display ||
      cfgAtual?.pasta_evogex_display ||
      sharedMeta?.pastaEvogex ||
      sugerirPastaEvogexPorEscritorio(targetId);

    if (totalEntidades > 0) {
      const nextCfg = normalizeLocalFsCentro(
        {
          ...cfgAtual,
          ...manifest,
          id: targetId,
          nome: manifest?.nome || cfgAtual?.nome || sharedMeta?.nome || 'Escritório Principal',
          pasta_evogex_display: displayPath,
          evogex_confirmado: true,
          total_entidades_carregadas: totalEntidades,
          updated_at: new Date().toISOString(),
        },
        targetId
      );
      guardarLocalFsCentroConfig(nextCfg);
      return { ok: true, totalEntidades, precisaGestor: false };
    }

    return {
      ok: false,
      totalEntidades: 0,
      precisaGestor: true,
      erro: 'A pasta ligada ainda não contém entidades configuradas. Conclua a carga no Gestor de Entidades.',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, totalEntidades: 0, precisaGestor: false, erro: 'Seleção cancelada.' };
    }
    return {
      ok: false,
      totalEntidades: 0,
      precisaGestor: true,
      erro: err?.message || 'Não foi possível ligar à pasta do escritório.',
    };
  }
}

const _hydratedNifsMem = new Set<string>();

export function resetarCacheHidratacaoNifs(): void {
  _hydratedNifsMem.clear();
}

export async function limparCredenciaisTemporariasIdb(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = typeof store.getAllKeys === 'function' ? store.getAllKeys() : null;
      if (req) {
        req.onsuccess = () => {
          const keys = Array.isArray(req.result) ? req.result : [];
          for (const k of keys) {
            if (typeof k === 'string' && k.startsWith('tcred_xml_text::')) {
              store.delete(k);
            }
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function hidratarSqliteNifSobDemanda(nif: string, forcar = false): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if ((window as any).__GEXCEL_MOTOR_SOURCE__ === 'local') return false;
  if (readSharedSandboxMeta()) return false;

  const nifClean = String(nif || '').replace(/\D/g, '').slice(0, 9);
  if (nifClean.length !== 9) return false;
  if (!forcar && _hydratedNifsMem.has(nifClean)) return true;

  try {
    const evoHandle = await obterHandleEvogexAtivo(false);
    if (!evoHandle) return false;
    if (typeof evoHandle.queryPermission === 'function') {
      const perm = await evoHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return false;
    }

    const v4Handle = await evoHandle.getDirectoryHandle('BdsefaturaV4', { create: false }).catch(() => null);
    if (!v4Handle) return false;

    const nifDir = await v4Handle.getDirectoryHandle(nifClean, { create: false }).catch(() => null);
    if (!nifDir) {
      _hydratedNifsMem.add(nifClean);
      return true;
    }

    const ficheiros: Array<{ rel_path: string; base64: string }> = [];
    if (typeof nifDir.entries === 'function') {
      for await (const [fname, entryHandle] of nifDir.entries()) {
        if (entryHandle?.kind === 'file' && String(fname).toLowerCase().endsWith('.db')) {
          try {
            const file = await entryHandle.getFile();
            if (file.size > 0 && file.size <= 35 * 1024 * 1024) {
              const buf = await file.arrayBuffer();
              ficheiros.push({
                rel_path: `${nifClean}/${fname}`,
                base64: arrayBufferToBase64(buf),
              });
            }
          } catch {
            // ignore unreadable file
          }
        }
      }
    }

    if (ficheiros.length === 0) {
      _hydratedNifsMem.add(nifClean);
      return true;
    }

    const wsId = obterWorkspaceIdIsolado();
    const res = await fetch('/api/efatura/hidratar-sqlites-locais', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Evo-Workspace-Id': wsId,
      },
      body: JSON.stringify({ ficheiros }),
    });
    if (res.ok) {
      _hydratedNifsMem.add(nifClean);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function hidratarTodosSqlitesNifsSobDemanda(nifs?: string[]): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if ((window as any).__GEXCEL_MOTOR_SOURCE__ === 'local') return 0;
  if (readSharedSandboxMeta()) return 0;

  let alvoNifs: string[] = [];
  if (Array.isArray(nifs) && nifs.length > 0) {
    alvoNifs = Array.from(new Set(nifs.map((n) => String(n || '').replace(/\D/g, '').slice(0, 9)).filter((n) => n.length === 9)));
  } else {
    try {
      const evoHandle = await obterHandleEvogexAtivo(false);
      if (!evoHandle) return 0;
      if (typeof evoHandle.queryPermission === 'function') {
        const perm = await evoHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') return 0;
      }
      const v4Handle = await evoHandle.getDirectoryHandle('BdsefaturaV4', { create: false }).catch(() => null);
      if (!v4Handle || typeof v4Handle.entries !== 'function') return 0;
      for await (const [dname, entryHandle] of v4Handle.entries()) {
        if (entryHandle?.kind === 'directory' && /^\d{9}$/.test(String(dname))) {
          alvoNifs.push(String(dname));
        }
      }
    } catch {
      return 0;
    }
  }

  let hidratados = 0;
  const fila = [...alvoNifs];
  const workers = Array.from({ length: Math.min(4, fila.length) }, async () => {
    while (fila.length > 0) {
      const prox = fila.shift();
      if (!prox) break;
      if (await hidratarSqliteNifSobDemanda(prox, false)) {
        hidratados++;
      }
    }
  });
  await Promise.all(workers);
  return hidratados;
}
