import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileSpreadsheet,
  Search,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  RotateCcw,
  Loader2,
  Table2,
  Percent,
  Receipt,
  Euro,
  ShoppingCart,
  TrendingUp,
  X,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Filter,
  FilterX
} from 'lucide-react';

function testarFiltroNumerico(valor: number, filtroStr: string): boolean {
  const f = filtroStr.trim().replace(',', '.');
  if (!f) return true;

  if (f.startsWith('>=')) {
    const n = parseFloat(f.slice(2).trim());
    return !isNaN(n) ? valor >= n : true;
  }
  if (f.startsWith('>')) {
    const n = parseFloat(f.slice(1).trim());
    return !isNaN(n) ? valor > n : true;
  }
  if (f.startsWith('<=')) {
    const n = parseFloat(f.slice(2).trim());
    return !isNaN(n) ? valor <= n : true;
  }
  if (f.startsWith('<')) {
    const n = parseFloat(f.slice(1).trim());
    return !isNaN(n) ? valor < n : true;
  }
  if (f.startsWith('=')) {
    const n = parseFloat(f.slice(1).trim());
    return !isNaN(n) ? Math.abs(valor - n) < 0.001 : true;
  }

  const n = parseFloat(f);
  if (!isNaN(n)) {
    return valor.toFixed(2).includes(f) || valor.toString().includes(f) || Math.abs(valor - n) < 0.01;
  }
  return true;
}

interface Entidade {
  id: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
}

export interface LinhaFatura {
  id: string;
  id_cliente?: string;
  hash_linha?: string;
  id_fatura_unico: string;
  fatura: string;
  atcud: string;
  data_emissao: string;
  tipo_documento: string;
  estado_documento?: string;
  nif_cliente: string;
  contraparte_nif: string;
  contraparte_nome: string;
  contraparte_pais?: string;
  setor_atividade?: string;
  tipo_imposto?: string;
  codigo_taxa?: string;
  taxa_percentagem: number;
  base_incidencia: number;
  valor_imposto: number;
  total_linha: number;
  codigo_isencao?: string;
  regiao_fiscal?: string;
  total_liquido_doc?: number;
  total_doc: number;
}

export interface ColunaDef {
  id: string;
  label: string;
  shortLabel: string;
  categoria: 'Geral' | 'Contraparte' | 'Valores & Impostos' | 'Classificação & Região' | 'Técnico';
  defaultVisivel: boolean;
  align: 'left' | 'center' | 'right';
}

export const TODAS_AS_COLUNAS: ColunaDef[] = [
  // 1. Geral
  { id: 'data_emissao', label: 'Data de Emissão', shortLabel: 'Data', categoria: 'Geral', defaultVisivel: true, align: 'left' },
  { id: 'fatura', label: 'Documento / Fatura', shortLabel: 'Doc / Fatura', categoria: 'Geral', defaultVisivel: true, align: 'left' },
  { id: 'tipo_documento', label: 'Tipo de Documento', shortLabel: 'Tipo', categoria: 'Geral', defaultVisivel: true, align: 'center' },
  { id: 'estado_documento', label: 'Estado do Documento', shortLabel: 'Estado', categoria: 'Geral', defaultVisivel: false, align: 'center' },
  { id: 'empresa_nossa', label: 'Empresa Nossa (NIF / Nome)', shortLabel: 'Empresa Nossa', categoria: 'Geral', defaultVisivel: true, align: 'left' },

  // 2. Contraparte
  { id: 'contraparte_nif', label: 'NIF Contraparte (Fornecedor/Cliente)', shortLabel: 'NIF Contraparte', categoria: 'Contraparte', defaultVisivel: true, align: 'left' },
  { id: 'contraparte_nome', label: 'Nome da Contraparte', shortLabel: 'Nome Contraparte', categoria: 'Contraparte', defaultVisivel: true, align: 'left' },
  { id: 'contraparte_pais', label: 'País Contraparte', shortLabel: 'País', categoria: 'Contraparte', defaultVisivel: false, align: 'center' },

  // 3. Valores & Impostos
  { id: 'taxa_percentagem', label: 'Taxa IVA (%)', shortLabel: 'Taxa IVA', categoria: 'Valores & Impostos', defaultVisivel: true, align: 'center' },
  { id: 'codigo_taxa', label: 'Código da Taxa (NOR/INT/RED)', shortLabel: 'Cód. Taxa', categoria: 'Valores & Impostos', defaultVisivel: false, align: 'center' },
  { id: 'tipo_imposto', label: 'Tipo de Imposto (IVA/IS)', shortLabel: 'Tipo Imp.', categoria: 'Valores & Impostos', defaultVisivel: false, align: 'center' },
  { id: 'base_incidencia', label: 'Base de Incidência (€)', shortLabel: 'Base Incidência', categoria: 'Valores & Impostos', defaultVisivel: true, align: 'right' },
  { id: 'valor_imposto', label: 'Valor do IVA (€)', shortLabel: 'Valor IVA', categoria: 'Valores & Impostos', defaultVisivel: true, align: 'right' },
  { id: 'total_linha', label: 'Total da Linha (€)', shortLabel: 'Total Linha', categoria: 'Valores & Impostos', defaultVisivel: true, align: 'right' },
  { id: 'total_liquido_doc', label: 'Total Líquido do Documento (€)', shortLabel: 'Líquido Doc.', categoria: 'Valores & Impostos', defaultVisivel: false, align: 'right' },
  { id: 'total_doc', label: 'Total Global do Documento (€)', shortLabel: 'Total Doc.', categoria: 'Valores & Impostos', defaultVisivel: false, align: 'right' },

  // 4. Classificação & Região
  { id: 'codigo_isencao', label: 'Motivo de Isenção (M01...)', shortLabel: 'Cód. Isenção', categoria: 'Classificação & Região', defaultVisivel: false, align: 'center' },
  { id: 'regiao_fiscal', label: 'Região Fiscal (PT/AC/MA)', shortLabel: 'Região', categoria: 'Classificação & Região', defaultVisivel: false, align: 'center' },
  { id: 'setor_atividade', label: 'Setor de Atividade', shortLabel: 'Setor Atividade', categoria: 'Classificação & Região', defaultVisivel: false, align: 'left' },

  // 5. Técnico
  { id: 'atcud', label: 'Código ATCUD', shortLabel: 'ATCUD', categoria: 'Técnico', defaultVisivel: true, align: 'left' },
  { id: 'id_fatura_unico', label: 'ID Único da Fatura', shortLabel: 'ID Fatura', categoria: 'Técnico', defaultVisivel: false, align: 'left' },
  { id: 'hash_linha', label: 'Hash de Assinatura da Linha', shortLabel: 'Hash Linha', categoria: 'Técnico', defaultVisivel: false, align: 'left' },
];

export const CATEGORIAS_COLUNAS = [
  'Geral',
  'Contraparte',
  'Valores & Impostos',
  'Classificação & Região',
  'Técnico'
] as const;

interface RespostaConsulta {
  total_linhas: number;
  total_documentos: number;
  soma_base: number;
  soma_iva: number;
  soma_total: number;
  linhas: LinhaFatura[];
}

const MESES = [
  { num: 1, nome: "Jan", full: "Janeiro" },
  { num: 2, nome: "Fev", full: "Fevereiro" },
  { num: 3, nome: "Mar", full: "Março" },
  { num: 4, nome: "Abr", full: "Abril" },
  { num: 5, nome: "Mai", full: "Maio" },
  { num: 6, nome: "Jun", full: "Junho" },
  { num: 7, nome: "Jul", full: "Julho" },
  { num: 8, nome: "Ago", full: "Agosto" },
  { num: 9, nome: "Set", full: "Setembro" },
  { num: 10, nome: "Out", full: "Outubro" },
  { num: 11, nome: "Nov", full: "Novembro" },
  { num: 12, nome: "Dez", full: "Dezembro" },
];

export interface FiltroInicialDados {
  nif?: string;
  ano?: number;
  mes?: number;
  tipo?: 'compras' | 'vendas';
}

interface FaturasViewProps {
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
  filtroInicial?: FiltroInicialDados | null;
}

