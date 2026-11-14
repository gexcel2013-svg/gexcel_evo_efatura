import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  RotateCcw,
  Loader2,
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileX2,
  Layers,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  TrendingUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { EmpresaSelectorCombobox } from './EmpresaSelectorCombobox';

interface Entidade {
  id: string;
  cod?: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
  tem_credenciais_at?: boolean;
}

interface AnuladaRow {
  id_fatura_unico: string;
  modulo: 'compras' | 'vendas';
  nif_cliente: string;
  nome_cliente: string;
  contraparte_nif: string;
  contraparte_nome: string;
  tipo_doc: string;
  fatura: string;
  atcud: string;
  data_emissao: string;
  total_liquido: number;
  total_iva: number;
  total_doc: number;
  is_inconformidade: boolean;
  origem_anulacao: 'inconformidade_forense' | 'anulado_origem';
  estado_anterior: string;
  estado_atual: string;
  data_deteccao: string;
}

const MESES_NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface InconformidadesViewProps {
  ano?: number;
  onAnoChange?: (ano: number) => void;
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

export function InconformidadesView({
  ano: anoProp,
  onAnoChange,
  onApiStatusChange,
  modoPrivacidade = false,
}: InconformidadesViewProps) {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;
  const [anoLocal, setAnoLocal] = useState<number>(anoProp ?? anoAtual);
  const anoAtivo = anoProp ?? anoLocal;

  const atualizarAno = useCallback(
    (novoAno: number) => {
      setAnoLocal(novoAno);
      onAnoChange?.(novoAno);
      setScrapeAno(novoAno);
    },
    [onAnoChange]
  );

  const [anuladas, setAnuladas] = useState<AnuladaRow[]>([]);
  const [totalFiltrado, setTotalFiltrado] = useState<number>(0);
  const [totalGlobal, setTotalGlobal] = useState<number>(0);
  const [totalInconfs, setTotalInconfs] = useState<number>(0);
  const [totalOrigem, setTotalOrigem] = useState<number>(0);
  const [somaLiquido, setSomaLiquido] = useState<number>(0);
  const [somaIva, setSomaIva] = useState<number>(0);
  const [somaTotal, setSomaTotal] = useState<number>(0);
  const [totalLedger, setTotalLedger] = useState<number>(0);

  const [carregando, setCarregando] = useState<boolean>(false);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [nifFiltro, setNifFiltro] = useState<string>('');
  const [moduloFiltro, setModuloFiltro] = useState<'todos' | 'compras' | 'vendas'>('todos');
  const [origemFiltro, setOrigemFiltro] = useState<'todos' | 'inconformidades' | 'origem'>('todos');
  const [filtroTemporal, setFiltroTemporal] = useState<'todas' | 'ano_todo' | 'mes' | 'trimestre' | 'manual'>('todas');
  const [mesAtivo, setMesAtivo] = useState<number>(0);
  const [trimestreAtivo, setTrimestreAtivo] = useState<number | null>(null);
  const [dataInicio, setDataInicio] = useState<string>('');
  const [dataFim, setDataFim] = useState<string>('');
  const [pesquisa, setPesquisa] = useState<string>('');

  // Ordenação Universal da Tabela
  const [sortCol, setSortCol] = useState<string>('data_emissao');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Modal de Sincronização de Anulados na AT (Individual ou Lote)
  const [modalScrapeAberto, setModalScrapeAberto] = useState<boolean>(false);
  const [modoSync, setModoSync] = useState<'individual' | 'lote'>('individual');
  const [scrapeNif, setScrapeNif] = useState<string>('');
  const [scrapeModulo, setScrapeModulo] = useState<'compras' | 'vendas' | 'ambos'>('compras');
  const [scrapeAno, setScrapeAno] = useState<number>(anoAtivo);
  const [scrapeMes, setScrapeMes] = useState<number>(0); // 0 = Ano completo
  const [scrapeExecutando, setScrapeExecutando] = useState<boolean>(false);
  const [scrapeResultado, setScrapeResultado] = useState<any | null>(null);
  const [scrapeErro, setScrapeErro] = useState<string | null>(null);

  useEffect(() => {
    if (anoProp !== undefined) {
      setAnoLocal(anoProp);
    }
  }, [anoProp]);

  useEffect(() => {
    if (filtroTemporal === 'todas') {
      setDataInicio('');
      setDataFim('');
    } else if (filtroTemporal === 'ano_todo') {
      setDataInicio(`${anoAtivo}-01-01`);
      setDataFim(`${anoAtivo}-12-31`);
    } else if (filtroTemporal === 'mes' && mesAtivo > 0) {
      const ultimoDia = new Date(anoAtivo, mesAtivo, 0).getDate();
      setDataInicio(`${anoAtivo}-${String(mesAtivo).padStart(2, '0')}-01`);
      setDataFim(`${anoAtivo}-${String(mesAtivo).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`);
    } else if (filtroTemporal === 'trimestre' && trimestreAtivo) {
      const mIni = (trimestreAtivo - 1) * 3 + 1;
      const mFim = trimestreAtivo * 3;
      const ultimoDia = new Date(anoAtivo, mFim, 0).getDate();
      setDataInicio(`${anoAtivo}-${String(mIni).padStart(2, '0')}-01`);
      setDataFim(`${anoAtivo}-${String(mFim).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`);
    }
  }, [anoAtivo, filtroTemporal, mesAtivo, trimestreAtivo]);

  const mapaEntidades = useMemo(() => {
    const map = new Map<string, string>();
    for (const ent of entidades) {
      const n = (ent.nif || '').trim();
      const ncc = (ent.nif_cc || '').trim();
      if (n && ent.nomecli) map.set(n, ent.nomecli);
      if (ncc && ent.nomecli) map.set(ncc, ent.nomecli);
    }
    return map;
  }, [entidades]);

  const resolverNomeEntidade = useCallback(
    (nif: string, fallback?: string) => {
      const n = (nif || '').trim();
      const oficial = mapaEntidades.get(n);
      if (oficial) return oficial;
      const fb = (fallback || '').trim();
      if (fb && fb !== '[Sem Nome Registado]') return fb;
      return n ? `Entidade ${n}` : '—';
    },
    [mapaEntidades]
  );

  const entidadesCombobox = useMemo(
    () =>
      entidades.map(ent => ({
        id: ent.id,
        cod: ent.cod,
        nif: (ent.nif || ent.nif_cc || '').trim(),
        nif_cc: ent.nif_cc,
        nomecli: ent.nomecli,
      })),
    [entidades]
  );

  const selecionarTodasDatas = () => {
    setFiltroTemporal('todas');
    setMesAtivo(0);
    setTrimestreAtivo(null);
  };

  const selecionarAnoTodo = () => {
    setFiltroTemporal('ano_todo');
    setMesAtivo(0);
    setTrimestreAtivo(null);
  };

  const selecionarMesAtual = () => {
    if (anoAtivo !== anoAtual) atualizarAno(anoAtual);
    setFiltroTemporal('mes');
    setMesAtivo(mesAtual);
    setTrimestreAtivo(null);
  };

  const selecionarMes = (m: number) => {
    setFiltroTemporal('mes');
    setMesAtivo(m);
    setTrimestreAtivo(null);
  };

  const selecionarTrimestre = (t: number) => {
    setFiltroTemporal('trimestre');
    setTrimestreAtivo(t);
    setMesAtivo(0);
  };

  // Monitorização do Worker de Segundo Plano (scrape_anuladas em pipeline_worker)
  const [tarefaWorkerAnuladas, setTarefaWorkerAnuladas] = useState<{
    nif: string;
    modulo?: string;
    data_inicio?: string;
    data_fim?: string;
  } | null>(null);
  const prevWorkerAnuladasRef = useRef<boolean>(false);

  const formatarMoeda = (val: number) =>
    (val || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ofuscarNome = (nome: string, nif: string) => {
    if (!modoPrivacidade) return nome;
    return `Entidade Demo ${(nif || '0000').slice(-4)}, Lda`;
  };

  const ofuscarNif = (nif: string) => {
    if (!modoPrivacidade || !nif) return nif;
    return `599${nif.slice(3)}`;
  };

  // Carregar lista de entidades
  useEffect(() => {
    let cancel = false;
    async function carregarEntidades() {
      try {
        const res = await fetch('http://127.0.0.1:8015/api/entidades');
        if (res.ok) {
          const data = await res.json();
          if (!cancel && data.entidades) {
            setEntidades(data.entidades);
            if (data.entidades.length > 0 && !scrapeNif) {
              setScrapeNif((data.entidades[0].nif || data.entidades[0].nif_cc || '').trim());
            }
          }
        }
      } catch {}
    }
    carregarEntidades();
    return () => {
      cancel = true;
    };
  }, [scrapeNif]);

  // Carregar dados unificados de anulados e inconformidades
  const carregarAnuladas = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (nifFiltro) params.set('nif', nifFiltro);
      if (moduloFiltro !== 'todos') params.set('modulo', moduloFiltro);
      params.set('filtro_origem', origemFiltro);
      if (dataInicio) params.set('data_inicio', dataInicio);
      if (dataFim) params.set('data_fim', dataFim);
      if (pesquisa.trim()) params.set('pesquisa', pesquisa.trim());
      params.set('ordenar_por', sortCol);
      params.set('ordem', sortDir);
      params.set('limite', '500');

      const [resAnul, resCofre] = await Promise.all([
        fetch(`http://127.0.0.1:8015/api/anuladas?${params.toString()}`),
        fetch('http://127.0.0.1:8015/api/efatura/inconformidades'),
      ]);

      if (resCofre.ok) {
        const dataCofre = await resCofre.json();
        setTotalLedger(dataCofre.total_faturas_registadas_ledger || 0);
      }

      if (resAnul.ok) {
        const data = await resAnul.json();
        setAnuladas(data.anuladas || []);
        setTotalFiltrado(data.total || 0);
        setTotalGlobal(data.total_anuladas_global || 0);
        setTotalInconfs(data.total_inconformidades || 0);
        setTotalOrigem(data.total_anuladas_origem || 0);
        setSomaLiquido(data.soma_liquido || 0);
        setSomaIva(data.soma_iva || 0);
        setSomaTotal(data.soma_total || 0);
        onApiStatusChange?.(true);
      } else {
        const errJson = await resAnul.json();
        setErro(errJson.detail || 'Erro ao consultar documentos anulados.');
      }
    } catch (err: any) {
      setErro(err.message || 'Sem ligação ao motor local (:8015)');
      onApiStatusChange?.(false);
    } finally {
      setCarregando(false);
    }
  }, [nifFiltro, moduloFiltro, origemFiltro, dataInicio, dataFim, pesquisa, sortCol, sortDir, onApiStatusChange]);

  useEffect(() => {
    carregarAnuladas();
  }, [carregarAnuladas]);

  // Monitorização em tempo real do Worker de Segundo Plano para tarefas de anuladas
  useEffect(() => {
    const verificarWorker = async () => {
      try {
        const res = await fetch('http://127.0.0.1:8015/api/pipeline/status', { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json();
          const ativa = data.tarefa_atual;
          const isAnuladas = Boolean(ativa && ativa.tipo_tarefa === 'scrape_anuladas');
          setTarefaWorkerAnuladas(isAnuladas ? ativa : null);

          if (prevWorkerAnuladasRef.current && !isAnuladas) {
            carregarAnuladas();
          }
          prevWorkerAnuladasRef.current = isAnuladas;
        }
      } catch {}
    };

    verificarWorker();
    const interval = setInterval(verificarWorker, 4000);
    return () => clearInterval(interval);
  }, [carregarAnuladas]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const renderSortIcon = (col: string) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500 ml-1 inline shrink-0" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />
      : <ArrowDown className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />;
  };

  const executarSincronizacaoAnuladas = async () => {
    setScrapeExecutando(true);
    setScrapeResultado(null);
    setScrapeErro(null);

    try {
      if (modoSync === 'lote') {
        const res = await fetch('http://127.0.0.1:8015/api/anuladas/sincronizar-lote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nifs: scrapeNif ? [scrapeNif] : ['TODOS'],
            ano: scrapeAno,
            mes: scrapeMes > 0 ? scrapeMes : null,
            modulo: scrapeModulo,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setScrapeResultado(json);
          carregarAnuladas();
        } else {
          const errJson = await res.json();
          setScrapeErro(errJson.detail || 'Erro ao agendar sincronização em lote.');
        }
      } else {
        if (!scrapeNif) {
          setScrapeErro('Selecione uma empresa.');
          setScrapeExecutando(false);
          return;
        }
        const payload: Record<string, any> = {
          nif: scrapeNif,
          modulo: scrapeModulo === 'ambos' ? 'compras' : scrapeModulo,
          ano: scrapeAno,
          gravar_db: true,
          canal: 'auto',
          threads: 6,
        };
        if (scrapeMes > 0) payload.mes = scrapeMes;

        const res = await fetch('http://127.0.0.1:8015/api/efatura/scrape/anuladas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          setScrapeResultado(json);
          carregarAnuladas();
        } else {
          const errJson = await res.json();
          setScrapeErro(errJson.detail || 'Erro durante a extração de anuladas.');
        }
      }
    } catch (e: any) {
      setScrapeErro(e.message || 'Falha na comunicação com o motor.');
    } finally {
      setScrapeExecutando(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0 select-none overflow-y-auto md:overflow-hidden">
      {/* 1. Cabeçalho Executivo evoGex.com */}
      <header className="flex flex-wrap justify-between items-center gap-2 shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <span className="page-kicker text-slate-600 dark:text-slate-400 font-mono">
              AUDITORIA FORENSE & CONTROLO DE DOCUMENTOS CANCELADOS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          </div>
          <h1 className="text-xl text-foreground font-display font-light tracking-tight flex items-center flex-wrap gap-2 mt-0.5">
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
            <span>Documentos Anulados e Inconformidades</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-700 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
              {filtroTemporal === 'todas' ? 'Todos os Exercícios' : `Exercício ${anoAtivo}`}
            </span>
          </h1>
        </div>

        {/* Ações do Topo */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Exercício (< Ano >) */}
          <div className="flex items-center space-x-1 bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-500 rounded-md px-2 py-1 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
            <button
              type="button"
              onClick={() => atualizarAno(anoAtivo - 1)}
              className="p-0.5 hover:bg-sky-200 dark:hover:bg-[#14304d] rounded text-foreground transition-colors cursor-pointer"
              title="Exercício Anterior"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono font-bold text-xs text-foreground dark:text-white px-1 min-w-[38px] text-center">
              {anoAtivo}
            </span>
            <button
              type="button"
              onClick={() => atualizarAno(anoAtivo < anoAtual ? anoAtivo + 1 : anoAtivo)}
              disabled={anoAtivo >= anoAtual}
              className={`p-0.5 rounded transition-colors ${
                anoAtivo >= anoAtual
                  ? 'opacity-25 cursor-not-allowed text-slate-400'
                  : 'hover:bg-sky-200 dark:hover:bg-[#14304d] text-foreground cursor-pointer'
              }`}
              title="Exercício Seguinte"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setModalScrapeAberto(true)}
            className="px-3 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Sincronizar Anulados na AT</span>
          </button>

          <button
            type="button"
            onClick={() => carregarAnuladas()}
            disabled={carregando}
            className="px-3 py-1.5 rounded-md border border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#152334] text-foreground font-mono text-xs font-semibold shadow-2xs flex items-center space-x-1.5 cursor-pointer transition"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin text-[#0284c7]' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* 2. Cartões KPI 100% Opacos Sólidos (gexcel-evo-design) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 shrink-0">
        {/* Card 1: Total de Documentos Anulados */}
        <div
          onClick={() => setOrigemFiltro('todos')}
          className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0284c7] transition before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-rose-500 before:z-20"
        >
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
              Total Documentos Anulados
            </span>
            <div className="flex items-baseline space-x-1.5 mt-0.5">
              <span className="text-lg font-mono font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                {totalGlobal.toLocaleString('pt-PT')}
              </span>
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">faturas</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-[#240e14] border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-700 dark:text-rose-400 shrink-0">
            <FileX2 className="w-4 h-4" />
          </div>
        </div>

        {/* Card 2: Inconformidades Forenses (N -> A) */}
        <div
          onClick={() => setOrigemFiltro('inconformidades')}
          className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0284c7] transition before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-amber-500 before:z-20"
        >
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
              Anulações Tardias (N → A)
            </span>
            <div className="flex items-baseline space-x-1.5 mt-0.5">
              <span className="text-lg font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                {totalInconfs.toLocaleString('pt-PT')}
              </span>
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">detetadas</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-[#231a09] border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        {/* Card 3: Anulados na Origem (A) */}
        <div
          onClick={() => setOrigemFiltro('origem')}
          className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0284c7] transition before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20"
        >
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
              Anulados na Origem (AT)
            </span>
            <div className="flex items-baseline space-x-1.5 mt-0.5">
              <span className="text-lg font-mono font-bold text-[#0284c7] dark:text-sky-400 tabular-nums">
                {totalOrigem.toLocaleString('pt-PT')}
              </span>
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                Ledger: {totalLedger.toLocaleString('pt-PT')}
              </span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-[#0a1929] border border-sky-200 dark:border-sky-800 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
            <Database className="w-4 h-4" />
          </div>
        </div>

        {/* Card 4: Impacto Financeiro Total */}
        <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20">
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
              Montante Total Anulado
            </span>
            <div className="flex items-baseline space-x-2 mt-0.5">
              <span className="text-lg font-mono font-bold text-foreground tabular-nums">
                {formatarMoeda(somaTotal)} €
              </span>
              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300" title={`Base s/ IVA: ${formatarMoeda(somaLiquido)} €`}>
                IVA: {formatarMoeda(somaIva)} €
              </span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-[#091e1a] border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Banner Opaco de Execução em Segundo Plano do Worker */}
      {tarefaWorkerAnuladas && (
        <div className="bg-sky-50 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-700 rounded-md p-2.5 flex items-center justify-between text-xs font-mono text-slate-800 dark:text-slate-200 shrink-0">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#0284c7] dark:text-sky-400 shrink-0" />
            <span>
              <strong>Sincronização em Segundo Plano:</strong> A extrair documentos anulados para NIF {ofuscarNif(tarefaWorkerAnuladas.nif)} ({tarefaWorkerAnuladas.modulo?.toUpperCase() || 'COMPRAS'}) · Período: {tarefaWorkerAnuladas.data_inicio} a {tarefaWorkerAnuladas.data_fim}
            </span>
          </div>
          <span className="text-[10px] bg-[#0284c7] text-white px-2 py-0.5 rounded font-bold">
            Em Curso
          </span>
        </div>
      )}

      {/* 3. Barra de Filtros e Pesquisa */}
      <div className="bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          {/* Filtro de Origem */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52] text-xs font-mono">
            <button
              type="button"
              onClick={() => setOrigemFiltro('todos')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                origemFiltro === 'todos' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Todos ({totalGlobal})
            </button>
            <button
              type="button"
              onClick={() => setOrigemFiltro('inconformidades')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                origemFiltro === 'inconformidades' ? 'bg-amber-600 text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Tardias N → A ({totalInconfs})
            </button>
            <button
              type="button"
              onClick={() => setOrigemFiltro('origem')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                origemFiltro === 'origem' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Anulados Origem ({totalOrigem})
            </button>
          </div>

          {/* Filtro Módulo (Compras / Vendas) */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52] text-xs font-mono">
            <button
              type="button"
              onClick={() => setModuloFiltro('todos')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer transition ${
                moduloFiltro === 'todos' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Compras & Vendas
            </button>
            <button
              type="button"
              onClick={() => setModuloFiltro('compras')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-1 transition ${
                moduloFiltro === 'compras' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <ShoppingCart className="w-3 h-3" />
              <span>Compras</span>
            </button>
            <button
              type="button"
              onClick={() => setModuloFiltro('vendas')}
              className={`px-2 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-1 transition ${
                moduloFiltro === 'vendas' ? 'bg-emerald-600 text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              <span>Vendas</span>
            </button>
          </div>

          {/* Seletor de Empresa (Combobox com seleção prévia) */}
          <EmpresaSelectorCombobox
            entidades={entidadesCombobox}
            value={nifFiltro}
            onChange={setNifFiltro}
            modoPrivacidade={modoPrivacidade}
            allLabel={`Todas as Empresas (${entidadesCombobox.length})`}
            placeholder="Pesquisar NIF, nome ou código..."
            className="w-full sm:w-auto sm:min-w-[240px] max-w-full sm:max-w-[320px]"
            dropdownClassName="w-80 md:w-[400px]"
            align="left"
            title="Pesquisar e selecionar empresa"
          />

          {/* Pesquisa */}
          <div className="relative w-full sm:w-auto sm:min-w-[200px] flex-1 max-w-full sm:max-w-[280px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Pesquisar fatura, ATCUD, NIF ou nome..."
              value={pesquisa}
              onChange={e => setPesquisa(e.target.value)}
              className="w-full text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded pl-8 pr-6 py-1 text-foreground"
            />
            {pesquisa && (
              <button
                type="button"
                onClick={() => setPesquisa('')}
                className="absolute right-2 top-2 text-slate-500 hover:text-foreground cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="text-xs font-mono text-slate-600 dark:text-slate-300 font-semibold">
          {anuladas.length.toLocaleString('pt-PT')} de {totalFiltrado.toLocaleString('pt-PT')} registos
        </div>

        {/* Barra Temporal Padronizada */}
        <div className="w-full flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200 dark:border-[#1e2c3d] text-[10.5px] font-mono">
          <div className="flex items-center space-x-1 bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-700 rounded px-1.5 py-0.5 mr-1">
            <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <button
              type="button"
              onClick={() => {
                atualizarAno(anoAtivo - 1);
                if (filtroTemporal === 'todas') setFiltroTemporal('ano_todo');
              }}
              className="p-0.5 hover:bg-sky-200 dark:hover:bg-[#14304d] rounded cursor-pointer"
              title="Exercício Anterior"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="font-bold text-foreground px-0.5">{anoAtivo}</span>
            <button
              type="button"
              onClick={() => {
                if (anoAtivo < anoAtual) {
                  atualizarAno(anoAtivo + 1);
                  if (filtroTemporal === 'todas') setFiltroTemporal('ano_todo');
                }
              }}
              disabled={anoAtivo >= anoAtual}
              className={`p-0.5 rounded ${anoAtivo >= anoAtual ? 'opacity-25 cursor-not-allowed' : 'hover:bg-sky-200 dark:hover:bg-[#14304d] cursor-pointer'}`}
              title="Exercício Seguinte"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={selecionarTodasDatas}
            className={`px-2 py-1 rounded border font-semibold cursor-pointer transition ${
              filtroTemporal === 'todas'
                ? 'bg-[#0284c7] text-white border-[#0284c7]'
                : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
            }`}
          >
            Todas as Datas
          </button>

          <button
            type="button"
            onClick={selecionarAnoTodo}
            className={`px-2 py-1 rounded border font-semibold cursor-pointer transition ${
              filtroTemporal === 'ano_todo'
                ? 'bg-[#0284c7] text-white border-[#0284c7]'
                : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
            }`}
          >
            Ano Todo
          </button>

          {anoAtivo === anoAtual && (
            <button
              type="button"
              onClick={selecionarMesAtual}
              className={`px-2 py-1 rounded border font-semibold cursor-pointer transition ${
                filtroTemporal === 'mes' && mesAtivo === mesAtual
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
              }`}
            >
              Mês Atual
            </button>
          )}

          <div className="flex items-center space-x-0.5 border-l border-slate-300 dark:border-[#253a52] pl-1.5">
            {[1, 2, 3, 4].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => selecionarTrimestre(t)}
                className={`px-1.5 py-1 rounded border font-bold cursor-pointer transition ${
                  filtroTemporal === 'trimestre' && trimestreAtivo === t
                    ? 'bg-[#0284c7] text-white border-[#0284c7]'
                    : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                }`}
                title={`${t}º Trimestre de ${anoAtivo}`}
              >
                T{t}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-0.5 border-l border-slate-300 dark:border-[#253a52] pl-1.5">
            {MESES_NOMES.map((mNome, idx) => {
              const mNum = idx + 1;
              const ativo = filtroTemporal === 'mes' && mesAtivo === mNum;
              return (
                <button
                  key={mNum}
                  type="button"
                  onClick={() => selecionarMes(mNum)}
                  className={`px-1.5 py-1 rounded border font-semibold cursor-pointer transition ${
                    ativo
                      ? 'bg-[#0284c7] text-white border-[#0284c7]'
                      : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                  }`}
                >
                  {mNome}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1 sm:ml-auto sm:border-l border-slate-300 dark:border-[#253a52] sm:pl-2">
            <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="date"
              value={dataInicio}
              onChange={e => {
                setDataInicio(e.target.value);
                setFiltroTemporal('manual');
                setMesAtivo(0);
                setTrimestreAtivo(null);
              }}
              className="text-[11px] font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-1.5 py-0.5 text-foreground cursor-pointer"
              title="Data de Emissão Inicial"
            />
            <span className="text-slate-400">—</span>
            <input
              type="date"
              value={dataFim}
              onChange={e => {
                setDataFim(e.target.value);
                setFiltroTemporal('manual');
                setMesAtivo(0);
                setTrimestreAtivo(null);
              }}
              className="text-[11px] font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-1.5 py-0.5 text-foreground cursor-pointer"
              title="Data de Emissão Final"
            />
          </div>
        </div>
      </div>

      {/* 4. Tabela de Documentos Anulados e Inconformidades */}
      <div className="flex-1 min-h-[380px] md:min-h-0 bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs overflow-hidden flex flex-col relative">
        <div className="relative evo-card-signature flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] shrink-0 before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">
              Registos de Anulação e Inconformidades
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-mono font-bold text-foreground tabular-nums">
              {anuladas.length.toLocaleString('pt-PT')} / {totalFiltrado.toLocaleString('pt-PT')}
            </span>
            {nifFiltro ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-600 text-[11px] font-mono text-[#0284c7] dark:text-sky-300 font-bold">
                <span>{ofuscarNif(nifFiltro)}</span>
                <span>·</span>
                <span className="font-sans truncate max-w-[260px]">
                  {ofuscarNome(resolverNomeEntidade(nifFiltro), nifFiltro)}
                </span>
                <button
                  type="button"
                  onClick={() => setNifFiltro('')}
                  title="Limpar filtro de empresa"
                  className="ml-1 hover:opacity-75 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : (
              <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                Todas as Empresas ({entidadesCombobox.length})
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
            Total Anulado: <strong className="text-foreground">{formatarMoeda(somaTotal)} €</strong>
          </div>
        </div>

        {carregando && (
          <div className="absolute inset-0 bg-white dark:bg-[#0c1520] flex items-center justify-center z-30">
            <div className="flex items-center space-x-2 px-4 py-2 rounded-md bg-slate-100 dark:bg-[#132233] border border-[#d7e0ea] dark:border-[#222f3e] shadow-md">
              <Loader2 className="w-4 h-4 animate-spin text-[#0284c7]" />
              <span className="text-xs font-mono font-semibold text-foreground">A carregar documentos anulados...</span>
            </div>
          </div>
        )}

        {erro ? (
          <div className="p-6 text-center text-xs font-mono text-rose-600 dark:text-rose-400 space-y-2">
            <AlertTriangle className="w-6 h-6 mx-auto" />
            <p className="font-bold">Erro ao consultar documentos anulados</p>
            <p className="text-slate-600 dark:text-slate-300">{erro}</p>
          </div>
        ) : anuladas.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-[#091e1a] border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="font-display font-light text-base text-foreground mb-1">
              Nenhum Documento Anulado para os Filtros Selecionados
            </h3>
            <p className="font-mono text-xs text-slate-600 dark:text-slate-300 max-w-md leading-relaxed">
              {totalLedger > 0
                ? `${totalLedger.toLocaleString('pt-PT')} documentos verificados no Cofre de Estados.`
                : 'Utilize o botão Sincronizar Anulados na AT para recolher documentos cancelados diretamente do Portal das Finanças.'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-100 dark:bg-[#132233] border-b border-[#d7e0ea] dark:border-[#222f3e] z-20">
                <tr className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 select-none">
                  <th onClick={() => handleSort('data_emissao')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Data Emissão {renderSortIcon('data_emissao')}
                  </th>
                  <th onClick={() => handleSort('modulo')} className="py-2 px-2 text-center cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Módulo {renderSortIcon('modulo')}
                  </th>
                  <th onClick={() => handleSort('tipo_doc')} className="py-2 px-2.5 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Tipo {renderSortIcon('tipo_doc')}
                  </th>
                  <th onClick={() => handleSort('fatura')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Nº Documento / ATCUD {renderSortIcon('fatura')}
                  </th>
                  <th onClick={() => handleSort('nif_cliente')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7]">
                    Empresa Nossa {renderSortIcon('nif_cliente')}
                  </th>
                  <th onClick={() => handleSort('contraparte_nome')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7]">
                    Contraparte (Emitente / Adquirente) {renderSortIcon('contraparte_nome')}
                  </th>
                  <th onClick={() => handleSort('total_liquido')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Base (€) {renderSortIcon('total_liquido')}
                  </th>
                  <th onClick={() => handleSort('total_iva')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    IVA (€) {renderSortIcon('total_iva')}
                  </th>
                  <th onClick={() => handleSort('total_doc')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Total (€) {renderSortIcon('total_doc')}
                  </th>
                  <th onClick={() => handleSort('origem_anulacao')} className="py-2 px-3 text-center cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Classificação {renderSortIcon('origem_anulacao')}
                  </th>
                  <th onClick={() => handleSort('data_deteccao')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                    Deteção {renderSortIcon('data_deteccao')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d7e0ea] dark:divide-[#1e2c3d] font-mono">
                {anuladas.map((item, idx) => {
                  const isVendas = item.modulo === 'vendas';
                  const isForense = item.is_inconformidade;
                  const nomeEmpresaNossa = resolverNomeEntidade(item.nif_cliente, item.nome_cliente);
                  const nomeContraparte = resolverNomeEntidade(item.contraparte_nif, item.contraparte_nome);

                  return (
                    <tr key={`${item.id_fatura_unico}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#111d2b] transition-colors">
                      <td className="py-2 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {item.data_emissao || '—'}
                      </td>
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                            isVendas
                              ? 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                              : 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-700'
                          }`}
                        >
                          {isVendas ? <TrendingUp className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                          <span>{isVendas ? 'Vendas' : 'Compras'}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300 font-semibold">
                        {item.tipo_doc || 'FT'}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-bold text-foreground" title={item.id_fatura_unico}>
                        <div>{item.fatura}</div>
                        {item.atcud && item.atcud !== '0' && (
                          <div className="text-[10px] font-normal text-slate-500">{item.atcud}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 max-w-[230px]" title={`${item.nif_cliente} · ${nomeEmpresaNossa}`}>
                        <div className="font-bold text-[#0284c7] dark:text-sky-400 text-[11px]">{ofuscarNif(item.nif_cliente)}</div>
                        <div className="text-slate-700 dark:text-slate-300 font-sans text-[11px] font-medium truncate">
                          {ofuscarNome(nomeEmpresaNossa, item.nif_cliente)}
                        </div>
                      </td>
                      <td className="py-2 px-3 max-w-[240px]" title={`${item.contraparte_nif} · ${nomeContraparte}`}>
                        <div className="font-bold text-foreground text-[11px]">{ofuscarNif(item.contraparte_nif || '—')}</div>
                        <div className="text-slate-700 dark:text-slate-200 font-sans text-[11px] truncate">
                          {item.contraparte_nif ? ofuscarNome(nomeContraparte, item.contraparte_nif) : '—'}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatarMoeda(item.total_liquido)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatarMoeda(item.total_iva)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-bold text-foreground tabular-nums whitespace-nowrap">
                        {formatarMoeda(item.total_doc)} €
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        {isForense ? (
                          <span
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-[#231a09] text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                            title="Documento importado inicialmente como Normal (N) e posteriormente anulado (A) no Portal das Finanças"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>TARDIA (N → A)</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-[#240e14] text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700"
                            title="Documento recolhido diretamente no estado Anulado (A) no Portal das Finanças"
                          >
                            <span>ANULADO AT (A)</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                        {(item.data_deteccao || '').slice(0, 16) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Modal Executivo de Sincronização de Anulados na AT */}
      {modalScrapeAberto && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-lg p-5 max-w-lg w-full shadow-2xl space-y-4 before:content-[''] before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
            <div className="flex items-start justify-between border-b border-[#d7e0ea] dark:border-[#222f3e] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
                  PORTAL DAS FINANÇAS · SINCRONIZAÇÃO DE ANULADOS
                </span>
                <h3 className="font-display font-light text-base text-foreground mt-0.5 flex items-center space-x-2">
                  <Play className="w-4 h-4 text-[#0284c7] fill-current" />
                  <span>Sincronizar Faturas Anuladas</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalScrapeAberto(false)}
                disabled={scrapeExecutando}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#1a2c40] text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {/* Modo: Individual vs Lote em 2.º Plano */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52]">
                <button
                  type="button"
                  onClick={() => setModoSync('individual')}
                  className={`py-1.5 rounded font-bold cursor-pointer ${
                    modoSync === 'individual' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Extração Direta (1 Empresa)
                </button>
                <button
                  type="button"
                  onClick={() => setModoSync('lote')}
                  className={`py-1.5 rounded font-bold cursor-pointer ${
                    modoSync === 'lote' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Fila em Lote (2.º Plano)
                </button>
              </div>

              {/* Seleção de Empresa */}
              <div>
                <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Empresa Nossa:
                </label>
                <EmpresaSelectorCombobox
                  entidades={entidadesCombobox}
                  value={scrapeNif}
                  onChange={setScrapeNif}
                  modoPrivacidade={modoPrivacidade}
                  allowAll={modoSync === 'lote'}
                  allLabel="Todas as Empresas com Senha AT"
                  placeholder="Pesquisar NIF, nome ou código..."
                  disabled={scrapeExecutando}
                  className="w-full"
                  dropdownClassName="w-full"
                  align="left"
                  title="Selecionar Empresa para Sincronizar Anulados"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Módulo:
                  </label>
                  <select
                    value={scrapeModulo}
                    onChange={e => setScrapeModulo(e.target.value as any)}
                    disabled={scrapeExecutando}
                    className="w-full bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded p-2 text-foreground cursor-pointer"
                  >
                    <option value="compras">Compras (Adquirente)</option>
                    <option value="vendas">Vendas (Emitente)</option>
                    {modoSync === 'lote' && <option value="ambos">Ambos (Compras + Vendas)</option>}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Período Fiscal:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      value={scrapeAno}
                      onChange={e => setScrapeAno(parseInt(e.target.value, 10))}
                      disabled={scrapeExecutando}
                      className="w-full bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded p-2 text-foreground text-center"
                    />
                    <select
                      value={scrapeMes}
                      onChange={e => setScrapeMes(parseInt(e.target.value, 10))}
                      disabled={scrapeExecutando}
                      className="w-full bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded p-2 text-foreground cursor-pointer"
                    >
                      <option value={0}>Ano Todo</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>
                          Mês {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {scrapeErro && (
                <div className="p-2.5 rounded bg-rose-50 dark:bg-[#240e14] border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300 text-xs flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="font-bold block">Falha na Sincronização:</span>
                    <span className="font-sans text-[11px]">{scrapeErro}</span>
                  </div>
                </div>
              )}

              {scrapeResultado && (
                <div className="p-2.5 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs flex items-start space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Operação Concluída:</span>
                    <span className="font-sans text-[11px]">
                      {scrapeResultado.mensagem ||
                        `${scrapeResultado.total_faturas_anuladas || 0} faturas anuladas recolhidas (${scrapeResultado.novas_inconformidades_detetadas || 0} novas inconformidades).`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 border-t border-[#d7e0ea] dark:border-[#222f3e] pt-3">
              <button
                type="button"
                onClick={() => setModalScrapeAberto(false)}
                disabled={scrapeExecutando}
                className="px-3 py-1.5 rounded border border-[#d7e0ea] dark:border-[#222f3e] text-foreground hover:bg-slate-100 dark:hover:bg-[#16273b] font-mono text-xs cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={executarSincronizacaoAnuladas}
                disabled={scrapeExecutando}
                className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                {scrapeExecutando ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>A sincronizar...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Iniciar Sincronização</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
