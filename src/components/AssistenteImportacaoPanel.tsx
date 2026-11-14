import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Sparkles,
  X,
  Check,
  Copy,
  FolderOpen,
  Edit3,
  Save,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  ShoppingCart,
  TrendingUp,
  Layers,
  Calendar,
  Play,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Building2,
} from 'lucide-react';
import {
  isWindowsPath,
  obterLocalFsCentroConfig,
  obterResumoDestinosConfigurados,
  guardarLocalFsCentroConfig,
  escolherEInstalarPastaDadosEvogex,
  escolherPastaDadosGexcelAntigos,
  abrirPastaNoExploradorNativo,
  type ResumoDestinosConfigurados,
} from '../lib/localFsBridge';

export type ZonaSpotlight = 1 | 2 | 3 | 4 | null;

export interface AssistenteEmpresaItem {
  id: string;
  cod?: string;
  nif: string;
  nome: string;
}

export interface AssistenteImportacaoPanelProps {
  aberto: boolean;
  onClose: () => void;
  moduloTitulo: string;
  apiOnline: boolean | null;
  caminhoDados: string;
  onCaminhoDadosChange?: (novoCaminho: string) => void;
  // Passo 2: Operação & Empresas
  tipoOperacao: 'compras' | 'vendas' | 'ambos';
  permitirAmbos?: boolean;
  onTipoOperacaoChange: (op: 'compras' | 'vendas' | 'ambos') => void;
  empresas: AssistenteEmpresaItem[];
  selecionadasIds: Set<string>;
  onToggleEmpresa: (id: string) => void;
  onSelecionarTodasEmpresas: () => void;
  onLimparEmpresas: () => void;
  modoPrivacidade?: boolean;
  // Passo 3: Período
  ano: number;
  anoAtual: number;
  onAnoChange: (novoAno: number) => void;
  mesesSelecionados?: Set<number>;
  onToggleMes?: (mes: number) => void;
  onSelecionarAnoTodo?: () => void;
  onSelecionarMesAtual?: () => void;
  onSelecionarTrimestre?: (t: number) => void;
  apenasAnoCompleto?: boolean;
  // Passo 4: Opções extras & Disparo
  opcoesExtras?: ReactNode;
  isSyncing: boolean;
  labelBotaoIniciar?: string;
  onIniciarImportacao: () => void;
  // Destaque sincronizado (Spotlight) na interface principal
  passoAtivo: 1 | 2 | 3 | 4;
  onPassoAtivoChange: (p: 1 | 2 | 3 | 4) => void;
}

const MESES_CURTOS = [
  { num: 1, nome: 'Jan' },
  { num: 2, nome: 'Fev' },
  { num: 3, nome: 'Mar' },
  { num: 4, nome: 'Abr' },
  { num: 5, nome: 'Mai' },
  { num: 6, nome: 'Jun' },
  { num: 7, nome: 'Jul' },
  { num: 8, nome: 'Ago' },
  { num: 9, nome: 'Set' },
  { num: 10, nome: 'Out' },
  { num: 11, nome: 'Nov' },
  { num: 12, nome: 'Dez' },
];

function mascararNif(nif: string): string {
  if (!nif) return '';
  return '■'.repeat(Math.max(9, nif.length));
}

