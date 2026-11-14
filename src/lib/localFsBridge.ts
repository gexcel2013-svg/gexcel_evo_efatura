/**
 * Ponte Direta de Sistema de Ficheiros no Browser (File System Access API — Zero .bat / Zero Atrito)
 * Permite ao utilizador escolher no Explorador do Windows onde instalar/ligar a pasta Dados_evoGex
 * e onde ler a pasta antiga Dados_GexcelApps (tCredenciais.xml), criando automaticamente toda a
 * estrutura de subpastas e gravando os ficheiros SQLite (.db) diretamente no disco do cliente.
 */

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
const IDB_NAME = 'gexcel_evogex_fs_db';
const IDB_STORE = 'dir_handles';

let activeEvogexHandle: any = null;
let activeAntigaHandle: any = null;

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

export function obterLocalFsCentroConfig(): LocalFsCentroConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalFsCentroConfig;
    let dirty = false;

    // Bloqueia caminhos Linux (/opt/...) ou pastas incorretas Dados_GexcelApps\Dados_evoGex
    if (
      !isWindowsPath(parsed.pasta_evogex_display) ||
      /dados_gexcelapps[\\/]dados_evogex/i.test(parsed.pasta_evogex_display)
    ) {
      parsed.pasta_evogex_display = 'C:\\Dados_evoGex';
      dirty = true;
    }

    const baseEvo = parsed.pasta_evogex_display;
    if (!isWindowsPath(parsed.pasta_motor_display) || /dados_gexcelapps[\\/]dados_evogex/i.test(parsed.pasta_motor_display)) {
      parsed.pasta_motor_display = `${baseEvo}\\motor`;
      dirty = true;
    }
    if (!isWindowsPath(parsed.pasta_v4_display) || /dados_gexcelapps[\\/]dados_evogex/i.test(parsed.pasta_v4_display)) {
      parsed.pasta_v4_display = `${baseEvo}\\BdsefaturaV4`;
      dirty = true;
    }
    if (!isWindowsPath(parsed.pasta_pdfs_display) || /dados_gexcelapps[\\/]dados_evogex/i.test(parsed.pasta_pdfs_display)) {
      parsed.pasta_pdfs_display = `${baseEvo}\\PDFs_Recibos`;
      dirty = true;
    }

    if (parsed.pasta_gexcel_antiga_display && !isWindowsPath(parsed.pasta_gexcel_antiga_display)) {
      parsed.pasta_gexcel_antiga_display = '';
      dirty = true;
    }

    const baseAntiga = isWindowsPath(parsed.pasta_gexcel_antiga_display)
      ? parsed.pasta_gexcel_antiga_display
      : 'C:\\Dados_GexcelApps';

    if (!isWindowsPath(parsed.pasta_v3_display)) {
      parsed.pasta_v3_display = `${baseAntiga}\\BdsefaturaV3`;
      dirty = true;
    }
    if (!isWindowsPath(parsed.pasta_bdsrv_display)) {
      parsed.pasta_bdsrv_display = `${baseAntiga}\\BdsRV`;
      dirty = true;
    }

    if (dirty) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sincronizarLocalFsComAppConfig(appConfig: any): LocalFsCentroConfig {
  const atual = obterLocalFsCentroConfig();
  const centros = Array.isArray(appConfig?.centros_dados) ? appConfig.centros_dados : [];
  const centroAtivo = centros.find((c: any) => c?.selecionado) || centros[0] || null;

  const candidatoEvo =
    (isWindowsPath(centroAtivo?.pasta_evogex) && !/dados_gexcelapps/i.test(centroAtivo.pasta_evogex)
      ? centroAtivo.pasta_evogex
      : '') ||
    (isWindowsPath(appConfig?.centro_dados_pasta_evogex) && !/dados_gexcelapps/i.test(appConfig.centro_dados_pasta_evogex)
      ? appConfig.centro_dados_pasta_evogex
      : '') ||
    (isWindowsPath(appConfig?.pasta_v4) && !/dados_gexcelapps/i.test(appConfig.pasta_v4)
      ? String(appConfig.pasta_v4).replace(/[\\/]BdsefaturaV4[\\/]?$/i, '')
      : '');

  const candidatoAntiga =
    (isWindowsPath(centroAtivo?.pasta_gexcel_antiga) ? centroAtivo.pasta_gexcel_antiga : '') ||
    (isWindowsPath(appConfig?.centro_dados_pasta_gexcel_antiga) ? appConfig.centro_dados_pasta_gexcel_antiga : '') ||
    (isWindowsPath(appConfig?.pasta_v3)
      ? String(appConfig.pasta_v3).replace(/[\\/]BdsefaturaV3[\\/]?$/i, '')
      : '');

  const pastaEvoFinal =
    (atual?.evogex_confirmado && isWindowsPath(atual.pasta_evogex_display) ? atual.pasta_evogex_display : '') ||
    candidatoEvo ||
    (atual && isWindowsPath(atual.pasta_evogex_display) ? atual.pasta_evogex_display : '') ||
    'C:\\Dados_evoGex';

  const pastaAntigaFinal =
    (atual?.antiga_confirmada && isWindowsPath(atual.pasta_gexcel_antiga_display) ? atual.pasta_gexcel_antiga_display : '') ||
    candidatoAntiga ||
    (atual && isWindowsPath(atual.pasta_gexcel_antiga_display) ? atual.pasta_gexcel_antiga_display : '') ||
    '';

  const pastaV4Final =
    (isWindowsPath(atual?.pasta_v4_display) && atual?.evogex_confirmado ? atual.pasta_v4_display : '') ||
    (isWindowsPath(appConfig?.pasta_v4) ? appConfig.pasta_v4 : '') ||
    `${pastaEvoFinal}\\BdsefaturaV4`;

  const baseAntigaDisplay = pastaAntigaFinal || 'C:\\Dados_GexcelApps';
  const pastaV3Final =
    (isWindowsPath(appConfig?.pasta_v3) ? appConfig.pasta_v3 : '') ||
    `${baseAntigaDisplay}\\BdsefaturaV3`;
  const pastaBdsrvFinal =
    (isWindowsPath(appConfig?.pasta_bdsrv) ? appConfig.pasta_bdsrv : '') ||
    `${baseAntigaDisplay}\\BdsRV`;
  const pastaPdfsFinal =
    (isWindowsPath(atual?.pasta_pdfs_display) && atual?.evogex_confirmado ? atual.pasta_pdfs_display : '') ||
    (isWindowsPath(appConfig?.pasta_pdfs) ? appConfig.pasta_pdfs : '') ||
    `${pastaEvoFinal}\\PDFs_Recibos`;

  const merged: LocalFsCentroConfig = {
    id: centroAtivo?.id || appConfig?.centro_dados_ativo_id || atual?.id || 'escritorio-principal',
    nome: centroAtivo?.nome || appConfig?.centro_dados_nome || atual?.nome || 'Escritório Principal',
    hostname: centroAtivo?.hostname || appConfig?.centro_dados_hostname || atual?.hostname || 'COMPUTADOR-LOCAL',
    pasta_evogex_display: pastaEvoFinal,
    pasta_motor_display: `${pastaEvoFinal}\\motor`,
    pasta_v4_display: pastaV4Final,
    pasta_v3_display: pastaV3Final,
    pasta_bdsrv_display: pastaBdsrvFinal,
    pasta_pdfs_display: pastaPdfsFinal,
    pasta_gexcel_antiga_display: pastaAntigaFinal,
    ligado: true,
    evogex_confirmado: Boolean(atual?.evogex_confirmado || candidatoEvo),
    antiga_confirmada: Boolean(atual?.antiga_confirmada || pastaAntigaFinal),
    total_entidades_carregadas: atual?.total_entidades_carregadas,
    total_sqlites_gravados: atual?.total_sqlites_gravados,
    updated_at: atual?.updated_at || new Date().toISOString(),
  };

  try {
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent('gexcel-local-fs-updated', { detail: cfg }));
  // Persistir também no servidor central para nunca se perder ao fechar/reabrir a aplicação
  void fetch('/api/app/centros-dados/registar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      centro_id: cfg.id || 'escritorio-principal',
      nome: cfg.nome || 'Escritório Principal',
      hostname: cfg.hostname || 'COMPUTADOR-LOCAL',
      ip_local: '127.0.0.1:8015',
      pasta_evogex: cfg.pasta_evogex_display || 'C:\\Dados_evoGex',
      pasta_gexcel_antiga: cfg.pasta_gexcel_antiga_display || '',
    }),
  }).catch(() => {});
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
  if (!activeEvogexHandle) {
    activeEvogexHandle = await loadHandleIdb('evogex_root');
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

/**
 * Descarrega os ficheiros SQLite (.db) da empresa (ou todos) e grava-os fisicamente
 * na pasta Dados_evoGex\BdsefaturaV4 escolhida pelo utilizador no computador/servidor.
 */
export async function sincronizarSqlitesParaPastaLocal(nif?: string, pedirPermissao = false): Promise<number> {
  try {
    const rootHandle = await obterHandleEvogexAtivo(pedirPermissao);
    if (!rootHandle) return 0;

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
      cfg.total_sqlites_gravados = gravados;
      cfg.updated_at = new Date().toISOString();
      guardarLocalFsCentroConfig(cfg);
    }
    return gravados;
  } catch (err) {
    console.warn('[LOCAL FS] Aviso ao gravar SQLite na pasta local:', err);
    return 0;
  }
}

