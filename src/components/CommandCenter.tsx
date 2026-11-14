import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { 
  Play, 
  RotateCcw, 
  Check, 
  AlertCircle, 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Calendar,
  RefreshCw, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Power, 
  ShoppingCart, 
  TrendingUp, 
  Square, 
  AlertTriangle, 
  Zap, 
  Info, 
  SlidersHorizontal, 
  ArrowUpRight,
  ShieldAlert,
  ServerCrash,
  Clock,
  Globe,
  Key,
  Trash2,
  X,
  Sparkles,
  Copy,
  FolderOpen
} from 'lucide-react';
import { getMotorSource, type MotorSourceType } from '../lib/apiBridge';
import {
  isWindowsPath,
  obterResumoDestinosConfigurados,
  abrirPastaNoExploradorNativo,
} from '../lib/localFsBridge';
import { EmpresaSelectorCombobox } from './EmpresaSelectorCombobox';
import { AssistenteImportacaoPanel } from './AssistenteImportacaoPanel';

interface Entidade {
  id: string;
  cod?: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
}

interface InfoMes {
  docs: number;
  linhas: number;
  base: number;
  iva: number;
  total_esperado?: number;
  incompleto?: boolean;
}

interface DadosEmpresaMatriz {
  meses: Record<number, InfoMes>;
  total_docs_ano: number;
  total_linhas_ano: number;
  total_base_ano: number;
  total_iva_ano: number;
  tem_incompletos?: boolean;
  meses_incompletos?: number[];
}

interface JobProgressInfo {
  status: string;
  mensagem: string;
  docs: number;
  total: number;
  pct: number;
  fase?: string;
  mes_ativo?: number;
  ano_ativo?: number;
  sub_atuais?: number;
  sub_total?: number;
  parcial?: boolean;
}

interface PartialSyncInfo {
  nif: string;
  ano: number;
  tipo: string;
  docs: number;
  total: number;
  data: string;
}

