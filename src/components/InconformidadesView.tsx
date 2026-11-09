import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Building2,
  RotateCcw,
  Loader2,
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileX2,
  Layers
} from 'lucide-react';

interface Entidade {
  id: string;
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

interface InconformidadesViewProps {
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

export function InconformidadesView({ onApiStatusChange, modoPrivacidade = false }: InconformidadesViewProps) {
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
  const [scrapeAno, setScrapeAno] = useState<number>(new Date().getFullYear());
  const [scrapeMes, setScrapeMes] = useState<number>(0); // 0 = Ano completo
  const [scrapeExecutando, setScrapeExecutando] = useState<boolean>(false);
  const [scrapeResultado, setScrapeResultado] = useState<any | null>(null);
  const [scrapeErro, setScrapeErro] = useState<string | null>(null);

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
    if (sortCol !== col) return <span className="text-slate-400 dark:text-slate-500 ml-1">⇅</span>;
    return <span className="text-[#0284c7] dark:text-sky-400 ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>;
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
          canal: 'msedge',
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
    <div className="h-full flex flex-col space-y-3 min-h-0 select-none overflow-hidden">
      {/* 1. Cabeçalho Executivo evoGex.com */}
      <header className="flex flex-wrap justify-between items-center gap-2 shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <span className="page-kicker text-slate-600 dark:text-slate-400 font-mono">
              AUDITORIA FORENSE & CONTROLO DE DOCUMENTOS CANCELADOS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          </div>
          <h1 className="text-xl text-foreground font-display font-light tracking-tight flex items-center space-x-2 mt-0.5">
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
            <span>Documentos Anulados e Inconformidades</span>
          </h1>
        </div>

        {/* Ações do Topo */}
        <div className="flex items-center space-x-2">
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 shrink-0">
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
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52] text-xs font-mono">
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
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52] text-xs font-mono">
            {(['todos', 'compras', 'vendas'] as const).map(mod => (
              <button
                key={mod}
                type="button"
                onClick={() => setModuloFiltro(mod)}
                className={`px-2 py-0.5 rounded font-semibold capitalize cursor-pointer ${
                  moduloFiltro === mod ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {mod === 'todos' ? 'Compras & Vendas' : mod}
              </button>
            ))}
          </div>

          {/* Seletor de Empresa */}
          <div className="flex items-center space-x-1.5 min-w-[200px] max-w-[260px]">
            <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={nifFiltro}
              onChange={e => setNifFiltro(e.target.value)}
              className="w-full text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1 text-foreground cursor-pointer truncate"
            >
              <option value="">Todas as Empresas ({entidades.length})</option>
              {entidades.map(ent => {
                const n = (ent.nif || ent.nif_cc || '').trim();
                return (
                  <option key={ent.id} value={n}>
                    {ofuscarNif(n)} · {ofuscarNome(ent.nomecli, n)}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Datas */}
          <input
            type="date"
            value={dataInicio}
            onChange={e => setDataInicio(e.target.value)}
            className="text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1 text-foreground"
            title="Data de Emissão Inicial"
          />
          <input
            type="date"
            value={dataFim}
            onChange={e => setDataFim(e.target.value)}
            className="text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1 text-foreground"
            title="Data de Emissão Final"
          />

          {/* Pesquisa */}
          <div className="relative min-w-[200px] flex-1 max-w-[280px]">
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
      </div>

      {/* 4. Tabela de Documentos Anulados e Inconformidades */}
      <div className="flex-1 min-h-0 bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs overflow-hidden flex flex-col relative">
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
                    Empresa Titular {renderSortIcon('nif_cliente')}
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

                  return (
                    <tr key={`${item.id_fatura_unico}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#111d2b] transition-colors">
                      <td className="py-2 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {item.data_emissao || '—'}
                      </td>
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            isVendas
                              ? 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-700'
                              : 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                          }`}
                        >
                          {isVendas ? 'Vendas' : 'Compras'}
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
                      <td className="py-2 px-3 max-w-[200px] truncate" title={`${item.nif_cliente} · ${item.nome_cliente}`}>
                        <span className="font-bold text-foreground">{ofuscarNif(item.nif_cliente)}</span>
                        <span className="text-slate-600 dark:text-slate-300 ml-1.5 font-sans text-[11px]">
                          {ofuscarNome(item.nome_cliente, item.nif_cliente)}
                        </span>
                      </td>
                      <td className="py-2 px-3 max-w-[220px] truncate" title={`${item.contraparte_nif} · ${item.contraparte_nome}`}>
                        <span className="font-bold text-foreground">{ofuscarNif(item.contraparte_nif)}</span>
                        <span className="text-slate-700 dark:text-slate-200 ml-1.5 font-sans text-[11px]">
                          {ofuscarNome(item.contraparte_nome, item.contraparte_nif)}
                        </span>
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
                  Empresa Titular:
                </label>
                <select
                  value={scrapeNif}
                  onChange={e => setScrapeNif(e.target.value)}
                  disabled={scrapeExecutando}
                  className="w-full bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded p-2 text-foreground cursor-pointer"
                >
                  {modoSync === 'lote' && <option value="">Todas as Empresas com Senha AT</option>}
                  {entidades.map(ent => {
                    const n = (ent.nif || ent.nif_cc || '').trim();
                    return (
                      <option key={ent.id} value={n}>
                        {ofuscarNif(n)} — {ofuscarNome(ent.nomecli, n)}
                      </option>
                    );
                  })}
                </select>
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