function mascararNome(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

export function AssistenteImportacaoPanel({
  aberto,
  onClose,
  moduloTitulo,
  apiOnline,
  caminhoDados,
  onCaminhoDadosChange,
  tipoOperacao,
  permitirAmbos = false,
  onTipoOperacaoChange,
  empresas,
  selecionadasIds,
  onToggleEmpresa,
  onSelecionarTodasEmpresas,
  onLimparEmpresas,
  modoPrivacidade = false,
  ano,
  anoAtual,
  onAnoChange,
  mesesSelecionados,
  onToggleMes,
  onSelecionarAnoTodo,
  onSelecionarMesAtual,
  onSelecionarTrimestre,
  apenasAnoCompleto = false,
  opcoesExtras,
  isSyncing,
  labelBotaoIniciar,
  onIniciarImportacao,
  passoAtivo,
  onPassoAtivoChange,
}: AssistenteImportacaoPanelProps) {
  const [passosConfirmados, setPassosConfirmados] = useState<Set<number>>(() => new Set());
  const [resumoConfig, setResumoConfig] = useState<ResumoDestinosConfigurados>(() => obterResumoDestinosConfigurados());
  const [copiado, setCopiado] = useState<boolean>(false);
  const [copiadoAntiga, setCopiadoAntiga] = useState<boolean>(false);
  const [editandoCaminho, setEditandoCaminho] = useState<boolean>(false);
  const [caminhoDraft, setCaminhoDraft] = useState<string>(caminhoDados);
  const [mensagemPasta, setMensagemPasta] = useState<string | null>(null);
  const [escolhendoPastaWin, setEscolhendoPastaWin] = useState<boolean>(false);
  const [escolhendoAntigaWin, setEscolhendoAntigaWin] = useState<boolean>(false);

  const [modoSelecaoEmpresas, setModoSelecaoEmpresas] = useState<'todas' | 'escolher'>('escolher');
  const [pesquisaEmpresa, setPesquisaEmpresa] = useState<string>('');
  const [opcoesAbertas, setOpcoesAbertas] = useState<boolean>(false);

  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);

  const mesAtual = new Date().getMonth() + 1;

  useEffect(() => {
    const onFsUpdated = () => {
      setResumoConfig(obterResumoDestinosConfigurados());
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  const caminhoExibido = useMemo(() => {
    return isWindowsPath(caminhoDados) ? caminhoDados : resumoConfig.pastaV4;
  }, [caminhoDados, resumoConfig.pastaV4]);

  const empresasFiltradas = useMemo(() => {
    const q = pesquisaEmpresa.trim().toLowerCase();
    if (!q) return empresas;
    return empresas.filter(
      e =>
        (e.nif || '').toLowerCase().includes(q) ||
        (e.nome || '').toLowerCase().includes(q) ||
        (e.cod || '').toLowerCase().includes(q)
    );
  }, [empresas, pesquisaEmpresa]);

  if (!aberto) return null;

  const irParaPasso = (p: 1 | 2 | 3 | 4) => {
    onPassoAtivoChange(p);
    const refMap = { 1: step1Ref, 2: step2Ref, 3: step3Ref, 4: step4Ref };
    setTimeout(() => {
      refMap[p].current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const confirmarEAvancar = (atual: 1 | 2 | 3, proximo: 2 | 3 | 4) => {
    setPassosConfirmados(prev => {
      const next = new Set(prev);
      next.add(atual);
      return next;
    });
    irParaPasso(proximo);
  };

  const copiarCaminho = async () => {
    try {
      await navigator.clipboard.writeText(caminhoExibido);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // ignora erro de clipboard
    }
  };

  const pastaAntigaExibida = resumoConfig.pastaGexcelAntiga || 'C:\\Dados_GexcelApps';

  const copiarCaminhoAntiga = async () => {
    try {
      await navigator.clipboard.writeText(pastaAntigaExibida);
      setCopiadoAntiga(true);
      setTimeout(() => setCopiadoAntiga(false), 1800);
    } catch {
      // ignora erro de clipboard
    }
  };

  const abrirPastaWindows = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: caminhoExibido }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {
      // fallback File System Access API
    }
    await abrirPastaNoExploradorNativo('BdsefaturaV4', 'evogex');
  };

  const abrirPastaAntigaWindows = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: pastaAntigaExibida }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {
      // fallback File System Access API
    }
    await abrirPastaNoExploradorNativo(undefined, 'antiga');
  };

  const escolherPastaNoWindows = async () => {
    setEscolhendoPastaWin(true);
    setMensagemPasta(null);
    try {
      const baseProposta = caminhoExibido.replace(/[\\/](BdsefaturaV4|PDFs_Recibos|BdsRV)[\\/]?$/i, '') || 'C:\\Dados_evoGex';
      const res = await escolherEInstalarPastaDadosEvogex({ caminhoProposto: baseProposta });
      if (res.ok && res.config) {
        const novoCaminho = res.config.pasta_v4_display || `${res.config.pasta_evogex_display}\\BdsefaturaV4`;
        setCaminhoDraft(novoCaminho);
        onCaminhoDadosChange?.(novoCaminho);
        setResumoConfig(obterResumoDestinosConfigurados());
        setMensagemPasta('Pasta gravada e sincronizada com sucesso.');
      } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
        setMensagemPasta(res.erro);
      }
    } finally {
      setEscolhendoPastaWin(false);
    }
  };

  const escolherPastaAntigaNoWindows = async () => {
    setEscolhendoAntigaWin(true);
    setMensagemPasta(null);
    try {
      const res = await escolherPastaDadosGexcelAntigos(pastaAntigaExibida);
      if (res.ok && res.config) {
        setResumoConfig(obterResumoDestinosConfigurados());
        setMensagemPasta(
          res.erro ||
            `Pasta GexcelApps ligada (${res.totalEntidades || 0} empresas carregadas).`
        );
      } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
        setMensagemPasta(res.erro);
      }
    } finally {
      setEscolhendoAntigaWin(false);
    }
  };

  const guardarCaminhoManual = () => {
    const limpo = (caminhoDraft || '').trim();
    if (!limpo || !isWindowsPath(limpo)) {
      setMensagemPasta('Introduza um caminho Windows válido (ex: C:\\Dados_evoGex\\BdsefaturaV4).');
      return;
    }
    const raiz = limpo.replace(/[\\/](BdsefaturaV4|PDFs_Recibos|BdsRV)[\\/]?$/i, '') || limpo;
    const atual = obterLocalFsCentroConfig();
    const atualizado = {
      id: atual?.id || 'escritorio-principal',
      nome: atual?.nome || 'Escritório Principal',
      hostname: atual?.hostname || 'COMPUTADOR-LOCAL',
      pasta_evogex_display: raiz,
      pasta_motor_display: `${raiz}\\motor`,
      pasta_v4_display: /bdsefaturav4$/i.test(limpo) ? limpo : `${raiz}\\BdsefaturaV4`,
      pasta_v3_display: atual?.pasta_v3_display || `${pastaAntigaExibida}\\BdsefaturaV3`,
      pasta_bdsrv_display: atual?.pasta_bdsrv_display || `${pastaAntigaExibida}\\BdsRV`,
      pasta_pdfs_display: atual?.pasta_pdfs_display || `${raiz}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: atual?.pasta_gexcel_antiga_display || '',
      ligado: true,
      evogex_confirmado: true,
      antiga_confirmada: atual?.antiga_confirmada || false,
      total_entidades_carregadas: atual?.total_entidades_carregadas,
      total_sqlites_gravados: atual?.total_sqlites_gravados,
      updated_at: new Date().toISOString(),
    };
    guardarLocalFsCentroConfig(atualizado);
    setResumoConfig(obterResumoDestinosConfigurados());
    onCaminhoDadosChange?.(atualizado.pasta_v4_display);
    setEditandoCaminho(false);
    setMensagemPasta('Destino dos dados gravado.');
  };

  const podeIniciar =
    !isSyncing &&
    selecionadasIds.size > 0 &&
    (!mesesSelecionados || mesesSelecionados.size > 0);

  const labelOperacao =
    tipoOperacao === 'compras'
      ? 'Compras (Fornecedores)'
      : tipoOperacao === 'vendas'
        ? 'Vendas (Clientes)'
        : 'Compras & Vendas';

  return (
    <aside
      aria-label="Assistente Passo a Passo"
      className="w-full lg:w-[390px] xl:w-[420px] shrink-0 bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md shadow-lg flex flex-col min-h-[380px] lg:min-h-0 overflow-hidden select-none"
    >
      {/* Cabeçalho Canónico do Assistente */}
      <div className="relative evo-card-signature px-3.5 py-2.5 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] flex items-center justify-between gap-2 shrink-0 before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-sky-100 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-600 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-mono font-bold text-foreground truncate">
              Assistente Passo a Passo
            </div>
            <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300 truncate">
              {moduloTitulo} · Passo {passoAtivo} de 4
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Fechar Assistente e usar interface normal"
          className="h-7 px-2 rounded border border-slate-300 dark:border-[#253a52] bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#152334] text-slate-700 dark:text-slate-200 text-[11px] font-mono flex items-center space-x-1 cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          <span>Fechar</span>
        </button>
      </div>

      {/* Corpo Vertical de 4 Passos */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-white dark:bg-[#0c1520]">
        {/* ================= PASSO 1: LIGAÇÃO E DESTINO DOS DADOS ================= */}
        <div
          ref={step1Ref}
          onClick={() => onPassoAtivoChange(1)}
          className={`rounded-md border p-3 transition-colors cursor-pointer ${
            passoAtivo === 1
              ? 'border-[#0284c7] dark:border-sky-400 bg-sky-50 dark:bg-[#0a1929]'
              : 'border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                  passosConfirmados.has(1)
                    ? 'bg-emerald-600 text-white'
                    : passoAtivo === 1
                      ? 'bg-[#0284c7] text-white'
                      : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                {passosConfirmados.has(1) ? <Check className="w-3.5 h-3.5" /> : '1'}
              </span>
              <span className="text-xs font-mono font-bold text-foreground truncate">
                Ligação & Pasta de Destino
              </span>
            </div>
            {passoAtivo === 1 && (
              <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#0284c7] text-white shrink-0">
                Em Foco
              </span>
            )}
          </div>

          <div className="mt-2.5 space-y-2" onClick={e => e.stopPropagation()}>
            {/* Centro de Dados Ativo & Estado da Ligação */}
            <div className="px-2.5 py-2 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] text-[11px] font-mono space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700 dark:text-slate-300 flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                  <span>Centro Ativo:</span>
                </span>
                <span className="font-bold text-foreground truncate" title={resumoConfig.nome}>
                  {resumoConfig.nome}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-[#18293d]">
                <span className="text-slate-700 dark:text-slate-300">Estado da Ligação:</span>
                {apiOnline ? (
                  <span className="inline-flex items-center space-x-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Computador Ligado</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1.5 font-bold text-amber-700 dark:text-amber-300">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Motor Offline / Cloud</span>
                  </span>
                )}
              </div>
            </div>

            {/* 1. Pasta Dados evoGex (SQLite V4) */}
            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                1. Pasta Dados evoGex (Bases SQLite V4):
              </div>

              {editandoCaminho ? (
                <div className="flex items-center space-x-1">
                  <input
                    type="text"
                    value={caminhoDraft}
                    onChange={e => setCaminhoDraft(e.target.value)}
                    placeholder="Ex: C:\Dados_evoGex\BdsefaturaV4"
                    className="flex-1 text-[11px] font-mono bg-slate-50 dark:bg-[#132233] border border-[#0284c7] rounded px-2 py-1 text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={guardarCaminhoManual}
                    title="Gravar caminho"
                    className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditandoCaminho(false)}
                    title="Cancelar"
                    className="p-1.5 rounded bg-slate-200 dark:bg-[#1c2e42] text-foreground cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-1.5">
                  <span
                    title={caminhoExibido}
                    className="text-[11px] font-mono font-semibold text-foreground break-all leading-snug"
                  >
                    {caminhoExibido}
                  </span>
                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      type="button"
                      onClick={copiarCaminho}
                      title="Copiar endereço completo (📋)"
                      className="p-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1d3148] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#253a52] cursor-pointer"
                    >
                      {copiado ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={abrirPastaWindows}
                      title="Abrir pasta no Explorador do Windows (📂)"
                      className="p-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1d3148] text-[#0284c7] dark:text-sky-400 border border-slate-300 dark:border-[#253a52] cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={escolherPastaNoWindows}
                  disabled={escolhendoPastaWin}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-mono font-semibold text-foreground flex items-center space-x-1 cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                  <span>{escolhendoPastaWin ? 'A abrir Windows...' : 'Mudar Pasta'}</span>
                </button>
                {!editandoCaminho && (
                  <button
                    type="button"
                    onClick={() => {
                      setCaminhoDraft(caminhoExibido);
                      setEditandoCaminho(true);
                    }}
                    className="px-2 py-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-mono text-slate-700 dark:text-slate-300 flex items-center space-x-1 cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Editar Endereço</span>
                  </button>
                )}
              </div>
            </div>

            {/* 2. Pasta Dados Antigos Excel (GexcelApps / XML) */}
            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  2. Pasta Excel Antigo (GexcelApps / XML):
                </span>
                {resumoConfig.antigaConfirmada && (
                  <span className="text-[9.5px] font-mono font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                    Ligada
                  </span>
                )}
              </div>

              <div className="flex items-start justify-between gap-1.5">
                <span
                  title={pastaAntigaExibida}
                  className="text-[11px] font-mono font-semibold text-foreground break-all leading-snug"
                >
                  {pastaAntigaExibida}
                </span>
                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    type="button"
                    onClick={copiarCaminhoAntiga}
                    title="Copiar endereço completo (📋)"
                    className="p-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1d3148] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#253a52] cursor-pointer"
                  >
                    {copiadoAntiga ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={abrirPastaAntigaWindows}
                    title="Abrir pasta no Explorador do Windows (📂)"
                    className="p-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1d3148] text-[#0284c7] dark:text-sky-400 border border-slate-300 dark:border-[#253a52] cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400 break-all">
                XML: {resumoConfig.pastaV3} · {resumoConfig.pastaBdsrv}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={escolherPastaAntigaNoWindows}
                  disabled={escolhendoAntigaWin}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-mono font-semibold text-foreground flex items-center space-x-1 cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>{escolhendoAntigaWin ? 'A abrir Windows...' : 'Mudar Pasta Antiga'}</span>
                </button>
              </div>
            </div>

            {mensagemPasta && (
              <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold px-1">
                {mensagemPasta}
              </div>
            )}

            {passoAtivo === 1 && (
              <button
                type="button"
                onClick={() => confirmarEAvancar(1, 2)}
                className="w-full py-1.5 px-3 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
              >
                <span>Confirmar Destino e Avançar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ================= PASSO 2: OPERAÇÃO & EMPRESAS ================= */}
        <div
          ref={step2Ref}
          onClick={() => onPassoAtivoChange(2)}
          className={`rounded-md border p-3 transition-colors cursor-pointer ${
            passoAtivo === 2
              ? 'border-[#0284c7] dark:border-sky-400 bg-sky-50 dark:bg-[#0a1929]'
              : 'border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                  passosConfirmados.has(2)
                    ? 'bg-emerald-600 text-white'
                    : passoAtivo === 2
                      ? 'bg-[#0284c7] text-white'
                      : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                {passosConfirmados.has(2) ? <Check className="w-3.5 h-3.5" /> : '2'}
              </span>
              <span className="text-xs font-mono font-bold text-foreground truncate">
                Quem Importar (Operação & Empresas)
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] text-[#0284c7] dark:text-sky-400 shrink-0 tabular-nums">
              {selecionadasIds.size}/{empresas.length}
            </span>
          </div>

          <div className="mt-2.5 space-y-2" onClick={e => e.stopPropagation()}>
            {/* Operação Compras vs Vendas */}
            <div className={`grid gap-1.5 ${permitirAmbos ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {permitirAmbos && (
                <button
                  type="button"
                  onClick={() => onTipoOperacaoChange('ambos')}
                  className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                    tipoOperacao === 'ambos'
                      ? 'bg-[#0284c7] text-white border-[#0284c7]'
                      : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#253a52]'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Ambos</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onTipoOperacaoChange('compras')}
                className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                  tipoOperacao === 'compras'
                    ? 'bg-[#0284c7] text-white border-[#0284c7]'
                    : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#253a52]'
                }`}
              >
                <ShoppingCart className="w-3 h-3" />
                <span>Compras</span>
              </button>
              <button
                type="button"
                onClick={() => onTipoOperacaoChange('vendas')}
                className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                  tipoOperacao === 'vendas'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#253a52]'
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                <span>Vendas</span>
              </button>
            </div>

            {/* Todas vs Escolher */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setModoSelecaoEmpresas('todas');
                  onSelecionarTodasEmpresas();
                }}
                className={`py-1.5 px-2 rounded text-[11px] font-mono font-bold border cursor-pointer transition ${
                  selecionadasIds.size === empresas.length && empresas.length > 0 && modoSelecaoEmpresas === 'todas'
                    ? 'bg-[#0284c7] text-white border-[#0284c7]'
                    : 'bg-white dark:bg-[#0c1520] text-foreground border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                }`}
              >
                Todas ({empresas.length})
              </button>
              <button
                type="button"
                onClick={() => setModoSelecaoEmpresas('escolher')}
                className={`py-1.5 px-2 rounded text-[11px] font-mono font-bold border cursor-pointer transition ${
                  modoSelecaoEmpresas === 'escolher'
                    ? 'bg-slate-800 dark:bg-[#1c314a] text-white border-slate-700 dark:border-sky-500'
                    : 'bg-white dark:bg-[#0c1520] text-foreground border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                }`}
              >
                Escolher ({selecionadasIds.size})
              </button>
            </div>

            {/* Lista Pesquisável de Empresas */}
            {modoSelecaoEmpresas === 'escolher' && (
              <div className="bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] rounded p-2 space-y-1.5">
                <div className="flex items-center space-x-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
                    <input
                      type="text"
                      value={pesquisaEmpresa}
                      onChange={e => setPesquisaEmpresa(e.target.value)}
                      placeholder="Pesquisar NIF, nome ou código..."
                      className="w-full text-[11px] font-mono bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded pl-6 pr-2 py-1 text-foreground focus:outline-none focus:border-[#0284c7]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onLimparEmpresas}
                    className="px-2 py-1 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] text-[10px] font-mono text-slate-700 dark:text-slate-300 hover:text-foreground cursor-pointer shrink-0"
                  >
                    Limpar
                  </button>
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 dark:divide-[#1e2f42]">
                  {empresasFiltradas.map(emp => {
                    const checked = selecionadasIds.has(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className={`flex items-center space-x-2 py-1.5 px-1 cursor-pointer text-[11px] font-mono hover:bg-slate-50 dark:hover:bg-[#132233] ${
                          checked ? 'bg-sky-50 dark:bg-[#0c1b2c]' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleEmpresa(emp.id)}
                          className="w-3.5 h-3.5 rounded accent-[#0284c7] cursor-pointer shrink-0"
                        />
                        <span className="text-[#0284c7] dark:text-sky-400 font-bold shrink-0">
                          {modoPrivacidade ? mascararNif(emp.nif) : emp.nif}
                        </span>
                        <span className="font-sans text-foreground truncate flex-1">
                          {modoPrivacidade ? mascararNome(emp.nome) : emp.nome}
                        </span>
                      </label>
                    );
                  })}
                  {empresasFiltradas.length === 0 && (
                    <div className="py-3 text-center text-[11px] font-mono text-slate-600 dark:text-slate-400">
                      Nenhuma empresa encontrada.
                    </div>
                  )}
                </div>
              </div>
            )}

            {passoAtivo === 2 && (
              <button
                type="button"
                disabled={selecionadasIds.size === 0}
                onClick={() => confirmarEAvancar(2, 3)}
                className="w-full py-1.5 px-3 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
              >
                <span>Confirmar Empresas ({selecionadasIds.size}) e Avançar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ================= PASSO 3: PERÍODO ================= */}
        <div
          ref={step3Ref}
          onClick={() => onPassoAtivoChange(3)}
          className={`rounded-md border p-3 transition-colors cursor-pointer ${
            passoAtivo === 3
              ? 'border-[#0284c7] dark:border-sky-400 bg-sky-50 dark:bg-[#0a1929]'
              : 'border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                  passosConfirmados.has(3)
                    ? 'bg-emerald-600 text-white'
                    : passoAtivo === 3
                      ? 'bg-[#0284c7] text-white'
                      : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                {passosConfirmados.has(3) ? <Check className="w-3.5 h-3.5" /> : '3'}
              </span>
              <span className="text-xs font-mono font-bold text-foreground truncate">
                Que Período Importar
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] text-foreground shrink-0">
              {ano}{mesesSelecionados ? ` · ${mesesSelecionados.size}m` : ''}
            </span>
          </div>

          <div className="mt-2.5 space-y-2" onClick={e => e.stopPropagation()}>
            {/* Seletor de Ano */}
            <div className="flex items-center justify-between bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] rounded px-2.5 py-1.5">
              <div className="flex items-center space-x-1.5 text-xs font-mono font-semibold text-foreground">
                <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                <span>Exercício Fiscal</span>
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => onAnoChange(ano - 1)}
                  className="p-1 rounded bg-slate-100 dark:bg-[#132233] hover:bg-sky-100 dark:hover:bg-[#14304d] text-foreground cursor-pointer"
                  title="Ano Anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-black text-sm text-foreground min-w-[44px] text-center">
                  {ano}
                </span>
                <button
                  type="button"
                  onClick={() => ano < anoAtual && onAnoChange(ano + 1)}
                  disabled={ano >= anoAtual}
                  className={`p-1 rounded bg-slate-100 dark:bg-[#132233] ${
                    ano >= anoAtual ? 'opacity-25 cursor-not-allowed' : 'hover:bg-sky-100 dark:hover:bg-[#14304d] cursor-pointer'
                  }`}
                  title="Ano Seguinte"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {!apenasAnoCompleto && mesesSelecionados && onToggleMes ? (
              <>
                {/* Atalhos Rápidos */}
                <div className="flex flex-wrap items-center gap-1 text-[10.5px] font-mono">
                  {onSelecionarAnoTodo && (
                    <button
                      type="button"
                      onClick={onSelecionarAnoTodo}
                      className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] hover:border-[#0284c7] font-semibold text-foreground cursor-pointer"
                    >
                      Ano Completo
                    </button>
                  )}
                  {onSelecionarMesAtual && ano === anoAtual && (
                    <button
                      type="button"
                      onClick={onSelecionarMesAtual}
                      className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] hover:border-[#0284c7] font-semibold text-foreground cursor-pointer"
                    >
                      Mês Atual
                    </button>
                  )}
                  {onSelecionarTrimestre &&
                    [1, 2, 3, 4].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onSelecionarTrimestre(t)}
                        className="px-1.5 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#253a52] hover:border-[#0284c7] font-bold text-foreground cursor-pointer"
                      >
                        T{t}
                      </button>
                    ))}
                </div>

                {/* Grelha 12 Meses */}
                <div className="grid grid-cols-4 gap-1">
                  {MESES_CURTOS.map(m => {
                    const futuro = ano === anoAtual && m.num > mesAtual;
                    const ativo = mesesSelecionados.has(m.num);
                    return (
                      <button
                        key={m.num}
                        type="button"
                        disabled={futuro}
                        onClick={() => onToggleMes(m.num)}
                        className={`py-1 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                          futuro
                            ? 'opacity-30 cursor-not-allowed bg-slate-100 dark:bg-[#132233] border-slate-200 dark:border-[#1e2f42] text-slate-400'
                            : ativo
                              ? 'bg-[#0284c7] text-white border-[#0284c7] font-bold'
                              : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                        }`}
                      >
                        {m.nome}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-2.5 py-1.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] text-[11px] font-mono text-slate-700 dark:text-slate-300">
                Extração configurada para todo o exercício de <strong className="text-foreground">{ano}</strong>.
              </div>
            )}

            {passoAtivo === 3 && (
              <button
                type="button"
                disabled={mesesSelecionados ? mesesSelecionados.size === 0 : false}
                onClick={() => confirmarEAvancar(3, 4)}
                className="w-full py-1.5 px-3 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
              >
                <span>Confirmar Período e Avançar</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ================= PASSO 4: RESUMO E INICIAR ================= */}
        <div
          ref={step4Ref}
          onClick={() => onPassoAtivoChange(4)}
          className={`rounded-md border p-3 transition-colors cursor-pointer ${
            passoAtivo === 4
              ? 'border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-[#1c1608]'
              : 'border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] hover:border-slate-400 dark:hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                  passoAtivo === 4
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                4
              </span>
              <span className="text-xs font-mono font-bold text-foreground truncate">
                Confirmar e Iniciar Importação
              </span>
            </div>
          </div>

          <div className="mt-2.5 space-y-2" onClick={e => e.stopPropagation()}>
            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] text-[11px] font-mono space-y-1 text-slate-700 dark:text-slate-300">
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0">Destino:</span>
                <span className="font-semibold text-foreground break-all text-right">{caminhoExibido}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Seleção:</span>
                <span className="font-semibold text-foreground text-right">
                  {labelOperacao} · {selecionadasIds.size} de {empresas.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Período:</span>
                <span className="font-semibold text-foreground text-right">
                  Exercício {ano}
                  {mesesSelecionados ? ` (${mesesSelecionados.size} ${mesesSelecionados.size === 1 ? 'mês' : 'meses'})` : ''}
                </span>
              </div>
            </div>

            {opcoesExtras && (
              <div className="bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] rounded overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpcoesAbertas(v => !v)}
                  className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#132233] cursor-pointer"
                >
                  <span className="flex items-center space-x-1.5">
                    <SlidersHorizontal className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                    <span>Opções Avançadas</span>
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${opcoesAbertas ? 'rotate-180' : ''}`} />
                </button>
                {opcoesAbertas && (
                  <div className="p-2.5 border-t border-slate-200 dark:border-[#1e344f] space-y-2">
                    {opcoesExtras}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!podeIniciar}
              onClick={() => {
                onIniciarImportacao();
                onClose();
              }}
              className="w-full py-2.5 px-4 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 cursor-pointer shadow-sm transition"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{labelBotaoIniciar || `Iniciar Importação (${selecionadasIds.size})`}</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