export async function abrirPastaNoExploradorNativo(
  subpasta?: string,
  origem: 'evogex' | 'antiga' = 'evogex'
): Promise<boolean> {
  const win = window as any;
  if (typeof win.showDirectoryPicker !== 'function') return false;
  try {
    if (origem === 'antiga') {
      const antHandle = activeAntigaHandle || (await loadHandleIdb('gexcel_antiga_root'));
      if (antHandle) {
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
  nomeCentro?: string;
  hostname?: string;
  caminhoProposto?: string;
}): Promise<{ ok: boolean; config?: LocalFsCentroConfig; erro?: string }> {
  const win = window as any;
  if (typeof win.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      erro: 'O seu navegador não suporta seleção direta de pastas. Utilize o Google Chrome ou Microsoft Edge.',
    };
  }

  try {
    const pickedHandle = await win.showDirectoryPicker({ mode: 'readwrite' });
    const pickedName: string = (pickedHandle.name || 'Dados_evoGex').trim();

    let evogexHandle = pickedHandle;
    const prop = (opcoes?.caminhoProposto || '').trim();
    let displayRoot = 'C:\\Dados_evoGex';

    if (/^dados_evogex$/i.test(pickedName)) {
      evogexHandle = pickedHandle;
      displayRoot = prop && /dados_evogex/i.test(prop) ? prop : 'C:\\Dados_evoGex';
    } else if (/^[A-Za-z]:\\?$/i.test(pickedName) || pickedName.includes('(')) {
      // Utilizador escolheu a raiz do disco (ex: "Disco Local (C:)")
      evogexHandle = await pickedHandle.getDirectoryHandle('Dados_evoGex', { create: true });
      displayRoot = 'C:\\Dados_evoGex';
    } else {
      // Utilizador escolheu uma pasta específica onde quer criar Dados_evoGex
      evogexHandle = await pickedHandle.getDirectoryHandle('Dados_evoGex', { create: true });
      if (prop && prop.toLowerCase().endsWith(pickedName.toLowerCase())) {
        displayRoot = `${prop}\\Dados_evoGex`;
      } else {
        displayRoot = `C:\\${pickedName}\\Dados_evoGex`;
      }
    }

    // Criar toda a estrutura oficial automaticamente dentro de Dados_evoGex
    for (const sub of ['BdsefaturaV4', 'BdsefaturaV3', 'BdsRV', 'PDFs_Recibos', 'safedrive', 'index_core', 'motor', 'logs']) {
      await evogexHandle.getDirectoryHandle(sub, { create: true });
    }

    // Limpar de imediato qualquer pasta 'motor\app' descompilada (.py) se tiver ficado de testes anteriores
    await limparMotorDescompiladoSeExistir(evogexHandle);

    const cfgAtual = obterLocalFsCentroConfig();
    const nomeFinal = opcoes?.nomeCentro?.trim() || cfgAtual?.nome || 'Escritório Principal';
    const hostFinal = opcoes?.hostname?.trim() || cfgAtual?.hostname || 'COMPUTADOR-LOCAL';

    const totalEntidades = cfgAtual?.total_entidades_carregadas || 0;
    const pastaAntigaDisplay = cfgAtual?.pasta_gexcel_antiga_display || '';

    const novoCfg: LocalFsCentroConfig = {
      id: 'escritorio-principal',
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
      antiga_confirmada: Boolean(cfgAtual?.antiga_confirmada || pastaAntigaDisplay),
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
    await saveHandleIdb('evogex_root', evogexHandle);
    guardarLocalFsCentroConfig(novoCfg);

    // Sincronizar imediatamente todos os SQLites já importados (ex: 503570770) para dentro de BdsefaturaV4!
    await sincronizarSqlitesParaPastaLocal();

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
  caminhoProposto?: string
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
    activeAntigaHandle = pickedHandle;
    await saveHandleIdb('gexcel_antiga_root', pickedHandle);

    const pickedName: string = (pickedHandle.name || 'Dados_GexcelApps').trim();
    const xmlContent = await tentarLerTCredenciaisDeHandle(pickedHandle);
    const displayAntiga = inferirCaminhoCompletoAntiga(pickedName, xmlContent, caminhoProposto);

    let totalEntidades = 0;

    if (xmlContent) {
      const res = await fetch('/api/entidades/importar-tcredenciais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml_content: xmlContent, nome_pasta: displayAntiga }),
      });
      if (res.ok) {
        const data = await res.json();
        totalEntidades = data.total_entidades || 0;
      }
    }

    // NUNCA colocar Dados_evoGex dentro de Dados_GexcelApps por defeito: o padrão de Dados_evoGex é sempre C:\Dados_evoGex
    let cfgAtual = obterLocalFsCentroConfig();
    const evoPath = cfgAtual?.pasta_evogex_display || 'C:\\Dados_evoGex';

    cfgAtual = {
      id: cfgAtual?.id || 'escritorio-principal',
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
    await sincronizarSqlitesParaPastaLocal();

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
