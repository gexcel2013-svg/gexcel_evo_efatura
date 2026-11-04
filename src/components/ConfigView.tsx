import { useState, useEffect, useCallback } from 'react';
import { 
  SlidersHorizontal, 
  Database, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  KeyRound, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Edit2, 
  Trash2, 
  X, 
  User, 
  RefreshCw,
  LogOut,
  Radio
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { AppUser } from '../types/auth';

export function ConfigView() {
  const { 
    currentUser, 
    token,
    appConfig, 
    refreshConfig, 
    refreshUsers, 
    setShowLoginModal, 
    login,
    logout 
  } = useAuth();

  const isLoggedIn = !!currentUser;
  const isSub = currentUser?.role === 'subutilizador';
  const isAdm = currentUser?.role === 'admin';
  const isSuper = currentUser?.role === 'superadmin';
  const canManage = isAdm || isSuper;

  const getHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      h['X-Auth-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }, [token]);

  const [modoSelecionado, setModoSelecionado] = useState<'integrado' | 'autonomo'>(
    appConfig?.modo_dados || 'integrado'
  );
  const [salvandoModo, setSalvandoModo] = useState<boolean>(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Lista de utilizadores
  const [utilizadores, setUtilizadores] = useState<AppUser[]>([]);
  const [carregandoUsers, setCarregandoUsers] = useState<boolean>(false);

  // Modal de criação / edição de utilizador
  const [modalUserAberto, setModalUserAberto] = useState<boolean>(false);
  const [userEmEdicao, setUserEmEdicao] = useState<AppUser | null>(null);
  const [formNome, setFormNome] = useState<string>('');
  const [formUsername, setFormUsername] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formRole, setFormRole] = useState<'admin' | 'subutilizador' | 'superadmin'>('subutilizador');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formAtivo, setFormAtivo] = useState<boolean>(true);
  const [salvandoUser, setSalvandoUser] = useState<boolean>(false);
  const [erroFormUser, setErroFormUser] = useState<string | null>(null);

  useEffect(() => {
    if (appConfig?.modo_dados) {
      setModoSelecionado(appConfig.modo_dados);
    }
  }, [appConfig?.modo_dados]);

  const carregarListaUtilizadores = useCallback(async () => {
    setCarregandoUsers(true);
    const users = await refreshUsers();
    setUtilizadores(users);
    setCarregandoUsers(false);
  }, [refreshUsers]);

  useEffect(() => {
    carregarListaUtilizadores();
  }, [carregarListaUtilizadores]);

  // Alterar Modo de Ligação (Integrado vs Autónomo)
  const handleAlterarModo = async (novoModo: 'integrado' | 'autonomo') => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para alterar o modo de ligação.');
      return;
    }
    if (novoModo === appConfig?.modo_dados) return;

    const confirmacao = window.confirm(
      `⚠️ ALTERAÇÃO DO MODO DE LIGAÇÃO:\n\n` +
      `Tem a certeza de que deseja mudar para o modo ${novoModo.toUpperCase()}?\n\n` +
      (novoModo === 'integrado' 
        ? 'A aplicação irá obter credenciais e utilizadores a partir do Gexcel Apps e do ecossistema central.' 
        : 'A aplicação irá operar de forma 100% isolada com catálogo e utilizadores locais.')
    );
    if (!confirmacao) return;

    setSalvandoModo(true);
    setMensagemSucesso(null);
    setMensagemErro(null);

    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/config/modo', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ modo: novoModo })
      });

      if (res.ok) {
        setModoSelecionado(novoModo);
        await refreshConfig();
        setMensagemSucesso(`Modo de ligação atualizado para: ${novoModo === 'integrado' ? 'Integrado (Gexcel Apps)' : 'Autónomo (Local)'}`);
      } else {
        const err = await res.json();
        setMensagemErro(`Falha ao alterar modo: ${err.detail || 'Erro na API'}`);
      }
    } catch (e: any) {
      setMensagemErro(`Erro de ligação: ${e.message}`);
    } finally {
      setSalvandoModo(false);
    }
  };

  // Abrir modal de criação com perfil pré-definido
  const abrirCriacaoUser = (rolePredefinido: 'subutilizador' | 'admin' = 'subutilizador') => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
      return;
    }
    setUserEmEdicao(null);
    setFormNome('');
    setFormUsername('');
    setFormEmail('');
    setFormRole(rolePredefinido);
    setFormPassword('');
    setFormAtivo(true);
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  // Abrir modal de edição com RBAC estrito
  const abrirEdicaoUser = (user: AppUser) => {
    if (!isLoggedIn) {
      setMensagemErro('Permissão negada. Inicie sessão para gerir o seu perfil.');
      return;
    }
    const isSuperTarget = user.role === 'superadmin' || user.is_system || user.id === 1;
    const isSelf = currentUser && user.id === currentUser.id;

    // 1. Subutilizador só pode editar o seu próprio perfil
    if (isSub && !isSelf) {
      setMensagemErro('Permissão negada. Um subutilizador não tem permissão para editar outros utilizadores.');
      return;
    }

    // 2. Superadministrador só pode ser editado pelo próprio Superadministrador
    if (isSuperTarget && !isSuper) {
      setMensagemErro('Permissão negada. Apenas o Superadministrador pode editar a conta Mestre do sistema.');
      return;
    }

    // 3. Administrador comum não pode editar outros administradores (a menos que seja o próprio)
    if (isAdm && user.role === 'admin' && !isSelf) {
      setMensagemErro('Apenas o Superadministrador pode editar outros administradores.');
      return;
    }

    setUserEmEdicao(user);
    setFormNome(user.nome);
    setFormUsername(user.username);
    setFormEmail(user.email || '');
    setFormRole(user.role as any);
    setFormPassword(''); // Vazio = manter a atual
    setFormAtivo(user.ativo);
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  // Guardar utilizador (Criação ou Edição)
  const handleGuardarUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoUser(true);
    setErroFormUser(null);

    try {
      if (userEmEdicao) {
        // Validações estritas de segurança no frontend
        const isSuperTarget = userEmEdicao.role === 'superadmin' || userEmEdicao.is_system || userEmEdicao.id === 1;
        const isSelf = currentUser && userEmEdicao.id === currentUser.id;

        if (isSub && !isSelf) {
          setErroFormUser('Permissão negada. Um subutilizador não pode editar contas de outros utilizadores.');
          setSalvandoUser(false);
          return;
        }

        if (isSuperTarget && !isSuper) {
          setErroFormUser('Permissão negada. Apenas o Superadministrador pode alterar a conta Mestre do sistema.');
          setSalvandoUser(false);
          return;
        }

        const body: any = {
          nome: formNome.trim(),
          email: formEmail.trim(),
          role: isSuperTarget ? 'superadmin' : isSub ? 'subutilizador' : formRole,
          ativo: (isSuperTarget || isSub) ? true : formAtivo
        };
        if (formPassword.trim()) {
          body.nova_password = formPassword.trim();
        }

        const res = await fetch(`http://127.0.0.1:8015/api/app/users/${userEmEdicao.id}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(body)
        });

        if (res.ok) {
          setModalUserAberto(false);
          await carregarListaUtilizadores();
          if (currentUser && currentUser.id === userEmEdicao.id) {
            await refreshConfig();
          }
          setMensagemSucesso(`Utilizador '${formUsername}' atualizado com sucesso.`);
        } else {
          const err = await res.json();
          setErroFormUser(err.detail || 'Falha ao atualizar utilizador.');
        }
      } else {
        // Criar novo
        if (!canManage) {
          setErroFormUser('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
          setSalvandoUser(false);
          return;
        }

        if (!formPassword.trim() || formPassword.trim().length < 4) {
          setErroFormUser('A palavra-passe deve ter pelo menos 4 caracteres.');
          setSalvandoUser(false);
          return;
        }

        const res = await fetch('http://127.0.0.1:8015/api/app/users', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            nome: formNome.trim(),
            username: formUsername.trim(),
            email: formEmail.trim(),
            role: formRole,
            password: formPassword.trim()
          })
        });

        if (res.ok) {
          setModalUserAberto(false);
          await carregarListaUtilizadores();
          setMensagemSucesso(`Utilizador '${formUsername}' criado com sucesso.`);
        } else {
          const err = await res.json();
          setErroFormUser(err.detail || 'Falha ao criar utilizador.');
        }
      }
    } catch (err: any) {
      setErroFormUser(err.message || 'Erro ao comunicar com a API.');
    } finally {
      setSalvandoUser(false);
    }
  };

  // Eliminar utilizador com proteção absoluta de auto-eliminação e hierarquia
  const handleEliminarUser = async (user: AppUser) => {
    // 1. Superadministrador
    if (user.is_system || user.role === 'superadmin' || user.id === 1) {
      alert('Não é permitido eliminar o Superadministrador do sistema.');
      return;
    }

    // 2. Apenas Administrador ou Superadministrador pode eliminar
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para eliminar utilizadores.');
      return;
    }

    // 3. Regra de Ouro: Proibição absoluta de auto-eliminação
    if (currentUser && user.id === currentUser.id) {
      setMensagemErro('Operação recusada: Não é permitido eliminar a sua própria conta enquanto a sua sessão estiver ativa.');
      return;
    }

    // 4. Admin comum não pode eliminar outros administradores
    if (isAdm && user.role === 'admin') {
      setMensagemErro('Apenas o Superadministrador tem permissão para eliminar contas de Administrador.');
      return;
    }

    const conf = window.confirm(`Tem a certeza de que deseja eliminar o utilizador '${user.nome}' (@${user.username})?`);
    if (!conf) return;

    try {
      const res = await fetch(`http://127.0.0.1:8015/api/app/users/${user.id}`, { 
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        await carregarListaUtilizadores();
        setMensagemSucesso(`Utilizador '${user.username}' removido com sucesso.`);
      } else {
        const err = await res.json();
        alert(err.detail || 'Falha ao remover utilizador.');
      }
    } catch (e: any) {
      alert(e.message || 'Erro de comunicação.');
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4 min-h-0 select-none overflow-y-auto">
      
      {/* 1. Cabeçalho Oficial Gexcel EVO */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Painel de Controlo · Gexcel EVO
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center">
            Configurações do Sistema
          </h1>
          <p className="page-description text-muted-foreground text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Gestão do modo de ligação, fonte de dados e controlo de utilizadores locais com permissões (RBAC).
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <span className="text-muted-foreground">
              Modo: <strong className="text-foreground uppercase">{appConfig?.modo_dados || 'integrado'}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Alertas de Notificação */}
      {mensagemSucesso && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md text-emerald-600 dark:text-emerald-400 font-mono text-xs flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{mensagemSucesso}</span>
        </div>
      )}

      {mensagemErro && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive font-mono text-xs flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      {/* Grid de Configurações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Card 1: Modo de Ligação & Fonte de Dados */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Fonte de Dados & Modo de Ligação
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-[#0284c7] dark:text-sky-400 font-bold border border-sky-500/30">
              Arquitetura Híbrida
            </span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Selecione como esta aplicação deve operar no posto de trabalho. Pode integrar-se no ecossistema central ou funcionar de forma totalmente autónoma.
          </p>

          <div className="space-y-2.5 pt-1">
            {/* Opção 1: Modo Integrado */}
            <div 
              onClick={() => !salvandoModo && handleAlterarModo('integrado')}
              className={`p-3 rounded-md border transition cursor-pointer flex items-start space-x-3 ${
                modoSelecionado === 'integrado'
                  ? 'bg-white dark:bg-[#0c1520] border-[#0284c7] shadow-xs ring-1 ring-[#0284c7]/40'
                  : 'bg-white/60 dark:bg-[#0c1520]/60 border-slate-300 dark:border-[#222f3e] hover:border-border'
              }`}
            >
              <Radio className={`w-4 h-4 mt-0.5 shrink-0 ${modoSelecionado === 'integrado' ? 'text-[#0284c7] fill-current' : 'text-muted-foreground'}`} />
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold font-mono text-xs text-foreground">
                    Modo Integrado (Gexcel Apps / CRM Central)
                  </span>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">
                    Padrão
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Lê entidades e senhas fiscais de <code className="text-[10.5px]">tCredenciais.xml</code> via <code className="text-[10.5px]">z-GexcelApps.ini</code> com persistência particionada por NIF (<code className="text-[10.5px]">BdsefaturaV4</code>).
                </p>
              </div>
            </div>

            {/* Opção 2: Modo Autónomo */}
            <div 
              onClick={() => !salvandoModo && handleAlterarModo('autonomo')}
              className={`p-3 rounded-md border transition cursor-pointer flex items-start space-x-3 ${
                modoSelecionado === 'autonomo'
                  ? 'bg-white dark:bg-[#0c1520] border-[#0284c7] shadow-xs ring-1 ring-[#0284c7]/40'
                  : 'bg-white/60 dark:bg-[#0c1520]/60 border-slate-300 dark:border-[#222f3e] hover:border-border'
              }`}
            >
              <Radio className={`w-4 h-4 mt-0.5 shrink-0 ${modoSelecionado === 'autonomo' ? 'text-[#0284c7] fill-current' : 'text-muted-foreground'}`} />
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold font-mono text-xs text-foreground">
                    Modo Autónomo (Instalação Independente)
                  </span>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">
                    Isolado
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  100% independente do Gexcel Apps. Guarda dados numa base SQLite local dedicada com utilizadores e permissões próprios.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-1 text-[11px] font-mono text-muted-foreground flex items-center justify-between border-t border-slate-200 dark:border-[#1b2b3d]">
            <span>Base Local da Aplicação:</span>
            <span className="font-semibold text-foreground truncate max-w-[240px]" title={appConfig?.db_path}>
              gevo_efatura_app.db
            </span>
          </div>
        </div>

        {/* Card 2: Sessão Ativa & Chave Mestra */}
        <div className="relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Sessão Ativa & Operador
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30">
              {currentUser ? currentUser.role.toUpperCase() : 'SEM SESSÃO'}
            </span>
          </div>

          {currentUser ? (
            <div className="space-y-3 pt-1">
              <div className="p-3 rounded-md bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-full bg-[#0284c7]/15 text-[#0284c7] dark:text-sky-400 flex items-center justify-center font-mono font-bold text-sm">
                    {currentUser.nome.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-semibold font-mono text-xs block text-foreground">
                      {currentUser.nome}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground block">
                      @{currentUser.username} {currentUser.email && `· ${currentUser.email}`}
                    </span>
                  </div>
                </div>

                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                  currentUser.role === 'superadmin' 
                    ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                    : currentUser.role === 'admin'
                    ? 'bg-sky-500/15 text-[#0284c7] dark:text-sky-400 border-sky-500/30'
                    : 'bg-slate-200 dark:bg-slate-800 text-muted-foreground border-border'
                }`}>
                  {currentUser.role.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowLoginModal(true)}
                  className="flex-1 px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-muted border border-slate-300 dark:border-[#222f3e] text-xs font-mono transition cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Trocar de Operador</span>
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="px-3 py-1.5 rounded bg-destructive/10 hover:bg-destructive/20 border border-destructive/30 text-destructive text-xs font-mono transition cursor-pointer flex items-center space-x-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-md bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-center space-y-2.5">
              <p className="text-xs font-mono text-muted-foreground">
                Nenhum operador com sessão iniciada nesta estação de trabalho.
              </p>
              <div className="flex items-center justify-center space-x-2">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await login('superadmin', '41238886');
                    if (res.success) {
                      setMensagemSucesso('Sessão iniciada como Superadministrador Mestre (Victor Gamboa).');
                      await carregarListaUtilizadores();
                    } else {
                      setMensagemErro(res.error || 'Falha ao autenticar.');
                    }
                  }}
                  className="px-3.5 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-semibold shadow-xs cursor-pointer transition flex items-center space-x-1.5"
                  title="Autenticação direta com a Chave Mestra Universal (41238886)"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Entrar como Superadmin</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLoginModal(true)}
                  className="px-3.5 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs cursor-pointer transition flex items-center space-x-1.5"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Iniciar Sessão</span>
                </button>
              </div>
            </div>
          )}

          {/* Cartão Informativo da Chave Mestra */}
          <div className="p-2.5 rounded bg-purple-500/10 border border-purple-500/20 text-xs font-mono space-y-1">
            <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center space-x-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Chave Mestra Universal do Superadministrador</span>
            </span>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              O Superadministrador tem privilégios de Nível 3 permanentes para suporte, recuperação e desbloqueio em qualquer máquina independente.
            </p>
          </div>
        </div>

        {/* Card 3: Gestão de Utilizadores Locais (RBAC) - 2 Colunas */}
        <div className="md:col-span-2 relative evo-card-signature bg-slate-100/90 dark:bg-[#122436] rounded-md border border-slate-300/80 dark:border-[#1e344f] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-purple-500 before:z-20">
          <div className="flex items-center justify-between border-b border-slate-300/70 dark:border-[#283e58] pb-2">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Gestão de Utilizadores & Perfis de Acesso (RBAC)
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={carregarListaUtilizadores}
                disabled={carregandoUsers}
                className="p-1.5 rounded border border-slate-300 dark:border-[#222f3e] text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${carregandoUsers ? 'animate-spin' : ''}`} />
              </button>

              {!isSub ? (
                <>
                  <button
                    type="button"
                    onClick={() => abrirCriacaoUser('subutilizador')}
                    className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
                    title="Adicionar um novo subutilizador / operador diário"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>+ Adicionar Subutilizador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => abrirCriacaoUser('admin')}
                    className="px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] hover:bg-muted border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
                    title="Adicionar um novo administrador da entidade"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                    <span>+ Novo Administrador</span>
                  </button>
                </>
              ) : (
                <span className="text-[10px] font-mono text-muted-foreground px-2.5 py-1 rounded bg-muted/50 border border-border">
                  Operador (Apenas Leitura)
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Controlo de acessos da aplicação: <strong className="text-foreground">Superadministrador</strong> (Nível 3 - Total), <strong className="text-foreground">Administrador</strong> (Nível 2 - Gestão e Retenção) e <strong className="text-foreground">Subutilizador</strong> (Nível 1 - Apenas Importação e Consulta).
          </p>

          {/* Tabela de Utilizadores */}
          <div className="overflow-x-auto rounded border border-slate-300 dark:border-[#222f3e]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-200/80 dark:bg-[#0c1520] text-muted-foreground border-b border-slate-300 dark:border-[#222f3e]">
                <tr>
                  <th className="py-2 px-3">Nome / Utilizador</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Perfil</th>
                  <th className="py-2 px-3">Estado</th>
                  <th className="py-2 px-3">Último Acesso</th>
                  <th className="py-2 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1b2b3d] bg-white dark:bg-[#0c1520]/80">
                {utilizadores.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-[#132233] transition">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-foreground">{u.nome}</span>
                        <span className="text-[10px] text-muted-foreground">@{u.username}</span>
                        {u.is_system && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">
                            SISTEMA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {u.email || '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        u.role === 'superadmin'
                          ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
                          : u.role === 'admin'
                          ? 'bg-sky-500/15 text-[#0284c7] dark:text-sky-400 border-sky-500/30'
                          : 'bg-slate-200 dark:bg-slate-800 text-muted-foreground border-border'
                      }`}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold flex items-center space-x-1 ${
                        u.ativo ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.ativo ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-muted-foreground">
                      {u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('pt-PT') : 'Nunca'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        {/* 1. Botão Editar com RBAC estrito */}
                        {(() => {
                          const isSuperTarget = u.role === 'superadmin' || u.is_system || u.id === 1;
                          const isSelf = currentUser && u.id === currentUser.id;

                          // Quem pode editar esta linha?
                          // - Superadministrador pode editar qualquer conta
                          // - Administrador pode editar-se a si próprio ou a subutilizadores (NUNCA o superadministrador)
                          // - Subutilizador só pode editar o seu próprio perfil (NUNCA o superadministrador nem outros utilizadores)
                          const podeEditar = isSuper || 
                                             (isAdm && (!isSuperTarget || isSelf)) || 
                                             (isSub && isSelf) ||
                                             (!currentUser);

                          if (podeEditar) {
                            return (
                              <button
                                type="button"
                                onClick={() => abrirEdicaoUser(u)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition"
                                title={isSelf ? "Alterar a minha palavra-passe / perfil" : "Editar Utilizador / Alterar Palavra-passe"}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            );
                          }

                          if (isSuperTarget) {
                            return (
                              <span className="text-[9.5px] text-purple-600 dark:text-purple-400 font-mono px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20" title="Conta de Superadministrador Mestre Protegida">
                                Protegido
                              </span>
                            );
                          }

                          return (
                            <span className="text-[9.5px] text-muted-foreground font-mono px-1.5 py-0.5 rounded bg-muted/40" title="Sem permissão para alterar este utilizador">
                              Bloqueado
                            </span>
                          );
                        })()}

                        {/* 2. Botão Eliminar com proibição absoluta de auto-eliminação */}
                        {(() => {
                          const isSuperTarget = u.role === 'superadmin' || u.is_system || u.id === 1;
                          const isSelf = currentUser && u.id === currentUser.id;

                          // Quem pode eliminar esta linha?
                          // - Superadmin NUNCA pode ser eliminado
                          // - Um utilizador NUNCA pode apagar a sua própria conta ativa
                          // - Um subutilizador NUNCA pode apagar ninguém
                          // - Um admin só pode apagar subutilizadores (não outros admins)
                          // - Superadmin pode apagar admins e subutilizadores
                          const podeEliminar = !isSuperTarget && 
                                               !isSelf && 
                                               !isSub && 
                                               (isSuper || (isAdm && u.role === 'subutilizador'));

                          if (podeEliminar) {
                            return (
                              <button
                                type="button"
                                onClick={() => handleEliminarUser(u)}
                                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition"
                                title="Eliminar Utilizador"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            );
                          }

                          if (isSelf) {
                            return (
                              <span className="text-[9px] text-[#0284c7] dark:text-sky-400 font-mono px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20" title="Sua sessão ativa atual (auto-eliminação bloqueada)">
                                Conta Ativa
                              </span>
                            );
                          }

                          return null;
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Modal de Criação / Edição de Utilizador */}
      {modalUserAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
          <div className="bg-card w-full max-w-md rounded-lg border border-border/80 shadow-2xl p-5 space-y-4 relative text-foreground">
            
            <button
              type="button"
              onClick={() => setModalUserAberto(false)}
              className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 border-b border-border/80 pb-3">
              <div className="w-9 h-9 rounded-lg bg-[#0284c7]/15 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
                {userEmEdicao ? <Edit2 className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="text-base font-display font-light text-foreground tracking-tight">
                  {userEmEdicao 
                    ? (isSub && userEmEdicao.id === currentUser?.id ? 'Alterar A Minha Palavra-passe / Perfil' : `Editar: ${userEmEdicao.nome}`)
                    : formRole === 'subutilizador'
                    ? 'Adicionar Novo Subutilizador (Operador)'
                    : 'Adicionar Novo Administrador'}
                </h3>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {userEmEdicao ? 'Atualize os dados ou redefina a palavra-passe' : 'Defina os dados de acesso do novo utilizador'}
                </p>
              </div>
            </div>

            {userEmEdicao?.role === 'superadmin' && (
              <div className="p-2.5 rounded bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-600 dark:text-purple-400 font-mono flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Superadministrador de Sistema: O identificador @superadmin e o perfil são permanentes para suporte universal. Pode atualizar o Nome, o Email e a Palavra-passe.</span>
              </div>
            )}

            {isSub && userEmEdicao?.id === currentUser?.id && (
              <div className="p-2.5 rounded bg-sky-500/10 border border-sky-500/20 text-[11px] text-sky-600 dark:text-sky-400 font-mono flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Perfil de Operador: Pode atualizar o seu Nome de exibição, Email e Palavra-passe. O perfil de acesso e permissões são geridos por um Administrador.</span>
              </div>
            )}

            {erroFormUser && (
              <div className="p-2.5 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs font-mono flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroFormUser}</span>
              </div>
            )}

            <form onSubmit={handleGuardarUser} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome do operador"
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Nome de Utilizador (Login)
                </label>
                <input
                  type="text"
                  required
                  disabled={!!userEmEdicao}
                  placeholder="utilizador"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Email (Opcional)
                </label>
                <input
                  type="email"
                  placeholder="gexcel2013@gmail.com"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Perfil de Acesso
                  </label>
                  <select
                    value={formRole}
                    onChange={e => setFormRole(e.target.value as any)}
                    disabled={userEmEdicao?.is_system || userEmEdicao?.role === 'superadmin' || isSub}
                    className="w-full h-8 px-2 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    {userEmEdicao?.role === 'superadmin' ? (
                      <option value="superadmin">Superadministrador (Sistema)</option>
                    ) : (
                      <>
                        <option value="subutilizador">Subutilizador (Operador)</option>
                        {!isSub && <option value="admin">Administrador (Gestor)</option>}
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Estado da Conta
                  </label>
                  <select
                    value={formAtivo ? '1' : '0'}
                    onChange={e => setFormAtivo(e.target.value === '1')}
                    disabled={userEmEdicao?.is_system || userEmEdicao?.role === 'superadmin' || isSub}
                    className="w-full h-8 px-2 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    <option value="1">Ativo (Permite Login)</option>
                    <option value="0">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {userEmEdicao ? 'Nova Palavra-passe (Opcional)' : 'Palavra-passe'}
                </label>
                <input
                  type="password"
                  placeholder={userEmEdicao ? 'Deixe em branco para manter a atual' : 'Mínimo 4 caracteres'}
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-muted/50 border border-border/80 text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-border/80">
                <button
                  type="button"
                  onClick={() => setModalUserAberto(false)}
                  className="px-3 py-1.5 rounded border border-border text-foreground hover:bg-muted font-mono text-xs cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoUser}
                  className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {salvandoUser ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>A guardar...</span>
                    </>
                  ) : (
                    <span>{userEmEdicao ? 'Guardar Alterações' : 'Criar Utilizador'}</span>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
