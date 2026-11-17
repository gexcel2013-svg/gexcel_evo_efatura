import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  CheckSquare,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Play,
  Square,
  RotateCcw,
  Search,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Tags,
  ShieldCheck,
  ShieldAlert,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Users,
  SkipForward,
  Layers,
  History,
  Sparkles,
  Copy,
  FolderOpen,
  Monitor,
  Lock,
  ZoomIn,
  ZoomOut,
  Eye,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { AssistenteImportacaoPanel } from './AssistenteImportacaoPanel';
import {
  isWindowsPath,
  obterResumoDestinosConfigurados,
  abrirPastaNoExploradorNativo,
} from '../lib/localFsBridge';

interface SetorCatalogItem {
  codigo: string;
  nome_curto: string;
  descricao_at: string;
  grupo: 'atividade_misto' | 'pessoal';
  auto_fora: boolean;
}

interface AmbitoCatalogItem {
  codigo: string;
  nome_curto: string;
  descricao_at: string;
}

interface PalavraChaveItem {
  id: number;
  palavra: string;
  setor_codigo: string;
  ambito_codigo: string;
  ativo: number;
}

interface EntidadePendente {
  id: string;
  cod: string;
  nif: string;
  nomecli: string;
  tem_credenciais_at: boolean;
  modo_tudo_fora: boolean;
  ultima_recolha: string;
  total_pendentes: number;
  total_por_preencher: number;
  total_duvidosos: number;
  total_validados: number;
  total_submetidos: number;
}

interface DocumentoPendente {
  nif_cliente: string;
  id_documento: string;
  chave_linha: string;
  id_fatura_unico: string;
  nome_cliente: string;
  ano: number;
  mes: number;
  data_emissao: string;
  nif_emitente: string;
  nome_emitente: string;
  tipo_doc: string;
  tipo_doc_desc: string;
  numero_documento: string;
  atcud: string;
  valor_total: number;
  valor_base: number;
  valor_iva: number;
  setor_at_original: string;
  ambito_at_original: string;
  estado_at: string;
  setor_codigo: string;
  ambito_codigo: string;
  origem_sugestao: string;
  historico_dividido_setor: boolean;
  historico_dividido_ambito: boolean;
  detalhe_historico: string;
  validado: boolean;
  validado_por: string;
  validado_em: string;
  estado_submissao: 'pendente' | 'submetido' | 'erro';
  erro_submissao: string;
  submetido_em: string;
  qtd_fornecedor_cliente: number;
}

interface ResumoClientePendente {
  nif_cliente: string;
  nome_cliente: string;
  modo_tudo_fora: boolean;
  total: number;
  preenchidos: number;
  por_preencher: number;
  duvidosos: number;
  validados: number;
  submetidos: number;
  valor_total: number;
}

interface KpisPendentes {
  total_pendentes: number;
  por_preencher: number;
  duvidosos: number;
  por_validar: number;
  validados_por_submeter: number;
  submetidos: number;
  erros: number;
  valor_total_pendente: number;
}

interface TermoHistoricoItem {
  id: string;
  timestamp_iso: string;
  utilizador: string;
  email_utilizador: string;
  ip_origem: string;
  texto_termo: string;
  nifs: string[];
  total_documentos: number;
  resumo_sha256: string;
}

type FiltroRapidoType =
  | 'todos'
  | 'vazios'
  | 'duvidosos'
  | 'por_validar'
  | 'validados'
  | 'submetidos'
  | 'erros';

interface EnsaioPaginaSnapshot {
  nif_cliente: string;
  cliente: string;
  pagina: number;
  preenchidos: number;
  img_b64: string;
}

interface EnsaioItemResultado {
  nif_cliente: string;
  nome_cliente: string;
  id_documento: string;
  numero_documento: string;
  nome_emitente: string;
  valor_total: number;
  setor_codigo: string;
  ambito_codigo: string;
  preenchido_ecra: boolean;
  detalhe: string;
}

interface EnsaioStatusState {
  jobId: string;
  status: string;
  percentagem: number;
  mensagem: string;
  erro: string | null;
  docsAtuais: number;
  totalEsperado: number;
  ensaioUrl: string;
  ensaioPassoAtual: string;
  ensaioFrameB64: string;
  ensaioPaginasB64: EnsaioPaginaSnapshot[];
  ensaioItens: EnsaioItemResultado[];
  janelaNativaAberta: boolean;
}

interface PendentesViewProps {
  ano?: number;
  onAnoChange?: (ano: number) => void;
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

const TEXTO_TERMO_PADRAO =
  'Declaro que revi cliente a cliente todas as classificações validadas (setor de atividade e afetação à atividade profissional) e assumo inteira responsabilidade fiscal pela sua submissão no Portal das Finanças (e-Fatura).';

const ORIGEM_LABEL: Record<string, { label: string; cls: string }> = {
  manual: {
    label: 'Manual',
    cls: 'bg-sky-50 dark:bg-[#0a1929] border-sky-300 dark:border-sky-700 text-[#0284c7] dark:text-sky-300',
  },
  tudo_fora: {
    label: 'Tudo Fora',
    cls: 'bg-slate-100 dark:bg-[#132233] border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200',
  },
  historico_ano_atual: {
    label: 'Hist. Atual',
    cls: 'bg-emerald-50 dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
  },
  historico_ano_anterior: {
    label: 'Hist. Ant.',
    cls: 'bg-teal-50 dark:bg-[#091f20] border-teal-300 dark:border-teal-700 text-teal-800 dark:text-teal-300',
  },
  palavra_chave: {
    label: 'Palavra-Chave',
    cls: 'bg-indigo-50 dark:bg-[#131936] border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300',
  },
  at_origem: {
    label: 'AT Origem',
    cls: 'bg-slate-100 dark:bg-[#132233] border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300',
  },
  regra_setor_pessoal: {
    label: 'Setor Pessoal',
    cls: 'bg-slate-100 dark:bg-[#132233] border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200',
  },
};

export function PendentesView({
  ano: anoProp,
  onAnoChange,
  onApiStatusChange,
  modoPrivacidade = false,
}: PendentesViewProps) {
  const { currentUser, isSuperadmin, clientNif } = useAuth();
  const isDeveloperUser = useMemo(() => {
    if (isSuperadmin || currentUser?.role === 'superadmin' || currentUser?.is_system) return true;
    const uname = (currentUser?.username || '').trim().toLowerCase();
    const email = (currentUser?.email || '').trim().toLowerCase();
    if (['@gexcel', 'gexcel', '@evogex', 'evogex', 'dev', 'superadmin'].includes(uname)) return true;
    if (email === 'gexcel2013@gmail.com') return true;
    if (clientNif === '200685341' || clientNif === '510766524') return true;
    return false;
  }, [isSuperadmin, currentUser, clientNif]);

  const anoAtual = new Date().getFullYear();
  const [anoLocal, setAnoLocal] = useState<number>(anoProp ?? anoAtual);
  const anoAtivo = anoProp ?? anoLocal;

  useEffect(() => {
    if (anoProp !== undefined) {
      setAnoLocal(anoProp);
    }
  }, [anoProp]);

  const atualizarAno = (novoAno: number) => {
    setAnoLocal(novoAno);
    onAnoChange?.(novoAno);
  };

  // Assistente Passo a Passo & Destino Local
  const [assistenteAberto, setAssistenteAberto] = useState<boolean>(
    () => localStorage.getItem('gexcel_pend_assistente_fechado') !== 'true'
  );
  const [passoAssistente, setPassoAssistente] = useState<1 | 2 | 3 | 4>(1);
  const [caminhoDestinoLocal, setCaminhoDestinoLocal] = useState<string>(
    () => obterResumoDestinosConfigurados().pastaV4
  );
  const [copiadoPasta, setCopiadoPasta] = useState<boolean>(false);
  const [apiOnlineLocal, setApiOnlineLocal] = useState<boolean | null>(null);

  const abrirAssistente = () => {
    setAssistenteAberto(true);
    localStorage.setItem('gexcel_pend_assistente_fechado', 'false');
  };

  const fecharAssistente = () => {
    setAssistenteAberto(false);
    localStorage.setItem('gexcel_pend_assistente_fechado', 'true');
  };

  const refreshOnFsRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onFsUpdated = () => {
      setCaminhoDestinoLocal(obterResumoDestinosConfigurados().pastaV4);
      refreshOnFsRef.current();
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  useEffect(() => {
    fetch('http://127.0.0.1:8015/api/recibos-verdes/config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (isWindowsPath(d?.pasta_v4) && !obterResumoDestinosConfigurados().evogexConfirmado) {
          setCaminhoDestinoLocal(d.pasta_v4);
        }
      })
      .catch(() => {});
  }, []);

  const copiarCaminhoDados = async () => {
    try {
      await navigator.clipboard.writeText(caminhoDestinoLocal);
      setCopiadoPasta(true);
      setTimeout(() => setCopiadoPasta(false), 1800);
    } catch {}
  };

