import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileText,
  Home,
  Play,
  Square,
  RotateCcw,
  Search,
  FolderOpen,
  Copy,
  Check,
  FileCheck2,
  Loader2,
  KeyRound,
  Save,
  Table2,
  ListFilter,
  Trash2,
  X,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  TrendingUp,
  Globe,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Sparkles,
  SlidersHorizontal,
  ChevronDown
} from 'lucide-react';
import { EmpresaSelectorCombobox } from './EmpresaSelectorCombobox';
import { AssistenteImportacaoPanel } from './AssistenteImportacaoPanel';
import { obterLocalFsCentroConfig } from '../lib/localFsBridge';

interface Entidade {
  id: string;
  cod: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
  tem_credenciais_at: boolean;
  subutilizador?: string;
}

interface MesRVInfo {
  docs: number;
  rv: number;
  rendas: number;
  baixados: number;
  anulados: number;
  base: number;
  iva: number;
  irs: number;
  selo: number;
  liquido: number;
  incompleto?: boolean;
}

interface EmpresaMatrizRV {
  meses: Record<number, MesRVInfo>;
  total_docs_ano: number;
  total_rv_ano: number;
  total_rendas_ano: number;
  total_rendas_historico: number;
  total_baixados_ano: number;
  total_anulados_ano: number;
  total_base_ano: number;
  total_iva_ano: number;
  total_irs_ano: number;
  total_selo_ano: number;
  total_liquido_ano: number;
  tem_incompletos: boolean;
  meses_incompletos: number[];
  caminho_xml: string;
  ultima_atualizacao: string;
}

interface DocumentoRVRow {
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
  dta_prestacao: string;
  valor_base: number;
  valor_iva: number;
  imposto_selo: number;
  valor_irs: number;
  importancia_recebida: number;
  descricao: string;
  ativid_exercida: string;
  baixado: string;
  caminho_pdf: string;
}

interface JobProgressRV {
  jobId: string;
  nif: string;
  status: 'em_progresso' | 'concluido' | 'erro' | 'cancelado';
  percentagem: number;
  mensagem: string;
  docsAtuais: number;
  totalEsperado: number;
}

interface RecibosVerdesViewProps {
  ano: number;
  onAnoChange: (ano: number) => void;
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

const MESES_NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function RecibosVerdesView({
  ano,
  onAnoChange,
  onApiStatusChange,
  modoPrivacidade = false,
}: RecibosVerdesViewProps) {
  // Sub-vista ativa: 'matriz' (grelha 12 meses) ou 'documentos' (tabela detalhada de recibos verdes e rendas)
  const [vista, setVista] = useState<'matriz' | 'documentos'>('matriz');
  const [tipoFluxo, setTipoFluxo] = useState<'compras' | 'vendas'>('compras');

  // Opções de extração
  const [incluirRv, setIncluirRv] = useState<boolean>(true);
  const [incluirRendas, setIncluirRendas] = useState<boolean>(true);
  const [baixarPdfs, setBaixarPdfs] = useState<boolean>(false);
  const [reimportarTudo, setReimportarTudo] = useState<boolean>(false);
  const [gerarXmlLegado, setGerarXmlLegado] = useState<boolean>(() => {
    const saved = localStorage.getItem('gexcel_alimentar_xml_legado');
    return saved !== null ? saved === 'true' : true;
  });

  // Caminhos BdsefaturaV4 (SQLite), BdsRV (XML) e BdsRV_PDFs
  const [pastaV4, setPastaV4] = useState<string>('');
  const [pastaBdsrv, setPastaBdsrv] = useState<string>('');
  const [pastaPdfs, setPastaPdfs] = useState<string>('');
  const [pastaPdfsEdit, setPastaPdfsEdit] = useState<string>('');
  const [editandoPastaPdfs, setEditandoPastaPdfs] = useState<boolean>(false);
  const [copiadoCaminho, setCopiadoCaminho] = useState<string | null>(null);

  // Dados de Entidades e Matriz Anual
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [matrizEmpresas, setMatrizEmpresas] = useState<Record<string, EmpresaMatrizRV>>({});
  const [senhasInvalidas, setSenhasInvalidas] = useState<Record<string, any>>({});
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [nifMatrizFiltro, setNifMatrizFiltro] = useState<string>('');
  const [carregandoMatriz, setCarregandoMatriz] = useState<boolean>(false);
  const [apiOnlineLocal, setApiOnlineLocal] = useState<boolean | null>(null);
  const [assistenteAberto, setAssistenteAberto] = useState<boolean>(() => localStorage.getItem('gexcel_rv_assistente_fechado') !== 'true');
  const [passoAssistente, setPassoAssistente] = useState<1 | 2 | 3 | 4>(1);
  const [opcoesPopoverAberto, setOpcoesPopoverAberto] = useState<boolean>(false);
  const [caminhoDestinoLocal, setCaminhoDestinoLocal] = useState<string>(
    () => obterLocalFsCentroConfig()?.pasta_v4_display || 'C:\\Dados_evoGex\\BdsefaturaV4'
  );

  const abrirAssistente = () => {
    setVista('matriz');
    setAssistenteAberto(true);
    localStorage.setItem('gexcel_rv_assistente_fechado', 'false');
  };

  const fecharAssistente = () => {
    setAssistenteAberto(false);
    localStorage.setItem('gexcel_rv_assistente_fechado', 'true');
  };

  useEffect(() => {
    const onFsUpdated = () => {
      const cfg = obterLocalFsCentroConfig();
      if (cfg?.pasta_v4_display) setCaminhoDestinoLocal(cfg.pasta_v4_display);
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

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
      return mapaEntidades.get(n) || fallback || `Entidade ${n}`;
    },
    [mapaEntidades]
  );

  // Ordenação da Matriz
  const [sortColMatriz, setSortColMatriz] = useState<string>('total_docs_ano');
  const [sortDirMatriz, setSortDirMatriz] = useState<'asc' | 'desc'>('desc');

  // Jobs de Extração em Curso
  const [jobsPorNif, setJobsPorNif] = useState<Record<string, JobProgressRV>>({});
  const [extraindoLote, setExtraindoLote] = useState<boolean>(false);
  const [loginEmCurso, setLoginEmCurso] = useState<string | null>(null);
  const [loginStatusMsg, setLoginStatusMsg] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null);
  const pollingRef = useRef<number | null>(null);

  // Estado da Consulta Detalhada de Documentos
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  const [nifDetalhe, setNifDetalhe] = useState<string>('');
  const [mesDetalhe, setMesDetalhe] = useState<number>(0); // 0 = Todos os meses
  const [trimestreDetalhe, setTrimestreDetalhe] = useState<number | null>(null);
  const [filtroTemporalAtivo, setFiltroTemporalAtivo] = useState<'ano_todo' | 'mes' | 'trimestre' | 'manual'>('ano_todo');
  const [dataInicioDetalhe, setDataInicioDetalhe] = useState<string>(`${ano}-01-01`);
  const [dataFimDetalhe, setDataFimDetalhe] = useState<string>(`${ano}-12-31`);
  const [categoriaDetalhe, setCategoriaDetalhe] = useState<'todos' | 'rv' | 'rendas'>('todos');
  const [situacaoDetalhe, setSituacaoDetalhe] = useState<string>('');
  const [apenasAnoEmissao, setApenasAnoEmissao] = useState<boolean>(true);
  const [pesquisaDetalhe, setPesquisaDetalhe] = useState<string>('');
  const [documentos, setDocumentos] = useState<DocumentoRVRow[]>([]);
  const [resumoDetalhe, setResumoDetalhe] = useState({
    total_documentos: 0,
    total_rv: 0,
    total_rendas: 0,
    total_anulados: 0,
    total_pdfs_baixados: 0,
    soma_base: 0,
    soma_iva: 0,
    soma_irs: 0,
    soma_selo: 0,
    soma_liquido: 0,
  });
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<boolean>(false);
  const [sortColDetalhe, setSortColDetalhe] = useState<string>('dta_emissao');
  const [sortDirDetalhe, setSortDirDetalhe] = useState<'asc' | 'desc'>('desc');

  // Sincronizar datas do filtro temporal quando o ano muda
  useEffect(() => {
    if (filtroTemporalAtivo === 'ano_todo') {
      setDataInicioDetalhe(`${ano}-01-01`);
      setDataFimDetalhe(`${ano}-12-31`);
    } else if (filtroTemporalAtivo === 'mes' && mesDetalhe > 0) {
      const ultimoDia = new Date(ano, mesDetalhe, 0).getDate();
      setDataInicioDetalhe(`${ano}-${String(mesDetalhe).padStart(2, '0')}-01`);
      setDataFimDetalhe(`${ano}-${String(mesDetalhe).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`);
    } else if (filtroTemporalAtivo === 'trimestre' && trimestreDetalhe) {
      const mIni = (trimestreDetalhe - 1) * 3 + 1;
      const mFim = trimestreDetalhe * 3;
      const ultimoDia = new Date(ano, mFim, 0).getDate();
      setDataInicioDetalhe(`${ano}-${String(mIni).padStart(2, '0')}-01`);
      setDataFimDetalhe(`${ano}-${String(mFim).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`);
    }
  }, [ano, filtroTemporalAtivo, mesDetalhe, trimestreDetalhe]);

  const formatarMoeda = (val: number) =>
    (val || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ofuscarNome = (nome: string, nif: string) => {
    if (!modoPrivacidade) return nome;
    return `Entidade Demo ${nif.slice(-4)}, Lda`;
  };

  const ofuscarNif = (nif: string) => {
    if (!modoPrivacidade || !nif) return nif;
    return `599${nif.slice(3)}`;
  };

  // 1. Carregar configurações e entidades
  const carregarConfigEEntidades = useCallback(async () => {
    try {
      const [resCfg, resEnt] = await Promise.all([
        fetch('http://127.0.0.1:8015/api/recibos-verdes/config'),
        fetch('http://127.0.0.1:8015/api/entidades'),
      ]);
      if (resCfg.ok) {
        const cfg = await resCfg.json();
        setPastaV4(cfg.pasta_v4 || '');
        setPastaBdsrv(cfg.pasta_bdsrv || '');
        setPastaPdfs(cfg.pasta_pdfs || '');
        setPastaPdfsEdit(cfg.pasta_pdfs || '');
        if (typeof cfg.alimentar_xml_legado === 'boolean') {
          setGerarXmlLegado(cfg.alimentar_xml_legado);
          localStorage.setItem('gexcel_alimentar_xml_legado', String(cfg.alimentar_xml_legado));
        }
        onApiStatusChange?.(true);
        setApiOnlineLocal(true);
      }
      if (resEnt.ok) {
        const dataEnt = await resEnt.json();
        setEntidades(dataEnt.entidades || []);
      }
    } catch {
      onApiStatusChange?.(false);
      setApiOnlineLocal(false);
    }
  }, [onApiStatusChange]);

  // 2. Carregar Matriz Anual RV
  const carregarMatriz = useCallback(async () => {
    setCarregandoMatriz(true);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/recibos-verdes/matriz/${ano}?tipo=${tipoFluxo}`);
      if (res.ok) {
        const data = await res.json();
        setMatrizEmpresas(data.empresas || {});
        setSenhasInvalidas(data.senhas_invalidas || {});
        if (data.pasta_v4) setPastaV4(data.pasta_v4);
        if (data.pasta_bdsrv) setPastaBdsrv(data.pasta_bdsrv);
        if (typeof data.alimentar_xml_legado === 'boolean') {
          setGerarXmlLegado(data.alimentar_xml_legado);
        }
        if (data.pasta_pdfs) {
          setPastaPdfs(data.pasta_pdfs);
          if (!editandoPastaPdfs) setPastaPdfsEdit(data.pasta_pdfs);
        }
        onApiStatusChange?.(true);
      }
    } catch {
      onApiStatusChange?.(false);
    } finally {
      setCarregandoMatriz(false);
    }
  }, [ano, tipoFluxo, editandoPastaPdfs, onApiStatusChange]);

  // 3. Carregar Documentos Detalhados
  const carregarDocumentos = useCallback(async () => {
    setCarregandoDetalhe(true);
    try {
      const params = new URLSearchParams();
      params.set('tipo', tipoFluxo);
      params.set('ano', String(ano));
      if (nifDetalhe) params.set('nif', nifDetalhe);
      if (filtroTemporalAtivo === 'mes' && mesDetalhe > 0) params.set('mes', String(mesDetalhe));
      params.set('categoria', categoriaDetalhe);
      if (situacaoDetalhe) params.set('situacao', situacaoDetalhe);
      params.set('apenas_ano_emissao', String(apenasAnoEmissao));
      if (pesquisaDetalhe.trim()) params.set('pesquisa', pesquisaDetalhe.trim());
      params.set('ordenar_por', sortColDetalhe);
      params.set('ordem', sortDirDetalhe);
      params.set('limite', filtroTemporalAtivo === 'trimestre' || filtroTemporalAtivo === 'manual' ? '2000' : '500');

      const res = await fetch(`http://127.0.0.1:8015/api/recibos-verdes/consultar?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocumentos(data.linhas || []);
        setResumoDetalhe({
          total_documentos: data.total_documentos || 0,
          total_rv: data.total_rv || 0,
          total_rendas: data.total_rendas || 0,
          total_anulados: data.total_anulados || 0,
          total_pdfs_baixados: data.total_pdfs_baixados || 0,
          soma_base: data.soma_base || 0,
          soma_iva: data.soma_iva || 0,
          soma_irs: data.soma_irs || 0,
          soma_selo: data.soma_selo || 0,
          soma_liquido: data.soma_liquido || 0,
        });
        onApiStatusChange?.(true);
      }
    } catch {
      onApiStatusChange?.(false);
    } finally {
      setCarregandoDetalhe(false);
    }
  }, [ano, tipoFluxo, nifDetalhe, filtroTemporalAtivo, mesDetalhe, categoriaDetalhe, situacaoDetalhe, apenasAnoEmissao, pesquisaDetalhe, sortColDetalhe, sortDirDetalhe, onApiStatusChange]);