function mascararTexto(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

export function FaturasView({ onApiStatusChange, modoPrivacidade = false, filtroInicial }: FaturasViewProps = {}) {
  // Temporal
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [nifSelecionado, setNifSelecionado] = useState<string>(() => filtroInicial?.nif || "");
  const [tipoOperacao, setTipoOperacao] = useState<'compras' | 'vendas'>(() => filtroInicial?.tipo || 'compras');

  const [ano, setAno] = useState<number>(() => filtroInicial?.ano || anoAtual);
  const [dataInicio, setDataInicio] = useState<string>(() => {
    const a = filtroInicial?.ano || anoAtual;
    if (filtroInicial?.mes) {
      return `${a}-${String(filtroInicial.mes).padStart(2, '0')}-01`;
    }
    return `${a}-01-01`;
  });
  const [dataFim, setDataFim] = useState<string>(() => {
    const a = filtroInicial?.ano || anoAtual;
    if (filtroInicial?.mes) {
      const ultimoDia = new Date(a, filtroInicial.mes, 0).getDate();
      return `${a}-${String(filtroInicial.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    }
    return hoje.toISOString().split('T')[0];
  });
  const [mesAtivo, setMesAtivo] = useState<number | null>(() => filtroInicial?.mes ?? null);

  const ultimoReqIdRef = useRef<number>(0);

  // Efeito de navegação contextual recebida da Matriz/Importador
  useEffect(() => {
    if (filtroInicial) {
      if (filtroInicial.nif !== undefined) setNifSelecionado(filtroInicial.nif);
      if (filtroInicial.tipo !== undefined) setTipoOperacao(filtroInicial.tipo);
      
      const anoAlvo = filtroInicial.ano || anoAtual;
      setAno(anoAlvo);
      
      if (filtroInicial.mes) {
        const m = filtroInicial.mes;
        setMesAtivo(m);
        const dIni = `${anoAlvo}-${String(m).padStart(2, '0')}-01`;
        const ultimoDia = new Date(anoAlvo, m, 0).getDate();
        const dFim = `${anoAlvo}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
        setDataInicio(dIni);
        setDataFim(dFim);
      } else {
        setMesAtivo(null);
        setDataInicio(`${anoAlvo}-01-01`);
        setDataFim(`${anoAlvo}-12-31`);
      }
      setPagina(1);
    }
  }, [filtroInicial]);

  // Filtros de Pesquisa e Taxa
  const [pesquisa, setPesquisa] = useState<string>("");
  const [taxaFiltro, setTaxaFiltro] = useState<string>("");

  // Ordenação de Colunas
  const [sortCol, setSortCol] = useState<string>('data_emissao');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filtros Granulares por Coluna
  const [mostrarFiltrosColunas, setMostrarFiltrosColunas] = useState<boolean>(false);
  const [filtrosColunas, setFiltrosColunas] = useState<Record<string, string>>({});
  const totalFiltrosAtivos = useMemo(() => {
    return Object.values(filtrosColunas).filter(v => v && v.trim() !== '').length;
  }, [filtrosColunas]);

  const handleSort = (colId: string) => {
    if (sortCol === colId) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colId);
      const colDef = TODAS_AS_COLUNAS.find(c => c.id === colId);
      const isNumericOrDate = colDef?.categoria === 'Valores & Impostos' || colId === 'data_emissao';
      setSortDir(isNumericOrDate ? 'desc' : 'asc');
    }
    setPagina(1);
  };

  const handleFiltroColunaChange = (colId: string, valor: string) => {
    setFiltrosColunas(prev => {
      const novo = { ...prev };
      if (!valor || valor.trim() === '') {
        delete novo[colId];
      } else {
        novo[colId] = valor;
      }
      return novo;
    });
  };

  const limparTodosFiltros = () => {
    setFiltrosColunas({});
  };

  // Dropdown Customizado de Entidades (Combobox com Pesquisa e Dark Mode Nativo)
  const [dropdownEmpresasAberto, setDropdownEmpresasAberto] = useState<boolean>(false);
  const [pesquisaEmpresa, setPesquisaEmpresa] = useState<string>("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Paginação
  const [pagina, setPagina] = useState<number>(1);
  const [limite, setLimite] = useState<number>(200);

  // Dados
  const [carregando, setCarregando] = useState<boolean>(false);
  const [dados, setDados] = useState<RespostaConsulta>({
    total_linhas: 0,
    total_documentos: 0,
    soma_base: 0,
    soma_iva: 0,
    soma_total: 0,
    linhas: [],
  });

  const [copiado, setCopiado] = useState<boolean>(false);
  const [tarefaWorkerNomes, setTarefaWorkerNomes] = useState<{
    nif: string;
    modulo?: string;
    tipo_tarefa?: string;
  } | null>(null);
  const prevWorkerNomesRef = useRef<boolean>(false);

  // Configuração e Memória Futura de Colunas Visíveis
  const STORAGE_KEY_COLUNAS = 'gexcel_faturas_colunas_ativas_v1';
  const [colunasAtivas, setColunasAtivas] = useState<string[]>(() => {
    try {
      const salvo = localStorage.getItem(STORAGE_KEY_COLUNAS);
      if (salvo) {
        const parsed = JSON.parse(salvo);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Erro ao ler colunas guardadas:", e);
    }
    return TODAS_AS_COLUNAS.filter(c => c.defaultVisivel).map(c => c.id);
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_COLUNAS, JSON.stringify(colunasAtivas));
    } catch (e) {
      console.error("Erro ao gravar preferências de colunas:", e);
    }
  }, [colunasAtivas]);

  const [menuColunasAberto, setMenuColunasAberto] = useState<boolean>(false);
  const [filtroColuna, setFiltroColuna] = useState<string>("");
  const colunasPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutsideColunas(event: MouseEvent) {
      if (colunasPopoverRef.current && !colunasPopoverRef.current.contains(event.target as Node)) {
        setMenuColunasAberto(false);
      }
    }
    if (menuColunasAberto) {
      document.addEventListener("mousedown", handleClickOutsideColunas);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutsideColunas);
    };
  }, [menuColunasAberto]);

  const toggleColuna = (colId: string) => {
    setColunasAtivas(prev => {
      if (prev.includes(colId)) {
        if (prev.length <= 1) return prev; // Garante pelo menos 1 coluna visível
        return prev.filter(id => id !== colId);
      } else {
        const novo = [...prev, colId];
        return TODAS_AS_COLUNAS.filter(c => novo.includes(c.id)).map(c => c.id);
      }
    });
  };

  const selecionarTodasColunas = () => {
    setColunasAtivas(TODAS_AS_COLUNAS.map(c => c.id));
  };

  const restaurarColunasPadrao = () => {
    setColunasAtivas(TODAS_AS_COLUNAS.filter(c => c.defaultVisivel).map(c => c.id));
  };

  const colunasVisiveisConfig = useMemo(() => {
    return TODAS_AS_COLUNAS.filter(c => colunasAtivas.includes(c.id));
  }, [colunasAtivas]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownEmpresasAberto(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. Carregar lista de empresas clientes da API (via tCredenciais.xml / legado_bridge)
  useEffect(() => {
    let cancel = false;
    const carregarEntidades = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/entidades");
        if (res.ok) {
          const data = await res.json();
          if (!cancel && data.entidades) {
            setEntidades(data.entidades as Entidade[]);
          }
        }
      } catch (e) {
        console.error("Erro ao carregar entidades no FaturasView:", e);
      }
    };
    carregarEntidades();
    return () => { cancel = true; };
  }, []);

  // 2. Mapeamento de NIF para Nome da Empresa (para lookup rápido)
  const mapaEntidades = useMemo(() => {
    const map = new Map<string, string>();
    for (const ent of entidades) {
      if (ent.nif) map.set(ent.nif, ent.nomecli);
      if (ent.nif_cc) map.set(ent.nif_cc, ent.nomecli);
    }
    return map;
  }, [entidades]);

  // Processamento granular (filtros por coluna e ordenação em memória das linhas)
  const linhasProcessadas = useMemo(() => {
    let lista = [...dados.linhas];

    // 1. Filtros por coluna
    const filtrosEntries = Object.entries(filtrosColunas).filter(([_, val]) => val && val.trim() !== '');
    if (filtrosEntries.length > 0) {
      lista = lista.filter(linha => {
        return filtrosEntries.every(([colId, filtroVal]) => {
          const fVal = filtroVal.trim().toLowerCase();

          switch (colId) {
            case 'data_emissao':
              return (linha.data_emissao || '').toLowerCase().includes(fVal);
            case 'fatura':
              return (linha.fatura || '').toLowerCase().includes(fVal);
            case 'tipo_documento':
              return (linha.tipo_documento || '').toLowerCase() === fVal || (linha.tipo_documento || '').toLowerCase().includes(fVal);
            case 'estado_documento': {
              const est = (linha.estado_documento || 'normal').toLowerCase();
              return est === fVal || est.includes(fVal);
            }
            case 'empresa_nossa': {
              const nome = (mapaEntidades.get(linha.nif_cliente) || '').toLowerCase();
              const nif = (linha.nif_cliente || '').toLowerCase();
              return nome.includes(fVal) || nif.includes(fVal);
            }
            case 'contraparte_nif':
              return (linha.contraparte_nif || '').toLowerCase().includes(fVal);
            case 'contraparte_nome':
              return (linha.contraparte_nome || '').toLowerCase().includes(fVal);
            case 'contraparte_pais':
              return (linha.contraparte_pais || 'PT').toLowerCase().includes(fVal);
            case 'tipo_imposto':
              return (linha.tipo_imposto || 'IVA').toLowerCase().includes(fVal);
            case 'codigo_taxa':
              return (linha.codigo_taxa || '').toLowerCase().includes(fVal);
            case 'codigo_isencao':
              return (linha.codigo_isencao || '').toLowerCase().includes(fVal);
            case 'regiao_fiscal':
              return (linha.regiao_fiscal || 'PT').toLowerCase().includes(fVal);
            case 'setor_atividade':
              return (linha.setor_atividade || '').toLowerCase().includes(fVal);
            case 'atcud':
              return (linha.atcud || '').toLowerCase().includes(fVal);
            case 'id_fatura_unico':
              return (linha.id_fatura_unico || '').toLowerCase().includes(fVal);
            case 'hash_linha':
              return (linha.hash_linha || '').toLowerCase().includes(fVal);
            case 'taxa_percentagem':
            case 'base_incidencia':
            case 'valor_imposto':
            case 'total_linha':
            case 'total_liquido_doc':
            case 'total_doc': {
              const valNum = Number(linha[colId as keyof LinhaFatura] || 0);
              return testarFiltroNumerico(valNum, fVal);
            }
            default:
              return true;
          }
        });
      });
    }

    // 2. Ordenação local das linhas
    if (sortCol) {
      lista.sort((a, b) => {
        let valA: any = a[sortCol as keyof LinhaFatura];
        let valB: any = b[sortCol as keyof LinhaFatura];

        if (sortCol === 'empresa_nossa') {
          valA = mapaEntidades.get(a.nif_cliente) || a.nif_cliente || '';
          valB = mapaEntidades.get(b.nif_cliente) || b.nif_cliente || '';
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'asc' ? valA - valB : valB - valA;
        }

        const strA = String(valA || '').toLowerCase();
        const strB = String(valB || '').toLowerCase();
        return sortDir === 'asc' ? strA.localeCompare(strB, 'pt') : strB.localeCompare(strA, 'pt');
      });
    }

    return lista;
  }, [dados.linhas, filtrosColunas, sortCol, sortDir, mapaEntidades]);

  // Pré-calcular agrupamento de faturas para alternância cromática (zebra striping agrupado)
  const metadadosLinhas = useMemo(() => {
    let ultimoIdFatura = '';
    let indiceFatura = -1;
    return linhasProcessadas.map((linha) => {
      const chaveFatura = linha.id_fatura_unico || `${linha.contraparte_nif}_${linha.fatura}`;
      const ehNovaFatura = chaveFatura !== ultimoIdFatura;
      if (ehNovaFatura) {
        indiceFatura++;
        ultimoIdFatura = chaveFatura;
      }
      return {
        ehNovaFatura,
        isFaturaPar: indiceFatura % 2 === 0,
      };
    });
  }, [linhasProcessadas]);

  // Filtro de empresas dentro do Dropdown
  const entidadesFiltradasDropdown = useMemo(() => {
    if (!pesquisaEmpresa.trim()) return entidades;
    const q = pesquisaEmpresa.toLowerCase();
    return entidades.filter(e =>
      e.nomecli.toLowerCase().includes(q) ||
      (e.nif && e.nif.includes(q)) ||
      (e.nif_cc && e.nif_cc.includes(q))
    );
  }, [entidades, pesquisaEmpresa]);

  // 3. Execução da Consulta à API Local (:8015)
  const executarConsulta = useCallback(async () => {
    const reqId = ++ultimoReqIdRef.current;
    setCarregando(true);
    try {
      const offset = (pagina - 1) * limite;
      const params = new URLSearchParams({
        tipo: tipoOperacao,
        nif: nifSelecionado,
        data_inicio: dataInicio,
        data_fim: dataFim,
        pesquisa: pesquisa.trim(),
        limite: String(limite),
        offset: String(offset),
        ordenar_por: sortCol,
        ordem: sortDir,
      });
      if (taxaFiltro !== "") {
        params.append('taxa', taxaFiltro);
      }

      const res = await fetch(`http://127.0.0.1:8015/api/faturas/consultar?${params.toString()}`);
      if (reqId !== ultimoReqIdRef.current) return;
      if (res.ok) {
        onApiStatusChange?.(true);
        const json = await res.json();
        setDados({
          total_linhas: json.total_linhas || 0,
          total_documentos: json.total_documentos || 0,
          soma_base: json.soma_base || 0,
          soma_iva: json.soma_iva || 0,
          soma_total: json.soma_total || 0,
          linhas: json.linhas || [],
        });
      } else {
        onApiStatusChange?.(false);
        console.error("Erro HTTP ao consultar faturas:", res.statusText);
      }
    } catch (e) {
      if (reqId !== ultimoReqIdRef.current) return;
      onApiStatusChange?.(false);
      console.error("Falha ao contactar API e-fatura:", e);
    } finally {
      if (reqId === ultimoReqIdRef.current) {
        setCarregando(false);
      }
    }
  }, [tipoOperacao, nifSelecionado, dataInicio, dataFim, pesquisa, taxaFiltro, pagina, limite, sortCol, sortDir, onApiStatusChange]);

  useEffect(() => {
    executarConsulta();
  }, [executarConsulta]);

  // Monitorização em tempo real do Worker de Segundo Plano para resolução de nomes e anuladas
  useEffect(() => {
    const verificarWorker = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/pipeline/status", { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json();
          const ativa = data.tarefa_atual;
          const isRelevante = Boolean(
            ativa &&
            (ativa.tipo_tarefa === 'completar_nomes_vendas' || ativa.tipo_tarefa === 'scrape_anuladas') &&
            (!nifSelecionado || ativa.nif === nifSelecionado)
          );
          setTarefaWorkerNomes(isRelevante ? ativa : null);

          // Se o worker terminou de resolver nomes ou extrair dados para a empresa ativa, recarrega a tabela
          if (prevWorkerNomesRef.current && !isRelevante) {
            executarConsulta();
          }
          prevWorkerNomesRef.current = isRelevante;
        }
      } catch {}
    };

    verificarWorker();
    const interval = setInterval(verificarWorker, 4000);
    return () => clearInterval(interval);
  }, [nifSelecionado, executarConsulta]);

  // Atalhos de Seleção Temporal
  const aplicarAnoTodo = () => {
    setMesAtivo(null);
    setDataInicio(`${ano}-01-01`);
    setDataFim(`${ano}-12-31`);
    setPagina(1);
  };

  const aplicarMesAtual = () => {
    setAno(anoAtual);
    setMesAtivo(mesAtual);
    const dIni = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-01`;
    const dFim = hoje.toISOString().split('T')[0];
    setDataInicio(dIni);
    setDataFim(dFim);
    setPagina(1);
  };

  const aplicarMesEspecifico = (m: number) => {
    setMesAtivo(m);
    const dIni = `${ano}-${String(m).padStart(2, '0')}-01`;
    const ultimoDia = new Date(ano, m, 0).getDate();
    const dFim = `${ano}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    setDataInicio(dIni);
    setDataFim(dFim);
    setPagina(1);
  };

  const aplicarTrimestre = (t: number) => {
    setMesAtivo(null);
    const mesIni = (t - 1) * 3 + 1;
    const mesFim = t * 3;
    const ultimoDia = new Date(ano, mesFim, 0).getDate();
    setDataInicio(`${ano}-${String(mesIni).padStart(2, '0')}-01`);
    setDataFim(`${ano}-${String(mesFim).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`);
    setPagina(1);
  };

  // Copiar grelha para formato compatível com Excel (TSV) respeitando as colunas visíveis
  const copiarParaClipboard = () => {
    if (linhasProcessadas.length === 0) return;

    const cabecalho = colunasVisiveisConfig.map(c => c.label).join("\t");

    const corpo = linhasProcessadas.map(linha => {
      return colunasVisiveisConfig.map(col => {
        switch (col.id) {
          case 'data_emissao': return linha.data_emissao;
          case 'fatura': return linha.fatura;
          case 'tipo_documento': return linha.tipo_documento;
          case 'estado_documento': return linha.estado_documento || 'Normal';
          case 'empresa_nossa': {
            const nome = mapaEntidades.get(linha.nif_cliente) || linha.nif_cliente;
            const nif = linha.nif_cliente;
            if (modoPrivacidade) {
              return `${mascararTexto(nif)} - ${mascararTexto(nome)}`;
            }
            return `${nif} - ${nome}`;
          }
          case 'contraparte_nif': return modoPrivacidade ? '■■■■■■■■■' : linha.contraparte_nif;
          case 'contraparte_nome': return modoPrivacidade ? mascararTexto(linha.contraparte_nome) : linha.contraparte_nome;
          case 'contraparte_pais': return linha.contraparte_pais || 'PT';
          case 'taxa_percentagem': return `${linha.taxa_percentagem}%`;
          case 'codigo_taxa': return linha.codigo_taxa || '';
          case 'tipo_imposto': return linha.tipo_imposto || 'IVA';
          case 'base_incidencia': return linha.base_incidencia.toFixed(2).replace('.', ',');
          case 'valor_imposto': return linha.valor_imposto.toFixed(2).replace('.', ',');
          case 'total_linha': return linha.total_linha.toFixed(2).replace('.', ',');
          case 'total_liquido_doc': return (linha.total_liquido_doc || 0).toFixed(2).replace('.', ',');
          case 'total_doc': return (linha.total_doc || 0).toFixed(2).replace('.', ',');
          case 'codigo_isencao': return linha.codigo_isencao || '';
          case 'regiao_fiscal': return linha.regiao_fiscal || 'PT';
          case 'setor_atividade': return linha.setor_atividade || '';
          case 'atcud': return linha.atcud || '';
          case 'id_fatura_unico': return linha.id_fatura_unico || '';
          case 'hash_linha': return linha.hash_linha || '';
          default: return '';
        }
      }).join("\t");
    }).join("\n");

    navigator.clipboard.writeText(`${cabecalho}\n${corpo}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  // Renderização individual de cada célula com estilo e tipografia Gexcel EVO
  const renderCelula = (colId: string, linha: LinhaFatura) => {
    switch (colId) {
      case 'data_emissao':
        return <span className="text-muted-foreground tabular-nums text-[10.5px]">{linha.data_emissao}</span>;
      case 'fatura':
        return <span className="font-semibold text-foreground text-[11px]">{linha.fatura}</span>;
      case 'tipo_documento':
        return (
          <span className="px-1.5 py-0.5 text-[9px] rounded bg-muted/70 text-muted-foreground font-bold border border-sky-500/20 dark:border-sky-500/30">
            {linha.tipo_documento}
          </span>
        );
      case 'estado_documento':
        return (
          <span className="text-[10px] text-muted-foreground font-mono">
            {linha.estado_documento || 'Normal'}
          </span>
        );
      case 'empresa_nossa': {
        const nome = mapaEntidades.get(linha.nif_cliente) || linha.nif_cliente;
        const nomeExibicao = modoPrivacidade ? mascararTexto(nome) : nome;
        const nifExibicao = modoPrivacidade ? '■■■■■■■■■' : linha.nif_cliente;
        return (
          <div className="flex flex-col min-w-0 max-w-[240px] leading-tight" title={`${nifExibicao} - ${nomeExibicao}`}>
            <span className="font-mono text-[10.5px] text-foreground/90 font-semibold truncate">
              {nifExibicao}
            </span>
            <span className={`font-sans text-[10px] text-muted-foreground truncate ${modoPrivacidade ? 'font-mono' : ''}`}>
              {nomeExibicao}
            </span>
          </div>
        );
      }
      case 'contraparte_nif': {
        const exibicao = modoPrivacidade ? '■■■■■■■■■' : linha.contraparte_nif;
        return (
          <span 
            className="text-[#0284c7] dark:text-sky-400 font-semibold font-mono text-[11px]"
            title={exibicao}
          >
            {exibicao}
          </span>
        );
      }
      case 'contraparte_nome': {
        const exibicao = modoPrivacidade ? mascararTexto(linha.contraparte_nome) : linha.contraparte_nome;
        return (
          <span 
            className={`font-sans font-medium text-foreground/90 text-[11px] max-w-[240px] truncate block ${modoPrivacidade ? 'font-mono' : ''}`} 
            title={exibicao}
          >
            {exibicao}
          </span>
        );
      }
      case 'contraparte_pais':
        return (
          <span className="text-muted-foreground font-mono text-[10px]">
            {linha.contraparte_pais || 'PT'}
          </span>
        );
      case 'taxa_percentagem':
        return (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
            linha.taxa_percentagem === 23 
              ? 'bg-sky-500/10 text-[#0284c7] dark:text-sky-400 border border-sky-500/30' 
              : linha.taxa_percentagem === 13 
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30' 
                : linha.taxa_percentagem === 6 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' 
                  : 'bg-slate-200 dark:bg-slate-800 text-muted-foreground'
          }`}>
            {linha.taxa_percentagem.toFixed(0)}%
          </span>
        );
      case 'codigo_taxa':
        return (
          <span className="px-1 py-0.5 text-[9px] rounded bg-muted/60 text-muted-foreground font-mono">
            {linha.codigo_taxa || '-'}
          </span>
        );
      case 'tipo_imposto':
        return (
          <span className="text-[10px] text-muted-foreground font-mono">
            {linha.tipo_imposto || 'IVA'}
          </span>
        );
      case 'base_incidencia':
        return (
          <span className="text-foreground font-medium text-[11px]">
            {linha.base_incidencia.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      case 'valor_imposto':
        return (
          <span className="text-[#0284c7] dark:text-sky-400 font-medium text-[11px]">
            {linha.valor_imposto.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      case 'total_linha':
        return (
          <span className="font-bold text-foreground text-[11px]">
            {linha.total_linha.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      case 'total_liquido_doc':
        return (
          <span className="text-muted-foreground font-medium text-[11px]">
            {(linha.total_liquido_doc || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      case 'total_doc':
        return (
          <span className="text-foreground/80 font-semibold text-[11px]">
            {(linha.total_doc || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      case 'codigo_isencao':
        return (
          <span className="text-muted-foreground/80 font-mono text-[10px]">
            {linha.codigo_isencao || '-'}
          </span>
        );
      case 'regiao_fiscal':
        return (
          <span className="text-muted-foreground font-mono text-[10px]">
            {linha.regiao_fiscal || 'PT'}
          </span>
        );
      case 'setor_atividade':
        return (
          <span className="text-muted-foreground text-[10.5px] truncate max-w-[150px] block" title={linha.setor_atividade}>
            {linha.setor_atividade || '-'}
          </span>
        );
      case 'atcud':
        return (
          <span className="text-[9px] text-muted-foreground/70 truncate max-w-[140px] block font-mono" title={linha.atcud}>
            {linha.atcud || '-'}
          </span>
        );
      case 'id_fatura_unico':
        return (
          <span className="text-[9.5px] text-muted-foreground/60 truncate max-w-[160px] block font-mono" title={linha.id_fatura_unico}>
            {linha.id_fatura_unico}
          </span>
        );
      case 'hash_linha':
        return (
          <span className="text-[9px] text-muted-foreground/50 truncate max-w-[160px] block font-mono" title={linha.hash_linha}>
            {linha.hash_linha}
          </span>
        );
      default:
        return null;
    }
  };

  const renderFiltroColuna = (col: ColunaDef) => {
    const valorAtual = filtrosColunas[col.id] || '';

    if (col.id === 'tipo_documento') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todos</option>
          <option value="FT">FT (Fatura)</option>
          <option value="FS">FS (Simplificada)</option>
          <option value="FR">FR (Fatura-Recibo)</option>
          <option value="NC">NC (Nota Crédito)</option>
          <option value="ND">ND (Nota Débito)</option>
        </select>
      );
    }

    if (col.id === 'estado_documento') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todos</option>
          <option value="normal">Normal</option>
          <option value="anulado">Anulado</option>
        </select>
      );
    }

    if (col.id === 'taxa_percentagem') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todas</option>
          <option value="23">23%</option>
          <option value="13">13%</option>
          <option value="6">6%</option>
          <option value="0">0%</option>
        </select>
      );
    }

    if (col.id === 'codigo_taxa') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todos</option>
          <option value="NOR">NOR</option>
          <option value="INT">INT</option>
          <option value="RED">RED</option>
          <option value="ISE">ISE</option>
        </select>
      );
    }

    if (col.id === 'tipo_imposto') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todos</option>
          <option value="IVA">IVA</option>
          <option value="IS">IS</option>
        </select>
      );
    }

    if (col.id === 'regiao_fiscal') {
      return (
        <select
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          className="w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1 py-0.5 text-foreground focus:outline-hidden cursor-pointer"
        >
          <option value="">Todas</option>
          <option value="PT">PT</option>
          <option value="PT-AC">PT-AC</option>
          <option value="PT-MA">PT-MA</option>
        </select>
      );
    }

    const isNumeric = col.categoria === 'Valores & Impostos';
    const placeholder = isNumeric ? 'ex: >100' : 'Filtrar...';

    return (
      <div className="relative flex items-center min-w-[70px]">
        <input
          type="text"
          value={valorAtual}
          onChange={e => handleFiltroColunaChange(col.id, e.target.value)}
          placeholder={placeholder}
          className={`w-full text-[10px] font-mono bg-white dark:bg-[#101b28] border border-border dark:border-[#22364c] rounded px-1.5 py-0.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-hidden focus:border-sky-500 ${
            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
          } ${valorAtual ? 'pr-4 border-sky-400 dark:border-sky-500 font-semibold' : ''}`}
        />
        {valorAtual && (
          <button
            type="button"
            onClick={() => handleFiltroColunaChange(col.id, '')}
            className="absolute right-1 text-muted-foreground hover:text-foreground cursor-pointer"
            title="Limpar filtro"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    );
  };

  const totalPaginas = Math.max(1, Math.ceil(dados.total_linhas / limite));

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0 select-none">
      
      {/* 1. Cabeçalho Oficial Gexcel EVO */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Auditoria Analítica & Detalhe Fiscal
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center">
            Dados e-Fatura
          </h1>
          <p className="page-description text-muted-foreground text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Exploração granular e detalhe fiscal de documentos importados.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-muted-foreground">Base Sincronizada</span>
          </div>
          <button
            onClick={executarConsulta}
            disabled={carregando}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-mono bg-card hover:bg-muted border border-border text-foreground transition cursor-pointer shadow-2xs"
            title="Recarregar dados"
          >
            <RotateCcw className={`w-3 h-3 ${carregando ? 'animate-spin text-primary' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Banner de Execução em Segundo Plano do Worker */}
      {tarefaWorkerNomes && (
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-md p-2.5 flex items-center justify-between text-xs font-mono text-sky-800 dark:text-sky-300 animate-in fade-in shrink-0">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500 shrink-0" />
            <span>
              <strong>Worker 2.º Plano Ativo:</strong> {tarefaWorkerNomes.tipo_tarefa === 'completar_nomes_vendas' ? 'A resolver nomes de clientes particulares (vendas) na base e XMLs...' : 'A extrair faturas anuladas...'} (NIF {tarefaWorkerNomes.nif})
            </span>
          </div>
          <span className="text-[10px] bg-sky-500/20 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded font-bold">
            Auto-Sync em Background
          </span>
        </div>
      )}

      {/* 2. Card de Controlos e Filtros (Padrão Canónico Gexcel EVO com assinatura lateral) */}
      <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2.5 space-y-2.5 shadow-2xs text-foreground flex flex-col shrink-0 overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
        
        {/* Cabeçalho do Card de Filtros */}
        <div className="px-1 pt-0.5 pb-1.5 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
          <div className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7] dark:bg-sky-400" />
            <span className="text-foreground dark:text-slate-200 font-semibold">Parâmetros de Pesquisa & Filtros</span>
          </div>
          <span className="text-[9px] font-mono text-muted-foreground dark:text-slate-200 font-bold bg-white/70 dark:bg-[#101b28] px-1.5 py-0.2 rounded border border-slate-200 dark:border-[#2a405c]">
            {tipoOperacao === 'compras' ? 'Compras / Fornecedores' : 'Vendas / Clientes'}
          </span>
        </div>

        {/* Linha 1: Operação Fiscal + Seletor de Empresa (Combobox) + Pesquisa Textual + Filtro de Taxa */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Alternador Compras vs Vendas */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-white/60 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded shrink-0">
            <button
              type="button"
              onClick={() => { setTipoOperacao('compras'); setPagina(1); }}
              className={`py-1 px-3 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                tipoOperacao === 'compras'
                  ? 'bg-[#0284c7] text-white shadow-2xs border border-[#0284c7]'
                  : 'bg-white hover:bg-slate-100 dark:bg-[#1c2e40] dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563]'
              }`}
              title="Faturas de Fornecedores / Compras"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Compras</span>
            </button>
            <button
              type="button"
              onClick={() => { setTipoOperacao('vendas'); setPagina(1); }}
              className={`py-1 px-3 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                tipoOperacao === 'vendas'
                  ? 'bg-emerald-600 text-white shadow-2xs border border-emerald-600'
                  : 'bg-white hover:bg-slate-100 dark:bg-[#1c2e40] dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563]'
              }`}
              title="Faturas Emitidas / Vendas"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Vendas</span>
            </button>
          </div>

          {/* Seletor Customizado de Empresa (Combobox com Destaque e Espaço Alargado) */}
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownEmpresasAberto(v => !v)}
              className={`flex items-center space-x-2 rounded px-3 py-1.5 text-xs transition cursor-pointer shadow-2xs min-w-[320px] md:min-w-[420px] max-w-[580px] justify-between ${
                nifSelecionado
                  ? 'bg-sky-500/10 dark:bg-sky-500/15 border border-sky-500/40 dark:border-sky-400/50 hover:bg-sky-500/15'
                  : 'bg-white dark:bg-[#0c1520] hover:bg-slate-50 dark:hover:bg-[#152332] border border-slate-300/80 dark:border-[#222f3e]'
              }`}
              title="Selecionar empresa para filtrar faturas"
            >
              <div className="flex items-center space-x-2 truncate min-w-0">
                <Building2 className={`w-3.5 h-3.5 shrink-0 ${nifSelecionado ? 'text-[#0284c7] dark:text-sky-400' : 'text-muted-foreground'}`} />
                <div className="truncate flex items-center space-x-1.5 text-xs">
                  {nifSelecionado ? (
                    <>
                      <span className="font-mono text-[#0284c7] dark:text-sky-400 font-bold bg-white dark:bg-[#07121c] px-1.5 py-0.5 rounded text-[11px] border border-sky-400/30 shrink-0">
                        {modoPrivacidade ? '■■■■■■■■■' : nifSelecionado}
                      </span>
                      <span className={`font-sans font-semibold text-foreground dark:text-slate-100 truncate ${modoPrivacidade ? 'font-mono' : ''}`}>
                        {modoPrivacidade 
                          ? mascararTexto(mapaEntidades.get(nifSelecionado) || nifSelecionado)
                          : (mapaEntidades.get(nifSelecionado) || nifSelecionado)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground dark:text-slate-300 font-medium">Todas as Empresas ({entidades.length})</span>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-1 shrink-0 ml-1.5">
                {nifSelecionado && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setNifSelecionado("");
                      setPagina(1);
                    }}
                    title="Limpar seleção (mostrar todas)"
                    className="p-0.5 rounded-full hover:bg-sky-200 dark:hover:bg-sky-900/60 text-muted-foreground hover:text-foreground cursor-pointer transition"
                  >
                    <X className="w-3 h-3" />
                  </span>
                )}
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${dropdownEmpresasAberto ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* Menu Popover Dropdown Totalmente Adaptado ao Dark Mode EVO */}
            {dropdownEmpresasAberto && (
              <div className="absolute left-0 mt-1 w-96 md:w-[480px] max-w-[92vw] bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] rounded-md shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
                {/* Campo de Pesquisa Dentro do Dropdown */}
                <div className="p-2 border-b border-slate-200 dark:border-[#1c2e42] bg-slate-50 dark:bg-[#101b28]">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground dark:text-slate-400" />
                    <input
                      type="text"
                      placeholder="Pesquisar NIF ou Nome da Empresa..."
                      value={pesquisaEmpresa}
                      onChange={e => setPesquisaEmpresa(e.target.value)}
                      autoFocus
                      className="w-full pl-8 pr-7 py-1 bg-white dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary font-mono"
                    />
                    {pesquisaEmpresa && (
                      <button
                        type="button"
                        onClick={() => setPesquisaEmpresa("")}
                        className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Lista de Empresas com Scroll */}
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-[#162536]">
                  {/* Opção Geral: Todas as Empresas */}
                  <button
                    type="button"
                    onClick={() => { setNifSelecionado(""); setDropdownEmpresasAberto(false); setPagina(1); }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition cursor-pointer ${
                      !nifSelecionado
                        ? 'bg-sky-50 dark:bg-sky-500/15 text-[#0284c7] dark:text-sky-300 font-semibold'
                        : 'hover:bg-slate-100 dark:hover:bg-[#142333] text-foreground dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                      <span>Todas as Empresas</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#1a2d42] text-muted-foreground dark:text-slate-400">
                      {entidades.length}
                    </span>
                  </button>

                  {/* Lista Filtrada de Entidades */}
                  {entidadesFiltradasDropdown.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground font-mono">
                      Nenhuma empresa encontrada
                    </div>
                  ) : (
                    entidadesFiltradasDropdown.map(ent => {
                      const isSelected = nifSelecionado === ent.nif;
                      return (
                        <button
                          key={ent.id}
                          type="button"
                          onClick={() => { setNifSelecionado(ent.nif); setDropdownEmpresasAberto(false); setPagina(1); }}
                          className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition cursor-pointer ${
                            isSelected
                              ? 'bg-sky-50 dark:bg-sky-500/15 text-foreground font-semibold border-l-2 border-[#0284c7] dark:border-sky-400'
                              : 'hover:bg-slate-100 dark:hover:bg-[#142333] text-foreground dark:text-slate-200'
                          }`}
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className={`truncate font-sans font-medium text-xs text-foreground dark:text-slate-100 ${modoPrivacidade ? 'font-mono' : ''}`}>
                              {modoPrivacidade ? mascararTexto(ent.nomecli) : ent.nomecli}
                            </span>
                            <span className="font-mono text-[10.5px] text-[#0284c7] dark:text-sky-400">
                              {modoPrivacidade ? '■■■■■■■■■' : ent.nif}
                            </span>
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Campo de Pesquisa de Faturas / Contraparte */}
          <div className="relative w-64 md:w-80 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground dark:text-slate-400" />
            <input
              type="text"
              value={pesquisa}
              onChange={e => { setPesquisa(e.target.value); setPagina(1); }}
              placeholder="Pesquisar Fatura, NIF, Nome..."
              className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-[#0c1520] border border-slate-300/80 dark:border-[#222f3e] rounded text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary shadow-2xs"
            />
          </div>

          {/* Seletor de Taxa de IVA */}
          <div className="flex items-center space-x-1 bg-white/60 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] p-1 rounded shrink-0">
            <span className="text-[10px] font-mono text-muted-foreground dark:text-slate-400 px-1 font-semibold">IVA:</span>
            {[
              { val: "", label: "Todas" },
              { val: "23", label: "23%" },
              { val: "13", label: "13%" },
              { val: "6", label: "6%" },
              { val: "0", label: "Isento" }
            ].map(t => (
              <button
                key={t.val}
                type="button"
                onClick={() => { setTaxaFiltro(t.val); setPagina(1); }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer font-medium ${
                  taxaFiltro === t.val
                    ? 'bg-[#0284c7] text-white font-bold shadow-2xs'
                    : 'bg-white dark:bg-[#1c2e40] hover:bg-slate-100 dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Linha 2: Seletor de Exercício + Atalhos Temporais + 12 Meses + Datas Manuais */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-[#22364c] text-xs">
          
          {/* Seletor de Ano com Chevrons */}
          <div className="flex items-center space-x-1.5 shrink-0 bg-white/70 dark:bg-[#0c1520] px-2 py-1 rounded border border-slate-200 dark:border-[#1c2e42]">
            <span className="font-mono text-[10px] text-muted-foreground dark:text-slate-400 uppercase tracking-wider font-semibold">
              Ano:
            </span>
            <button
              onClick={() => { setAno(a => a - 1); setMesAtivo(null); setPagina(1); }}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-[#1e344f] text-muted-foreground dark:text-slate-300 transition cursor-pointer"
              title="Ano Anterior"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono font-bold text-xs text-[#0284c7] dark:text-sky-400 px-1">
              {ano}
            </span>
            <button
              onClick={() => { setAno(a => Math.min(anoAtual, a + 1)); setMesAtivo(null); setPagina(1); }}
              disabled={ano >= anoAtual}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-[#1e344f] text-muted-foreground dark:text-slate-300 transition cursor-pointer disabled:opacity-20"
              title="Ano Seguinte"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Atalhos Rápidos */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={aplicarAnoTodo}
              className={`px-2 py-1 text-[10px] font-mono rounded transition cursor-pointer font-medium ${
                mesAtivo === null && dataInicio === `${ano}-01-01` && dataFim === `${ano}-12-31`
                  ? 'bg-[#0284c7] text-white font-bold border border-[#0284c7] shadow-2xs'
                  : 'bg-white dark:bg-[#1c2e40] hover:bg-slate-100 dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563]'
              }`}
            >
              Ano Todo
            </button>

            {ano === anoAtual && (
              <button
                onClick={aplicarMesAtual}
                className={`px-2 py-1 text-[10px] font-mono rounded transition cursor-pointer font-medium ${
                  mesAtivo === mesAtual
                    ? 'bg-[#0284c7] text-white font-bold border border-[#0284c7] shadow-2xs'
                    : 'bg-white dark:bg-[#1c2e40] hover:bg-slate-100 dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563]'
                }`}
              >
                Mês Atual
              </button>
            )}

            <div className="h-4 w-px bg-slate-300/80 dark:bg-[#253a52] mx-0.5" />

            {/* Trimestres */}
            {[1, 2, 3, 4].map(t => (
              <button
                key={t}
                onClick={() => aplicarTrimestre(t)}
                className="px-1.5 py-1 text-[10px] font-mono rounded bg-white dark:bg-[#1c2e40] hover:bg-slate-100 dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563] transition cursor-pointer font-medium"
              >
                T{t}
              </button>
            ))}

            <div className="h-4 w-px bg-slate-300/80 dark:bg-[#253a52] mx-0.5" />

            {/* 12 Meses */}
            {MESES.map(m => {
              const isFuturo = ano === anoAtual && m.num > mesAtual;
              const isSelected = mesAtivo === m.num;
              return (
                <button
                  key={m.num}
                  disabled={isFuturo}
                  onClick={() => aplicarMesEspecifico(m.num)}
                  className={`px-1.5 py-1 text-[10px] font-mono rounded transition cursor-pointer ${
                    isFuturo
                      ? 'opacity-20 cursor-not-allowed text-muted-foreground border border-dashed border-slate-300 dark:border-[#22364c]'
                      : isSelected
                        ? 'bg-[#0284c7] text-white font-bold border border-[#0284c7] shadow-2xs'
                        : 'bg-white dark:bg-[#1c2e40] hover:bg-slate-100 dark:hover:bg-[#233a52] text-foreground dark:text-slate-200 border border-slate-200 dark:border-[#2c4563] font-medium'
                  }`}
                >
                  {m.nome}
                </button>
              );
            })}
          </div>

          {/* Intervalo Manual de Datas */}
          <div className="flex items-center space-x-1.5 font-mono text-xs bg-white/70 dark:bg-[#0c1520] px-2 py-1 rounded border border-slate-200 dark:border-[#1c2e42] shrink-0">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground dark:text-slate-400 shrink-0" />
            <input
              type="date"
              value={dataInicio}
              onChange={e => { setDataInicio(e.target.value); setMesAtivo(null); setPagina(1); }}
              className="bg-transparent text-foreground focus:outline-hidden text-xs cursor-pointer"
            />
            <span className="text-muted-foreground dark:text-slate-500 font-semibold">a</span>
            <input
              type="date"
              value={dataFim}
              onChange={e => { setDataFim(e.target.value); setMesAtivo(null); setPagina(1); }}
              className="bg-transparent text-foreground focus:outline-hidden text-xs cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 3. Ribbon de Cards KPIs Estruturados no Padrão Oficial EVO */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 shrink-0">
        
        {/* Card 1: Documentos Únicos */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7] dark:bg-sky-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Documentos Únicos</span>
            </div>
            <Receipt className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-foreground tabular-nums">
              {dados.total_documentos.toLocaleString('pt-PT')}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-sky-500/10 text-[#0284c7] dark:text-sky-400 border border-sky-500/20">
              Faturas
            </span>
          </div>
        </div>

        {/* Card 2: Total de Linhas */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Total de Linhas</span>
            </div>
            <Table2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-foreground tabular-nums">
              {dados.total_linhas.toLocaleString('pt-PT')}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              Linhas
            </span>
          </div>
        </div>

        {/* Card 3: Base Incidência */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Base Incidência</span>
            </div>
            <Euro className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-foreground tabular-nums">
              € {dados.soma_base.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Tributável
            </span>
          </div>
        </div>

        {/* Card 4: Total IVA */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7] dark:bg-sky-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Total IVA</span>
            </div>
            <Percent className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-[#0284c7] dark:text-sky-400 tabular-nums">
              € {dados.soma_iva.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-sky-500/10 text-[#0284c7] dark:text-sky-400 border border-sky-500/20">
              Imposto
            </span>
          </div>
        </div>

        {/* Card 5: Total Global */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between col-span-2 sm:col-span-1 overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Total Global</span>
            </div>
            <Euro className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              € {dados.soma_total.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              Líquido + IVA
            </span>
          </div>
        </div>

      </div>

      {/* 4. Tabela de Detalhe de Linhas de Fatura (Card Principal com Assinatura Canónica EVO) */}
      <div className="overflow-hidden rounded-md border border-border shadow-xs flex flex-col flex-1 min-h-0 bg-card text-card-foreground">
        
        {/* Cabeçalho do Card da Tabela com Assinatura Canónica EVO */}
        <div className="relative evo-card-signature flex flex-wrap justify-between items-center border-b border-border/80 px-4 py-2 bg-card text-card-foreground gap-3 shrink-0 select-none before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-md bg-muted dark:bg-[#132233] border border-border/80 dark:border-[#253a52] text-foreground shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-xs text-foreground truncate">
                Registos de Linhas de Fatura
              </span>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                {tipoOperacao === 'compras' ? 'Compras e-Fatura' : 'Vendas e-Fatura'}
              </span>
              {nifSelecionado && (
                <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/10 dark:bg-sky-500/15 border border-sky-400/40 dark:border-sky-500/30 shrink-0 max-w-[460px]">
                  <span className="text-[10px] font-mono font-bold text-[#0284c7] dark:text-sky-400">
                    {modoPrivacidade ? '■■■■■■■■■' : nifSelecionado}
                  </span>
                  <span className="text-muted-foreground/50 text-[10px]">·</span>
                  <span className={`text-[11px] font-sans font-semibold text-foreground dark:text-slate-100 truncate ${modoPrivacidade ? 'font-mono' : ''}`} title={mapaEntidades.get(nifSelecionado) || ''}>
                    {modoPrivacidade ? mascararTexto(mapaEntidades.get(nifSelecionado) || '') : (mapaEntidades.get(nifSelecionado) || nifSelecionado)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3 ml-auto">
            {/* Contador de Registos */}
            <div className="text-[11px] font-mono text-muted-foreground dark:text-slate-400">
              A exibir <strong className="text-foreground">{linhasProcessadas.length}</strong>
              {totalFiltrosAtivos > 0 && (
                <span className="text-[#0284c7] dark:text-sky-400 font-semibold"> (filtrados de {dados.linhas.length})</span>
              )} de{" "}
              <strong className="text-foreground">{dados.total_linhas.toLocaleString('pt-PT')}</strong> registos
            </div>

            {/* Alternador da Linha de Filtros Granulares por Coluna */}
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setMostrarFiltrosColunas(prev => !prev)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border text-xs font-mono transition cursor-pointer shadow-2xs ${
                  mostrarFiltrosColunas || totalFiltrosAtivos > 0
                    ? 'bg-[#0284c7] text-white border-[#0284c7] dark:bg-sky-600 dark:border-sky-600'
                    : 'bg-white dark:bg-[#152332] border-border/80 text-foreground hover:bg-muted'
                }`}
                title="Mostrar ou ocultar linha de filtros por coluna"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filtros</span>
                {totalFiltrosAtivos > 0 && (
                  <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                    {totalFiltrosAtivos}
                  </span>
                )}
              </button>

              {totalFiltrosAtivos > 0 && (
                <button
                  type="button"
                  onClick={limparTodosFiltros}
                  className="flex items-center space-x-1 px-2 py-1 rounded border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-xs font-mono transition cursor-pointer shadow-2xs"
                  title="Limpar todos os filtros por coluna"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  <span>Limpar</span>
                </button>
              )}
            </div>

            {/* Seletor de Colunas Visíveis (Memória Futura) */}
            <div className="relative" ref={colunasPopoverRef}>
              <button
                type="button"
                onClick={() => setMenuColunasAberto(prev => !prev)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border text-xs font-mono transition cursor-pointer shadow-2xs ${
                  menuColunasAberto
                    ? 'bg-[#0284c7] text-white border-[#0284c7]'
                    : 'bg-white dark:bg-[#152332] border-border/80 text-foreground hover:bg-muted'
                }`}
                title="Configurar colunas visíveis da tabela (guardado automaticamente)"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Colunas ({colunasAtivas.length}/{TODAS_AS_COLUNAS.length})</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${menuColunasAberto ? 'rotate-180' : ''}`} />
              </button>

              {menuColunasAberto && (
                <div className="absolute right-0 mt-1.5 w-80 max-h-[460px] flex flex-col rounded-lg bg-card dark:bg-[#0c1520] border border-border dark:border-[#222f3e] shadow-2xl z-50 text-foreground overflow-hidden">
                  {/* Topo do Menu com Ações Rápidas */}
                  <div className="p-2.5 border-b border-border/70 dark:border-[#1e2f42] bg-slate-100/90 dark:bg-[#101c2b] flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                      <span className="font-semibold text-xs text-foreground">Campos e-Fatura</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        data-action="selecionar-todas-colunas"
                        onClick={selecionarTodasColunas}
                        className="text-[10px] font-mono text-[#0284c7] dark:text-sky-400 hover:underline px-1 py-0.5 font-semibold cursor-pointer"
                      >
                        Todas
                      </button>
                      <span className="text-muted-foreground/40 text-[10px]">·</span>
                      <button
                        type="button"
                        data-action="restaurar-colunas-padrao"
                        onClick={restaurarColunasPadrao}
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-1 py-0.5 cursor-pointer"
                      >
                        Padrão
                      </button>
                    </div>
                  </div>

                  {/* Campo de Filtro Rápido de Colunas */}
                  <div className="p-2 border-b border-border/50 dark:border-[#1e2f42] bg-slate-50/50 dark:bg-[#09111a]">
                    <div className="relative">
                      <Search className="w-3 h-3 absolute left-2.5 top-2 text-muted-foreground" />
                      <input
                        type="text"
                        value={filtroColuna}
                        onChange={e => setFiltroColuna(e.target.value)}
                        placeholder="Pesquisar campo..."
                        className="w-full pl-7 pr-2 py-1 text-[11px] font-mono rounded bg-white dark:bg-[#0c1520] border border-border/80 dark:border-[#222f3e] focus:outline-none focus:border-[#0284c7] text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>

                  {/* Lista Agrupada por Categorias */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-3 max-h-[300px]">
                    {CATEGORIAS_COLUNAS.map(cat => {
                      const colunasDaCat = TODAS_AS_COLUNAS.filter(c => 
                        c.categoria === cat &&
                        (!filtroColuna || c.label.toLowerCase().includes(filtroColuna.toLowerCase()) || c.id.toLowerCase().includes(filtroColuna.toLowerCase()))
                      );
                      if (colunasDaCat.length === 0) return null;

                      return (
                        <div key={cat} className="space-y-1">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-muted-foreground/80 px-1 block font-bold">
                            {cat}
                          </span>
                          <div className="space-y-0.5">
                            {colunasDaCat.map(col => {
                              const ativa = colunasAtivas.includes(col.id);
                              return (
                                <label
                                  key={col.id}
                                  className="flex items-center space-x-2 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-[#142335] cursor-pointer select-none text-[11px] transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    checked={ativa}
                                    onChange={() => toggleColuna(col.id)}
                                    className="w-3.5 h-3.5 rounded border border-border dark:border-slate-600 bg-card text-[#0284c7] focus:ring-0 cursor-pointer accent-[#0284c7]"
                                  />
                                  <span className={`flex-1 truncate ${ativa ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                    {col.label}
                                  </span>
                                  <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">
                                    {col.shortLabel}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Rodapé Informativo */}
                  <div className="p-2 border-t border-border/60 dark:border-[#1e2f42] bg-slate-100/60 dark:bg-[#0a131e] text-[10px] text-muted-foreground flex items-center justify-between font-mono">
                    <span>{colunasAtivas.length} colunas visíveis</span>
                    <span className="text-[9.5px] text-[#0284c7] dark:text-sky-400 font-medium">Gravado na memória</span>
                  </div>
                </div>
              )}
            </div>

            {/* Botão Copiar Linhas TSV para Excel */}
            <button
              onClick={copiarParaClipboard}
              disabled={dados.linhas.length === 0}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded border border-border/80 bg-white dark:bg-[#152332] text-xs font-mono text-foreground hover:bg-muted transition cursor-pointer shadow-2xs"
              title="Copiar dados formatados para colar diretamente no Excel"
            >
              {copiado ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
              <span>{copiado ? "Copiado!" : "Copiar (Excel)"}</span>
            </button>

            {/* Seletor de Limite de Registos */}
            <div className="flex items-center space-x-1 font-mono text-xs text-muted-foreground">
              <select
                value={limite}
                onChange={e => { setLimite(Number(e.target.value)); setPagina(1); }}
                className="bg-white dark:bg-[#152332] border border-border/80 rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-hidden cursor-pointer"
              >
                <option value="100">100 / pág.</option>
                <option value="200">200 / pág.</option>
                <option value="500">500 / pág.</option>
              </select>
            </div>
          </div>
        </div>

        {/* Área de Scroll da Folha de Cálculo / Tabela */}
        <div className="flex-1 overflow-x-auto overflow-y-auto bg-card">
          <table className="w-full text-[11px] text-left whitespace-nowrap bg-card border-collapse">
            <thead className="bg-slate-200/90 dark:bg-[#0c1724] text-slate-800 dark:text-slate-100 font-semibold sticky top-0 z-20 shadow-xs border-b border-sky-300/40 dark:border-sky-500/30 select-none">
              <tr className="font-mono text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-[0.12em]">
                {colunasVisiveisConfig.map((col, index) => {
                  const isLast = index === colunasVisiveisConfig.length - 1;
                  const isSorted = sortCol === col.id;
                  return (
                    <th
                      key={col.id}
                      onClick={() => handleSort(col.id)}
                      className={`py-2 px-2.5 transition-colors cursor-pointer select-none group hover:bg-sky-300/30 dark:hover:bg-sky-500/20 ${
                        isSorted ? 'bg-sky-200/80 dark:bg-sky-900/40 text-[#0284c7] dark:text-sky-300 font-bold' : ''
                      } ${
                        col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                      } ${!isLast ? 'border-r border-sky-200/40 dark:border-sky-500/20' : ''}`}
                      title={`Ordenar por ${col.label} (${isSorted ? (sortDir === 'asc' ? 'Crescente -> clique para Decrescente' : 'Decrescente -> clique para Crescente') : 'Clique para ordenar'})`}
                    >
                      <div className={`flex items-center space-x-1 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                        <span>{col.shortLabel || col.label}</span>
                        <span className="inline-flex shrink-0">
                          {isSorted ? (
                            sortDir === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-opacity" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>

              {/* Linha de Filtros Granulares por Coluna */}
              {mostrarFiltrosColunas && (
                <tr className="bg-slate-100/95 dark:bg-[#0a1420] border-t border-sky-300/30 dark:border-sky-500/20">
                  {colunasVisiveisConfig.map((col, index) => {
                    const isLast = index === colunasVisiveisConfig.length - 1;
                    return (
                      <th
                        key={`filtro-${col.id}`}
                        className={`py-1 px-1 font-normal ${!isLast ? 'border-r border-sky-200/30 dark:border-sky-500/10' : ''}`}
                      >
                        {renderFiltroColuna(col)}
                      </th>
                    );
                  })}
                </tr>
              )}
            </thead>
            <tbody className="font-mono text-[11px]">
              {linhasProcessadas.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(1, colunasVisiveisConfig.length)} className="p-10 text-center text-muted-foreground font-sans">
                    {carregando ? (
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Loader2 className="w-5 h-5 animate-spin text-[#0284c7] dark:text-sky-400" />
                        <span>A ler registos da base de dados...</span>
                      </div>
                    ) : totalFiltrosAtivos > 0 ? (
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <span>Nenhum registo corresponde aos filtros de coluna aplicados.</span>
                        <button
                          type="button"
                          onClick={limparTodosFiltros}
                          className="text-xs text-[#0284c7] dark:text-sky-400 underline font-semibold cursor-pointer"
                        >
                          Limpar filtros de coluna
                        </button>
                      </div>
                    ) : (
                      "Nenhuma fatura encontrada com os filtros selecionados."
                    )}
                  </td>
                </tr>
              ) : (
                linhasProcessadas.map((linha, idx) => {
                  const meta = metadadosLinhas[idx];
                  const isFaturaPar = meta ? meta.isFaturaPar : (idx % 2 === 0);
                  const ehNovaFatura = meta ? meta.ehNovaFatura : true;

                  return (
                    <tr
                      key={linha.id || idx}
                      className={`transition-colors hover:bg-sky-200/70 dark:hover:bg-sky-400/25 ${
                        isFaturaPar
                          ? 'bg-white dark:bg-[#07121c]'
                          : 'bg-[#e4effa] dark:bg-[#162f49]'
                      } ${
                        ehNovaFatura && idx > 0
                          ? 'border-t-2 border-sky-300 dark:border-sky-500/50'
                          : 'border-t border-dashed border-slate-200/80 dark:border-sky-500/10'
                      }`}
                    >
                      {colunasVisiveisConfig.map((col, cIdx) => {
                        const isLast = cIdx === colunasVisiveisConfig.length - 1;
                        return (
                          <td
                            key={col.id}
                            className={`py-1.5 px-2.5 whitespace-nowrap ${
                              !isLast ? 'border-r border-sky-200/40 dark:border-sky-500/20' : ''
                            } ${
                              col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                            }`}
                          >
                            {renderCelula(col.id, linha)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé de Paginação */}
        <div className="p-2.5 border-t border-border/80 bg-slate-100/60 dark:bg-[#0c1724] flex items-center justify-between shrink-0 font-mono text-xs select-none">
          <span className="text-muted-foreground">
            Página <strong className="text-foreground">{pagina}</strong> de{" "}
            <strong className="text-foreground">{totalPaginas}</strong>
          </span>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setPagina(p => Math.max(1, p - 1))}
              disabled={pagina <= 1 || carregando}
              className="px-2.5 py-1 rounded border border-border/80 bg-white dark:bg-[#152332] text-muted-foreground hover:text-foreground disabled:opacity-20 transition cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5 inline mr-0.5" /> Anterior
            </button>
            <span className="px-2 font-bold text-foreground">
              {pagina}
            </span>
            <button
              onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas || carregando}
              className="px-2.5 py-1 rounded border border-border/80 bg-white dark:bg-[#152332] text-muted-foreground hover:text-foreground disabled:opacity-20 transition cursor-pointer"
            >
              Próxima <ChevronRight className="w-3.5 h-3.5 inline ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
