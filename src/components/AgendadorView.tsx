import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, 
  Clock, 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  Edit3, 
  History, 
  AlertTriangle, 
  RefreshCw, 
  Search, 
  X, 
  Check, 
  Building2, 
  Layers, 
  Zap, 
  TrendingUp,
  ShoppingCart,
  Timer,
  ShieldAlert
} from 'lucide-react';

export interface Agendamento {
  id: string;
  nome: string;
  nifs: string[];
  ano: number;
  meses: number[];
  tipo: 'compras' | 'vendas' | 'ambos';
  recorrencia: 'diaria' | 'semanal' | 'mensal' | 'unica';
  hora: string;
  dias_semana: string;
  dia_mes: number;
  politica_atraso: 'auto_catchup' | 'perguntar' | 'skip';
  ativo: number;
  proxima_execucao: string;
  ultima_execucao: string;
  ultimo_status: string;
  ultimo_resultado?: any;
  created_at: string;
  updated_at: string;
  em_execucao?: boolean;
  progresso_vivo?: {
    status: string;
    nome: string;
    nif_atual: string;
    empresa_atual: string;
    mes_atual: number | null;
    ano: number;
    tipo: string;
    tipo_atual?: string;
    total_empresas: number;
    empresas_concluidas: number;
    docs_obtidos: number;
    iniciado_em: string;
  } | null;
}

export interface LogAgendamento {
  id: string;
  agendamento_id: string;
  nome_tarefa: string;
  ano: number;
  tipo: string;
  total_empresas: number;
  total_docs_obtidos: number;
  status: string;
  mensagem: string;
  detalhes: any;
  iniciado_em: string;
  terminado_em: string;
  duracao_segundos: number;
}

interface EntidadeSimples {
  id: string;
  nif: string;
  nomecli: string;
}

interface AgendadorViewProps {
  onApiStatusChange?: (online: boolean) => void;
  modoPrivacidade?: boolean;
}

const DIAS_SEMANA_OPCOES = [
  { id: 'seg', label: 'Seg' },
  { id: 'ter', label: 'Ter' },
  { id: 'qua', label: 'Qua' },
  { id: 'qui', label: 'Qui' },
  { id: 'sex', label: 'Sex' },
  { id: 'sab', label: 'Sáb' },
  { id: 'dom', label: 'Dom' },
];

const MESES_NOMES = [
  { num: 1, label: 'Jan' },
  { num: 2, label: 'Fev' },
  { num: 3, label: 'Mar' },
  { num: 4, label: 'Abr' },
  { num: 5, label: 'Mai' },
  { num: 6, label: 'Jun' },
  { num: 7, label: 'Jul' },
  { num: 8, label: 'Ago' },
  { num: 9, label: 'Set' },
  { num: 10, label: 'Out' },
  { num: 11, label: 'Nov' },
  { num: 12, label: 'Dez' },
];