  const abrirPastaDadosWindows = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: caminhoDestinoLocal }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {}
    await abrirPastaNoExploradorNativo('BdsefaturaV4', 'evogex');
  };

  // Catálogo oficial (16 setores + 3 âmbitos + palavras-chave)
  const [setores, setSetores] = useState<SetorCatalogItem[]>([]);
  const [ambitos, setAmbitos] = useState<AmbitoCatalogItem[]>([]);
  const [palavrasChave, setPalavrasChave] = useState<PalavraChaveItem[]>([]);

  // Entidades singulares e seleção multi-cliente
  const [entidades, setEntidades] = useState<EntidadePendente[]>([]);
  const [nifsSelecionados, setNifsSelecionados] = useState<Set<string>>(new Set());
  const [nenhumSelecionadoManual, setNenhumSelecionadoManual] = useState<boolean>(false);
  const [seletorClientesAberto, setSeletorClientesAberto] = useState<boolean>(false);
  const [pesquisaClienteModal, setPesquisaClienteModal] = useState<string>('');
  const [forcarHistoricoAnt, setForcarHistoricoAnt] = useState<boolean>(false);
  const seletorRef = useRef<HTMLDivElement | null>(null);

  // Documentos, KPIs e filtros
  const [documentos, setDocumentos] = useState<DocumentoPendente[]>([]);
  const [resumosClientes, setResumosClientes] = useState<ResumoClientePendente[]>([]);
  const [kpis, setKpis] = useState<KpisPendentes>({
    total_pendentes: 0,
    por_preencher: 0,
    duvidosos: 0,
    por_validar: 0,
    validados_por_submeter: 0,
    submetidos: 0,
    erros: 0,
    valor_total_pendente: 0,
  });
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapidoType>('todos');
  const [pesquisa, setPesquisa] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('grupo_cliente_fornecedor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Interação rápida na grelha
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [bannerInfo, setBannerInfo] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [chaveAtiva, setChaveAtiva] = useState<string>('');
  const [chavesMarcadas, setChavesMarcadas] = useState<Set<string>>(new Set());
  const [modoAplicacao, setModoAplicacao] = useState<'fornecedor_cliente' | 'linha'>('fornecedor_cliente');
  const [saltoAutomatico, setSaltoAutomatico] = useState<boolean>(true);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const clientHeaderRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Jobs em segundo plano (recolha / submissão)
  const [jobAtivo, setJobAtivo] = useState<{
    jobId: string;
    tipo: 'recolha' | 'submissao';
    status: string;
    mensagem: string;
    percentagem: number;
    docsAtuais: number;
    totalEsperado: number;
  } | null>(null);

  // Modais: Palavras-Chave e Termo de Responsabilidade + Ensaio Visual DEV
  const [modalPalavrasAberto, setModalPalavrasAberto] = useState<boolean>(false);
  const [novaPalavra, setNovaPalavra] = useState<string>('');
  const [novoSetorKw, setNovoSetorKw] = useState<string>('C99');
  const [novoAmbitoKw, setNovoAmbitoKw] = useState<string>('');
  const [salvandoKw, setSalvandoKw] = useState<boolean>(false);

  const [modalTermoAberto, setModalTermoAberto] = useState<boolean>(false);
  const [abaModalTermo, setAbaModalTermo] = useState<'confirmar' | 'historico'>('confirmar');
  const [termoAceite, setTermoAceite] = useState<boolean>(false);
  const [historicoTermos, setHistoricoTermos] = useState<TermoHistoricoItem[]>([]);
  const [carregandoTermos, setCarregandoTermos] = useState<boolean>(false);
  const [modoEnsaioVisivel, setModoEnsaioVisivel] = useState<boolean>(true);
  const [modalEnsaioAberto, setModalEnsaioAberto] = useState<boolean>(false);
  const [ensaioState, setEnsaioState] = useState<EnsaioStatusState | null>(null);
  const [paginaEnsaioAtiva, setPaginaEnsaioAtiva] = useState<number>(-1);
  const [zoomRealEnsaio, setZoomRealEnsaio] = useState<boolean>(false);

  const ofuscarNif = useCallback(
    (nif: string) => {
      if (!modoPrivacidade || !nif) return nif;
      return `299${nif.slice(3, 6)}■■■`;
    },
    [modoPrivacidade]
  );

  const ofuscarNome = useCallback(
    (nome: string, nif: string) => {
      if (!modoPrivacidade) return nome;
      return `Contribuinte Demo ${(nif || '0000').slice(-4)}`;
    },
    [modoPrivacidade]
  );

  const formatarMoeda = (val: number) =>
    (val || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatarDataPt = (dtIso: string) => {
    const s = String(dtIso || '').slice(0, 10);
    if (s.length === 10 && s[4] === '-' && s[7] === '-') {
      return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
    }
    return s || '—';
  };

  // Fechar popover de seleção de clientes ao clicar fora
  useEffect(() => {
    const onClickOutside = (ev: MouseEvent) => {
      if (seletorRef.current && !seletorRef.current.contains(ev.target as Node)) {
        setSeletorClientesAberto(false);
      }
    };
    if (seletorClientesAberto) {
      document.addEventListener('mousedown', onClickOutside);
    }
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [seletorClientesAberto]);

  const carregarCatalogo = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/catalogo');
      if (res.ok) {
        const d = await res.json();
        setSetores(d.setores || []);
        setAmbitos(d.ambitos || []);
        setPalavrasChave(d.palavras_chave || []);
      }
    } catch {}
  }, []);

  const carregarEntidades = useCallback(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/pendentes/entidades?ano=${anoAtivo}`);
      if (res.ok) {
        const d = await res.json();
        const lista: EntidadePendente[] = d.entidades || [];
        setEntidades(lista);
        setApiOnlineLocal(true);
        onApiStatusChange?.(true);
      }
    } catch {
      setApiOnlineLocal(false);
      onApiStatusChange?.(false);
    }
  }, [anoAtivo, onApiStatusChange]);

  const carregarDocumentos = useCallback(
    async (silencioso: boolean = false) => {
      if (!silencioso) setCarregando(true);
      setErroGeral(null);
      try {
        const params = new URLSearchParams();
        params.set('ano', String(anoAtivo));
        if (nifsSelecionados.size > 0 && nifsSelecionados.size < entidades.length) {
          params.set('nifs', Array.from(nifsSelecionados).join(','));
        }
        params.set('filtro_rapido', filtroRapido);
        if (pesquisa.trim()) params.set('pesquisa', pesquisa.trim());
        params.set('ordenar_por', sortCol);
        params.set('ordem', sortDir);

        const res = await fetch(`http://127.0.0.1:8015/api/pendentes/documentos?${params.toString()}`);
        if (!res.ok) {
          const errJ = await res.json().catch(() => ({}));
          throw new Error(errJ.detail || 'Erro ao consultar documentos pendentes.');
        }
        const d = await res.json();
        const docs: DocumentoPendente[] = d.documentos || [];
        setDocumentos(docs);
        setResumosClientes(d.resumos_clientes || []);
        if (d.kpis) setKpis(d.kpis);
        setChaveAtiva(prev => (prev && docs.some(x => x.chave_linha === prev) ? prev : docs[0]?.chave_linha || ''));
        setApiOnlineLocal(true);
        onApiStatusChange?.(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Sem ligação ao motor local.';
        setErroGeral(msg);
        setApiOnlineLocal(false);
        onApiStatusChange?.(false);
      } finally {
        if (!silencioso) setCarregando(false);
      }
    },
    [anoAtivo, nifsSelecionados, entidades.length, filtroRapido, pesquisa, sortCol, sortDir, onApiStatusChange]
  );

  useEffect(() => {
    refreshOnFsRef.current = () => {
      void carregarEntidades();
      void carregarDocumentos(true);
    };
  });

  useEffect(() => {
    carregarCatalogo();
  }, [carregarCatalogo]);

  useEffect(() => {
    carregarEntidades();
  }, [carregarEntidades]);

  useEffect(() => {
    carregarDocumentos();
  }, [carregarDocumentos]);

  // Polling de jobs (recolha ou submissão)
  useEffect(() => {
    if (!jobAtivo || !['em_progresso', 'iniciado'].includes(jobAtivo.status)) return;
    let cancelado = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8015/api/extracao/status/${jobAtivo.jobId}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelado) return;
        setJobAtivo(prev =>
          prev
            ? {
                ...prev,
                status: d.status,
                mensagem: d.mensagem || prev.mensagem,
                percentagem: typeof d.percentagem === 'number' ? d.percentagem : prev.percentagem,
                docsAtuais: d.docs_atuais ?? prev.docsAtuais,
                totalEsperado: d.total_esperado ?? prev.totalEsperado,
              }
            : null
        );
        if (['concluido', 'interrompido', 'erro', 'cancelado'].includes(d.status)) {
          window.clearInterval(interval);
          setBannerInfo({
            tipo: d.status === 'concluido' ? 'ok' : d.status === 'erro' ? 'erro' : 'info',
            texto: d.erro || d.mensagem || 'Operação concluída.',
          });
          await Promise.all([carregarEntidades(), carregarDocumentos(true)]);
        }
      } catch {}
    }, 1000);
    return () => {
      cancelado = true;
      window.clearInterval(interval);
    };
  }, [jobAtivo, carregarEntidades, carregarDocumentos]);

  const entidadesFiltradasSeletor = useMemo(() => {
    const q = pesquisaClienteModal.trim().toLowerCase();
    if (!q) return entidades;
    return entidades.filter(
      e =>
        e.nif.toLowerCase().includes(q) ||
        e.nomecli.toLowerCase().includes(q) ||
        (e.cod || '').toLowerCase().includes(q)
    );
  }, [entidades, pesquisaClienteModal]);

  const documentoAtivo = useMemo(
    () => documentos.find(d => d.chave_linha === chaveAtiva) || documentos[0] || null,
    [documentos, chaveAtiva]
  );

  const setoresAtividade = useMemo(() => setores.filter(s => !s.auto_fora), [setores]);
  const setoresPessoais = useMemo(() => setores.filter(s => s.auto_fora), [setores]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (col: string) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500 ml-1 inline shrink-0" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />
    );
  };

  const saltarParaProximaEmBranco = (docsAtualizados: DocumentoPendente[], chaveBase: string) => {
    if (!saltoAutomatico || docsAtualizados.length === 0) return;
    const idxAtual = Math.max(
      0,
      docsAtualizados.findIndex(d => d.chave_linha === chaveBase)
    );
    const isVazio = (d: DocumentoPendente) =>
      d.estado_submissao !== 'submetido' && (!d.setor_codigo || !d.ambito_codigo);

    let alvo = docsAtualizados.slice(idxAtual + 1).find(isVazio);
    if (!alvo) {
      alvo = docsAtualizados.slice(0, idxAtual).find(isVazio);
    }
    if (alvo) {
      setChaveAtiva(alvo.chave_linha);
      window.setTimeout(() => {
        rowRefs.current[alvo!.chave_linha]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  };

  const recarregarESaltar = async (chaveBase: string, saltar: boolean) => {
    const params = new URLSearchParams();
    params.set('ano', String(anoAtivo));
    if (nifsSelecionados.size > 0 && nifsSelecionados.size < entidades.length) {
      params.set('nifs', Array.from(nifsSelecionados).join(','));
    }
    params.set('filtro_rapido', filtroRapido);
    if (pesquisa.trim()) params.set('pesquisa', pesquisa.trim());
    params.set('ordenar_por', sortCol);
    params.set('ordem', sortDir);

    const res = await fetch(`http://127.0.0.1:8015/api/pendentes/documentos?${params.toString()}`);
    if (res.ok) {
      const d = await res.json();
      const docs: DocumentoPendente[] = d.documentos || [];
      setDocumentos(docs);
      setResumosClientes(d.resumos_clientes || []);
      if (d.kpis) setKpis(d.kpis);
      if (saltar) {
        saltarParaProximaEmBranco(docs, chaveBase);
      }
    }
    void carregarEntidades();
  };

  const aplicarClassificacao = async (
    alvo: DocumentoPendente,
    opts: {
      setorCodigo?: string;
      ambitoCodigo?: string;
      escopoForcado?: 'documento' | 'selecionados' | 'fornecedor_cliente';
      saltar?: boolean;
    }
  ) => {
    if (alvo.estado_submissao === 'submetido') return;
    const escopo =
      opts.escopoForcado ||
      (modoAplicacao === 'fornecedor_cliente'
        ? 'fornecedor_cliente'
        : chavesMarcadas.size > 1 && chavesMarcadas.has(alvo.chave_linha)
          ? 'selecionados'
          : 'documento');

    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/classificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escopo,
          ano: anoAtivo,
          nif_cliente: alvo.nif_cliente,
          id_documento: alvo.id_documento,
          chaves_selecionadas: escopo === 'selecionados' ? Array.from(chavesMarcadas) : [],
          nif_emitente: alvo.nif_emitente,
          setor_codigo: opts.setorCodigo ?? null,
          ambito_codigo: opts.ambitoCodigo ?? null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || 'Erro ao gravar classificação.');
      }
      await recarregarESaltar(alvo.chave_linha, opts.saltar ?? true);
    } catch (err: unknown) {
      setBannerInfo({
        tipo: 'erro',
        texto: err instanceof Error ? err.message : 'Erro ao classificar.',
      });
    }
  };

  const aplicarValidacao = async (
    escopo: 'documento' | 'selecionados' | 'fornecedor_cliente' | 'cliente_preenchidos',
    acao: 'validar' | 'desvalidar',
    alvo?: DocumentoPendente,
    nifClienteOverride?: string
  ) => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/validar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escopo,
          acao,
          ano: anoAtivo,
          nif_cliente: nifClienteOverride || alvo?.nif_cliente || '',
          id_documento: alvo?.id_documento || '',
          chaves_selecionadas: escopo === 'selecionados' ? Array.from(chavesMarcadas) : [],
          nif_emitente: alvo?.nif_emitente || '',
          utilizador: currentUser?.nome || currentUser?.username || 'Operador',
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || 'Erro ao validar documento.');
      }
      const d = await res.json();
      if (d.ignorados_incompletos > 0) {
        setBannerInfo({
          tipo: 'info',
          texto: `${d.atualizados} documento(s) validado(s). ${d.ignorados_incompletos} ignorado(s) por falta de setor ou âmbito.`,
        });
      }
      await Promise.all([carregarDocumentos(true), carregarEntidades()]);
    } catch (err: unknown) {
      setBannerInfo({
        tipo: 'erro',
        texto: err instanceof Error ? err.message : 'Erro na validação.',
      });
    }
  };

  const toggleModoTudoFora = async (nifs: string[], ativo: boolean) => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/entidades/modo-tudo-fora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nifs,
          ativo,
          ano: anoAtivo,
          aplicar_existentes: true,
        }),
      });
      if (!res.ok) throw new Error('Erro ao atualizar modo Tudo Fora.');
      const d = await res.json();
      setBannerInfo({
        tipo: 'ok',
        texto: ativo
          ? `Modo Tudo Fora ativado (${d.documentos_atualizados || 0} documento(s) marcado(s) como Fora).`
          : 'Modo Tudo Fora desativado para o cliente.',
      });
      await Promise.all([carregarEntidades(), carregarDocumentos(true)]);
    } catch (err: unknown) {
      setBannerInfo({
        tipo: 'erro',
        texto: err instanceof Error ? err.message : 'Erro ao atualizar entidade.',
      });
    }
  };

  // Polling do Ensaio Visual DEV em direto
  useEffect(() => {
    if (!modalEnsaioAberto || !ensaioState?.jobId) return;
    if (!['em_progresso', 'iniciado'].includes(ensaioState.status)) return;
    let cancelado = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8015/api/pendentes/ensaio-status/${ensaioState.jobId}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelado) return;
        const novasPaginas: EnsaioPaginaSnapshot[] = d.ensaio_paginas_b64 || [];
        setEnsaioState(prev =>
          prev
            ? {
                ...prev,
                status: d.status,
                percentagem: typeof d.percentagem === 'number' ? d.percentagem : prev.percentagem,
                mensagem: d.mensagem || prev.mensagem,
                erro: d.erro ?? null,
                docsAtuais: d.docs_atuais ?? prev.docsAtuais,
                totalEsperado: d.total_esperado ?? prev.totalEsperado,
                ensaioUrl: d.ensaio_url || prev.ensaioUrl,
                ensaioPassoAtual: d.ensaio_passo_atual || prev.ensaioPassoAtual,
                ensaioFrameB64: d.ensaio_frame_b64 || prev.ensaioFrameB64,
                ensaioPaginasB64: novasPaginas,
                ensaioItens: d.ensaio_itens || prev.ensaioItens,
                janelaNativaAberta: Boolean(d.janela_nativa_aberta),
              }
            : null
        );
        if (['concluido', 'interrompido', 'erro', 'cancelado'].includes(d.status)) {
          window.clearInterval(interval);
          if (novasPaginas.length > 0) {
            setPaginaEnsaioAtiva(0);
          }
          setBannerInfo({
            tipo: d.status === 'erro' ? 'erro' : 'ok',
            texto: d.erro || d.mensagem || 'Ensaio visual concluído (nenhum documento foi submetido na AT).',
          });
        }
      } catch {}
    }, 650);
    return () => {
      cancelado = true;
      window.clearInterval(interval);
    };
  }, [modalEnsaioAberto, ensaioState?.jobId, ensaioState?.status]);

  const idsSelecionadosEfetivos = useMemo(() => {
    if (nenhumSelecionadoManual) return new Set<string>();
    if (nifsSelecionados.size > 0) return nifsSelecionados;
    return new Set(entidades.map(e => e.nif));
  }, [nenhumSelecionadoManual, nifsSelecionados, entidades]);

  const selecionarTodasEntidades = () => {
    setNenhumSelecionadoManual(false);
    setNifsSelecionados(new Set());
  };

  const limparSelecaoEntidades = () => {
    setNenhumSelecionadoManual(true);
    setNifsSelecionados(new Set());
  };

  const iniciarRecolhaEmBloco = async () => {
    if (nenhumSelecionadoManual) {
      setBannerInfo({
        tipo: 'erro',
        texto: 'Selecione pelo menos um contribuinte singular com credenciais AT.',
      });
      return;
    }

    const nifsAlvo =
      nifsSelecionados.size > 0
        ? Array.from(nifsSelecionados)
        : entidades.filter(e => e.tem_credenciais_at).map(e => e.nif);

    if (nifsAlvo.length === 0) {
      setBannerInfo({
        tipo: 'erro',
        texto: 'Selecione pelo menos um contribuinte singular com credenciais AT.',
      });
      return;
    }

    setSeletorClientesAberto(false);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/recolher-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nifs: nifsAlvo,
          ano: anoAtivo,
          forcar_historico_anterior: forcarHistoricoAnt,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(d.detail?.mensagem || d.detail || 'Erro ao iniciar recolha de pendentes.');
      }
      setJobAtivo({
        jobId: d.job_id,
        tipo: 'recolha',
        status: 'em_progresso',
        mensagem: d.mensagem || 'A recolher pendentes na AT...',
        percentagem: 3,
        docsAtuais: 0,
        totalEsperado: nifsAlvo.length,
      });
    } catch (err: unknown) {
      setBannerInfo({
        tipo: 'erro',
        texto: err instanceof Error ? err.message : 'Falha ao iniciar recolha.',
      });
    }
  };

  const pararJobAtivo = async () => {
    if (!jobAtivo) return;
    try {
      await fetch(`http://127.0.0.1:8015/api/extracao/parar/${jobAtivo.jobId}`, { method: 'POST' });
    } catch {}
  };

  const pararEnsaioVisual = async () => {
    if (!ensaioState?.jobId) return;
    try {
      await fetch(`http://127.0.0.1:8015/api/extracao/parar/${ensaioState.jobId}`, { method: 'POST' });
    } catch {}
  };

  const abrirModalTermo = async () => {
    setTermoAceite(false);
    setAbaModalTermo('confirmar');
    if (isDeveloperUser) {
      setModoEnsaioVisivel(true);
    } else {
      setModoEnsaioVisivel(false);
    }
    setModalTermoAberto(true);
    setCarregandoTermos(true);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/termos-historico?limite=30');
      if (res.ok) {
        const d = await res.json();
        setHistoricoTermos(d.termos || []);
      }
    } catch {}
    setCarregandoTermos(false);
  };

  const confirmarESubmeterNaAT = async () => {
    if (!termoAceite) return;
    const usarEnsaioVisual = Boolean(isDeveloperUser && modoEnsaioVisivel);
    try {
      const nifsFiltro =
        nifsSelecionados.size > 0 && nifsSelecionados.size < entidades.length
          ? Array.from(nifsSelecionados)
          : null;
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/submeter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ano: anoAtivo,
          nifs: nifsFiltro,
          termo_aceite: true,
          texto_termo: TEXTO_TERMO_PADRAO,
          utilizador: currentUser?.nome || currentUser?.username || 'Utilizador',
          email_utilizador: currentUser?.email || '',
          modo_simulacao: false,
          modo_ensaio_visivel: usarEnsaioVisual,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(d.detail?.mensagem || d.detail || 'Erro ao iniciar submissão na AT.');
      }
      setModalTermoAberto(false);

      if (usarEnsaioVisual) {
        setPaginaEnsaioAtiva(-1);
        setZoomRealEnsaio(false);
        setEnsaioState({
          jobId: d.job_id,
          status: 'em_progresso',
          percentagem: 4,
          mensagem: d.mensagem || 'A abrir Portal das Finanças em modo ensaio visual...',
          erro: null,
          docsAtuais: 0,
          totalEsperado: d.total_documentos || kpis.validados_por_submeter,
          ensaioUrl: 'https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action',
          ensaioPassoAtual: 'A autenticar sessão na AT (submissão bloqueada)...',
          ensaioFrameB64: '',
          ensaioPaginasB64: [],
          ensaioItens: [],
          janelaNativaAberta: false,
        });
        setModalEnsaioAberto(true);
        return;
      }

      setJobAtivo({
        jobId: d.job_id,
        tipo: 'submissao',
        status: 'em_progresso',
        mensagem: d.mensagem || 'A submeter documentos na AT...',
        percentagem: 3,
        docsAtuais: 0,
        totalEsperado: d.total_documentos || kpis.validados_por_submeter,
      });
    } catch (err: unknown) {
      setBannerInfo({
        tipo: 'erro',
        texto: err instanceof Error ? err.message : 'Erro ao submeter.',
      });
    }
  };

  const adicionarPalavraChave = async () => {
    if (!novaPalavra.trim()) return;
    setSalvandoKw(true);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/pendentes/palavras-chave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          palavra: novaPalavra.trim(),
          setor_codigo: novoSetorKw,
          ambito_codigo: novoAmbitoKw,
        }),
      });
      if (res.ok) {
        setNovaPalavra('');
        await carregarCatalogo();
      }
    } finally {
      setSalvandoKw(false);
    }
  };

  const removerPalavraChave = async (id: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/pendentes/palavras-chave/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await carregarCatalogo();
      }
    } catch {}
  };

  const toggleClienteSelecionado = (nif: string) => {
    const base = nenhumSelecionadoManual
      ? new Set<string>()
      : nifsSelecionados.size > 0
        ? new Set(nifsSelecionados)
        : new Set(entidades.map(e => e.nif));
    if (base.has(nif)) base.delete(nif);
    else base.add(nif);

    if (base.size === 0) {
      setNenhumSelecionadoManual(true);
      setNifsSelecionados(new Set());
    } else if (entidades.length > 0 && base.size >= entidades.length) {
      setNenhumSelecionadoManual(false);
      setNifsSelecionados(new Set());
    } else {
      setNenhumSelecionadoManual(false);
      setNifsSelecionados(base);
    }
  };

  const toggleLinhaMarcada = (chave: string) => {
    setChavesMarcadas(prev => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  const toggleTodasLinhasVisiveis = () => {
    if (documentos.length === 0) return;
    const todasMarcadas = documentos.every(d => chavesMarcadas.has(d.chave_linha));
    if (todasMarcadas) {
      setChavesMarcadas(new Set());
    } else {
      setChavesMarcadas(new Set(documentos.map(d => d.chave_linha)));
    }
  };

  const clientesComValidados = useMemo(
    () => resumosClientes.filter(c => c.validados > 0),
    [resumosClientes]
  );

  const resumoPorNif = useMemo(() => {
    const m = new Map<string, ResumoClientePendente>();
    for (const c of resumosClientes) m.set(c.nif_cliente, c);
    return m;
  }, [resumosClientes]);

  const agrupamentoAtivo = sortCol === 'grupo_cliente_fornecedor';
  const jobEmExecucao = Boolean(jobAtivo && ['em_progresso', 'iniciado'].includes(jobAtivo.status));

  return (
    <div className="h-full flex flex-col space-y-2.5 min-h-0 select-none overflow-y-auto md:overflow-hidden">
      {/* 1. Cabeçalho Executivo e Ações Globais */}
      <header className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <span className="page-kicker text-slate-600 dark:text-slate-400 font-mono">
              CLASSIFICAÇÃO E-FATURA · CONTRIBUINTES SINGULARES
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <h1 className="text-xl text-foreground font-display font-light tracking-tight flex items-center flex-wrap gap-2 mt-0.5">
            <CheckSquare className="w-5 h-5 text-[#0284c7] dark:text-sky-400 shrink-0" />
            <span>Classificação de Documentos Pendentes</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-white dark:bg-[#0c1520] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-700">
              <Calendar className="w-3.5 h-3.5" />
              Exercício {anoAtivo}
            </span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (assistenteAberto ? fecharAssistente() : abrirAssistente())}
            className={`px-3 py-1.5 rounded-md border font-mono text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer shadow-xs ${
              assistenteAberto
                ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] text-[#0284c7] dark:text-sky-300'
                : 'bg-[#0284c7] hover:bg-[#0369a1] border-[#0284c7] text-white'
            }`}
            title="Abrir ou ocultar o Assistente Passo a Passo sincronizado com a interface"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{assistenteAberto ? 'Assistente Aberto' : 'Assistente Passo a Passo'}</span>
          </button>

          {/* Submeter Validados na AT */}
          <button
            type="button"
            onClick={abrirModalTermo}
            disabled={kpis.validados_por_submeter === 0 || jobEmExecucao}
            className="px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Submeter Validados na AT ({kpis.validados_por_submeter})</span>
          </button>

          {/* Atualizar */}
          <button
            type="button"
            onClick={() => Promise.all([carregarEntidades(), carregarDocumentos()])}
            className="px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] hover:bg-slate-100 dark:hover:bg-[#13202e] text-xs font-mono font-semibold text-foreground flex items-center space-x-1.5 cursor-pointer"
            title="Recarregar dados"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin text-[#0284c7]' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </header>

      {/* Área Principal + Assistente Passo a Passo Lateral */}
      <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0">
        <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
          {/* Barra Operacional Sincronizada em 4 Zonas */}
          <div className="bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2 shadow-2xs flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Zona 1: Destino dos Dados */}
            <div
              data-evo-guide-target="zona-1"
              onClick={() => assistenteAberto && setPassoAssistente(1)}
              className={`flex items-center space-x-2 px-2.5 py-1.5 rounded border text-xs font-mono transition ${
                assistenteAberto && passoAssistente === 1
                  ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold shrink-0 ${
                    passoAssistente === 1 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                  }`}
                >
                  ① Destino
                </span>
              )}
              <span className="text-slate-600 dark:text-slate-300 font-semibold shrink-0 hidden sm:inline">Dados:</span>
              <span title={caminhoDestinoLocal} className="text-foreground font-semibold break-all max-w-[230px]">
                {caminhoDestinoLocal}
              </span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  void copiarCaminhoDados();
                }}
                title="Copiar endereço completo"
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-[#0284c7] cursor-pointer shrink-0"
              >
                {copiadoPasta ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                data-evo-guide-target="btn-abrir-pasta"
                onClick={e => {
                  e.stopPropagation();
                  void abrirPastaDadosWindows();
                }}
                title="Abrir pasta no Explorador do Windows"
                className="p-0.5 text-[#0284c7] dark:text-sky-400 hover:opacity-80 cursor-pointer shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Zona 2: Seleção Multi-Cliente de Contribuintes Singulares */}
            <div
              data-evo-guide-target="zona-2"
              onClick={() => assistenteAberto && setPassoAssistente(2)}
              className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded border transition ${
                assistenteAberto && passoAssistente === 2
                  ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                    passoAssistente === 2 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                  }`}
                >
                  ② Empresas
                </span>
              )}

              <div ref={seletorRef} data-evo-guide-target="empresa-selector" className="relative">
                <button
                  type="button"
                  onClick={() => setSeletorClientesAberto(prev => !prev)}
                  className="px-3 py-1 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] hover:border-[#0284c7] text-xs font-mono font-semibold text-foreground flex items-center space-x-2 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                  <span>
                    {nenhumSelecionadoManual
                      ? `Selecionados: 0/${entidades.length}`
                      : nifsSelecionados.size === 0
                        ? `Todos Singulares (${entidades.length})`
                        : `Selecionados: ${nifsSelecionados.size}/${entidades.length}`}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {seletorClientesAberto && (
                  <div className="absolute left-0 sm:right-0 sm:left-auto mt-1.5 w-[390px] sm:w-[460px] max-w-[95vw] bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden">
                    <div className="p-2.5 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          Contribuintes Singulares ({entidades.length})
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setNenhumSelecionadoManual(false);
                              setNifsSelecionados(
                                new Set(entidades.filter(e => e.tem_credenciais_at).map(e => e.nif))
                              );
                            }}
                            className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-[10px] font-mono font-semibold text-[#0284c7] dark:text-sky-400 cursor-pointer"
                          >
                            Todos c/ Senha
                          </button>
                          <button
                            type="button"
                            onClick={selecionarTodasEntidades}
                            className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-[10px] font-mono font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            Todas
                          </button>
                          <button
                            type="button"
                            onClick={limparSelecaoEntidades}
                            className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-[10px] font-mono font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            Limpar
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={pesquisaClienteModal}
                          onChange={e => setPesquisaClienteModal(e.target.value)}
                          placeholder="Pesquisar nome ou NIF..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground"
                        />
                      </div>
                      <label className="flex items-center space-x-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={forcarHistoricoAnt}
                          onChange={e => setForcarHistoricoAnt(e.target.checked)}
                          className="rounded border-slate-400"
                        />
                        <span>Forçar atualização do histórico de {anoAtivo - 1}</span>
                      </label>
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-[#d7e0ea] dark:divide-[#222f3e]">
                      {entidadesFiltradasSeletor.length === 0 ? (
                        <div className="p-4 text-center text-xs font-mono text-slate-600 dark:text-slate-400">
                          Nenhum contribuinte singular encontrado.
                        </div>
                      ) : (
                        entidadesFiltradasSeletor.map(ent => {
                          const marcado = idsSelecionadosEfetivos.has(ent.nif);
                          return (
                            <div
                              key={ent.nif}
                              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-[#13202e]"
                            >
                              <label className="flex items-center space-x-2.5 min-w-0 flex-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => toggleClienteSelecionado(ent.nif)}
                                  className="rounded border-slate-400 shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="text-xs font-sans font-medium text-foreground truncate">
                                    {ofuscarNome(ent.nomecli, ent.nif)}
                                  </div>
                                  <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                                    <span className="text-[#0284c7] dark:text-sky-400 font-semibold">
                                      {ofuscarNif(ent.nif)}
                                    </span>
                                    {!ent.tem_credenciais_at && (
                                      <span className="text-rose-600 dark:text-rose-400">Sem senha</span>
                                    )}
                                    {ent.total_pendentes > 0 && (
                                      <span>· {ent.total_pendentes} pend.</span>
                                    )}
                                  </div>
                                </div>
                              </label>
                              <button
                                type="button"
                                onClick={() => toggleModoTudoFora([ent.nif], !ent.modo_tudo_fora)}
                                title="Alternar modo Tudo Fora para este contribuinte"
                                className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold shrink-0 cursor-pointer ${
                                  ent.modo_tudo_fora
                                    ? 'bg-amber-100 dark:bg-[#241a08] border-amber-500 text-amber-900 dark:text-amber-300'
                                    : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {ent.modo_tudo_fora ? 'Tudo Fora ON' : 'Tudo Fora'}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Zona 3: Período (Exercício) */}
            <div
              data-evo-guide-target="zona-3"
              onClick={() => assistenteAberto && setPassoAssistente(3)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border transition ${
                assistenteAberto && passoAssistente === 3
                  ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                    passoAssistente === 3 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                  }`}
                >
                  ③ Período
                </span>
              )}
              <div data-evo-guide-target="ano-selector" className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] border border-[#0284c7] dark:border-sky-600 rounded px-1.5 py-0.5">
                <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => atualizarAno(anoAtivo - 1)}
                  className="p-0.5 hover:bg-sky-100 dark:hover:bg-[#14304d] rounded text-foreground cursor-pointer"
                  title="Exercício Anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-xs text-foreground px-1 min-w-[38px] text-center">
                  {anoAtivo}
                </span>
                <button
                  type="button"
                  onClick={() => atualizarAno(anoAtivo < anoAtual ? anoAtivo + 1 : anoAtivo)}
                  disabled={anoAtivo >= anoAtual}
                  className={`p-0.5 rounded ${
                    anoAtivo >= anoAtual
                      ? 'opacity-25 cursor-not-allowed text-slate-400'
                      : 'hover:bg-sky-100 dark:hover:bg-[#14304d] text-foreground cursor-pointer'
                  }`}
                  title="Exercício Seguinte"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Zona 4: Opções & Recolha em Bloco */}
            <div
              data-evo-guide-target="zona-4"
              onClick={() => assistenteAberto && setPassoAssistente(4)}
              className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded border transition ${
                assistenteAberto && passoAssistente === 4
                  ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                    passoAssistente === 4 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                  }`}
                >
                  ④ Iniciar
                </span>
              )}

              <button
                type="button"
                data-evo-guide-target="btn-opcoes"
                onClick={() => setModalPalavrasAberto(true)}
                className="px-2.5 py-1 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] hover:border-[#0284c7] text-xs font-mono font-semibold text-foreground flex items-center space-x-1.5 cursor-pointer"
              >
                <Tags className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                <span>Palavras-Chave ({palavrasChave.length})</span>
              </button>

              {jobEmExecucao ? (
                <button
                  type="button"
                  data-evo-guide-target="btn-iniciar"
                  onClick={pararJobAtivo}
                  className="px-3.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-mono text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Parar</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-evo-guide-target="btn-iniciar"
                  onClick={iniciarRecolhaEmBloco}
                  className="px-3.5 py-1 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Recolher e Pré-Classificar</span>
                </button>
              )}
            </div>
          </div>

          {/* Barra de Progresso de Job em Curso ou Banner de Aviso */}
      {jobAtivo && ['em_progresso', 'iniciado'].includes(jobAtivo.status) && (
        <div className="bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-700 rounded-md px-3.5 py-2 shrink-0 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center space-x-2 text-slate-900 dark:text-slate-100 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0284c7] dark:text-sky-400" />
              <span>{jobAtivo.mensagem}</span>
            </div>
            <span className="font-bold text-[#0284c7] dark:text-sky-300 tabular-nums">
              {jobAtivo.percentagem}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-200 dark:bg-[#132233] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0284c7] dark:bg-sky-400 transition-all duration-300"
              style={{ width: `${Math.max(3, Math.min(100, jobAtivo.percentagem))}%` }}
            />
          </div>
        </div>
      )}

      {bannerInfo && (
        <div
          className={`px-3 py-2 rounded-md border text-xs font-mono flex items-center justify-between shrink-0 ${
            bannerInfo.tipo === 'erro'
              ? 'bg-[#fef2f2] dark:bg-[#260e12] border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : bannerInfo.tipo === 'ok'
                ? 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-[#f0f9ff] dark:bg-[#0a1929] border-sky-300 dark:border-sky-800 text-slate-900 dark:text-sky-200'
          }`}
        >
          <span>{bannerInfo.texto}</span>
          <button type="button" onClick={() => setBannerInfo(null)} className="ml-2 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Faixa de KPIs 100% Sólidos (Filtros Rápidos de 1 Clique) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 shrink-0">
        {[
          {
            id: 'todos' as FiltroRapidoType,
            titulo: 'Total Pendentes',
            valor: kpis.total_pendentes,
            sub: `${formatarMoeda(kpis.valor_total_pendente)} €`,
            cardCls: 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e]',
            valCls: 'text-slate-900 dark:text-white',
          },
          {
            id: 'vazios' as FiltroRapidoType,
            titulo: 'Por Preencher',
            valor: kpis.por_preencher,
            sub: 'Sem setor ou âmbito',
            cardCls: 'bg-[#fffbeb] dark:bg-[#241a08] border-amber-300 dark:border-amber-800',
            valCls: 'text-amber-800 dark:text-amber-300',
          },
          {
            id: 'duvidosos' as FiltroRapidoType,
            titulo: 'Histórico Dividido %',
            valor: kpis.duvidosos,
            sub: 'Fornecedor c/ misto',
            cardCls: 'bg-[#fffbeb] dark:bg-[#241a08] border-amber-300 dark:border-amber-800',
            valCls: 'text-amber-900 dark:text-amber-200',
          },
          {
            id: 'por_validar' as FiltroRapidoType,
            titulo: 'Por Validar',
            valor: kpis.por_validar,
            sub: 'Aguarda aprovação',
            cardCls: 'bg-[#f0f9ff] dark:bg-[#0a1929] border-sky-300 dark:border-sky-800',
            valCls: 'text-[#0284c7] dark:text-sky-300',
          },
          {
            id: 'validados' as FiltroRapidoType,
            titulo: 'Validados Prontos',
            valor: kpis.validados_por_submeter,
            sub: `Submetidos: ${kpis.submetidos}${kpis.erros > 0 ? ` · Erros: ${kpis.erros}` : ''}`,
            cardCls: 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-800',
            valCls: 'text-emerald-800 dark:text-emerald-300',
          },
        ].map(tile => {
          const ativo = filtroRapido === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => setFiltroRapido(tile.id)}
              className={`text-left rounded-md border px-3 py-2 transition cursor-pointer ${tile.cardCls} ${
                ativo ? 'ring-2 ring-[#0284c7] dark:ring-sky-400' : 'hover:border-[#0284c7]'
              }`}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {tile.titulo}
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className={`text-lg font-mono font-bold tabular-nums ${tile.valCls}`}>
                  {tile.valor.toLocaleString('pt-PT')}
                </span>
                <span className="text-[10.5px] font-mono text-slate-700 dark:text-slate-300 truncate">
                  {tile.sub}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 3. Barra de Navegação na Tabela + Salto por Cliente + Submetidos/Erros */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56 max-w-full">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
            <input
              type="text"
              value={pesquisa}
              onChange={e => setPesquisa(e.target.value)}
              placeholder="Pesquisar fornecedor, NIF, fatura..."
              className="w-full pl-8 pr-6 py-1 text-xs font-mono bg-slate-50 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground"
            />
            {pesquisa && (
              <button
                type="button"
                onClick={() => setPesquisa('')}
                className="absolute right-2 top-1.5 text-slate-500 hover:text-foreground cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <select
            value=""
            onChange={e => {
              const nifAlvo = e.target.value;
              if (!nifAlvo) return;
              const anchor = clientHeaderRefs.current[nifAlvo];
              if (anchor) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                const primeira = documentos.find(d => d.nif_cliente === nifAlvo);
                if (primeira) {
                  setChaveAtiva(primeira.chave_linha);
                  rowRefs.current[primeira.chave_linha]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }
            }}
            className="text-xs font-mono bg-slate-50 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] rounded px-2.5 py-1 text-foreground cursor-pointer"
          >
            <option value="">Ir para Cliente ({resumosClientes.length})...</option>
            {resumosClientes.map(c => (
              <option key={c.nif_cliente} value={c.nif_cliente}>
                {ofuscarNome(c.nome_cliente, c.nif_cliente)} ({ofuscarNif(c.nif_cliente)}) · {c.total} pend.
              </option>
            ))}
          </select>

          {!agrupamentoAtivo && (
            <button
              type="button"
              onClick={() => {
                setSortCol('grupo_cliente_fornecedor');
                setSortDir('asc');
              }}
              className="px-2.5 py-1 rounded bg-[#f0f9ff] dark:bg-[#0a1929] border border-[#0284c7] text-[11px] font-mono font-semibold text-[#0284c7] dark:text-sky-300 cursor-pointer"
            >
              Agrupar: Cliente → Fornecedor
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setFiltroRapido(filtroRapido === 'submetidos' ? 'todos' : 'submetidos')}
            className={`px-2 py-0.5 rounded border cursor-pointer ${
              filtroRapido === 'submetidos'
                ? 'bg-emerald-600 text-white border-emerald-700'
                : 'bg-slate-50 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-300'
            }`}
          >
            Submetidos ({kpis.submetidos})
          </button>
          {kpis.erros > 0 && (
            <button
              type="button"
              onClick={() => setFiltroRapido(filtroRapido === 'erros' ? 'todos' : 'erros')}
              className={`px-2 py-0.5 rounded border cursor-pointer ${
                filtroRapido === 'erros'
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-[#fef2f2] dark:bg-[#260e12] border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              Erros AT ({kpis.erros})
            </button>
          )}
          <button
            type="button"
            onClick={abrirModalTermo}
            className="px-2 py-0.5 rounded border bg-slate-50 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-300 hover:border-[#0284c7] flex items-center space-x-1 cursor-pointer"
            title="Consultar termos de responsabilidade aceites"
          >
            <History className="w-3 h-3" />
            <span>Auditoria Termos</span>
          </button>
        </div>
      </div>

      {/* 4. Barra Interativa Rápida de Classificação em Bloco (Setores & Âmbitos) */}
      <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shrink-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] font-mono text-[11px] font-bold text-foreground">
              {documentoAtivo ? (
                <>
                  {ofuscarNome(documentoAtivo.nome_emitente || documentoAtivo.nif_emitente, documentoAtivo.nif_emitente)}{' '}
                  <span className="text-[#0284c7] dark:text-sky-400">
                    ({documentoAtivo.qtd_fornecedor_cliente} fat. neste cliente)
                  </span>
                </>
              ) : (
                'Sem linha selecionada'
              )}
            </span>

            <div className="flex items-center bg-slate-100 dark:bg-[#132233] p-0.5 rounded border border-[#d7e0ea] dark:border-[#222f3e] text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setModoAplicacao('fornecedor_cliente')}
                className={`px-2 py-0.5 rounded font-semibold flex items-center space-x-1 cursor-pointer ${
                  modoAplicacao === 'fornecedor_cliente'
                    ? 'bg-[#0284c7] text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Bloco Fornecedor</span>
              </button>
              <button
                type="button"
                onClick={() => setModoAplicacao('linha')}
                className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                  modoAplicacao === 'linha' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                Só Linha / Seleção{chavesMarcadas.size > 0 ? ` (${chavesMarcadas.size})` : ''}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSaltoAutomatico(prev => !prev)}
              className={`px-2 py-0.5 rounded border text-[11px] font-mono font-semibold flex items-center space-x-1 cursor-pointer ${
                saltoAutomatico
                  ? 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-600 dark:text-slate-400'
              }`}
            >
              <SkipForward className="w-3 h-3" />
              <span>Salto Automático</span>
            </button>
          </div>

          {/* Botões Rápidos de Âmbito + Validar Fornecedor */}
          <div className="flex flex-wrap items-center gap-1.5">
            {ambitos.map(amb => {
              const ativo = documentoAtivo?.ambito_codigo === amb.codigo;
              const clsCor =
                amb.codigo === '0'
                  ? ativo
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : amb.codigo === '2'
                    ? ativo
                      ? 'bg-amber-600 text-white border-amber-700'
                      : 'bg-[#fffbeb] dark:bg-[#241a08] border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : ativo
                      ? 'bg-slate-700 text-white border-slate-800'
                      : 'bg-slate-100 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-200';
              return (
                <button
                  key={amb.codigo}
                  type="button"
                  disabled={!documentoAtivo || documentoAtivo.estado_submissao === 'submetido'}
                  onClick={() => documentoAtivo && aplicarClassificacao(documentoAtivo, { ambitoCodigo: amb.codigo })}
                  className={`px-2.5 py-1 rounded border text-[11px] font-mono font-bold disabled:opacity-40 cursor-pointer ${clsCor}`}
                  title={amb.descricao_at}
                >
                  {amb.nome_curto}
                </button>
              );
            })}

            <button
              type="button"
              disabled={!documentoAtivo || documentoAtivo.estado_submissao === 'submetido'}
              onClick={() => documentoAtivo && aplicarValidacao('fornecedor_cliente', 'validar', documentoAtivo)}
              className="px-2.5 py-1 rounded border border-emerald-500 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-mono font-bold flex items-center space-x-1 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Validar Fornecedor</span>
            </button>
          </div>
        </div>

        {/* 16 Botões Rápidos de Setor (Atividade/Mistos vs Pessoais -> Fora Automático) */}
        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#d7e0ea] dark:border-[#222f3e]">
          {setoresAtividade.map(sec => {
            const ativo = documentoAtivo?.setor_codigo === sec.codigo;
            return (
              <button
                key={sec.codigo}
                type="button"
                disabled={!documentoAtivo || documentoAtivo.estado_submissao === 'submetido'}
                onClick={() => documentoAtivo && aplicarClassificacao(documentoAtivo, { setorCodigo: sec.codigo })}
                title={`${sec.codigo} — ${sec.descricao_at}`}
                className={`px-2 py-0.5 rounded border text-[10.5px] font-mono font-semibold disabled:opacity-40 cursor-pointer transition ${
                  ativo
                    ? 'bg-[#0284c7] text-white border-[#0369a1]'
                    : 'bg-[#f0f9ff] dark:bg-[#0a1929] border-sky-200 dark:border-sky-800 text-slate-900 dark:text-sky-200 hover:border-[#0284c7]'
                }`}
              >
                {sec.nome_curto}
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px bg-[#d7e0ea] dark:bg-[#222f3e]" />

          {setoresPessoais.map(sec => {
            const ativo = documentoAtivo?.setor_codigo === sec.codigo;
            return (
              <button
                key={sec.codigo}
                type="button"
                disabled={!documentoAtivo || documentoAtivo.estado_submissao === 'submetido'}
                onClick={() => documentoAtivo && aplicarClassificacao(documentoAtivo, { setorCodigo: sec.codigo })}
                title={`${sec.codigo} — ${sec.descricao_at} (Pessoal: marca automaticamente Fora)`}
                className={`px-2 py-0.5 rounded border text-[10.5px] font-mono font-semibold disabled:opacity-40 cursor-pointer transition ${
                  ativo
                    ? 'bg-slate-800 dark:bg-sky-500 text-white dark:text-slate-950 border-slate-900'
                    : 'bg-slate-100 dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-200 hover:border-slate-500'
                }`}
              >
                {sec.nome_curto}
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Tabela Única Contínua Multi-Cliente (Card Principal Evo Grid) */}
      <div className="flex-1 min-h-[340px] md:min-h-0 bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs overflow-hidden flex flex-col relative">
        <div className="relative evo-card-signature flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">
              Documentos Pendentes Multi-Cliente
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] text-[10.5px] font-mono font-bold text-foreground tabular-nums">
              {documentos.length.toLocaleString('pt-PT')}
            </span>
          </div>
          {chavesMarcadas.size > 0 && (
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="text-[#0284c7] dark:text-sky-400 font-bold">
                {chavesMarcadas.size} selecionada(s)
              </span>
              <button
                type="button"
                onClick={() => aplicarValidacao('selecionados', 'validar')}
                className="px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold cursor-pointer"
              >
                Validar Seleção
              </button>
              <button
                type="button"
                onClick={() => setChavesMarcadas(new Set())}
                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Limpar Seleção
              </button>
            </div>
          )}
        </div>

        {erroGeral ? (
          <div className="p-6 text-center text-xs font-mono text-rose-700 dark:text-rose-300 space-y-2">
            <AlertTriangle className="w-6 h-6 mx-auto" />
            <p className="font-bold">{erroGeral}</p>
          </div>
        ) : documentos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#f0f9ff] dark:bg-[#0a1929] border border-sky-200 dark:border-sky-800 flex items-center justify-center text-[#0284c7] dark:text-sky-400 mb-3">
              <CheckSquare className="w-6 h-6" />
            </div>
            <h3 className="font-display font-light text-base text-foreground mb-1">
              Sem Documentos Pendentes para Mostrar
            </h3>
            <p className="font-mono text-xs text-slate-600 dark:text-slate-300 max-w-md">
              Selecione os contribuintes singulares acima e clique em Recolher e Pré-Classificar.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-[#101c2b] border-b border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200">
                <tr>
                  <th className="px-2 py-2 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={documentos.length > 0 && documentos.every(d => chavesMarcadas.has(d.chave_linha))}
                      onChange={toggleTodasLinhasVisiveis}
                      className="rounded border-slate-400 cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort('nome_cliente')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Cliente {renderSortIcon('nome_cliente')}
                  </th>
                  <th
                    onClick={() => handleSort('data_emissao')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Data {renderSortIcon('data_emissao')}
                  </th>
                  <th
                    onClick={() => handleSort('nome_emitente')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Fornecedor {renderSortIcon('nome_emitente')}
                  </th>
                  <th
                    onClick={() => handleSort('numero_documento')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Documento {renderSortIcon('numero_documento')}
                  </th>
                  <th
                    onClick={() => handleSort('valor_total')}
                    className="px-2.5 py-2 text-right cursor-pointer whitespace-nowrap"
                  >
                    Total {renderSortIcon('valor_total')}
                  </th>
                  <th
                    onClick={() => handleSort('setor_codigo')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Setor de Atividade {renderSortIcon('setor_codigo')}
                  </th>
                  <th
                    onClick={() => handleSort('ambito_codigo')}
                    className="px-2.5 py-2 cursor-pointer whitespace-nowrap"
                  >
                    Âmbito {renderSortIcon('ambito_codigo')}
                  </th>
                  <th
                    onClick={() => handleSort('validado')}
                    className="px-2.5 py-2 text-center cursor-pointer whitespace-nowrap"
                  >
                    Validado {renderSortIcon('validado')}
                  </th>
                  <th
                    onClick={() => handleSort('estado_submissao')}
                    className="px-2.5 py-2 text-center cursor-pointer whitespace-nowrap"
                  >
                    Estado {renderSortIcon('estado_submissao')}
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#d7e0ea] dark:divide-[#222f3e] text-xs">
                {documentos.map((doc, idx) => {
                  const anterior = idx > 0 ? documentos[idx - 1] : null;
                  const mostrarCabecalhoCliente =
                    agrupamentoAtivo && (!anterior || anterior.nif_cliente !== doc.nif_cliente);
                  const resumoCli = resumoPorNif.get(doc.nif_cliente);
                  const selecionado = doc.chave_linha === chaveAtiva;
                  const marcado = chavesMarcadas.has(doc.chave_linha);
                  const submetido = doc.estado_submissao === 'submetido';
                  const completo = Boolean(doc.setor_codigo && doc.ambito_codigo);
                  const origInfo = ORIGEM_LABEL[doc.origem_sugestao];

                  return (
                    <Fragment key={doc.chave_linha}>
                      {mostrarCabecalhoCliente && (
                        <tr
                          ref={el => {
                            clientHeaderRefs.current[doc.nif_cliente] = el;
                          }}
                          className="bg-[#f0f9ff] dark:bg-[#0a1929] border-y border-sky-300 dark:border-sky-800"
                        >
                          <td colSpan={10} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-bold text-xs text-[#0284c7] dark:text-sky-300">
                                  {ofuscarNif(doc.nif_cliente)}
                                </span>
                                <span className="font-sans font-semibold text-xs text-slate-900 dark:text-white">
                                  {ofuscarNome(doc.nome_cliente, doc.nif_cliente)}
                                </span>
                                {resumoCli && (
                                  <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-[10.5px] font-mono text-slate-700 dark:text-slate-200 tabular-nums">
                                    {resumoCli.total} pend. · {resumoCli.preenchidos} preench. · {resumoCli.validados} valid.
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleModoTudoFora([doc.nif_cliente], true)}
                                  className="px-2.5 py-1 rounded border border-amber-400 dark:border-amber-700 bg-[#fffbeb] dark:bg-[#241a08] text-amber-900 dark:text-amber-200 text-[10.5px] font-mono font-semibold cursor-pointer"
                                >
                                  Marcar Cliente Tudo Fora
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    aplicarValidacao('cliente_preenchidos', 'validar', undefined, doc.nif_cliente)
                                  }
                                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-mono font-bold cursor-pointer flex items-center space-x-1"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Validar Preenchidos deste Cliente</span>
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      <tr
                        ref={el => {
                          rowRefs.current[doc.chave_linha] = el;
                        }}
                        onClick={() => setChaveAtiva(doc.chave_linha)}
                        className={`transition-colors ${
                          selecionado
                            ? 'bg-sky-50 dark:bg-[#112438]'
                            : 'bg-white dark:bg-[#0c1520] hover:bg-slate-50 dark:hover:bg-[#101c2b]'
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => toggleLinhaMarcada(doc.chave_linha)}
                            className="rounded border-slate-400 cursor-pointer"
                          />
                        </td>

                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <div className="font-mono text-[11px] font-semibold text-[#0284c7] dark:text-sky-400">
                            {ofuscarNif(doc.nif_cliente)}
                          </div>
                          <div className="text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
                            {ofuscarNome(doc.nome_cliente, doc.nif_cliente)}
                          </div>
                        </td>

                        <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {formatarDataPt(doc.data_emissao)}
                        </td>

                        <td className="px-2.5 py-1.5 min-w-[180px] max-w-[250px]">
                          <div className="font-sans font-medium text-xs text-foreground truncate">
                            {ofuscarNome(doc.nome_emitente || doc.nif_emitente, doc.nif_emitente)}
                          </div>
                          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                            <span>{ofuscarNif(doc.nif_emitente)}</span>
                            {doc.qtd_fornecedor_cliente > 1 && (
                              <span className="px-1 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] text-[#0284c7] dark:text-sky-400 font-bold">
                                ×{doc.qtd_fornecedor_cliente}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-2.5 py-1.5 font-mono text-[11px] whitespace-nowrap">
                          <div className="text-foreground font-semibold">{doc.numero_documento || doc.id_documento}</div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">{doc.tipo_doc}</div>
                        </td>

                        <td className="px-2.5 py-1.5 text-right font-mono text-xs font-bold text-foreground whitespace-nowrap tabular-nums">
                          {formatarMoeda(doc.valor_total)} €
                        </td>

                        {/* Setor de Atividade */}
                        <td className="px-2.5 py-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center space-x-1.5">
                            <select
                              value={doc.setor_codigo}
                              disabled={submetido}
                              onChange={e => {
                                const val = e.target.value;
                                if (val) {
                                  void aplicarClassificacao(doc, { setorCodigo: val });
                                }
                              }}
                              className={`text-[11px] font-mono rounded border px-1.5 py-1 max-w-[175px] cursor-pointer disabled:opacity-50 ${
                                !doc.setor_codigo
                                  ? 'bg-[#fffbeb] dark:bg-[#241a08] border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                                  : 'bg-white dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-foreground'
                              }`}
                            >
                              <option value="">Selecionar setor...</option>
                              {setores.map(s => (
                                <option key={s.codigo} value={s.codigo}>
                                  {s.codigo} · {s.nome_curto}
                                </option>
                              ))}
                            </select>

                            {doc.historico_dividido_setor && (
                              <span
                                title={doc.detalhe_historico || 'Fornecedor com histórico misto de setores'}
                                className="px-1.5 py-0.5 rounded bg-[#fffbeb] dark:bg-[#241a08] border border-amber-400 dark:border-amber-700 text-[10px] font-mono font-bold text-amber-900 dark:text-amber-200"
                              >
                                %
                              </span>
                            )}

                            {origInfo && (
                              <span className={`px-1.5 py-0.5 rounded border text-[9.5px] font-mono font-semibold ${origInfo.cls}`}>
                                {origInfo.label}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Âmbito Dentro / Fora */}
                        <td className="px-2.5 py-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center space-x-1">
                            {[
                              { cod: '0', label: 'Sim', title: 'Sim, totalmente afeta à atividade' },
                              { cod: '2', label: 'Parc.', title: 'Sim, parcialmente afeta à atividade' },
                              { cod: '1', label: 'Não', title: 'Não (Fora da atividade)' },
                            ].map(op => {
                              const ativo = doc.ambito_codigo === op.cod;
                              const activeCls =
                                op.cod === '0'
                                  ? 'bg-emerald-600 text-white border-emerald-700'
                                  : op.cod === '2'
                                    ? 'bg-amber-600 text-white border-amber-700'
                                    : 'bg-slate-700 text-white border-slate-800';
                              return (
                                <button
                                  key={op.cod}
                                  type="button"
                                  disabled={submetido}
                                  title={op.title}
                                  onClick={() => void aplicarClassificacao(doc, { ambitoCodigo: op.cod })}
                                  className={`px-2 py-0.5 rounded border text-[10.5px] font-mono font-bold disabled:opacity-40 cursor-pointer ${
                                    ativo
                                      ? activeCls
                                      : 'bg-white dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-300 hover:border-[#0284c7]'
                                  }`}
                                >
                                  {op.label}
                                </button>
                              );
                            })}

                            {doc.historico_dividido_ambito && (
                              <span
                                title={doc.detalhe_historico || 'Fornecedor com histórico misto dentro/fora'}
                                className="px-1.5 py-0.5 rounded bg-[#fffbeb] dark:bg-[#241a08] border border-amber-400 dark:border-amber-700 text-[10px] font-mono font-bold text-amber-900 dark:text-amber-200"
                              >
                                %
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Validado */}
                        <td className="px-2.5 py-1.5 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={submetido || (!doc.validado && !completo)}
                            title={
                              !completo
                                ? 'Preencha setor e âmbito antes de validar'
                                : doc.validado
                                  ? 'Validado — clique para retirar aprovação'
                                  : 'Clique para validar este documento'
                            }
                            onClick={() =>
                              void aplicarValidacao('documento', doc.validado ? 'desvalidar' : 'validar', doc)
                            }
                            className={`px-2.5 py-0.5 rounded border text-[10.5px] font-mono font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              doc.validado
                                ? 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-500 text-emerald-800 dark:text-emerald-300'
                                : 'bg-white dark:bg-[#132233] border-[#d7e0ea] dark:border-[#222f3e] text-slate-600 dark:text-slate-300 hover:border-emerald-500'
                            }`}
                          >
                            {doc.validado ? 'Validado' : 'Validar'}
                          </button>
                        </td>

                        {/* Estado AT */}
                        <td className="px-2.5 py-1.5 text-center whitespace-nowrap">
                          {doc.estado_submissao === 'submetido' ? (
                            <span className="px-2 py-0.5 rounded bg-[#f0fdf4] dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-700 text-[10px] font-mono font-bold text-emerald-800 dark:text-emerald-300">
                              Submetido
                            </span>
                          ) : doc.estado_submissao === 'erro' ? (
                            <span
                              title={doc.erro_submissao || 'Erro devolvido pela AT'}
                              className="px-2 py-0.5 rounded bg-[#fef2f2] dark:bg-[#260e12] border border-rose-400 dark:border-rose-700 text-[10px] font-mono font-bold text-rose-800 dark:text-rose-200 cursor-help"
                            >
                              Erro AT
                            </span>
                          ) : doc.validado ? (
                            <span className="px-2 py-0.5 rounded bg-[#f0f9ff] dark:bg-[#0a1929] border border-sky-300 dark:border-sky-700 text-[10px] font-mono font-bold text-[#0284c7] dark:text-sky-300">
                              Pronto
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] text-[10px] font-mono text-slate-700 dark:text-slate-300">
                              Pendente
                            </span>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </div>

        {/* Assistente Passo a Passo Lateral Sincronizado */}
        <AssistenteImportacaoPanel
          aberto={assistenteAberto}
          onClose={fecharAssistente}
          moduloTitulo="Documentos Pendentes"
          apiOnline={apiOnlineLocal}
          caminhoDados={caminhoDestinoLocal}
          onCaminhoDadosChange={setCaminhoDestinoLocal}
          tipoOperacao="compras"
          permitirAmbos={false}
          onTipoOperacaoChange={() => {}}
          empresas={entidades.map(e => ({
            id: e.nif,
            cod: e.cod,
            nif: e.nif,
            nome: e.nomecli,
          }))}
          selecionadasIds={idsSelecionadosEfetivos}
          onToggleEmpresa={toggleClienteSelecionado}
          onSelecionarTodasEmpresas={selecionarTodasEntidades}
          onLimparEmpresas={limparSelecaoEntidades}
          modoPrivacidade={modoPrivacidade}
          ano={anoAtivo}
          anoAtual={anoAtual}
          onAnoChange={atualizarAno}
          apenasAnoCompleto
          opcoesExtras={
            <label className="flex items-center space-x-2 text-[11px] font-mono text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={forcarHistoricoAnt}
                onChange={e => setForcarHistoricoAnt(e.target.checked)}
                className="rounded border-slate-400 cursor-pointer"
              />
              <span>Forçar atualização do histórico de {anoAtivo - 1}</span>
            </label>
          }
          isSyncing={jobEmExecucao}
          labelBotaoIniciar="Recolher e Pré-Classificar"
          onIniciarImportacao={() => void iniciarRecolhaEmBloco()}
          passoAtivo={passoAssistente}
          onPassoAtivoChange={setPassoAssistente}
        />
      </div>

      {/* Modal 1: Termo de Responsabilidade Legal + Auditoria */}
      {modalTermoAberto && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="relative evo-card-signature flex items-center justify-between px-5 py-3.5 border-b border-[#d7e0ea] dark:border-[#222f3e]">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h3 className="font-display font-semibold text-sm text-foreground">
                  Termo de Responsabilidade — Submissão no e-Fatura
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalTermoAberto(false)}
                className="text-slate-500 hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-2 px-5 pt-3 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b]">
              <button
                type="button"
                onClick={() => setAbaModalTermo('confirmar')}
                className={`px-3 py-1.5 text-xs font-mono font-bold border-b-2 cursor-pointer ${
                  abaModalTermo === 'confirmar'
                    ? 'border-[#0284c7] text-[#0284c7] dark:text-sky-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400'
                }`}
              >
                Confirmar Submissão
              </button>
              <button
                type="button"
                onClick={() => setAbaModalTermo('historico')}
                className={`px-3 py-1.5 text-xs font-mono font-bold border-b-2 cursor-pointer ${
                  abaModalTermo === 'historico'
                    ? 'border-[#0284c7] text-[#0284c7] dark:text-sky-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400'
                }`}
              >
                Registo de Auditoria ({historicoTermos.length})
              </button>
            </div>

            {abaModalTermo === 'confirmar' ? (
              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] p-3">
                    <div className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300">
                      Clientes Incluídos
                    </div>
                    <div className="text-xl font-mono font-bold text-[#0284c7] dark:text-sky-400 mt-0.5">
                      {clientesComValidados.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] p-3">
                    <div className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300">
                      Documentos Validados
                    </div>
                    <div className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                      {kpis.validados_por_submeter}
                    </div>
                  </div>
                </div>

                {clientesComValidados.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-[#d7e0ea] dark:border-[#222f3e] divide-y divide-[#d7e0ea] dark:divide-[#222f3e] text-xs">
                    {clientesComValidados.map(c => (
                      <div key={c.nif_cliente} className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-[#0c1520]">
                        <span className="truncate font-medium text-foreground">
                          {ofuscarNome(c.nome_cliente, c.nif_cliente)}{' '}
                          <span className="font-mono text-[#0284c7] dark:text-sky-400">
                            ({ofuscarNif(c.nif_cliente)})
                          </span>
                        </span>
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 shrink-0 ml-2">
                          {c.validados} doc(s)
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-amber-400 dark:border-amber-700 bg-[#fffbeb] dark:bg-[#241a08] p-3.5 space-y-2.5">
                  <p className="text-xs font-sans font-medium text-slate-900 dark:text-amber-100 leading-relaxed">
                    {TEXTO_TERMO_PADRAO}
                  </p>
                  <label className="flex items-start space-x-2.5 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={termoAceite}
                      onChange={e => setTermoAceite(e.target.checked)}
                      className="mt-0.5 rounded border-amber-600 cursor-pointer"
                    />
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                      Confirmo e aceito a responsabilidade total pela submissão destes documentos na AT (
                      {currentUser?.nome || currentUser?.username || 'Utilizador'}).
                    </span>
                  </label>
                </div>

                {/* Bloco Exclusivo do Programador: Simulação Visual no Browser sem Submeter */}
                {isDeveloperUser && (
                  <div className="rounded-lg border-2 border-[#0284c7] dark:border-sky-600 bg-sky-50 dark:bg-[#0a1929] p-3.5 space-y-2">
                    <label className="flex items-start space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={modoEnsaioVisivel}
                        onChange={e => setModoEnsaioVisivel(e.target.checked)}
                        className="mt-0.5 rounded border-[#0284c7] cursor-pointer"
                      />
                      <div className="space-y-1">
                        <div className="text-xs font-mono font-bold text-[#0369a1] dark:text-sky-300 flex items-center space-x-1.5">
                          <Eye className="w-3.5 h-3.5 shrink-0" />
                          <span>Modo Ensaio Visual (Só Programador): preencher no browser visível sem submeter</span>
                        </div>
                        <p className="text-[11px] font-sans text-slate-800 dark:text-slate-200 leading-snug">
                          Abre o Portal das Finanças em direto, preenche os setores e âmbitos linha a linha para inspeção visual e bloqueia a gravação final na AT (preserva os seus documentos de teste intactos).
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalTermoAberto(false)}
                    className="px-3.5 py-2 rounded-md border border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#132233] text-xs font-mono font-semibold text-foreground cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!termoAceite || kpis.validados_por_submeter === 0}
                    onClick={confirmarESubmeterNaAT}
                    className={`px-4 py-2 rounded-md disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-mono font-bold flex items-center space-x-1.5 cursor-pointer ${
                      isDeveloperUser && modoEnsaioVisivel
                        ? 'bg-[#0284c7] hover:bg-[#0369a1]'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {isDeveloperUser && modoEnsaioVisivel ? (
                      <>
                        <Monitor className="w-4 h-4" />
                        <span>Confirmar Simulação no Browser (Sem Submeter)</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Confirmar e Submeter na AT</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 overflow-y-auto space-y-2">
                {carregandoTermos ? (
                  <div className="py-8 text-center text-xs font-mono text-slate-600 dark:text-slate-300">
                    A carregar histórico...
                  </div>
                ) : historicoTermos.length === 0 ? (
                  <div className="py-8 text-center text-xs font-mono text-slate-600 dark:text-slate-300">
                    Sem registos de submissão anteriores.
                  </div>
                ) : (
                  historicoTermos.map(t => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-foreground">{t.utilizador}</span>
                        <span className="text-slate-600 dark:text-slate-300">{t.timestamp_iso}</span>
                      </div>
                      <div className="font-mono text-[11px] text-[#0284c7] dark:text-sky-400">
                        {t.total_documentos} documento(s) · {t.nifs.length} cliente(s) · SHA-256: {t.resumo_sha256.slice(0, 16)}...
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Gestão de Palavras-Chave */}
      {modalPalavrasAberto && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="relative evo-card-signature flex items-center justify-between px-5 py-3.5 border-b border-[#d7e0ea] dark:border-[#222f3e]">
              <div className="flex items-center space-x-2">
                <Tags className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <h3 className="font-display font-semibold text-sm text-foreground">
                  Palavras-Chave de Pré-Classificação
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalPalavrasAberto(false)}
                className="text-slate-500 hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={novaPalavra}
                onChange={e => setNovaPalavra(e.target.value)}
                placeholder="Nome / palavra no fornecedor..."
                className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground"
              />
              <select
                value={novoSetorKw}
                onChange={e => setNovoSetorKw(e.target.value)}
                className="px-2 py-1.5 text-xs font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground"
              >
                {setores.map(s => (
                  <option key={s.codigo} value={s.codigo}>
                    {s.codigo} · {s.nome_curto}
                  </option>
                ))}
              </select>
              <select
                value={novoAmbitoKw}
                onChange={e => setNovoAmbitoKw(e.target.value)}
                className="px-2 py-1.5 text-xs font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground"
              >
                <option value="">Âmbito automático</option>
                {ambitos.map(a => (
                  <option key={a.codigo} value={a.codigo}>
                    {a.nome_curto}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={salvandoKw || !novaPalavra.trim()}
                onClick={adicionarPalavraChave}
                className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-40 text-white text-xs font-mono font-bold flex items-center space-x-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#d7e0ea] dark:divide-[#222f3e]">
              {palavrasChave.map(kw => (
                <div
                  key={kw.id}
                  className="flex items-center justify-between px-4 py-2 text-xs hover:bg-slate-50 dark:hover:bg-[#13202e]"
                >
                  <div className="flex items-center space-x-3">
                    <span className="font-mono font-bold text-foreground">{kw.palavra}</span>
                    <span className="px-2 py-0.5 rounded bg-[#f0f9ff] dark:bg-[#0a1929] border border-sky-200 dark:border-sky-800 font-mono text-[10.5px] text-[#0284c7] dark:text-sky-300">
                      {kw.setor_codigo} · {setores.find(s => s.codigo === kw.setor_codigo)?.nome_curto || kw.setor_codigo}
                    </span>
                    {kw.ambito_codigo && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] font-mono text-[10.5px] text-slate-700 dark:text-slate-300">
                        {ambitos.find(a => a.codigo === kw.ambito_codigo)?.nome_curto || kw.ambito_codigo}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removerPalavraChave(kw.id)}
                    className="text-slate-500 hover:text-rose-600 cursor-pointer"
                    title="Remover palavra-chave"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Janela do Browser AT em Direto (Ensaio Visual - Só Programador) */}
      {modalEnsaioAberto && ensaioState && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3">
          <div className="w-full max-w-6xl h-[92vh] bg-white dark:bg-[#0c1520] border-2 border-[#0284c7] dark:border-sky-600 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Barra de Título do Browser Simulado */}
            <div className="relative evo-card-signature px-4 py-2.5 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <Monitor className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <span className="font-display font-semibold text-sm text-foreground truncate">
                  Simulação Visual no Portal das Finanças (Modo Programador)
                </span>
                <span className="px-2 py-0.5 rounded bg-[#0284c7] text-white text-[10px] font-mono font-bold shrink-0 flex items-center space-x-1">
                  <Lock className="w-3 h-3" />
                  <span>SUBMISSÃO BLOQUEADA · ZERO ALTERAÇÕES NA AT</span>
                </span>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {ensaioState.ensaioPaginasB64.length > 0 && (
                  <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded px-1.5 py-0.5 text-[11px] font-mono">
                    {ensaioState.ensaioPaginasB64.map((pg, idx) => (
                      <button
                        key={`${pg.nif_cliente}_${pg.pagina}_${idx}`}
                        type="button"
                        onClick={() => setPaginaEnsaioAtiva(idx)}
                        className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                          paginaEnsaioAtiva === idx
                            ? 'bg-[#0284c7] text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#132233]'
                        }`}
                      >
                        Pág. {pg.pagina} ({pg.preenchidos})
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPaginaEnsaioAtiva(-1)}
                      className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                        paginaEnsaioAtiva === -1
                          ? 'bg-[#0284c7] text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#132233]'
                      }`}
                    >
                      Em Direto
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setZoomRealEnsaio(prev => !prev)}
                  className="px-2.5 py-1 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] text-[11px] font-mono font-semibold text-foreground flex items-center space-x-1 cursor-pointer"
                >
                  {zoomRealEnsaio ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                  <span>{zoomRealEnsaio ? 'Ajustar' : 'Zoom 100%'}</span>
                </button>

                {['em_progresso', 'iniciado'].includes(ensaioState.status) && (
                  <button
                    type="button"
                    onClick={pararEnsaioVisual}
                    className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-mono font-bold flex items-center space-x-1 cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Parar</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setModalEnsaioAberto(false)}
                  className="px-2.5 py-1 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] text-[11px] font-mono font-bold text-foreground cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Barra de Endereço e Estado do Ensaio */}
            <div className="px-4 py-2 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] flex flex-wrap items-center justify-between gap-2 text-xs font-mono shrink-0">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] text-[#0284c7] dark:text-sky-400 font-bold truncate max-w-full">
                  {ensaioState.ensaioUrl}
                </span>
                <span className="text-slate-700 dark:text-slate-200 truncate">
                  {ensaioState.ensaioPassoAtual}
                </span>
              </div>
              <div className="flex items-center space-x-2 shrink-0 tabular-nums">
                {['em_progresso', 'iniciado'].includes(ensaioState.status) && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0284c7]" />
                )}
                <span className="font-bold text-[#0284c7] dark:text-sky-300">
                  {ensaioState.docsAtuais}/{ensaioState.totalEsperado} ({ensaioState.percentagem}%)
                </span>
              </div>
            </div>

            {ensaioState.janelaNativaAberta && (
              <div className="px-4 py-1.5 bg-[#f0fdf4] dark:bg-[#091e1a] border-b border-emerald-300 dark:border-emerald-800 text-[11px] font-mono font-semibold text-emerald-900 dark:text-emerald-200 shrink-0">
                Janela real do Chrome/Edge aberta em primeiro plano no computador. Pode confirmar visualmente lá e fechar o navegador quando terminar.
              </div>
            )}

            {/* Visor do Ecrã Real do Portal das Finanças */}
            <div className="flex-1 min-h-0 overflow-auto bg-[#07121c] p-3 flex justify-center items-start">
              {(() => {
                const imgAtiva =
                  paginaEnsaioAtiva >= 0 && ensaioState.ensaioPaginasB64[paginaEnsaioAtiva]
                    ? ensaioState.ensaioPaginasB64[paginaEnsaioAtiva].img_b64
                    : ensaioState.ensaioFrameB64;

                if (!imgAtiva) {
                  return (
                    <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-slate-200 font-mono text-xs space-y-2">
                      {ensaioState.status === 'erro' ? (
                        <>
                          <AlertTriangle className="w-7 h-7 text-rose-400" />
                          <span className="text-rose-300 font-bold">{ensaioState.erro || ensaioState.mensagem}</span>
                        </>
                      ) : (
                        <>
                          <Loader2 className="w-7 h-7 animate-spin text-sky-400" />
                          <span>A iniciar sessão no Portal das Finanças e a carregar lista de pendentes...</span>
                        </>
                      )}
                    </div>
                  );
                }

                return (
                  <img
                    src={`data:image/jpeg;base64,${imgAtiva}`}
                    alt="Ecrã simulado no Portal das Finanças"
                    className={`rounded border border-[#222f3e] shadow-2xl ${
                      zoomRealEnsaio ? 'max-w-none w-auto' : 'max-w-full h-auto'
                    }`}
                  />
                );
              })()}
            </div>

            {/* Resumo Inferior das Linhas Testadas */}
            {ensaioState.ensaioItens.length > 0 && (
              <div className="max-h-40 overflow-auto border-t border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] shrink-0">
                <table className="w-full text-left border-collapse text-[11px] font-mono">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-[#101c2b] border-b border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200">
                    <tr>
                      <th className="px-3 py-1.5">Cliente</th>
                      <th className="px-3 py-1.5">Fornecedor</th>
                      <th className="px-3 py-1.5">Documento</th>
                      <th className="px-3 py-1.5">Setor Aplicado</th>
                      <th className="px-3 py-1.5">Âmbito</th>
                      <th className="px-3 py-1.5">Resultado Visual AT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#d7e0ea] dark:divide-[#222f3e]">
                    {ensaioState.ensaioItens.map((it, i) => (
                      <tr key={`${it.nif_cliente}_${it.id_documento}_${i}`} className="bg-white dark:bg-[#0c1520]">
                        <td className="px-3 py-1">{ofuscarNif(it.nif_cliente)}</td>
                        <td className="px-3 py-1 truncate max-w-[200px] font-sans">{ofuscarNome(it.nome_emitente, it.nif_cliente)}</td>
                        <td className="px-3 py-1">{it.numero_documento}</td>
                        <td className="px-3 py-1 font-bold text-[#0284c7] dark:text-sky-300">{it.setor_codigo}</td>
                        <td className="px-3 py-1">{ambitos.find(a => a.codigo === it.ambito_codigo)?.nome_curto || it.ambito_codigo}</td>
                        <td className="px-3 py-1">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                              it.preenchido_ecra
                                ? 'bg-[#f0fdf4] dark:bg-[#091e1a] border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                                : 'bg-[#fffbeb] dark:bg-[#241a08] border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                            }`}
                          >
                            {it.detalhe}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