  const documentosFiltrados = useMemo(() => {
    if (filtroTemporalAtivo !== 'trimestre' && filtroTemporalAtivo !== 'manual') {
      return documentos;
    }
    return documentos.filter(doc => {
      const dt = (doc.dta_emissao || '').slice(0, 10);
      if (!dt) return false;
      if (dataInicioDetalhe && dt < dataInicioDetalhe) return false;
      if (dataFimDetalhe && dt > dataFimDetalhe) return false;
      return true;
    });
  }, [documentos, filtroTemporalAtivo, dataInicioDetalhe, dataFimDetalhe]);

  const resumoExibido = useMemo(() => {
    if (filtroTemporalAtivo !== 'trimestre' && filtroTemporalAtivo !== 'manual') {
      return resumoDetalhe;
    }
    let total_rv = 0;
    let total_rendas = 0;
    let total_anulados = 0;
    let total_pdfs_baixados = 0;
    let soma_base = 0;
    let soma_iva = 0;
    let soma_irs = 0;
    let soma_selo = 0;
    let soma_liquido = 0;

    for (const d of documentosFiltrados) {
      if (d.tipo_doc === 'RECIBO-RENDA') total_rendas++;
      else total_rv++;
      if ((d.situacao || '').toLowerCase().includes('anulado')) total_anulados++;
      if (d.baixado === 'sim' && d.caminho_pdf) total_pdfs_baixados++;
      soma_base += d.valor_base || 0;
      soma_iva += d.valor_iva || 0;
      soma_irs += d.valor_irs || 0;
      soma_selo += d.imposto_selo || 0;
      soma_liquido += d.importancia_recebida || 0;
    }

    return {
      total_documentos: documentosFiltrados.length,
      total_rv,
      total_rendas,
      total_anulados,
      total_pdfs_baixados,
      soma_base,
      soma_iva,
      soma_irs,
      soma_selo,
      soma_liquido,
    };
  }, [filtroTemporalAtivo, documentosFiltrados, resumoDetalhe]);

  useEffect(() => {
    carregarConfigEEntidades();
  }, [carregarConfigEEntidades]);

  useEffect(() => {
    carregarMatriz();
  }, [carregarMatriz]);

  useEffect(() => {
    if (vista === 'documentos') {
      carregarDocumentos();
    }
  }, [vista, carregarDocumentos]);

