import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderArchive,
  RotateCcw,
  Search,
  ShoppingCart,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  FilterX,
  Layers,
  Receipt,
  CalendarDays,
  Hash,
  FileText,
  Users,
  X,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Copy,
  Check,
  FolderOpen,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { EmpresaSelectorCombobox } from './EmpresaSelectorCombobox';
import { AssistenteImportacaoPanel } from './AssistenteImportacaoPanel';
import {
  obterResumoDestinosConfigurados,
  abrirPastaNoExploradorNativo,
  hidratarSqliteNifSobDemanda,
  hidratarTodosSqlitesNifsSobDemanda,
} from '../lib/localFsBridge';
import type { LinhaFatura } from './FaturasView';
import {
  exportarMapaUnicoXlsx,
  exportarTodosMapasXlsx,
  exportarDivididoPorFornecedorXlsx,
  type ExcelColumnDef,
  type ExcelSheetInput,
  type DocHorizontalExportRow,
} from '../lib/excelExport';

interface Entidade {
  id: string;
  cod?: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
}

interface DocumentoRV {
  id_documento: string;
  n_documento: string;
  atcud: string;
  tipo_doc: string;
  categoria: 'recibo_verde' | 'renda';
  situacao: string;
  nif_cliente: string;
  nome_cliente: string;
  nif_emit: string;
  nome_emit: string;
  nif_adquirente: string;
  nome_adquirente: string;
  contraparte_nif: string;
  contraparte_nome: string;
  dta_emissao: string;
  ano_emissao: number;
  mes_emissao: number;
  ano_efetivo: number;
  mes_efetivo: number;
  valor_base: number;
  valor_iva: number;
  imposto_selo: number;
  valor_irs: number;
  importancia_recebida: number;
}

interface DocHorizontalEfatura {
  id_documento: string;
  nif_cliente: string;
  contraparte_nif: string;
  contraparte_nome: string;
  tipo_doc: string;
  situacao: string;
  n_fatura: string;
  atcud: string;
  data_emissao: string;
  setor_atividade: string;
  docs_trabalho: '' | 'Doc Trabalho';
  ano: number;
  mes: number;
  dia_semana: string;
  base_tributavel: number;
  total_iva: number;
  total_liquido: number;
  base_ise: number;
  base_red: number;
  iva_red: number;
  base_int: number;
  iva_int: number;
  base_nor: number;
  iva_nor: number;
}

type SubVistaMapa =
  | 'recapitulativos'
  | 'resumo_docs'
  | 'por_tipo'
  | 'por_dia'
  | 'contagem'
  | 'retencoes_irs';

type FiltroDocsTrabalho = 'todos' | 'fiscais' | 'trabalho';
type FiltroSituacaoIRS = 'emitidos' | 'todos' | 'anulados';