export interface PipelineTarefa {
  id: number;
  nif: string;
  nome_entidade?: string;
  modulo?: string;
  tipo_tarefa: 'scrape_anuladas' | 'completar_nomes_vendas' | 'importacao_completa' | string;
  data_inicio?: string;
  data_fim?: string;
  prioridade?: number;
  tentativas?: number;
  estado?: string;
  erro_msg?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PipelineStatus {
  status: string;
  worker_ativo: boolean;
  primeiro_plano_ocupado: boolean;
  contagens: {
    pendentes: number;
    em_curso: number;
    concluidas: number;
    erros: number;
  };
  tarefa_atual?: PipelineTarefa | null;
}

const MESES_NOMES = [
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

interface CommandCenterProps {
  onSelectionChange?: (selected: number, total: number) => void;
  onApiStatusChange?: (online: boolean, versao?: string) => void;
  modoPrivacidade?: boolean;
  onNavegarParaDados?: (nif: string, ano: number, mes?: number, tipo?: 'compras' | 'vendas') => void;
  ano?: number;
  onAnoChange?: (ano: number | ((prev: number) => number)) => void;
}

function mascararTexto(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

interface PerformanceStatus {
  mode: 'auto' | 'manual';
  current_limit: number;
  active_workers: number;
  queue_waiting?: number;
  max_allowed: number;
  cpu_percent: number;
  ram_percent: number;
  cpu_cores: number;
  total_ram_gb: number;
  hardware_tier: string;
  strategy?: string;
}

export default function CommandCenter({ 
  onSelectionChange, 
  onApiStatusChange, 
  modoPrivacidade = false, 
  onNavegarParaDados,
  ano: anoProp,
  onAnoChange
}: CommandCenterProps) {
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nifFiltroEmpresa, setNifFiltroEmpresa] = useState<string>("");

  // Gestão de Concorrência e Telemetria em Tempo Real da Máquina
  const [perfConfig, setPerfConfig] = useState<PerformanceStatus>({
    mode: 'auto',
    current_limit: 4,
    active_workers: 0,
    queue_waiting: 0,
    max_allowed: 6,
    cpu_percent: 0,
    ram_percent: 0,
    cpu_cores: 4,
    total_ram_gb: 8,
    hardware_tier: 'A detetar...',
    strategy: 'SJF (Shortest Job First)'
  });
  // Estimativas de volume de documentos para ordenação inteligente SJF
  const [estimativasVolume, setEstimativasVolume] = useState<Record<string, { volume_estimado: number; origem: string; ano_dados: number }>>({});

  const carregarPerformance = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8015/api/config/performance");
      if (res.ok) {
        const data = await res.json();
        setPerfConfig({
          mode: 'auto',
          current_limit: data.current_limit || 8,
          active_workers: data.active_workers || 0,
          queue_waiting: data.queue_waiting || 0,
          max_allowed: data.max_allowed || 8,
          cpu_percent: data.cpu_percent || 0,
          ram_percent: data.ram_percent || 0,
          cpu_cores: data.cpu_cores || 4,
          total_ram_gb: data.total_ram_gb || 8,
          hardware_tier: data.hardware_tier || 'Cloud Automático',
          strategy: data.strategy || 'SJF (Shortest Job First)'
        });
      }
    } catch {
      // API offline
    }
  }, []);
  
  // Controlo Temporal Fiscal (Ano e Meses)
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1; // 1-12
  const diaAtual = hoje.getDate();

  const [anoInterno, setAnoInterno] = useState<number>(anoProp ?? anoAtual);
  const ano = anoProp ?? anoInterno;
  const setAno = (action: number | ((prev: number) => number)) => {
    if (onAnoChange) {
      onAnoChange(action);
    } else {
      setAnoInterno(action);
    }
  };
  const [meses, setMeses] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (let m = 1; m <= mesAtual; m++) s.add(m);
    return s;
  });
  const [modoManual] = useState<boolean>(false);

  // Datas reais enviadas à API
  const [dataInicio, setDataInicio] = useState<string>(`${anoAtual}-01-01`);
  const [dataFim, setDataFim] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reimportarTudo, setReimportarTudo] = useState<boolean>(false);
  const [gerarXmlLegado, setGerarXmlLegado] = useState<boolean>(() => {
    return localStorage.getItem('gexcel_alimentar_xml_legado') !== 'false';
  });

  useEffect(() => {
    fetch('http://127.0.0.1:8015/api/recibos-verdes/config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && typeof d.alimentar_xml_legado === 'boolean') {
          setGerarXmlLegado(d.alimentar_xml_legado);
          localStorage.setItem('gexcel_alimentar_xml_legado', String(d.alimentar_xml_legado));
        }
        if (isWindowsPath(d?.pasta_v4) && !obterResumoDestinosConfigurados().evogexConfirmado) {
          setCaminhoDadosLocal(d.pasta_v4);
        }
      })
      .catch(() => {});
  }, []);

  const toggleGerarXmlLegado = async (val: boolean) => {
    setGerarXmlLegado(val);
    localStorage.setItem('gexcel_alimentar_xml_legado', String(val));
    try {
      await fetch('http://127.0.0.1:8015/api/app/config/xml-legado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alimentar_xml_legado: val }),
      });
    } catch {}
  };

  // Meses ativos no período atual (para sincronização e destaque visual nas colunas da tabela)
  const mesesAtivos = useMemo<Set<number>>(() => {
    if (!modoManual) return meses;
    const set = new Set<number>();
    try {
      if (dataInicio && dataFim) {
        const d1 = new Date(dataInicio);
        const d2 = new Date(dataFim);
        if (d1.getFullYear() === ano || d2.getFullYear() === ano) {
          const mIni = d1.getFullYear() === ano ? d1.getMonth() + 1 : 1;
          const mFim = d2.getFullYear() === ano ? d2.getMonth() + 1 : 12;
          for (let m = mIni; m <= mFim; m++) {
            set.add(m);
          }
        }
      }
    } catch {}
    return set;
  }, [modoManual, meses, dataInicio, dataFim, ano]);

  // Tipo de Operação Fiscal: Compras (BdsefaturaV4/{NIF}/compras_{NIF}.db) vs Vendas (BdsefaturaV4/{NIF}/vendas_{NIF}.db)
  const [tipoOperacao, setTipoOperacao] = useState<'compras' | 'vendas'>('compras');
  const [assistenteAberto, setAssistenteAberto] = useState<boolean>(() => localStorage.getItem('gexcel_efatura_assistente_fechado') !== 'true');
  const [passoAssistente, setPassoAssistente] = useState<1 | 2 | 3 | 4>(1);
  const [opcoesAvancadasAbertas, setOpcoesAvancadasAbertas] = useState<boolean>(false);
  const [copiadoPasta, setCopiadoPasta] = useState<boolean>(false);
  const [caminhoDadosLocal, setCaminhoDadosLocal] = useState<string>(
    () => obterResumoDestinosConfigurados().pastaV4
  );
  const [motorSource, setMotorSource] = useState<MotorSourceType>(() => getMotorSource());

  const abrirAssistente = () => {
    setAssistenteAberto(true);
    localStorage.setItem('gexcel_efatura_assistente_fechado', 'false');
  };

  const fecharAssistente = () => {
    setAssistenteAberto(false);
    localStorage.setItem('gexcel_efatura_assistente_fechado', 'true');
  };

  useEffect(() => {
    const onFsUpdated = () => {
      setCaminhoDadosLocal(obterResumoDestinosConfigurados().pastaV4);
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  const copiarCaminhoDados = async () => {
    try {
      await navigator.clipboard.writeText(caminhoDadosLocal);
      setCopiadoPasta(true);
      setTimeout(() => setCopiadoPasta(false), 1800);
    } catch {}
  };

  const abrirPastaDadosWindows = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: caminhoDadosLocal }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {}
    await abrirPastaNoExploradorNativo('BdsefaturaV4', 'evogex');
  };
  const [modoPortalWebForcado, setModoPortalWebForcado] = useState<boolean>(false);

  useEffect(() => {
    const onSourceChange = (ev: Event) => {
      const customEv = ev as CustomEvent<MotorSourceType>;
      setMotorSource(customEv.detail || getMotorSource());
    };
    window.addEventListener('gexcel-motor-source', onSourceChange);
    return () => window.removeEventListener('gexcel-motor-source', onSourceChange);
  }, []);

  // Matriz de dados agregados por ano (NIF -> DadosEmpresaMatriz)
  const [matriz, setMatriz] = useState<Record<string, DadosEmpresaMatriz>>({});
  const [senhasInvalidas, setSenhasInvalidas] = useState<Record<string, string>>({});
  const [carregandoMatriz, setCarregandoMatriz] = useState<boolean>(false);
  
  // Ordenação das colunas da tabela
  const [sortCol, setSortCol] = useState<string>('nomecli');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Status de execução com persistência local
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('gexcel_efatura_last_sync_status');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [jobsProgress, setJobsProgress] = useState<Record<string, JobProgressInfo>>({});
  const [partialStatus, setPartialStatus] = useState<Record<string, PartialSyncInfo>>(() => {
    try {
      const saved = localStorage.getItem('gexcel_efatura_partial_status');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({});
  const [batchSyncIds, setBatchSyncIds] = useState<Set<string>>(new Set());
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [versaoMotor, setVersaoMotor] = useState<string>('');
  const [aLigarMotor, setALigarMotor] = useState<boolean>(false);
  const [tentouAutoStart, setTentouAutoStart] = useState<boolean>(false);

  // Worker Clonado de Segundo Plano (pipeline_worker / --worker)
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [acordandoWorker, setAcordandoWorker] = useState<boolean>(false);
  const [dropdownWorkerAberto, setDropdownWorkerAberto] = useState<boolean>(false);
  const prevPendingTasksRef = useRef<number>(0);

  // Web Scraping: Sessão de Login Interativo no Navegador
  const [loginEmCurso, setLoginEmCurso] = useState<string | null>(null);
  const [loginStatusMsg, setLoginStatusMsg] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null);

  // Estado para Limpeza Seletiva de Dados (Empresa a Empresa / Mês / Ano)
  const [limpezaModal, setLimpezaModal] = useState<{
    isOpen: boolean;
    entidade: Entidade | null;
    ano: number;
    mes: number | null;
    escopo: 'mes' | 'ano' | 'tudo';
    tipo: 'compras' | 'vendas' | 'ambos';
    executando: boolean;
    resultado?: { status: string; mensagem: string } | null;
  }>({
    isOpen: false,
    entidade: null,
    ano: 2026,
    mes: 1,
    escopo: 'mes',
    tipo: 'compras',
    executando: false,
    resultado: null
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entidade: Entidade;
    mes?: number;
    docs?: number;
    totalAno?: number;
  } | null>(null);

  useEffect(() => {
    const fecharMenu = () => setContextMenu(null);
    window.addEventListener('click', fecharMenu);
    return () => window.removeEventListener('click', fecharMenu);
  }, []);

  const abrirModalLimpeza = (ent: Entidade, anoAlvo: number, mesAlvo?: number) => {
    setLimpezaModal({
      isOpen: true,
      entidade: ent,
      ano: anoAlvo,
      mes: mesAlvo ?? 1,
      escopo: mesAlvo ? 'mes' : 'ano',
      tipo: tipoOperacao as 'compras' | 'vendas' | 'ambos',
      executando: false,
      resultado: null
    });
  };

  const executarLimpezaModal = async () => {
    if (!limpezaModal.entidade) return;
    const nifReal = (limpezaModal.entidade.nif || limpezaModal.entidade.nif_cc || '').trim();
    if (!nifReal) return;

    setLimpezaModal(prev => ({ ...prev, executando: true, resultado: null }));

    try {
      let url = `http://127.0.0.1:8015/api/base-dados/limpar?nif=${encodeURIComponent(nifReal)}&tipo=${encodeURIComponent(limpezaModal.tipo)}`;
      if (limpezaModal.escopo === 'mes' && limpezaModal.mes) {
        url += `&ano=${limpezaModal.ano}&mes=${limpezaModal.mes}`;
      } else if (limpezaModal.escopo === 'ano') {
        url += `&ano=${limpezaModal.ano}`;
      }

      const res = await fetch(url, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        const pKey = `${nifReal}_${limpezaModal.ano}_${tipoOperacao}`;
        setPartialStatus(prev => {
          const next = { ...prev };
          delete next[pKey];
          return next;
        });
        carregarMatriz(ano, tipoOperacao);

        setLimpezaModal(prev => ({
          ...prev,
          executando: false,
          resultado: {
            status: 'sucesso',
            mensagem: json.mensagem || 'Dados eliminados com sucesso da base de dados local.'
          }
        }));

        setTimeout(() => {
          setLimpezaModal(prev => ({ ...prev, isOpen: false, resultado: null }));
        }, 1200);
      } else {
        const err = await res.json();
        setLimpezaModal(prev => ({
          ...prev,
          executando: false,
          resultado: {
            status: 'erro',
            mensagem: err.detail || 'Falha ao comunicar com o motor de persistência.'
          }
        }));
      }
    } catch (e: any) {
      setLimpezaModal(prev => ({
        ...prev,
        executando: false,
        resultado: {
          status: 'erro',
          mensagem: `Sem ligação à API: ${e?.message || e}`
        }
      }));
    }
  };

  // Alertas e Notificações de Erro da AT com interface evoGex.com
  interface AlertaErroUI {
    id: string;
    nome: string;
    nif: string;
    mensagem: string;
    hora: string;
    tipo_erro?: string;
    badge_label?: string;
    detalhe?: string;
    entId?: string;
  }
  const [alertasErro, setAlertasErro] = useState<AlertaErroUI[]>([]);
  const [entidadeErros, setEntidadeErros] = useState<Record<string, { tipo_erro: string; badge_label: string; mensagem: string; detalhe: string }>>({});

  const mostrarAlertaErro = useCallback((
    nome: string, 
    nif: string, 
    mensagem: string,
    tipo_erro: string = 'outro',
    badge_label: string = 'Erro AT',
    detalhe: string = '',
    entId?: string
  ) => {
    const novo: AlertaErroUI = {
      id: Math.random().toString(36).substring(2, 9),
      nome,
      nif,
      mensagem,
      hora: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tipo_erro,
      badge_label,
      detalhe,
      entId
    };
    setAlertasErro(prev => [novo, ...prev.filter(a => a.nif !== nif).slice(0, 4)]);
  }, []);

  const fecharAlertaErro = (id: string) => {
    setAlertasErro(prev => prev.filter(a => a.id !== id));
  };

  // Polling de telemetria da máquina e workers (1.5s durante sincronização, 4s em repouso)
  useEffect(() => {
    if (apiOnline) {
      carregarPerformance();
      const interval = setInterval(carregarPerformance, isSyncing ? 1500 : 4000);
      return () => clearInterval(interval);
    }
  }, [apiOnline, isSyncing, carregarPerformance]);

  // Persistir último estado de sincronização das entidades
  useEffect(() => {
    try {
      localStorage.setItem('gexcel_efatura_last_sync_status', JSON.stringify(syncStatus));
    } catch (e) {
      console.error("Erro ao guardar histórico de estados:", e);
    }
  }, [syncStatus]);

  // Persistir registos de sincronização parcial / interrompida
  useEffect(() => {
    try {
      localStorage.setItem('gexcel_efatura_partial_status', JSON.stringify(partialStatus));
    } catch (e) {
      console.error("Erro ao guardar status parciais:", e);
    }
  }, [partialStatus]);

  // Refs para polling e interrupção imediata
  const activeJobsRef = useRef(activeJobs);
  const abortSyncRef = useRef(false);
  useEffect(() => {
    activeJobsRef.current = activeJobs;
  }, [activeJobs]);

  // Notificar pai sobre seleção
  useEffect(() => {
    onSelectionChange?.(selectedIds.size, entidades.length);
  }, [selectedIds, entidades, onSelectionChange]);

  // Notificar pai sobre status da API e versão do motor
  useEffect(() => {
    if (apiOnline !== null) {
      onApiStatusChange?.(apiOnline, versaoMotor);
    }
  }, [apiOnline, versaoMotor, onApiStatusChange]);

  // Carregar dados agregados da matriz anual da API (Compras ou Vendas)
  const carregarMatriz = async (anoAlvo: number, tipoAlvo: 'compras' | 'vendas' = tipoOperacao) => {
    setCarregandoMatriz(true);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/estatisticas/matriz-anual/${anoAlvo}?tipo=${tipoAlvo}`);
      if (res.ok) {
        const data = await res.json();
        setMatriz(data.empresas || {});
        setSenhasInvalidas(data.senhas_invalidas || {});
      }

      // Carregar estimativas inteligentes de volume (SJF - Menor Volume Primeiro)
      try {
        const vRes = await fetch(`http://127.0.0.1:8015/api/estatisticas/volume-estimado?ano=${anoAlvo}&tipo=${tipoAlvo}`);
        if (vRes.ok) {
          const vData = await vRes.json();
          setEstimativasVolume(vData.volumes || {});
        }
      } catch (ve) {
        console.error("Erro a carregar estimativas de volume:", ve);
      }
    } catch (e) {
      console.error("Erro a carregar matriz anual:", e);
    } finally {
      setCarregandoMatriz(false);
    }
  };

  // Limpeza manual de bloqueio de senha de um NIF específico
  const handleResetSenhaInvalida = async (nif: string, entId?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/senhas-invalidas/reset/${nif}`, {
        method: 'POST'
      });
      if (res.ok) {
        setSenhasInvalidas(prev => {
          const next = { ...prev };
          delete next[nif];
          return next;
        });
        if (entId) {
          setSyncStatus(prev => {
            const next = { ...prev };
            delete next[entId];
            return next;
          });
          setEntidadeErros(prev => {
            const next = { ...prev };
            delete next[entId];
            return next;
          });
        }
        setAlertasErro(prev => prev.filter(a => a.nif !== nif));
        carregarMatriz(ano, tipoOperacao);
      } else {
        const err = await res.json();
        alert(`Erro ao limpar bloqueio: ${err.detail || 'Falha na API'}`);
      }
    } catch (err: any) {
      console.error("Erro ao resetar senha inválida:", err);
      alert(`Erro de comunicação com a API: ${err.message}`);
    }
  };

  // Iniciar sessão de browser visível no e-Fatura via Web Scraping
  const abrirBrowserSessao = async (nifAlvo: string, nomeEmpresa?: string) => {
    if (loginEmCurso) return;
    setLoginEmCurso(nifAlvo);
    setLoginStatusMsg({ tipo: 'info', texto: `A iniciar navegador para ${nomeEmpresa || nifAlvo}...` });

    try {
      const res = await fetch("http://127.0.0.1:8015/api/efatura/login-browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nif: nifAlvo, canal: "auto", destino: "efatura" })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Falha na comunicação com a API." }));
        setLoginStatusMsg({ tipo: 'erro', texto: err.detail || "Erro ao abrir navegador com login automático." });
        carregarMatriz(ano, tipoOperacao);
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
          texto: `Portal e-Fatura aberto num novo separador para ${data.utilizador || nifAlvo} (utilizador copiado para colar).`,
        });
        setTimeout(() => setLoginStatusMsg(null), 6000);
        return;
      }

      setLoginStatusMsg({ tipo: 'sucesso', texto: `Sessão e-Fatura iniciada no navegador para NIF ${nifAlvo}!` });
      setTimeout(() => setLoginStatusMsg(null), 5000);
      // Atualizar matriz após a tentativa de autenticação no browser para refletir eventual senha rejeitada ou desbloqueada na base central
      setTimeout(() => carregarMatriz(ano, tipoOperacao), 6500);
      setTimeout(() => carregarMatriz(ano, tipoOperacao), 12000);
    } catch (e: any) {
      setLoginStatusMsg({ tipo: 'erro', texto: `Erro ao contactar API: ${e.message}` });
      setTimeout(() => setLoginStatusMsg(null), 5000);
    } finally {
      setTimeout(() => {
        setLoginEmCurso(null);
      }, 2500);
    }
  };

  // Carregar entidades a partir da API (lidas via tCredenciais.xml / legado_bridge)
  useEffect(() => {
    let cancel = false;
    async function loadEntidades() {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/entidades");
        if (res.ok) {
          const data = await res.json();
          if (!cancel && data.entidades) {
            setEntidades(data.entidades as Entidade[]);
          }
        }
      } catch (e) {
        console.error("Erro a carregar entidades:", e);
      }
    }
    loadEntidades();
    return () => { cancel = true; };
  }, [apiOnline]);

  // Recarregar a matriz sempre que o ano ou o tipo de operação muda
  useEffect(() => {
    carregarMatriz(ano, tipoOperacao);
  }, [ano, tipoOperacao]);

  // Healthcheck contínuo da API com validação de assinatura oficial e captura de versão
  useEffect(() => {
    let falhasConsecutivas = 0;
    const checkApi = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8015/", { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          if (data.assinatura && data.assinatura.includes("API Importador e-Fatura Gexcel")) {
            falhasConsecutivas = 0;
            setApiOnline(true);
            if (data.versao) setVersaoMotor(data.versao);
            if (typeof data.modo_teste_scraper === 'boolean') {
              setModoPortalWebForcado(data.modo_teste_scraper);
            }
            return;
          }
        }
        falhasConsecutivas += 1;
        if (falhasConsecutivas >= 2) {
          setApiOnline(false);
        }
      } catch {
        falhasConsecutivas += 1;
        if (falhasConsecutivas >= 2) {
          setApiOnline(false);
        }
      }
    };
    checkApi();
    const timer = setInterval(checkApi, 5000);
    return () => clearInterval(timer);
  }, []);

  // Polling contínuo do Worker de Segundo Plano (--worker / pipeline_worker)
  useEffect(() => {
    if (!apiOnline) {
      setPipelineStatus(null);
      return;
    }

    const verificarPipeline = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/pipeline/status", { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data: PipelineStatus = await res.json();
          setPipelineStatus(data);

          const totalAtivas = (data.contagens?.pendentes || 0) + (data.contagens?.em_curso || 0);
          // Se o worker terminou todas as tarefas pós-extração (transitou para 0), atualiza a matriz automaticamente
          if (prevPendingTasksRef.current > 0 && totalAtivas === 0) {
            carregarMatriz(ano, tipoOperacao);
          }
          prevPendingTasksRef.current = totalAtivas;
        }
      } catch {
        // Falha silenciosa no polling secundário
      }
    };

    verificarPipeline();
    const interval = setInterval(verificarPipeline, 3500);
    return () => clearInterval(interval);
  }, [apiOnline, ano, tipoOperacao]);

  // Ação manual para acordar ou reiniciar o Worker de Segundo Plano
  const handleAcordarWorker = async () => {
    if (acordandoWorker) return;
    setAcordandoWorker(true);
    try {
      await fetch("http://127.0.0.1:8015/api/pipeline/acordar", { method: "POST" });
      const res = await fetch("http://127.0.0.1:8015/api/pipeline/status");
      if (res.ok) {
        const data = await res.json();
        setPipelineStatus(data);
      }
    } catch (err) {
      console.error("Erro ao acordar worker de segundo plano:", err);
    } finally {
      setTimeout(() => setAcordandoWorker(false), 1200);
    }
  };

  // Ligar o Motor Python (:8015)
  const ligarMotorAutomatico = async () => {
    if (aLigarMotor) return;
    setALigarMotor(true);
    try {
      // 1. Tentar invocação nativa Desktop Tauri se disponível
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('ligar_motor');
        } catch (te) {
          console.warn("Invocação via Tauri Core falhou, tentando fallback Vite/API:", te);
        }
      }
      
      // 2. Chamar endpoint do plugin local do servidor Vite
      try {
        await fetch('/api/motor/ligar', { method: 'POST' });
      } catch (fe) {
        console.warn("Falha na chamada a /api/motor/ligar:", fe);
      }

      // 3. Polling ativo até 12 segundos com verificação da assinatura oficial Gexcel
      let motorOnline = false;
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 400));
        try {
          const res = await fetch("http://127.0.0.1:8015/", { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const data = await res.json();
            if (data.assinatura && data.assinatura.includes("API Importador e-Fatura Gexcel")) {
              motorOnline = true;
              setApiOnline(true);
              if (data.versao) setVersaoMotor(data.versao);
              await carregarMatriz(ano, tipoOperacao);
              break;
            }
          }
        } catch {}
      }

      if (!motorOnline) {
        setApiOnline(false);
      }
    } catch (e) {
      console.error("Erro ao enviar pedido para ligar motor:", e);
      setApiOnline(false);
    } finally {
      setALigarMotor(false);
    }
  };

  // Se o motor estiver desligado no arranque da aplicação, tenta ligá-lo automaticamente
  useEffect(() => {
    if (apiOnline === false && !tentouAutoStart && !aLigarMotor) {
      setTentouAutoStart(true);
      ligarMotorAutomatico();
    }
  }, [apiOnline, tentouAutoStart, aLigarMotor]);

  // Recálculo automático das datas ao alterar Ano ou Meses no modo mensal
  useEffect(() => {
    if (modoManual) return;
    if (meses.size === 0) return;

    const arr = Array.from(meses).sort((a, b) => a - b);
    const minM = arr[0];
    const maxM = arr[arr.length - 1];

    const dInicio = `${ano}-${String(minM).padStart(2, '0')}-01`;
    
    let dFim = "";
    if (ano === anoAtual && maxM === mesAtual) {
      dFim = `${ano}-${String(maxM).padStart(2, '0')}-${String(diaAtual).padStart(2, '0')}`;
    } else {
      const ultimoDia = new Date(ano, maxM, 0).getDate();
      dFim = `${ano}-${String(maxM).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    }

    setDataInicio(dInicio);
    setDataFim(dFim);
  }, [ano, meses, modoManual, anoAtual, mesAtual, diaAtual]);

  const toggleMes = (m: number) => {
    if (ano === anoAtual && m > mesAtual) return;
    const next = new Set(meses);
    if (next.has(m)) {
      next.delete(m);
    } else {
      next.add(m);
    }
    setMeses(next);
  };

  const selecionarAnoCompleto = () => {
    const s = new Set<number>();
    const limite = ano === anoAtual ? mesAtual : 12;
    for (let m = 1; m <= limite; m++) s.add(m);
    setMeses(s);
  };

  const selecionarMesAtual = () => {
    setAno(anoAtual);
    setMeses(new Set([mesAtual]));
  };

  const desmarcarTodosMeses = () => {
    setMeses(new Set());
  };

  const selecionarTrimestre = (t: number) => {
    const mapa: Record<number, number[]> = {
      1: [1, 2, 3],
      2: [4, 5, 6],
      3: [7, 8, 9],
      4: [10, 11, 12],
    };
    const lista = mapa[t] || [];
    const validos = lista.filter(m => !(ano === anoAtual && m > mesAtual));
    if (validos.length > 0) {
      setMeses(new Set(validos));
    }
  };

  // Funções de Interrupção Controlada (Stop / Cancel)
  const handleStopJob = async (jobId: string, entId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      // Limpeza imediata no estado visual desta linha (sai logo do estado ativo)
      setActiveJobs(prev => {
        const next = { ...prev };
        delete next[entId];
        return next;
      });
      setJobsProgress(prev => {
        const next = { ...prev };
        delete next[entId];
        return next;
      });
      setSyncStatus(prev => {
        const next = { ...prev };
        delete next[entId];
        return next;
      });
      await fetch(`http://127.0.0.1:8015/api/extracao/parar/${jobId}`, { method: 'POST' });
      carregarMatriz(ano, tipoOperacao);
    } catch (err) {
      console.error("Erro ao parar job:", err);
    }
  };

  const handleStopAll = async () => {
    // 1. Sinalizar aborto imediato para interromper qualquer envio em loop
    abortSyncRef.current = true;

    // 2. Limpar instantaneamente todo o estado visual de execução (volta imediatamente ao estado inicial)
    setIsSyncing(false);
    setActiveJobs({});
    activeJobsRef.current = {};
    setJobsProgress({});
    setSyncStatus({});
    setBatchSyncIds(new Set());

    // 3. Notificar o backend para abortar workers e esvaziar a fila SJF
    try {
      await fetch("http://127.0.0.1:8015/api/extracao/parar-tudo", { method: 'POST' });
    } catch (err) {
      console.error("Erro ao parar todas as tarefas:", err);
    }

    // 4. Refrescar Matriz para refletir os registos já guardados na BD
    carregarMatriz(ano, tipoOperacao);
  };

  // Polling Effect para monitorizar o progresso dos Jobs na API Python
  useEffect(() => {
    const interval = setInterval(async () => {
      if (abortSyncRef.current) {
        setIsSyncing(false);
        setBatchSyncIds(new Set());
        return;
      }
      const jobs = Object.entries(activeJobsRef.current);
      if (jobs.length === 0) {
        setIsSyncing(false);
        setBatchSyncIds(new Set());
        return;
      }
      
      setIsSyncing(true);

      for (const [entId, jobId] of jobs) {
        try {
          const res = await fetch(`http://127.0.0.1:8015/api/extracao/status/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            const ent = entidades.find(e => e.id === entId);
            const nifReal = ent ? (ent.nif || ent.nif_cc || '').trim() : '';
            
            setSyncStatus(prev => ({ 
              ...prev, 
              [entId]: data.mensagem || data.status 
            }));

            // Atualiza progresso quantitativo em tempo real
            setJobsProgress(prev => ({
              ...prev,
              [entId]: {
                status: data.status,
                mensagem: data.mensagem || '',
                docs: data.docs_atuais || 0,
                total: data.total_esperado || 0,
                pct: data.percentagem || 0,
                fase: data.fase,
                mes_ativo: data.mes_ativo,
                ano_ativo: data.ano_ativo,
                sub_atuais: data.sub_atuais,
                sub_total: data.sub_total,
                parcial: Boolean(data.parcial)
              }
            }));
            
            if (data.status === 'interrompido' || data.status === 'cancelado' || data.parcial) {
              if (nifReal && data.docs_atuais > 0) {
                const pKey = `${nifReal}_${ano}_${tipoOperacao}`;
                setPartialStatus(prev => ({
                  ...prev,
                  [pKey]: {
                    nif: nifReal,
                    ano,
                    tipo: tipoOperacao,
                    docs: data.docs_atuais || 0,
                    total: data.total_esperado || 0,
                    data: new Date().toLocaleTimeString('pt-PT')
                  }
                }));
              }
              setActiveJobs(prev => {
                const next = { ...prev };
                delete next[entId];
                return next;
              });
              // Refrescar Matriz para refletir os docs parciais guardados na BD
              carregarMatriz(ano, tipoOperacao);
            } else if (data.status === 'concluido') {
              if (nifReal) {
                // Sincronização 100% terminada: limpa flag parcial deste NIF
                const pKey = `${nifReal}_${ano}_${tipoOperacao}`;
                setPartialStatus(prev => {
                  const next = { ...prev };
                  delete next[pKey];
                  return next;
                });
              }
              setActiveJobs(prev => {
                const next = { ...prev };
                delete next[entId];
                return next;
              });
              // Refrescar Matriz agregada após conclusão
              carregarMatriz(ano, tipoOperacao);
            } else if (data.status === 'erro') {
              const errMsg = data.mensagem || data.erro || 'Falha na comunicação com a AT';
              const tipoErro = data.tipo_erro || 'outro';
              const badgeLabel = data.badge_label || 'Erro AT';
              const detalheErro = data.erro || errMsg;

              setEntidadeErros(prev => ({
                ...prev,
                [entId]: {
                  tipo_erro: tipoErro,
                  badge_label: badgeLabel,
                  mensagem: errMsg,
                  detalhe: detalheErro,
                }
              }));

              setSyncStatus(prev => ({
                ...prev,
                [entId]: `Erro: ${badgeLabel}`
              }));
              setActiveJobs(prev => {
                const next = { ...prev };
                delete next[entId];
                return next;
              });
              const entObj = entidades.find(e => e.id === entId);
              mostrarAlertaErro(
                entObj?.nomecli || entId,
                nifReal,
                errMsg,
                tipoErro,
                badgeLabel,
                detalheErro,
                entId
              );
              carregarMatriz(ano, tipoOperacao);
            }
          } else if (res.status === 404) {
            // Se o job não existe no servidor (ex: motor reiniciado), remove da lista ativa
            setActiveJobs(prev => {
              const next = { ...prev };
              delete next[entId];
              return next;
            });
          }
        } catch (err) {
           console.error("Erro no polling do job", jobId, err);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [ano, tipoOperacao, entidades]);

  // Classificador de Estado Oficial por Entidade
  const getEntityStatusInfo = (ent: Entidade) => {
    const nifReal = (ent.nif || ent.nif_cc || '').trim();
    const isActive = Boolean(activeJobs[ent.id]);
    const dadosEmpresa = matriz[nifReal];
    const totalAno = dadosEmpresa ? dadosEmpresa.total_docs_ano : 0;
    const erroSenha = senhasInvalidas[nifReal];
    const lastSync = syncStatus[ent.id];
    const pKey = `${nifReal}_${ano}_${tipoOperacao}`;
    const partialInfo = partialStatus[pKey];
    const prog = jobsProgress[ent.id];

    if (isActive) {
      return {
        type: 'active' as const,
        label: prog?.mensagem || lastSync || 'A processar...',
        detail: '',
        progress: prog || { status: 'a_executar', mensagem: '', docs: 0, total: 0, pct: 0 },
        jobId: activeJobs[ent.id],
        priority: 0,
      };
    }

    // 1. Senha Inválida / Rejeitada pela AT (prioridade máxima sobre estados parciais)
    if (erroSenha) {
      const nomesMesesInc = dadosEmpresa?.meses_incompletos && dadosEmpresa.meses_incompletos.length > 0
        ? ` (${dadosEmpresa.meses_incompletos.map(mn => MESES_NOMES[mn - 1]?.nome).join(', ')})`
        : '';
      return {
        type: 'invalid_pass' as const,
        label: `Senha Rejeitada AT${nomesMesesInc}`,
        detail: erroSenha,
        priority: 1,
      };
    }

    // 2. Erros específicos classificados na sessão recente
    const erroRecente = entidadeErros[ent.id];
    if (erroRecente) {
      if (erroRecente.tipo_erro === 'servidor_at') {
        return {
          type: 'server_error' as const,
          label: erroRecente.badge_label || 'Servidor AT (500)',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 2,
        };
      }
      if (erroRecente.tipo_erro === 'timeout_rede') {
        return {
          type: 'timeout' as const,
          label: erroRecente.badge_label || 'Timeout AT',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 2,
        };
      }
      if (erroRecente.tipo_erro === 'rate_limit') {
        return {
          type: 'rate_limit' as const,
          label: erroRecente.badge_label || 'Rate Limit AT',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 2,
        };
      }
      if (erroRecente.tipo_erro === 'permissao_subuser') {
        return {
          type: 'permission' as const,
          label: erroRecente.badge_label || 'Sem Permissão AT',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 2,
        };
      }
      if (erroRecente.tipo_erro === 'timeout_2fa') {
        return {
          type: 'timeout_2fa' as const,
          label: erroRecente.badge_label || '2FA Expirado',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 2,
        };
      }
      if (erroRecente.tipo_erro === 'conta_suspensa') {
        return {
          type: 'suspended' as const,
          label: erroRecente.badge_label || 'Conta Suspensa AT',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 1,
        };
      }
      if (erroRecente.tipo_erro === 'senha_invalida') {
        return {
          type: 'invalid_pass' as const,
          label: erroRecente.badge_label || 'Senha Rejeitada AT',
          detail: erroRecente.detalhe || erroRecente.mensagem,
          priority: 1,
        };
      }
      return {
        type: 'error' as const,
        label: erroRecente.badge_label || 'Erro AT',
        detail: erroRecente.detalhe || erroRecente.mensagem,
        priority: 2,
      };
    }

    // 3. Erros ou bloqueios da sessão atual
    if (lastSync) {
      const lsLower = lastSync.toLowerCase();
      if (lsLower.includes('erro') || lsLower.includes('bloqueado') || lsLower.includes('sem ligação') || lsLower.includes('falha') || lsLower.includes('inválid')) {
        return {
          type: 'error' as const,
          label: lastSync.replace(/^Erro:\s*/i, ''),
          detail: lastSync,
          priority: 2,
        };
      }
    }

    // 3. Meses incompletos detetados na matriz da BD
    if (dadosEmpresa?.tem_incompletos && dadosEmpresa.meses_incompletos && dadosEmpresa.meses_incompletos.length > 0) {
      const nomesMesesInc = dadosEmpresa.meses_incompletos.map(mn => MESES_NOMES[mn - 1]?.nome).join(', ');
      return {
        type: 'partial' as const,
        label: `Incompleto (${nomesMesesInc})`,
        detail: `Processo incompleto no(s) mês(es): ${nomesMesesInc}. A base de dados não contém a totalidade dos registos da AT.`,
        priority: 3,
      };
    }

    if (partialInfo) {
      return {
        type: 'partial' as const,
        label: `Parcial: ${partialInfo.docs.toLocaleString('pt-PT')} / ${partialInfo.total.toLocaleString('pt-PT')}`,
        detail: `${partialInfo.docs.toLocaleString('pt-PT')} faturas na BD de um total esperado de ${partialInfo.total.toLocaleString('pt-PT')}. Sincronização incompleta.`,
        docs: partialInfo.docs,
        total: partialInfo.total,
        priority: 3,
      };
    }

    if (lastSync) {
      const lsLower = lastSync.toLowerCase();
      if (lsLower.includes('interrompido') || lsLower.includes('parcial')) {
        return {
          type: 'partial' as const,
          label: lastSync,
          detail: 'Processo interrompido pelo utilizador. A base de dados não contém todos os registos.',
          priority: 4,
        };
      }
      if (lsLower.includes('conclu') || lsLower.includes('sucesso')) {
        return {
          type: 'success' as const,
          label: lastSync,
          detail: lastSync,
          priority: 5,
        };
      }
      return {
        type: 'info' as const,
        label: lastSync,
        detail: lastSync,
        priority: 6,
      };
    }

    if (totalAno > 0) {
      return {
        type: 'imported' as const,
        label: 'Sincronizado',
        detail: `Exercício de ${ano} sincronizado (${totalAno.toLocaleString('pt-PT')} faturas)`,
        priority: 7,
      };
    }

    return {
      type: 'pending' as const,
      label: 'Pendente',
      detail: 'Nenhuma fatura importada para este ano.',
      priority: 8,
    };
  };

  const handleSort = (colKey: string) => {
    if (sortCol === colKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colKey);
      if (colKey.startsWith('mes_') || colKey === 'total') {
        setSortDir('desc');
      } else {
        setSortDir('asc');
      }
    }
  };

  const renderSortIcon = (colKey: string) => {
    if (sortCol !== colKey) {
      return <ArrowUpDown className="w-2.5 h-2.5 opacity-25 group-hover:opacity-70 shrink-0" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-2.5 h-2.5 text-primary shrink-0 stroke-[2.5]" />
    ) : (
      <ArrowDown className="w-2.5 h-2.5 text-primary shrink-0 stroke-[2.5]" />
    );
  };

  // Filtragem e Ordenação Inteligente com Salto de Jobs Ativos para o Topo
  const entidadesFiltradasEOrdenadas = useMemo(() => {
    const filtradas = entidades.filter(e => {
      if (!nifFiltroEmpresa) return true;
      const nif = (e.nif || e.nif_cc || '').trim();
      return nif === nifFiltroEmpresa;
    });

    return [...filtradas].sort((a, b) => {
      // 1. REGRA: Apenas no caso de importação em lote (> 1 entidade), as entidades do lote vão para o topo
      if (batchSyncIds.size > 1) {
        const aInBatch = batchSyncIds.has(a.id);
        const bInBatch = batchSyncIds.has(b.id);
        if (aInBatch && !bInBatch) return -1;
        if (!aInBatch && bInBatch) return 1;
        if (aInBatch && bInBatch) {
          // Dentro do lote ativo, priorizar as que estão a executar no momento
          const aActive = Boolean(activeJobs[a.id]);
          const bActive = Boolean(activeJobs[b.id]);
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
        }
      }

      // 2. Ordenação da coluna selecionada
      let comp = 0;
      const aNif = (a.nif || a.nif_cc || '').trim();
      const bNif = (b.nif || b.nif_cc || '').trim();

      if (sortCol === 'nif') {
        comp = aNif.localeCompare(bNif);
      } else if (sortCol === 'nomecli') {
        comp = (a.nomecli || '').localeCompare(b.nomecli || '');
      } else if (sortCol.startsWith('mes_')) {
        const mesNum = parseInt(sortCol.replace('mes_', ''), 10);
        const aDocs = matriz[aNif]?.meses?.[mesNum]?.docs || 0;
        const bDocs = matriz[bNif]?.meses?.[mesNum]?.docs || 0;
        comp = aDocs - bDocs;
      } else if (sortCol === 'total') {
        const aTot = matriz[aNif]?.total_docs_ano || (estimativasVolume[aNif]?.volume_estimado || 0);
        const bTot = matriz[bNif]?.total_docs_ano || (estimativasVolume[bNif]?.volume_estimado || 0);
        comp = aTot - bTot;
      } else if (sortCol === 'status') {
        const aStat = getEntityStatusInfo(a);
        const bStat = getEntityStatusInfo(b);
        if (aStat.priority !== bStat.priority) {
          comp = aStat.priority - bStat.priority;
        } else {
          comp = (a.nomecli || '').localeCompare(b.nomecli || '');
        }
      }

      return sortDir === 'asc' ? comp : -comp;
    });
  }, [entidades, nifFiltroEmpresa, matriz, estimativasVolume, senhasInvalidas, activeJobs, syncStatus, entidadeErros, sortCol, sortDir, batchSyncIds]);

  // Totais agregados calculados para a barra de rodapé e contadores mensais
  const { totalGeralDocs, totaisPorMes } = useMemo(() => {
    let geral = 0;
    const porMes: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) porMes[m] = 0;

    entidadesFiltradasEOrdenadas.forEach(ent => {
      const nifReal = (ent.nif || ent.nif_cc || '').trim();
      const dados = matriz[nifReal];
      if (dados) {
        geral += dados.total_docs_ano || 0;
        if (dados.meses) {
          for (let m = 1; m <= 12; m++) {
            if (dados.meses[m]?.docs) {
              porMes[m] += dados.meses[m].docs;
            }
          }
        }
      }
    });

    return { totalGeralDocs: geral, totaisPorMes: porMes };
  }, [entidadesFiltradasEOrdenadas, matriz]);

  // Total acumulado estritamente para o período fiscal ativo (meses selecionados)
  const totalDocsPeriodo = useMemo(() => {
    let tot = 0;
    for (const m of mesesAtivos) {
      tot += totaisPorMes[m] || 0;
    }
    return tot;
  }, [mesesAtivos, totaisPorMes]);

  const toggleSelectAll = () => {
    if (selectedIds.size === entidadesFiltradasEOrdenadas.length && entidadesFiltradasEOrdenadas.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entidadesFiltradasEOrdenadas.map(e => e.id)));
    }
  };

  const toggleEntity = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const limparHistoricoEstados = () => {
    setSyncStatus({});
    setEntidadeErros({});
    setPartialStatus({});
    setJobsProgress({});
    localStorage.removeItem('gexcel_efatura_last_sync_status');
    localStorage.removeItem('gexcel_efatura_partial_status');
  };

  // Iniciação individual resiliente com enriquecimento de tipos de erro
  const iniciarExtracaoParaEntidade = async (
    ent: Entidade,
    opcoes?: { forcarScraper?: boolean; dataIni?: string; dataFim?: string }
  ) => {
    try {
      const rawSess = sessionStorage.getItem('gexcel_evo06_auth_session');
      const parsedSess = rawSess ? JSON.parse(rawSess) : null;
      if (!parsedSess || !parsedSess.token || !parsedSess.username) {
        window.dispatchEvent(new Event('gexcel-evo06-logout'));
        return;
      }
    } catch {
      window.dispatchEvent(new Event('gexcel-evo06-logout'));
      return;
    }

    const nifParaEnviar = (ent.nif || ent.nif_cc || '').trim();
    const usarScraperDireto = Boolean(opcoes?.forcarScraper);
    const dIniEnvio = opcoes?.dataIni || dataInicio;
    const dFimEnvio = opcoes?.dataFim || dataFim;

    // Deteção prévia de senha inválida: ignora sem chamar a AT
    if (senhasInvalidas[nifParaEnviar]) {
      const mot = senhasInvalidas[nifParaEnviar];
      setSyncStatus(prev => ({ 
        ...prev, 
        [ent.id]: `Bloqueado: Senha Inválida (${mot})` 
      }));
      mostrarAlertaErro(
        ent.nomecli || ent.id,
        nifParaEnviar,
        `Autenticação Bloqueada: Senha previamente rejeitada pela AT (${mot}). Clique em 'Limpar' na tabela para desbloquear e testar à mão.`,
        'senha_invalida',
        'Senha Rejeitada AT',
        mot,
        ent.id
      );
      return;
    }

    // Limpar erros anteriores desta entidade ao reiniciar
    setEntidadeErros(prev => {
      const next = { ...prev };
      delete next[ent.id];
      return next;
    });
    setAlertasErro(prev => prev.filter(a => a.nif !== nifParaEnviar));

    const volEst = estimativasVolume[nifParaEnviar]?.volume_estimado ?? (matriz[nifParaEnviar]?.total_docs_ano ?? 0);
    setSyncStatus(prev => ({
      ...prev,
      [ent.id]: usarScraperDireto || modoPortalWebForcado ? `[Portal Web] Na fila (~${volEst} docs)...` : `Fila SJF (~${volEst} docs)...`
    }));
    
    try {
      const payload = {
        nif: nifParaEnviar,
        nome_entidade: ent.nomecli || '',
        data_inicio: dIniEnvio,
        data_fim: dFimEnvio,
        tipo: tipoOperacao, 
        reimportar_tudo: usarScraperDireto ? true : reimportarTudo,
        forcar_scraper: usarScraperDireto,
        volume_estimado: volEst,
        modo_saida: 'sqlite',
        gerar_xml_legado: gerarXmlLegado
      };

      const res = await fetch("http://127.0.0.1:8015/api/extracao/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setActiveJobs(prev => ({ ...prev, [ent.id]: data.job_id }));
      } else {
        const err = await res.json();
        const msg = err.detail?.mensagem || err.detail || 'Falha na API';
        const tipoErro = err.detail?.tipo_erro || 'outro';
        const badgeLabel = err.detail?.badge_label || 'Erro AT';
        const detalhe = err.detail?.detalhe || (typeof err.detail === 'string' ? err.detail : msg);

        setEntidadeErros(prev => ({
          ...prev,
          [ent.id]: {
            tipo_erro: tipoErro,
            badge_label: badgeLabel,
            mensagem: msg,
            detalhe: detalhe,
          }
        }));

        setSyncStatus(prev => ({ ...prev, [ent.id]: `Erro: ${badgeLabel}` }));
        mostrarAlertaErro(ent.nomecli || ent.id, nifParaEnviar, msg, tipoErro, badgeLabel, detalhe, ent.id);
      }
    } catch (err: any) {
      const netMsg = err.message || 'Sem Ligação à API (Porta 8015)';
      setSyncStatus(prev => ({ ...prev, [ent.id]: `Erro: ${netMsg}` }));
      mostrarAlertaErro(ent.nomecli || ent.id, nifParaEnviar, netMsg, 'outro', 'Erro Ligação', netMsg, ent.id);
    }
  };

  const handleTentarNovamente = (nif: string, entId?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ent = entidades.find(item => item.id === entId || (item.nif || item.nif_cc || '').trim() === nif);
    if (ent) {
      iniciarExtracaoParaEntidade(ent);
    }
  };

  const handleSync = async () => {
    try {
      const rawSess = sessionStorage.getItem('gexcel_evo06_auth_session');
      const parsedSess = rawSess ? JSON.parse(rawSess) : null;
      if (!parsedSess || !parsedSess.token || !parsedSess.username) {
        window.dispatchEvent(new Event('gexcel-evo06-logout'));
        return;
      }
    } catch {
      window.dispatchEvent(new Event('gexcel-evo06-logout'));
      return;
    }

    if (selectedIds.size === 0) return;
    if (!modoManual && meses.size === 0) {
      alert("Por favor selecione pelo menos um mês antes de iniciar a sincronização.");
      return;
    }

    // Validação de disponibilidade com arranque automático se o motor estiver offline
    let apiPronta = false;
    try {
      const checkRes = await fetch("http://127.0.0.1:8015/", { signal: AbortSignal.timeout(2000) });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.assinatura && checkData.assinatura.includes("API Importador e-Fatura Gexcel")) {
          apiPronta = true;
          setApiOnline(true);
        }
      }
    } catch {}

    if (!apiPronta) {
      setALigarMotor(true);
      await ligarMotorAutomatico();

      // Aguarda até 8 segundos pela prontidão do motor
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const cRes = await fetch("http://127.0.0.1:8015/", { signal: AbortSignal.timeout(1000) });
          if (cRes.ok) {
            const cData = await cRes.json();
            if (cData.assinatura && cData.assinatura.includes("API Importador e-Fatura Gexcel")) {
              apiPronta = true;
              setApiOnline(true);
              break;
            }
          }
        } catch {}
      }
      setALigarMotor(false);

      if (!apiPronta) {
        alert("O Motor da API e-Fatura (Porta 8015) está desligado e não foi possível iniciá-lo automaticamente.");
        return;
      }
    }

    abortSyncRef.current = false;
    setIsSyncing(true);

    // 1. Obter ou atualizar estimativas de volume (SJF - Shortest Job First)
    let mapaVols = estimativasVolume;
    try {
      const vRes = await fetch(`http://127.0.0.1:8015/api/estatisticas/volume-estimado?ano=${ano}&tipo=${tipoOperacao}`);
      if (vRes.ok) {
        const vData = await vRes.json();
        if (vData.volumes) {
          mapaVols = vData.volumes;
          setEstimativasVolume(vData.volumes);
        }
      }
    } catch (err) {
      console.warn("Aviso ao carregar estimativas no handleSync:", err);
    }

    // 2. Ordenação Inteligente SJF: menor volume estimado primeiro (0 ➔ N)
    const entidadesParaSincronizar = Array.from(selectedIds)
      .map(id => entidades.find(e => e.id === id))
      .filter((e): e is Entidade => !!e)
      .sort((a, b) => {
        const nifA = (a.nif || a.nif_cc || '').trim();
        const nifB = (b.nif || b.nif_cc || '').trim();

        const volA = mapaVols[nifA]?.volume_estimado ?? (matriz[nifA]?.total_docs_ano ?? 0);
        const volB = mapaVols[nifB]?.volume_estimado ?? (matriz[nifB]?.total_docs_ano ?? 0);

        if (volA !== volB) return volA - volB;
        return (a.nomecli || '').localeCompare(b.nomecli || '');
      });

    if (entidadesParaSincronizar.length > 1) {
      setBatchSyncIds(new Set(entidadesParaSincronizar.map(e => e.id)));
    } else {
      setBatchSyncIds(new Set());
    }

    for (const ent of entidadesParaSincronizar) {
      if (abortSyncRef.current) break;
      await iniciarExtracaoParaEntidade(ent);
    }

    if (Object.keys(activeJobsRef.current).length === 0) {
      setBatchSyncIds(new Set());
      setIsSyncing(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0 overflow-y-auto xl:overflow-hidden">
      
      {/* Cabeçalho Oficial evoGex.com */}
      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Controlo & Auditoria Fiscal
          </span>
          <h1 className="page-title text-lg sm:text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center flex-wrap gap-2">
            <span>Matriz de Extração e Controlo e-Fatura</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-700 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
              Exercício {ano}
            </span>
          </h1>
          <p className="page-description text-muted-foreground text-[11.5px] font-mono tracking-[0.03em] mt-0.5 hidden sm:block">
            Acompanhamento contínuo por exercício fiscal e extração massiva em segundo plano.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Botão Destacado do Assistente Guiado Passo a Passo */}
          <button
            type="button"
            onClick={() => (assistenteAberto ? fecharAssistente() : abrirAssistente())}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold transition shadow-xs cursor-pointer ${
              assistenteAberto
                ? 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-[#0284c7] dark:border-sky-500'
                : 'bg-[#0284c7] hover:bg-[#0369a1] text-white border border-[#0284c7]'
            }`}
            title="Abrir ou fechar o Assistente Guiado Passo a Passo"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{assistenteAberto ? 'Ocultar Assistente' : 'Assistente Passo a Passo'}</span>
          </button>

          {/* Indicador Automático de Processamento Paralelo (100% Autónomo na Cloud) */}
          {apiOnline && (perfConfig.active_workers > 0 || (perfConfig.queue_waiting || 0) > 0) && (
            <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs select-none">
              <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span className="font-semibold text-foreground">
                {perfConfig.active_workers} em paralelo
              </span>
              {(perfConfig.queue_waiting || 0) > 0 && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">·</span>
                  <span className="text-amber-500 text-[11px]">
                    {perfConfig.queue_waiting} na fila
                  </span>
                </>
              )}
            </div>
          )}

          {/* Badge & Painel do Worker de 2.º Plano (visível apenas quando existem tarefas ativas/pendentes) */}
          {apiOnline && pipelineStatus && (pipelineStatus.tarefa_atual || (pipelineStatus.contagens?.pendentes || 0) > 0) && (
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setDropdownWorkerAberto(prev => !prev)}
                className={`flex items-center space-x-2 border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs cursor-pointer transition-colors ${
                  pipelineStatus.primeiro_plano_ocupado
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300'
                    : pipelineStatus.tarefa_atual
                    ? 'bg-sky-500/10 border-sky-500/40 text-[#0284c7] dark:text-sky-300'
                    : (pipelineStatus.contagens?.pendentes || 0) > 0
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
                title="Clique para ver o estado do Worker de Segundo Plano (--worker)"
              >
                <div className={`w-2 h-2 rounded-full ${
                  pipelineStatus.primeiro_plano_ocupado
                    ? 'bg-amber-500'
                    : pipelineStatus.tarefa_atual
                    ? 'bg-sky-500 animate-pulse'
                    : (pipelineStatus.contagens?.pendentes || 0) > 0
                    ? 'bg-amber-500'
                    : pipelineStatus.worker_ativo
                    ? 'bg-emerald-500'
                    : 'bg-slate-400'
                }`} />
                <span className="flex items-center space-x-1.5">
                  <span className="font-semibold">Worker 2º Plano</span>
                  {pipelineStatus.primeiro_plano_ocupado ? (
                    <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.2 rounded font-bold">
                      Pausa (1º Plano)
                    </span>
                  ) : pipelineStatus.tarefa_atual ? (
                    <span className="text-[10px] bg-sky-500/20 text-[#0284c7] dark:text-sky-300 px-1.5 py-0.2 rounded font-bold flex items-center space-x-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      <span>{pipelineStatus.tarefa_atual.tipo_tarefa === 'scrape_anuladas' ? 'Anuladas' : pipelineStatus.tarefa_atual.tipo_tarefa === 'completar_nomes_vendas' ? 'Nomes Vendas' : 'Tarefa'}</span>
                    </span>
                  ) : (pipelineStatus.contagens?.pendentes || 0) > 0 ? (
                    <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.2 rounded font-bold">
                      {pipelineStatus.contagens.pendentes} pendente(s)
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      {pipelineStatus.worker_ativo ? 'Ativo' : 'Ocioso'}
                    </span>
                  )}
                </span>
              </button>

              {/* Popover / Dropdown do Worker */}
              {dropdownWorkerAberto && (
                <div 
                  className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-lg shadow-xl p-3 z-50 text-xs font-mono animate-in fade-in slide-in-from-top-2 duration-150"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                    <div className="flex items-center space-x-1.5">
                      <Zap className="w-4 h-4 text-sky-500" />
                      <span className="font-bold text-foreground">Motor de 2.º Plano (--worker)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDropdownWorkerAberto(false)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2 text-[11px]">
                    <div className="flex justify-between items-center bg-muted/40 p-2 rounded">
                      <span className="text-muted-foreground">Processo Worker:</span>
                      <span className={`font-semibold ${pipelineStatus.worker_ativo ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {pipelineStatus.worker_ativo ? 'Em Execução (PID Ativo)' : 'Em Espera (Auto-encerra após 60s)'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center bg-muted/40 p-2 rounded">
                      <span className="text-muted-foreground">Primeiro Plano:</span>
                      <span className={`font-semibold ${pipelineStatus.primeiro_plano_ocupado ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {pipelineStatus.primeiro_plano_ocupado ? 'Ocupado (Pausa Inteligente)' : 'Livre'}
                      </span>
                    </div>

                    {pipelineStatus.tarefa_atual && (
                      <div className="bg-sky-500/10 border border-sky-500/25 p-2 rounded space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-sky-600 dark:text-sky-400">Tarefa em Curso:</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-700 dark:text-sky-300">
                            {pipelineStatus.tarefa_atual.tipo_tarefa}
                          </span>
                        </div>
                        <div className="text-foreground font-semibold truncate">
                          {pipelineStatus.tarefa_atual.nome_entidade || pipelineStatus.tarefa_atual.nif}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          NIF {pipelineStatus.tarefa_atual.nif} · {pipelineStatus.tarefa_atual.modulo?.toUpperCase() || 'AMBOS'}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-1.5 text-center pt-1">
                      <div className="p-1.5 rounded bg-muted/50 border border-border/60">
                        <div className="text-[9px] text-muted-foreground">Pendentes</div>
                        <div className="font-bold text-amber-500 text-xs">{pipelineStatus.contagens?.pendentes || 0}</div>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50 border border-border/60">
                        <div className="text-[9px] text-muted-foreground">Em Curso</div>
                        <div className="font-bold text-sky-500 text-xs">{pipelineStatus.contagens?.em_curso || 0}</div>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50 border border-border/60">
                        <div className="text-[9px] text-muted-foreground">Concluídas</div>
                        <div className="font-bold text-emerald-500 text-xs">{pipelineStatus.contagens?.concluidas || 0}</div>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50 border border-border/60">
                        <div className="text-[9px] text-muted-foreground">Erros</div>
                        <div className="font-bold text-rose-500 text-xs">{pipelineStatus.contagens?.erros || 0}</div>
                      </div>
                    </div>

                    <p className="text-[9.5px] text-muted-foreground leading-tight pt-1">
                      O worker processa em segundo plano a extração de anuladas e a resolução de nomes de clientes particulares (vendas), pausando de forma inteligente sempre que estiver a usar a aplicação.
                    </p>

                    <button
                      type="button"
                      onClick={handleAcordarWorker}
                      disabled={acordandoWorker}
                      className="w-full mt-2 py-1.5 px-3 rounded bg-[#0284c7] hover:bg-[#0275b0] text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
                      title="Acorda o processo secundário gevo_ef2026.exe --worker para processar tarefas pendentes"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${acordandoWorker ? 'animate-spin' : ''}`} />
                      <span>{acordandoWorker ? 'A acionar...' : 'Acordar / Verificar Worker'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {apiOnline && modoPortalWebForcado && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch('http://127.0.0.1:8015/api/modo-teste-scraper', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ativo: false }),
                  });
                  if (res.ok) setModoPortalWebForcado(false);
                } catch {}
              }}
              className="flex items-center space-x-1.5 bg-amber-100 dark:bg-[#241a08] hover:bg-amber-200 dark:hover:bg-[#33250c] border border-amber-400 dark:border-amber-700 px-3 py-1.5 rounded-full text-xs font-mono font-semibold text-amber-900 dark:text-amber-200 transition-colors cursor-pointer shadow-2xs"
              title="Todas as extrações estão a recolher diretamente pelo Portal Web e-Fatura. Clique para voltar ao modo automático."
            >
              <Globe className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
              <span>Portal Web Ativo</span>
            </button>
          )}

          {apiOnline ? (
            <div 
              className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs"
              title={
                motorSource === 'local'
                  ? `Centro de Dados do Escritório ativo neste posto (127.0.0.1:8015 · v${versaoMotor || '4.2.27'})`
                  : `Ligado ao Centro de Dados do Escritório ${versaoMotor ? `(v${versaoMotor})` : ''}`
              }
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-700 dark:text-slate-300 flex items-center space-x-1">
                <span>Centro de Dados Online</span>
                {versaoMotor && (
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-[#091e1a] border border-emerald-300 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                    v{versaoMotor}
                  </span>
                )}
              </span>
            </div>
          ) : aLigarMotor ? (
            <div className="flex items-center space-x-2 bg-amber-100 dark:bg-[#241a08] border border-amber-400 dark:border-amber-800 px-3 py-1.5 rounded-full text-xs font-mono text-amber-800 dark:text-amber-300 shadow-2xs">
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-amber-600 dark:text-amber-400" />
              <span>A ligar ao Centro de Dados...</span>
            </div>
          ) : (
            <button
              onClick={ligarMotorAutomatico}
              className="flex items-center space-x-1.5 bg-rose-50 dark:bg-[#290f14] hover:bg-rose-100 dark:hover:bg-[#3b151d] border border-rose-300 dark:border-rose-800 px-3 py-1.5 rounded-full text-xs font-mono text-rose-700 dark:text-rose-300 transition-colors cursor-pointer shadow-2xs"
              title="O Centro de Dados do escritório está desligado. Clique para reconectar."
            >
              <Power className="w-3 h-3 shrink-0" />
              <span>Ligar ao Centro de Dados</span>
            </button>
          )}
        </div>
      </header>

      {/* Aviso Claro quando o Computador / Servidor do Centro de Dados no Escritório está Desligado ou PC Novo */}
      {apiOnline === false && !aLigarMotor && (
        <div className="p-3 bg-rose-50 dark:bg-[#290f14] border border-rose-400 dark:border-rose-800 rounded-md text-rose-800 dark:text-rose-200 font-mono text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2.5">
            <ServerCrash className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>
              <strong>Centro de Dados do Escritório Desligado (ou Computador Novo):</strong> Ligue o computador/servidor do escritório onde reside o Centro de Dados ou, se quiser criar o Centro de Dados neste computador, instale o pacote unificado (Dados evoGex + Motor).
            </span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => window.open('/api/sistema/instalador-centro-dados', '_blank')}
              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-[11px] cursor-pointer transition shrink-0"
              title="Cria a pasta única Dados_evoGex e instala automaticamente o Motor, SafeDrive, PocketBase e Bases SQLite neste computador"
            >
              Instalar Centro + Motor neste PC
            </button>
            <button
              type="button"
              onClick={ligarMotorAutomatico}
              className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-semibold text-[11px] cursor-pointer transition shrink-0"
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      )}

      {/* Banners de Notificação e Erros da AT */}
      {alertasErro.length > 0 && (
        <div className="space-y-2 shrink-0">
          {alertasErro.map(alerta => {
            const isInvalidPass = alerta.tipo_erro === 'senha_invalida';
            const isServerError = alerta.tipo_erro === 'servidor_at';
            const isTimeout = alerta.tipo_erro === 'timeout_rede';
            const isRateLimit = alerta.tipo_erro === 'rate_limit';
            const isPermissao = alerta.tipo_erro === 'permissao_subuser';

            const cardBg = isInvalidPass
              ? "bg-rose-50 dark:bg-[#1c0f16] border-rose-300 dark:border-rose-900 before:bg-rose-500"
              : isServerError || isTimeout || isRateLimit
              ? "bg-amber-50 dark:bg-[#1f1a10] border-amber-300 dark:border-amber-900 before:bg-amber-500"
              : isPermissao
              ? "bg-orange-50 dark:bg-[#1f140e] border-orange-300 dark:border-orange-900 before:bg-orange-500"
              : "bg-rose-50 dark:bg-[#1c0f16] border-rose-300 dark:border-rose-900 before:bg-rose-500";

            return (
              <div 
                key={alerta.id}
                className={`relative evo-card-signature ${cardBg} border rounded-md p-2.5 text-xs shadow-sm flex items-center justify-between gap-3 before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:z-20 animate-in fade-in slide-in-from-top-2 duration-200`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  {isInvalidPass ? (
                    <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  ) : isServerError ? (
                    <ServerCrash className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (isTimeout || isRateLimit) ? (
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  )}
                  <div className="flex items-baseline space-x-2 min-w-0 font-mono">
                    <span className={`font-bold text-[11.5px] shrink-0 ${isInvalidPass ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {alerta.nome} ({alerta.nif})
                    </span>
                    <span className="text-muted-foreground text-[10px] shrink-0">· {alerta.hora} :</span>
                    {alerta.badge_label && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        isInvalidPass 
                          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30' 
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                      }`}>
                        {alerta.badge_label}
                      </span>
                    )}
                    <span className={`text-[11px] font-sans truncate ${isInvalidPass ? 'text-rose-900 dark:text-rose-200' : 'text-amber-900 dark:text-amber-200'}`} title={alerta.detalhe || alerta.mensagem}>
                      {alerta.mensagem}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  {isInvalidPass ? (
                    <button
                      type="button"
                      onClick={() => handleResetSenhaInvalida(alerta.nif, alerta.entId)}
                      className="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[10px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer"
                      title="Limpar o bloqueio antifraude desta entidade para tentar nova autenticação à mão"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Desbloquear / Tentar de novo</span>
                    </button>
                  ) : (isServerError || isTimeout || isRateLimit) ? (
                    <button
                      type="button"
                      onClick={() => handleTentarNovamente(alerta.nif, alerta.entId)}
                      className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer"
                      title="Tentar nova comunicação com a AT"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Tentar Novamente</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => fecharAlertaErro(alerta.id)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Fechar notificação"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Área Principal + Assistente Encaixado à Direita */}
      <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0">

        {/* Lado Esquerdo: Barra Operacional Minimalista (4 Zonas Sincronizadas) + Matriz Anual */}
        <div className="flex-1 flex flex-col gap-2.5 min-w-0 min-h-0">

          {/* Barra Operacional Minimalista com Destaque Sincronizado */}
          <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-2.5 shadow-2xs shrink-0 flex flex-wrap items-center justify-between gap-2 overflow-visible before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">

            {/* Zona 1: Pasta de Destino dos Dados */}
            <div
              onClick={() => assistenteAberto && setPassoAssistente(1)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[11px] font-mono transition ${
                assistenteAberto && passoAssistente === 1
                  ? 'ring-2 ring-[#0284c7] dark:ring-sky-400 bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold shrink-0 ${
                  passoAssistente === 1 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}>
                  ① Destino
                </span>
              )}
              <span className="text-slate-600 dark:text-slate-300 font-semibold shrink-0 hidden sm:inline">Dados:</span>
              <span title={caminhoDadosLocal} className="text-foreground font-semibold break-all max-w-[240px]">
                {caminhoDadosLocal}
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
                onClick={e => { e.stopPropagation(); abrirPastaDadosWindows(); }}
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
                <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                  passoAssistente === 2 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}>
                  ② Empresas
                </span>
              )}
              <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] p-0.5 rounded border border-slate-200 dark:border-[#1e344f]">
                <button
                  type="button"
                  onClick={() => setTipoOperacao('compras')}
                  className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    tipoOperacao === 'compras'
                      ? 'bg-[#0284c7] text-white shadow-2xs'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1a2c40]'
                  }`}
                  title="Faturas de Fornecedores / Compras"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>Compras</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTipoOperacao('vendas')}
                  className={`py-1 px-2.5 text-xs font-mono rounded font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                    tipoOperacao === 'vendas'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1a2c40]'
                  }`}
                  title="Faturas Emitidas / Vendas a Clientes"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Vendas</span>
                </button>
              </div>

              <EmpresaSelectorCombobox
                entidades={entidades}
                value={nifFiltroEmpresa}
                onChange={setNifFiltroEmpresa}
                modoPrivacidade={modoPrivacidade}
                allLabel={`Todas (${entidades.length})`}
                placeholder="Pesquisar NIF, nome ou código..."
                className="w-full sm:w-auto sm:min-w-[240px] max-w-full sm:max-w-[320px]"
                dropdownClassName="w-80 md:w-[420px]"
                align="left"
                title="Pesquisar e selecionar empresa na Matriz"
              />

              <span className="text-[11px] font-mono text-slate-700 dark:text-slate-200 font-semibold px-1.5 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-200 dark:border-[#1e344f] shrink-0 tabular-nums">
                {selectedIds.size}/{entidades.length}
              </span>
            </div>

            {/* Zona 3: Período (Exercício + Atalhos + Atualizar) */}
            <div
              onClick={() => assistenteAberto && setPassoAssistente(3)}
              className={`flex flex-wrap items-center gap-1.5 px-2 py-1 rounded border transition ${
                assistenteAberto && passoAssistente === 3
                  ? 'ring-2 ring-[#0284c7] dark:ring-sky-400 bg-sky-50 dark:bg-[#0a1929] border-[#0284c7] shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                  passoAssistente === 3 ? 'bg-[#0284c7] text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}>
                  ③ Período
                </span>
              )}
              <div className="flex items-center space-x-1 bg-white dark:bg-[#0c1520] border border-[#0284c7] dark:border-sky-600 rounded px-1.5 py-0.5">
                <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => setAno(a => a - 1)}
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
                  onClick={() => setAno(a => (a < anoAtual ? a + 1 : a))}
                  disabled={ano >= anoAtual}
                  className={`p-0.5 rounded ${ano >= anoAtual ? 'opacity-20 cursor-not-allowed text-muted-foreground' : 'hover:bg-sky-100 dark:hover:bg-[#14304d] text-foreground cursor-pointer'}`}
                  title="Exercício Seguinte"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={selecionarAnoCompleto}
                  className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] text-foreground border border-slate-300 dark:border-[#253a52] cursor-pointer font-semibold"
                >
                  Ano Todo
                </button>
                {ano === anoAtual && (
                  <button
                    type="button"
                    onClick={selecionarMesAtual}
                    className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] text-foreground border border-slate-300 dark:border-[#253a52] cursor-pointer font-semibold"
                  >
                    Mês Atual
                  </button>
                )}
                <button
                  type="button"
                  onClick={desmarcarTodosMeses}
                  className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-[#253a52] cursor-pointer"
                >
                  Limpar Meses
                </button>
              </div>

              <button
                type="button"
                onClick={() => carregarMatriz(ano, tipoOperacao)}
                disabled={carregandoMatriz}
                className="p-1.5 text-slate-700 dark:text-slate-200 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] transition cursor-pointer"
                title={`Atualizar matriz de ${tipoOperacao}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${carregandoMatriz ? 'animate-spin text-[#0284c7] dark:text-sky-400' : ''}`} />
              </button>
            </div>

            {/* Zona 4: Opções Discretas + Botão Iniciar Importação */}
            <div
              onClick={() => assistenteAberto && setPassoAssistente(4)}
              className={`relative flex items-center space-x-2 px-2 py-1 rounded border transition ${
                assistenteAberto && passoAssistente === 4
                  ? 'ring-2 ring-amber-500 bg-amber-50 dark:bg-[#1c1608] border-amber-500 shadow-md'
                  : 'bg-slate-50 dark:bg-[#101c2b] border-slate-200 dark:border-[#1e344f]'
              }`}
            >
              {assistenteAberto && (
                <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold shrink-0 ${
                  passoAssistente === 4 ? 'bg-amber-600 text-white' : 'bg-slate-200 dark:bg-[#1a2c40] text-slate-700 dark:text-slate-200'
                }`}>
                  ④ Iniciar
                </span>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setOpcoesAvancadasAbertas(v => !v); }}
                  className="px-2 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#1a2d42] border border-slate-300 dark:border-[#253a52] text-[11px] font-mono font-semibold text-foreground flex items-center space-x-1 cursor-pointer"
                  title="Opções avançadas de extração"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                  <span className="hidden sm:inline">Opções</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${opcoesAvancadasAbertas ? 'rotate-180' : ''}`} />
                </button>

                {opcoesAvancadasAbertas && (
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute right-0 mt-1.5 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md shadow-2xl p-3 z-50 space-y-2.5 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-1.5">
                      <span className="font-bold text-foreground uppercase text-[10px] tracking-wider">Opções Avançadas</span>
                      <button type="button" onClick={() => setOpcoesAvancadasAbertas(false)} className="text-slate-500 hover:text-foreground cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <label className="flex items-start space-x-2 cursor-pointer p-1.5 rounded bg-slate-50 dark:bg-[#101c2b] border border-slate-200 dark:border-[#1e344f]">
                      <input
                        type="checkbox"
                        checked={reimportarTudo}
                        onChange={e => setReimportarTudo(e.target.checked)}
                        className="mt-0.5 rounded accent-rose-600 cursor-pointer"
                      />
                      <div>
                        <span className="block font-sans font-semibold text-foreground text-xs">Reimportação Forçada (Wipe)</span>
                        <span className="block text-[9.5px] text-slate-600 dark:text-slate-400">Substitui registos do período na base central.</span>
                      </div>
                    </label>

                    <label className="flex items-start space-x-2 cursor-pointer p-1.5 rounded bg-slate-50 dark:bg-[#101c2b] border border-slate-200 dark:border-[#1e344f]">
                      <input
                        type="checkbox"
                        checked={gerarXmlLegado}
                        onChange={e => toggleGerarXmlLegado(e.target.checked)}
                        className="mt-0.5 rounded accent-emerald-600 cursor-pointer"
                      />
                      <div>
                        <span className="block font-sans font-semibold text-foreground text-xs">Alimentar Excel Apps (XML V3)</span>
                        <span className="block text-[9.5px] text-slate-600 dark:text-slate-400">Gera XMLs em paralelo para compatibilidade Excel.</span>
                      </div>
                    </label>

                    <div className="flex items-start space-x-1.5 p-2 rounded bg-slate-100 dark:bg-[#132233] text-[10px] text-slate-700 dark:text-slate-300 leading-snug">
                      <Info className="w-3.5 h-3.5 text-[#0284c7] shrink-0 mt-0.5" />
                      <span>Após iniciar, a extração continua em segundo plano mesmo se fechar o browser.</span>
                    </div>

                    {Object.keys(syncStatus).length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          limparHistoricoEstados();
                          setOpcoesAvancadasAbertas(false);
                        }}
                        className="w-full py-1.5 px-2 rounded bg-slate-100 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c2e40] border border-slate-300 dark:border-[#253a52] text-[10.5px] font-semibold text-foreground cursor-pointer"
                      >
                        Limpar Histórico de Estados
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isSyncing ? (
                <button
                  type="button"
                  onClick={handleStopAll}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded font-mono text-xs font-bold uppercase tracking-wider cursor-pointer shadow-xs bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Parar</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={selectedIds.size === 0 || meses.size === 0}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-mono text-xs font-bold uppercase tracking-wider cursor-pointer shadow-xs transition ${
                    selectedIds.size === 0 || meses.size === 0
                      ? 'bg-slate-200 dark:bg-[#182838] text-slate-500 cursor-not-allowed'
                      : reimportarTudo
                        ? 'bg-rose-600 hover:bg-rose-700 text-white'
                        : tipoOperacao === 'vendas'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-[#0284c7] hover:bg-[#0369a1] text-white'
                  }`}
                >
                  {reimportarTudo ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{reimportarTudo ? 'Reimportar' : 'Sincronizar'} ({selectedIds.size})</span>
                </button>
              )}
            </div>
          </div>

          {/* A Grande Matriz Anual (100% da largura) */}
          <div className="flex-1 overflow-hidden rounded-md border border-border shadow-xs flex flex-col min-h-[380px] lg:min-h-0 bg-card text-card-foreground">
            
            {/* Tabela de Matriz com Rolagem Interna Segura e Fundo Sólido */}
            <div className="flex-1 overflow-x-auto overflow-y-auto bg-card">
            <table className="w-full text-xs text-left whitespace-nowrap bg-card border-collapse">
              <thead className="bg-slate-200/90 dark:bg-[#0c1724] text-slate-800 dark:text-slate-100 font-semibold sticky top-0 z-20 shadow-xs border-b border-slate-300 dark:border-[#1e2f42] select-none">
                <tr>
                  <th className="py-2 px-1.5 w-7 min-w-[28px] text-center">
                    <input 
                      type="checkbox" 
                      onChange={toggleSelectAll}
                      checked={entidadesFiltradasEOrdenadas.length > 0 && selectedIds.size === entidadesFiltradasEOrdenadas.length}
                      className="w-3.5 h-3.5 rounded border border-slate-300 dark:border-slate-600 bg-card text-primary focus:ring-0 cursor-pointer accent-primary"
                    />
                  </th>
                  <th 
                    onClick={() => handleSort('nif')}
                    className="py-2 px-1 w-20 min-w-[78px] text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200 hover:text-foreground dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-muted/50 cursor-pointer select-none transition-colors"
                    title="Ordenar por NIF"
                  >
                    <div className="flex items-center space-x-1">
                      <span>NIF</span>
                      {renderSortIcon('nif')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('nomecli')}
                    className="py-2 px-1.5 w-40 max-w-[160px] min-w-[100px] text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200 hover:text-foreground dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-muted/50 cursor-pointer select-none transition-colors"
                    title="Ordenar por Nome da Empresa"
                  >
                    <div className="flex items-center space-x-1">
                      <span>Empresa</span>
                      {renderSortIcon('nomecli')}
                    </div>
                  </th>
                  
                  {/* 12 Colunas de Meses */}
                  {MESES_NOMES.map(m => {
                    const isFuturo = ano === anoAtual && m.num > mesAtual;
                    const isSelected = mesesAtivos.has(m.num);
                    const isCurrent = ano === anoAtual && m.num === mesAtual;

                    return (
                      <th 
                        key={m.num} 
                        className={`py-1.5 px-0.5 w-9 min-w-[36px] text-center text-[10px] font-mono uppercase tracking-[0.12em] select-none transition-all relative ${
                          isSelected
                            ? 'bg-sky-100/90 dark:bg-sky-950/80 text-[#0284c7] dark:text-sky-300 font-bold border-x border-sky-300/80 dark:border-sky-500/50 shadow-2xs'
                            : 'text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-300/40 dark:hover:bg-muted/40'
                        } ${isFuturo ? 'opacity-30' : ''}`}
                        title={isFuturo ? 'Mês futuro' : `Mês de ${m.full}${isSelected ? ' (Selecionado para sincronização)' : ''}`}
                      >
                        {isSelected && (
                          <span className="absolute top-0 left-0 right-0 h-[2.5px] bg-[#0284c7] dark:bg-sky-400" />
                        )}
                        <div className="flex items-center justify-center space-x-1">
                          {/* Botão de Toggle do Mês */}
                          <button
                            type="button"
                            disabled={isFuturo}
                            onClick={() => toggleMes(m.num)}
                            className={`px-1 py-0.5 rounded transition cursor-pointer flex items-center space-x-0.5 ${
                              isSelected
                                ? 'bg-[#0284c7] text-white font-bold shadow-2xs'
                                : 'hover:bg-slate-300/70 dark:hover:bg-[#1a2d42] text-foreground'
                            }`}
                            title={isFuturo ? 'Mês futuro' : `Clique para ${isSelected ? 'desmarcar' : 'marcar'} ${m.full}`}
                          >
                            <span>{m.nome}</span>
                            {isCurrent && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Mês em curso" />
                            )}
                          </button>

                          {/* Botão Dedicado de Ordenação */}
                          <button
                            type="button"
                            onClick={() => handleSort(`mes_${m.num}`)}
                            className="p-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-slate-300/60 dark:hover:bg-slate-700/60 transition cursor-pointer"
                            title={`Ordenar por documentos em ${m.full}`}
                          >
                            {renderSortIcon(`mes_${m.num}`)}
                          </button>
                        </div>
                      </th>
                    );
                  })}

                  <th 
                    onClick={() => handleSort('total')}
                    className="py-2 px-1 w-12 min-w-[44px] text-right text-[10px] font-mono font-bold uppercase tracking-[0.12em] bg-slate-300/50 dark:bg-[#0f1d2e] hover:bg-slate-300/70 text-slate-800 dark:text-slate-100 border-x border-slate-300 dark:border-border/60 cursor-pointer select-none transition-colors"
                    title="Ordenar pelo Total Anual"
                  >
                    <div className="flex items-center justify-end space-x-1">
                      <span>Total</span>
                      {renderSortIcon('total')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('status')}
                    className="py-2 pr-3 pl-2 w-52 lg:w-72 min-w-[200px] lg:min-w-[275px] text-right text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200 hover:text-foreground dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-muted/50 cursor-pointer select-none transition-colors lg:sticky lg:right-0 lg:z-30 bg-slate-200 dark:bg-[#0c1724] lg:shadow-[-3px_0_5px_-1px_rgba(0,0,0,0.12)]"
                    title="Ordenar por Estado"
                  >
                    <div className="flex items-center justify-end space-x-1">
                      <span>Estado</span>
                      {renderSortIcon('status')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/25 bg-card">
                {entidadesFiltradasEOrdenadas.map(ent => {
                  const nifReal = (ent.nif || ent.nif_cc || '').trim();
                  const dadosEmpresa = matriz[nifReal];
                  const totalAno = dadosEmpresa ? dadosEmpresa.total_docs_ano : 0;
                  const statusInfo = getEntityStatusInfo(ent);
                  const isPartial = statusInfo.type === 'partial';

                  return (
                    <tr 
                      key={ent.id} 
                      className={`transition-colors text-[11px] select-none cursor-pointer text-foreground ${
                        selectedIds.has(ent.id) 
                          ? 'bg-sky-50/90 dark:bg-sky-400/[0.07] !border-y !border-sky-300/50 dark:!border-sky-500/30 font-medium' 
                          : activeJobs[ent.id] 
                            ? 'bg-primary/10' 
                            : 'hover:bg-slate-100/60 dark:hover:bg-[#132233]'
                      }`}
                      onClick={() => toggleEntity(ent.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          entidade: ent,
                          totalAno: totalAno
                        });
                      }}
                    >
                      <td className="py-2 px-2 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(ent.id)}
                          onChange={() => {}} 
                          className="w-3.5 h-3.5 rounded border border-slate-300 dark:border-slate-600 bg-card text-primary focus:ring-0 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="py-2 px-2 font-mono text-[#0284c7] dark:text-sky-400 font-semibold text-xs tracking-wider">
                        <div className="flex items-center justify-between space-x-1 group/nif">
                          <span>{modoPrivacidade ? (nifReal ? '■■■■■■■■■' : '-') : (nifReal || '-')}</span>
                          {nifReal && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirBrowserSessao(nifReal, ent.nomecli);
                              }}
                              disabled={loginEmCurso === nifReal}
                              className={`p-1 rounded transition-all cursor-pointer ${
                                loginEmCurso === nifReal
                                  ? 'opacity-100 bg-sky-500/25 text-[#0284c7] dark:text-sky-300'
                                  : senhasInvalidas[nifReal]
                                    ? 'opacity-90 hover:opacity-100 bg-destructive/15 text-destructive hover:bg-destructive/25'
                                    : 'opacity-40 group-hover/nif:opacity-100 hover:opacity-100 hover:bg-sky-500/15 text-slate-500 dark:text-slate-400 hover:text-[#0284c7] dark:hover:text-sky-300'
                              }`}
                              title={
                                senhasInvalidas[nifReal]
                                  ? `Login Automático Protegido: Senha registada como recusada pela AT (${senhasInvalidas[nifReal]}). Altere a senha em tCredenciais.xml antes de tentar novamente.`
                                  : `Abrir e-Fatura no Navegador com Login Automático (${ent.nomecli || nifReal})`
                              }
                            >
                              {loginEmCurso === nifReal ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500" />
                              ) : (
                                <Globe className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-foreground font-medium w-40 max-w-[160px]">
                        <div className="flex items-center justify-between group/empresa">
                          <span 
                            className="truncate block tracking-wide flex-1 mr-1" 
                            title={modoPrivacidade ? mascararTexto(ent.nomecli) : ent.nomecli}
                          >
                            {modoPrivacidade ? mascararTexto(ent.nomecli) : ent.nomecli}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirModalLimpeza(ent, ano);
                            }}
                            className="opacity-0 group-hover/empresa:opacity-100 hover:opacity-100 p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-all cursor-pointer shrink-0"
                            title={`Limpar dados de ${ent.nomecli} (${ano} ou meses)...`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      
                      {/* Células dos 12 Meses */}
                      {MESES_NOMES.map(m => {
                        const isSelected = mesesAtivos.has(m.num);
                        const isFuturo = ano === anoAtual && m.num > mesAtual;
                        const infoMes = dadosEmpresa?.meses ? dadosEmpresa.meses[m.num] : undefined;
                        const docs = infoMes ? infoMes.docs : 0;

                        const colClasses = isSelected
                          ? 'bg-sky-50/90 dark:bg-sky-400/[0.07] border-x border-sky-300/50 dark:border-sky-500/30'
                          : '';

                        const isMesIncompleto = Boolean(infoMes?.incompleto);

                        if (isFuturo) {
                          return (
                            <td key={m.num} className={`p-0 text-center text-muted-foreground/30 font-mono text-[10px] ${colClasses}`}>
                              ·
                            </td>
                          );
                        }

                        if (docs > 0) {
                          return (
                            <td key={m.num} className={`p-0 text-center ${colClasses}`}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavegarParaDados?.(nifReal, ano, m.num, tipoOperacao);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    entidade: ent,
                                    mes: m.num,
                                    docs: docs,
                                    totalAno: totalAno
                                  });
                                }}
                                className={`group/badge relative inline-flex items-center space-x-0.5 font-mono text-[10px] font-semibold px-1 py-0.5 rounded border tabular-nums transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 shadow-2xs ${
                                  isMesIncompleto
                                    ? 'text-amber-700 dark:text-amber-300 bg-amber-500/20 dark:bg-amber-500/25 border-amber-500/50 hover:bg-amber-500/35 ring-1 ring-amber-500/30 font-bold'
                                    : isSelected
                                      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/20 dark:bg-emerald-500/25 border-emerald-500/50 hover:bg-emerald-500/35 ring-1 ring-emerald-500/30 font-bold'
                                      : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50'
                                }`}
                                title={
                                  isMesIncompleto
                                    ? `Mês de ${m.full} (Importação Incompleta / Interrompida)\nDocumentos guardados na BD: ${docs.toLocaleString('pt-PT')}\nTotal esperado na AT: ${infoMes?.total_esperado ? infoMes.total_esperado.toLocaleString('pt-PT') : 'desconhecido'}\nAtenção: A base de dados deste mês ainda não está completa!\n\n➜ Clique esquerdo para abrir no separador Dados\n➜ Clique direito para opções de limpeza`
                                    : `Mês de ${m.full}\nDocumentos: ${docs.toLocaleString('pt-PT')}\nLinhas: ${infoMes?.linhas.toLocaleString('pt-PT')}\nBase: ${infoMes?.base.toLocaleString('pt-PT')} €\nIVA: ${infoMes?.iva.toLocaleString('pt-PT')} €\n\n➜ Clique esquerdo para abrir no separador Dados\n➜ Clique direito para opções de limpeza`
                                }
                              >
                                <span>{docs.toLocaleString('pt-PT')}</span>
                                <ArrowUpRight className="w-2.5 h-2.5 opacity-60 group-hover/badge:opacity-100 group-hover/badge:translate-x-0.5 group-hover/badge:-translate-y-0.5 transition-all shrink-0" />
                              </button>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={m.num}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                entidade: ent,
                                mes: m.num,
                                docs: 0,
                                totalAno: totalAno
                              });
                            }}
                            className={`p-0 text-center font-mono text-[10.5px] ${colClasses} ${isSelected ? 'text-sky-500/60 dark:text-sky-400/60 font-semibold' : 'text-muted-foreground/40'}`}
                          >
                            -
                          </td>
                        );
                      })}

                      {/* Coluna Total Ano */}
                      {(() => {
                        const isTotalIncompleto = Boolean(dadosEmpresa?.tem_incompletos) || (dadosEmpresa?.meses_incompletos && dadosEmpresa.meses_incompletos.length > 0) || isPartial;
                        return (
                          <td className={`py-1.5 px-1.5 text-right font-mono font-bold text-xs border-x border-slate-200 dark:border-border/40 ${
                            selectedIds.has(ent.id)
                              ? 'bg-sky-50/90 dark:bg-sky-950/40 !border-y !border-sky-300/50 dark:!border-sky-500/30'
                              : 'bg-slate-100/30 dark:bg-[#0f1d2e]/40'
                          }`}>
                            {totalAno > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavegarParaDados?.(nifReal, ano, undefined, tipoOperacao);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    entidade: ent,
                                    totalAno: totalAno
                                  });
                                }}
                                className={`group/badge inline-flex items-center space-x-0.5 tabular-nums font-bold transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 ${
                                  isTotalIncompleto
                                    ? 'text-amber-700 dark:text-amber-300 bg-amber-500/20 dark:bg-amber-500/25 px-1.5 py-0.5 rounded border border-amber-500/40 ring-1 ring-amber-500/20 hover:bg-amber-500/35'
                                    : 'text-[#0284c7] dark:text-sky-400 hover:text-sky-500 px-1 py-0.5 rounded hover:bg-sky-500/10'
                                }`}
                                title={
                                  isTotalIncompleto
                                    ? `Total Parcial Gravado no Ano ${ano}: ${totalAno.toLocaleString('pt-PT')} faturas na BD.\nAtenção: O exercício contém mês(es) com extração incompleta (${dadosEmpresa?.meses_incompletos?.map(mn => MESES_NOMES[mn - 1]?.nome).join(', ') || 'interrupção'}).\n\n➜ Clique esquerdo para abrir no separador Dados\n➜ Clique direito para opções de limpeza`
                                    : `Total do Ano ${ano}\nDocumentos: ${totalAno.toLocaleString('pt-PT')}\nLinhas: ${dadosEmpresa?.total_linhas_ano.toLocaleString('pt-PT')}\nBase: ${dadosEmpresa?.total_base_ano.toLocaleString('pt-PT')} €\nIVA: ${dadosEmpresa?.total_iva_ano.toLocaleString('pt-PT')} €\n\n➜ Clique esquerdo para abrir no separador Dados\n➜ Clique direito para opções de limpeza`
                                }
                              >
                                <span>{totalAno.toLocaleString('pt-PT')}</span>
                                <ArrowUpRight className="w-2.5 h-2.5 opacity-60 group-hover/badge:opacity-100 group-hover/badge:translate-x-0.5 group-hover/badge:-translate-y-0.5 transition-all shrink-0" />
                              </button>
                            ) : (
                              <span className="text-muted-foreground/40 font-normal">0</span>
                            )}
                          </td>
                        );
                      })()}

                      {/* Coluna Estado (Alargada, com texto moldado sem truncagem, barra de progresso visível e botão parar) */}
                      <td className={`py-1.5 px-2 text-right min-w-[200px] lg:min-w-[275px] w-52 lg:w-72 lg:sticky lg:right-0 lg:z-10 lg:shadow-[-3px_0_5px_-1px_rgba(0,0,0,0.08)] ${
                        selectedIds.has(ent.id) 
                          ? 'bg-sky-50 dark:bg-[#0c1b2c] !border-y !border-sky-300/50 dark:!border-sky-500/30' 
                          : activeJobs[ent.id] 
                            ? 'bg-sky-50/70 dark:bg-[#0f2030]' 
                            : 'bg-card'
                      }`}>
                        {statusInfo.type === 'active' && (
                          <div className="flex flex-col space-y-1 w-full max-w-[270px] ml-auto text-left">
                            <div className="flex items-start justify-between text-[10px] font-mono leading-tight gap-1">
                              <div className="flex items-start space-x-1.5 text-primary min-w-0 font-semibold flex-1">
                                <Loader2 className="w-3 h-3 animate-spin shrink-0 text-[#0284c7] dark:text-sky-400 mt-0.5" />
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span 
                                    className="whitespace-normal break-words text-[10px] text-foreground dark:text-slate-200 leading-tight" 
                                    title={`${statusInfo.progress?.mensagem || statusInfo.label} (${statusInfo.progress?.pct ?? 0}%) (A correr em segundo plano - pode fechar a janela livremente)`}
                                  >
                                    {statusInfo.progress?.mensagem || statusInfo.label}
                                  </span>
                                  {statusInfo.progress?.mes_ativo && !statusInfo.progress?.mensagem?.includes('Mês') && (
                                    <span className="inline-flex items-center text-[9px] font-mono font-bold text-sky-600 dark:text-sky-400 mt-0.5">
                                      A importar: {MESES_NOMES[statusInfo.progress.mes_ativo - 1]?.nome || `Mês ${statusInfo.progress.mes_ativo}`}
                                    </span>
                                  )}
                                  {statusInfo.progress?.fase && statusInfo.progress.fase !== 'faturas' && (
                                    <span className="text-[9px] font-mono text-sky-600 dark:text-sky-400 font-semibold mt-0.5">
                                      {statusInfo.progress.fase === 'nomes' 
                                        ? `Fase: Nomes (${statusInfo.progress.sub_atuais ?? 0}/${statusInfo.progress.sub_total ?? 0})`
                                        : statusInfo.progress.fase === 'gravacao'
                                        ? 'Fase: A gravar SQLite V4 + XML V3...'
                                        : statusInfo.progress.fase === 'anuladas'
                                        ? 'Fase: A verificar Anuladas...'
                                        : `Fase: ${statusInfo.progress.fase}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center space-x-1 shrink-0 pt-0.5">
                                <span className="text-[9.5px] font-mono tabular-nums text-[#0284c7] dark:text-sky-400 font-bold">
                                  {statusInfo.progress?.pct ?? 0}%
                                </span>
                                {statusInfo.jobId && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleStopJob(statusInfo.jobId!, ent.id, e)}
                                    className="ml-0.5 px-1.5 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-[9px] font-bold tracking-wider uppercase transition-colors flex items-center space-x-0.5 cursor-pointer shrink-0"
                                    title="Atenção: 'Parar' cancela esta extração. Se pretender que continue em segundo plano, basta fechar a janela sem clicar em Parar."
                                  >
                                    <Square className="w-2 h-2 fill-current" />
                                    <span>Parar</span>
                                  </button>
                                )}
                              </div>
                            </div>
                            {/* Barra de Progresso Real */}
                            <div className="w-full bg-slate-200 dark:bg-slate-700/60 h-2 rounded-full overflow-hidden p-0.5 border border-slate-300/40 dark:border-slate-600/40 shadow-inner">
                              <div 
                                className="h-full rounded-full bg-gradient-to-r from-[#0284c7] via-sky-400 to-sky-300 transition-all duration-300 shadow-xs"
                                style={{ width: `${Math.min(100, Math.max(statusInfo.progress?.pct ?? 0, 2))}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {statusInfo.type === 'partial' && (
                          <div 
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 shadow-2xs font-semibold ring-1 ring-amber-500/20 cursor-help whitespace-normal text-left"
                            title={`${statusInfo.detail}\nPasse o rato nas colunas para ver detalhes.`}
                          >
                            <AlertTriangle className="w-3 h-3 mr-1 shrink-0 text-amber-500" />
                            <span className="break-words leading-tight">{statusInfo.label}</span>
                          </div>
                        )}

                        {statusInfo.type === 'server_error' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`Instabilidade nos Servidores da AT:\n${statusInfo.detail}\n\nA senha está correta; pode tentar novamente.`}
                            >
                              <ServerCrash className="w-2.5 h-2.5 mr-1 shrink-0 text-amber-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleTentarNovamente(nifReal, ent.id, e)}
                              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[9.5px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
                              title="Tentar nova comunicação com a AT"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Tentar</span>
                            </button>
                          </div>
                        )}

                        {statusInfo.type === 'timeout' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`Tempo Limite Excedido:\n${statusInfo.detail}\n\nPode tentar novamente.`}
                            >
                              <Clock className="w-2.5 h-2.5 mr-1 shrink-0 text-amber-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleTentarNovamente(nifReal, ent.id, e)}
                              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[9.5px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
                              title="Tentar nova comunicação com a AT"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Tentar</span>
                            </button>
                          </div>
                        )}

                        {statusInfo.type === 'rate_limit' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`Limite de Chamadas Excedido:\n${statusInfo.detail}`}
                            >
                              <Clock className="w-2.5 h-2.5 mr-1 shrink-0 text-amber-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleTentarNovamente(nifReal, ent.id, e)}
                              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[9.5px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
                              title="Tentar novamente"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Tentar</span>
                            </button>
                          </div>
                        )}

                        {statusInfo.type === 'permission' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`Subutilizador sem perfil ativo no Portal das Finanças:\n${statusInfo.detail}`}
                            >
                              <ShieldAlert className="w-2.5 h-2.5 mr-1 shrink-0 text-orange-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                          </div>
                        )}

                        {statusInfo.type === 'timeout_2fa' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`2FA Pendente:\n${statusInfo.detail}\n\nA AT solicitou validação por SMS/Email que expirou. Pode tentar novamente.`}
                            >
                              <Key className="w-2.5 h-2.5 mr-1 shrink-0 text-amber-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleTentarNovamente(nifReal, ent.id, e)}
                              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[9.5px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
                              title="Tentar nova comunicação com a AT"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Tentar</span>
                            </button>
                          </div>
                        )}

                        {statusInfo.type === 'suspended' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={`Conta Suspensa pela AT:\n${statusInfo.detail}`}
                            >
                              <ShieldAlert className="w-2.5 h-2.5 mr-1 shrink-0 text-rose-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                          </div>
                        )}

                        {statusInfo.type === 'invalid_pass' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-mono border bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 shadow-2xs font-bold ring-1 ring-rose-500/20 cursor-help whitespace-normal"
                              title={`AT Rejeitou Autenticação:\n${statusInfo.detail}\n\nPode clicar em "Limpar" ao lado para remover o bloqueio e tentar novamente à mão.`}
                            >
                              <ShieldAlert className="w-3 h-3 mr-1 shrink-0 text-rose-500" />
                              <span className="break-words max-w-[160px] leading-tight">{statusInfo.label}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleResetSenhaInvalida(nifReal, ent.id, e)}
                              className="px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-[#0284c7] dark:text-sky-400 border border-sky-500/30 text-[9.5px] font-mono font-semibold transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
                              title="Limpar bloqueio de autenticação deste NIF e permitir nova tentativa à mão"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Limpar</span>
                            </button>
                          </div>
                        )}

                        {statusInfo.type === 'error' && (
                          <div className="flex items-center justify-end space-x-1.5 text-left">
                            <span 
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 shadow-2xs font-semibold cursor-help whitespace-normal"
                              title={statusInfo.detail || statusInfo.label}
                            >
                              <AlertCircle className="w-2.5 h-2.5 mr-1 shrink-0 text-rose-500" />
                              <span className="break-words max-w-[170px] leading-tight">{statusInfo.label}</span>
                            </span>
                            {(statusInfo.detail?.toLowerCase().includes('senha') || statusInfo.detail?.toLowerCase().includes('autentica') || statusInfo.detail?.toLowerCase().includes('bloque') || statusInfo.detail?.toLowerCase().includes('rejeit')) && (
                              <button
                                type="button"
                                onClick={(e) => handleResetSenhaInvalida(nifReal, ent.id, e)}
                                className="px-1.5 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-[#0284c7] dark:text-sky-400 border border-sky-500/30 text-[9px] font-mono font-medium transition-colors flex items-center space-x-0.5 cursor-pointer shrink-0"
                                title="Limpar bloqueio e tentar de novo"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                                <span>Limpar</span>
                              </button>
                            )}
                          </div>
                        )}

                        {statusInfo.type === 'success' && (
                          <span 
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 shadow-2xs font-semibold"
                            title={statusInfo.label}
                          >
                            <Check className="w-2.5 h-2.5 mr-1 shrink-0" />
                            <span>Concluída</span>
                          </span>
                        )}

                        {statusInfo.type === 'imported' && (
                          <span 
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 shadow-2xs"
                            title={statusInfo.detail}
                          >
                            <Check className="w-2.5 h-2.5 mr-1 shrink-0 opacity-70" />
                            <span>Sincronizado</span>
                          </span>
                        )}

                        {statusInfo.type === 'pending' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-mono text-muted-foreground/50 border border-border/40">
                            Pendente
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {entidadesFiltradasEOrdenadas.length === 0 && (
                  <tr>
                    <td colSpan={17} className="p-8 text-center text-muted-foreground font-mono text-sm">
                      Nenhuma empresa encontrada para a seleção atual.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Rodapé Resumo da Matriz (estilo evoGex.com de alta performance) */}
          <div className="sticky bottom-0 z-20 bg-muted/95 dark:bg-[#07121c] text-foreground font-mono text-xs border-t-2 border-border shadow-lg select-none px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center space-x-3 text-muted-foreground text-[11px]">
              <span className="font-semibold text-foreground">
                Total de Empresas: {entidadesFiltradasEOrdenadas.length}
              </span>
              <span>·</span>
              <span className="text-[#0284c7] dark:text-sky-400 font-semibold">
                {selectedIds.size} selecionadas
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="text-[10.5px] text-muted-foreground/80 font-normal hidden sm:inline">
                💡 <strong>Clique</strong> numa linha para selecionar/desmarcar
              </span>
            </div>
            <div className="flex items-center space-x-4 ml-auto">
              {mesesAtivos.size > 0 && mesesAtivos.size < 12 && (
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Docs Período ({Array.from(mesesAtivos).sort((a,b)=>a-b).map(m => MESES_NOMES[m-1]?.nome).join(', ')}):
                  </span>
                  <span className="font-bold text-[#0284c7] dark:text-sky-400 font-mono text-xs tabular-nums bg-sky-500/10 dark:bg-sky-500/15 px-2.5 py-0.5 rounded border border-sky-500/30 shadow-2xs">
                    {totalDocsPeriodo.toLocaleString('pt-PT')}
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total Docs ({ano}):
                </span>
                <span className="font-bold text-foreground font-mono text-xs tabular-nums bg-card px-2.5 py-0.5 rounded border border-border/80 shadow-2xs">
                  {totalGeralDocs.toLocaleString('pt-PT')}
                </span>
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* Painel Direito Encaixado: Assistente Guiado Passo a Passo */}
        <AssistenteImportacaoPanel
          aberto={assistenteAberto}
          onClose={fecharAssistente}
          moduloTitulo="e-Fatura"
          apiOnline={apiOnline}
          caminhoDados={caminhoDadosLocal}
          onCaminhoDadosChange={setCaminhoDadosLocal}
          tipoOperacao={tipoOperacao}
          onTipoOperacaoChange={op => setTipoOperacao(op === 'vendas' ? 'vendas' : 'compras')}
          empresas={entidades.map(e => ({
            id: e.id,
            cod: e.cod,
            nif: e.nif || e.nif_cc || '',
            nome: e.nomecli || e.nif || '',
          }))}
          selecionadasIds={selectedIds}
          onToggleEmpresa={toggleEntity}
          onSelecionarTodasEmpresas={() => setSelectedIds(new Set(entidades.map(e => e.id)))}
          onLimparEmpresas={() => setSelectedIds(new Set())}
          modoPrivacidade={modoPrivacidade}
          ano={ano}
          anoAtual={anoAtual}
          onAnoChange={novoAno => setAno(novoAno)}
          mesesSelecionados={meses}
          onToggleMes={toggleMes}
          onSelecionarAnoTodo={selecionarAnoCompleto}
          onSelecionarMesAtual={selecionarMesAtual}
          onSelecionarTrimestre={selecionarTrimestre}
          isSyncing={isSyncing}
          labelBotaoIniciar={reimportarTudo ? `Reimportar ${tipoOperacao === 'compras' ? 'Compras' : 'Vendas'} (${selectedIds.size})` : `Iniciar Importação (${selectedIds.size})`}
          onIniciarImportacao={handleSync}
          passoAtivo={passoAssistente}
          onPassoAtivoChange={setPassoAssistente}
          opcoesExtras={
            <div className="space-y-2 text-xs font-mono">
              <label className="flex items-start space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reimportarTudo}
                  onChange={e => setReimportarTudo(e.target.checked)}
                  className="mt-0.5 rounded accent-rose-600 cursor-pointer"
                />
                <span>
                  <strong className="block font-sans text-foreground">Reimportação Forçada (Wipe)</strong>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">Substitui registos do período na base central.</span>
                </span>
              </label>
              <label className="flex items-start space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gerarXmlLegado}
                  onChange={e => toggleGerarXmlLegado(e.target.checked)}
                  className="mt-0.5 rounded accent-emerald-600 cursor-pointer"
                />
                <span>
                  <strong className="block font-sans text-foreground">Alimentar Excel Apps (XML V3)</strong>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">Mantém os XML legados sincronizados para Excel.</span>
                </span>
              </label>
            </div>
          }
        />

      </div>

      {/* Toast Flutuante de Estado do Login no Navegador */}
      {loginStatusMsg && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className={`flex items-center space-x-2.5 px-4 py-3 rounded-lg border shadow-xl backdrop-blur-md text-xs font-mono ${
            loginStatusMsg.tipo === 'sucesso'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200'
              : loginStatusMsg.tipo === 'erro'
                ? 'bg-destructive/15 border-destructive/40 text-destructive dark:text-red-300'
                : 'bg-sky-500/15 border-sky-500/40 text-sky-800 dark:text-sky-200'
          }`}>
            {loginStatusMsg.tipo === 'info' && <Loader2 className="w-4 h-4 animate-spin shrink-0 text-sky-500" />}
            {loginStatusMsg.tipo === 'sucesso' && <Check className="w-4 h-4 shrink-0 text-emerald-500" />}
            {loginStatusMsg.tipo === 'erro' && <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />}
            <span className="flex-1 font-medium">{loginStatusMsg.texto}</span>
            <button 
              type="button" 
              onClick={() => setLoginStatusMsg(null)}
              className="opacity-60 hover:opacity-100 p-0.5 ml-2 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {/* Menu de Contexto para Ações Rápidas de Linha e Mês */}
      {contextMenu && (
        <div 
          className="fixed z-50 min-w-[250px] bg-white dark:bg-[#0c1520] text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-[#222f3e] rounded-lg shadow-2xl py-1 text-xs font-mono animate-in fade-in zoom-in-95 duration-100"
          style={{ 
            top: Math.min(contextMenu.y, window.innerHeight - 250), 
            left: Math.min(contextMenu.x, window.innerWidth - 270) 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-slate-200 dark:border-[#222f3e] text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center justify-between bg-slate-100 dark:bg-[#111e2e]">
            <span className="truncate max-w-[150px]">{contextMenu.entidade.nomecli}</span>
            <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono ml-2 shrink-0">{contextMenu.entidade.nif || contextMenu.entidade.nif_cc}</span>
          </div>

          {contextMenu.mes ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const mAlvo = contextMenu.mes || 1;
                  const dIniMes = `${ano}-${String(mAlvo).padStart(2, '0')}-01`;
                  const dFimMes = (ano === anoAtual && mAlvo === mesAtual)
                    ? `${ano}-${String(mAlvo).padStart(2, '0')}-${String(diaAtual).padStart(2, '0')}`
                    : `${ano}-${String(mAlvo).padStart(2, '0')}-${String(new Date(ano, mAlvo, 0).getDate()).padStart(2, '0')}`;
                  iniciarExtracaoParaEntidade(contextMenu.entidade, {
                    forcarScraper: true,
                    dataIni: dIniMes,
                    dataFim: dFimMes,
                  });
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-[#13263a] text-[#0284c7] dark:text-sky-300 font-semibold flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>Importar {MESES_NOMES[(contextMenu.mes || 1) - 1]?.nome} pelo Portal Web</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onNavegarParaDados?.((contextMenu.entidade.nif || contextMenu.entidade.nif_cc || '').trim(), ano, contextMenu.mes, tipoOperacao);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-[#162436] text-slate-800 dark:text-slate-200 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Ver faturas de {MESES_NOMES[(contextMenu.mes || 1) - 1]?.nome} ({contextMenu.docs || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  abrirModalLimpeza(contextMenu.entidade, ano, contextMenu.mes);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-[#290f14] text-rose-700 dark:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Limpar dados de {MESES_NOMES[(contextMenu.mes || 1) - 1]?.nome} {ano}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  abrirModalLimpeza(contextMenu.entidade, ano, undefined);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-[#290f14] text-rose-700 dark:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Limpar todo o ano de {ano}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  iniciarExtracaoParaEntidade(contextMenu.entidade, { forcarScraper: true });
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-[#13263a] text-[#0284c7] dark:text-sky-300 font-semibold flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>Importar pelo Portal Web</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onNavegarParaDados?.((contextMenu.entidade.nif || contextMenu.entidade.nif_cc || '').trim(), ano, undefined, tipoOperacao);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-[#162436] text-slate-800 dark:text-slate-200 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>Ver todas as faturas de {ano} ({contextMenu.totalAno || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  abrirModalLimpeza(contextMenu.entidade, ano, undefined);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-[#290f14] text-rose-700 dark:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Limpar todo o ano de {ano}</span>
              </button>
            </>
          )}

          <div className="border-t border-border my-1" />

          <button
            type="button"
            onClick={() => {
              abrirModalLimpeza(contextMenu.entidade, ano);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center space-x-2 transition-colors cursor-pointer text-[11px]"
          >
            <SlidersHorizontal className="w-3 h-3 shrink-0" />
            <span>Opções avançadas de limpeza...</span>
          </button>
        </div>
      )}

      {/* Modal de Limpeza Seletiva de Dados (Mês a Mês ou Ano a Ano) */}
      {limpezaModal.isOpen && limpezaModal.entidade && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => {
            if (!limpezaModal.executando) setLimpezaModal(prev => ({ ...prev, isOpen: false }));
          }}
        >
          <div 
            className="w-full max-w-lg bg-card text-card-foreground border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col font-mono animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header com assinatura EVO */}
            <div className="relative evo-card-signature px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30 before:content-[''] before:absolute before:left-0 before:top-2.5 before:h-5 before:w-0.5 before:bg-rose-500">
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4 text-rose-500" />
                <h3 className="font-sans font-semibold text-sm text-foreground">
                  Limpeza Seletiva de Dados da Empresa
                </h3>
              </div>
              <button
                type="button"
                disabled={limpezaModal.executando}
                onClick={() => setLimpezaModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Corpo do Modal */}
            <div className="p-4 space-y-4 text-xs">
              {/* Identificação da Empresa */}
              <div className="p-3 rounded-md bg-muted/40 border border-border flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground text-sm font-sans">
                    {limpezaModal.entidade.nomecli}
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    NIF: <span className="font-mono font-bold text-foreground">{limpezaModal.entidade.nif || limpezaModal.entidade.nif_cc}</span>
                  </div>
                </div>
                <div className="text-right font-mono text-[11px] text-muted-foreground">
                  <div>Ano Ativo</div>
                  <div className="font-bold text-foreground text-sm">{limpezaModal.ano}</div>
                </div>
              </div>

              {/* Seletor de Tipo (Módulo Fiscal) */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Módulo Fiscal a Limpar
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['compras', 'vendas', 'ambos'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      disabled={limpezaModal.executando}
                      onClick={() => setLimpezaModal(prev => ({ ...prev, tipo: t }))}
                      className={`py-1.5 px-2 rounded border text-center transition-all cursor-pointer font-semibold ${
                        limpezaModal.tipo === t
                          ? 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
                          : 'bg-card border-border hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {t === 'compras' ? 'Compras' : t === 'vendas' ? 'Vendas' : 'Ambos'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Seletor de Âmbito / Escopo */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Âmbito da Limpeza
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={limpezaModal.executando}
                    onClick={() => setLimpezaModal(prev => ({ ...prev, escopo: 'mes' }))}
                    className={`py-1.5 px-2 rounded border text-center transition-all cursor-pointer font-semibold ${
                      limpezaModal.escopo === 'mes'
                        ? 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
                        : 'bg-card border-border hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Mês Específico
                  </button>
                  <button
                    type="button"
                    disabled={limpezaModal.executando}
                    onClick={() => setLimpezaModal(prev => ({ ...prev, escopo: 'ano' }))}
                    className={`py-1.5 px-2 rounded border text-center transition-all cursor-pointer font-semibold ${
                      limpezaModal.escopo === 'ano'
                        ? 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
                        : 'bg-card border-border hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Ano Completo ({limpezaModal.ano})
                  </button>
                  <button
                    type="button"
                    disabled={limpezaModal.executando}
                    onClick={() => setLimpezaModal(prev => ({ ...prev, escopo: 'tudo' }))}
                    className={`py-1.5 px-2 rounded border text-center transition-all cursor-pointer font-semibold ${
                      limpezaModal.escopo === 'tudo'
                        ? 'bg-rose-500/15 border-rose-500/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
                        : 'bg-card border-border hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Todo o Histórico
                  </button>
                </div>
              </div>

              {/* Se o escopo for Mês: Grade dos 12 meses com contagens reais */}
              {limpezaModal.escopo === 'mes' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Selecione o Mês de {limpezaModal.ano}
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      Clique no mês para selecionar
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {MESES_NOMES.map(m => {
                      const nifReal = (limpezaModal.entidade?.nif || limpezaModal.entidade?.nif_cc || '').trim();
                      const docsMes = matriz[nifReal]?.meses?.[m.num]?.docs || 0;
                      const isSel = limpezaModal.mes === m.num;

                      return (
                        <button
                          key={m.num}
                          type="button"
                          disabled={limpezaModal.executando}
                          onClick={() => setLimpezaModal(prev => ({ ...prev, mes: m.num }))}
                          className={`p-1.5 rounded border text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                            isSel
                              ? 'bg-rose-500 text-white border-rose-600 shadow-sm font-bold'
                              : docsMes > 0
                                ? 'bg-muted/60 hover:bg-muted text-foreground border-border'
                                : 'bg-card hover:bg-muted/40 text-muted-foreground border-border/50 opacity-60'
                          }`}
                        >
                          <span className="text-[11px]">{m.nome}</span>
                          <span className={`text-[9.5px] tabular-nums ${isSel ? 'text-white' : docsMes > 0 ? 'text-[#0284c7] dark:text-sky-400 font-semibold' : 'text-muted-foreground/60'}`}>
                            {docsMes > 0 ? `${docsMes}` : '-'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Aviso / Resumo do que será limpo */}
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] leading-relaxed flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Atenção:</strong> Serão apagadas todas as faturas e linhas de{' '}
                  <span className="font-semibold underline">
                    {limpezaModal.tipo === 'ambos' ? 'Compras e Vendas' : limpezaModal.tipo === 'compras' ? 'Compras' : 'Vendas'}
                  </span>{' '}
                  {limpezaModal.escopo === 'mes' && (
                    <>referentes a <strong>{MESES_NOMES[(limpezaModal.mes || 1) - 1]?.full} de {limpezaModal.ano}</strong>.</>
                  )}
                  {limpezaModal.escopo === 'ano' && (
                    <>referentes a todo o ano de <strong>{limpezaModal.ano}</strong> (todos os meses).</>
                  )}
                  {limpezaModal.escopo === 'tudo' && (
                    <>de <strong>todos os anos e exercícios</strong> desta empresa.</>
                  )}
                  <br />
                  A respetiva contagem na matriz será reposta a zero e os ficheiros de staging eliminados.
                </div>
              </div>

              {/* Feedback de Resultado */}
              {limpezaModal.resultado && (
                <div className={`p-3 rounded-md border text-xs flex items-center space-x-2 ${
                  limpezaModal.resultado.status === 'sucesso'
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                    : 'bg-destructive/15 border-destructive/40 text-destructive'
                }`}>
                  {limpezaModal.resultado.status === 'sucesso' ? (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                  )}
                  <span>{limpezaModal.resultado.mensagem}</span>
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="px-4 py-3 bg-muted/30 border-t border-border flex items-center justify-between">
              <button
                type="button"
                disabled={limpezaModal.executando}
                onClick={() => setLimpezaModal(prev => ({ ...prev, isOpen: false }))}
                className="px-3 py-1.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-mono transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={limpezaModal.executando}
                onClick={executarLimpezaModal}
                className="px-4 py-1.5 rounded bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-mono font-semibold transition-all shadow-sm cursor-pointer flex items-center space-x-1.5"
              >
                {limpezaModal.executando ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>A eliminar da Base de Dados...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {limpezaModal.escopo === 'mes'
                        ? `Eliminar Mês (${MESES_NOMES[(limpezaModal.mes || 1) - 1]?.nome} ${limpezaModal.ano})`
                        : limpezaModal.escopo === 'ano'
                          ? `Eliminar Todo o Ano ${limpezaModal.ano}`
                          : `Eliminar Todo o Histórico`}
                    </span>
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