function mascararTexto(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

function formatarProximaExecucao(proxIso: string): string {
  if (!proxIso) return 'Não agendada';
  try {
    const dt = new Date(proxIso.replace(' ', 'T'));
    const hoje = new Date();
    const amanha = new Date();
    amanha.setDate(hoje.getDate() + 1);

    const horaFormatada = dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    
    if (dt.toDateString() === hoje.toDateString()) {
      return `Hoje às ${horaFormatada}`;
    } else if (dt.toDateString() === amanha.toDateString()) {
      return `Amanhã às ${horaFormatada}`;
    } else {
      const dataFormatada = dt.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
      return `${dataFormatada} às ${horaFormatada}`;
    }
  } catch {
    return proxIso;
  }
}

export function AgendadorView({ onApiStatusChange, modoPrivacidade = false }: AgendadorViewProps) {
  const [tarefas, setTarefas] = useState<Agendamento[]>([]);
  const [pendentes, setPendentes] = useState<Agendamento[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [termoPesquisa, setTermoPesquisa] = useState<string>('');
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  // Entidades carregadas do PocketBase para seleção customizada
  const [entidades, setEntidades] = useState<EntidadeSimples[]>([]);

  // Modais
  const [modalFormAberto, setModalFormAberto] = useState<boolean>(false);
  const [tarefaEmEdicao, setTarefaEmEdicao] = useState<Agendamento | null>(null);
  
  const [modalLogsAberto, setModalLogsAberto] = useState<boolean>(false);
  const [tarefaLogs, setTarefaLogs] = useState<Agendamento | null>(null);
  const [logs, setLogs] = useState<LogAgendamento[]>([]);
  const [carregandoLogs, setCarregandoLogs] = useState<boolean>(false);

  // Form State
  const [formNome, setFormNome] = useState<string>('Sincronização Anual e-Fatura');
  const [formModoEntidades, setFormModoEntidades] = useState<'todas' | 'selecao'>('todas');
  const [formNifs, setFormNifs] = useState<string[]>([]);
  const [formPesquisaEntidade, setFormPesquisaEntidade] = useState<string>('');
  const [formAno, setFormAno] = useState<number>(new Date().getFullYear());
  const [formMeses, setFormMeses] = useState<number[]>(Array.from({ length: 12 }, (_, i) => i + 1));
  const [formTipo, setFormTipo] = useState<'compras' | 'vendas' | 'ambos'>('ambos');
  const [formRecorrencia, setFormRecorrencia] = useState<'diaria' | 'semanal' | 'mensal' | 'unica'>('diaria');
  const [formHora, setFormHora] = useState<string>('03:00');
  const [formDiasSemana, setFormDiasSemana] = useState<string[]>(['seg', 'qua', 'sex']);
  const [formDiaMes, setFormDiaMes] = useState<number>(1);
  const [formPoliticaAtraso, setFormPoliticaAtraso] = useState<'auto_catchup' | 'perguntar' | 'skip'>('auto_catchup');

  // Carregar dados da API e Entidades
  const carregarDados = useCallback(async () => {
    try {
      const [resTarefas, resPendentes] = await Promise.all([
        fetch('http://127.0.0.1:8015/api/agendador/tarefas'),
        fetch('http://127.0.0.1:8015/api/agendador/tarefas/pendentes'),
      ]);

      if (resTarefas.ok) {
        const data = await resTarefas.json();
        setTarefas(data.tarefas || []);
        onApiStatusChange?.(true);
      }
      if (resPendentes.ok) {
        const dataPend = await resPendentes.json();
        setPendentes(dataPend.pendentes || []);
      }
    } catch {
      onApiStatusChange?.(false);
    } finally {
      setCarregando(false);
    }
  }, [onApiStatusChange]);

  useEffect(() => {
    carregarDados();
    const temAtiva = tarefas.some(t => t.em_execucao || t.ultimo_status === 'em_execucao' || !!t.progresso_vivo);
    const ms = temAtiva ? 2000 : 5000;
    const interval = setInterval(carregarDados, ms);
    return () => clearInterval(interval);
  }, [carregarDados, tarefas]);

  // Carregar lista de entidades a partir da API (via tCredenciais.xml / legado_bridge)
  useEffect(() => {
    async function carregarEntidades() {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/entidades");
        if (res.ok) {
          const data = await res.json();
          if (data.entidades) {
            setEntidades(data.entidades.map((r: any) => ({
              id: r.id,
              nif: r.nif || r.nif_cc || '',
              nomecli: r.nomecli || 'Sem Nome'
            })).filter((e: any) => !!e.nif));
          }
        }
      } catch {
        // Ignora se API ainda indisponível
      }
    }
    carregarEntidades();
  }, []);

  // Abrir Modal de Criação
  const handleNovoAgendamento = () => {
    setTarefaEmEdicao(null);
    setFormNome('Sincronização Anual Automática');
    setFormModoEntidades('todas');
    setFormNifs([]);
    setFormAno(new Date().getFullYear());
    setFormMeses(Array.from({ length: 12 }, (_, i) => i + 1));
    setFormTipo('ambos');
    setFormRecorrencia('diaria');
    setFormHora('03:00');
    setFormDiasSemana(['seg', 'qua', 'sex']);
    setFormDiaMes(1);
    setFormPoliticaAtraso('auto_catchup');
    setModalFormAberto(true);
  };

  // Abrir Modal de Edição
  const handleEditarTarefa = (t: Agendamento) => {
    setTarefaEmEdicao(t);
    setFormNome(t.nome);
    const nifsLista = Array.isArray(t.nifs) ? t.nifs : [];
    if (nifsLista.includes('TODOS') || nifsLista.length === 0) {
      setFormModoEntidades('todas');
      setFormNifs([]);
    } else {
      setFormModoEntidades('selecao');
      setFormNifs(nifsLista);
    }
    setFormAno(t.ano || new Date().getFullYear());
    setFormMeses(Array.isArray(t.meses) && t.meses.length > 0 ? t.meses : Array.from({ length: 12 }, (_, i) => i + 1));
    setFormTipo(t.tipo || 'ambos');
    setFormRecorrencia(t.recorrencia || 'diaria');
    setFormHora(t.hora || '03:00');
    setFormDiasSemana(t.dias_semana ? t.dias_semana.split(',').filter(Boolean) : ['seg']);
    setFormDiaMes(t.dia_mes || 1);
    setFormPoliticaAtraso(t.politica_atraso || 'auto_catchup');
    setModalFormAberto(true);
  };

  // Gravar / Atualizar Tarefa
  const handleSubmeterForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNome.trim()) {
      alert('Por favor introduza um nome para o agendamento.');
      return;
    }
    if (formModoEntidades === 'selecao' && formNifs.length === 0) {
      alert('Por favor selecione pelo menos uma empresa ou escolha a opção "Todas as entidades".');
      return;
    }
    if (formMeses.length === 0) {
      alert('Por favor selecione pelo menos um mês fiscal.');
      return;
    }

    const payload = {
      nome: formNome.trim(),
      nifs: formModoEntidades === 'todas' ? ['TODOS'] : formNifs,
      ano: formAno,
      meses: formMeses,
      tipo: formTipo,
      recorrencia: formRecorrencia,
      hora: formHora,
      dias_semana: formDiasSemana.join(','),
      dia_mes: formDiaMes,
      politica_atraso: formPoliticaAtraso,
      ativo: tarefaEmEdicao ? tarefaEmEdicao.ativo === 1 : true
    };

    setAcaoEmCurso('A gravar agendamento...');
    try {
      if (tarefaEmEdicao) {
        const res = await fetch(`http://127.0.0.1:8015/api/agendador/tarefas/${tarefaEmEdicao.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.detail || errData?.message || 'Falha ao atualizar tarefa.');
        }
      } else {
        const res = await fetch('http://127.0.0.1:8015/api/agendador/tarefas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.detail || errData?.message || 'Falha ao criar tarefa.');
        }
      }
      setModalFormAberto(false);
      await carregarDados();
    } catch (err: any) {
      alert(err.message || 'Erro ao gravar agendamento.');
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Toggle Ativo/Pausado
  const handleToggle = async (t: Agendamento) => {
    setAcaoEmCurso(`A alterar estado da tarefa ${t.nome}...`);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/agendador/tarefas/${t.id}/toggle`, {
        method: 'POST'
      });
      if (res.ok) {
        await carregarDados();
      }
    } catch {
      alert('Falha ao alternar estado da tarefa.');
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Disparar Execução Imediata
  const handleExecutarAgora = async (t: Agendamento) => {
    const confirmacao = window.confirm(
      `Deseja disparar a execução imediata da tarefa "${t.nome}" em segundo plano?\n\n` +
      `O processo será executado de forma autónoma sem bloquear a interface.`
    );
    if (!confirmacao) return;

    setAcaoEmCurso(`A iniciar tarefa ${t.nome}...`);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/agendador/tarefas/${t.id}/executar`, {
        method: 'POST'
      });
      if (res.ok) {
        await carregarDados();
      } else {
        const err = await res.json();
        alert(err.detail || 'Não foi possível iniciar a tarefa.');
      }
    } catch {
      alert('Erro de comunicação com a API.');
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Eliminar Tarefa
  const handleEliminar = async (t: Agendamento) => {
    const confirmacao = window.confirm(
      `Tem a certeza de que deseja eliminar o agendamento "${t.nome}" e todo o seu histórico?\n\nEsta ação não pode ser desfeita.`
    );
    if (!confirmacao) return;

    setAcaoEmCurso(`A eliminar tarefa...`);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/agendador/tarefas/${t.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await carregarDados();
      }
    } catch {
      alert('Erro ao eliminar tarefa.');
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Resolver Atraso Pendente (Perguntar)
  const handleResolverAtraso = async (t: Agendamento, acao: 'executar' | 'saltar') => {
    setAcaoEmCurso(`A processar resolução de atraso...`);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/agendador/tarefas/${t.id}/confirmar-atraso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao })
      });
      if (res.ok) {
        await carregarDados();
      }
    } catch {
      alert('Falha ao processar resolução de atraso.');
    } finally {
      setAcaoEmCurso(null);
    }
  };

  // Abrir Histórico de Logs
  const handleAbrirLogs = async (t?: Agendamento) => {
    setTarefaLogs(t || null);
    setModalLogsAberto(true);
    setCarregandoLogs(true);
    try {
      const url = t 
        ? `http://127.0.0.1:8015/api/agendador/logs?agendamento_id=${t.id}&limite=50` 
        : `http://127.0.0.1:8015/api/agendador/logs?limite=100`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch {
      // Ignora erro
    } finally {
      setCarregandoLogs(false);
    }
  };

  // Métricas de Topo
  const metricas = useMemo(() => {
    const ativas = tarefas.filter(t => t.ativo === 1).length;
    let proximaMaisCedo: Agendamento | null = null;
    let totalDocsProcessados = 0;

    for (const t of tarefas) {
      if (t.ativo === 1 && t.proxima_execucao) {
        if (!proximaMaisCedo || t.proxima_execucao < proximaMaisCedo.proxima_execucao) {
          proximaMaisCedo = t;
        }
      }
      if (t.ultimo_resultado && typeof t.ultimo_resultado === 'object' && t.ultimo_resultado.total_docs) {
        totalDocsProcessados += Number(t.ultimo_resultado.total_docs) || 0;
      }
    }

    return {
      total: tarefas.length,
      ativas,
      pendentesAutorizacao: pendentes.length,
      proximaData: proximaMaisCedo?.proxima_execucao || '',
      totalDocs: totalDocsProcessados
    };
  }, [tarefas, pendentes]);

  // Filtragem de Tarefas
  const tarefasFiltradas = useMemo(() => {
    if (!termoPesquisa.trim()) return tarefas;
    const q = termoPesquisa.toLowerCase();
    return tarefas.filter(t => 
      t.nome.toLowerCase().includes(q) || 
      t.recorrencia.toLowerCase().includes(q) ||
      t.tipo.toLowerCase().includes(q)
    );
  }, [tarefas, termoPesquisa]);

  // Lista filtrada de entidades no modal
  const entidadesFiltradas = useMemo(() => {
    if (!formPesquisaEntidade.trim()) return entidades;
    const q = formPesquisaEntidade.toLowerCase();
    return entidades.filter(e => e.nomecli.toLowerCase().includes(q) || e.nif.includes(q));
  }, [entidades, formPesquisaEntidade]);

  return (
    <div className="h-full flex flex-col space-y-3 min-h-0 select-none">
      
      {/* 1. Cabeçalho Oficial Gexcel EVO */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Automatização Contínua · Motor Autónomo V4
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center space-x-2">
            <span>Agendador de Tarefas em Segundo Plano</span>
          </h1>
          <p className="page-description text-muted-foreground text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Programe varreduras automáticas de anos inteiros com gestão resiliente de computadores desligados (Catch-Up).
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => handleAbrirLogs()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-muted text-xs font-mono text-muted-foreground hover:text-foreground transition-colors shadow-2xs cursor-pointer"
            title="Ver histórico global de auditoria"
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico de Logs</span>
          </button>

          <button
            onClick={carregarDados}
            disabled={carregando}
            className="p-1.5 rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shadow-2xs cursor-pointer"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin text-primary' : ''}`} />
          </button>

          <button
            onClick={handleNovoAgendamento}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-medium shadow-2xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Agendamento</span>
          </button>
        </div>
      </header>

      {/* 2. Banner de Tarefas com Atraso por PC Desligado (Misfire / Catch-Up) */}
      {pendentes.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-md p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-amber-500 dark:text-amber-400 shrink-0">
          <div className="flex items-start space-x-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="font-display font-medium text-xs tracking-tight text-foreground dark:text-amber-300">
                  Tarefas com Execução em Atraso ({pendentes.length})
                </h4>
                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 uppercase">
                  PC Desligado
                </span>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                O computador esteve desligado durante o horário previsto para as seguintes programações:
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {pendentes.map(p => (
                  <span key={p.id} className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-white/70 dark:bg-[#0c1520] border border-amber-500/40 rounded text-[10.5px] font-mono text-foreground">
                    <span className="font-semibold">{p.nome}</span>
                    <span className="text-muted-foreground text-[10px]">({p.proxima_execucao})</span>
                    <button
                      onClick={() => handleResolverAtraso(p, 'executar')}
                      className="ml-1 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      title="Executar agora em segundo plano"
                    >
                      ▶ Executar
                    </button>
                    <span className="text-muted-foreground">|</span>
                    <button
                      onClick={() => handleResolverAtraso(p, 'saltar')}
                      className="text-[10.5px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                      title="Saltar para o próximo agendamento"
                    >
                      Saltar
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Ribbon de Cards KPIs Estruturados no Padrão Oficial EVO (100% Opacos com Assinatura Lateral) */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
        
        {/* Card 1: Agendamentos Ativos */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7] dark:bg-sky-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Agendamentos Ativos</span>
            </div>
            <Calendar className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <div className="flex items-baseline space-x-1.5">
              <span className="text-base font-mono font-bold text-foreground tabular-nums">{metricas.ativas}</span>
              <span className="text-[10px] font-mono text-muted-foreground">/ {metricas.total} totais</span>
            </div>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-sky-500/10 text-[#0284c7] dark:text-sky-400 border border-sky-500/20">
              Tarefas
            </span>
          </div>
        </div>

        {/* Card 2: Próxima Execução */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Próxima Execução</span>
            </div>
            <Clock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-foreground truncate max-w-[150px]">
              {metricas.proximaData ? formatarProximaExecucao(metricas.proximaData) : 'Nenhuma'}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shrink-0">
              Auto Engine
            </span>
          </div>
        </div>

        {/* Card 3: Resiliência de Atrasos */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${metricas.pendentesAutorizacao > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="text-foreground dark:text-slate-200 font-semibold">Resiliência de Atrasos</span>
            </div>
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className={`text-base font-mono font-bold tabular-nums ${metricas.pendentesAutorizacao > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
              {metricas.pendentesAutorizacao > 0 ? `${metricas.pendentesAutorizacao} Pendente` : '100% OK'}
            </span>
            <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded border ${
              metricas.pendentesAutorizacao > 0 
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
            }`}>
              {metricas.pendentesAutorizacao > 0 ? 'Catch-Up' : 'Sem Atrasos'}
            </span>
          </div>
        </div>

        {/* Card 4: Docs Sincronizados */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-2 space-y-1.5 shadow-2xs text-foreground flex flex-col justify-between overflow-hidden before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="px-1 pt-0.5 pb-1 flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] text-[9.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground dark:text-slate-300 select-none">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              <span className="text-foreground dark:text-slate-200 font-semibold">Docs Sincronizados</span>
            </div>
            <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 opacity-80" />
          </div>
          <div className="px-2.5 py-1.5 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded flex items-center justify-between">
            <span className="text-base font-mono font-bold text-foreground tabular-nums">
              {metricas.totalDocs.toLocaleString('pt-PT')}
            </span>
            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Background
            </span>
          </div>
        </div>

      </div>

      {/* 4. Lista Principal de Agendamentos (Card Principal Canónico EVO com Assinatura Lateral) */}
      <div className="overflow-hidden rounded-md border border-border shadow-xs flex flex-col flex-1 min-h-0 bg-card text-card-foreground">
        
        {/* Cabeçalho do Card da Tabela com Assinatura Canónica EVO (before:h-5 before:w-0.5) */}
        <div className="relative evo-card-signature flex flex-wrap justify-between items-center border-b border-border/80 px-4 py-2 bg-card text-card-foreground gap-3 shrink-0 select-none before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded bg-muted dark:bg-[#132233] border border-border/80 dark:border-[#253a52] text-foreground shrink-0">
              <Calendar className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-xs text-foreground truncate">
                Programações Ativas
              </span>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                {tarefasFiltradas.length} {tarefasFiltradas.length === 1 ? 'Agendamento' : 'Agendamentos'}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar tarefas..."
                value={termoPesquisa}
                onChange={e => setTermoPesquisa(e.target.value)}
                className="pl-8 pr-3 py-1 bg-white/70 dark:bg-[#0c1520] border border-slate-200 dark:border-[#1c2e42] rounded text-xs font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary w-48 text-foreground"
              />
            </div>
          </div>
        </div>

        {/* Conteúdo com Scroll Próprio */}
        <div className="p-0 flex-1 overflow-y-auto">
          {carregando && tarefas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs font-mono">A carregar agendamentos...</span>
            </div>
          ) : tarefasFiltradas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-md bg-muted/60 flex items-center justify-center text-muted-foreground border border-border">
                <Calendar className="w-6 h-6 text-primary/70" />
              </div>
              <div className="max-w-sm">
                <h4 className="font-display font-medium text-sm text-foreground">
                  Nenhum agendamento configurado
                </h4>
                <p className="text-xs font-mono text-muted-foreground mt-1">
                  Crie a sua primeira programação para descarregar automaticamente faturas de um ano inteiro em segundo plano.
                </p>
              </div>
              <button
                onClick={handleNovoAgendamento}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-mono hover:bg-primary/90 cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Criar Primeiro Agendamento</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {tarefasFiltradas.map((t) => {
                const isAtivo = t.ativo === 1;
                const isRunning = t.ultimo_status === 'em_execucao';
                const nifsLista = Array.isArray(t.nifs) ? t.nifs : [];
                const isTodas = nifsLista.includes('TODOS') || nifsLista.length === 0;

                return (
                  <div
                    key={t.id}
                    className={`p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                      isAtivo ? 'hover:bg-muted/30' : 'opacity-65 hover:opacity-85 bg-muted/10'
                    }`}
                  >
                    {/* Informações da Tarefa */}
                    <div className="flex items-start space-x-3 min-w-0">
                      <button
                        onClick={() => handleToggle(t)}
                        title={isAtivo ? "Clique para pausar esta tarefa" : "Clique para ativar esta tarefa"}
                        className={`w-8 h-8 rounded flex items-center justify-center shrink-0 border transition-all mt-0.5 cursor-pointer ${
                          isRunning
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 animate-pulse'
                            : isAtivo
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {isRunning ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : isAtivo ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 ml-0.5" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-display font-medium text-xs text-foreground truncate">
                            {t.nome}
                          </h3>

                          {/* Badge de Tipo */}
                          <span className={`inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[9.5px] font-mono uppercase font-semibold ${
                            t.tipo === 'compras'
                              ? 'bg-sky-500/15 text-[#0284c7] dark:text-sky-400 border border-sky-500/30'
                              : t.tipo === 'vendas'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                              : 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                          }`}>
                            {t.tipo === 'compras' ? <ShoppingCart className="w-2.5 h-2.5" /> : t.tipo === 'vendas' ? <TrendingUp className="w-2.5 h-2.5" /> : <Layers className="w-2.5 h-2.5" />}
                            <span>{t.tipo}</span>
                          </span>

                          {/* Badge de Ativo / Pausado */}
                          <span className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                            isRunning 
                              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40' 
                              : isAtivo 
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                              : 'bg-muted text-muted-foreground border border-border'
                          }`}>
                            {isRunning ? 'Em Execução...' : isAtivo ? 'Ativo' : 'Pausado'}
                          </span>
                        </div>

                        {/* Detalhes de Configuração */}
                        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 mt-1 text-[10.5px] font-mono text-muted-foreground">
                          {/* Âmbito das Empresas */}
                          <span className="flex items-center space-x-1">
                            <Building2 className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                            <span>
                              {isTodas 
                                ? 'Todas as entidades conhecidas' 
                                : `${nifsLista.length} entidade(s)`}
                            </span>
                          </span>

                          {/* Âmbito Fiscal */}
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-sky-400" />
                            <span>
                              Ano {t.ano} ({Array.isArray(t.meses) && t.meses.length === 12 ? '12 meses' : `${t.meses?.length || 0} meses`})
                            </span>
                          </span>

                          {/* Frequência & Horário */}
                          <span className="flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-amber-500" />
                            <span>
                              {t.recorrencia === 'diaria' && `Diariamente às ${t.hora}`}
                              {t.recorrencia === 'semanal' && `Semanal (${t.dias_semana || 'seg'}) às ${t.hora}`}
                              {t.recorrencia === 'mensal' && `Mensal dia ${t.dia_mes} às ${t.hora}`}
                              {t.recorrencia === 'unica' && `Única às ${t.hora}`}
                            </span>
                          </span>

                          {/* Próxima Execução com destaque */}
                          <span className="flex items-center space-x-1 font-semibold text-[#0284c7] dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.2 rounded border border-sky-500/25">
                            <Clock className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                            <span>Próxima: {formatarProximaExecucao(t.proxima_execucao)}</span>
                          </span>

                          {/* Política Misfire */}
                          <span className="flex items-center space-x-1">
                            <Timer className="w-3 h-3 text-muted-foreground" />
                            <span>
                              Catch-Up: {t.politica_atraso === 'auto_catchup' ? 'Auto' : t.politica_atraso === 'perguntar' ? 'Perguntar' : 'Saltar'}
                            </span>
                          </span>
                        </div>

                        {/* Telemetria em Tempo Real quando em execução */}
                        {(isRunning || t.em_execucao || !!t.progresso_vivo) && (
                          <div className="mt-2 p-2.5 rounded-md border border-sky-500/40 bg-sky-500/10 dark:bg-[#0c1e2f] text-sky-400 space-y-1 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <div className="flex items-center space-x-2 font-bold text-foreground">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                                <span className="text-sky-400 uppercase tracking-wider text-[10px]">A Sincronizar em Tempo Real</span>
                                {t.progresso_vivo?.total_empresas ? (
                                  <span className="text-muted-foreground font-normal text-[10.5px]">
                                    (Empresa {(t.progresso_vivo.empresas_concluidas || 0) + 1} de {t.progresso_vivo.total_empresas})
                                  </span>
                                ) : null}
                              </div>
                              <div className="font-bold text-emerald-400 text-xs">
                                {((t.progresso_vivo?.docs_obtidos || 0)).toLocaleString('pt-PT')} faturas descarregadas
                              </div>
                            </div>

                            {t.progresso_vivo?.nif_atual && (
                              <div className="flex items-center space-x-2 text-[10.5px] font-mono text-foreground/90">
                                <Building2 className="w-3 h-3 text-sky-400 shrink-0" />
                                <span className="font-semibold text-foreground">
                                  {modoPrivacidade ? mascararTexto(t.progresso_vivo.nif_atual) : t.progresso_vivo.nif_atual}
                                </span>
                                <span className="text-muted-foreground truncate max-w-xs">
                                  ({modoPrivacidade ? mascararTexto(t.progresso_vivo.empresa_atual) : t.progresso_vivo.empresa_atual})
                                </span>
                                {t.progresso_vivo.mes_atual && (
                                  <span className="ml-auto px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold uppercase text-[9.5px]">
                                    Mês {String(t.progresso_vivo.mes_atual).padStart(2, '0')}/{t.progresso_vivo.ano} ({t.progresso_vivo.tipo_atual || t.progresso_vivo.tipo})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Status da Última Execução */}
                        {t.ultima_execucao && (() => {
                          const res = t.ultimo_resultado && typeof t.ultimo_resultado === 'object' ? t.ultimo_resultado : null;
                          const totalDocs = Number(res?.total_docs) || 0;
                          const duracao = res?.duracao_segundos ?? 0;
                          const status = t.ultimo_status;

                          let badgeLabel = status;
                          let badgeClass = 'bg-muted text-muted-foreground';
                          let detalheTexto = `· ${totalDocs} faturas obtidas em ${duracao}s`;

                          if (status === 'sucesso') {
                            if (totalDocs === 0) {
                              badgeLabel = 'Atualizado';
                              badgeClass = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25';
                              detalheTexto = `· Sem faturas novas (base já sincronizada) em ${duracao}s`;
                            } else {
                              badgeLabel = 'Sucesso';
                              badgeClass = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25';
                              detalheTexto = `· ${totalDocs.toLocaleString('pt-PT')} novas faturas obtidas em ${duracao}s`;
                            }
                          } else if (status === 'parcial') {
                            badgeLabel = 'Parcial';
                            badgeClass = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25';
                            if (res?.mensagem) {
                              detalheTexto = `· ${res.mensagem} (${duracao}s)`;
                            } else if (totalDocs === 0) {
                              detalheTexto = `· Verificado com avisos nalgumas entidades (${duracao}s)`;
                            } else {
                              detalheTexto = `· ${totalDocs.toLocaleString('pt-PT')} faturas com avisos nalgumas entidades (${duracao}s)`;
                            }
                          } else if (status === 'erro') {
                            badgeLabel = 'Erro';
                            badgeClass = 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25';
                            detalheTexto = `· ${res?.mensagem || 'Falha na comunicação ou credenciais'}`;
                          } else if (status === 'saltado') {
                            badgeLabel = 'Saltado';
                            badgeClass = 'bg-slate-500/15 text-muted-foreground border border-slate-500/20';
                            detalheTexto = `· Ronda em atraso saltada manualmente`;
                          }

                          return (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-mono">
                              <span className="text-muted-foreground">Última execução:</span>
                              <span className="text-foreground">{t.ultima_execucao}</span>
                              <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-semibold ${badgeClass}`}>
                                {badgeLabel}
                              </span>
                              <span className="text-muted-foreground truncate max-w-md">
                                {detalheTexto}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Ações da Tarefa */}
                    <div className="flex items-center space-x-1.5 self-end md:self-center shrink-0">
                      <button
                        onClick={() => handleExecutarAgora(t)}
                        disabled={isRunning}
                        title="Executar imediatamente fora do horário previsto"
                        className="flex items-center space-x-1 px-2.5 py-1 rounded border border-border bg-card hover:bg-muted text-xs font-mono text-foreground hover:text-primary transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                      >
                        <Play className="w-3 h-3" />
                        <span>Disparar Agora</span>
                      </button>

                      <button
                        onClick={() => handleAbrirLogs(t)}
                        title="Ver histórico desta tarefa"
                        className="p-1 rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-2xs"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleEditarTarefa(t)}
                        title="Editar configurações"
                        className="p-1 rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-2xs"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleEliminar(t)}
                        title="Eliminar agendamento"
                        className="p-1 rounded border border-border bg-card hover:bg-rose-500/20 text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer shadow-2xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. Modal de Criação / Edição de Agendamento (100% Opaco & Canónico EVO) */}
      {modalFormAberto && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card dark:bg-[#0c1520] border border-border dark:border-[#222f3e] rounded-md shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-foreground animate-in fade-in zoom-in-95 duration-150">
            
            {/* Topo do Modal com Assinatura Canónica EVO */}
            <div className="relative evo-card-signature px-4 py-3 border-b border-border dark:border-[#222f3e] flex items-center justify-between shrink-0 bg-card dark:bg-[#101c2b] select-none before:content-[''] before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded bg-muted dark:bg-[#132233] border border-border/80 dark:border-[#253a52] text-foreground shrink-0">
                  <Calendar className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-xs text-foreground">
                    {tarefaEmEdicao ? 'Editar Agendamento' : 'Novo Agendamento em Segundo Plano'}
                  </h3>
                  <p className="text-[10.5px] font-mono text-muted-foreground">
                    Configure a recorrência, âmbito fiscal e política de catch-up.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setModalFormAberto(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo do Formulário */}
            <form onSubmit={handleSubmeterForm} className="p-4 overflow-y-auto space-y-3.5 flex-1">
              {/* Nome */}
              <div>
                <label className="block text-xs font-mono font-medium text-foreground mb-1">
                  Nome do Agendamento *
                </label>
                <input
                  type="text"
                  required
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  placeholder="Ex: Atualização Geral Noturna"
                  className="w-full px-3 py-1.5 bg-white/70 dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              {/* Âmbito das Empresas */}
              <div>
                <label className="block text-xs font-mono font-medium text-foreground mb-1">
                  Empresas / Âmbito *
                </label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setFormModoEntidades('todas')}
                    className={`py-1.5 px-3 rounded border text-xs font-mono text-left flex items-center justify-between transition-colors cursor-pointer ${
                      formModoEntidades === 'todas'
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span>Todas as Entidades Conhecidas</span>
                    {formModoEntidades === 'todas' && <Check className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormModoEntidades('selecao')}
                    className={`py-1.5 px-3 rounded border text-xs font-mono text-left flex items-center justify-between transition-colors cursor-pointer ${
                      formModoEntidades === 'selecao'
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span>Selecionar Específicas ({formNifs.length})</span>
                    {formModoEntidades === 'selecao' && <Check className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {formModoEntidades === 'selecao' && (
                  <div className="border border-border dark:border-[#222f3e] rounded p-2 bg-white/50 dark:bg-[#07121c] space-y-2">
                    <div className="relative">
                      <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Pesquisar por NIF ou nome..."
                        value={formPesquisaEntidade}
                        onChange={e => setFormPesquisaEntidade(e.target.value)}
                        className="w-full pl-7 pr-3 py-1 bg-white dark:bg-[#0c1520] border border-border dark:border-[#222f3e] rounded text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="max-h-36 overflow-y-auto divide-y divide-border/40 text-xs font-mono">
                      {entidadesFiltradas.length === 0 ? (
                        <div className="p-2 text-center text-muted-foreground text-[11px]">
                          Nenhuma empresa encontrada.
                        </div>
                      ) : (
                        entidadesFiltradas.map(e => {
                          const isSel = formNifs.includes(e.nif);
                          return (
                            <label
                              key={e.id}
                              className="flex items-center space-x-2 p-1 hover:bg-muted/40 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={evt => {
                                  if (evt.target.checked) {
                                    setFormNifs(prev => [...prev, e.nif]);
                                  } else {
                                    setFormNifs(prev => prev.filter(x => x !== e.nif));
                                  }
                                }}
                                className="rounded border-border text-primary focus:ring-0"
                              />
                              <span className="font-semibold text-foreground">
                                {modoPrivacidade ? mascararTexto(e.nif) : e.nif}
                              </span>
                              <span className="text-muted-foreground truncate">
                                {modoPrivacidade ? mascararTexto(e.nomecli) : e.nomecli}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Ano e Tipo de Operação */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-medium text-foreground mb-1">
                    Ano Fiscal *
                  </label>
                  <select
                    value={formAno}
                    onChange={e => setFormAno(Number(e.target.value))}
                    className="w-full px-3 py-1.5 bg-white/70 dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary cursor-pointer"
                  >
                    {[2026, 2025, 2024, 2023, 2022].map(a => (
                      <option key={a} value={a}>
                        Ano {a}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono font-medium text-foreground mb-1">
                    Tipo de Operação *
                  </label>
                  <select
                    value={formTipo}
                    onChange={e => setFormTipo(e.target.value as any)}
                    className="w-full px-3 py-1.5 bg-white/70 dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="ambos">Ambos (Compras & Vendas)</option>
                    <option value="compras">Apenas Compras</option>
                    <option value="vendas">Apenas Vendas</option>
                  </select>
                </div>
              </div>

              {/* Meses Fiscais */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-mono font-medium text-foreground">
                    Meses a Sincronizar ({formMeses.length}/12) *
                  </label>
                  <div className="space-x-2 text-[10.5px] font-mono">
                    <button
                      type="button"
                      onClick={() => setFormMeses(Array.from({ length: 12 }, (_, i) => i + 1))}
                      className="text-primary hover:underline cursor-pointer"
                    >
                      Todos
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => setFormMeses([])}
                      className="text-muted-foreground hover:underline cursor-pointer"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                  {MESES_NOMES.map(m => {
                    const sel = formMeses.includes(m.num);
                    return (
                      <button
                        key={m.num}
                        type="button"
                        onClick={() => {
                          if (sel) {
                            setFormMeses(prev => prev.filter(x => x !== m.num));
                          } else {
                            setFormMeses(prev => [...prev, m.num].sort((a, b) => a - b));
                          }
                        }}
                        className={`py-1 text-center rounded border text-[11px] font-mono transition-colors cursor-pointer ${
                          sel 
                            ? 'bg-primary text-primary-foreground border-primary font-bold' 
                            : 'bg-white/70 dark:bg-[#07121c] border-border dark:border-[#222f3e] text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recorrência e Horário */}
              <div className="border border-border/80 dark:border-[#1e344f] rounded-md p-3 bg-slate-50 dark:bg-[#0e1a26] space-y-2.5">
                <h4 className="font-display font-medium text-xs text-foreground flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span>Programação de Frequência</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['diaria', 'semanal', 'mensal', 'unica'] as const).map(rec => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => setFormRecorrencia(rec)}
                      className={`py-1 px-2 rounded border text-center text-xs font-mono capitalize transition-colors cursor-pointer ${
                        formRecorrencia === rec
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {rec === 'diaria' && 'Diária'}
                      {rec === 'semanal' && 'Semanal'}
                      {rec === 'mensal' && 'Mensal'}
                      {rec === 'unica' && 'Única'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-mono text-muted-foreground mb-1">
                      Hora de Execução (HH:MM) *
                    </label>
                    <input
                      type="time"
                      required
                      value={formHora}
                      onChange={e => setFormHora(e.target.value)}
                      className="w-full px-3 py-1 bg-white/70 dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                  {formRecorrencia === 'mensal' && (
                    <div>
                      <label className="block text-[11px] font-mono text-muted-foreground mb-1">
                        Dia do Mês (1-31) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={formDiaMes}
                        onChange={e => setFormDiaMes(Number(e.target.value))}
                        className="w-full px-3 py-1 bg-white/70 dark:bg-[#07121c] border border-slate-200 dark:border-[#222f3e] rounded text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {formRecorrencia === 'semanal' && (
                  <div>
                    <label className="block text-[11px] font-mono text-muted-foreground mb-1.5">
                      Dias da Semana *
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {DIAS_SEMANA_OPCOES.map(d => {
                        const sel = formDiasSemana.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              if (sel) {
                                setFormDiasSemana(prev => prev.filter(x => x !== d.id));
                              } else {
                                setFormDiasSemana(prev => [...prev, d.id]);
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors cursor-pointer ${
                              sel 
                                ? 'bg-primary text-primary-foreground border-primary font-bold' 
                                : 'bg-white/70 dark:bg-[#07121c] border-border dark:border-[#222f3e] text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Política de Atraso (Misfire / Catch-Up quando o PC esteve desligado) */}
              <div className="border border-border/80 dark:border-[#1e344f] rounded-md p-3 bg-slate-50 dark:bg-[#0e1a26] space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-medium text-xs text-foreground flex items-center space-x-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                    <span>Se o computador estiver desligado no horário agendado:</span>
                  </h4>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="flex items-start space-x-2.5 p-2 rounded border border-border/60 dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] cursor-pointer hover:bg-muted/40">
                    <input
                      type="radio"
                      name="politica_atraso"
                      value="auto_catchup"
                      checked={formPoliticaAtraso === 'auto_catchup'}
                      onChange={() => setFormPoliticaAtraso('auto_catchup')}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div>
                      <span className="text-xs font-mono font-semibold text-foreground block">
                        Auto Recuperação (Recomendado)
                      </span>
                      <span className="text-[10.5px] font-mono text-muted-foreground block leading-tight">
                        Executa automaticamente uma única vez logo após o arranque do computador, consolidando atrasos.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start space-x-2.5 p-2 rounded border border-border/60 dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] cursor-pointer hover:bg-muted/40">
                    <input
                      type="radio"
                      name="politica_atraso"
                      value="perguntar"
                      checked={formPoliticaAtraso === 'perguntar'}
                      onChange={() => setFormPoliticaAtraso('perguntar')}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div>
                      <span className="text-xs font-mono font-semibold text-foreground block">
                        Perguntar na Aplicação
                      </span>
                      <span className="text-[10.5px] font-mono text-muted-foreground block leading-tight">
                        Exibe um banner de alerta no topo a perguntar se deseja recuperar agora ou ignorar.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start space-x-2.5 p-2 rounded border border-border/60 dark:border-[#222f3e] bg-white/70 dark:bg-[#07121c] cursor-pointer hover:bg-muted/40">
                    <input
                      type="radio"
                      name="politica_atraso"
                      value="skip"
                      checked={formPoliticaAtraso === 'skip'}
                      onChange={() => setFormPoliticaAtraso('skip')}
                      className="mt-0.5 text-primary focus:ring-0"
                    />
                    <div>
                      <span className="text-xs font-mono font-semibold text-foreground block">
                        Saltar (Ignorar ronda perdida)
                      </span>
                      <span className="text-[10.5px] font-mono text-muted-foreground block leading-tight">
                        Não executa a ronda perdida e aguarda pacientemente pelo próximo horário agendado.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Botões do Rodapé */}
              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-border/60 dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setModalFormAberto(false)}
                  className="px-3.5 py-1.5 rounded border border-border dark:border-[#222f3e] bg-card hover:bg-muted text-xs font-mono text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!!acaoEmCurso}
                  className="px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-medium disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  {tarefaEmEdicao ? 'Guardar Alterações' : 'Criar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Modal de Histórico de Auditoria (Logs) */}
      {modalLogsAberto && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card dark:bg-[#0c1520] border border-border dark:border-[#222f3e] rounded-md shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-foreground animate-in fade-in zoom-in-95 duration-150">
            
            {/* Topo com Assinatura Canónica EVO */}
            <div className="relative evo-card-signature px-4 py-3 border-b border-border dark:border-[#222f3e] flex items-center justify-between shrink-0 bg-card dark:bg-[#101c2b] select-none before:content-[''] before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7] dark:before:bg-sky-400 before:z-20">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded bg-muted dark:bg-[#132233] border border-border/80 dark:border-[#253a52] text-foreground shrink-0">
                  <History className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-xs text-foreground">
                    {tarefaLogs ? `Logs: ${tarefaLogs.nome}` : 'Histórico Global de Auditoria de Agendamentos'}
                  </h3>
                  <p className="text-[10.5px] font-mono text-muted-foreground">
                    Registo permanente de execuções autónomas no SQLite (%LOCALAPPDATA%\GExcelAYD\efatura_scheduler.db).
                  </p>
                </div>
              </div>

              <button
                onClick={() => setModalLogsAberto(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {carregandoLogs ? (
                <div className="flex flex-col items-center justify-center h-48 space-y-2 text-muted-foreground">
                  <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-xs font-mono">A carregar registos de auditoria...</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground space-y-2">
                  <History className="w-8 h-8 opacity-40" />
                  <span className="text-xs font-mono">Nenhum registo de execução encontrado.</span>
                </div>
              ) : (
                <div className="border border-border/80 dark:border-[#1e344f] rounded-md overflow-hidden">
                  <table className="w-full text-left text-xs font-mono divide-y divide-border/60">
                    <thead className="bg-slate-100/90 dark:bg-[#122436] text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border dark:border-[#222f3e]">
                      <tr>
                        <th className="py-2 px-3">Tarefa</th>
                        <th className="py-2 px-3">Iniciado Em</th>
                        <th className="py-2 px-3">Duração</th>
                        <th className="py-2 px-3">Empresas</th>
                        <th className="py-2 px-3">Docs Obtidos</th>
                        <th className="py-2 px-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 dark:divide-[#1a2d42]">
                      {logs.map(lg => (
                        <tr key={lg.id} className="hover:bg-muted/20">
                          <td className="py-2 px-3 font-medium text-foreground">
                            {lg.nome_tarefa}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground text-[11px]">
                            {lg.iniciado_em}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground text-[11px]">
                            {lg.duracao_segundos}s
                          </td>
                          <td className="py-2 px-3 text-foreground">
                            {lg.total_empresas}
                          </td>
                          <td className={`py-2 px-3 font-semibold ${lg.total_docs_obtidos > 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                            {lg.total_docs_obtidos.toLocaleString('pt-PT')}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex px-1.5 py-0.2 rounded text-[9.5px] uppercase font-semibold ${
                              lg.status === 'sucesso' 
                                ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20' 
                                : lg.status === 'parcial'
                                ? 'bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/20'
                                : 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/20'
                            }`}>
                              {lg.status === 'sucesso' && lg.total_docs_obtidos === 0 ? 'atualizado' : lg.status}
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
        </div>
      )}

    </div>
  );
}
