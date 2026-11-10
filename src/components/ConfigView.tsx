import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  SlidersHorizontal, 
  Database, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Edit2, 
  Trash2, 
  X, 
  User, 
  RefreshCw,
  LogOut,
  FolderOpen,
  Copy,
  HardDrive,
  Plus,
  Download,
  Building2,
  Check
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { AppUser, CentroDadosItem } from '../types/auth';

type UserSortColumn = 'nome' | 'email' | 'role' | 'centros' | 'ativo' | 'ultimo_login';

export function ConfigView() {
  const { 
    currentUser, 
    token,
    appConfig, 
    refreshConfig, 
    refreshUsers, 
    setShowLoginModal, 
    logout 
  } = useAuth();

  const isLoggedIn = !!currentUser;
  const isSub = currentUser?.role === 'subutilizador';
  const isAdm = currentUser?.role === 'admin';
  const isSuper = currentUser?.role === 'superadmin';
  const canManage = isAdm || isSuper || !currentUser;

  const getHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      h['X-Auth-Token'] = token;
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }, [token]);

  const [alimentarXmlLegado, setAlimentarXmlLegado] = useState<boolean>(() => {
    const saved = localStorage.getItem('gexcel_alimentar_xml_legado');
    return saved !== null ? saved === 'true' : true;
  });
  const [salvandoCentro, setSalvandoCentro] = useState<boolean>(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Modal de criação / edição de Centro de Dados Nomeado
  const [modalCentroAberto, setModalCentroAberto] = useState<boolean>(false);
  const [centroEmEdicao, setCentroEmEdicao] = useState<CentroDadosItem | null>(null);
  const [formCentroNome, setFormCentroNome] = useState<string>('');
  const [formCentroHost, setFormCentroHost] = useState<string>('');
  const [formCentroPastaEvogex, setFormCentroPastaEvogex] = useState<string>('');
  const [formCentroPastaAntiga, setFormCentroPastaAntiga] = useState<string>('');

  // Pastas locais resolvidas pela API
  const [pastasLocais, setPastasLocais] = useState<{
    pasta_evogex: string;
    pasta_motor: string;
    pasta_v4: string;
    pasta_v3: string;
    pasta_bdsrv: string;
    pasta_pdfs: string;
    db_path: string;
  }>({
    pasta_evogex: appConfig?.centro_dados_pasta_evogex || '',
    pasta_motor: appConfig?.centro_dados_pasta_motor || '',
    pasta_v4: appConfig?.pasta_v4 || '',
    pasta_v3: appConfig?.pasta_v3 || '',
    pasta_bdsrv: appConfig?.pasta_bdsrv || '',
    pasta_pdfs: appConfig?.pasta_pdfs || '',
    db_path: appConfig?.db_path || '',
  });

  // Lista de utilizadores e ordenação universal
  const [utilizadores, setUtilizadores] = useState<AppUser[]>([]);
  const [carregandoUsers, setCarregandoUsers] = useState<boolean>(false);
  const [sortCol, setSortCol] = useState<UserSortColumn>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Modal de criação / edição de utilizador
  const [modalUserAberto, setModalUserAberto] = useState<boolean>(false);
  const [userEmEdicao, setUserEmEdicao] = useState<AppUser | null>(null);
  const [formNome, setFormNome] = useState<string>('');
  const [formUsername, setFormUsername] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formRole, setFormRole] = useState<'admin' | 'subutilizador' | 'superadmin'>('subutilizador');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formAtivo, setFormAtivo] = useState<boolean>(true);
  const [formTodosCentros, setFormTodosCentros] = useState<boolean>(true);
  const [formCentrosSelecionados, setFormCentrosSelecionados] = useState<string[]>([]);
  const [salvandoUser, setSalvandoUser] = useState<boolean>(false);
  const [erroFormUser, setErroFormUser] = useState<string | null>(null);

  const pastaRaizRealMotor = useMemo(() => {
    const pV4 = pastasLocais.pasta_v4 || appConfig?.pasta_v4 || '';
    if (pV4) return pV4.replace(/[\\/]BdsefaturaV4[\\/]?$/i, '');
    const pV3 = pastasLocais.pasta_v3 || appConfig?.pasta_v3 || '';
    if (pV3) return pV3.replace(/[\\/]BdsefaturaV3[\\/]?$/i, '');
    return '';
  }, [pastasLocais.pasta_v4, pastasLocais.pasta_v3, appConfig?.pasta_v4, appConfig?.pasta_v3]);

  const centrosDadosLista = useMemo<CentroDadosItem[]>(() => {
    if (appConfig?.centros_dados && appConfig.centros_dados.length > 0) {
      return appConfig.centros_dados;
    }
    if (pastaRaizRealMotor) {
      const isEvogexFolder = /dados_evogex/i.test(pastaRaizRealMotor);
      return [
        {
          id: appConfig?.centro_dados_ativo_id || 'instalacao-local-atual',
          nome: appConfig?.centro_dados_nome || 'Escritório Principal (Motor Local)',
          hostname: appConfig?.centro_dados_hostname || 'COMPUTADOR-LOCAL',
          pasta_evogex: isEvogexFolder ? pastaRaizRealMotor : (appConfig?.centro_dados_pasta_evogex || ''),
          pasta_motor: isEvogexFolder ? `${pastaRaizRealMotor}\\motor` : (appConfig?.centro_dados_pasta_motor || ''),
          pasta_gexcel_antiga: isEvogexFolder ? (appConfig?.centro_dados_pasta_gexcel_antiga || '') : pastaRaizRealMotor,
          ativo: true,
          selecionado: true,
        },
      ];
    }
    return [];
  }, [appConfig, pastaRaizRealMotor]);

  useEffect(() => {
    setPastasLocais(prev => ({
      pasta_evogex: appConfig?.centro_dados_pasta_evogex || prev.pasta_evogex,
      pasta_motor: appConfig?.centro_dados_pasta_motor || prev.pasta_motor,
      pasta_v4: appConfig?.pasta_v4 || prev.pasta_v4,
      pasta_v3: appConfig?.pasta_v3 || prev.pasta_v3,
      pasta_bdsrv: appConfig?.pasta_bdsrv || prev.pasta_bdsrv,
      pasta_pdfs: appConfig?.pasta_pdfs || prev.pasta_pdfs,
      db_path: appConfig?.db_path || prev.db_path,
    }));
  }, [appConfig]);

  const carregarListaUtilizadores = useCallback(async () => {
    setCarregandoUsers(true);
    const users = await refreshUsers();
    setUtilizadores(users.filter(u => u.role !== 'superadmin' && !u.is_system));
    setCarregandoUsers(false);
  }, [refreshUsers]);

  useEffect(() => {
    carregarListaUtilizadores();
    fetch('http://127.0.0.1:8015/api/recibos-verdes/config')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (cfg) {
          if (typeof cfg.alimentar_xml_legado === 'boolean') {
            setAlimentarXmlLegado(cfg.alimentar_xml_legado);
            localStorage.setItem('gexcel_alimentar_xml_legado', String(cfg.alimentar_xml_legado));
          }
          setPastasLocais(prev => ({
            ...prev,
            pasta_v4: cfg.pasta_v4 || prev.pasta_v4,
            pasta_bdsrv: cfg.pasta_bdsrv || prev.pasta_bdsrv,
            pasta_pdfs: cfg.pasta_pdfs || prev.pasta_pdfs,
          }));
        }
      })
      .catch(() => {});
  }, [carregarListaUtilizadores]);

  const maxUsers = appConfig?.max_users || 5;
  const lugaresOcupados = utilizadores.length;

  const handleSortUsers = (col: UserSortColumn) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const formatarCentrosUser = useCallback((u: AppUser): string => {
    if (u.role === 'admin' || u.role === 'superadmin') return 'Todos os Centros';
    const perms = u.centros_permitidos || ['*'];
    if (perms.includes('*')) return 'Todos os Centros';
    const nomes = perms.map(cid => {
      const found = centrosDadosLista.find(c => c.id === cid);
      return found ? found.nome : cid;
    });
    return nomes.join(', ') || 'Todos os Centros';
  }, [centrosDadosLista]);

  const utilizadoresOrdenados = useMemo(() => {
    const arr = [...utilizadores];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'nome') {
        cmp = `${a.nome} ${a.username}`.localeCompare(`${b.nome} ${b.username}`, 'pt');
      } else if (sortCol === 'email') {
        cmp = (a.email || '').localeCompare(b.email || '', 'pt');
      } else if (sortCol === 'role') {
        cmp = a.role.localeCompare(b.role, 'pt');
      } else if (sortCol === 'centros') {
        cmp = formatarCentrosUser(a).localeCompare(formatarCentrosUser(b), 'pt');
      } else if (sortCol === 'ativo') {
        cmp = (a.ativo === b.ativo) ? 0 : a.ativo ? -1 : 1;
      } else if (sortCol === 'ultimo_login') {
        const isoA = a.ultimo_login || '';
        const isoB = b.ultimo_login || '';
        cmp = isoA.localeCompare(isoB);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [utilizadores, sortCol, sortDir, formatarCentrosUser]);

  const handleCopiarCaminho = async (caminho: string, label: string) => {
    if (!caminho) return;
    try {
      await navigator.clipboard.writeText(caminho);
      setMensagemSucesso(`Endereço copiado para a área de transferência (${label}).`);
    } catch {
      setMensagemErro('Não foi possível copiar o endereço automaticamente.');
    }
  };

  const handleAbrirNoWindows = async (caminho: string) => {
    if (!caminho) return;
    setMensagemErro(null);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho }),
      });
      if (!res.ok) {
        setMensagemErro('Para abrir pastas diretamente no Explorador do Windows, certifique-se de que o Motor Local está ativo neste computador.');
      }
    } catch {
      setMensagemErro('Para abrir pastas diretamente no Explorador do Windows, certifique-se de que o Motor Local está ativo neste computador.');
    }
  };

  const handleToggleXmlLegado = async (novoEstado: boolean) => {
    setAlimentarXmlLegado(novoEstado);
    localStorage.setItem('gexcel_alimentar_xml_legado', String(novoEstado));
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/config/xml-legado', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ alimentar_xml_legado: novoEstado }),
      });
      if (res.ok) {
        setMensagemSucesso(
          novoEstado
            ? 'Alimentação paralela dos ficheiros XML do evoGex Apps (BdsefaturaV3 e BdsRV) ATIVADA.'
            : 'Modo 100% SQLite (BdsefaturaV4) ativo — geração de ficheiros XML legados desativada.'
        );
      }
    } catch {}
  };

  const abrirModalNovoCentro = () => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório ser Administrador para adicionar Centros de Dados.');
      return;
    }
    const num = centrosDadosLista.length + 1;
    setCentroEmEdicao(null);
    setFormCentroNome(num === 1 ? 'Escritório Principal' : `Escritório ${num}`);
    setFormCentroHost(appConfig?.centro_dados_hostname || 'SERVIDOR-ESCRITORIO');
    setFormCentroPastaEvogex(num === 1 ? 'C:\\Dados_evoGex' : `C:\\Dados_evoGex_${num}`);
    setFormCentroPastaAntiga('');
    setModalCentroAberto(true);
  };

  const abrirModalEditarCentro = (centro: CentroDadosItem) => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório ser Administrador para editar Centros de Dados.');
      return;
    }
    setCentroEmEdicao(centro);
    setFormCentroNome(centro.nome);
    setFormCentroHost(centro.hostname || 'SERVIDOR-ESCRITORIO');
    setFormCentroPastaEvogex(centro.pasta_evogex || 'C:\\Dados_evoGex');
    setFormCentroPastaAntiga(centro.pasta_gexcel_antiga || '');
    setModalCentroAberto(true);
  };

  const handleGuardarCentroModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoCentro(true);
    setMensagemSucesso(null);
    setMensagemErro(null);
    const nomeLimpo = formCentroNome.trim() || 'Escritório Principal';
    const hostLimpo = formCentroHost.trim() || 'SERVIDOR-ESCRITORIO';
    const pastaEvoLimpa = formCentroPastaEvogex.trim() || 'C:\\Dados_evoGex';
    const pastaAntLimpa = formCentroPastaAntiga.trim();
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/centros-dados', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          centro_id: centroEmEdicao?.id,
          nome: nomeLimpo,
          hostname: hostLimpo,
          pasta_evogex: pastaEvoLimpa,
          pasta_gexcel_antiga: pastaAntLimpa,
          tornar_ativo: true,
        }),
      });
      if (res.ok) {
        setModalCentroAberto(false);
        await refreshConfig();
        setMensagemSucesso(`Centro de Dados '${nomeLimpo}' guardado e ativado com sucesso.`);
      } else {
        const err = await res.json();
        setMensagemErro(err.detail || 'Falha ao guardar Centro de Dados.');
      }
    } catch {
      // Computador novo sem motor local ainda em execução: descarrega automaticamente o instalador configurado!
      setModalCentroAberto(false);
      const n = encodeURIComponent(nomeLimpo);
      const pEvo = encodeURIComponent(pastaEvoLimpa);
      const pAnt = encodeURIComponent(pastaAntLimpa);
      window.open(`/api/sistema/instalador-centro-dados?nome=${n}&pasta_evogex=${pEvo}&pasta_gexcel_antiga=${pAnt}`, '_blank');
      setMensagemSucesso(
        `Instalador 'Instalar_Centro_Dados_evoGex.bat' transferido! Execute o ficheiro transferido para criar '${pastaEvoLimpa}' e ligar o Motor Local neste computador.`
      );
    } finally {
      setSalvandoCentro(false);
    }
  };

  const handleSelecionarCentro = async (centro: CentroDadosItem) => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/centros-dados/selecionar', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ centro_id: centro.id }),
      });
      if (res.ok) {
        await refreshConfig();
        setMensagemSucesso(`Centro de Dados ativo alterado para: ${centro.nome}`);
      }
    } catch {}
  };

  const handleEliminarCentro = async (centro: CentroDadosItem) => {
    if (centrosDadosLista.length <= 1) {
      setMensagemErro('Não é possível eliminar o único Centro de Dados registado.');
      return;
    }
    if (!window.confirm(`Deseja remover o Centro de Dados '${centro.nome}' da lista da plataforma? (Os ficheiros no disco não são apagados)`)) {
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/app/centros-dados/${encodeURIComponent(centro.id)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (res.ok) {
        await refreshConfig();
        setMensagemSucesso(`Centro de Dados '${centro.nome}' removido.`);
      } else {
        const err = await res.json();
        setMensagemErro(err.detail || 'Não foi possível remover o Centro de Dados.');
      }
    } catch {}
  };

  const handleDescarregarInstalador = (centro: CentroDadosItem) => {
    const n = encodeURIComponent(centro.nome || 'Escritório Principal');
    const pEvo = encodeURIComponent(centro.pasta_evogex || 'C:\\Dados_evoGex');
    const pAnt = encodeURIComponent(centro.pasta_gexcel_antiga || '');
    window.open(`/api/sistema/instalador-centro-dados?nome=${n}&pasta_evogex=${pEvo}&pasta_gexcel_antiga=${pAnt}`, '_blank');
  };

  const abrirCriacaoUser = (rolePredefinido: 'subutilizador' | 'admin' = 'subutilizador') => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
      return;
    }
    if (lugaresOcupados >= maxUsers) {
      setMensagemErro(`Limite de utilizadores atingido (${lugaresOcupados} de ${maxUsers} lugares contratados). Elimine um utilizador inativo ou amplie a licença da empresa.`);
      return;
    }
    setUserEmEdicao(null);
    setFormNome('');
    setFormUsername('');
    setFormEmail('');
    setFormRole(rolePredefinido);
    setFormPassword('');
    setFormAtivo(true);
    setFormTodosCentros(true);
    setFormCentrosSelecionados(centrosDadosLista.map(c => c.id));
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  const abrirEdicaoUser = (user: AppUser) => {
    if (!isLoggedIn) {
      setMensagemErro('Permissão negada. Inicie sessão para gerir o seu perfil.');
      return;
    }
    const isSelf = currentUser && user.id === currentUser.id;

    if (isSub && !isSelf) {
      setMensagemErro('Permissão negada. Um subutilizador não tem permissão para editar outros utilizadores.');
      return;
    }

    if (isAdm && user.role === 'admin' && !isSelf) {
      setMensagemErro('Não é permitido editar a conta de outro Administrador.');
      return;
    }

    const perms = user.centros_permitidos || ['*'];
    const isAll = perms.includes('*') || user.role === 'admin' || user.role === 'superadmin';

    setUserEmEdicao(user);
    setFormNome(user.nome);
    setFormUsername(user.username);
    setFormEmail(user.email || '');
    setFormRole(user.role as any);
    setFormPassword('');
    setFormAtivo(user.ativo);
    setFormTodosCentros(isAll);
    setFormCentrosSelecionados(isAll ? centrosDadosLista.map(c => c.id) : perms);
    setErroFormUser(null);
    setModalUserAberto(true);
  };

  const toggleCentroUserCheckbox = (cid: string) => {
    setFormCentrosSelecionados(prev =>
      prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
    );
  };

  const handleGuardarUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoUser(true);
    setErroFormUser(null);

    const centrosPayload =
      formRole === 'admin' || formTodosCentros
        ? ['*']
        : formCentrosSelecionados.length > 0
        ? formCentrosSelecionados
        : ['*'];

    try {
      if (userEmEdicao) {
        const isSelf = currentUser && userEmEdicao.id === currentUser.id;

        if (isSub && !isSelf) {
          setErroFormUser('Permissão negada. Um subutilizador não pode editar contas de outros utilizadores.');
          setSalvandoUser(false);
          return;
        }

        const body: any = {
          nome: formNome.trim(),
          email: formEmail.trim(),
          role: isSub ? 'subutilizador' : formRole,
          ativo: isSub ? true : formAtivo,
          centros_permitidos: isSub ? undefined : centrosPayload,
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
          await refreshConfig();
          setMensagemSucesso(`Utilizador '${formUsername}' atualizado com sucesso.`);
        } else {
          const err = await res.json();
          setErroFormUser(err.detail || 'Falha ao atualizar utilizador.');
        }
      } else {
        if (!canManage) {
          setErroFormUser('Permissão negada. É obrigatório iniciar sessão como Administrador para criar utilizadores.');
          setSalvandoUser(false);
          return;
        }

        if (lugaresOcupados >= maxUsers) {
          setErroFormUser(`Limite de utilizadores atingido (${lugaresOcupados}/${maxUsers}).`);
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
            password: formPassword.trim(),
            centros_permitidos: centrosPayload,
          })
        });

        if (res.ok) {
          setModalUserAberto(false);
          await carregarListaUtilizadores();
          await refreshConfig();
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

  const handleEliminarUser = async (user: AppUser) => {
    if (!canManage) {
      setMensagemErro('Permissão negada. É obrigatório iniciar sessão como Administrador para eliminar utilizadores.');
      return;
    }

    if (currentUser && user.id === currentUser.id) {
      setMensagemErro('Operação recusada: Não é permitido eliminar a sua própria conta enquanto a sua sessão estiver ativa.');
      return;
    }

    if (isAdm && user.role === 'admin') {
      setMensagemErro('Não tem permissão para eliminar outras contas de Administrador.');
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
        await refreshConfig();
        setMensagemSucesso(`Utilizador '${user.username}' removido com sucesso.`);
      } else {
        const err = await res.json();
        alert(err.detail || 'Falha ao remover utilizador.');
      }
    } catch (e: any) {
      alert(e.message || 'Erro de comunicação.');
    }
  };

  const renderSortIndicator = (col: UserSortColumn) => {
    if (sortCol !== col) {
      return <span className="ml-1 opacity-40 text-[10px]">⇅</span>;
    }
    return <span className="ml-1 text-[#0284c7] dark:text-sky-400 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const itensPastas = [
    {
      id: 'evogex_raiz',
      titulo: 'Pasta Unificada do Centro de Dados (Dados evoGex)',
      subtitulo: 'Diretório central onde residem o Motor, SafeDrive, PocketBase e Bases SQLite',
      caminho: pastasLocais.pasta_evogex || (/dados_evogex/i.test(pastaRaizRealMotor) ? pastaRaizRealMotor : ''),
    },
    {
      id: 'evogex_motor',
      titulo: 'Motor Local & Ponte do Centro de Dados (Dados_evoGex\\motor)',
      subtitulo: 'Motor instalado junto ao Centro de Dados (usado localmente e pelos portáteis em casa)',
      caminho: pastasLocais.pasta_motor || (pastasLocais.pasta_evogex ? `${pastasLocais.pasta_evogex}\\motor` : ''),
    },
    {
      id: 'v4',
      titulo: 'Bases SQLite Modernas (BdsefaturaV4)',
      subtitulo: 'Faturas de compras, vendas, anuladas, recibos verdes e controlo geral',
      caminho: pastasLocais.pasta_v4 || (pastasLocais.pasta_bdsrv ? pastasLocais.pasta_bdsrv.replace(/BdsRV$/i, 'BdsefaturaV4') : ''),
    },
    {
      id: 'v3',
      titulo: 'Ficheiros XML e-Fatura Antigos (BdsefaturaV3)',
      subtitulo: 'Alimentação paralela de compatibilidade com os mapas Excel (Dados GexcelApps)',
      caminho: pastasLocais.pasta_v3 || (pastasLocais.pasta_v4 ? pastasLocais.pasta_v4.replace(/BdsefaturaV4$/i, 'BdsefaturaV3') : ''),
    },
    {
      id: 'bdsrv',
      titulo: 'Ficheiros XML Recibos Verdes & Rendas (BdsRV)',
      subtitulo: 'Repositório estruturado de Recibos Verdes e Recibos de Renda por ano e NIF',
      caminho: pastasLocais.pasta_bdsrv,
    },
    {
      id: 'pdfs',
      titulo: 'Comprovativos PDF de Recibos Verdes & Rendas',
      subtitulo: 'Pasta destino dos documentos PDF oficiais descarregados da AT',
      caminho: pastasLocais.pasta_pdfs,
    },
  ];

  return (
    <div className="h-full flex flex-col space-y-4 min-h-0 select-none overflow-y-auto pr-1">
      
      {/* 1. Cabeçalho Oficial evoGex.com */}
      <header className="flex justify-between items-start shrink-0">
        <div>
          <span className="page-kicker text-primary font-mono text-[9.5px] uppercase tracking-[0.2em] font-semibold block mb-0.5">
            Painel de Controlo · evoGex.com
          </span>
          <h1 className="page-title text-xl font-display font-light text-foreground tracking-[-0.015em] flex items-center">
            Configurações do Sistema & Centros de Dados
          </h1>
          <p className="page-description text-slate-700 dark:text-slate-300 text-[11.5px] font-mono tracking-[0.03em] mt-0.5">
            Centros de Dados nomeados (Dados evoGex + Motor unificado), diretórios locais e acessos da equipa.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-2 bg-card border border-border px-3 py-1.5 rounded-full text-xs font-mono shadow-2xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
            <span className="text-slate-700 dark:text-slate-300">
              Centro Ativo: <strong className="text-foreground">{appConfig?.centro_dados_nome || 'Escritório Principal'}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Alertas de Notificação (100% Opacos) */}
      {mensagemSucesso && (
        <div className="p-3 bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-800 rounded-md text-emerald-800 dark:text-emerald-300 font-mono text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{mensagemSucesso}</span>
          </div>
          <button type="button" onClick={() => setMensagemSucesso(null)} className="text-emerald-700 dark:text-emerald-400 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mensagemErro && (
        <div className="p-3 bg-rose-50 dark:bg-[#290f14] border border-rose-400 dark:border-rose-800 rounded-md text-rose-800 dark:text-rose-300 font-mono text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
          <button type="button" onClick={() => setMensagemErro(null)} className="text-rose-700 dark:text-rose-400 hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Grid de Configurações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Card 1: Catálogo de Centros de Dados Nomeados & Instalador Unificado (100% Opaco) */}
        <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-[#0284c7] dark:text-sky-400" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Centros de Dados do Escritório ({centrosDadosLista.length})
              </span>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={abrirModalNovoCentro}
                className="px-2.5 py-1 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-[11px] font-semibold flex items-center space-x-1 cursor-pointer transition"
                title="Criar um novo Centro de Dados isolado (ex: Escritório da Maia, Porto, Empresas PHC / Sage)"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Novo Centro de Dados</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
            Cada Centro de Dados nomeado cria uma pasta nova unificada (<strong className="text-foreground">Dados evoGex</strong> com Motor, SafeDrive, PocketBase e SQLite juntos) e liga-se à respetiva pasta antiga (<strong className="text-foreground">Dados GexcelApps</strong>) sem misturar empresas.
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {centrosDadosLista.length === 0 ? (
              <div className="p-3 rounded-md border border-amber-400 dark:border-amber-800 bg-amber-50 dark:bg-[#241a08] space-y-2 font-mono text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center space-x-2 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Nenhum Centro de Dados / Motor Local detetado neste computador</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Se está num computador novo ou ainda não instalou o Centro de Dados local, clique abaixo para criar/instalar o Centro de Dados e o Motor.
                </p>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        window.open(
                          '/api/sistema/instalador-centro-dados?nome=Escrit%C3%B3rio%20Principal&pasta_evogex=C%3A%5CDados_evoGex',
                          '_blank'
                        );
                        setMensagemSucesso(
                          "Instalador 'Instalar_Centro_Dados_evoGex.bat' transferido! Execute o ficheiro transferido para criar 'C:\\Dados_evoGex' e iniciar o Motor Local."
                        );
                      }}
                      className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold flex items-center space-x-1.5 cursor-pointer transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Instalar Já (C:\Dados_evoGex + Motor)</span>
                    </button>
                    <button
                      type="button"
                      onClick={abrirModalNovoCentro}
                      className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-[11px] font-semibold flex items-center space-x-1.5 cursor-pointer transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Personalizar Pasta / Nome e Instalar</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              centrosDadosLista.map(centro => (
                <div
                  key={centro.id}
                  className={`p-3 rounded-md border space-y-2 font-mono text-xs transition ${
                    centro.selecionado
                      ? 'bg-sky-50 dark:bg-[#0a1929] border-[#0284c7]'
                      : 'bg-slate-50 dark:bg-[#132233] border-slate-300 dark:border-[#222f3e]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <Building2 className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />
                      <span className="font-bold text-foreground truncate">{centro.nome}</span>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 truncate">
                        ({centro.hostname})
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      {centro.selecionado ? (
                        <span className="text-[9.5px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800 flex items-center space-x-1">
                          <Check className="w-3 h-3" />
                          <span>EM USO</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelecionarCentro(centro)}
                          className="px-2 py-0.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white text-[10px] font-semibold cursor-pointer transition"
                        >
                          Ativar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDescarregarInstalador(centro)}
                        className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] hover:bg-emerald-100 dark:hover:bg-[#0e2d27] border border-emerald-400 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold flex items-center space-x-1 cursor-pointer transition"
                        title="Descarregar instalador de 1 clique (cria Dados evoGex + instala Motor, SafeDrive, PocketBase e SQLite)"
                      >
                        <Download className="w-3 h-3" />
                        <span>Instalador</span>
                      </button>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => abrirModalEditarCentro(centro)}
                            className="p-1 rounded bg-white dark:bg-[#0c1520] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300 cursor-pointer"
                            title="Editar nome e pastas deste Centro de Dados"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {centrosDadosLista.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleEliminarCentro(centro)}
                              className="p-1 rounded bg-white dark:bg-[#0c1520] hover:bg-rose-50 dark:hover:bg-[#290f14] border border-slate-300 dark:border-[#222f3e] text-rose-600 dark:text-rose-400 cursor-pointer"
                              title="Remover Centro de Dados"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-[10.5px]">
                    {centro.pasta_evogex ? (
                      <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#0c1520] px-2 py-1 rounded border border-slate-200 dark:border-[#222f3e]">
                        <span className="break-all text-slate-800 dark:text-slate-200">
                          <strong>Dados evoGex (Novo + Motor):</strong> {centro.pasta_evogex}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAbrirNoWindows(centro.pasta_evogex)}
                          className="text-amber-600 dark:text-amber-400 hover:underline shrink-0 flex items-center space-x-0.5 cursor-pointer"
                          title="Abrir no Explorador do Windows"
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>Abrir</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 bg-amber-50 dark:bg-[#241a08] px-2 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200">
                        <span>
                          <strong>Dados evoGex (Novo):</strong> Ainda não instalado — a ler diretamente da pasta ativa abaixo
                        </span>
                      </div>
                    )}
                    {centro.pasta_gexcel_antiga && (
                      <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#0c1520] px-2 py-1 rounded border border-slate-200 dark:border-[#222f3e]">
                        <span className="break-all text-slate-700 dark:text-slate-300">
                          <strong>Pasta Ativa / Dados GexcelApps:</strong> {centro.pasta_gexcel_antiga}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAbrirNoWindows(centro.pasta_gexcel_antiga)}
                          className="text-amber-600 dark:text-amber-400 hover:underline shrink-0 flex items-center space-x-0.5 cursor-pointer"
                          title="Abrir no Explorador do Windows"
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>Abrir</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2.5 pt-0.5">
            {/* Compatibilidade Paralela com Excel Apps (XML BdsefaturaV3 + BdsRV) */}
            <label className="p-3 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-[#091e1a] flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={alimentarXmlLegado}
                onChange={e => handleToggleXmlLegado(e.target.checked)}
                className="mt-0.5 rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
              />
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold font-mono text-xs text-emerald-950 dark:text-emerald-200">
                    Alimentar Dados Atuais do Excel Apps (XML Legado)
                  </span>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200 font-bold">
                    Dual-Write
                  </span>
                </div>
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  Grava nas bases SQLite (<code className="text-[10.5px]">BdsefaturaV4/{'{NIF}'}</code>) e atualiza em simultâneo os ficheiros XML na pasta antiga (<code className="text-[10.5px]">BdsefaturaV3</code> e <code className="text-[10.5px]">BdsRV</code>).
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Card 2: Sessão Ativa & Quota da Licença da Empresa (100% Opaco) */}
        <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col justify-between before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-emerald-500 before:z-20">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                  Sessão Ativa & Quota de Utilizadores
                </span>
              </div>
              <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800">
                {currentUser ? (currentUser.role === 'admin' || currentUser.role === 'superadmin' ? 'ADMINISTRADOR' : 'OPERADOR') : 'SEM SESSÃO'}
              </span>
            </div>

            {currentUser ? (
              <div className="space-y-3 pt-1">
                <div className="p-3 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-400 flex items-center justify-center font-mono font-bold text-sm border border-sky-300 dark:border-sky-800">
                      {currentUser.nome.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-semibold font-mono text-xs block text-foreground">
                        {currentUser.nome}
                      </span>
                      <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 block">
                        @{currentUser.username} {currentUser.email && `· ${currentUser.email}`}
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-800">
                    {currentUser.role === 'subutilizador' ? 'OPERADOR' : 'ADMIN'}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowLoginModal(true)}
                    className="flex-1 px-3 py-1.5 rounded bg-slate-50 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-xs font-mono transition cursor-pointer flex items-center justify-center space-x-1.5"
                  >
                    <User className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
                    <span>Trocar de Operador</span>
                  </button>

                  <button
                    type="button"
                    onClick={logout}
                    className="px-3 py-1.5 rounded bg-rose-50 dark:bg-[#290f14] hover:bg-rose-100 dark:hover:bg-[#3b151d] border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Terminar Sessão</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-center space-y-2.5">
                <p className="text-xs font-mono text-slate-700 dark:text-slate-300">
                  Inicie sessão com a sua conta de Administrador ou Operador para gerir permissões.
                </p>
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => setShowLoginModal(true)}
                    className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs cursor-pointer transition flex items-center space-x-1.5"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Iniciar Sessão</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resumo de Quota Contratada da Empresa */}
          <div className="p-3 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-2">
            <div className="flex items-center justify-between font-mono text-xs">
              <span className="font-semibold text-foreground">Lugares de Utilizador Ativos</span>
              <span className="font-bold text-[#0284c7] dark:text-sky-400">
                {lugaresOcupados} / {maxUsers} utilizados
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-[#0c1520] overflow-hidden border border-slate-300 dark:border-[#222f3e]">
              <div
                className={`h-full transition-all ${lugaresOcupados >= maxUsers ? 'bg-amber-500' : 'bg-[#0284c7]'}`}
                style={{ width: `${Math.min(100, Math.round((lugaresOcupados / Math.max(1, maxUsers)) * 100))}%` }}
              />
            </div>
            <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
              O Administrador da empresa pode adicionar ou remover operadores a qualquer momento dentro do limite de lugares da assinatura.
            </p>
          </div>
        </div>

        {/* Card 3: Pastas Locais & Transparência de Armazenamento (100% Opaco + Abrir no Windows + Copiar) */}
        <div className="md:col-span-2 relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-amber-500 before:z-20">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
            <div className="flex items-center space-x-2">
              <HardDrive className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Diretórios Locais de Dados & Ficheiros Fiscais
              </span>
            </div>
            <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-amber-100 dark:bg-[#241a08] text-amber-800 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-800">
              Leitura Completa
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {itensPastas.map(item => (
              <div
                key={item.id}
                className="p-2.5 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] flex flex-col justify-between space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold text-xs text-foreground block">
                      {item.titulo}
                    </span>
                    <span className="font-mono text-[10.5px] text-slate-700 dark:text-slate-300 block">
                      {item.subtitulo}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAbrirNoWindows(item.caminho)}
                      disabled={!item.caminho}
                      className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-sky-50 dark:hover:bg-[#0a1929] border border-slate-300 dark:border-[#222f3e] text-[10.5px] font-mono text-foreground flex items-center space-x-1 cursor-pointer transition disabled:opacity-40"
                      title="Abrir diretamente no Explorador do Windows (📂)"
                    >
                      <FolderOpen className="w-3 h-3 text-amber-500" />
                      <span>Abrir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopiarCaminho(item.caminho, item.titulo)}
                      disabled={!item.caminho}
                      className="px-2 py-1 rounded bg-white dark:bg-[#0c1520] hover:bg-sky-50 dark:hover:bg-[#0a1929] border border-slate-300 dark:border-[#222f3e] text-[10.5px] font-mono text-foreground flex items-center space-x-1 cursor-pointer transition disabled:opacity-40"
                      title="Copiar endereço completo (📋)"
                    >
                      <Copy className="w-3 h-3 text-[#0284c7] dark:text-sky-400" />
                      <span>Copiar</span>
                    </button>
                  </div>
                </div>
                <div
                  className="font-mono text-[11px] text-slate-800 dark:text-slate-200 bg-white dark:bg-[#0c1520] px-2.5 py-1.5 rounded border border-slate-200 dark:border-[#222f3e] break-all select-text"
                  title={item.caminho || 'A aguardar leitura do diretório...'}
                >
                  {item.caminho || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 4: Gestão de Utilizadores da Empresa (RBAC + Ordenação Universal) */}
        <div className="md:col-span-2 relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-4 space-y-3.5 shadow-2xs text-foreground flex flex-col before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-purple-500 before:z-20">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-2">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="font-semibold text-xs font-mono uppercase tracking-wider text-foreground">
                Utilizadores da Empresa & Perfis de Acesso ({lugaresOcupados}/{maxUsers})
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={carregarListaUtilizadores}
                disabled={carregandoUsers}
                className="p-1.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] transition cursor-pointer"
                title="Atualizar lista de utilizadores"
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
                    <span>+ Adicionar Operador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => abrirCriacaoUser('admin')}
                    className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#132233] hover:bg-slate-200 dark:hover:bg-[#1c314a] border border-slate-300 dark:border-[#222f3e] text-foreground font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition"
                    title="Adicionar um novo administrador da empresa"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0284c7] dark:text-sky-400" />
                    <span>+ Novo Administrador</span>
                  </button>
                </>
              ) : (
                <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e]">
                  Operador (Apenas Leitura)
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            Perfis disponíveis na empresa: <strong className="text-foreground">Administrador</strong> (gestão de utilizadores, configurações e retenção) e <strong className="text-foreground">Operador / Subutilizador</strong> (importação e consulta diária).
          </p>

          {/* Tabela de Utilizadores com Ordenação Universal */}
          <div className="overflow-x-auto rounded border border-slate-300 dark:border-[#222f3e]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-b border-slate-300 dark:border-[#222f3e] select-none">
                <tr>
                  <th
                    onClick={() => handleSortUsers('nome')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Nome / Utilizador {renderSortIndicator('nome')}
                  </th>
                  <th
                    onClick={() => handleSortUsers('email')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Email {renderSortIndicator('email')}
                  </th>
                  <th
                    onClick={() => handleSortUsers('role')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Perfil {renderSortIndicator('role')}
                  </th>
                  <th
                    onClick={() => handleSortUsers('centros')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Centros Autorizados {renderSortIndicator('centros')}
                  </th>
                  <th
                    onClick={() => handleSortUsers('ativo')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Estado {renderSortIndicator('ativo')}
                  </th>
                  <th
                    onClick={() => handleSortUsers('ultimo_login')}
                    className="py-2 px-3 cursor-pointer hover:text-foreground transition"
                  >
                    Último Acesso {renderSortIndicator('ultimo_login')}
                  </th>
                  <th className="py-2 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1b2b3d] bg-white dark:bg-[#0c1520]">
                {utilizadoresOrdenados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-600 dark:text-slate-400">
                      Nenhum operador adicional registado. Clique em &ldquo;+ Adicionar Operador&rdquo; para criar acessos para a sua equipa.
                    </td>
                  </tr>
                ) : (
                  utilizadoresOrdenados.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-[#132233] transition">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-foreground">{u.nome}</span>
                          <span className="text-[10px] text-slate-600 dark:text-slate-400">@{u.username}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {u.email || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          u.role === 'admin'
                            ? 'bg-sky-100 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-sky-300 dark:border-sky-800'
                            : 'bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#222f3e]'
                        }`}>
                          {u.role === 'admin' ? 'ADMINISTRADOR' : 'OPERADOR'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10.5px] font-medium px-2 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-slate-800 dark:text-slate-200 border border-sky-200 dark:border-sky-900">
                          {formatarCentrosUser(u)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[10px] font-semibold flex items-center space-x-1 ${
                          u.ativo ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.ativo ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          <span>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-700 dark:text-slate-300">
                        {u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('pt-PT') : 'Nunca'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {(() => {
                            const isSelf = currentUser && u.id === currentUser.id;
                            const podeEditar = isSuper || isAdm || (isSub && isSelf) || !currentUser;

                            if (podeEditar) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => abrirEdicaoUser(u)}
                                  className="p-1 rounded text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-slate-200 dark:hover:bg-[#1c314a] cursor-pointer transition"
                                  title={isSelf ? "Alterar a minha palavra-passe / perfil" : "Editar Utilizador / Alterar Palavra-passe"}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              );
                            }

                            return (
                              <span className="text-[9.5px] text-slate-600 dark:text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#132233]">
                                Bloqueado
                              </span>
                            );
                          })()}

                          {(() => {
                            const isSelf = currentUser && u.id === currentUser.id;
                            const podeEliminar = !isSelf && !isSub && (isSuper || (isAdm && u.role === 'subutilizador'));

                            if (podeEliminar) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleEliminarUser(u)}
                                  className="p-1 rounded text-slate-700 dark:text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-[#290f14] cursor-pointer transition"
                                  title="Eliminar Utilizador"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              );
                            }

                            if (isSelf) {
                              return (
                                <span className="text-[9px] text-[#0284c7] dark:text-sky-300 font-mono px-1.5 py-0.5 rounded bg-sky-100 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-800" title="Sua sessão ativa atual (auto-eliminação bloqueada)">
                                  Conta Ativa
                                </span>
                              );
                            }

                            return null;
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Modal de Criação / Edição de Centro de Dados Nomeado */}
      {modalCentroAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
          <div className="bg-white dark:bg-[#0c1520] w-full max-w-lg rounded-lg border border-slate-300 dark:border-[#222f3e] shadow-2xl p-5 space-y-4 relative text-foreground">
            <button
              type="button"
              onClick={() => setModalCentroAberto(false)}
              className="absolute right-3.5 top-3.5 text-slate-600 dark:text-slate-400 hover:text-foreground cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-200 dark:border-[#222f3e] pb-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-[#0a1929] flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0 border border-sky-300 dark:border-sky-800">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-display font-light text-foreground tracking-tight">
                  {centroEmEdicao ? `Editar Centro de Dados: ${centroEmEdicao.nome}` : 'Novo Centro de Dados Nomeado'}
                </h3>
                <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  Isole escritórios ou grupos de empresas (ex: Escritório da Maia, Porto, Empresas PHC, Empresas Sage)
                </p>
              </div>
            </div>

            <form onSubmit={handleGuardarCentroModal} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome do Centro de Dados (Visível no Topo da Plataforma)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Escritório da Maia, Escritório do Porto, Empresas PHC..."
                  value={formCentroNome}
                  onChange={e => setFormCentroNome(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Computador ou Servidor onde Reside
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: SERVIDOR-MAIA ou PC-ESCRITORIO"
                  value={formCentroHost}
                  onChange={e => setFormCentroHost(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Pasta Nova Unificada — Dados evoGex (Motor + SafeDrive + PocketBase + SQLite)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: C:\Dados_evoGex_Maia"
                  value={formCentroPastaEvogex}
                  onChange={e => setFormCentroPastaEvogex(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Pasta Antiga do Excel — Dados GexcelApps (Opcional, para carregar empresas/XMLs)
                </label>
                <input
                  type="text"
                  placeholder="Ex: C:\Dados_GexcelApps_Maia"
                  value={formCentroPastaAntiga}
                  onChange={e => setFormCentroPastaAntiga(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setModalCentroAberto(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#222f3e] text-foreground hover:bg-slate-100 dark:hover:bg-[#132233] font-mono text-xs cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoCentro}
                  className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {salvandoCentro ? 'A guardar...' : 'Guardar Centro de Dados'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criação / Edição de Utilizador */}
      {modalUserAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
          <div className="bg-white dark:bg-[#0c1520] w-full max-w-md rounded-lg border border-slate-300 dark:border-[#222f3e] shadow-2xl p-5 space-y-4 relative text-foreground">
            
            <button
              type="button"
              onClick={() => setModalUserAberto(false)}
              className="absolute right-3.5 top-3.5 text-slate-600 dark:text-slate-400 hover:text-foreground cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-200 dark:border-[#222f3e] pb-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-[#0a1929] flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0 border border-sky-300 dark:border-sky-800">
                {userEmEdicao ? <Edit2 className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="text-base font-display font-light text-foreground tracking-tight">
                  {userEmEdicao 
                    ? (isSub && userEmEdicao.id === currentUser?.id ? 'Alterar A Minha Palavra-passe / Perfil' : `Editar: ${userEmEdicao.nome}`)
                    : formRole === 'subutilizador'
                    ? 'Adicionar Novo Operador'
                    : 'Adicionar Novo Administrador'}
                </h3>
                <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  {userEmEdicao ? 'Atualize os dados ou redefina a palavra-passe' : 'Defina os dados de acesso do novo elemento da equipa'}
                </p>
              </div>
            </div>

            {erroFormUser && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-[#290f14] border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroFormUser}</span>
              </div>
            )}

            <form onSubmit={handleGuardarUser} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome do colaborador"
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome de Utilizador (Login)
                </label>
                <input
                  type="text"
                  required
                  disabled={!!userEmEdicao}
                  placeholder="utilizador"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Email (Opcional)
                </label>
                <input
                  type="email"
                  placeholder="colaborador@empresa.pt"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Perfil de Acesso
                  </label>
                  <select
                    value={formRole}
                    onChange={e => setFormRole(e.target.value as any)}
                    disabled={isSub}
                    className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    <option value="subutilizador">Operador (Subutilizador)</option>
                    {!isSub && <option value="admin">Administrador (Gestor)</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Estado da Conta
                  </label>
                  <select
                    value={formAtivo ? '1' : '0'}
                    onChange={e => setFormAtivo(e.target.value === '1')}
                    disabled={isSub}
                    className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7] cursor-pointer disabled:opacity-60"
                  >
                    <option value="1">Ativo (Permite Login)</option>
                    <option value="0">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Centros de Dados Autorizados para este Utilizador */}
              {!isSub && formRole === 'subutilizador' && (
                <div className="p-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formTodosCentros}
                      onChange={e => setFormTodosCentros(e.target.checked)}
                      className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7]"
                    />
                    <span className="font-semibold text-foreground text-[11px]">
                      Acesso a Todos os Centros de Dados da Empresa
                    </span>
                  </label>

                  {!formTodosCentros && (
                    <div className="pl-5 space-y-1.5 pt-1 border-t border-slate-200 dark:border-[#222f3e]">
                      <span className="block text-[10px] text-slate-600 dark:text-slate-400">
                        Selecione os Centros de Dados que este operador pode aceder:
                      </span>
                      {centrosDadosLista.map(c => (
                        <label key={c.id} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formCentrosSelecionados.includes(c.id)}
                            onChange={() => toggleCentroUserCheckbox(c.id)}
                            className="rounded border-slate-400 text-[#0284c7] focus:ring-[#0284c7]"
                          />
                          <span className="text-[11px] text-foreground">{c.nome}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  {userEmEdicao ? 'Nova Palavra-passe (Opcional)' : 'Palavra-passe'}
                </label>
                <input
                  type="password"
                  placeholder={userEmEdicao ? 'Deixe em branco para manter a atual' : 'Mínimo 4 caracteres'}
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-[#222f3e]">
                <button
                  type="button"
                  onClick={() => setModalUserAberto(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#222f3e] text-foreground hover:bg-slate-100 dark:hover:bg-[#132233] font-mono text-xs cursor-pointer transition"
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
