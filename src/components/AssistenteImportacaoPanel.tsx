import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  X,
  Check,
  Copy,
  FolderOpen,
  Edit3,
  Save,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  ShoppingCart,
  TrendingUp,
  Layers,
  Calendar,
  Play,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Building2,
  MousePointer2,
} from 'lucide-react';
import {
  isWindowsPath,
  obterLocalFsCentroConfig,
  obterResumoDestinosConfigurados,
  guardarLocalFsCentroConfig,
  escolherEInstalarPastaDadosEvogex,
  escolherPastaDadosGexcelAntigos,
  abrirPastaNoExploradorNativo,
  type ResumoDestinosConfigurados,
} from '../lib/localFsBridge';

export type ZonaSpotlight = 1 | 2 | 3 | 4 | null;

export interface AssistenteEmpresaItem {
  id: string;
  cod?: string;
  nif: string;
  nome: string;
}

export interface AssistenteImportacaoPanelProps {
  aberto: boolean;
  onClose: () => void;
  moduloTitulo: string;
  apiOnline: boolean | null;
  caminhoDados: string;
  onCaminhoDadosChange?: (novoCaminho: string) => void;
  // Passo 2: Operação & Empresas
  tipoOperacao: 'compras' | 'vendas' | 'ambos';
  permitirAmbos?: boolean;
  onTipoOperacaoChange: (op: 'compras' | 'vendas' | 'ambos') => void;
  empresas: AssistenteEmpresaItem[];
  selecionadasIds: Set<string>;
  onToggleEmpresa: (id: string) => void;
  onSelecionarTodasEmpresas: () => void;
  onLimparEmpresas: () => void;
  modoPrivacidade?: boolean;
  // Passo 3: Período
  ano: number;
  anoAtual: number;
  onAnoChange: (novoAno: number) => void;
  mesesSelecionados?: Set<number>;
  onToggleMes?: (mes: number) => void;
  onSelecionarAnoTodo?: () => void;
  onSelecionarMesAtual?: () => void;
  onSelecionarTrimestre?: (t: number) => void;
  apenasAnoCompleto?: boolean;
  // Passo 4: Opções extras & Disparo
  opcoesExtras?: ReactNode;
  isSyncing: boolean;
  labelBotaoIniciar?: string;
  onIniciarImportacao: () => void;
  // Destaque sincronizado (Spotlight) na interface principal
  passoAtivo: 1 | 2 | 3 | 4;
  onPassoAtivoChange: (p: 1 | 2 | 3 | 4) => void;
}

interface CursorOverlayState {
  visivel: boolean;
  x: number;
  y: number;
  clicando: boolean;
  animarMovimento: boolean;
  label: string;
  rippleId: number;
}

const MESES_CURTOS = [
  { num: 1, nome: 'Jan' },
  { num: 2, nome: 'Fev' },
  { num: 3, nome: 'Mar' },
  { num: 4, nome: 'Abr' },
  { num: 5, nome: 'Mai' },
  { num: 6, nome: 'Jun' },
  { num: 7, nome: 'Jul' },
  { num: 8, nome: 'Ago' },
  { num: 9, nome: 'Set' },
  { num: 10, nome: 'Out' },
  { num: 11, nome: 'Nov' },
  { num: 12, nome: 'Dez' },
];

function mascararNif(nif: string): string {
  if (!nif) return '';
  return '■'.repeat(Math.max(9, nif.length));
}

