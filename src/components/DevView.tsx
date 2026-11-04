import { useState, useEffect } from 'react';
import { 
  Code2, 
  Trash2, 
  AlertTriangle, 
  Check, 
  Database, 
  Server, 
  Cpu, 
  RotateCcw,
  ShieldAlert,
  HardDrive,
  Sparkles,
  Loader2,
  CheckCircle2,
  Lock,
  LogIn
} from 'lucide-react';
import { useAuth } from '../lib/auth';

interface DevViewProps {
  onApiStatusChange?: (online: boolean) => void;
  versaoMotor?: string;
}

interface EntidadeItem {
  nif: string;
  nomecli: string;
}

export function DevView({ onApiStatusChange, versaoMotor }: DevViewProps) {
  const { token, isAdmin, setShowLoginModal } = useAuth();
  const [limpando, setLimpando] = useState<boolean>(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Estados da Política de Retenção (BdsefaturaV4)
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [retencaoAnos, setRetencaoAnos] = useState<number>(3);
  const [retencaoTipo, setRetencaoTipo] = useState<'ambos' | 'compras' | 'vendas'>('ambos');
  const [retencaoNif, setRetencaoNif] = useState<string>(''); // Vazio = Todas as empresas
  const [retencaoExecutando, setRetencaoExecutando] = useState<boolean>(false);
  const [retencaoResultado, setRetencaoResultado] = useState<any | null>(null);

  // Carregar lista de entidades para o seletor de âmbito
  useEffect(() => {
    let cancel = false;
    async function carregarEntidades() {
      try {
        const res = await fetch("http://127.0.0.1:8015/api/entidades");
        if (res.ok) {
          const data = await res.json();
          if (!cancel && data.entidades) {
            setEntidades(data.entidades);
          }
        }
      } catch {}
    }
    carregarEntidades();
    return () => { cancel = true; };
  }, []);

  const executarLimpeza = async (tipo: 'compras' | 'vendas' | 'tudo') => {
    if (!isAdmin) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador.');
      return;
    }

    const labelTipo = tipo === 'compras' ? 'COMPRAS (PocketBase)' : tipo === 'vendas' ? 'VENDAS (SQLite)' : 'COMPRAS E VENDAS';
    const confirmacao = window.confirm(
      `⚠️ AÇÃO DE DESENVOLVEDOR / ADMINISTRADOR:\n\n` +
      `Tem a certeza de que deseja eliminar todas as faturas de ${labelTipo}?\n` +
      `Esta ação é irreversível e reinicia a respetiva base de dados a zeros.`
    );
    if (!confirmacao) return;

    setLimpando(true);
    setMensagemSucesso(null);
    setMensagemErro(null);

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Auth-Token'] = token;
      }
      const res = await fetch(`http://127.0.0.1:8015/api/base-dados/limpar?reset_senhas=true&tipo=${tipo}`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        const json = await res.json();
        setMensagemSucesso(`Base de dados (${tipo.toUpperCase()}) limpa com sucesso. ${json.linhas_apagadas || 0} faturas eliminadas e senhas reiniciadas.`);
        onApiStatusChange?.(true);
      } else {
        const err = await res.json();
        setMensagemErro(`Falha na limpeza: ${err.detail || 'Erro na API'}`);
      }
    } catch {
      setMensagemErro('Sem ligação à API do Motor (:8015). Verifique se os serviços estão ativos.');
      onApiStatusChange?.(false);
    } finally {
      setLimpando(false);
    }
  };

  const executarRetencao = async () => {
    if (!isAdmin) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador.');
      return;
    }

    const anoAtual = new Date().getFullYear();
    const anoCorte = anoAtual - retencaoAnos + 1;
    const entidadeLabel = retencaoNif ? `da entidade ${retencaoNif}` : 'de TODAS as empresas';
    const moduloLabel = retencaoTipo === 'ambos' ? 'Compras e Vendas' : retencaoTipo === 'compras' ? 'Compras' : 'Vendas';

    const confirmacao = window.confirm(
      `⚠️ POLÍTICA DE RETENÇÃO TEMPORAL (BdsefaturaV4):\n\n` +
      `Âmbito: ${entidadeLabel}\n` +
      `Módulos: ${moduloLabel}\n` +
      `Janela a Manter: Últimos ${retencaoAnos} anos (${anoCorte} a ${anoAtual})\n` +
      `Expurgo: Faturas emitidas antes de ${anoCorte} (< ${anoCorte})\n\n` +
      `Após o expurgo, será executado VACUUM nas bases SQLite para devolução de espaço em disco.\n\n` +
      `Pretende aplicar a retenção agora?`
    );
    if (!confirmacao) return;

    setRetencaoExecutando(true);
    setMensagemSucesso(null);
    setMensagemErro(null);
    setRetencaoResultado(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Auth-Token'] = token;
      }
      const res = await fetch("http://127.0.0.1:8015/api/manutencao/retencao", {
        method: "POST",
        headers,
        body: JSON.stringify({
          nif: retencaoNif.trim() || null,
          tipo: retencaoTipo,
          anos_retencao: retencaoAnos,
          ano_referencia: null
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRetencaoResultado(data.resultado);
        setMensagemSucesso(`Manutenção de retenção concluída com sucesso. Bases SQLite compactadas via VACUUM.`);
        onApiStatusChange?.(true);
      } else {
        const err = await res.json();
        setMensagemErro(`Falha na manutenção de retenção: ${err.detail || 'Erro na API'}`);
      }
    } catch (e: any) {
      setMensagemErro(`Erro ao comunicar com a API (:8015): ${e.message}`);
      onApiStatusChange?.(false);
    } finally {
      setRetencaoExecutando(false);
    }
  };

  const calcularTotalLinhasApagadas = (res: any): number => {
    if (!res) return 0;
    if (res.modo === 'global' && res.detalhes) {
      let tot = 0;
      Object.values(res.detalhes).forEach((item: any) => {
        if (item && item.linhas_apagadas) {
          if (typeof item.linhas_apagadas.compras === 'number') tot += item.linhas_apagadas.compras;
          if (typeof item.linhas_apagadas.vendas === 'number') tot += item.linhas_apagadas.vendas;
        }
      });
      return tot;
    }
    if (res.linhas_apagadas) {
      let tot = 0;
      if (typeof res.linhas_apagadas.compras === 'number') tot += res.linhas_apagadas.compras;
      if (typeof res.linhas_apagadas.vendas === 'number') tot += res.linhas_apagadas.vendas;
      return tot;
    }
    return 0;
  };

  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="max-w-md w-full bg-slate-100/90 dark:bg-[#122436] rounded-lg border border-amber-500/30 p-6 space-y-4 shadow-lg text-foreground flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-display font-semibold text-foreground">
              Acesso Exclusivo a Administradores
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed font-sans">
              O Painel do Desenvolvedor contém operações de expurgo, compactação e limpeza integral de dados. É obrigatório iniciar sessão com privilégios de Administrador para aceder a esta área.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowLoginModal(true)}
            className="flex items-center space-x-2 px-4 py-2 rounded-md bg-[#0284c7] hover:bg-[#0274b3] text-white text-xs font-mono font-medium transition cursor-pointer shadow-sm"
          >
            <LogIn className="w-4 h-4" />
            <span>Iniciar Sessão como Administrador</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4 min-h-0 select-none overflow-y-auto">
      
      {/* 1. Cabeçalho Oficial Gexcel EVO */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Ambiente Técnico & Manutenção de Sistema
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center">
            Painel do Desenvolvedor
          </h1>
          <p className="page-description text-muted-foreground text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Ações de diagnóstico, manutenção de bases de dados e controlo administrativo avançado.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs">
            <Code2 className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <span className="text-muted-foreground">Modo Técnico</span>
          </div>
        </div>
      </header>

      {/* Alertas de Notificação */}
      {mensagemSucesso && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md text-emerald-600 dark:text-emerald-400 font-mono text-xs flex items-center space-x-2 animate-in fade-in">
          <Check className="w-4 h-4 shrink-0" />
          <span>{mensagemSucesso}</span>
        </div>
      )}

      {mensagemErro && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive font-mono text-xs flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      {/* Grid de Cartões de Administração */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Card 1: Zona de Manutenção Crítica de Dados */}
        <div className="bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Manutenção de Bases de Dados
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30">
              Ações Destrutivas
            </span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Estas operações removem faturas importadas do armazenamento persistente e reiniciam o histórico de senhas bloqueadas. Útil em testes ou reinício de exercícios.
          </p>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              disabled={limpando}
              onClick={() => executarLimpeza('compras')}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-white dark:bg-[#0c1520] hover:bg-destructive/10 border border-slate-300 dark:border-[#222f3e] hover:border-destructive/40 text-foreground hover:text-destructive text-xs font-mono transition cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4 text-destructive shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold">Limpar Base de Dados (Compras)</span>
                  <span className="text-[10px] text-muted-foreground">Elimina faturas de compras registadas na base particionada SQLite BdsefaturaV4</span>
                </div>
              </div>
              <span className="text-[10.5px] text-muted-foreground">Executar</span>
            </button>

            <button
              type="button"
              disabled={limpando}
              onClick={() => executarLimpeza('vendas')}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-white dark:bg-[#0c1520] hover:bg-destructive/10 border border-slate-300 dark:border-[#222f3e] hover:border-destructive/40 text-foreground hover:text-destructive text-xs font-mono transition cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4 text-destructive shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold">Limpar Base de Dados (Vendas)</span>
                  <span className="text-[10px] text-muted-foreground">Elimina faturas emitidas guardadas na base SQLite de vendas</span>
                </div>
              </div>
              <span className="text-[10.5px] text-muted-foreground">Executar</span>
            </button>

            <button
              type="button"
              disabled={limpando}
              onClick={() => executarLimpeza('tudo')}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-destructive/10 hover:bg-destructive/20 border border-destructive/30 text-destructive text-xs font-mono transition cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="font-semibold">Reset Completo (Compras + Vendas)</span>
                  <span className="text-[10px] opacity-80">Reinicia integralmente todas as coleções fiscais e limpa senhas bloqueadas</span>
                </div>
              </div>
              <span className="text-[10.5px] font-bold">Reset Total</span>
            </button>
          </div>
        </div>

        {/* Card 2: Política de Retenção Temporal (Rolling Window - BdsefaturaV4) */}
        <div className="bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <HardDrive className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Retenção Temporal (BdsefaturaV4)
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-[#0284c7] dark:text-sky-400 font-bold border border-sky-500/30">
              Janela Deslizante
            </span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Aplica a janela fiscal de retenção temporal nas bases particionadas SQLite por NIF. Faturas anteriores ao ano de corte são expurgadas e é executado <code className="text-[11px] font-mono font-bold text-foreground">VACUUM</code> para libertar espaço físico em disco.
          </p>

          {/* Configuração dos Parâmetros de Retenção */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-xs">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Anos a Reter
              </label>
              <select
                value={retencaoAnos}
                onChange={e => setRetencaoAnos(Number(e.target.value))}
                disabled={retencaoExecutando}
                className="w-full h-8 px-2 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden cursor-pointer"
              >
                <option value={1}>1 Ano</option>
                <option value={2}>2 Anos</option>
                <option value={3}>3 Anos (Padrão Gexcel)</option>
                <option value={4}>4 Anos</option>
                <option value={5}>5 Anos (Fiscal AT)</option>
                <option value={7}>7 Anos</option>
                <option value={10}>10 Anos (Comercial)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Módulo
              </label>
              <select
                value={retencaoTipo}
                onChange={e => setRetencaoTipo(e.target.value as any)}
                disabled={retencaoExecutando}
                className="w-full h-8 px-2 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden cursor-pointer"
              >
                <option value="ambos">Compras + Vendas</option>
                <option value="compras">Apenas Compras</option>
                <option value="vendas">Apenas Vendas</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Âmbito
              </label>
              <select
                value={retencaoNif}
                onChange={e => setRetencaoNif(e.target.value)}
                disabled={retencaoExecutando}
                className="w-full h-8 px-2 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-foreground text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden cursor-pointer truncate"
              >
                <option value="">Todas as Empresas (Global)</option>
                {entidades.map(ent => (
                  <option key={ent.nif} value={ent.nif}>
                    {ent.nif} - {ent.nomecli.slice(0, 18)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Projeção Visual da Janela de Corte */}
          <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] font-mono text-[11px] space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Ano de Referência:</span>
              <span className="font-semibold text-foreground">{new Date().getFullYear()}</span>
            </div>
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
              <span>Período Preservado ({retencaoAnos} anos):</span>
              <span className="font-bold">
                {new Date().getFullYear() - retencaoAnos + 1} a {new Date().getFullYear()}
              </span>
            </div>
            <div className="flex items-center justify-between text-destructive pt-0.5 border-t border-slate-200 dark:border-[#1b2b3d]">
              <span>Ano de Expurgo (Apagar):</span>
              <span className="font-bold">
                &lt; {new Date().getFullYear() - retencaoAnos + 1}
              </span>
            </div>
          </div>

          {/* Botão de Disparo */}
          <button
            type="button"
            disabled={retencaoExecutando}
            onClick={executarRetencao}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded bg-white dark:bg-[#0c1520] hover:bg-sky-500/10 border border-slate-300 dark:border-[#222f3e] hover:border-sky-500/40 text-foreground hover:text-[#0284c7] dark:hover:text-sky-400 text-xs font-mono transition cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center space-x-2">
              {retencaoExecutando ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#0284c7] dark:text-sky-400 shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />
              )}
              <div className="flex flex-col text-left">
                <span className="font-semibold">
                  {retencaoExecutando ? 'A processar retenção e VACUUM...' : 'Aplicar Retenção & Compactar Bases'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Expurga registos antigos e devolve blocos não utilizados ao SO
                </span>
              </div>
            </div>
            <span className="text-[10.5px] font-semibold text-[#0284c7] dark:text-sky-400">
              {retencaoExecutando ? 'Aguarde' : 'Executar'}
            </span>
          </button>

          {/* Resultado da Última Execução */}
          {retencaoResultado && (
            <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 font-mono text-xs text-emerald-600 dark:text-emerald-400 flex items-start space-x-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold block">Relatório de Manutenção Concluído:</span>
                <span className="block text-[11px] text-foreground">
                  Âmbito: {retencaoResultado.modo === 'global' ? `Global (${retencaoResultado.total_empresas || 0} empresas)` : `NIF ${retencaoResultado.nif}`}
                </span>
                <span className="block text-[11px] text-foreground">
                  Total de Faturas Expurgadas: <strong>{calcularTotalLinhasApagadas(retencaoResultado)}</strong>
                </span>
                <span className="block text-[10.5px] opacity-80">
                  Comando VACUUM executado em todas as bases SQLite particionadas.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Card 3: Topologia e Serviços do Ecossistema */}
        <div className="md:col-span-2 bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Topologia de Serviços Locais
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-[#0284c7] dark:text-sky-400 font-bold border border-sky-500/30">
              Mapa Oficial
            </span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Identificação dos microserviços em execução na máquina de trabalho e respetivas portas reservadas no ecossistema Gexcel.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 font-mono text-xs">
            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-emerald-500" />
                <span>PocketBase Core BD</span>
              </div>
              <span className="text-muted-foreground font-semibold">Porta :8090</span>
            </div>

            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
                <span>Motor e-Fatura API (Python)</span>
              </div>
              <span className="text-muted-foreground font-semibold">
                Porta :8015 {versaoMotor && <span className="text-foreground">v{versaoMotor}</span>}
              </span>
            </div>

            <div className="p-2.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-purple-400" />
                <span>Interface Web (Vite / React)</span>
              </div>
              <span className="text-muted-foreground font-semibold">Porta :5173</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