  // 4. Polling de Jobs de Extração Ativos
  useEffect(() => {
    const jobsAtivos = Object.values(jobsPorNif).filter(j => j.status === 'em_progresso');
    if (jobsAtivos.length === 0) {
      setExtraindoLote(false);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    setExtraindoLote(true);
    const poll = async () => {
      let algumTerminou = false;
      const updates: Record<string, JobProgressRV> = {};

      await Promise.all(
        jobsAtivos.map(async (job) => {
          try {
            const res = await fetch(`http://127.0.0.1:8015/api/extracao/status/${job.jobId}`);
            if (res.ok) {
              const st = await res.json();
              const novoStatus = st.status === 'concluido' ? 'concluido' : st.status === 'erro' ? 'erro' : st.status === 'cancelado' ? 'cancelado' : 'em_progresso';
              if (novoStatus !== 'em_progresso') {
                algumTerminou = true;
              }
              updates[job.nif] = {
                jobId: job.jobId,
                nif: job.nif,
                status: novoStatus,
                percentagem: st.percentagem || 0,
                mensagem: st.mensagem || '',
                docsAtuais: st.docs_atuais || 0,
                totalEsperado: st.total_esperado || 0,
              };
            }
          } catch {}
        })
      );

      if (Object.keys(updates).length > 0) {
        setJobsPorNif(prev => ({ ...prev, ...updates }));
      }
      if (algumTerminou) {
        carregarMatriz();
        if (vista === 'documentos') carregarDocumentos();
      }
    };

    const timer = window.setInterval(poll, 1500);
    pollingRef.current = timer;
    return () => clearInterval(timer);
  }, [jobsPorNif, carregarMatriz, carregarDocumentos, vista]);

  // 5. Funções Auxiliares de Caminho e Explorador do Windows
  const abrirNoExplorador = async (caminho: string) => {
    if (!caminho) return;
    try {
      await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho }),
      });
    } catch {}
  };

  const copiarEndereco = (caminho: string) => {
    if (!caminho) return;
    navigator.clipboard.writeText(caminho);
    setCopiadoCaminho(caminho);
    setTimeout(() => setCopiadoCaminho(null), 2000);
  };

  const guardarPastaPdfs = async () => {
    if (!pastaPdfsEdit.trim()) return;
    try {
      const res = await fetch('http://127.0.0.1:8015/api/recibos-verdes/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pasta_pdfs: pastaPdfsEdit.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setPastaPdfs(data.pasta_pdfs);
        setEditandoPastaPdfs(false);
        carregarMatriz();
      }
    } catch {}
  };

  const toggleGerarXmlLegado = async (novoValor: boolean) => {
    setGerarXmlLegado(novoValor);
    localStorage.setItem('gexcel_alimentar_xml_legado', String(novoValor));
    try {
      await fetch('http://127.0.0.1:8015/api/app/config/xml-legado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alimentar_xml_legado: novoValor }),
      });
    } catch {}
  };

  // 6. Disparo de Extração (Individual ou Lote)
  const iniciarExtracaoEntidade = async (ent: Entidade) => {
    if (!incluirRv && !incluirRendas) {
      alert('Selecione pelo menos um tipo de documento (Recibos Verdes ou Recibos de Renda).');
      return;
    }
    try {
      const res = await fetch('http://127.0.0.1:8015/api/recibos-verdes/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nif: ent.nif,
          nome_entidade: ent.nomecli,
          ano,
          tipo: tipoFluxo,
          incluir_rv: incluirRv,
          incluir_rendas: incluirRendas,
          baixar_pdfs: baixarPdfs,
          pasta_pdfs: pastaPdfs,
          id_contab: ent.cod || '',
          reimportar_tudo: reimportarTudo,
          gerar_xml_legado: gerarXmlLegado,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setJobsPorNif(prev => ({
          ...prev,
          [ent.nif]: {
            jobId: data.job_id,
            nif: ent.nif,
            status: 'em_progresso',
            percentagem: 5,
            mensagem: 'Iniciado...',
            docsAtuais: 0,
            totalEsperado: 0,
          },
        }));
      }
    } catch {}
  };

  const iniciarExtracaoSelecionadas = async () => {
    const listaAlvo = entidades.filter(e => selecionadas.has(e.nif));
    if (listaAlvo.length === 0) return;
    for (const ent of listaAlvo) {
      await iniciarExtracaoEntidade(ent);
    }
  };

  const pararTodasExtracoes = async () => {
    try {
      await fetch('http://127.0.0.1:8015/api/extracao/parar-tudo', { method: 'POST' });
      setJobsPorNif(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (next[k].status === 'em_progresso') {
            next[k] = { ...next[k], status: 'cancelado', mensagem: 'Cancelado' };
          }
        }
        return next;
      });
    } catch {}
  };

  const abrirPortalBrowser = async (nif: string, nomeEmpresa?: string) => {
    if (loginEmCurso) return;
    setLoginEmCurso(nif);
    setLoginStatusMsg({ tipo: 'info', texto: `A iniciar sessão de Recibos Verdes no navegador para ${nomeEmpresa || nif}...` });

    try {
      const res = await fetch('http://127.0.0.1:8015/api/efatura/login-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nif, canal: 'auto', destino: 'recibos_verdes' }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Falha na comunicação com a API.' }));
        setLoginStatusMsg({ tipo: 'erro', texto: err.detail || 'Erro ao abrir navegador com login automático.' });
        carregarMatriz();
        setTimeout(() => setLoginStatusMsg(null), 7000);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.modo === 'cloud_redirect' && data.portal_url) {
        try {
          if (data.utilizador && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(String(data.utilizador));
          }
        } catch {}
        window.open(data.portal_url, '_blank', 'noopener,noreferrer');
        setLoginStatusMsg({
          tipo: 'sucesso',
          texto: `Portal de Recibos Verdes aberto para ${data.utilizador || nif} (utilizador copiado para a área de transferência).`,
        });
        setTimeout(() => setLoginStatusMsg(null), 6000);
        return;
      }

      setLoginStatusMsg({ tipo: 'sucesso', texto: `Sessão de Recibos Verdes iniciada no navegador para NIF ${nif}!` });
      setTimeout(() => setLoginStatusMsg(null), 5000);
      setTimeout(() => carregarMatriz(), 6500);
      setTimeout(() => carregarMatriz(), 12000);
    } catch (e: any) {
      setLoginStatusMsg({ tipo: 'erro', texto: `Erro ao contactar API: ${e?.message || 'Falha de ligação'}` });
      setTimeout(() => setLoginStatusMsg(null), 5000);
    } finally {
      setTimeout(() => setLoginEmCurso(null), 2000);
    }
  };

  const limparDadosEntidade = async (nif: string) => {
    if (!confirm(`Eliminar ficheiro XML de Recibos Verdes e Rendas da entidade ${nif} (${ano})?`)) return;
    try {
      const res = await fetch('http://127.0.0.1:8015/api/recibos-verdes/limpar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nif, ano, tipo: tipoFluxo }),
      });
      if (res.ok) {
        carregarMatriz();
        if (vista === 'documentos') carregarDocumentos();
      }
    } catch {}
  };

  // 7. Construção das Linhas da Matriz com todas as Entidades + NIFs presentes em BdsRV
  const entidadesCombobox = useMemo(() => {
    const mapa = new Map<string, Entidade>();
    for (const e of entidades) {
      const n = (e.nif || '').trim();
      if (n) {
        mapa.set(n, { ...e, nomecli: resolverNomeEntidade(n, e.nomecli) });
      }
    }
    for (const nifXml of Object.keys(matrizEmpresas)) {
      if (!mapa.has(nifXml)) {
        mapa.set(nifXml, {
          id: nifXml,
          cod: '',
          nif: nifXml,
          nomecli: resolverNomeEntidade(nifXml, `Entidade ${nifXml}`),
          tem_credenciais_at: false,
        });
      }
    }
    return Array.from(mapa.values()).sort((a, b) => (a.nomecli || '').localeCompare(b.nomecli || ''));
  }, [entidades, matrizEmpresas, resolverNomeEntidade]);

  const linhasMatriz = useMemo(() => {
    const mapaEnt = new Map<string, Entidade>();
    for (const e of entidades) {
      const n = (e.nif || '').trim();
      if (n) mapaEnt.set(n, { ...e, nomecli: resolverNomeEntidade(n, e.nomecli) });
    }
    for (const nifXml of Object.keys(matrizEmpresas)) {
      if (!mapaEnt.has(nifXml)) {
        mapaEnt.set(nifXml, {
          id: nifXml,
          cod: '',
          nif: nifXml,
          nomecli: resolverNomeEntidade(nifXml, `Entidade ${nifXml}`),
          tem_credenciais_at: false,
        });
      }
    }

    const lista = Array.from(mapaEnt.values()).filter(ent => {
      if (nifMatrizFiltro && ent.nif !== nifMatrizFiltro) return false;
      return true;
    });

    lista.sort((a, b) => {
      const da = matrizEmpresas[a.nif];
      const db = matrizEmpresas[b.nif];
      const mult = sortDirMatriz === 'asc' ? 1 : -1;

      if (sortColMatriz === 'nif') return a.nif.localeCompare(b.nif) * mult;
      if (sortColMatriz === 'nomecli') return (a.nomecli || '').localeCompare(b.nomecli || '') * mult;
      if (sortColMatriz === 'cod') return (a.cod || '').localeCompare(b.cod || '') * mult;
      if (sortColMatriz === 'total_rv_ano') return ((da?.total_rv_ano || 0) - (db?.total_rv_ano || 0)) * mult;
      if (sortColMatriz === 'total_rendas_ano') return ((da?.total_rendas_ano || 0) - (db?.total_rendas_ano || 0)) * mult;
      if (sortColMatriz === 'total_baixados_ano') return ((da?.total_baixados_ano || 0) - (db?.total_baixados_ano || 0)) * mult;
      if (sortColMatriz === 'total_base_ano') return ((da?.total_base_ano || 0) - (db?.total_base_ano || 0)) * mult;
      if (sortColMatriz === 'total_docs_ano') return ((da?.total_docs_ano || 0) - (db?.total_docs_ano || 0)) * mult;

      if (sortColMatriz.startsWith('mes_')) {
        const mNum = parseInt(sortColMatriz.replace('mes_', ''), 10);
        const va = da?.meses?.[mNum]?.docs || 0;
        const vb = db?.meses?.[mNum]?.docs || 0;
        return (va - vb) * mult;
      }
      return 0;
    });

    return lista;
  }, [entidades, matrizEmpresas, nifMatrizFiltro, sortColMatriz, sortDirMatriz, resolverNomeEntidade]);

  // Totais Globais da Matriz
  const totaisGlobaisMatriz = useMemo(() => {
    let totalDocs = 0;
    let totalRv = 0;
    let totalRendas = 0;
    let totalPdfs = 0;
    let totalBase = 0;
    let totalIrs = 0;

    for (const emp of Object.values(matrizEmpresas)) {
      totalDocs += emp.total_docs_ano || 0;
      totalRv += emp.total_rv_ano || 0;
      totalRendas += emp.total_rendas_ano || 0;
      totalPdfs += emp.total_baixados_ano || 0;
      totalBase += emp.total_base_ano || 0;
      totalIrs += emp.total_irs_ano || 0;
    }
    return { totalDocs, totalRv, totalRendas, totalPdfs, totalBase, totalIrs };
  }, [matrizEmpresas]);

  const handleSortMatriz = (col: string) => {
    if (sortColMatriz === col) {
      setSortDirMatriz(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColMatriz(col);
      setSortDirMatriz('desc');
    }
  };

  const renderSortIconMatriz = (col: string) => {
    if (sortColMatriz !== col) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500 ml-1 inline shrink-0" />;
    return sortDirMatriz === 'asc'
      ? <ArrowUp className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />
      : <ArrowDown className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />;
  };

  const handleSortDetalhe = (col: string) => {
    if (sortColDetalhe === col) {
      setSortDirDetalhe(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColDetalhe(col);
      setSortDirDetalhe('desc');
    }
  };

  const renderSortIconDetalhe = (col: string) => {
    if (sortColDetalhe !== col) return <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500 ml-1 inline shrink-0" />;
    return sortDirDetalhe === 'asc'
      ? <ArrowUp className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />
      : <ArrowDown className="w-3 h-3 text-[#0284c7] dark:text-sky-400 ml-1 inline shrink-0" />;
  };

  const toggleSelecionarTodas = () => {
    if (selecionadas.size === linhasMatriz.length && linhasMatriz.length > 0) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(linhasMatriz.map(e => e.nif)));
    }
  };

  const toggleSelecionarNif = (nif: string) => {
    setSelecionadas(prev => {
      const next = new Set(prev);
      if (next.has(nif)) next.delete(nif);
      else next.add(nif);
      return next;
    });
  };

  const aplicarAnoTodo = () => {
    setFiltroTemporalAtivo('ano_todo');
    setMesDetalhe(0);
    setTrimestreDetalhe(null);
  };

  const aplicarMesAtual = () => {
    if (ano !== anoAtual) onAnoChange(anoAtual);
    setFiltroTemporalAtivo('mes');
    setMesDetalhe(mesAtual);
    setTrimestreDetalhe(null);
  };

  const aplicarMesEspecifico = (m: number) => {
    if (m === 0) {
      aplicarAnoTodo();
      return;
    }
    setFiltroTemporalAtivo('mes');
    setMesDetalhe(m);
    setTrimestreDetalhe(null);
  };

  const aplicarTrimestre = (t: number) => {
    setFiltroTemporalAtivo('trimestre');
    setTrimestreDetalhe(t);
    setMesDetalhe(0);
  };

  const abrirDrilldown = (nif: string, mes: number = 0, categoria: 'todos' | 'rv' | 'rendas' = 'todos') => {
    setNifDetalhe(nif);
    setTrimestreDetalhe(null);
    if (mes > 0) {
      setFiltroTemporalAtivo('mes');
      setMesDetalhe(mes);
    } else {
      setFiltroTemporalAtivo('ano_todo');
      setMesDetalhe(0);
    }
    setCategoriaDetalhe(categoria);
    setVista('documentos');
  };

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0 select-none overflow-y-auto md:overflow-hidden">
      {/* 1. Cabeçalho Executivo evoGex.com */}
      <header className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <span className="page-kicker text-slate-600 dark:text-slate-400 font-mono">
              MOTOR SCR-03 · PORTAL DAS FINANÇAS (SIRE & ARRENDAMENTO)
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <h1 className="text-xl text-foreground font-display font-light tracking-tight flex items-center flex-wrap gap-2 mt-0.5">
            <FileText className="w-5 h-5 text-[#0284c7] dark:text-sky-400 shrink-0" />
            <span>Recibos Verdes e Recibos de Renda</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-700 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
              Exercício {ano}
            </span>
          </h1>
        </div>

        {/* Alternadores de Vista, Assistente, Fluxo e Ano */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-vista: Matriz vs Documentos */}
          <div className="flex items-center bg-white dark:bg-[#0c1520] p-1 rounded-md border border-[#d7e0ea] dark:border-[#222f3e]">
            <button
              type="button"
              onClick={() => setVista('matriz')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-semibold flex items-center space-x-1.5 cursor-pointer transition ${
                vista === 'matriz'
                  ? 'bg-[#0284c7] text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#152334]'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Matriz Anual</span>
            </button>
            <button
              type="button"
              onClick={() => setVista('documentos')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-semibold flex items-center space-x-1.5 cursor-pointer transition ${
                vista === 'documentos'
                  ? 'bg-[#0284c7] text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#152334]'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Documentos ({totaisGlobaisMatriz.totalDocs})</span>
            </button>
          </div>

          {vista === 'documentos' && (
            <>
              {/* Compras vs Vendas (na vista de Documentos) */}
              <div className="flex items-center bg-white dark:bg-[#0c1520] p-1 rounded-md border border-[#d7e0ea] dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setTipoFluxo('compras')}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold flex items-center space-x-1.5 cursor-pointer transition ${
                    tipoFluxo === 'compras'
                      ? 'bg-[#0284c7] text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#152334]'
                  }`}
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>Compras (Adquirente)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTipoFluxo('vendas')}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold flex items-center space-x-1.5 cursor-pointer transition ${
                    tipoFluxo === 'vendas'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#152334]'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Vendas (Prestador)</span>
                </button>
              </div>

              {/* Seletor de Exercício (< Ano >) na vista de Documentos */}
              <div className="flex items-center space-x-1 bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-500 rounded-md px-2 py-1 shadow-2xs">
                <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => onAnoChange(ano - 1)}
                  className="p-0.5 hover:bg-sky-200 dark:hover:bg-[#14304d] rounded text-foreground transition-colors cursor-pointer"
                  title="Exercício Anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono font-bold text-xs text-foreground dark:text-white px-1 min-w-[38px] text-center">
                  {ano}
                </span>
                <button
                  type="button"
                  onClick={() => onAnoChange(ano < anoAtual ? ano + 1 : ano)}
                  disabled={ano >= anoAtual}
                  className={`p-0.5 rounded transition-colors ${
                    ano >= anoAtual
                      ? 'opacity-25 cursor-not-allowed text-slate-400'
                      : 'hover:bg-sky-200 dark:hover:bg-[#14304d] text-foreground cursor-pointer'
                  }`}
                  title="Exercício Seguinte"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}

          {/* Botão Destacado: Assistente Passo a Passo */}
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

          {/* Botão Atualizar */}
          <button
            type="button"
            onClick={() => {
              carregarMatriz();
              if (vista === 'documentos') carregarDocumentos();
            }}
            className="px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] hover:bg-slate-100 dark:hover:bg-[#152334] text-xs font-mono font-semibold text-foreground flex items-center space-x-1.5 cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${(carregandoMatriz || carregandoDetalhe) ? 'animate-spin text-[#0284c7]' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Banner de estado de login */}
      {loginStatusMsg && (
        <div
          className={`px-3 py-2 rounded-md border text-xs font-mono flex items-center justify-between shrink-0 ${
            loginStatusMsg.tipo === 'erro'
              ? 'bg-rose-50 dark:bg-[#240e14] border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : loginStatusMsg.tipo === 'sucesso'
              ? 'bg-emerald-50 dark:bg-[#091e1a] border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-sky-50 dark:bg-[#0a1929] border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-200'
          }`}
        >
          <span>{loginStatusMsg.texto}</span>
          <button type="button" onClick={() => setLoginStatusMsg(null)} className="ml-2 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Cards exibidos apenas na sub-vista Analítica de Documentos */}
      {vista === 'documentos' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 shrink-0">
          {/* Card 1: Recibos Verdes */}
          <div
            onClick={() => abrirDrilldown(nifDetalhe, mesDetalhe, 'rv')}
            className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0284c7] transition before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20"
          >
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
                Recibos Verdes (Fatura-Recibo)
              </span>
              <div className="flex items-baseline space-x-2 mt-0.5">
                <span className="text-lg font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {resumoExibido.total_rv.toLocaleString('pt-PT')}
                </span>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">documentos</span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-[#091e1a] border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
          </div>

          {/* Card 2: Recibos de Renda */}
          <div
            onClick={() => abrirDrilldown(nifDetalhe, mesDetalhe, 'rendas')}
            className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0284c7] transition before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20"
          >
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
                Recibos de Renda (RECIBO-RENDA)
              </span>
              <div className="flex items-baseline space-x-2 mt-0.5">
                <span className="text-lg font-mono font-bold text-[#0284c7] dark:text-sky-400 tabular-nums">
                  {resumoExibido.total_rendas.toLocaleString('pt-PT')}
                </span>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">recibos</span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-[#0a1929] border border-sky-200 dark:border-sky-800 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
              <Home className="w-4 h-4" />
            </div>
          </div>

          {/* Card 3: PDFs Baixados */}
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-amber-500 before:z-20">
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
                PDFs Oficiais Descarregados
              </span>
              <div className="flex items-baseline space-x-2 mt-0.5">
                <span className="text-lg font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                  {resumoExibido.total_pdfs_baixados.toLocaleString('pt-PT')}
                </span>
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">ficheiros PDF</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => abrirNoExplorador(pastaPdfs)}
              title={`Abrir pasta de PDFs no Explorador do Windows: ${pastaPdfs}`}
              className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-[#231a09] border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-[#31240c] cursor-pointer shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>

          {/* Card 4: Volume Financeiro Base & Retenção IRS */}
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-3 shadow-2xs flex items-center justify-between before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-purple-500 before:z-20">
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 block">
                Base Tributável ({ano})
              </span>
              <div className="flex items-baseline space-x-2 mt-0.5">
                <span className="text-lg font-mono font-bold text-foreground tabular-nums">
                  {formatarMoeda(resumoExibido.soma_base)} €
                </span>
                <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                  IRS: {formatarMoeda(resumoExibido.soma_irs)} €
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-[#1a1128] border border-purple-200 dark:border-purple-800 flex items-center justify-center text-purple-700 dark:text-purple-300 shrink-0">
              <FileCheck2 className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* 3. Conteúdo Principal: Vista de Matriz Anual Minimalista OU Vista de Documentos Detalhados */}
      {vista === 'matriz' ? (
        <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0">
          {/* Área Principal: Barra Operacional Minimalista (4 Zonas) + Matriz Anual 12 Meses */}
          <div className="flex-1 flex flex-col gap-2.5 min-w-0 min-h-0">
            <div className="bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              {/* Zona 1: Destino dos Dados */}
              <div
                onClick={() => assistenteAberto && setPassoAssistente(1)}
                className={`flex items-center space-x-2 px-2.5 py-1.5 rounded border text-xs font-mono transition ${
                  assistenteAberto && passoAssistente === 1
                    ? 'ring-2 ring-[#0284c7] dark:ring-sky-400 bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-md'
                    : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
                }`}
              >
                {assistenteAberto && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold shrink-0 ${
                      passoAssistente === 1 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    ① Destino
                  </span>
                )}
                <span className="text-slate-600 dark:text-slate-300 font-semibold shrink-0 hidden sm:inline">Dados:</span>
                <span title={pastaV4 || pastaPdfs || caminhoDestinoLocal} className="text-foreground font-semibold break-all max-w-[240px]">
                  {pastaV4 || pastaPdfs || caminhoDestinoLocal}
                </span>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    copiarEndereco(pastaV4 || pastaPdfs || caminhoDestinoLocal);
                  }}
                  title="Copiar endereço completo (📋)"
                  className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-[#0284c7] cursor-pointer shrink-0"
                >
                  {copiadoCaminho === (pastaV4 || pastaPdfs || caminhoDestinoLocal) ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    abrirNoExplorador(pastaV4 || pastaPdfs || caminhoDestinoLocal);
                  }}
                  title="Abrir pasta no Explorador do Windows (📂)"
                  className="p-0.5 text-[#0284c7] dark:text-sky-400 hover:opacity-80 cursor-pointer shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Zona 2: Operação (Compras/Vendas) & Filtro de Empresa */}
              <div
                onClick={() => assistenteAberto && setPassoAssistente(2)}
                className={`flex flex-wrap items-center gap-2 px-2 py-1 rounded border transition ${
                  assistenteAberto && passoAssistente === 2
                    ? 'ring-2 ring-[#0284c7] dark:ring-sky-400 bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-md'
                    : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
                }`}
              >
                {assistenteAberto && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                      passoAssistente === 2 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    ② Empresas
                  </span>
                )}
                <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] p-0.5 rounded border border-slate-200 dark:border-[#1e344f]">
                  <button
                    type="button"
                    onClick={() => setTipoFluxo('compras')}
                    className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                      tipoFluxo === 'compras'
                        ? 'bg-[#0284c7] text-white shadow-2xs'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1a2c40]'
                    }`}
                    title="Recibos de Compras (Adquirente)"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Compras</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoFluxo('vendas')}
                    className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                      tipoFluxo === 'vendas'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1a2c40]'
                    }`}
                    title="Recibos de Vendas (Prestador / Senhorio)"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Vendas</span>
                  </button>
                </div>

                <EmpresaSelectorCombobox
                  entidades={entidadesCombobox}
                  value={nifMatrizFiltro}
                  onChange={setNifMatrizFiltro}
                  modoPrivacidade={modoPrivacidade}
                  allLabel={`Todas (${entidadesCombobox.length})`}
                  placeholder="Pesquisar NIF, nome ou código..."
                  className="w-full sm:w-auto sm:min-w-[230px] max-w-full sm:max-w-[300px]"
                  dropdownClassName="w-80 md:w-[420px]"
                  align="left"
                  title="Pesquisar e selecionar empresa na Matriz"
                />

                <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200 font-semibold px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] shrink-0 tabular-nums">
                  {selecionadas.size}/{entidadesCombobox.length}
                </span>
              </div>

              {/* Zona 3: Período (Exercício) */}
              <div
                onClick={() => assistenteAberto && setPassoAssistente(3)}
                className={`flex flex-wrap items-center gap-1.5 px-2 py-1 rounded border transition ${
                  assistenteAberto && passoAssistente === 3
                    ? 'ring-2 ring-[#0284c7] dark:ring-sky-400 bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-md'
                    : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
                }`}
              >
                {assistenteAberto && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                      passoAssistente === 3 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    ③ Período
                  </span>
                )}
                <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] border border-[#0284c7] dark:border-sky-600 rounded px-1.5 py-0.5">
                  <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                  <button
                    type="button"
                    onClick={() => onAnoChange(ano - 1)}
                    className="p-0.5 hover:bg-sky-100 dark:hover:bg-[#14304d] rounded text-foreground cursor-pointer"
                    title="Exercício Anterior"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono font-black text-sm text-foreground dark:text-white px-0.5 min-w-[38px] text-center">
                    {ano}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAnoChange(ano < anoAtual ? ano + 1 : ano)}
                    disabled={ano >= anoAtual}
                    className={`p-0.5 rounded ${
                      ano >= anoAtual
                        ? 'opacity-20 cursor-not-allowed text-muted-foreground'
                        : 'hover:bg-sky-100 dark:hover:bg-[#14304d] text-foreground cursor-pointer'
                    }`}
                    title="Exercício Seguinte"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Zona 4: Opções Avançadas + Extrair Selecionadas */}
              <div
                onClick={() => assistenteAberto && setPassoAssistente(4)}
                className={`relative flex items-center space-x-2 px-2 py-1 rounded border transition ${
                  assistenteAberto && passoAssistente === 4
                    ? 'ring-2 ring-amber-500 bg-amber-50 dark:bg-[#1c1608] border-amber-500 shadow-md'
                    : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
                }`}
              >
                {assistenteAberto && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                      passoAssistente === 4 ? 'bg-amber-600 text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    ④ Iniciar
                  </span>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setOpcoesPopoverAberto(v => !v);
                    }}
                    className="px-2 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] text-[11px] font-mono font-semibold text-foreground flex items-center space-x-1 cursor-pointer"
                    title="Opções de extração, tipos de recibo e pastas locais"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                    <span className="hidden sm:inline">Opções</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${opcoesPopoverAberto ? 'rotate-180' : ''}`} />
                  </button>

                  {opcoesPopoverAberto && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-md bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] shadow-xl p-3 space-y-2.5 z-40 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between border-b border-[#d7e0ea] dark:border-[#222f3e] pb-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                          Opções de Extração (SIRE & Rendas)
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpcoesPopoverAberto(false)}
                          className="p-0.5 text-slate-500 hover:text-foreground cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        <label className="flex items-center space-x-2 cursor-pointer text-slate-800 dark:text-slate-200 font-medium">
                          <input
                            type="checkbox"
                            checked={incluirRv}
                            onChange={e => setIncluirRv(e.target.checked)}
                            className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                          />
                          <span>Recibos Verdes (Fatura-Recibo)</span>
                        </label>

                        <label className="flex items-center space-x-2 cursor-pointer text-slate-800 dark:text-slate-200 font-medium">
                          <input
                            type="checkbox"
                            checked={incluirRendas}
                            onChange={e => setIncluirRendas(e.target.checked)}
                            className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                          />
                          <span>Recibos de Renda (RECIBO-RENDA)</span>
                        </label>

                        <label className="flex items-center space-x-2 cursor-pointer px-2 py-1 rounded bg-amber-50 dark:bg-[#231a09] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-300 font-semibold">
                          <input
                            type="checkbox"
                            checked={baixarPdfs}
                            onChange={e => setBaixarPdfs(e.target.checked)}
                            className="rounded border-amber-500 text-amber-600 focus:ring-amber-500 cursor-pointer"
                          />
                          <span>Descarregar PDFs Oficiais</span>
                        </label>

                        <label className="flex items-center space-x-2 cursor-pointer text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={reimportarTudo}
                            onChange={e => setReimportarTudo(e.target.checked)}
                            className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                          />
                          <span>Reimportar Tudo (ignorar cache)</span>
                        </label>

                        <label
                          className="flex items-center space-x-2 cursor-pointer px-2 py-1 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 font-semibold"
                          title="Mantém os ficheiros XML BdsRV sincronizados para o evoGex Apps (Excel)"
                        >
                          <input
                            type="checkbox"
                            checked={gerarXmlLegado}
                            onChange={e => toggleGerarXmlLegado(e.target.checked)}
                            className="rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                          <span>Alimentar Excel Apps (XML BdsRV)</span>
                        </label>
                      </div>

                      {/* Pasta de PDFs Oficiais */}
                      <div className="pt-2 border-t border-[#d7e0ea] dark:border-[#222f3e] space-y-1.5">
                        <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300 block">
                          Pasta de PDFs Oficiais:
                        </span>
                        {editandoPastaPdfs ? (
                          <div className="flex items-center space-x-1">
                            <input
                              type="text"
                              value={pastaPdfsEdit}
                              onChange={e => setPastaPdfsEdit(e.target.value)}
                              className="text-[11px] font-mono bg-slate-100 dark:bg-[#132233] border border-[#0284c7] rounded px-1.5 py-1 text-foreground flex-1 min-w-0"
                            />
                            <button
                              type="button"
                              onClick={guardarPastaPdfs}
                              className="p-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer shrink-0"
                              title="Guardar caminho da pasta de PDFs"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPastaPdfsEdit(pastaPdfs);
                                setEditandoPastaPdfs(false);
                              }}
                              className="p-1.5 rounded bg-slate-200 dark:bg-[#1a2c40] text-foreground cursor-pointer shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-1.5 bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1">
                            <span
                              onClick={() => setEditandoPastaPdfs(true)}
                              title={`Clique para editar · Endereço completo: ${pastaPdfs}`}
                              className="text-[11px] text-slate-800 dark:text-slate-200 break-all cursor-pointer hover:underline flex-1"
                            >
                              {pastaPdfs || 'Não definido'}
                            </span>
                            <button
                              type="button"
                              onClick={() => copiarEndereco(pastaPdfs)}
                              title="Copiar endereço da pasta de PDFs (📋)"
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#1d3148] text-slate-700 dark:text-slate-300 cursor-pointer shrink-0"
                            >
                              {copiadoCaminho === pastaPdfs ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirNoExplorador(pastaPdfs)}
                              title="Abrir pasta de PDFs no Explorador do Windows (📂)"
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#1d3148] text-[#0284c7] dark:text-sky-400 cursor-pointer shrink-0"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {pastaBdsrv && (
                          <div className="flex items-center justify-between gap-1.5 bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1 text-[10.5px]">
                            <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">XML BdsRV:</span>
                            <span className="break-all text-slate-700 dark:text-slate-200 flex-1" title={pastaBdsrv}>{pastaBdsrv}</span>
                            <button
                              type="button"
                              onClick={() => copiarEndereco(pastaBdsrv)}
                              title="Copiar endereço BdsRV (📋)"
                              className="p-0.5 hover:text-[#0284c7] cursor-pointer shrink-0"
                            >
                              {copiadoCaminho === pastaBdsrv ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirNoExplorador(pastaBdsrv)}
                              title="Abrir pasta BdsRV no Explorador do Windows (📂)"
                              className="p-0.5 text-[#0284c7] dark:text-sky-400 cursor-pointer shrink-0"
                            >
                              <FolderOpen className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {extraindoLote ? (
                  <button
                    type="button"
                    onClick={pararTodasExtracoes}
                    className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-mono text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Parar Extração</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={iniciarExtracaoSelecionadas}
                    disabled={selecionadas.size === 0}
                    className="px-3.5 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Extrair Selecionadas ({selecionadas.size})</span>
                  </button>
                )}
              </div>
            </div>

          {/* Grelha Matriz 12 Meses */}
          <div className="flex-1 min-h-[380px] md:min-h-0 bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-[#132233] border-b border-[#d7e0ea] dark:border-[#222f3e] z-20">
                  <tr className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    <th className="py-2 px-2.5 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={linhasMatriz.length > 0 && selecionadas.size === linhasMatriz.length}
                        onChange={toggleSelecionarTodas}
                        className="rounded border-slate-400 cursor-pointer"
                      />
                    </th>
                    <th onClick={() => handleSortMatriz('nif')} className="py-2 px-2 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      NIF {renderSortIconMatriz('nif')}
                    </th>
                    <th onClick={() => handleSortMatriz('nomecli')} className="py-2 px-2 cursor-pointer hover:text-[#0284c7] min-w-[180px]">
                      Entidade {renderSortIconMatriz('nomecli')}
                    </th>
                    {MESES_NOMES.map((mNome, idx) => {
                      const mNum = idx + 1;
                      return (
                        <th
                          key={mNum}
                          onClick={() => handleSortMatriz(`mes_${mNum}`)}
                          className="py-2 px-1.5 text-center cursor-pointer hover:text-[#0284c7] whitespace-nowrap"
                        >
                          {mNome} {renderSortIconMatriz(`mes_${mNum}`)}
                        </th>
                      );
                    })}
                    <th onClick={() => handleSortMatriz('total_rv_ano')} className="py-2 px-2 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      RV {renderSortIconMatriz('total_rv_ano')}
                    </th>
                    <th onClick={() => handleSortMatriz('total_rendas_ano')} className="py-2 px-2 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Rendas {renderSortIconMatriz('total_rendas_ano')}
                    </th>
                    <th onClick={() => handleSortMatriz('total_baixados_ano')} className="py-2 px-2 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      PDFs {renderSortIconMatriz('total_baixados_ano')}
                    </th>
                    <th onClick={() => handleSortMatriz('total_docs_ano')} className="py-2 px-2 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Total {renderSortIconMatriz('total_docs_ano')}
                    </th>
                    <th onClick={() => handleSortMatriz('total_base_ano')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Base (€) {renderSortIconMatriz('total_base_ano')}
                    </th>
                    <th className="py-2 px-2.5 text-center whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d7e0ea] dark:divide-[#1e2c3d] font-mono">
                  {linhasMatriz.map(ent => {
                    const dados = matrizEmpresas[ent.nif];
                    const job = jobsPorNif[ent.nif];
                    const senhaInvalida = Boolean(senhasInvalidas[ent.nif]);
                    const isSelected = selecionadas.has(ent.nif);

                    return (
                      <tr
                        key={ent.nif}
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-[#112438]'
                            : 'hover:bg-slate-50 dark:hover:bg-[#111d2b]'
                        }`}
                      >
                        <td className="py-1.5 px-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelecionarNif(ent.nif)}
                            className="rounded border-slate-400 cursor-pointer"
                          />
                        </td>
                        <td className="py-1.5 px-2 font-bold text-[#0284c7] dark:text-sky-400 whitespace-nowrap">
                          <div className="flex items-center justify-between space-x-1 group/nif">
                            <div className="flex items-center space-x-1">
                              <span>{ofuscarNif(ent.nif)}</span>
                              {senhaInvalida && (
                                <span title="Senha recusada pela AT" className="text-rose-600 dark:text-rose-400">
                                  <KeyRound className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirPortalBrowser(ent.nif, resolverNomeEntidade(ent.nif, ent.nomecli));
                              }}
                              disabled={loginEmCurso === ent.nif}
                              title={`Abrir Portal das Finanças autenticado (${resolverNomeEntidade(ent.nif, ent.nomecli)})`}
                              className={`p-1 rounded transition-all cursor-pointer ${
                                loginEmCurso === ent.nif
                                  ? 'opacity-100 bg-sky-100 dark:bg-[#14304d] text-[#0284c7] dark:text-sky-300'
                                  : 'opacity-40 group-hover/nif:opacity-100 hover:opacity-100 hover:bg-sky-100 dark:hover:bg-[#14304d] text-slate-500 dark:text-slate-400 hover:text-[#0284c7] dark:hover:text-sky-300'
                              }`}
                            >
                              {loginEmCurso === ent.nif ? (
                                <Loader2 className="w-3 h-3 animate-spin text-[#0284c7]" />
                              ) : (
                                <Globe className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-1.5 px-2 max-w-[230px]">
                          <div className="truncate font-sans font-medium text-foreground" title={ofuscarNome(resolverNomeEntidade(ent.nif, ent.nomecli), ent.nif)}>
                            {ofuscarNome(resolverNomeEntidade(ent.nif, ent.nomecli), ent.nif)}
                          </div>
                          {job && (
                            <div className="mt-0.5 flex items-center space-x-1.5 text-[10px]">
                              {job.status === 'em_progresso' && <Loader2 className="w-3 h-3 animate-spin text-[#0284c7]" />}
                              <span
                                className={`truncate ${
                                  job.status === 'erro'
                                    ? 'text-rose-600 dark:text-rose-400 font-bold'
                                    : job.status === 'concluido'
                                    ? 'text-emerald-700 dark:text-emerald-400 font-bold'
                                    : 'text-[#0284c7] dark:text-sky-400'
                                }`}
                              >
                                {job.mensagem}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* 12 Meses */}
                        {MESES_NOMES.map((_, idx) => {
                          const mNum = idx + 1;
                          const mInfo = dados?.meses?.[mNum];
                          const docsMes = mInfo?.docs || 0;
                          const rvMes = mInfo?.rv || 0;
                          const rrMes = mInfo?.rendas || 0;

                          return (
                            <td key={mNum} className="py-1.5 px-1 text-center">
                              {docsMes > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => abrirDrilldown(ent.nif, mNum, 'todos')}
                                  title={`Mês ${mNum}: ${rvMes} Recibo(s) Verde(s) + ${rrMes} Recibo(s) de Renda · Base: ${formatarMoeda(mInfo?.base || 0)} € · Clique para ver documentos`}
                                  className="group/badge inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums cursor-pointer bg-emerald-50 dark:bg-[#09221c] text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-[#0f332a]"
                                >
                                  <span>{docsMes}</span>
                                  <ArrowUpRight className="w-2.5 h-2.5 opacity-60 group-hover/badge:opacity-100 shrink-0" />
                                </button>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                              )}
                            </td>
                          );
                        })}

                        <td
                          onClick={() => dados?.total_rv_ano && abrirDrilldown(ent.nif, 0, 'rv')}
                          className="py-1.5 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums cursor-pointer hover:underline"
                        >
                          {dados?.total_rv_ano || 0}
                        </td>
                        <td
                          onClick={() => dados?.total_rendas_ano && abrirDrilldown(ent.nif, 0, 'rendas')}
                          className="py-1.5 px-2 text-right font-semibold text-[#0284c7] dark:text-sky-400 tabular-nums cursor-pointer hover:underline"
                          title={dados?.total_rendas_historico ? `Histórico total no XML: ${dados.total_rendas_historico} recibos de renda` : undefined}
                        >
                          {dados?.total_rendas_ano || 0}
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                          {dados?.total_baixados_ano || 0}
                        </td>
                        <td
                          onClick={() => dados?.total_docs_ano && abrirDrilldown(ent.nif, 0, 'todos')}
                          className="py-1.5 px-2 text-right font-bold text-foreground tabular-nums cursor-pointer hover:underline"
                        >
                          {dados?.total_docs_ano || 0}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-bold text-foreground tabular-nums whitespace-nowrap">
                          {dados?.total_base_ano ? `${formatarMoeda(dados.total_base_ano)} €` : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              type="button"
                              onClick={() => iniciarExtracaoEntidade(ent)}
                              title="Extrair Recibos Verdes e Rendas desta empresa"
                              className="p-1 rounded bg-[#0284c7] text-white hover:bg-[#0369a1] cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-current" />
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirPortalBrowser(ent.nif, resolverNomeEntidade(ent.nif, ent.nomecli))}
                              disabled={loginEmCurso === ent.nif}
                              title="Abrir Portal das Finanças autenticado no navegador"
                              className="p-1 rounded bg-slate-100 dark:bg-[#16273b] border border-slate-300 dark:border-[#2a405a] text-slate-700 dark:text-slate-200 hover:border-[#0284c7] disabled:opacity-50 cursor-pointer"
                            >
                              {loginEmCurso === ent.nif ? (
                                <Loader2 className="w-3 h-3 animate-spin text-[#0284c7]" />
                              ) : (
                                <Globe className="w-3 h-3" />
                              )}
                            </button>
                            {dados?.caminho_xml && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => abrirNoExplorador(dados.caminho_xml)}
                                  title={`Abrir XML no Explorador do Windows: ${dados.caminho_xml}`}
                                  className="p-1 rounded bg-slate-100 dark:bg-[#16273b] border border-slate-300 dark:border-[#2a405a] text-[#0284c7] dark:text-sky-400 cursor-pointer"
                                >
                                  <FolderOpen className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => limparDadosEntidade(ent.nif)}
                                  title="Limpar ficheiro XML desta entidade"
                                  className="p-1 rounded bg-rose-50 dark:bg-[#240e14] border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </div>

          {/* Assistente Passo a Passo Lateral Sincronizado */}
          <AssistenteImportacaoPanel
            aberto={assistenteAberto}
            onClose={fecharAssistente}
            moduloTitulo="Recibos Verdes e Rendas"
            apiOnline={apiOnlineLocal}
            caminhoDados={pastaV4 || pastaPdfs || caminhoDestinoLocal}
            onCaminhoDadosChange={novo => {
              setCaminhoDestinoLocal(novo);
              setPastaV4(novo);
            }}
            tipoOperacao={tipoFluxo}
            onTipoOperacaoChange={op => {
              if (op === 'compras' || op === 'vendas') setTipoFluxo(op);
            }}
            empresas={entidadesCombobox.map(e => ({
              id: e.nif,
              cod: e.cod,
              nif: e.nif,
              nome: e.nomecli,
            }))}
            selecionadasIds={selecionadas}
            onToggleEmpresa={toggleSelecionarNif}
            onSelecionarTodasEmpresas={() => setSelecionadas(new Set(entidadesCombobox.map(e => e.nif)))}
            onLimparEmpresas={() => setSelecionadas(new Set())}
            modoPrivacidade={modoPrivacidade}
            ano={ano}
            anoAtual={anoAtual}
            onAnoChange={onAnoChange}
            apenasAnoCompleto
            opcoesExtras={(
              <div className="space-y-1.5 text-[11px] font-mono">
                <label className="flex items-center space-x-2 cursor-pointer text-slate-800 dark:text-slate-200 font-medium">
                  <input
                    type="checkbox"
                    checked={incluirRv}
                    onChange={e => setIncluirRv(e.target.checked)}
                    className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                  />
                  <span>Recibos Verdes (Fatura-Recibo)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-slate-800 dark:text-slate-200 font-medium">
                  <input
                    type="checkbox"
                    checked={incluirRendas}
                    onChange={e => setIncluirRendas(e.target.checked)}
                    className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                  />
                  <span>Recibos de Renda (RECIBO-RENDA)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer px-2 py-1 rounded bg-amber-50 dark:bg-[#231a09] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-300 font-semibold">
                  <input
                    type="checkbox"
                    checked={baixarPdfs}
                    onChange={e => setBaixarPdfs(e.target.checked)}
                    className="rounded border-amber-500 text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                  <span>Descarregar PDFs Oficiais</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={reimportarTudo}
                    onChange={e => setReimportarTudo(e.target.checked)}
                    className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7] cursor-pointer"
                  />
                  <span>Reimportar Tudo (ignorar cache)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer px-2 py-1 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 font-semibold">
                  <input
                    type="checkbox"
                    checked={gerarXmlLegado}
                    onChange={e => toggleGerarXmlLegado(e.target.checked)}
                    className="rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Alimentar Excel Apps (XML BdsRV)</span>
                </label>
              </div>
            )}
            isSyncing={extraindoLote}
            labelBotaoIniciar="Iniciar Extração de Recibos"
            onIniciarImportacao={iniciarExtracaoSelecionadas}
            passoAtivo={passoAssistente}
            onPassoAtivoChange={setPassoAssistente}
          />
        </div>
      ) : (
        /* VISTA DE CONSULTA DETALHADA DE DOCUMENTOS (RECIBOS VERDES & RENDAS) */
        <>
          {/* Barra de Filtros e Seletores Temporais de Documentos */}
          <div className="bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2.5 shadow-2xs flex flex-col gap-2 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {/* Filtro de Categoria: Todos vs Recibos Verdes vs Rendas */}
                <div className="flex items-center space-x-1 bg-slate-100 dark:bg-[#132233] p-1 rounded border border-slate-300 dark:border-[#253a52] text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setCategoriaDetalhe('todos')}
                    className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer ${
                      categoriaDetalhe === 'todos' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Todos ({resumoExibido.total_documentos})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoriaDetalhe('rv')}
                    className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer ${
                      categoriaDetalhe === 'rv' ? 'bg-emerald-600 text-white' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Recibos Verdes ({resumoExibido.total_rv})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoriaDetalhe('rendas')}
                    className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer ${
                      categoriaDetalhe === 'rendas' ? 'bg-[#0284c7] text-white' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Recibos de Renda ({resumoExibido.total_rendas})
                  </button>
                </div>

                {/* Seletor de Entidade (Combobox com seleção prévia) */}
                <EmpresaSelectorCombobox
                  entidades={entidadesCombobox}
                  value={nifDetalhe}
                  onChange={setNifDetalhe}
                  modoPrivacidade={modoPrivacidade}
                  allLabel="Todas as Empresas"
                  placeholder="Pesquisar NIF, nome ou código..."
                  className="w-full sm:w-auto sm:min-w-[240px] max-w-full sm:max-w-[320px]"
                  dropdownClassName="w-80 md:w-[400px]"
                  align="left"
                  title="Selecionar Entidade"
                />

                {/* Situação */}
                <select
                  value={situacaoDetalhe}
                  onChange={e => setSituacaoDetalhe(e.target.value)}
                  className="text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-2 py-1.5 text-foreground cursor-pointer"
                >
                  <option value="">Todas as Situações</option>
                  <option value="emitido">Emitido</option>
                  <option value="anulado">Anulado</option>
                </select>

                {/* Incluir Histórico de Rendas */}
                <label className="flex items-center space-x-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!apenasAnoEmissao}
                    onChange={e => setApenasAnoEmissao(!e.target.checked)}
                    className="rounded border-slate-400 cursor-pointer"
                  />
                  <span>Histórico multi-ano de Rendas</span>
                </label>

                {/* Pesquisa livre no detalhe */}
                <div className="relative w-full sm:w-auto sm:min-w-[200px] flex-1 max-w-full sm:max-w-[280px]">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    placeholder="Pesquisar NIF, prestador, nº doc..."
                    value={pesquisaDetalhe}
                    onChange={e => setPesquisaDetalhe(e.target.value)}
                    className="w-full text-xs font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded pl-8 pr-2 py-1 text-foreground"
                  />
                </div>
              </div>
            </div>

            {/* Barra Temporal Padronizada (Ano Todo / Mês Atual / T1..T4 / Jan..Dez / Datas Início-Fim) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200 dark:border-[#1e2c3d] text-[10.5px] font-mono">
              <div className="flex items-center space-x-1 bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-700 rounded px-1.5 py-0.5 mr-1">
                <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                <button
                  type="button"
                  onClick={() => onAnoChange(ano - 1)}
                  className="p-0.5 hover:bg-sky-200 dark:hover:bg-[#14304d] rounded cursor-pointer"
                  title="Exercício Anterior"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <span className="font-bold text-foreground px-0.5">{ano}</span>
                <button
                  type="button"
                  onClick={() => onAnoChange(ano < anoAtual ? ano + 1 : ano)}
                  disabled={ano >= anoAtual}
                  className={`p-0.5 rounded ${ano >= anoAtual ? 'opacity-25 cursor-not-allowed' : 'hover:bg-sky-200 dark:hover:bg-[#14304d] cursor-pointer'}`}
                  title="Exercício Seguinte"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={aplicarAnoTodo}
                className={`px-2 py-1 rounded border font-semibold cursor-pointer transition ${
                  filtroTemporalAtivo === 'ano_todo'
                    ? 'bg-[#0284c7] text-white border-[#0284c7]'
                    : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                }`}
              >
                Ano Todo
              </button>

              {ano === anoAtual && (
                <button
                  type="button"
                  onClick={aplicarMesAtual}
                  className={`px-2 py-1 rounded border font-semibold cursor-pointer transition ${
                    filtroTemporalAtivo === 'mes' && mesDetalhe === mesAtual
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
                    onClick={() => aplicarTrimestre(t)}
                    className={`px-1.5 py-1 rounded border font-bold cursor-pointer transition ${
                      filtroTemporalAtivo === 'trimestre' && trimestreDetalhe === t
                        ? 'bg-[#0284c7] text-white border-[#0284c7]'
                        : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#253a52] hover:border-[#0284c7]'
                    }`}
                    title={`${t}º Trimestre de ${ano}`}
                  >
                    T{t}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-0.5 border-l border-slate-300 dark:border-[#253a52] pl-1.5">
                {MESES_NOMES.map((mNome, idx) => {
                  const mNum = idx + 1;
                  const ativo = filtroTemporalAtivo === 'mes' && mesDetalhe === mNum;
                  return (
                    <button
                      key={mNum}
                      type="button"
                      onClick={() => aplicarMesEspecifico(mNum)}
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
                  value={dataInicioDetalhe}
                  onChange={e => {
                    setDataInicioDetalhe(e.target.value);
                    setFiltroTemporalAtivo('manual');
                    setMesDetalhe(0);
                    setTrimestreDetalhe(null);
                  }}
                  className="text-[11px] font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-1.5 py-0.5 text-foreground cursor-pointer"
                  title="Data Inicial"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="date"
                  value={dataFimDetalhe}
                  onChange={e => {
                    setDataFimDetalhe(e.target.value);
                    setFiltroTemporalAtivo('manual');
                    setMesDetalhe(0);
                    setTrimestreDetalhe(null);
                  }}
                  className="text-[11px] font-mono bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] rounded px-1.5 py-0.5 text-foreground cursor-pointer"
                  title="Data Final"
                />
              </div>
            </div>
          </div>

          {/* Tabela Detalhada de Recibos Verdes e Rendas */}
          <div className="flex-1 min-h-[380px] md:min-h-0 bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] shadow-2xs overflow-hidden flex flex-col">
            <div className="relative evo-card-signature flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] shrink-0 before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">
                  Documentos Registados
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-mono font-bold text-foreground tabular-nums">
                  {documentosFiltrados.length.toLocaleString('pt-PT')} linhas
                </span>
                {nifDetalhe ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-600 text-[11px] font-mono text-[#0284c7] dark:text-sky-300 font-bold">
                    <span>{ofuscarNif(nifDetalhe)}</span>
                    <span>·</span>
                    <span className="font-sans truncate max-w-[260px]">
                      {ofuscarNome(resolverNomeEntidade(nifDetalhe), nifDetalhe)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNifDetalhe('')}
                      title="Limpar filtro de empresa"
                      className="ml-1 hover:opacity-75 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    Todas as Empresas
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                Base: <strong className="text-foreground">{formatarMoeda(resumoExibido.soma_base)} €</strong>
                <span className="mx-1.5">·</span>
                Líquido: <strong className="text-foreground">{formatarMoeda(resumoExibido.soma_liquido)} €</strong>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-[#132233] border-b border-[#d7e0ea] dark:border-[#222f3e] z-20">
                  <tr className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    <th onClick={() => handleSortDetalhe('dta_emissao')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Data {renderSortIconDetalhe('dta_emissao')}
                    </th>
                    <th onClick={() => handleSortDetalhe('tipo_doc')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Tipo Documento {renderSortIconDetalhe('tipo_doc')}
                    </th>
                    <th onClick={() => handleSortDetalhe('n_documento')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Nº Doc / ATCUD {renderSortIconDetalhe('n_documento')}
                    </th>
                    <th onClick={() => handleSortDetalhe('nif_cliente')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7]">
                      Empresa Nossa {renderSortIconDetalhe('nif_cliente')}
                    </th>
                    <th onClick={() => handleSortDetalhe('contraparte_nome')} className="py-2 px-3 cursor-pointer hover:text-[#0284c7]">
                      {tipoFluxo === 'compras' ? 'Contraparte (Prestador / Senhorio)' : 'Contraparte (Adquirente / Inquilino)'} {renderSortIconDetalhe('contraparte_nome')}
                    </th>
                    <th onClick={() => handleSortDetalhe('situacao')} className="py-2 px-2 text-center cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Situação {renderSortIconDetalhe('situacao')}
                    </th>
                    <th onClick={() => handleSortDetalhe('valor_base')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Base (€) {renderSortIconDetalhe('valor_base')}
                    </th>
                    <th onClick={() => handleSortDetalhe('valor_iva')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      IVA (€) {renderSortIconDetalhe('valor_iva')}
                    </th>
                    <th onClick={() => handleSortDetalhe('valor_irs')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Ret. IRS (€) {renderSortIconDetalhe('valor_irs')}
                    </th>
                    <th onClick={() => handleSortDetalhe('importancia_recebida')} className="py-2 px-2.5 text-right cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      Líquido (€) {renderSortIconDetalhe('importancia_recebida')}
                    </th>
                    <th onClick={() => handleSortDetalhe('baixado')} className="py-2 px-3 text-center cursor-pointer hover:text-[#0284c7] whitespace-nowrap">
                      PDF {renderSortIconDetalhe('baixado')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d7e0ea] dark:divide-[#1e2c3d] font-mono">
                  {documentosFiltrados.map((doc, idx) => {
                    const isRenda = doc.tipo_doc === 'RECIBO-RENDA';
                    const isAnulado = (doc.situacao || '').toLowerCase().includes('anulado');
                    const temPdf = doc.baixado === 'sim' && Boolean(doc.caminho_pdf);
                    const nomeClienteResolvido = resolverNomeEntidade(doc.nif_cliente, doc.nome_cliente);
                    const nomeContraparteResolvido = doc.contraparte_nome && doc.contraparte_nome.trim() && doc.contraparte_nome !== doc.contraparte_nif
                      ? resolverNomeEntidade(doc.contraparte_nif, doc.contraparte_nome)
                      : resolverNomeEntidade(doc.contraparte_nif, '—');

                    return (
                      <tr key={`${doc.id_documento}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#111d2b] transition-colors">
                        <td className="py-2 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {doc.dta_emissao || `${doc.ano_efetivo}-${String(doc.mes_efetivo).padStart(2, '0')}`}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              isRenda
                                ? 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-700'
                                : 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                            }`}
                          >
                            {doc.tipo_doc}
                          </span>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap font-bold text-foreground" title={doc.descricao || doc.ativid_exercida}>
                          <div>{doc.n_documento}</div>
                          {doc.atcud && doc.atcud !== '0' && (
                            <div className="text-[10px] font-normal text-slate-500">{doc.atcud}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 max-w-[230px]" title={`${doc.nif_cliente} · ${nomeClienteResolvido}`}>
                          <div className="font-bold text-[#0284c7] dark:text-sky-400 text-[11px]">{ofuscarNif(doc.nif_cliente)}</div>
                          <div className="text-slate-700 dark:text-slate-300 font-sans text-[11px] font-medium truncate">
                            {ofuscarNome(nomeClienteResolvido, doc.nif_cliente)}
                          </div>
                        </td>
                        <td className="py-2 px-3 max-w-[250px]" title={doc.descricao || `${doc.contraparte_nif} · ${nomeContraparteResolvido}`}>
                          <div className="font-bold text-foreground text-[11px]">{ofuscarNif(doc.contraparte_nif || '—')}</div>
                          <div className="text-slate-700 dark:text-slate-200 font-sans text-[11px] truncate">
                            {doc.contraparte_nif ? ofuscarNome(nomeContraparteResolvido, doc.contraparte_nif) : (doc.contraparte_nome || '—')}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              isAnulado
                                ? 'bg-rose-50 dark:bg-[#240e14] text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                : 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                            }`}
                          >
                            {doc.situacao || 'Emitido'}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatarMoeda(doc.valor_base)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {formatarMoeda(doc.valor_iva)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-amber-700 dark:text-amber-400 font-semibold tabular-nums whitespace-nowrap">
                          {formatarMoeda(doc.valor_irs)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold text-foreground tabular-nums whitespace-nowrap">
                          {formatarMoeda(doc.importancia_recebida)}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          {temPdf ? (
                            <div className="flex items-center justify-center space-x-1">
                              <button
                                type="button"
                                onClick={() => abrirNoExplorador(doc.caminho_pdf)}
                                title={`Abrir PDF no Explorador do Windows: ${doc.caminho_pdf}`}
                                className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-[#231a09] border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-[10px] font-bold flex items-center space-x-1 cursor-pointer hover:bg-amber-100"
                              >
                                <FolderOpen className="w-3 h-3" />
                                <span>PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => copiarEndereco(doc.caminho_pdf)}
                                title={`Copiar caminho do PDF: ${doc.caminho_pdf}`}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#1d3148] text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                {copiadoCaminho === doc.caminho_pdf ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400">Não baixado</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