function mascararNome(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

function extrairPastaCurta(caminho: string): string {
  const partes = (caminho || '').split(/[\\/]/).filter(Boolean);
  if (partes.length === 0) return 'BdsefaturaV4';
  if (partes.length === 1) return partes[0];
  return `${partes[partes.length - 2]}\\${partes[partes.length - 1]}`;
}

export function AssistenteImportacaoPanel({
  aberto,
  onClose,
  moduloTitulo,
  apiOnline,
  caminhoDados,
  onCaminhoDadosChange,
  tipoOperacao,
  permitirAmbos = false,
  onTipoOperacaoChange,
  empresas,
  selecionadasIds,
  onToggleEmpresa,
  onSelecionarTodasEmpresas,
  onLimparEmpresas,
  modoPrivacidade = false,
  ano,
  anoAtual,
  onAnoChange,
  mesesSelecionados,
  onToggleMes,
  onSelecionarAnoTodo,
  onSelecionarMesAtual,
  onSelecionarTrimestre,
  apenasAnoCompleto = false,
  opcoesExtras,
  isSyncing,
  labelBotaoIniciar,
  onIniciarImportacao,
  passoAtivo,
  onPassoAtivoChange,
}: AssistenteImportacaoPanelProps) {
  const [passosConfirmados, setPassosConfirmados] = useState<Set<number>>(() => new Set());
  const [resumoConfig, setResumoConfig] = useState<ResumoDestinosConfigurados>(() => obterResumoDestinosConfigurados());
  const [copiado, setCopiado] = useState<boolean>(false);
  const [copiadoAntiga, setCopiadoAntiga] = useState<boolean>(false);
  const [editandoCaminho, setEditandoCaminho] = useState<boolean>(false);
  const [caminhoDraft, setCaminhoDraft] = useState<string>(caminhoDados);
  const [mensagemPasta, setMensagemPasta] = useState<string | null>(null);
  const [escolhendoPastaWin, setEscolhendoPastaWin] = useState<boolean>(false);
  const [escolhendoAntigaWin, setEscolhendoAntigaWin] = useState<boolean>(false);

  const [modoSelecaoEmpresas, setModoSelecaoEmpresas] = useState<'todas' | 'empresas' | 'nifs'>('todas');
  const [categoriaSlicer, setCategoriaSlicer] = useState<'todos' | 'sociedades' | 'singulares' | 'marcadas'>('todos');
  const [pesquisaEmpresa, setPesquisaEmpresa] = useState<string>('');
  const [opcoesAbertas, setOpcoesAbertas] = useState<boolean>(false);
  const [iniciandoAnimado, setIniciandoAnimado] = useState<boolean>(false);

  const [cursorOverlay, setCursorOverlay] = useState<CursorOverlayState>({
    visivel: false,
    x: -200,
    y: -200,
    clicando: false,
    animarMovimento: false,
    label: '',
    rippleId: 0,
  });

  const asideRef = useRef<HTMLElement>(null);
  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);

  const prevAbertoRef = useRef<boolean>(aberto);
  const lastCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const spotlightElRef = useRef<HTMLElement | null>(null);
  const animTimersRef = useRef<number[]>([]);
  const animRafRef = useRef<number | null>(null);

  const mesAtual = new Date().getMonth() + 1;

  const limparAnimacaoRato = useCallback((esconder = false) => {
    for (const t of animTimersRef.current) {
      window.clearTimeout(t);
    }
    animTimersRef.current = [];
    if (animRafRef.current !== null) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }
    if (spotlightElRef.current) {
      spotlightElRef.current.classList.remove('evo-guide-spotlight');
      spotlightElRef.current = null;
    }
    if (esconder) {
      setCursorOverlay(prev => (prev.visivel ? { ...prev, visivel: false, clicando: false } : prev));
    }
  }, []);

  useEffect(() => {
    const onFsUpdated = () => {
      setResumoConfig(obterResumoDestinosConfigurados());
    };
    window.addEventListener('gexcel-local-fs-updated', onFsUpdated);
    return () => window.removeEventListener('gexcel-local-fs-updated', onFsUpdated);
  }, []);

  useEffect(() => {
    if (aberto && !prevAbertoRef.current) {
      setPassosConfirmados(new Set());
      setIniciandoAnimado(false);
      setCategoriaSlicer('todos');
      onPassoAtivoChange(1);
    } else if (!aberto && prevAbertoRef.current) {
      limparAnimacaoRato(true);
      setIniciandoAnimado(false);
    }
    prevAbertoRef.current = aberto;
  }, [aberto, limparAnimacaoRato, onPassoAtivoChange]);

  useEffect(() => {
    return () => {
      limparAnimacaoRato(false);
    };
  }, [limparAnimacaoRato]);

  const animarRatoParaAlvo = useCallback(
    (
      targetKey: string,
      descricaoAcao: string,
      originEvent?: { clientX?: number; clientY?: number },
      onCompleteClick?: () => void,
      fallbackZone?: string
    ) => {
      limparAnimacaoRato(false);

      let targetEl = document.querySelector<HTMLElement>(`[data-evo-guide-target="${targetKey}"]`);
      if (!targetEl && fallbackZone) {
        targetEl = document.querySelector<HTMLElement>(`[data-evo-guide-target="${fallbackZone}"]`);
      }
      if (!targetEl) {
        onCompleteClick?.();
        return;
      }

      let rect = targetEl.getBoundingClientRect();
      if ((rect.width === 0 || rect.height === 0) && fallbackZone && targetKey !== fallbackZone) {
        const fallbackEl = document.querySelector<HTMLElement>(`[data-evo-guide-target="${fallbackZone}"]`);
        if (fallbackEl) {
          targetEl = fallbackEl;
          rect = fallbackEl.getBoundingClientRect();
        }
      }
      if (rect.width === 0 || rect.height === 0) {
        onCompleteClick?.();
        return;
      }

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      rect = targetEl.getBoundingClientRect();

      const targetX = Math.round(Math.max(18, Math.min(window.innerWidth - 24, rect.left + rect.width / 2)));
      const targetY = Math.round(Math.max(18, Math.min(window.innerHeight - 24, rect.top + rect.height / 2)));

      let startX: number;
      let startY: number;
      if (originEvent && typeof originEvent.clientX === 'number' && originEvent.clientX > 0 && typeof originEvent.clientY === 'number' && originEvent.clientY > 0) {
        startX = originEvent.clientX;
        startY = originEvent.clientY;
      } else if (lastCursorPosRef.current) {
        startX = lastCursorPosRef.current.x;
        startY = lastCursorPosRef.current.y;
      } else {
        const asideRect = asideRef.current?.getBoundingClientRect();
        startX = asideRect ? Math.round(asideRect.left + 80) : Math.round(window.innerWidth * 0.72);
        startY = asideRect ? Math.round(asideRect.top + 160) : Math.round(window.innerHeight * 0.35);
      }

      lastCursorPosRef.current = { x: targetX, y: targetY };

      setCursorOverlay({
        visivel: true,
        x: startX,
        y: startY,
        clicando: false,
        animarMovimento: false,
        label: descricaoAcao,
        rippleId: 0,
      });

      const elParaSpotlight = targetEl;

      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          setCursorOverlay(prev => ({
            ...prev,
            x: targetX,
            y: targetY,
            animarMovimento: true,
          }));
        });
        animRafRef.current = raf2;
      });
      animRafRef.current = raf1;

      const tArrive = window.setTimeout(() => {
        if (spotlightElRef.current && spotlightElRef.current !== elParaSpotlight) {
          spotlightElRef.current.classList.remove('evo-guide-spotlight');
        }
        elParaSpotlight.classList.add('evo-guide-spotlight');
        spotlightElRef.current = elParaSpotlight;

        setCursorOverlay(prev => ({
          ...prev,
          clicando: true,
          rippleId: Date.now(),
        }));
      }, 470);

      const tRelease = window.setTimeout(() => {
        setCursorOverlay(prev => ({
          ...prev,
          clicando: false,
        }));
      }, 690);

      animTimersRef.current.push(tArrive, tRelease);

      if (onCompleteClick) {
        const tDone = window.setTimeout(() => {
          limparAnimacaoRato(true);
          onCompleteClick();
        }, 860);
        animTimersRef.current.push(tDone);
      } else {
        const tFade = window.setTimeout(() => {
          if (spotlightElRef.current) {
            spotlightElRef.current.classList.remove('evo-guide-spotlight');
            spotlightElRef.current = null;
          }
          setCursorOverlay(prev => ({ ...prev, visivel: false, clicando: false }));
        }, 1900);
        animTimersRef.current.push(tFade);
      }
    },
    [limparAnimacaoRato]
  );

  const caminhoExibido = useMemo(() => {
    return isWindowsPath(caminhoDados) ? caminhoDados : resumoConfig.pastaV4;
  }, [caminhoDados, resumoConfig.pastaV4]);

  const pastaAntigaExibida = resumoConfig.pastaGexcelAntiga || 'C:\\Dados_GexcelApps';

  const contagensSlicer = useMemo(() => {
    let sociedades = 0;
    let singulares = 0;
    for (const e of empresas) {
      const nifTrim = (e.nif || '').trim();
      if (nifTrim.startsWith('5')) sociedades += 1;
      else if (/^[123]/.test(nifTrim)) singulares += 1;
    }
    return {
      todos: empresas.length,
      sociedades,
      singulares,
      marcadas: selecionadasIds.size,
    };
  }, [empresas, selecionadasIds]);

  const empresasFiltradas = useMemo(() => {
    const q = pesquisaEmpresa.trim().toLowerCase();
    const filtradas = empresas.filter(e => {
      const nifTrim = (e.nif || '').trim();
      if (categoriaSlicer === 'sociedades' && !nifTrim.startsWith('5')) return false;
      if (categoriaSlicer === 'singulares' && !/^[123]/.test(nifTrim)) return false;
      if (categoriaSlicer === 'marcadas' && !selecionadasIds.has(e.id)) return false;
      if (!q) return true;
      return (
        (e.nif || '').toLowerCase().includes(q) ||
        (e.nome || '').toLowerCase().includes(q) ||
        (e.cod || '').toLowerCase().includes(q)
      );
    });

    if (modoSelecaoEmpresas === 'empresas') {
      return [...filtradas].sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '', 'pt', { sensitivity: 'base' })
      );
    }
    if (modoSelecaoEmpresas === 'nifs') {
      return [...filtradas].sort((a, b) =>
        (a.nif || '').localeCompare(b.nif || '', 'pt', { numeric: true })
      );
    }
    return filtradas;
  }, [empresas, pesquisaEmpresa, categoriaSlicer, selecionadasIds, modoSelecaoEmpresas]);

  if (!aberto) return null;

  const irParaPasso = (
    p: 1 | 2 | 3 | 4,
    originEvent?: ReactMouseEvent<HTMLElement>,
    customTarget?: string,
    customLabel?: string
  ) => {
    onPassoAtivoChange(p);
    const zoneFallback = `zona-${p}`;
    const defaultLabels: Record<1 | 2 | 3 | 4, string> = {
      1: 'Passo 1 · Destino dos dados na barra',
      2: 'Passo 2 · Operação & Empresas na barra',
      3: 'Passo 3 · Período / Exercício na barra',
      4: 'Passo 4 · Botão de execução na barra',
    };
    animarRatoParaAlvo(
      customTarget || zoneFallback,
      customLabel || defaultLabels[p],
      originEvent ? { clientX: originEvent.clientX, clientY: originEvent.clientY } : undefined,
      undefined,
      zoneFallback
    );
    const refMap = { 1: step1Ref, 2: step2Ref, 3: step3Ref, 4: step4Ref };
    setTimeout(() => {
      refMap[p].current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const confirmarEAvancar = (
    atual: 1 | 2 | 3,
    proximo: 2 | 3 | 4,
    e: ReactMouseEvent<HTMLButtonElement>
  ) => {
    setPassosConfirmados(prev => {
      const next = new Set(prev);
      next.add(atual);
      return next;
    });
    const labels: Record<2 | 3 | 4, string> = {
      2: 'Passo 2 · Selecionar Operação e Empresas',
      3: 'Passo 3 · Definir Período na barra',
      4: 'Passo 4 · Pronto a iniciar na barra principal!',
    };
    irParaPasso(proximo, e, `zona-${proximo}`, labels[proximo]);
  };

  const copiarCaminho = async () => {
    try {
      await navigator.clipboard.writeText(caminhoExibido);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // ignora erro de clipboard
    }
  };

  const copiarCaminhoAntiga = async () => {
    try {
      await navigator.clipboard.writeText(pastaAntigaExibida);
      setCopiadoAntiga(true);
      setTimeout(() => setCopiadoAntiga(false), 1800);
    } catch {
      // ignora erro de clipboard
    }
  };

  const abrirPastaWindows = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    animarRatoParaAlvo('btn-abrir-pasta', 'Atalho de pasta na barra principal', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-1');
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: caminhoExibido }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {
      // fallback File System Access API
    }
    await abrirPastaNoExploradorNativo('BdsefaturaV4', 'evogex');
  };

  const abrirPastaAntigaWindows = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sistema/abrir-explorador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caminho: pastaAntigaExibida }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'ok' && d.origem !== 'cloud') return;
      }
    } catch {
      // fallback File System Access API
    }
    await abrirPastaNoExploradorNativo(undefined, 'antiga');
  };

  const escolherPastaNoWindows = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    setEscolhendoPastaWin(true);
    setMensagemPasta(null);
    const origin = { clientX: e.clientX, clientY: e.clientY };
    try {
      const baseProposta = caminhoExibido.replace(/[\\/](BdsefaturaV4|PDFs_Recibos|BdsRV)[\\/]?$/i, '') || 'C:\\Dados_evoGex';
      const res = await escolherEInstalarPastaDadosEvogex({ caminhoProposto: baseProposta });
      if (res.ok && res.config) {
        const novoCaminho = res.config.pasta_v4_display || `${res.config.pasta_evogex_display}\\BdsefaturaV4`;
        setCaminhoDraft(novoCaminho);
        onCaminhoDadosChange?.(novoCaminho);
        setResumoConfig(obterResumoDestinosConfigurados());
        setMensagemPasta('Pasta gravada e sincronizada com sucesso.');
        animarRatoParaAlvo('zona-1', 'Destino atualizado na barra principal', origin, undefined, 'zona-1');
      } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
        setMensagemPasta(res.erro);
      }
    } finally {
      setEscolhendoPastaWin(false);
    }
  };

  const escolherPastaAntigaNoWindows = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    setEscolhendoAntigaWin(true);
    setMensagemPasta(null);
    const origin = { clientX: e.clientX, clientY: e.clientY };
    try {
      const res = await escolherPastaDadosGexcelAntigos(pastaAntigaExibida);
      if (res.ok && res.config) {
        setResumoConfig(obterResumoDestinosConfigurados());
        setMensagemPasta(
          res.erro ||
            `Pasta GexcelApps ligada (${res.totalEntidades || 0} empresas carregadas).`
        );
        animarRatoParaAlvo('zona-1', 'Pasta Excel Antigo sincronizada', origin, undefined, 'zona-1');
      } else if (res.erro && res.erro !== 'Seleção de pasta cancelada.') {
        setMensagemPasta(res.erro);
      }
    } finally {
      setEscolhendoAntigaWin(false);
    }
  };

  const guardarCaminhoManual = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const limpo = (caminhoDraft || '').trim();
    if (!limpo || !isWindowsPath(limpo)) {
      setMensagemPasta('Introduza um caminho Windows válido (ex: C:\\Dados_evoGex\\BdsefaturaV4).');
      return;
    }
    const raiz = limpo.replace(/[\\/](BdsefaturaV4|PDFs_Recibos|BdsRV)[\\/]?$/i, '') || limpo;
    const atual = obterLocalFsCentroConfig();
    const atualizado = {
      id: atual?.id || 'escritorio-principal',
      nome: atual?.nome || 'Escritório Principal',
      hostname: atual?.hostname || 'COMPUTADOR-LOCAL',
      pasta_evogex_display: raiz,
      pasta_motor_display: `${raiz}\\motor`,
      pasta_v4_display: /bdsefaturav4$/i.test(limpo) ? limpo : `${raiz}\\BdsefaturaV4`,
      pasta_v3_display: atual?.pasta_v3_display || `${pastaAntigaExibida}\\BdsefaturaV3`,
      pasta_bdsrv_display: atual?.pasta_bdsrv_display || `${pastaAntigaExibida}\\BdsRV`,
      pasta_pdfs_display: atual?.pasta_pdfs_display || `${raiz}\\PDFs_Recibos`,
      pasta_gexcel_antiga_display: atual?.pasta_gexcel_antiga_display || '',
      ligado: true,
      evogex_confirmado: true,
      antiga_confirmada: atual?.antiga_confirmada || false,
      total_entidades_carregadas: atual?.total_entidades_carregadas,
      total_sqlites_gravados: atual?.total_sqlites_gravados,
      updated_at: new Date().toISOString(),
    };
    guardarLocalFsCentroConfig(atualizado);
    setResumoConfig(obterResumoDestinosConfigurados());
    onCaminhoDadosChange?.(atualizado.pasta_v4_display);
    setEditandoCaminho(false);
    setMensagemPasta('Destino dos dados gravado.');
    animarRatoParaAlvo('zona-1', 'Endereço atualizado na barra principal', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-1');
  };

  const podeIniciar =
    !isSyncing &&
    !iniciandoAnimado &&
    selecionadasIds.size > 0 &&
    (!mesesSelecionados || mesesSelecionados.size > 0);

  const labelOperacao =
    tipoOperacao === 'compras'
      ? 'Compras (Fornecedores)'
      : tipoOperacao === 'vendas'
        ? 'Vendas (Clientes)'
        : 'Compras & Vendas';

  const labelOperacaoCurto =
    tipoOperacao === 'compras'
      ? 'Compras'
      : tipoOperacao === 'vendas'
        ? 'Vendas'
        : 'Ambos';

  const executarIniciarComRato = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!podeIniciar) return;
    setIniciandoAnimado(true);
    animarRatoParaAlvo(
      'btn-iniciar',
      'A clicar no botão principal de execução!',
      { clientX: e.clientX, clientY: e.clientY },
      () => {
        setIniciandoAnimado(false);
        onIniciarImportacao();
        onClose();
      },
      'zona-4'
    );
  };

  return (
    <>
      <aside
        ref={asideRef}
        aria-label="Assistente Passo a Passo"
        className="w-full lg:w-[390px] xl:w-[420px] shrink-0 bg-[#fffbeb] dark:bg-[#141008] border-2 border-[#d97706] dark:border-[#b45309] rounded-md shadow-xl flex flex-col min-h-[360px] lg:min-h-0 overflow-hidden select-none"
      >
        {/* Cabeçalho Distinto do Assistente Guia (Âmbar Executivo 100% Opaco) */}
        <div className="relative evo-card-signature px-3.5 py-2.5 border-b border-[#f59e0b] dark:border-[#78350f] bg-[#fef3c7] dark:bg-[#1f180b] flex items-center justify-between gap-2 shrink-0 before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#d97706] dark:before:bg-[#fbbf24] before:z-20">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-[#fde68a] dark:bg-[#2c1f0a] border border-[#d97706] dark:border-[#f59e0b] flex items-center justify-center text-[#92400e] dark:text-[#fbbf24] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                Assistente Passo a Passo
              </div>
              <div className="text-[10px] font-mono font-semibold text-amber-950 dark:text-amber-200 truncate">
                {moduloTitulo} · Passo {passoAtivo} de 4
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              limparAnimacaoRato(true);
              onClose();
            }}
            title="Fechar Assistente e usar interface normal"
            className="h-7 px-2 rounded border border-[#d97706] dark:border-[#78350f] bg-white dark:bg-[#141008] hover:bg-[#fde68a] dark:hover:bg-[#2c1f0a] text-amber-950 dark:text-amber-100 text-[11px] font-mono font-semibold flex items-center space-x-1 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>Fechar</span>
          </button>
        </div>

        {/* Barra de Progresso Compacta dos 4 Passos (Navegação Livre) */}
        <div className="px-3 py-1.5 bg-[#fef3c7] dark:bg-[#1b1409] border-b border-[#fde68a] dark:border-[#4d2f0c] grid grid-cols-4 gap-1.5 shrink-0">
          {([1, 2, 3, 4] as const).map(num => {
            const ativo = num === passoAtivo;
            const confirmado = passosConfirmados.has(num);
            const tituloCurto = num === 1 ? '1. Destino' : num === 2 ? '2. Empresas' : num === 3 ? '3. Período' : '4. Iniciar';
            return (
              <button
                key={num}
                type="button"
                onClick={e => irParaPasso(num, e)}
                className={`py-1 px-1.5 rounded text-[10px] font-mono font-bold truncate border transition cursor-pointer ${
                  ativo
                    ? 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#b45309] dark:border-[#fbbf24] shadow-2xs'
                    : 'bg-[#fde68a] dark:bg-[#2d200b] text-amber-950 dark:text-amber-200 border-[#f59e0b] dark:border-[#78350f] hover:bg-[#fcd34d] dark:hover:bg-[#3c2a0f]'
                }`}
              >
                {confirmado && !ativo ? `✓ ${tituloCurto}` : tituloCurto}
              </button>
            );
          })}
        </div>

        {/* Corpo Acordeão: Todos os Passos Acessíveis Livremente (1 Aberto, Restantes Compactados) */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#fffbeb] dark:bg-[#141008]">
          {/* ================= PASSO 1: LIGAÇÃO E DESTINO DOS DADOS ================= */}
          {passoAtivo === 1 ? (
            <div
              ref={step1Ref}
              className="rounded-md border-2 border-[#d97706] dark:border-[#f59e0b] bg-white dark:bg-[#1c150a] p-3 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                      passosConfirmados.has(1)
                        ? 'bg-[#b45309] dark:bg-[#d97706] text-white'
                        : 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008]'
                    }`}
                  >
                    {passosConfirmados.has(1) ? <Check className="w-3.5 h-3.5" /> : '1'}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                    Ligação & Pasta de Destino
                  </span>
                </div>
                <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] shrink-0">
                  Passo Ativo
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                {/* Centro de Dados Ativo & Estado da Ligação */}
                <div className="px-2.5 py-2 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] text-[11px] font-mono space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-amber-200 flex items-center space-x-1">
                      <Building2 className="w-3.5 h-3.5 text-[#d97706] dark:text-[#fbbf24] shrink-0" />
                      <span>Centro Ativo:</span>
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white truncate" title={resumoConfig.nome}>
                      {resumoConfig.nome}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#fde68a] dark:border-[#3d280d]">
                    <span className="text-slate-700 dark:text-amber-200">Estado da Ligação:</span>
                    {apiOnline ? (
                      <span className="inline-flex items-center space-x-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Computador Ligado</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1.5 font-bold text-amber-800 dark:text-amber-300">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Motor Offline / Cloud</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 1. Pasta Dados evoGex (SQLite V4) */}
                <div className="p-2.5 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] space-y-1.5">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                    1. Pasta Dados evoGex (Bases SQLite V4):
                  </div>

                  {editandoCaminho ? (
                    <div className="flex items-center space-x-1">
                      <input
                        type="text"
                        value={caminhoDraft}
                        onChange={e => setCaminhoDraft(e.target.value)}
                        placeholder="Ex: C:\Dados_evoGex\BdsefaturaV4"
                        className="flex-1 text-[11px] font-mono bg-white dark:bg-[#1c150a] border border-[#d97706] rounded px-2 py-1 text-slate-900 dark:text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={guardarCaminhoManual}
                        title="Gravar caminho"
                        className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shrink-0"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoCaminho(false)}
                        title="Cancelar"
                        className="p-1.5 rounded bg-slate-200 dark:bg-[#2a1f0e] text-slate-900 dark:text-amber-100 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-1.5">
                      <span
                        title={caminhoExibido}
                        className="text-[11px] font-mono font-semibold text-slate-900 dark:text-white break-all leading-snug"
                      >
                        {caminhoExibido}
                      </span>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          type="button"
                          onClick={copiarCaminho}
                          title="Copiar endereço completo (📋)"
                          className="p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] text-slate-800 dark:text-amber-100 border border-[#f59e0b] dark:border-[#78350f] cursor-pointer"
                        >
                          {copiado ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={abrirPastaWindows}
                          title="Abrir pasta no Explorador do Windows (📂)"
                          className="p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] text-[#b45309] dark:text-[#fbbf24] border border-[#f59e0b] dark:border-[#78350f] cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={escolherPastaNoWindows}
                      disabled={escolhendoPastaWin}
                      className="px-2 py-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] border border-[#f59e0b] dark:border-[#78350f] text-[10.5px] font-mono font-semibold text-slate-900 dark:text-amber-100 flex items-center space-x-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3 h-3 text-[#b45309] dark:text-[#fbbf24]" />
                      <span>{escolhendoPastaWin ? 'A abrir Windows...' : 'Mudar Pasta'}</span>
                    </button>
                    {!editandoCaminho && (
                      <button
                        type="button"
                        onClick={() => {
                          setCaminhoDraft(caminhoExibido);
                          setEditandoCaminho(true);
                        }}
                        className="px-2 py-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] border border-[#f59e0b] dark:border-[#78350f] text-[10.5px] font-mono text-slate-800 dark:text-amber-200 flex items-center space-x-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Editar Endereço</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Pasta Dados Antigos Excel (GexcelApps / XML) */}
                <div className="p-2.5 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] space-y-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                      2. Pasta Excel Antigo (GexcelApps / XML):
                    </span>
                    {resumoConfig.antigaConfirmada && (
                      <span className="text-[9.5px] font-mono font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                        Ligada
                      </span>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-1.5">
                    <span
                      title={pastaAntigaExibida}
                      className="text-[11px] font-mono font-semibold text-slate-900 dark:text-white break-all leading-snug"
                    >
                      {pastaAntigaExibida}
                    </span>
                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        onClick={copiarCaminhoAntiga}
                        title="Copiar endereço completo (📋)"
                        className="p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] text-slate-800 dark:text-amber-100 border border-[#f59e0b] dark:border-[#78350f] cursor-pointer"
                      >
                        {copiadoAntiga ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={abrirPastaAntigaWindows}
                        title="Abrir pasta no Explorador do Windows (📂)"
                        className="p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] text-[#b45309] dark:text-[#fbbf24] border border-[#f59e0b] dark:border-[#78350f] cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-slate-700 dark:text-amber-200 break-all">
                    XML: {resumoConfig.pastaV3} · {resumoConfig.pastaBdsrv}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={escolherPastaAntigaNoWindows}
                      disabled={escolhendoAntigaWin}
                      className="px-2 py-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] border border-[#f59e0b] dark:border-[#78350f] text-[10.5px] font-mono font-semibold text-slate-900 dark:text-amber-100 flex items-center space-x-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>{escolhendoAntigaWin ? 'A abrir Windows...' : 'Mudar Pasta Antiga'}</span>
                    </button>
                  </div>
                </div>

                {mensagemPasta && (
                  <div className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 font-semibold px-1">
                    {mensagemPasta}
                  </div>
                )}

                <button
                  type="button"
                  onClick={e => confirmarEAvancar(1, 2, e)}
                  className="w-full py-2 px-3 rounded bg-[#d97706] hover:bg-[#b45309] text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
                >
                  <span>Confirmar Destino e Avançar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={e => irParaPasso(1, e)}
              className="w-full text-left rounded-md border border-[#fcd34d] dark:border-[#78350f] bg-[#fef3c7] dark:bg-[#191309] hover:border-[#d97706] dark:hover:border-[#f59e0b] px-3 py-2 transition-colors cursor-pointer flex items-center justify-between gap-2"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold shrink-0 ${
                    passosConfirmados.has(1) ? 'bg-[#b45309] dark:bg-[#d97706] text-white' : 'bg-[#d97706] text-white'
                  }`}
                >
                  {passosConfirmados.has(1) ? <Check className="w-3 h-3" /> : '1'}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                  Destino · {apiOnline ? 'Ligado' : 'Cloud'} · {extrairPastaCurta(caminhoExibido)}
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-[9.5px] font-mono font-bold text-amber-900 dark:text-amber-300 shrink-0">
                {passosConfirmados.has(1) ? 'Alterar' : 'Abrir'}
              </span>
            </button>
          )}

          {/* ================= PASSO 2: OPERAÇÃO & EMPRESAS ================= */}
          {passoAtivo === 2 ? (
            <div
              ref={step2Ref}
              className="rounded-md border-2 border-[#d97706] dark:border-[#f59e0b] bg-white dark:bg-[#1c150a] p-3 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                      passosConfirmados.has(2)
                        ? 'bg-[#b45309] dark:bg-[#d97706] text-white'
                        : 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008]'
                    }`}
                  >
                    {passosConfirmados.has(2) ? <Check className="w-3.5 h-3.5" /> : '2'}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                    Quem Importar (Operação & Empresas)
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#fef3c7] dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-amber-900 dark:text-amber-300 shrink-0 tabular-nums">
                  {selecionadasIds.size}/{empresas.length}
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                {/* Operação Compras vs Vendas */}
                <div className={`grid gap-1.5 ${permitirAmbos ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {permitirAmbos && (
                    <button
                      type="button"
                      onClick={e => {
                        onTipoOperacaoChange('ambos');
                        animarRatoParaAlvo('op-ambos', 'Operação alterada para Ambos', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                      }}
                      className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                        tipoOperacao === 'ambos'
                          ? 'bg-[#d97706] text-white border-[#d97706]'
                          : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-800 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11]'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>Ambos</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={e => {
                      onTipoOperacaoChange('compras');
                      animarRatoParaAlvo('op-compras', 'Operação definida para Compras', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                    }}
                    className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                      tipoOperacao === 'compras'
                        ? 'bg-[#0284c7] text-white border-[#0284c7]'
                        : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-800 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11]'
                    }`}
                  >
                    <ShoppingCart className="w-3 h-3" />
                    <span>Compras</span>
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      onTipoOperacaoChange('vendas');
                      animarRatoParaAlvo('op-vendas', 'Operação definida para Vendas', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                    }}
                    className={`py-1.5 px-2 rounded text-[11px] font-mono font-semibold border flex items-center justify-center space-x-1 cursor-pointer transition ${
                      tipoOperacao === 'vendas'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-800 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11]'
                    }`}
                  >
                    <TrendingUp className="w-3 h-3" />
                    <span>Vendas</span>
                  </button>
                </div>

                {/* Slicer Principal: Todas vs Empresas vs NIFs */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={e => {
                      setModoSelecaoEmpresas('todas');
                      onSelecionarTodasEmpresas();
                      animarRatoParaAlvo('empresa-selector', `Todas (${empresas.length}) selecionadas na tabela`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                    }}
                    className={`py-1.5 px-1.5 rounded text-[11px] font-mono font-bold border cursor-pointer transition truncate ${
                      modoSelecaoEmpresas === 'todas'
                        ? 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#b45309] dark:border-[#fbbf24] shadow-2xs'
                        : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-900 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706]'
                    }`}
                  >
                    Todas ({empresas.length})
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      setModoSelecaoEmpresas('empresas');
                      animarRatoParaAlvo('empresa-selector', 'Slicer por Nome de Empresa ativo', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                    }}
                    className={`py-1.5 px-1.5 rounded text-[11px] font-mono font-bold border cursor-pointer transition truncate ${
                      modoSelecaoEmpresas === 'empresas'
                        ? 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#b45309] dark:border-[#fbbf24] shadow-2xs'
                        : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-900 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706]'
                    }`}
                  >
                    Empresas
                  </button>
                  <button
                    type="button"
                    onClick={e => {
                      setModoSelecaoEmpresas('nifs');
                      animarRatoParaAlvo('empresa-selector', 'Slicer por NIF ativo', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                    }}
                    className={`py-1.5 px-1.5 rounded text-[11px] font-mono font-bold border cursor-pointer transition truncate ${
                      modoSelecaoEmpresas === 'nifs'
                        ? 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#b45309] dark:border-[#fbbf24] shadow-2xs'
                        : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-900 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706]'
                    }`}
                  >
                    NIFs
                  </button>
                </div>

                {/* Slicer Secundário de Categoria (Sociedades, Singulares, Marcadas) */}
                <div className="flex flex-wrap gap-1">
                  {([
                    { id: 'todos', label: `Todos (${contagensSlicer.todos})` },
                    { id: 'sociedades', label: `Sociedades 5xx (${contagensSlicer.sociedades})` },
                    { id: 'singulares', label: `Singulares 1/2xx (${contagensSlicer.singulares})` },
                    { id: 'marcadas', label: `Marcadas (${contagensSlicer.marcadas})` },
                  ] as const).map(cat => {
                    const ativo = categoriaSlicer === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={e => {
                          setCategoriaSlicer(cat.id);
                          animarRatoParaAlvo('empresa-selector', `Filtro: ${cat.label}`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition cursor-pointer ${
                          ativo
                            ? 'bg-[#b45309] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#92400e] dark:border-[#fbbf24]'
                            : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-800 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706]'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                {/* Lista Pesquisável de Empresas / NIFs */}
                <div className="bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-[#fef3c7] dark:bg-[#191309] border border-[#fde68a] dark:border-[#4d2f0c] text-[10px] font-mono font-bold text-slate-900 dark:text-amber-100">
                    <span className="truncate">
                      {selecionadasIds.size === empresas.length && empresas.length > 0
                        ? `Todas já incluídas (${selecionadasIds.size}/${empresas.length})`
                        : `${selecionadasIds.size} de ${empresas.length} selecionada(s)`}
                    </span>
                    <span className="text-amber-900 dark:text-amber-300 shrink-0 tabular-nums">
                      Vista: {empresasFiltradas.length}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <div className="relative flex-1">
                      <Search className="w-3 h-3 text-amber-800 dark:text-amber-300 absolute left-2 top-2" />
                      <input
                        type="text"
                        value={pesquisaEmpresa}
                        onChange={e => setPesquisaEmpresa(e.target.value)}
                        placeholder={
                          modoSelecaoEmpresas === 'nifs'
                            ? 'Pesquisar NIF...'
                            : modoSelecaoEmpresas === 'empresas'
                              ? 'Pesquisar nome da empresa...'
                              : 'Pesquisar NIF, nome ou código...'
                        }
                        className="w-full text-[11px] font-mono bg-white dark:bg-[#1c150a] border border-[#fcd34d] dark:border-[#5c3a11] rounded pl-6 pr-2 py-1 text-slate-900 dark:text-white focus:outline-none focus:border-[#d97706]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={empresasFiltradas.length === 0 || empresasFiltradas.every(emp => selecionadasIds.has(emp.id))}
                      onClick={e => {
                        if (empresasFiltradas.length === empresas.length && empresas.length > 0) {
                          onSelecionarTodasEmpresas();
                        } else {
                          for (const emp of empresasFiltradas) {
                            if (!selecionadasIds.has(emp.id)) {
                              onToggleEmpresa(emp.id);
                            }
                          }
                        }
                        animarRatoParaAlvo('empresa-selector', `${empresasFiltradas.length} marcadas na matriz`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                      }}
                      className="px-2 py-1 rounded bg-[#d97706] hover:bg-[#b45309] disabled:opacity-45 disabled:cursor-not-allowed text-white text-[10px] font-mono font-bold cursor-pointer shrink-0 transition"
                    >
                      Marcar ({empresasFiltradas.length})
                    </button>
                    <button
                      type="button"
                      disabled={selecionadasIds.size === 0}
                      onClick={e => {
                        onLimparEmpresas();
                        animarRatoParaAlvo('empresa-selector', 'Seleção limpa na barra principal', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-2');
                      }}
                      className="px-2 py-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] border border-[#f59e0b] dark:border-[#78350f] disabled:opacity-45 disabled:cursor-not-allowed text-[10px] font-mono font-semibold text-amber-950 dark:text-amber-200 cursor-pointer shrink-0"
                    >
                      Limpar
                    </button>
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-[#fde68a] dark:divide-[#36240c]">
                    {empresasFiltradas.map(emp => {
                      const checked = selecionadasIds.has(emp.id);
                      const nifExibido = modoPrivacidade ? mascararNif(emp.nif) : emp.nif;
                      const nomeExibido = modoPrivacidade ? mascararNome(emp.nome) : emp.nome;
                      return (
                        <label
                          key={emp.id}
                          className={`flex items-center space-x-2 py-1.5 px-1 cursor-pointer text-[11px] font-mono hover:bg-[#fef3c7] dark:hover:bg-[#1f170b] ${
                            checked ? 'bg-[#fef3c7] dark:bg-[#241a0b]' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              onToggleEmpresa(emp.id);
                              animarRatoParaAlvo('empresa-selector', `${checked ? 'Removida' : 'Selecionada'} na matriz`, undefined, undefined, 'zona-2');
                            }}
                            className="w-3.5 h-3.5 rounded accent-[#d97706] cursor-pointer shrink-0"
                          />
                          {modoSelecaoEmpresas === 'empresas' ? (
                            <>
                              <span className="font-sans font-semibold text-slate-900 dark:text-amber-50 truncate flex-1">
                                {nomeExibido}
                              </span>
                              <span className="text-[#b45309] dark:text-[#fbbf24] font-bold shrink-0 text-[10.5px]">
                                {nifExibido}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-[#b45309] dark:text-[#fbbf24] font-bold shrink-0">
                                {nifExibido}
                              </span>
                              <span className="font-sans text-slate-900 dark:text-amber-50 truncate flex-1">
                                {nomeExibido}
                              </span>
                            </>
                          )}
                        </label>
                      );
                    })}
                    {empresasFiltradas.length === 0 && (
                      <div className="py-3 text-center text-[11px] font-mono text-slate-700 dark:text-amber-200">
                        Nenhuma entidade encontrada.
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={e => confirmarEAvancar(2, 3, e)}
                  className="w-full py-2 px-3 rounded bg-[#d97706] hover:bg-[#b45309] text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
                >
                  <span>
                    {selecionadasIds.size > 0
                      ? `Confirmar Empresas (${selecionadasIds.size}) e Avançar`
                      : 'Avançar para Período'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={e => irParaPasso(2, e)}
              className="w-full text-left rounded-md border border-[#fcd34d] dark:border-[#78350f] bg-[#fef3c7] dark:bg-[#191309] hover:border-[#d97706] dark:hover:border-[#f59e0b] px-3 py-2 transition-colors cursor-pointer flex items-center justify-between gap-2"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold shrink-0 ${
                    passosConfirmados.has(2) ? 'bg-[#b45309] dark:bg-[#d97706] text-white' : 'bg-[#d97706] text-white'
                  }`}
                >
                  {passosConfirmados.has(2) ? <Check className="w-3 h-3" /> : '2'}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                  Empresas · {labelOperacaoCurto} · {selecionadasIds.size} selecionada(s)
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-[9.5px] font-mono font-bold text-amber-900 dark:text-amber-300 shrink-0">
                {passosConfirmados.has(2) ? 'Alterar' : 'Abrir'}
              </span>
            </button>
          )}

          {/* ================= PASSO 3: PERÍODO ================= */}
          {passoAtivo === 3 ? (
            <div
              ref={step3Ref}
              className="rounded-md border-2 border-[#d97706] dark:border-[#f59e0b] bg-white dark:bg-[#1c150a] p-3 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                      passosConfirmados.has(3)
                        ? 'bg-[#b45309] dark:bg-[#d97706] text-white'
                        : 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008]'
                    }`}
                  >
                    {passosConfirmados.has(3) ? <Check className="w-3.5 h-3.5" /> : '3'}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                    Que Período Importar
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#fef3c7] dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-amber-900 dark:text-amber-300 shrink-0">
                  {ano}{mesesSelecionados ? ` · ${mesesSelecionados.size}m` : ''}
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                {/* Seletor de Ano */}
                <div className="flex items-center justify-between bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] rounded px-2.5 py-1.5">
                  <div className="flex items-center space-x-1.5 text-xs font-mono font-semibold text-slate-900 dark:text-amber-50">
                    <Calendar className="w-3.5 h-3.5 text-[#d97706] dark:text-[#fbbf24]" />
                    <span>Exercício Fiscal</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={e => {
                        const novo = ano - 1;
                        onAnoChange(novo);
                        animarRatoParaAlvo('ano-selector', `Exercício alterado para ${novo}`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                      }}
                      className="p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] hover:bg-[#fde68a] dark:hover:bg-[#33240f] text-slate-900 dark:text-amber-100 cursor-pointer"
                      title="Ano Anterior"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono font-black text-sm text-slate-900 dark:text-white min-w-[44px] text-center">
                      {ano}
                    </span>
                    <button
                      type="button"
                      onClick={e => {
                        if (ano < anoAtual) {
                          const novo = ano + 1;
                          onAnoChange(novo);
                          animarRatoParaAlvo('ano-selector', `Exercício alterado para ${novo}`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                        }
                      }}
                      disabled={ano >= anoAtual}
                      className={`p-1 rounded bg-[#fef3c7] dark:bg-[#241a0b] text-slate-900 dark:text-amber-100 ${
                        ano >= anoAtual ? 'opacity-25 cursor-not-allowed' : 'hover:bg-[#fde68a] dark:hover:bg-[#33240f] cursor-pointer'
                      }`}
                      title="Ano Seguinte"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {!apenasAnoCompleto && mesesSelecionados && onToggleMes ? (
                  <>
                    {/* Atalhos Rápidos */}
                    <div className="flex flex-wrap items-center gap-1 text-[10.5px] font-mono">
                      {onSelecionarAnoTodo && (
                        <button
                          type="button"
                          onClick={e => {
                            onSelecionarAnoTodo();
                            animarRatoParaAlvo('periodo-ano-todo', 'Ano completo marcado na barra', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                          }}
                          className="px-2 py-1 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706] font-semibold text-slate-900 dark:text-amber-100 cursor-pointer"
                        >
                          Ano Completo
                        </button>
                      )}
                      {onSelecionarMesAtual && ano === anoAtual && (
                        <button
                          type="button"
                          onClick={e => {
                            onSelecionarMesAtual();
                            animarRatoParaAlvo('periodo-mes-atual', 'Mês atual marcado na barra', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                          }}
                          className="px-2 py-1 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706] font-semibold text-slate-900 dark:text-amber-100 cursor-pointer"
                        >
                          Mês Atual
                        </button>
                      )}
                      {onSelecionarTrimestre &&
                        [1, 2, 3, 4].map(t => (
                          <button
                            key={t}
                            type="button"
                            onClick={e => {
                              onSelecionarTrimestre(t);
                              animarRatoParaAlvo('zona-3', `T${t} selecionado na matriz`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                            }}
                            className="px-1.5 py-1 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706] font-bold text-slate-900 dark:text-amber-100 cursor-pointer"
                          >
                            T{t}
                          </button>
                        ))}
                    </div>

                    {/* Grelha 12 Meses */}
                    <div className="grid grid-cols-4 gap-1">
                      {MESES_CURTOS.map(m => {
                        const futuro = ano === anoAtual && m.num > mesAtual;
                        const ativo = mesesSelecionados.has(m.num);
                        return (
                          <button
                            key={m.num}
                            type="button"
                            disabled={futuro}
                            onClick={e => {
                              onToggleMes(m.num);
                              animarRatoParaAlvo('zona-3', `${m.nome} atualizado no período`, { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-3');
                            }}
                            className={`py-1 rounded text-[11px] font-mono font-semibold border transition cursor-pointer ${
                              futuro
                                ? 'opacity-30 cursor-not-allowed bg-[#f5e8c2] dark:bg-[#1a140b] border-[#e2cb85] dark:border-[#3c2b12] text-amber-800 dark:text-amber-500'
                                : ativo
                                  ? 'bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] border-[#b45309] font-bold'
                                  : 'bg-[#fffdf5] dark:bg-[#120e07] text-slate-800 dark:text-amber-100 border-[#fcd34d] dark:border-[#5c3a11] hover:border-[#d97706]'
                            }`}
                          >
                            {m.nome}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="px-2.5 py-1.5 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] text-[11px] font-mono text-slate-800 dark:text-amber-200">
                    Extração configurada para todo o exercício de <strong className="text-slate-950 dark:text-white">{ano}</strong>.
                  </div>
                )}

                <button
                  type="button"
                  disabled={mesesSelecionados ? mesesSelecionados.size === 0 : false}
                  onClick={e => confirmarEAvancar(3, 4, e)}
                  className="w-full py-2 px-3 rounded bg-[#d97706] hover:bg-[#b45309] disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs transition"
                >
                  <span>Confirmar Período e Avançar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={e => irParaPasso(3, e)}
              className="w-full text-left rounded-md border border-[#fcd34d] dark:border-[#78350f] bg-[#fef3c7] dark:bg-[#191309] hover:border-[#d97706] dark:hover:border-[#f59e0b] px-3 py-2 transition-colors cursor-pointer flex items-center justify-between gap-2"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold shrink-0 ${
                    passosConfirmados.has(3) ? 'bg-[#b45309] dark:bg-[#d97706] text-white' : 'bg-[#d97706] text-white'
                  }`}
                >
                  {passosConfirmados.has(3) ? <Check className="w-3 h-3" /> : '3'}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                  Período · Exercício {ano}{mesesSelecionados ? ` (${mesesSelecionados.size}m)` : ' (Ano todo)'}
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-[9.5px] font-mono font-bold text-amber-900 dark:text-amber-300 shrink-0">
                {passosConfirmados.has(3) ? 'Alterar' : 'Abrir'}
              </span>
            </button>
          )}

          {/* ================= PASSO 4: RESUMO E INICIAR ================= */}
          {passoAtivo === 4 ? (
            <div
              ref={step4Ref}
              className="rounded-md border-2 border-[#d97706] dark:border-[#f59e0b] bg-white dark:bg-[#1c150a] p-3 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] flex items-center justify-center text-xs font-mono font-bold shrink-0">
                    4
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                    Confirmar e Iniciar Importação
                  </span>
                </div>
                <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#d97706] dark:bg-[#f59e0b] text-white dark:text-[#141008] shrink-0">
                  Passo Final
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                <div className="p-2.5 rounded bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] text-[11px] font-mono space-y-1 text-slate-800 dark:text-amber-100">
                  <div className="flex items-start justify-between gap-2">
                    <span className="shrink-0 font-semibold">Destino:</span>
                    <span className="font-bold text-slate-950 dark:text-white break-all text-right">{caminhoExibido}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">Seleção:</span>
                    <span className="font-bold text-slate-950 dark:text-white text-right">
                      {labelOperacao} · {selecionadasIds.size} de {empresas.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">Período:</span>
                    <span className="font-bold text-slate-950 dark:text-white text-right">
                      Exercício {ano}
                      {mesesSelecionados ? ` (${mesesSelecionados.size} ${mesesSelecionados.size === 1 ? 'mês' : 'meses'})` : ''}
                    </span>
                  </div>
                </div>

                {opcoesExtras && (
                  <div className="bg-[#fffdf5] dark:bg-[#120e07] border border-[#fcd34d] dark:border-[#5c3a11] rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={e => {
                        const vaiAbrir = !opcoesAbertas;
                        setOpcoesAbertas(vaiAbrir);
                        if (vaiAbrir) {
                          animarRatoParaAlvo('btn-opcoes', 'Estas opções também existem aqui na barra', { clientX: e.clientX, clientY: e.clientY }, undefined, 'zona-4');
                        }
                      }}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono font-semibold text-slate-800 dark:text-amber-200 hover:bg-[#fef3c7] dark:hover:bg-[#1f180b] cursor-pointer"
                    >
                      <span className="flex items-center space-x-1.5">
                        <SlidersHorizontal className="w-3 h-3 text-[#d97706] dark:text-[#fbbf24]" />
                        <span>Opções Avançadas</span>
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${opcoesAbertas ? 'rotate-180' : ''}`} />
                    </button>
                    {opcoesAbertas && (
                      <div className="p-2.5 border-t border-[#fcd34d] dark:border-[#5c3a11] space-y-2">
                        {opcoesExtras}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!podeIniciar}
                  onClick={executarIniciarComRato}
                  className="w-full py-2.5 px-4 rounded-md bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-45 disabled:cursor-not-allowed text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-2 cursor-pointer shadow-sm transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {iniciandoAnimado
                      ? 'A iniciar na barra principal...'
                      : labelBotaoIniciar || `Iniciar Importação (${selecionadasIds.size})`}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={e => irParaPasso(4, e)}
              className="w-full text-left rounded-md border border-[#fcd34d] dark:border-[#78350f] bg-[#fef3c7] dark:bg-[#191309] hover:border-[#d97706] dark:hover:border-[#f59e0b] px-3 py-2 transition-colors cursor-pointer flex items-center justify-between gap-2"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-[#d97706] text-white flex items-center justify-center text-[11px] font-mono font-bold shrink-0">
                  4
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-900 dark:text-amber-50 truncate">
                  Iniciar · {selecionadasIds.size} selecionada(s) · {ano}
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#120e07] border border-[#f59e0b] dark:border-[#78350f] text-[9.5px] font-mono font-bold text-amber-900 dark:text-amber-300 shrink-0">
                Abrir
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* Portal Global do Ponteiro de Rato Virtual (Padrão Vídeo Tutorial Gexcel) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <style>{`
              .evo-guide-spotlight {
                outline: 3px solid #f59e0b !important;
                outline-offset: 3px !important;
                box-shadow: 0 0 24px rgba(245, 158, 11, 0.85) !important;
                transition: outline 0.18s ease, box-shadow 0.2s ease !important;
              }
              @keyframes evoGuideRipple {
                0% {
                  transform: translate(-50%, -50%) scale(0.25);
                  opacity: 0.95;
                }
                100% {
                  transform: translate(-50%, -50%) scale(2.15);
                  opacity: 0;
                }
              }
              @keyframes evoGuideHaloPulse {
                0%, 100% {
                  box-shadow: 0 0 12px rgba(245, 158, 11, 0.65);
                }
                50% {
                  box-shadow: 0 0 22px rgba(251, 191, 36, 0.95);
                }
              }
            `}</style>

            {cursorOverlay.visivel && (
              <div
                aria-hidden="true"
                style={{
                  position: 'fixed',
                  left: 0,
                  top: 0,
                  zIndex: 2147483647,
                  pointerEvents: 'none',
                  transform: `translate3d(${cursorOverlay.x}px, ${cursorOverlay.y}px, 0)`,
                  transition: cursorOverlay.animarMovimento
                    ? 'transform 470ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease'
                    : 'opacity 150ms ease',
                  opacity: cursorOverlay.visivel ? 1 : 0,
                }}
              >
                {/* Halo Pulsante Âmbar */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-14px',
                    top: '-14px',
                    width: '34px',
                    height: '34px',
                    borderRadius: '9999px',
                    background: 'rgba(245, 158, 11, 0.28)',
                    border: '2px solid #f59e0b',
                    transform: cursorOverlay.clicando ? 'scale(0.65)' : 'scale(1)',
                    transition: 'transform 140ms ease',
                    animation: 'evoGuideHaloPulse 1.1s infinite ease-in-out',
                  }}
                />

                {/* Onda de Clique (Ripple) */}
                {cursorOverlay.rippleId > 0 && (
                  <div
                    key={cursorOverlay.rippleId}
                    style={{
                      position: 'absolute',
                      left: '3px',
                      top: '3px',
                      width: '56px',
                      height: '56px',
                      borderRadius: '9999px',
                      border: '3px solid #ef4444',
                      background: 'rgba(239, 68, 68, 0.3)',
                      boxShadow: '0 0 18px rgba(239, 68, 68, 0.85)',
                      animation: 'evoGuideRipple 520ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards',
                    }}
                  />
                )}

                {/* Ponteiro Dourado Gexcel */}
                <div
                  style={{
                    transform: cursorOverlay.clicando ? 'scale(0.84)' : 'scale(1)',
                    transformOrigin: '3px 3px',
                    transition: 'transform 120ms ease',
                    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.85))',
                  }}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 3L10.5 21L14 13.5L21.5 10L3 3Z"
                      fill="#fbbf24"
                      stroke="#000000"
                      strokeWidth="1.9"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                {/* Etiqueta Flutuante com Ação (com proteção contra corte nas bordas) */}
                {cursorOverlay.label && (
                  <div
                    style={{
                      position: 'absolute',
                      left: cursorOverlay.x > window.innerWidth - 290 ? 'auto' : '22px',
                      right: cursorOverlay.x > window.innerWidth - 290 ? '18px' : 'auto',
                      top: cursorOverlay.y > window.innerHeight - 90 ? '-38px' : '24px',
                      background: '#090d16',
                      border: '2px solid #f59e0b',
                      color: '#fbbf24',
                      borderRadius: '8px',
                      padding: '5px 10px',
                      boxShadow: '0 14px 32px rgba(0,0,0,0.72), 0 0 18px rgba(245,158,11,0.35)',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                    }}
                  >
                    <MousePointer2 className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />
                    <span>{cursorOverlay.label}</span>
                  </div>
                )}
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