interface MapasResumoViewProps {
  ano: number;
  onAnoChange: (ano: number) => void;
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

const MESES = [
  { num: 1, nome: 'Jan', full: 'Janeiro' },
  { num: 2, nome: 'Fev', full: 'Fevereiro' },
  { num: 3, nome: 'Mar', full: 'Março' },
  { num: 4, nome: 'Abr', full: 'Abril' },
  { num: 5, nome: 'Mai', full: 'Maio' },
  { num: 6, nome: 'Jun', full: 'Junho' },
  { num: 7, nome: 'Jul', full: 'Julho' },
  { num: 8, nome: 'Ago', full: 'Agosto' },
  { num: 9, nome: 'Set', full: 'Setembro' },
  { num: 10, nome: 'Out', full: 'Outubro' },
  { num: 11, nome: 'Nov', full: 'Novembro' },
  { num: 12, nome: 'Dez', full: 'Dezembro' },
];

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

const MAPA_TIPO_DOC: Record<string, string> = {
  FT: 'Fatura',
  FS: 'Fatura simplificada',
  FR: 'Fatura-recibo',
  NC: 'Nota de crédito',
  ND: 'Nota de débito',
  VD: 'Venda a dinheiro',
  TV: 'Talão de venda',
  TD: 'Talão de devolução',
  DC: 'Documento de conferência',
  CM: 'Consultas de mesa',
  CC: 'Crédito de consignação',
  FC: 'Fatura de consignação',
  FO: 'Folhas de obra',
  NE: 'Nota de encomenda',
  OU: 'Outros',
  OR: 'Orçamentos',
  PF: 'Pró-forma',
};

const DOCS_NAO_ADMITIDOS_NORMALIZADOS = new Set([
  'documento de conferencia',
  'documentos de conferencia',
  'consultas de mesa',
  'consulta de mesa',
  'credito de consignacao',
  'fatura de consignacao',
  'folhas de obra',
  'folha de obra',
  'nota de encomenda',
  'outros',
  'orcamentos',
  'orcamento',
  'pro-forma',
  'pro forma',
  'proforma',
]);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizarTextoSimples(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizarTipoDocumento(raw: string): string {
  const clean = (raw || '').trim();
  if (!clean) return 'Outros';
  const upper = clean.toUpperCase();
  return MAPA_TIPO_DOC[upper] || clean;
}

function isDocTrabalho(tipoNormalizado: string): boolean {
  const norm = normalizarTextoSimples(tipoNormalizado);
  return DOCS_NAO_ADMITIDOS_NORMALIZADOS.has(norm);
}

function normalizarSituacaoEfatura(estadoRaw: string): string {
  const clean = (estadoRaw || '').trim();
  const upper = clean.toUpperCase();
  if (!clean || upper === 'N' || upper === 'NORMAL' || upper === 'REGISTADO') {
    return 'Registado';
  }
  if (upper === 'A' || upper.includes('ANULAD')) {
    return 'Anulado';
  }
  return clean;
}

function calcularDiaSemanaPt(isoDate: string): string {
  const d = (isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return DIAS_SEMANA[dt.getUTCDay()] || '';
}

function formatarDataPt(isoDate: string): string {
  const d = (isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function formatarMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mascararTexto(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

type AgregadoIva10 = {
  docs: number;
  base_tributavel: number;
  total_iva: number;
  total_liquido: number;
  base_ise: number;
  base_red: number;
  iva_red: number;
  base_int: number;
  iva_int: number;
  base_nor: number;
  iva_nor: number;
};

function criarAgregadoVazio(): AgregadoIva10 {
  return {
    docs: 0,
    base_tributavel: 0,
    total_iva: 0,
    total_liquido: 0,
    base_ise: 0,
    base_red: 0,
    iva_red: 0,
    base_int: 0,
    iva_int: 0,
    base_nor: 0,
    iva_nor: 0,
  };
}

function acumularDocEmAgregado(acc: AgregadoIva10, doc: DocHorizontalEfatura) {
  acc.docs += 1;
  acc.base_tributavel = round2(acc.base_tributavel + doc.base_tributavel);
  acc.total_iva = round2(acc.total_iva + doc.total_iva);
  acc.total_liquido = round2(acc.total_liquido + doc.total_liquido);
  acc.base_ise = round2(acc.base_ise + doc.base_ise);
  acc.base_red = round2(acc.base_red + doc.base_red);
  acc.iva_red = round2(acc.iva_red + doc.iva_red);
  acc.base_int = round2(acc.base_int + doc.base_int);
  acc.iva_int = round2(acc.iva_int + doc.iva_int);
  acc.base_nor = round2(acc.base_nor + doc.base_nor);
  acc.iva_nor = round2(acc.iva_nor + doc.iva_nor);
}

const COLUNAS_10_IVA_EXCEL: ExcelColumnDef[] = [
  { key: 'base_tributavel', label: 'Soma de BaseTributavel', type: 'currency', width: 16 },
  { key: 'total_iva', label: 'Soma de Total_Iva', type: 'currency', width: 15 },
  { key: 'total_liquido', label: 'Soma de Total_Liquido', type: 'currency', width: 16 },
  { key: 'base_ise', label: 'Soma de Base_Ise', type: 'currency', width: 15 },
  { key: 'base_red', label: 'Soma de Base_Red', type: 'currency', width: 15 },
  { key: 'iva_red', label: 'Soma de Iva_Red', type: 'currency', width: 14 },
  { key: 'base_int', label: 'Soma de Base_Int', type: 'currency', width: 15 },
  { key: 'iva_int', label: 'Soma de Iva_Int', type: 'currency', width: 14 },
  { key: 'base_nor', label: 'Soma de Base_Nor', type: 'currency', width: 15 },
  { key: 'iva_nor', label: 'Soma de Iva_Nor', type: 'currency', width: 14 },
];

export function MapasResumoView({
  ano,
  onAnoChange,
  onApiStatusChange,
  modoPrivacidade = false,
}: MapasResumoViewProps) {
  const anoAtual = new Date().getFullYear();

  const [subVista, setSubVista] = useState<SubVistaMapa>('recapitulativos');
  const [tipoOperacao, setTipoOperacao] = useState<'compras' | 'vendas'>('compras');
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [nifSelecionado, setNifSelecionado] = useState<string>('');

  // Dados brutos carregados
  const [linhasFatura, setLinhasFatura] = useState<LinhaFatura[]>([]);
  const [docsRV, setDocsRV] = useState<DocumentoRV[]>([]);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [feedbackExport, setFeedbackExport] = useState<string | null>(null);

  // Filtros equivalentes às Tabelas Dinâmicas do Excel
  const [mesFiltro, setMesFiltro] = useState<number | null>(null);
  const [trimestreFiltro, setTrimestreFiltro] = useState<number | null>(null);
  const [mesesCustomAssistente, setMesesCustomAssistente] = useState<Set<number> | null>(null);
  const [filtroDocsTrabalho, setFiltroDocsTrabalho] = useState<FiltroDocsTrabalho>('todos');
  const [filtroTipoDoc, setFiltroTipoDoc] = useState<string>('');
  const [filtroSetor, setFiltroSetor] = useState<string>('');
  const [filtroDiaSemana, setFiltroDiaSemana] = useState<string>('');
  const [filtroContraparteNif, setFiltroContraparteNif] = useState<string>('');
  const [pesquisa, setPesquisa] = useState<string>('');
  const [agruparPorFornecedor, setAgruparPorFornecedor] = useState<boolean>(true);

  // Assistente Passo a Passo & Destino Local
  const [assistenteAberto, setAssistenteAberto] = useState<boolean>(
    () => localStorage.getItem('gexcel_mapas_assistente_fechado') !== 'true'
  );
  const [passoAssistente, setPassoAssistente] = useState<1 | 2 | 3 | 4>(1);
  const [caminhoDestinoLocal, setCaminhoDestinoLocal] = useState<string>(
    () => obterResumoDestinosConfigurados().pastaV4
  );
  const [copiadoPasta, setCopiadoPasta] = useState<boolean>(false);
  const [apiOnlineLocal, setApiOnlineLocal] = useState<boolean | null>(true);
  const [selecionadasAssistente, setSelecionadasAssistente] = useState<Set<string>>(() => new Set());

  const inicializouAssistenteRef = useRef<boolean>(false);
  const assistenteAlterouSelecaoRef = useRef<boolean>(false);

  const abrirAssistente = () => {
    setAssistenteAberto(true);
    localStorage.setItem('gexcel_mapas_assistente_fechado', 'false');
  };

  const fecharAssistente = () => {
    setAssistenteAberto(false);
    localStorage.setItem('gexcel_mapas_assistente_fechado', 'true');
  };

  useEffect(() => {
    const onFsUpdated = () => {
      setCaminhoDestinoLocal(obterResumoDestinosConfigurados().pastaV4);
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  const copiarCaminhoDados = async () => {
    try {
      await navigator.clipboard.writeText(caminhoDestinoLocal);
      setCopiadoPasta(true);
      window.setTimeout(() => setCopiadoPasta(false), 1800);
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
        const d = await res.json().catch(() => null);
        if ((d?.status === 'ok' || d?.status === 'sucesso') && d?.origem !== 'cloud') return;
      }
    } catch {}
    const abriu = await abrirPastaNoExploradorNativo('BdsefaturaV4', 'evogex');
    if (!abriu) {
      await copiarCaminhoDados();
    }
  };

  // Filtros específicos de Retenções IRS
  const [filtroSituacaoIRS, setFiltroSituacaoIRS] = useState<FiltroSituacaoIRS>('emitidos');
  const [filtroTipoRV, setFiltroTipoRV] = useState<'todos' | 'rv' | 'rendas'>('todos');

  // Ordenação por sub-vista
  const [sortConfig, setSortConfig] = useState<
    Record<SubVistaMapa, { col: string; dir: 'asc' | 'desc' }>
  >({
    recapitulativos: { col: 'total_liquido', dir: 'desc' },
    resumo_docs: { col: 'contraparte_nome', dir: 'asc' },
    por_tipo: { col: 'total_liquido', dir: 'desc' },
    por_dia: { col: 'data_emissao', dir: 'desc' },
    contagem: { col: 'mes', dir: 'asc' },
    retencoes_irs: { col: 'valor_irs', dir: 'desc' },
  });

  const reqCounterRef = useRef(0);

  const handleSort = (vista: SubVistaMapa, col: string, defaultDir: 'asc' | 'desc' = 'desc') => {
    setSortConfig(prev => {
      const curr = prev[vista];
      if (curr.col === col) {
        return {
          ...prev,
          [vista]: { col, dir: curr.dir === 'asc' ? 'desc' : 'asc' },
        };
      }
      return {
        ...prev,
        [vista]: { col, dir: defaultDir },
      };
    });
  };

  const renderSortIcon = (vista: SubVistaMapa, col: string) => {
    const curr = sortConfig[vista];
    if (curr.col !== col) {
      return <ArrowUpDown className="w-3 h-3 opacity-45 inline ml-1 shrink-0" />;
    }
    return curr.dir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#0284c7] dark:text-sky-400 inline ml-1 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#0284c7] dark:text-sky-400 inline ml-1 shrink-0" />
    );
  };

  // 1. Carregar Entidades
  useEffect(() => {
    let cancel = false;
    fetch('http://127.0.0.1:8015/api/entidades')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancel && data?.entidades) {
          setEntidades(data.entidades as Entidade[]);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // 2. Carregar Dados Consolidados do Ano Ativo (e-Fatura + Recibos Verdes/Rendas)
  const carregarDados = useCallback(async () => {
    const reqId = ++reqCounterRef.current;
    setCarregando(true);
    setErroCarga(null);

    try {
      if (nifSelecionado) {
        await hidratarSqliteNifSobDemanda(nifSelecionado);
      } else {
        await hidratarTodosSqlitesNifsSobDemanda();
      }
      if (reqId !== reqCounterRef.current) return;
      const pageSize = 50000;
      const paramsEf = new URLSearchParams({
        tipo: tipoOperacao,
        nif: nifSelecionado,
        data_inicio: `${ano}-01-01`,
        data_fim: `${ano}-12-31`,
        limite: String(pageSize),
        offset: '0',
        ordenar_por: 'data_emissao',
        ordem: 'desc',
      });

      const paramsRv = new URLSearchParams({
        tipo: tipoOperacao,
        nif: nifSelecionado,
        ano: String(ano),
        apenas_ano_emissao: 'true',
        limite: '15000',
        offset: '0',
        ordenar_por: 'dta_emissao',
        ordem: 'desc',
      });

      const [resEf, resRv] = await Promise.all([
        fetch(`http://127.0.0.1:8015/api/faturas/consultar?${paramsEf.toString()}`),
        fetch(`http://127.0.0.1:8015/api/recibos-verdes/consultar?${paramsRv.toString()}`),
      ]);

      if (reqId !== reqCounterRef.current) return;

      if (!resEf.ok && !resRv.ok) {
        onApiStatusChange?.(false);
        setApiOnlineLocal(false);
        setErroCarga('Não foi possível contactar a API de dados do e-Fatura.');
        return;
      }

      onApiStatusChange?.(true);
      setApiOnlineLocal(true);

      let todasLinhasEf: LinhaFatura[] = [];
      if (resEf.ok) {
        const jsonEf = await resEf.json();
        todasLinhasEf = Array.isArray(jsonEf.linhas) ? jsonEf.linhas : [];
        const totalLinhas = Number(jsonEf.total_linhas || 0);

        // Paginação automática se uma entidade específica tiver mais de 50.000 linhas no ano
        if (nifSelecionado && totalLinhas > todasLinhasEf.length) {
          let offsetAtual = todasLinhasEf.length;
          while (offsetAtual < totalLinhas && offsetAtual < 250000) {
            const nextParams = new URLSearchParams(paramsEf);
            nextParams.set('offset', String(offsetAtual));
            const nextRes = await fetch(
              `http://127.0.0.1:8015/api/faturas/consultar?${nextParams.toString()}`
            );
            if (!nextRes.ok) break;
            const nextJson = await nextRes.json();
            const batch: LinhaFatura[] = Array.isArray(nextJson.linhas) ? nextJson.linhas : [];
            if (batch.length === 0) break;
            todasLinhasEf = todasLinhasEf.concat(batch);
            offsetAtual += batch.length;
          }
        }
      }

      let todosDocsRv: DocumentoRV[] = [];
      if (resRv.ok) {
        const jsonRv = await resRv.json();
        todosDocsRv = Array.isArray(jsonRv.linhas) ? jsonRv.linhas : [];
        const totalDocsRv = Number(jsonRv.total_documentos || 0);

        if (totalDocsRv > todosDocsRv.length) {
          let offsetRv = todosDocsRv.length;
          while (offsetRv < totalDocsRv && offsetRv < 100000) {
            const nextParamsRv = new URLSearchParams(paramsRv);
            nextParamsRv.set('offset', String(offsetRv));
            const nextResRv = await fetch(
              `http://127.0.0.1:8015/api/recibos-verdes/consultar?${nextParamsRv.toString()}`
            );
            if (!nextResRv.ok) break;
            const nextJsonRv = await nextResRv.json();
            const batchRv: DocumentoRV[] = Array.isArray(nextJsonRv.linhas) ? nextJsonRv.linhas : [];
            if (batchRv.length === 0) break;
            todosDocsRv = todosDocsRv.concat(batchRv);
            offsetRv += batchRv.length;
          }
        }
      }

      if (reqId !== reqCounterRef.current) return;
      setLinhasFatura(todasLinhasEf);
      setDocsRV(todosDocsRv);
    } catch {
      if (reqId !== reqCounterRef.current) return;
      onApiStatusChange?.(false);
      setApiOnlineLocal(false);
      setErroCarga('Falha de ligação ao motor de dados.');
    } finally {
      if (reqId === reqCounterRef.current) {
        setCarregando(false);
      }
    }
  }, [ano, tipoOperacao, nifSelecionado, onApiStatusChange]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Sincronização inicial e helpers multi-empresa/multi-mês para o Assistente
  useEffect(() => {
    if (entidades.length === 0 || inicializouAssistenteRef.current) return;
    inicializouAssistenteRef.current = true;
    if (nifSelecionado) {
      setSelecionadasAssistente(new Set([nifSelecionado]));
    } else {
      setSelecionadasAssistente(
        new Set(entidades.map(e => (e.nif || e.nif_cc || '').trim()).filter(Boolean))
      );
    }
  }, [entidades, nifSelecionado]);

  const toggleEmpresaAssistente = useCallback((nif: string) => {
    assistenteAlterouSelecaoRef.current = true;
    setSelecionadasAssistente(prev => {
      const next = new Set(prev);
      if (next.has(nif)) next.delete(nif);
      else next.add(nif);
      return next;
    });
  }, []);

  const selecionarTodasAssistente = useCallback(() => {
    assistenteAlterouSelecaoRef.current = true;
    setSelecionadasAssistente(
      new Set(entidades.map(e => (e.nif || e.nif_cc || '').trim()).filter(Boolean))
    );
  }, [entidades]);

  const limparSelecionadasAssistente = useCallback(() => {
    assistenteAlterouSelecaoRef.current = true;
    setSelecionadasAssistente(new Set());
  }, []);

  useEffect(() => {
    if (!assistenteAlterouSelecaoRef.current) return;
    assistenteAlterouSelecaoRef.current = false;
    setFiltroContraparteNif('');
    if (selecionadasAssistente.size === 1) {
      setNifSelecionado(Array.from(selecionadasAssistente)[0]);
    } else {
      setNifSelecionado('');
    }
  }, [selecionadasAssistente]);

  const mesAtual = new Date().getMonth() + 1;

  const aplicarAnoTodo = useCallback(() => {
    setMesFiltro(null);
    setTrimestreFiltro(null);
    setMesesCustomAssistente(null);
  }, []);

  const aplicarMesAtual = useCallback(() => {
    if (ano !== anoAtual) {
      onAnoChange(anoAtual);
    }
    setTrimestreFiltro(null);
    setMesesCustomAssistente(null);
    setMesFiltro(mesAtual);
  }, [ano, anoAtual, mesAtual, onAnoChange]);

  const aplicarTrimestre = useCallback((t: number) => {
    setMesFiltro(null);
    setMesesCustomAssistente(null);
    setTrimestreFiltro(prev => (prev === t ? null : t));
  }, []);

  const entidadeSelecionadaObj = useMemo(() => {
    if (!nifSelecionado) return null;
    return (
      entidades.find(
        e => e.nif === nifSelecionado || e.nif_cc === nifSelecionado
      ) || null
    );
  }, [entidades, nifSelecionado]);

  const nomeEntidadeCabecalho = useMemo(() => {
    if (!nifSelecionado) {
      if (selecionadasAssistente.size > 0 && selecionadasAssistente.size < entidades.length) {
        return `Empresas Selecionadas (${selecionadasAssistente.size} de ${entidades.length})`;
      }
      return `Todas as Entidades (${entidades.length})`;
    }
    const nome = entidadeSelecionadaObj?.nomecli || nifSelecionado;
    return modoPrivacidade ? mascararTexto(nome) : nome;
  }, [nifSelecionado, entidadeSelecionadaObj, entidades.length, selecionadasAssistente.size, modoPrivacidade]);

  // 3. Agrupamento de linhas verticais em documentos horizontais (fiel a efaturaDados)
  const docsEfaturaHorizontais = useMemo<DocHorizontalEfatura[]>(() => {
    const mapa = new Map<string, DocHorizontalEfatura>();
    const filtrarMultiEmpresa =
      nifSelecionado === '' &&
      selecionadasAssistente.size > 0 &&
      selecionadasAssistente.size < entidades.length;

    for (const linha of linhasFatura) {
      if (filtrarMultiEmpresa && !selecionadasAssistente.has((linha.nif_cliente || '').trim())) {
        continue;
      }
      const chave =
        (linha.id_fatura_unico || '').trim() ||
        `${linha.nif_cliente}_${linha.contraparte_nif}_${linha.fatura}_${linha.data_emissao}`;

      let doc = mapa.get(chave);
      if (!doc) {
        const tipoNorm = normalizarTipoDocumento(linha.tipo_documento);
        const situacaoNorm = normalizarSituacaoEfatura(linha.estado_documento || '');
        const dataIso = (linha.data_emissao || '').slice(0, 10);
        const mesExtraido =
          dataIso.length >= 7 ? parseInt(dataIso.slice(5, 7), 10) || 0 : 0;
        const anoExtraido =
          dataIso.length >= 4 ? parseInt(dataIso.slice(0, 4), 10) || ano : ano;

        doc = {
          id_documento: chave,
          nif_cliente: (linha.nif_cliente || '').trim(),
          contraparte_nif: (linha.contraparte_nif || '').trim(),
          contraparte_nome: (linha.contraparte_nome || '').trim() || (linha.contraparte_nif || '').trim() || 'Sem Nome',
          tipo_doc: tipoNorm,
          situacao: situacaoNorm,
          n_fatura: (linha.fatura || '').trim(),
          atcud: (linha.atcud || '').trim(),
          data_emissao: dataIso,
          setor_atividade: (linha.setor_atividade || '').trim() || 'Outros',
          docs_trabalho: isDocTrabalho(tipoNorm) ? 'Doc Trabalho' : '',
          ano: anoExtraido,
          mes: mesExtraido,
          dia_semana: calcularDiaSemanaPt(dataIso),
          base_tributavel: 0,
          total_iva: 0,
          total_liquido: 0,
          base_ise: 0,
          base_red: 0,
          iva_red: 0,
          base_int: 0,
          iva_int: 0,
          base_nor: 0,
          iva_nor: 0,
        };
        mapa.set(chave, doc);
      }

      // Regra fiel ao VBA: documentos anulados têm valores zerados nos mapas financeiros
      if (doc.situacao === 'Anulado') {
        continue;
      }

      const taxType = (linha.tipo_imposto || 'IVA').trim().toUpperCase();
      const taxCode = (linha.codigo_taxa || '').trim().toUpperCase();
      const perc = Number(linha.taxa_percentagem || 0);
      const base = Number(linha.base_incidencia || 0);
      const iva = Number(linha.valor_imposto || 0);

      if (taxType === 'IS') {
        // Imposto do Selo soma na base isenta sem contar como IVA
        doc.base_ise += base + iva;
      } else if (
        taxCode === 'ISE' ||
        taxCode === 'NS' ||
        taxType === 'NS' ||
        perc === 0 ||
        (Math.abs(iva) < 0.005 && !['RED', 'INT', 'NOR'].includes(taxCode))
      ) {
        doc.base_ise += base;
      } else if (taxCode === 'RED' || (Math.abs(perc) > 0 && Math.abs(perc) <= 6.5)) {
        doc.base_red += base;
        doc.iva_red += iva;
      } else if (taxCode === 'INT' || (Math.abs(perc) > 6.5 && Math.abs(perc) <= 13.5)) {
        doc.base_int += base;
        doc.iva_int += iva;
      } else {
        doc.base_nor += base;
        doc.iva_nor += iva;
      }
    }

    const lista: DocHorizontalEfatura[] = [];
    for (const d of mapa.values()) {
      d.base_ise = round2(d.base_ise);
      d.base_red = round2(d.base_red);
      d.iva_red = round2(d.iva_red);
      d.base_int = round2(d.base_int);
      d.iva_int = round2(d.iva_int);
      d.base_nor = round2(d.base_nor);
      d.iva_nor = round2(d.iva_nor);
      d.base_tributavel = round2(d.base_ise + d.base_red + d.base_int + d.base_nor);
      d.total_iva = round2(d.iva_red + d.iva_int + d.iva_nor);
      d.total_liquido = round2(d.base_tributavel + d.total_iva);
      lista.push(d);
    }

    return lista;
  }, [linhasFatura, ano, nifSelecionado, selecionadasAssistente, entidades.length]);

  const docsRVBase = useMemo(() => {
    const filtrarMultiEmpresa =
      nifSelecionado === '' &&
      selecionadasAssistente.size > 0 &&
      selecionadasAssistente.size < entidades.length;
    if (!filtrarMultiEmpresa) return docsRV;
    return docsRV.filter(rv => selecionadasAssistente.has((rv.nif_cliente || '').trim()));
  }, [docsRV, nifSelecionado, selecionadasAssistente, entidades.length]);

  // Opções dinâmicas para os filtros de TipoDoc e Setor
  const opcoesTipoDoc = useMemo(() => {
    const s = new Set<string>();
    for (const d of docsEfaturaHorizontais) {
      if (d.tipo_doc) s.add(d.tipo_doc);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-PT'));
  }, [docsEfaturaHorizontais]);

  const opcoesSetor = useMemo(() => {
    const s = new Set<string>();
    for (const d of docsEfaturaHorizontais) {
      if (d.setor_atividade) s.add(d.setor_atividade);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-PT'));
  }, [docsEfaturaHorizontais]);

  const mesesPermitidos = useMemo<Set<number> | null>(() => {
    if (mesesCustomAssistente && mesesCustomAssistente.size > 0 && mesesCustomAssistente.size < 12) {
      return mesesCustomAssistente;
    }
    if (mesFiltro !== null) return new Set([mesFiltro]);
    if (trimestreFiltro !== null) {
      const ini = (trimestreFiltro - 1) * 3 + 1;
      return new Set([ini, ini + 1, ini + 2]);
    }
    return null;
  }, [mesesCustomAssistente, mesFiltro, trimestreFiltro]);

  const mesesAtivosAssistente = useMemo<Set<number>>(() => {
    return mesesPermitidos ?? new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }, [mesesPermitidos]);

  const toggleMesAssistente = useCallback(
    (m: number) => {
      const base = new Set(mesesAtivosAssistente);
      if (base.has(m)) base.delete(m);
      else base.add(m);
      if (base.size === 0 || base.size === 12) {
        aplicarAnoTodo();
      } else if (base.size === 1) {
        setTrimestreFiltro(null);
        setMesesCustomAssistente(null);
        setMesFiltro(Array.from(base)[0]);
      } else {
        setMesFiltro(null);
        setTrimestreFiltro(null);
        setMesesCustomAssistente(base);
      }
    },
    [mesesAtivosAssistente, aplicarAnoTodo]
  );

  // 4. Documentos e-Fatura Filtrados (partilhado por Recapitulativos, ResumoDocs, Por Tipo Doc, Por Dia)
  const docsEfaturaFiltrados = useMemo(() => {
    const q = pesquisa.trim().toLowerCase();
    return docsEfaturaHorizontais.filter(d => {
      if (mesesPermitidos && !mesesPermitidos.has(d.mes)) return false;
      if (filtroDocsTrabalho === 'fiscais' && d.docs_trabalho === 'Doc Trabalho') return false;
      if (filtroDocsTrabalho === 'trabalho' && d.docs_trabalho !== 'Doc Trabalho') return false;
      if (filtroTipoDoc && d.tipo_doc !== filtroTipoDoc) return false;
      if (filtroSetor && d.setor_atividade !== filtroSetor) return false;
      if (filtroDiaSemana && d.dia_semana !== filtroDiaSemana) return false;
      if (filtroContraparteNif && d.contraparte_nif !== filtroContraparteNif) return false;
      if (q) {
        const hit =
          d.contraparte_nif.toLowerCase().includes(q) ||
          d.contraparte_nome.toLowerCase().includes(q) ||
          d.n_fatura.toLowerCase().includes(q) ||
          d.atcud.toLowerCase().includes(q) ||
          d.tipo_doc.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [
    docsEfaturaHorizontais,
    mesesPermitidos,
    filtroDocsTrabalho,
    filtroTipoDoc,
    filtroSetor,
    filtroDiaSemana,
    filtroContraparteNif,
    pesquisa,
  ]);

  // Totais gerais dos documentos filtrados (Barra de Totais no Topo — GETPIVOTDATA)
  const totaisEfatura = useMemo(() => {
    const acc = criarAgregadoVazio();
    for (const d of docsEfaturaFiltrados) {
      acumularDocEmAgregado(acc, d);
    }
    return acc;
  }, [docsEfaturaFiltrados]);

  // 5.1 Dados para Sub-Vista: Recapitulativos (Por NIF + Nome Contraparte)
  const linhasRecapitulativos = useMemo(() => {
    const grupos = new Map<
      string,
      AgregadoIva10 & { contraparte_nif: string; contraparte_nome: string }
    >();
    for (const d of docsEfaturaFiltrados) {
      const chave = `${d.contraparte_nif}__${d.contraparte_nome.toLowerCase()}`;
      let g = grupos.get(chave);
      if (!g) {
        g = {
          contraparte_nif: d.contraparte_nif,
          contraparte_nome: d.contraparte_nome,
          ...criarAgregadoVazio(),
        };
        grupos.set(chave, g);
      }
      acumularDocEmAgregado(g, d);
    }
    const lista = Array.from(grupos.values());
    const { col, dir } = sortConfig.recapitulativos;
    const mult = dir === 'asc' ? 1 : -1;
    lista.sort((a, b) => {
      if (col === 'contraparte_nif' || col === 'contraparte_nome') {
        return a[col].localeCompare(b[col], 'pt-PT') * mult;
      }
      const va = Number((a as unknown as Record<string, number>)[col] || 0);
      const vb = Number((b as unknown as Record<string, number>)[col] || 0);
      return (va - vb) * mult;
    });
    return lista;
  }, [docsEfaturaFiltrados, sortConfig.recapitulativos]);

  // 5.2 Dados para Sub-Vista: Resumo Documentos (Extrato)
  const linhasResumoDocs = useMemo(() => {
    const lista = [...docsEfaturaFiltrados];
    const { col, dir } = sortConfig.resumo_docs;
    const mult = dir === 'asc' ? 1 : -1;
    lista.sort((a, b) => {
      if (
        col === 'contraparte_nif' ||
        col === 'contraparte_nome' ||
        col === 'tipo_doc' ||
        col === 'n_fatura' ||
        col === 'data_emissao'
      ) {
        const cmp = a[col].localeCompare(b[col], 'pt-PT');
        if (cmp !== 0) return cmp * mult;
        const cmpTipo = a.tipo_doc.localeCompare(b.tipo_doc, 'pt-PT');
        if (cmpTipo !== 0) return cmpTipo;
        return a.data_emissao.localeCompare(b.data_emissao);
      }
      const va = Number((a as unknown as Record<string, number>)[col] || 0);
      const vb = Number((b as unknown as Record<string, number>)[col] || 0);
      return (va - vb) * mult;
    });
    return lista;
  }, [docsEfaturaFiltrados, sortConfig.resumo_docs]);

  // Linhas com subtotais por fornecedor (quando agrupado e ordenado por NIF/Nome)
  const resumoDocsComSubtotais = useMemo(() => {
    const isGroupedSort =
      agruparPorFornecedor &&
      (sortConfig.resumo_docs.col === 'contraparte_nome' ||
        sortConfig.resumo_docs.col === 'contraparte_nif');

    if (!isGroupedSort) {
      return {
        isGrouped: false,
        items: linhasResumoDocs.map(doc => ({ kind: 'doc' as const, doc })),
      };
    }

    const items: Array<
      | { kind: 'doc'; doc: DocHorizontalEfatura }
      | {
          kind: 'subtotal';
          nif: string;
          nome: string;
          agregado: AgregadoIva10;
        }
    > = [];

    let i = 0;
    while (i < linhasResumoDocs.length) {
      const nifAtual = linhasResumoDocs[i].contraparte_nif;
      const nomeAtual = linhasResumoDocs[i].contraparte_nome;
      const agg = criarAgregadoVazio();
      while (i < linhasResumoDocs.length && linhasResumoDocs[i].contraparte_nif === nifAtual) {
        items.push({ kind: 'doc', doc: linhasResumoDocs[i] });
        acumularDocEmAgregado(agg, linhasResumoDocs[i]);
        i++;
      }
      items.push({ kind: 'subtotal', nif: nifAtual, nome: nomeAtual, agregado: agg });
    }

    return { isGrouped: true, items };
  }, [linhasResumoDocs, agruparPorFornecedor, sortConfig.resumo_docs.col]);

  // 5.3 Dados para Sub-Vista: Por Tipo Doc (13 colunas c/ Líquidos calculados)
  const linhasPorTipoDoc = useMemo(() => {
    const grupos = new Map<
      string,
      AgregadoIva10 & {
        tipo_doc: string;
        liquido_red: number;
        liquido_int: number;
        liquido_nor: number;
      }
    >();
    for (const d of docsEfaturaFiltrados) {
      let g = grupos.get(d.tipo_doc);
      if (!g) {
        g = {
          tipo_doc: d.tipo_doc,
          ...criarAgregadoVazio(),
          liquido_red: 0,
          liquido_int: 0,
          liquido_nor: 0,
        };
        grupos.set(d.tipo_doc, g);
      }
      acumularDocEmAgregado(g, d);
    }
    const lista = Array.from(grupos.values()).map(g => ({
      ...g,
      liquido_red: round2(g.base_red + g.iva_red),
      liquido_int: round2(g.base_int + g.iva_int),
      liquido_nor: round2(g.base_nor + g.iva_nor),
    }));
    const { col, dir } = sortConfig.por_tipo;
    const mult = dir === 'asc' ? 1 : -1;
    lista.sort((a, b) => {
      if (col === 'tipo_doc') return a.tipo_doc.localeCompare(b.tipo_doc, 'pt-PT') * mult;
      const va = Number((a as unknown as Record<string, number>)[col] || 0);
      const vb = Number((b as unknown as Record<string, number>)[col] || 0);
      return (va - vb) * mult;
    });
    return lista;
  }, [docsEfaturaFiltrados, sortConfig.por_tipo]);

  // 5.4 Dados para Sub-Vista: Por Dia
  const linhasPorDia = useMemo(() => {
    const grupos = new Map<
      string,
      AgregadoIva10 & { data_emissao: string; dia_semana: string }
    >();
    for (const d of docsEfaturaFiltrados) {
      const dtKey = d.data_emissao || 'Sem Data';
      let g = grupos.get(dtKey);
      if (!g) {
        g = {
          data_emissao: dtKey,
          dia_semana: d.dia_semana,
          ...criarAgregadoVazio(),
        };
        grupos.set(dtKey, g);
      }
      acumularDocEmAgregado(g, d);
    }
    const lista = Array.from(grupos.values());
    const { col, dir } = sortConfig.por_dia;
    const mult = dir === 'asc' ? 1 : -1;
    lista.sort((a, b) => {
      if (col === 'data_emissao' || col === 'dia_semana') {
        return a[col].localeCompare(b[col], 'pt-PT') * mult;
      }
      const va = Number((a as unknown as Record<string, number>)[col] || 0);
      const vb = Number((b as unknown as Record<string, number>)[col] || 0);
      return (va - vb) * mult;
    });
    return lista;
  }, [docsEfaturaFiltrados, sortConfig.por_dia]);

  // 5.5 Dados para Sub-Vista: Contagem Documentos (Dupla Matriz: e-Fatura + Recibos Eletrónicos)
  const contagemDocumentos = useMemo(() => {
    // A. E-FATURA (conta documentos únicos por Mês x Situação)
    const sitEfSet = new Set<string>();
    const mapEf = new Map<number, Record<string, number>>();

    for (const d of docsEfaturaHorizontais) {
      if (filtroDocsTrabalho === 'fiscais' && d.docs_trabalho === 'Doc Trabalho') continue;
      if (filtroDocsTrabalho === 'trabalho' && d.docs_trabalho !== 'Doc Trabalho') continue;
      const sit = d.situacao || 'Registado';
      sitEfSet.add(sit);
      const m = d.mes >= 1 && d.mes <= 12 ? d.mes : 0;
      const row = mapEf.get(m) || {};
      row[sit] = (row[sit] || 0) + 1;
      mapEf.set(m, row);
    }

    const colunasSituacaoEf = Array.from(sitEfSet).sort((a, b) => {
      if (a === 'Registado') return -1;
      if (b === 'Registado') return 1;
      return a.localeCompare(b, 'pt-PT');
    });

    const linhasEf: Array<{ mes: number; labelMes: string; counts: Record<string, number>; total: number }> = [];
    const totaisEf: Record<string, number> = {};
    let grandTotalEf = 0;

    const mesesPresentesEf = Array.from(mapEf.keys()).sort((a, b) => a - b);
    for (const m of mesesPresentesEf) {
      const counts = mapEf.get(m)!;
      let totalLinha = 0;
      for (const sit of colunasSituacaoEf) {
        const c = counts[sit] || 0;
        totalLinha += c;
        totaisEf[sit] = (totaisEf[sit] || 0) + c;
      }
      grandTotalEf += totalLinha;
      const nomeMes = MESES.find(x => x.num === m)?.full || (m === 0 ? 'Sem Mês' : `Mês ${m}`);
      linhasEf.push({
        mes: m,
        labelMes: m > 0 ? `${String(m).padStart(2, '0')} · ${nomeMes}` : nomeMes,
        counts,
        total: totalLinha,
      });
    }

    // B. RECIBOS ELETRÓNICOS (Recibos Verdes + Rendas)
    const sitRvSet = new Set<string>();
    const mapRv = new Map<number, Record<string, number>>();
    for (const rv of docsRVBase) {
      const anoRef = rv.ano_efetivo > 1900 ? rv.ano_efetivo : rv.ano_emissao;
      if (!anoRef || anoRef !== ano) continue;
      const sit = (rv.situacao || '').trim() || '(em branco)';
      sitRvSet.add(sit);
      const m = rv.mes_efetivo >= 1 && rv.mes_efetivo <= 12 ? rv.mes_efetivo : rv.mes_emissao || 0;
      const row = mapRv.get(m) || {};
      row[sit] = (row[sit] || 0) + 1;
      mapRv.set(m, row);
    }

    const colunasSituacaoRv = Array.from(sitRvSet).sort((a, b) => {
      if (a.toLowerCase().includes('emit')) return -1;
      if (b.toLowerCase().includes('emit')) return 1;
      return a.localeCompare(b, 'pt-PT');
    });

    const linhasRv: Array<{ mes: number; labelMes: string; counts: Record<string, number>; total: number }> = [];
    const totaisRv: Record<string, number> = {};
    let grandTotalRv = 0;

    const mesesPresentesRv = Array.from(mapRv.keys()).sort((a, b) => a - b);
    for (const m of mesesPresentesRv) {
      const counts = mapRv.get(m)!;
      let totalLinha = 0;
      for (const sit of colunasSituacaoRv) {
        const c = counts[sit] || 0;
        totalLinha += c;
        totaisRv[sit] = (totaisRv[sit] || 0) + c;
      }
      grandTotalRv += totalLinha;
      const nomeMes = MESES.find(x => x.num === m)?.full || (m === 0 ? 'Sem Mês' : `Mês ${m}`);
      linhasRv.push({
        mes: m,
        labelMes: m > 0 ? `${String(m).padStart(2, '0')} · ${nomeMes}` : nomeMes,
        counts,
        total: totalLinha,
      });
    }

    return {
      colunasSituacaoEf,
      linhasEf,
      totaisEf,
      grandTotalEf,
      colunasSituacaoRv,
      linhasRv,
      totaisRv,
      grandTotalRv,
    };
  }, [docsEfaturaHorizontais, docsRVBase, ano, filtroDocsTrabalho]);

  // 5.6 Dados para Sub-Vista: Resumo Retenções IRS
  const dadosRetencoesIrs = useMemo(() => {
    const q = pesquisa.trim().toLowerCase();
    const filtrados = docsRVBase.filter(rv => {
      const anoRef = rv.ano_efetivo > 1900 ? rv.ano_efetivo : rv.ano_emissao;
      if (!anoRef || anoRef !== ano) return false;

      const mesRef = rv.mes_efetivo > 0 ? rv.mes_efetivo : rv.mes_emissao;
      if (mesesPermitidos && !mesesPermitidos.has(mesRef)) return false;

      const isRenda = rv.categoria === 'renda' || rv.tipo_doc === 'RECIBO-RENDA';
      if (filtroTipoRV === 'rv' && isRenda) return false;
      if (filtroTipoRV === 'rendas' && !isRenda) return false;

      const sitLower = (rv.situacao || '').toLowerCase();
      const isAnulado = sitLower.includes('anulado');
      if (filtroSituacaoIRS === 'emitidos' && isAnulado) return false;
      if (filtroSituacaoIRS === 'anulados' && !isAnulado) return false;

      if (q) {
        const nifCp = (rv.contraparte_nif || rv.nif_emit || '').toLowerCase();
        const nomeCp = (rv.contraparte_nome || rv.nome_emit || '').toLowerCase();
        const numDoc = (rv.n_documento || '').toLowerCase();
        if (!nifCp.includes(q) && !nomeCp.includes(q) && !numDoc.includes(q)) {
          return false;
        }
      }
      return true;
    });

    const grupos = new Map<
      string,
      {
        nif: string;
        nome: string;
        docs: number;
        valor_base: number;
        valor_irs: number;
        valor_iva: number;
        imposto_selo: number;
        importancia_recebida: number;
      }
    >();

    for (const rv of filtrados) {
      const nif = (rv.contraparte_nif || rv.nif_emit || 'SEM_NIF').trim();
      const nome = (rv.contraparte_nome || rv.nome_emit || nif).trim();
      const key = `${nif}__${nome.toLowerCase()}`;
      let g = grupos.get(key);
      if (!g) {
        g = {
          nif,
          nome,
          docs: 0,
          valor_base: 0,
          valor_irs: 0,
          valor_iva: 0,
          imposto_selo: 0,
          importancia_recebida: 0,
        };
        grupos.set(key, g);
      }
      g.docs += 1;
      g.valor_base = round2(g.valor_base + Number(rv.valor_base || 0));
      g.valor_irs = round2(g.valor_irs + Number(rv.valor_irs || 0));
      g.valor_iva = round2(g.valor_iva + Number(rv.valor_iva || 0));
      g.imposto_selo = round2(g.imposto_selo + Number(rv.imposto_selo || 0));
      g.importancia_recebida = round2(
        g.importancia_recebida + Number(rv.importancia_recebida || 0)
      );
    }

    const lista = Array.from(grupos.values());
    const { col, dir } = sortConfig.retencoes_irs;
    const mult = dir === 'asc' ? 1 : -1;
    lista.sort((a, b) => {
      if (col === 'nif' || col === 'nome') {
        return a[col].localeCompare(b[col], 'pt-PT') * mult;
      }
      const va = Number((a as unknown as Record<string, number>)[col] || 0);
      const vb = Number((b as unknown as Record<string, number>)[col] || 0);
      return (va - vb) * mult;
    });

    const totais = {
      docs: 0,
      valor_base: 0,
      valor_irs: 0,
      valor_iva: 0,
      imposto_selo: 0,
      importancia_recebida: 0,
    };
    for (const g of lista) {
      totais.docs += g.docs;
      totais.valor_base = round2(totais.valor_base + g.valor_base);
      totais.valor_irs = round2(totais.valor_irs + g.valor_irs);
      totais.valor_iva = round2(totais.valor_iva + g.valor_iva);
      totais.imposto_selo = round2(totais.imposto_selo + g.imposto_selo);
      totais.importancia_recebida = round2(
        totais.importancia_recebida + g.importancia_recebida
      );
    }

    return { lista, totais };
  }, [docsRVBase, ano, mesesPermitidos, filtroTipoRV, filtroSituacaoIRS, pesquisa, sortConfig.retencoes_irs]);

  const temFiltrosAtivos = Boolean(
    mesFiltro !== null ||
      trimestreFiltro !== null ||
      (mesesCustomAssistente && mesesCustomAssistente.size > 0 && mesesCustomAssistente.size < 12) ||
      filtroDocsTrabalho !== 'todos' ||
      filtroTipoDoc ||
      filtroSetor ||
      filtroDiaSemana ||
      filtroContraparteNif ||
      pesquisa.trim()
  );

  const limparFiltros = () => {
    setMesFiltro(null);
    setTrimestreFiltro(null);
    setMesesCustomAssistente(null);
    setFiltroDocsTrabalho('todos');
    setFiltroTipoDoc('');
    setFiltroSetor('');
    setFiltroDiaSemana('');
    setFiltroContraparteNif('');
    setPesquisa('');
  };

  // Metadados comuns para exportação Excel
  const metadadosExport = useMemo(() => {
    const periodo =
      mesesCustomAssistente && mesesCustomAssistente.size > 0 && mesesCustomAssistente.size < 12
        ? `Meses: ${Array.from(mesesCustomAssistente)
            .sort((a, b) => a - b)
            .map(m => MESES.find(x => x.num === m)?.nome || String(m))
            .join(', ')}/${ano}`
        : mesFiltro !== null
          ? `${MESES.find(m => m.num === mesFiltro)?.full || mesFiltro}/${ano}`
          : trimestreFiltro !== null
            ? `${trimestreFiltro}.º Trimestre ${ano}`
            : `Ano Completo ${ano}`;
    return [
      { label: 'Entidade', value: nomeEntidadeCabecalho },
      { label: 'CV / Fluxo', value: tipoOperacao === 'compras' ? 'C (Compras)' : 'V (Vendas)' },
      { label: 'Período', value: periodo },
      {
        label: 'Docs Trabalho',
        value:
          filtroDocsTrabalho === 'todos'
            ? '(Tudo)'
            : filtroDocsTrabalho === 'fiscais'
              ? 'Omitir Docs Trabalho'
              : 'Só Docs Trabalho',
      },
      { label: 'Tipo Doc', value: filtroTipoDoc || '(Tudo)' },
      { label: 'Setor / Atividade', value: filtroSetor || '(Tudo)' },
    ];
  }, [
    ano,
    nomeEntidadeCabecalho,
    tipoOperacao,
    mesesCustomAssistente,
    mesFiltro,
    trimestreFiltro,
    filtroDocsTrabalho,
    filtroTipoDoc,
    filtroSetor,
  ]);

  const construirSheetRecapitulativos = (): ExcelSheetInput => ({
    name: 'Recapitulativos',
    title: 'Recapitulativos',
    subtitle: nomeEntidadeCabecalho,
    metadata: metadadosExport,
    columns: [
      { key: 'contraparte_nif', label: 'NIF_ComercianteConsumidor', type: 'string', width: 14 },
      { key: 'contraparte_nome', label: 'Nome_ComerConsu', type: 'string', width: 38 },
      { key: 'docs', label: 'Docs', type: 'integer', width: 9 },
      ...COLUNAS_10_IVA_EXCEL,
    ],
    rows: linhasRecapitulativos.map(r => ({
      ...r,
      contraparte_nif: modoPrivacidade ? mascararTexto(r.contraparte_nif) : r.contraparte_nif,
      contraparte_nome: modoPrivacidade ? mascararTexto(r.contraparte_nome) : r.contraparte_nome,
    })),
    topTotalsRow: {
      contraparte_nif: 'Totais',
      contraparte_nome: '',
      ...totaisEfatura,
    },
    bottomTotalsRow: {
      contraparte_nif: 'Total Geral',
      contraparte_nome: '',
      ...totaisEfatura,
    },
  });

  const construirSheetResumoDocs = (): ExcelSheetInput => ({
    name: 'ResumoDocs',
    title: 'Resumo Documentos',
    subtitle: nomeEntidadeCabecalho,
    metadata: metadadosExport,
    columns: [
      { key: 'contraparte_nif', label: 'NIF_ComercianteConsumidor', type: 'string', width: 14 },
      { key: 'contraparte_nome', label: 'Nome_ComerConsu', type: 'string', width: 34 },
      { key: 'tipo_doc', label: 'TipoDoc', type: 'string', width: 18 },
      { key: 'n_fatura', label: 'N__Fatura', type: 'string', width: 24 },
      { key: 'data_emissao', label: 'Data_Emiss_o', type: 'date', width: 13 },
      ...COLUNAS_10_IVA_EXCEL,
    ],
    rows: linhasResumoDocs.map(d => ({
      ...d,
      contraparte_nif: modoPrivacidade ? mascararTexto(d.contraparte_nif) : d.contraparte_nif,
      contraparte_nome: modoPrivacidade ? mascararTexto(d.contraparte_nome) : d.contraparte_nome,
    })),
    topTotalsRow: {
      contraparte_nif: 'Totais',
      contraparte_nome: '',
      tipo_doc: '',
      n_fatura: '',
      data_emissao: '',
      ...totaisEfatura,
    },
    bottomTotalsRow: {
      contraparte_nif: 'Total Geral',
      contraparte_nome: '',
      tipo_doc: '',
      n_fatura: '',
      data_emissao: '',
      ...totaisEfatura,
    },
  });

  const construirSheetPorTipoDoc = (): ExcelSheetInput => ({
    name: 'Por Tipo Doc',
    title: 'Por Tipo Documento',
    subtitle: nomeEntidadeCabecalho,
    metadata: metadadosExport,
    columns: [
      { key: 'tipo_doc', label: 'TipoDoc', type: 'string', width: 24 },
      { key: 'docs', label: 'Docs', type: 'integer', width: 9 },
      { key: 'base_tributavel', label: 'Soma de BaseTributavel', type: 'currency', width: 16 },
      { key: 'total_iva', label: 'Soma de Total_Iva', type: 'currency', width: 15 },
      { key: 'total_liquido', label: 'Soma de Total_Liquido', type: 'currency', width: 16 },
      { key: 'base_ise', label: 'Soma de Base_Ise', type: 'currency', width: 15 },
      { key: 'base_red', label: 'Soma de Base_Red', type: 'currency', width: 15 },
      { key: 'iva_red', label: 'Soma de Iva_Red', type: 'currency', width: 14 },
      { key: 'liquido_red', label: 'Soma de Liquido_Red', type: 'currency', width: 15 },
      { key: 'base_int', label: 'Soma de Base_Int', type: 'currency', width: 15 },
      { key: 'iva_int', label: 'Soma de Iva_Int', type: 'currency', width: 14 },
      { key: 'liquido_int', label: 'Soma de Liquido_Int', type: 'currency', width: 15 },
      { key: 'base_nor', label: 'Soma de Base_Nor', type: 'currency', width: 15 },
      { key: 'iva_nor', label: 'Soma de Iva_Nor', type: 'currency', width: 14 },
      { key: 'liquido_nor', label: 'Soma de Liquido_Nor', type: 'currency', width: 15 },
    ],
    rows: linhasPorTipoDoc,
    bottomTotalsRow: {
      tipo_doc: 'Total Geral',
      ...totaisEfatura,
      liquido_red: round2(totaisEfatura.base_red + totaisEfatura.iva_red),
      liquido_int: round2(totaisEfatura.base_int + totaisEfatura.iva_int),
      liquido_nor: round2(totaisEfatura.base_nor + totaisEfatura.iva_nor),
    },
  });

  const construirSheetPorDia = (): ExcelSheetInput => ({
    name: 'Por Dia',
    title: 'Por Dia',
    subtitle: nomeEntidadeCabecalho,
    metadata: metadadosExport,
    columns: [
      { key: 'data_emissao', label: 'Data_Emiss_o', type: 'date', width: 14 },
      { key: 'dia_semana', label: 'Dia', type: 'string', width: 8 },
      { key: 'docs', label: 'Docs', type: 'integer', width: 9 },
      ...COLUNAS_10_IVA_EXCEL,
    ],
    rows: linhasPorDia,
    topTotalsRow: {
      data_emissao: 'Totais',
      dia_semana: '',
      ...totaisEfatura,
    },
    bottomTotalsRow: {
      data_emissao: 'Total Geral',
      dia_semana: '',
      ...totaisEfatura,
    },
  });

  const construirSheetContagem = (): ExcelSheetInput => {
    const colsEf: ExcelColumnDef[] = [
      { key: 'labelMes', label: 'Mês', type: 'string', width: 18 },
      ...contagemDocumentos.colunasSituacaoEf.map(s => ({
        key: s,
        label: s,
        type: 'integer' as const,
        width: 14,
      })),
      { key: 'total', label: 'Total Geral', type: 'integer', width: 14 },
    ];
    const rowsEf = contagemDocumentos.linhasEf.map(l => ({
      labelMes: l.labelMes,
      ...l.counts,
      total: l.total,
    }));
    const bottomEf: Record<string, string | number> = {
      labelMes: 'Total Geral',
      ...contagemDocumentos.totaisEf,
      total: contagemDocumentos.grandTotalEf,
    };

    const colsRv: ExcelColumnDef[] = [
      { key: 'labelMes', label: 'Mês Emissão', type: 'string', width: 18 },
      ...contagemDocumentos.colunasSituacaoRv.map(s => ({
        key: s,
        label: s,
        type: 'integer' as const,
        width: 14,
      })),
      { key: 'total', label: 'Total Geral', type: 'integer', width: 14 },
    ];
    const rowsRv = contagemDocumentos.linhasRv.map(l => ({
      labelMes: l.labelMes,
      ...l.counts,
      total: l.total,
    }));
    const bottomRv: Record<string, string | number> = {
      labelMes: 'Total Geral',
      ...contagemDocumentos.totaisRv,
      total: contagemDocumentos.grandTotalRv,
    };

    return {
      name: 'ContagemDocumentos',
      title: 'CONTAGEM DE DOCUMENTOS — E-FATURA',
      subtitle: nomeEntidadeCabecalho,
      metadata: [{ label: 'Ano', value: String(ano) }],
      columns: colsEf,
      rows: rowsEf,
      bottomTotalsRow: bottomEf,
      extraSection: {
        title: 'RECIBOS ELETRÓNICOS (RECIBOS VERDES E RENDAS)',
        columns: colsRv,
        rows: rowsRv,
        bottomTotalsRow: bottomRv,
      },
    };
  };

  const construirSheetRetencoesIrs = (): ExcelSheetInput => ({
    name: 'ResumoRetençõesIrs',
    title: 'Retenções IRS Por Entidade',
    subtitle: nomeEntidadeCabecalho,
    metadata: [
      ...metadadosExport,
      {
        label: 'Situação Recibos',
        value:
          filtroSituacaoIRS === 'emitidos'
            ? 'Omitir Anulados (Só Emitidos)'
            : filtroSituacaoIRS === 'anulados'
              ? 'Só Anulados'
              : 'Todos (Inclui Anulados)',
      },
    ],
    columns: [
      { key: 'nif', label: 'NIFEmit / Contraparte', type: 'string', width: 16 },
      { key: 'nome', label: 'NomeEmit / Contraparte', type: 'string', width: 38 },
      { key: 'docs', label: 'Docs', type: 'integer', width: 10 },
      { key: 'valor_base', label: 'Soma de ValorBase', type: 'currency', width: 18 },
      { key: 'valor_irs', label: 'Soma de ValorIRS', type: 'currency', width: 18 },
      { key: 'valor_iva', label: 'Soma de ValorIVA', type: 'currency', width: 16 },
      { key: 'imposto_selo', label: 'Soma de ImpostoSelo', type: 'currency', width: 16 },
      { key: 'importancia_recebida', label: 'Importância Líquida', type: 'currency', width: 18 },
    ],
    rows: dadosRetencoesIrs.lista.map(r => ({
      ...r,
      nif: modoPrivacidade ? mascararTexto(r.nif) : r.nif,
      nome: modoPrivacidade ? mascararTexto(r.nome) : r.nome,
    })),
    bottomTotalsRow: {
      nif: 'Total Geral',
      nome: '',
      ...dadosRetencoesIrs.totais,
    },
  });

  const construirSheetEfaturaDados = (): ExcelSheetInput => ({
    name: 'efaturaDados',
    title: 'efaturaDados (Base Horizontal Consolidada)',
    subtitle: nomeEntidadeCabecalho,
    columns: [
      { key: 'id_documento', label: 'IdDocumento', type: 'string', width: 22 },
      { key: 'setor_atividade', label: 'Atividade_Realizacao', type: 'string', width: 20 },
      { key: 'contraparte_nif', label: 'NIF_ComercianteConsumidor', type: 'string', width: 15 },
      { key: 'tipo_doc', label: 'TipoDoc', type: 'string', width: 18 },
      { key: 'situacao', label: 'Situacao', type: 'string', width: 12 },
      { key: 'n_fatura', label: 'N__Fatura', type: 'string', width: 24 },
      { key: 'atcud', label: 'CodControlo / ATCUD', type: 'string', width: 22 },
      { key: 'data_emissao', label: 'Data_Emiss_o', type: 'date', width: 13 },
      { key: 'total_iva', label: 'Total_Iva', type: 'currency', width: 13 },
      { key: 'total_liquido', label: 'Total_Liquido', type: 'currency', width: 14 },
      { key: 'base_tributavel', label: 'BaseTributavel', type: 'currency', width: 14 },
      { key: 'contraparte_nome', label: 'Nome_ComerConsu', type: 'string', width: 34 },
      { key: 'base_ise', label: 'Base_Ise', type: 'currency', width: 13 },
      { key: 'base_red', label: 'Base_Red', type: 'currency', width: 13 },
      { key: 'iva_red', label: 'Iva_Red', type: 'currency', width: 12 },
      { key: 'base_int', label: 'Base_Int', type: 'currency', width: 13 },
      { key: 'iva_int', label: 'Iva_Int', type: 'currency', width: 12 },
      { key: 'base_nor', label: 'Base_Nor', type: 'currency', width: 13 },
      { key: 'iva_nor', label: 'Iva_Nor', type: 'currency', width: 12 },
      { key: 'cv', label: 'CV', type: 'string', width: 6 },
      { key: 'ano', label: 'Ano', type: 'integer', width: 8 },
      { key: 'mes', label: 'Mes', type: 'integer', width: 8 },
      { key: 'dia_semana', label: 'DiaSemana', type: 'string', width: 10 },
      { key: 'docs_trabalho', label: 'DocsTrabalho', type: 'string', width: 14 },
    ],
    rows: docsEfaturaFiltrados.map(d => ({
      ...d,
      cv: tipoOperacao === 'compras' ? 'C' : 'V',
      contraparte_nif: modoPrivacidade ? mascararTexto(d.contraparte_nif) : d.contraparte_nif,
      contraparte_nome: modoPrivacidade ? mascararTexto(d.contraparte_nome) : d.contraparte_nome,
    })),
  });

  const notificarExportacao = (msg: string) => {
    setFeedbackExport(msg);
    window.setTimeout(() => setFeedbackExport(null), 3500);
  };

  const handleExportarMapaAtual = () => {
    const sufixoNif = nifSelecionado || 'TODAS';
    const cvCode = tipoOperacao === 'compras' ? 'C' : 'V';
    const mapaSheet: Record<SubVistaMapa, () => ExcelSheetInput> = {
      recapitulativos: construirSheetRecapitulativos,
      resumo_docs: construirSheetResumoDocs,
      por_tipo: construirSheetPorTipoDoc,
      por_dia: construirSheetPorDia,
      contagem: construirSheetContagem,
      retencoes_irs: construirSheetRetencoesIrs,
    };
    const sheet = mapaSheet[subVista]();
    const nome = `Mapa_${sheet.name.replace(/\s+/g, '_')}_${sufixoNif}_${cvCode}_${ano}.xlsx`;
    exportarMapaUnicoXlsx(nome, sheet);
    notificarExportacao(`Exportado: ${nome}`);
  };

  const handleExportarTodosMapas = () => {
    const sufixoNif = nifSelecionado || 'TODAS';
    const cvCode = tipoOperacao === 'compras' ? 'C' : 'V';
    const folhas: ExcelSheetInput[] = [
      construirSheetRecapitulativos(),
      construirSheetResumoDocs(),
      construirSheetPorTipoDoc(),
      construirSheetPorDia(),
      construirSheetContagem(),
      construirSheetEfaturaDados(),
      construirSheetRetencoesIrs(),
    ];
    const nome = `MapasResumo_Completo_${sufixoNif}_${cvCode}_${ano}.xlsx`;
    exportarTodosMapasXlsx(nome, folhas);
    notificarExportacao(`Livro completo (7 folhas) exportado: ${nome}`);
  };

  const handleExportarPorFornecedor = () => {
    if (linhasResumoDocs.length === 0) return;
    const sufixoNif = nifSelecionado || 'TODAS';
    const cvCode = tipoOperacao === 'compras' ? 'C' : 'V';
    const docsExport: DocHorizontalExportRow[] = linhasResumoDocs.map(d => ({
      contraparte_nif: modoPrivacidade ? mascararTexto(d.contraparte_nif) : d.contraparte_nif,
      contraparte_nome: modoPrivacidade ? mascararTexto(d.contraparte_nome) : d.contraparte_nome,
      tipo_doc: d.tipo_doc,
      n_fatura: d.n_fatura,
      data_emissao: d.data_emissao,
      base_tributavel: d.base_tributavel,
      total_iva: d.total_iva,
      total_liquido: d.total_liquido,
      base_ise: d.base_ise,
      base_red: d.base_red,
      iva_red: d.iva_red,
      base_int: d.base_int,
      iva_int: d.iva_int,
      base_nor: d.base_nor,
      iva_nor: d.iva_nor,
    }));
    const nome = `ResumoDocs_PorEntidade_${sufixoNif}_${cvCode}_${ano}.xlsx`;
    exportarDivididoPorFornecedorXlsx(nome, nomeEntidadeCabecalho, ano, cvCode, docsExport);
    notificarExportacao(`Exportado e dividido por entidade: ${nome}`);
  };

  const drilldownEntidadeParaResumoDocs = (nif: string) => {
    setFiltroContraparteNif(nif);
    setSubVista('resumo_docs');
  };

  const SUB_VISTAS: Array<{ id: SubVistaMapa; label: string; icon: typeof BarChart3 }> = [
    { id: 'recapitulativos', label: 'Recapitulativos', icon: Users },
    { id: 'resumo_docs', label: 'Resumo Documentos', icon: FileText },
    { id: 'por_tipo', label: 'Por Tipo Doc', icon: Layers },
    { id: 'por_dia', label: 'Por Dia', icon: CalendarDays },
    { id: 'contagem', label: 'Contagem Documentos', icon: Hash },
    { id: 'retencoes_irs', label: 'Retenções IRS', icon: Receipt },
  ];

  const renderThSortable = (
    vista: SubVistaMapa,
    col: string,
    label: string,
    align: 'left' | 'center' | 'right' = 'right',
    defaultDir: 'asc' | 'desc' = 'desc'
  ) => (
    <th
      onClick={() => handleSort(vista, col, defaultDir)}
      className={`px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-[#132233] border-b border-[#d7e0ea] dark:border-[#222f3e] cursor-pointer hover:bg-slate-200 dark:hover:bg-[#1b2e45] transition-colors whitespace-nowrap select-none ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
      title={`Ordenar por ${label}`}
    >
      <span className="inline-flex items-center">
        <span>{label}</span>
        {renderSortIcon(vista, col)}
      </span>
    </th>
  );

  return (
    <div className="h-full flex flex-col space-y-2.5 min-h-0 select-none overflow-y-auto lg:overflow-hidden">
      {/* 1. Cabeçalho Executivo evoGex.com */}
      <header className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <span className="page-kicker text-[#0284c7] dark:text-sky-400 font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            MAPAS ANALÍTICOS · TABELAS DINÂMICAS & EXPORTAÇÃO EXCEL
          </span>
          <h1 className="page-title text-lg sm:text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center flex-wrap gap-2">
            <BarChart3 className="w-5 h-5 text-[#0284c7] dark:text-sky-400 shrink-0" />
            <span>Mapas Resumo</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-700">
              <Calendar className="w-3.5 h-3.5" />
              {ano} · {tipoOperacao === 'compras' ? 'Compras (C)' : 'Vendas (V)'}
            </span>
          </h1>
        </div>

        {/* Botões do Assistente, Exportação Excel & Atualização */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {feedbackExport && (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-[11px] font-mono font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{feedbackExport}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => (assistenteAberto ? fecharAssistente() : abrirAssistente())}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold transition shadow-xs cursor-pointer ${
              assistenteAberto
                ? 'bg-[#eef2ff] dark:bg-[#162032] text-[#4338ca] dark:text-[#a5b4fc] border border-[#4f46e5] dark:border-[#6366f1]'
                : 'bg-[#4f46e5] hover:bg-[#4338ca] text-white border border-[#4f46e5]'
            }`}
            title="Abrir ou fechar o Assistente Guiado Passo a Passo"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{assistenteAberto ? 'Ocultar Assistente' : 'Assistente Passo a Passo'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportarMapaAtual}
            disabled={carregando}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#152334] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 transition cursor-pointer shadow-2xs"
            title="Exportar apenas o mapa atualmente visível para Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <span>Exportar Mapa</span>
          </button>

          <button
            type="button"
            onClick={handleExportarPorFornecedor}
            disabled={carregando || linhasResumoDocs.length === 0}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold border transition cursor-pointer shadow-2xs ${
              linhasResumoDocs.length === 0
                ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-[#101c2b] border-[#d7e0ea] dark:border-[#222f3e] text-slate-500'
                : subVista === 'resumo_docs'
                  ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white'
                  : 'bg-emerald-50 dark:bg-[#091e1a] hover:bg-emerald-100 dark:hover:bg-[#0d2b25] border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
            }`}
            title="Exportar Resumo Documentos dividido com 1 separador Excel por cada NIF"
          >
            <FolderArchive className="w-3.5 h-3.5 shrink-0" />
            <span>Dividir p/ Fornecedor</span>
          </button>

          <button
            type="button"
            onClick={handleExportarTodosMapas}
            disabled={carregando}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-bold bg-[#0284c7] hover:bg-[#0369a1] border border-[#0284c7] text-white transition cursor-pointer shadow-xs"
            title="Exportar todos os 7 mapas e tabelas para um único ficheiro Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar Todos os Mapas</span>
          </button>

          <button
            type="button"
            onClick={carregarDados}
            disabled={carregando}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#152334] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 transition cursor-pointer shadow-2xs"
            title="Recarregar dados da base SQLite"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin text-[#0284c7]' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </header>

      {/* Área Principal + Assistente Encaixado à Direita */}
      <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0">

        {/* Lado Esquerdo: Controlos (4 Zonas Sincronizadas) + Sub-vistas + KPIs + Tabela */}
        <div className="flex-1 flex flex-col gap-2.5 min-w-0 min-h-0">

      {/* 2. Cartão de Controlos e Filtros Dinâmicos (4 Zonas Sincronizadas · 100% Opaco · Evo Grid) */}
      <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2.5 space-y-2 shadow-2xs shrink-0 overflow-visible before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
        {/* Linha 1: Zona 1 (Destino) + Zona 2 (Fluxo & Empresas) + Zona 4 (Opções & Consultar) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Zona 1: Pasta de Destino dos Dados */}
          <div
            data-evo-guide-target="zona-1"
            onClick={() => assistenteAberto && setPassoAssistente(1)}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[11px] font-mono transition ${
              assistenteAberto && passoAssistente === 1
                ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                : 'bg-slate-50 dark:bg-[#101c2b] border-[#d7e0ea] dark:border-[#1e344f]'
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
              onClick={e => { e.stopPropagation(); copiarCaminhoDados(); }}
              title="Copiar endereço completo (📋)"
              className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-[#0284c7] cursor-pointer shrink-0"
            >
              {copiadoPasta ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              data-evo-guide-target="btn-abrir-pasta"
              onClick={e => { e.stopPropagation(); abrirPastaDadosWindows(); }}
              title="Abrir pasta no Explorador do Windows (📂)"
              className="p-0.5 text-[#0284c7] dark:text-sky-400 hover:opacity-80 cursor-pointer shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Zona 2: Fluxo (Compras/Vendas) + Empresa + DocsTrabalho + Pesquisa */}
          <div
            data-evo-guide-target="zona-2"
            onClick={() => assistenteAberto && setPassoAssistente(2)}
            className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded border transition flex-1 min-w-0 ${
              assistenteAberto && passoAssistente === 2
                ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                : 'bg-slate-50 dark:bg-[#101c2b] border-[#d7e0ea] dark:border-[#1e344f]'
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

            {/* Alternador Compras (C) / Vendas (V) */}
            <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] p-0.5 rounded border border-[#d7e0ea] dark:border-[#222f3e] shrink-0">
              <button
                type="button"
                data-evo-guide-target="op-compras"
                onClick={() => setTipoOperacao('compras')}
                className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                  tipoOperacao === 'compras'
                    ? 'bg-[#0284c7] text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Compras (C)</span>
              </button>
              <button
                type="button"
                data-evo-guide-target="op-vendas"
                onClick={() => setTipoOperacao('vendas')}
                className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                  tipoOperacao === 'vendas'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Vendas (V)</span>
              </button>
            </div>

            {/* Seletor de Empresa + Contador */}
            <div data-evo-guide-target="empresa-selector" className="flex items-center gap-1.5 w-full sm:w-auto">
              <EmpresaSelectorCombobox
                entidades={entidades}
                value={nifSelecionado}
                onChange={nif => {
                  setNifSelecionado(nif);
                  setFiltroContraparteNif('');
                  if (nif) {
                    setSelecionadasAssistente(new Set([nif]));
                  } else {
                    setSelecionadasAssistente(
                      new Set(entidades.map(e => (e.nif || e.nif_cc || '').trim()).filter(Boolean))
                    );
                  }
                }}
                modoPrivacidade={modoPrivacidade}
                allLabel={`Todas as Empresas (${entidades.length})`}
                placeholder="Pesquisar empresa (NIF ou nome)..."
                className="w-full sm:w-auto sm:min-w-[230px] max-w-full sm:max-w-[320px]"
                dropdownClassName="w-96 md:w-[460px]"
                align="left"
              />
              <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200 font-semibold px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] shrink-0 tabular-nums">
                {selecionadasAssistente.size}/{entidades.length}
              </span>
            </div>

            {/* Filtro DocsTrabalho (tDocsNãoAdmitidos) */}
            <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] p-0.5 rounded border border-[#d7e0ea] dark:border-[#222f3e] shrink-0">
              {(
                [
                  { id: 'todos', label: 'Todos Docs' },
                  { id: 'fiscais', label: 'Omitir Docs Trabalho' },
                  { id: 'trabalho', label: 'Só Docs Trabalho' },
                ] as const
              ).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFiltroDocsTrabalho(opt.id)}
                  className={`px-2 py-1 text-[11px] font-mono rounded font-semibold transition cursor-pointer ${
                    filtroDocsTrabalho === opt.id
                      ? 'bg-slate-800 dark:bg-sky-500 text-white dark:text-slate-950'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Pesquisa Rápida */}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                value={pesquisa}
                onChange={e => setPesquisa(e.target.value)}
                placeholder="Filtrar NIF, nome ou n.º fatura..."
                className="w-full pl-8 pr-7 py-1.5 text-xs font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-foreground placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:border-[#0284c7]"
              />
              {pesquisa && (
                <button
                  type="button"
                  onClick={() => setPesquisa('')}
                  className="absolute right-2 top-2 text-slate-500 hover:text-foreground cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Zona 4: Opções & Consultar */}
          <div
            data-evo-guide-target="zona-4"
            onClick={() => assistenteAberto && setPassoAssistente(4)}
            className={`flex items-center space-x-2 px-2 py-1 rounded border transition shrink-0 ${
              assistenteAberto && passoAssistente === 4
                ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
                : 'bg-slate-50 dark:bg-[#101c2b] border-[#d7e0ea] dark:border-[#1e344f]'
            }`}
          >
            {assistenteAberto && (
              <span
                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                  passoAssistente === 4 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                ④ Consultar
              </span>
            )}

            <button
              type="button"
              data-evo-guide-target="btn-opcoes"
              onClick={e => {
                e.stopPropagation();
                if (!assistenteAberto) abrirAssistente();
                setPassoAssistente(4);
              }}
              className="px-2 py-1.5 rounded border text-[11px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] border-slate-300 dark:border-[#253a52] text-foreground"
              title="Abrir opções rápidas de vista e exportação no Assistente"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
              <span>Opções</span>
            </button>

            <button
              type="button"
              data-evo-guide-target="btn-iniciar"
              onClick={e => {
                e.stopPropagation();
                carregarDados();
              }}
              disabled={carregando}
              className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-60 text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer shadow-xs transition"
              title="Consultar e recalcular os Mapas Resumo"
            >
              {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Consultar</span>
            </button>
          </div>
        </div>

        {/* Linha 2: Zona 3 (Período: Ano + Atalhos + 12 Meses + TipoDoc + Setor + DiaSemana) */}
        <div
          data-evo-guide-target="zona-3"
          onClick={() => assistenteAberto && setPassoAssistente(3)}
          className={`flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 rounded border transition ${
            assistenteAberto && passoAssistente === 3
              ? 'ring-2 ring-[#4f46e5] bg-[#eef2ff] dark:bg-[#161f33] border-[#4f46e5] shadow-md'
              : 'bg-slate-50 dark:bg-[#101c2b] border-[#d7e0ea] dark:border-[#1e344f]'
          }`}
        >
          {/* Pílulas Temporais */}
          <div className="flex flex-wrap items-center gap-1">
            {assistenteAberto && (
              <span
                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                  passoAssistente === 3 ? 'bg-[#4f46e5] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}
              >
                ③ Período
              </span>
            )}

            {/* Seletor de Ano */}
            <div
              data-evo-guide-target="ano-selector"
              className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] border border-[#0284c7] dark:border-sky-600 rounded px-2 py-0.5 shrink-0"
            >
              <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
              <button
                type="button"
                onClick={() => onAnoChange(ano - 1)}
                className="p-0.5 rounded hover:bg-sky-200 dark:hover:bg-[#14304d] text-slate-800 dark:text-slate-100 cursor-pointer"
                title="Ano Anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono font-bold text-xs text-slate-900 dark:text-white px-1 min-w-[38px] text-center tabular-nums">
                {ano}
              </span>
              <button
                type="button"
                onClick={() => onAnoChange(ano < anoAtual ? ano + 1 : ano)}
                disabled={ano >= anoAtual}
                className={`p-0.5 rounded ${
                  ano >= anoAtual
                    ? 'opacity-30 cursor-not-allowed text-slate-400'
                    : 'hover:bg-sky-200 dark:hover:bg-[#14304d] text-slate-800 dark:text-slate-100 cursor-pointer'
                }`}
                title="Ano Seguinte"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              data-evo-guide-target="periodo-ano-todo"
              onClick={aplicarAnoTodo}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                mesFiltro === null && trimestreFiltro === null && (!mesesCustomAssistente || mesesCustomAssistente.size === 0 || mesesCustomAssistente.size === 12)
                  ? 'bg-[#0284c7] border-[#0284c7] text-white'
                  : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
              }`}
            >
              Ano Todo
            </button>

            {ano === anoAtual && (
              <button
                type="button"
                data-evo-guide-target="periodo-mes-atual"
                onClick={aplicarMesAtual}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                  mesFiltro === mesAtual && !mesesCustomAssistente
                    ? 'bg-[#0284c7] border-[#0284c7] text-white'
                    : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                }`}
              >
                Mês Atual
              </button>
            )}

            {[1, 2, 3, 4].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => aplicarTrimestre(t)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                  trimestreFiltro === t
                    ? 'bg-[#0284c7] border-[#0284c7] text-white'
                    : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                }`}
              >
                {t}T
              </button>
            ))}
            <span className="h-3.5 w-px bg-[#d7e0ea] dark:bg-[#222f3e] mx-0.5" />
            {MESES.map(m => {
              const ativoMes =
                mesFiltro === m.num ||
                (mesesCustomAssistente ? mesesCustomAssistente.has(m.num) : false);
              return (
                <button
                  key={m.num}
                  type="button"
                  onClick={() => {
                    setTrimestreFiltro(null);
                    setMesesCustomAssistente(null);
                    setMesFiltro(prev => (prev === m.num ? null : m.num));
                  }}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                    ativoMes
                      ? 'bg-[#0284c7] border-[#0284c7] text-white'
                      : 'bg-white dark:bg-[#0c1520] border-[#d7e0ea] dark:border-[#222f3e] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162538]'
                  }`}
                >
                  {m.nome}
                </button>
              );
            })}
          </div>

          {/* Dropdowns de Tabela Dinâmica */}
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={filtroTipoDoc}
              onChange={e => setFiltroTipoDoc(e.target.value)}
              className="px-2 py-1 rounded text-[11px] font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none focus:border-[#0284c7]"
              title="Filtrar por Tipo de Documento"
            >
              <option value="">Tipo Doc: (Tudo)</option>
              {opcoesTipoDoc.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              value={filtroSetor}
              onChange={e => setFiltroSetor(e.target.value)}
              className="px-2 py-1 rounded text-[11px] font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none focus:border-[#0284c7]"
              title="Filtrar por Atividade / Setor"
            >
              <option value="">Setor: (Tudo)</option>
              {opcoesSetor.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={filtroDiaSemana}
              onChange={e => setFiltroDiaSemana(e.target.value)}
              className="px-2 py-1 rounded text-[11px] font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none focus:border-[#0284c7]"
              title="Filtrar por Dia da Semana"
            >
              <option value="">Dia Semana: (Tudo)</option>
              {DIAS_SEMANA.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {filtroContraparteNif && (
              <button
                type="button"
                onClick={() => setFiltroContraparteNif('')}
                className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-mono font-bold bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] text-[#0284c7] dark:text-sky-300 cursor-pointer"
                title="Remover filtro da contraparte selecionada"
              >
                <span>
                  Contraparte: {modoPrivacidade ? mascararTexto(filtroContraparteNif) : filtroContraparteNif}
                </span>
                <X className="w-3 h-3" />
              </button>
            )}

            {temFiltrosAtivos && (
              <button
                type="button"
                onClick={limparFiltros}
                className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-mono font-semibold bg-rose-50 dark:bg-[#240e14] border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-[#33131c] cursor-pointer"
              >
                <FilterX className="w-3 h-3" />
                <span>Limpar Filtros</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Barra das 6 Sub-Vistas + Totais Executivos */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1 bg-white dark:bg-[#0c1520] p-1 rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs">
          {SUB_VISTAS.map(tab => {
            const Icon = tab.icon;
            const ativo = subVista === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubVista(tab.id)}
                className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold flex items-center space-x-1.5 transition cursor-pointer ${
                  ativo
                    ? 'bg-[#0284c7] text-white shadow-2xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#152334]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Opções específicas da sub-vista ativa */}
        {subVista === 'resumo_docs' && (
          <label className="flex items-center space-x-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-xs font-mono text-slate-800 dark:text-slate-100 cursor-pointer">
            <input
              type="checkbox"
              checked={agruparPorFornecedor}
              onChange={e => setAgruparPorFornecedor(e.target.checked)}
              className="rounded border-slate-400 text-[#0284c7] focus:ring-0 cursor-pointer"
            />
            <span>Mostrar subtotais por entidade</span>
          </label>
        )}

        {subVista === 'retencoes_irs' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] p-1 rounded-md border border-[#d7e0ea] dark:border-[#222f3e]">
              {(
                [
                  { id: 'emitidos', label: 'Omitir Anulados' },
                  { id: 'todos', label: 'Ver Todos (Inclui Anulados)' },
                  { id: 'anulados', label: 'Ver só Anulados' },
                ] as const
              ).map(btn => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setFiltroSituacaoIRS(btn.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold cursor-pointer transition ${
                    filtroSituacaoIRS === btn.id
                      ? btn.id === 'anulados'
                        ? 'bg-rose-600 text-white'
                        : 'bg-[#0284c7] text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#152334]'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <select
              value={filtroTipoRV}
              onChange={e => setFiltroTipoRV(e.target.value as 'todos' | 'rv' | 'rendas')}
              className="px-2 py-1.5 rounded-md text-[11px] font-mono bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              <option value="todos">Tipo: Todos (RV + Rendas)</option>
              <option value="rv">Só Recibos Verdes</option>
              <option value="rendas">Só Recibos de Renda</option>
            </select>
          </div>
        )}
      </div>

      {/* 4. Faixa de Totais Dinâmicos no Topo (100% Opaco · Equivalente Linha 12 GETPIVOTDATA) */}
      {subVista !== 'contagem' && subVista !== 'retencoes_irs' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0">
          <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300 block">
              Documentos
            </span>
            <span className="text-sm font-mono font-bold text-slate-900 dark:text-white tabular-nums">
              {totaisEfatura.docs.toLocaleString('pt-PT')}
            </span>
          </div>
          <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300 block">
              Base Tributável
            </span>
            <span className="text-sm font-mono font-bold text-slate-900 dark:text-white tabular-nums">
              {formatarMoeda(totaisEfatura.base_tributavel)} €
            </span>
          </div>
          <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300 block">
              Total IVA
            </span>
            <span className="text-sm font-mono font-bold text-[#0284c7] dark:text-sky-400 tabular-nums">
              {formatarMoeda(totaisEfatura.total_iva)} €
            </span>
          </div>
          <div className="bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-700 rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-[#0369a1] dark:text-sky-300 font-semibold block">
              Total Líquido
            </span>
            <span className="text-sm font-mono font-bold text-[#0369a1] dark:text-sky-200 tabular-nums">
              {formatarMoeda(totaisEfatura.total_liquido)} €
            </span>
          </div>
          <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300 block">
              Base Isenta
            </span>
            <span className="text-sm font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">
              {formatarMoeda(totaisEfatura.base_ise)} €
            </span>
          </div>
          <div className="bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md px-3 py-2 shadow-2xs">
            <span className="text-[10px] font-mono uppercase text-slate-600 dark:text-slate-300 block">
              Base 23% / IVA 23%
            </span>
            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">
              {formatarMoeda(totaisEfatura.base_nor)} / {formatarMoeda(totaisEfatura.iva_nor)} €
            </span>
          </div>
        </div>
      )}

      {erroCarga && (
        <div className="bg-rose-50 dark:bg-[#240e14] border border-rose-300 dark:border-rose-800 rounded-md px-3 py-2 flex items-center space-x-2 text-xs font-mono text-rose-800 dark:text-rose-200 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{erroCarga}</span>
        </div>
      )}

      {/* 5. Área da Tabela Dinâmica Ativa */}
      <div className="flex-1 min-h-[280px] flex flex-col overflow-hidden">
        {subVista === 'contagem' ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 min-h-0 overflow-y-auto">
            {/* Cartão Esquerdo: E-FATURA */}
            <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] flex flex-col overflow-hidden shadow-2xs">
              <div className="px-3.5 py-2.5 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#0284c7] dark:text-sky-400 font-bold block">
                    Contagem de Documentos
                  </span>
                  <h3 className="text-sm font-display font-medium text-slate-900 dark:text-white">
                    E-FATURA ({ano})
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-700 text-xs font-mono font-bold text-[#0369a1] dark:text-sky-300 tabular-nums">
                  {contagemDocumentos.grandTotalEf.toLocaleString('pt-PT')} docs
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-b border-[#d7e0ea] dark:border-[#222f3e]">
                        Mês
                      </th>
                      {contagemDocumentos.colunasSituacaoEf.map(sit => (
                        <th
                          key={sit}
                          className="px-3 py-2 text-right font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-b border-[#d7e0ea] dark:border-[#222f3e]"
                        >
                          {sit}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-900 dark:text-white border-b border-[#d7e0ea] dark:border-[#222f3e]">
                        Total Geral
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contagemDocumentos.linhasEf.length === 0 ? (
                      <tr>
                        <td
                          colSpan={contagemDocumentos.colunasSituacaoEf.length + 2}
                          className="px-4 py-8 text-center font-mono text-xs text-slate-600 dark:text-slate-300"
                        >
                          Sem documentos e-Fatura para o ano {ano}.
                        </td>
                      </tr>
                    ) : (
                      contagemDocumentos.linhasEf.map(row => (
                        <tr
                          key={row.mes}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233]"
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800 dark:text-slate-100">
                            {row.labelMes}
                          </td>
                          {contagemDocumentos.colunasSituacaoEf.map(sit => (
                            <td
                              key={sit}
                              className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200"
                            >
                              {(row.counts[sit] || 0).toLocaleString('pt-PT')}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                            {row.total.toLocaleString('pt-PT')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {contagemDocumentos.linhasEf.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7]">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900 dark:text-white">
                          Total Geral
                        </td>
                        {contagemDocumentos.colunasSituacaoEf.map(sit => (
                          <td
                            key={sit}
                            className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white"
                          >
                            {(contagemDocumentos.totaisEf[sit] || 0).toLocaleString('pt-PT')}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-[#0284c7] dark:text-sky-400">
                          {contagemDocumentos.grandTotalEf.toLocaleString('pt-PT')}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Cartão Direito: RECIBOS ELETRÓNICOS */}
            <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] flex flex-col overflow-hidden shadow-2xs">
              <div className="px-3.5 py-2.5 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101c2b] flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold block">
                    Contagem de Documentos
                  </span>
                  <h3 className="text-sm font-display font-medium text-slate-900 dark:text-white">
                    RECIBOS ELETRÓNICOS ({ano})
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-700 text-xs font-mono font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">
                  {contagemDocumentos.grandTotalRv.toLocaleString('pt-PT')} docs
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-b border-[#d7e0ea] dark:border-[#222f3e]">
                        Mês Emissão
                      </th>
                      {contagemDocumentos.colunasSituacaoRv.map(sit => (
                        <th
                          key={sit}
                          className="px-3 py-2 text-right font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-b border-[#d7e0ea] dark:border-[#222f3e]"
                        >
                          {sit}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase bg-slate-100 dark:bg-[#132233] text-slate-900 dark:text-white border-b border-[#d7e0ea] dark:border-[#222f3e]">
                        Total Geral
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contagemDocumentos.linhasRv.length === 0 ? (
                      <tr>
                        <td
                          colSpan={contagemDocumentos.colunasSituacaoRv.length + 2}
                          className="px-4 py-8 text-center font-mono text-xs text-slate-600 dark:text-slate-300"
                        >
                          Sem recibos eletrónicos para o ano {ano}.
                        </td>
                      </tr>
                    ) : (
                      contagemDocumentos.linhasRv.map(row => (
                        <tr
                          key={row.mes}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233]"
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800 dark:text-slate-100">
                            {row.labelMes}
                          </td>
                          {contagemDocumentos.colunasSituacaoRv.map(sit => (
                            <td
                              key={sit}
                              className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200"
                            >
                              {(row.counts[sit] || 0).toLocaleString('pt-PT')}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                            {row.total.toLocaleString('pt-PT')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {contagemDocumentos.linhasRv.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-emerald-600">
                        <td className="px-3 py-2 font-mono font-bold text-slate-900 dark:text-white">
                          Total Geral
                        </td>
                        {contagemDocumentos.colunasSituacaoRv.map(sit => (
                          <td
                            key={sit}
                            className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white"
                          >
                            {(contagemDocumentos.totaisRv[sit] || 0).toLocaleString('pt-PT')}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {contagemDocumentos.grandTotalRv.toLocaleString('pt-PT')}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* Cartão único com tabela de largura total para as restantes 5 sub-vistas */
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] flex-1 flex flex-col min-h-0 overflow-hidden shadow-2xs">
            <div className="flex-1 overflow-auto">
              {/* SUB-VISTA 1: RECAPITULATIVOS */}
              {subVista === 'recapitulativos' && (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {renderThSortable('recapitulativos', 'contraparte_nif', 'NIF Entidade', 'left', 'asc')}
                      {renderThSortable('recapitulativos', 'contraparte_nome', 'Nome Contraparte', 'left', 'asc')}
                      {renderThSortable('recapitulativos', 'docs', 'Docs')}
                      {renderThSortable('recapitulativos', 'base_tributavel', 'Base Tributável')}
                      {renderThSortable('recapitulativos', 'total_iva', 'Total IVA')}
                      {renderThSortable('recapitulativos', 'total_liquido', 'Total Líquido')}
                      {renderThSortable('recapitulativos', 'base_ise', 'Base Isenta')}
                      {renderThSortable('recapitulativos', 'base_red', 'Base Red.')}
                      {renderThSortable('recapitulativos', 'iva_red', 'IVA Red.')}
                      {renderThSortable('recapitulativos', 'base_int', 'Base Int.')}
                      {renderThSortable('recapitulativos', 'iva_int', 'IVA Int.')}
                      {renderThSortable('recapitulativos', 'base_nor', 'Base Nor.')}
                      {renderThSortable('recapitulativos', 'iva_nor', 'IVA Nor.')}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasRecapitulativos.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="px-4 py-10 text-center font-mono text-xs text-slate-600 dark:text-slate-300"
                        >
                          {carregando
                            ? 'A consolidar mapas resumo...'
                            : 'Sem documentos correspondentes aos filtros selecionados.'}
                        </td>
                      </tr>
                    ) : (
                      linhasRecapitulativos.map(row => (
                        <tr
                          key={`${row.contraparte_nif}_${row.contraparte_nome}`}
                          onClick={() => drilldownEntidadeParaResumoDocs(row.contraparte_nif)}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-sky-50 dark:hover:bg-[#132233] cursor-pointer transition-colors"
                          title="Clique para abrir o extrato de documentos desta entidade"
                        >
                          <td className="px-2.5 py-1.5 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {modoPrivacidade ? mascararTexto(row.contraparte_nif) : row.contraparte_nif}
                          </td>
                          <td className="px-2.5 py-1.5 font-sans font-medium text-slate-900 dark:text-slate-100 max-w-[280px] truncate">
                            {modoPrivacidade ? mascararTexto(row.contraparte_nome) : row.contraparte_nome}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {row.docs}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {formatarMoeda(row.base_tributavel)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[#0284c7] dark:text-sky-400">
                            {formatarMoeda(row.total_iva)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                            {formatarMoeda(row.total_liquido)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.base_ise)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.base_red)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.iva_red)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.base_int)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.iva_int)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.base_nor)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.iva_nor)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {linhasRecapitulativos.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="px-2.5 py-2" colSpan={2}>
                          Total Geral ({linhasRecapitulativos.length} entidades)
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{totaisEfatura.docs}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_tributavel)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(totaisEfatura.total_iva)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.total_liquido)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_ise)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_nor)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_nor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}

              {/* SUB-VISTA 2: RESUMO DOCUMENTOS */}
              {subVista === 'resumo_docs' && (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {renderThSortable('resumo_docs', 'contraparte_nif', 'NIF', 'left', 'asc')}
                      {renderThSortable('resumo_docs', 'contraparte_nome', 'Nome Contraparte', 'left', 'asc')}
                      {renderThSortable('resumo_docs', 'tipo_doc', 'Tipo Doc', 'left', 'asc')}
                      {renderThSortable('resumo_docs', 'n_fatura', 'N.º Fatura', 'left', 'asc')}
                      {renderThSortable('resumo_docs', 'data_emissao', 'Data Emissão', 'center', 'desc')}
                      {renderThSortable('resumo_docs', 'base_tributavel', 'Base Trib.')}
                      {renderThSortable('resumo_docs', 'total_iva', 'Total IVA')}
                      {renderThSortable('resumo_docs', 'total_liquido', 'Total Líq.')}
                      {renderThSortable('resumo_docs', 'base_ise', 'Base Isenta')}
                      {renderThSortable('resumo_docs', 'base_red', 'Base Red.')}
                      {renderThSortable('resumo_docs', 'iva_red', 'IVA Red.')}
                      {renderThSortable('resumo_docs', 'base_int', 'Base Int.')}
                      {renderThSortable('resumo_docs', 'iva_int', 'IVA Int.')}
                      {renderThSortable('resumo_docs', 'base_nor', 'Base Nor.')}
                      {renderThSortable('resumo_docs', 'iva_nor', 'IVA Nor.')}
                    </tr>
                  </thead>
                  <tbody>
                    {resumoDocsComSubtotais.items.length === 0 ? (
                      <tr>
                        <td
                          colSpan={15}
                          className="px-4 py-10 text-center font-mono text-xs text-slate-600 dark:text-slate-300"
                        >
                          {carregando
                            ? 'A carregar documentos...'
                            : 'Sem documentos correspondentes aos filtros selecionados.'}
                        </td>
                      </tr>
                    ) : (
                      resumoDocsComSubtotais.items.map((item, idx) => {
                        if (item.kind === 'subtotal') {
                          return (
                            <tr
                              key={`sub_${item.nif}_${idx}`}
                              className="bg-sky-50 dark:bg-[#0a1929] border-b border-sky-200 dark:border-sky-900 font-mono font-bold text-[#0369a1] dark:text-sky-300"
                            >
                              <td className="px-2.5 py-1.5" colSpan={5}>
                                Subtotal · {modoPrivacidade ? mascararTexto(item.nif) : item.nif} —{' '}
                                {modoPrivacidade ? mascararTexto(item.nome) : item.nome} ({item.agregado.docs} docs)
                              </td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.base_tributavel)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.total_iva)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.total_liquido)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.base_ise)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.base_red)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.iva_red)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.base_int)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.iva_int)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.base_nor)}</td>
                              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatarMoeda(item.agregado.iva_nor)}</td>
                            </tr>
                          );
                        }

                        const d = item.doc;
                        return (
                          <tr
                            key={d.id_documento}
                            className={`border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233] ${
                              d.situacao === 'Anulado' ? 'bg-rose-50 dark:bg-[#240e14]' : ''
                            }`}
                          >
                            <td className="px-2.5 py-1.5 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {modoPrivacidade ? mascararTexto(d.contraparte_nif) : d.contraparte_nif}
                            </td>
                            <td className="px-2.5 py-1.5 font-sans text-slate-900 dark:text-slate-100 max-w-[230px] truncate">
                              {modoPrivacidade ? mascararTexto(d.contraparte_nome) : d.contraparte_nome}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {d.tipo_doc}
                              {d.situacao === 'Anulado' && (
                                <span className="ml-1.5 px-1 py-0.5 rounded bg-rose-600 text-white text-[9px] font-bold">
                                  ANULADO
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                              {d.n_fatura}
                            </td>
                            <td className="px-2.5 py-1.5 text-center font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {formatarDataPt(d.data_emissao)}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">{formatarMoeda(d.base_tributavel)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(d.total_iva)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">{formatarMoeda(d.total_liquido)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.base_ise)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.base_red)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.iva_red)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.base_int)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.iva_int)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.base_nor)}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(d.iva_nor)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {linhasResumoDocs.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="px-2.5 py-2" colSpan={5}>
                          Total Geral ({totaisEfatura.docs} documentos)
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_tributavel)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(totaisEfatura.total_iva)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.total_liquido)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_ise)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_nor)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_nor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}

              {/* SUB-VISTA 3: POR TIPO DOC (13 COLUNAS + DOCS) */}
              {subVista === 'por_tipo' && (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {renderThSortable('por_tipo', 'tipo_doc', 'Tipo Doc', 'left', 'asc')}
                      {renderThSortable('por_tipo', 'docs', 'Docs')}
                      {renderThSortable('por_tipo', 'base_tributavel', 'Base Trib.')}
                      {renderThSortable('por_tipo', 'total_iva', 'Total IVA')}
                      {renderThSortable('por_tipo', 'total_liquido', 'Total Líq.')}
                      {renderThSortable('por_tipo', 'base_ise', 'Base Isenta')}
                      {renderThSortable('por_tipo', 'base_red', 'Base Red.')}
                      {renderThSortable('por_tipo', 'iva_red', 'IVA Red.')}
                      {renderThSortable('por_tipo', 'liquido_red', 'Líq. Red.')}
                      {renderThSortable('por_tipo', 'base_int', 'Base Int.')}
                      {renderThSortable('por_tipo', 'iva_int', 'IVA Int.')}
                      {renderThSortable('por_tipo', 'liquido_int', 'Líq. Int.')}
                      {renderThSortable('por_tipo', 'base_nor', 'Base Nor.')}
                      {renderThSortable('por_tipo', 'iva_nor', 'IVA Nor.')}
                      {renderThSortable('por_tipo', 'liquido_nor', 'Líq. Nor.')}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasPorTipoDoc.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-4 py-10 text-center font-mono text-xs text-slate-600 dark:text-slate-300">
                          Sem documentos correspondentes aos filtros selecionados.
                        </td>
                      </tr>
                    ) : (
                      linhasPorTipoDoc.map(row => (
                        <tr
                          key={row.tipo_doc}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233]"
                        >
                          <td className="px-2.5 py-2 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                            {row.tipo_doc}
                            {isDocTrabalho(row.tipo_doc) && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-[#241a08] border border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-[9px]">
                                Doc Trabalho
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.docs}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">{formatarMoeda(row.base_tributavel)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(row.total_iva)}</td>
                          <td className="px-2.5 py-2 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">{formatarMoeda(row.total_liquido)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_ise)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_red)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_red)}</td>
                          <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-sky-200">{formatarMoeda(row.liquido_red)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_int)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_int)}</td>
                          <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-sky-200">{formatarMoeda(row.liquido_int)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_nor)}</td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_nor)}</td>
                          <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-sky-200">{formatarMoeda(row.liquido_nor)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {linhasPorTipoDoc.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="px-2.5 py-2">Total Geral</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{totaisEfatura.docs}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_tributavel)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(totaisEfatura.total_iva)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.total_liquido)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_ise)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_red + totaisEfatura.iva_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_int + totaisEfatura.iva_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_nor)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_nor)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_nor + totaisEfatura.iva_nor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}

              {/* SUB-VISTA 4: POR DIA */}
              {subVista === 'por_dia' && (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {renderThSortable('por_dia', 'data_emissao', 'Data Emissão', 'left', 'desc')}
                      {renderThSortable('por_dia', 'dia_semana', 'Dia', 'center', 'asc')}
                      {renderThSortable('por_dia', 'docs', 'Docs')}
                      {renderThSortable('por_dia', 'base_tributavel', 'Base Tributável')}
                      {renderThSortable('por_dia', 'total_iva', 'Total IVA')}
                      {renderThSortable('por_dia', 'total_liquido', 'Total Líquido')}
                      {renderThSortable('por_dia', 'base_ise', 'Base Isenta')}
                      {renderThSortable('por_dia', 'base_red', 'Base Red.')}
                      {renderThSortable('por_dia', 'iva_red', 'IVA Red.')}
                      {renderThSortable('por_dia', 'base_int', 'Base Int.')}
                      {renderThSortable('por_dia', 'iva_int', 'IVA Int.')}
                      {renderThSortable('por_dia', 'base_nor', 'Base Nor.')}
                      {renderThSortable('por_dia', 'iva_nor', 'IVA Nor.')}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasPorDia.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="px-4 py-10 text-center font-mono text-xs text-slate-600 dark:text-slate-300">
                          Sem documentos correspondentes aos filtros selecionados.
                        </td>
                      </tr>
                    ) : (
                      linhasPorDia.map(row => (
                        <tr
                          key={row.data_emissao}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233]"
                        >
                          <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap tabular-nums">
                            {formatarDataPt(row.data_emissao)}
                          </td>
                          <td className="px-2.5 py-1.5 text-center font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-[10px] text-slate-700 dark:text-slate-200 uppercase">
                              {row.dia_semana || '-'}
                            </span>
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.docs}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">{formatarMoeda(row.base_tributavel)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(row.total_iva)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">{formatarMoeda(row.total_liquido)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_ise)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_red)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_red)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_int)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_int)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.base_nor)}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatarMoeda(row.iva_nor)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {linhasPorDia.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="px-2.5 py-2" colSpan={2}>
                          Total Geral ({linhasPorDia.length} dias)
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{totaisEfatura.docs}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_tributavel)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-[#0284c7] dark:text-sky-400">{formatarMoeda(totaisEfatura.total_iva)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.total_liquido)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_ise)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_red)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_int)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.base_nor)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatarMoeda(totaisEfatura.iva_nor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}

              {/* SUB-VISTA 5: RESUMO RETENÇÕES IRS */}
              {subVista === 'retencoes_irs' && (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {renderThSortable('retencoes_irs', 'nif', 'NIF Entidade', 'left', 'asc')}
                      {renderThSortable('retencoes_irs', 'nome', 'Nome Emitente / Contraparte', 'left', 'asc')}
                      {renderThSortable('retencoes_irs', 'docs', 'Docs')}
                      {renderThSortable('retencoes_irs', 'valor_base', 'Soma Valor Base (€)')}
                      {renderThSortable('retencoes_irs', 'valor_irs', 'Soma Retenção IRS (€)')}
                      {renderThSortable('retencoes_irs', 'valor_iva', 'Soma IVA (€)')}
                      {renderThSortable('retencoes_irs', 'imposto_selo', 'Imposto Selo (€)')}
                      {renderThSortable('retencoes_irs', 'importancia_recebida', 'Importância Líquida (€)')}
                    </tr>
                  </thead>
                  <tbody>
                    {dadosRetencoesIrs.lista.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center font-mono text-xs text-slate-600 dark:text-slate-300">
                          {carregando
                            ? 'A carregar recibos verdes e rendas...'
                            : 'Sem recibos verdes ou rendas correspondentes aos filtros atuais.'}
                        </td>
                      </tr>
                    ) : (
                      dadosRetencoesIrs.lista.map(row => (
                        <tr
                          key={`${row.nif}_${row.nome}`}
                          className="border-b border-slate-200 dark:border-[#1c2b3d] hover:bg-slate-50 dark:hover:bg-[#132233]"
                        >
                          <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {modoPrivacidade ? mascararTexto(row.nif) : row.nif}
                          </td>
                          <td className="px-3 py-2 font-sans font-medium text-slate-900 dark:text-white">
                            {modoPrivacidade ? mascararTexto(row.nome) : row.nome}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {row.docs}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {formatarMoeda(row.valor_base)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-amber-700 dark:text-amber-300">
                            {formatarMoeda(row.valor_irs)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-[#0284c7] dark:text-sky-400">
                            {formatarMoeda(row.valor_iva)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatarMoeda(row.imposto_selo)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatarMoeda(row.importancia_recebida)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {dadosRetencoesIrs.lista.length > 0 && (
                    <tfoot className="sticky bottom-0 z-10">
                      <tr className="bg-slate-100 dark:bg-[#132233] border-t-2 border-[#0284c7] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="px-3 py-2" colSpan={2}>
                          Total Geral ({dadosRetencoesIrs.lista.length} entidades)
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{dadosRetencoesIrs.totais.docs}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarMoeda(dadosRetencoesIrs.totais.valor_base)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {formatarMoeda(dadosRetencoesIrs.totais.valor_irs)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#0284c7] dark:text-sky-400">
                          {formatarMoeda(dadosRetencoesIrs.totais.valor_iva)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarMoeda(dadosRetencoesIrs.totais.imposto_selo)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatarMoeda(dadosRetencoesIrs.totais.importancia_recebida)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </div>
        )}
      </div>
        </div>

        {/* Painel Direito Encaixado: Assistente Passo a Passo */}
        <AssistenteImportacaoPanel
          aberto={assistenteAberto}
          onClose={fecharAssistente}
          modoConsulta={true}
          moduloTitulo="Mapas Resumo"
          apiOnline={apiOnlineLocal}
          caminhoDados={caminhoDestinoLocal}
          onCaminhoDadosChange={setCaminhoDestinoLocal}
          tipoOperacao={tipoOperacao}
          permitirAmbos={false}
          onTipoOperacaoChange={op => {
            if (op === 'compras' || op === 'vendas') {
              setTipoOperacao(op);
            }
          }}
          empresas={entidades
            .map(e => {
              const nif = (e.nif || e.nif_cc || '').trim();
              return {
                id: nif,
                cod: e.cod,
                nif,
                nome: e.nomecli || nif,
              };
            })
            .filter(e => Boolean(e.id))}
          selecionadasIds={selecionadasAssistente}
          onToggleEmpresa={toggleEmpresaAssistente}
          onSelecionarTodasEmpresas={selecionarTodasAssistente}
          onLimparEmpresas={limparSelecionadasAssistente}
          modoPrivacidade={modoPrivacidade}
          ano={ano}
          anoAtual={anoAtual}
          onAnoChange={onAnoChange}
          mesesSelecionados={mesesAtivosAssistente}
          onToggleMes={toggleMesAssistente}
          onSelecionarAnoTodo={aplicarAnoTodo}
          onSelecionarMesAtual={aplicarMesAtual}
          onSelecionarTrimestre={aplicarTrimestre}
          isSyncing={carregando}
          labelBotaoIniciar="Atualizar Mapas Resumo"
          onIniciarImportacao={carregarDados}
          passoAtivo={passoAssistente}
          onPassoAtivoChange={setPassoAssistente}
          opcoesExtras={
            <div className="space-y-2.5 text-xs font-mono">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Vista de Mapa Ativa
                </span>
                <div className="flex flex-wrap gap-1">
                  {SUB_VISTAS.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSubVista(tab.id)}
                      className={`px-2 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                        subVista === tab.id
                          ? 'bg-[#0284c7] text-white border-[#0284c7]'
                          : 'bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-200 border-[#cbd5e1] dark:border-[#334155]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Documentos de Trabalho
                </span>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { id: 'todos', label: 'Todos Docs' },
                      { id: 'fiscais', label: 'Omitir Docs Trabalho' },
                      { id: 'trabalho', label: 'Só Docs Trabalho' },
                    ] as const
                  ).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFiltroDocsTrabalho(opt.id)}
                      className={`px-2 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                        filtroDocsTrabalho === opt.id
                          ? 'bg-slate-800 dark:bg-sky-500 text-white dark:text-slate-950 border-slate-800 dark:border-sky-500'
                          : 'bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-200 border-[#cbd5e1] dark:border-[#334155]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-1 border-t border-[#cbd5e1] dark:border-[#2a3a54] space-y-1.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Exportação Rápida Excel
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportarMapaAtual}
                    disabled={carregando}
                    className="px-2 py-1.5 rounded text-[10px] font-mono font-semibold border border-[#cbd5e1] dark:border-[#334155] bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-[#1e293b] text-slate-800 dark:text-slate-200 flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                    <span>Mapa Atual</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportarTodosMapas}
                    disabled={carregando}
                    className="px-2 py-1.5 rounded text-[10px] font-mono font-semibold border border-[#0284c7] bg-[#0284c7] hover:bg-[#0369a1] text-white flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>Todos os Mapas</span>
                  </button>
                </div>
              </div>
            </div>
          }
        />

      </div>
    </div>
  );
}
