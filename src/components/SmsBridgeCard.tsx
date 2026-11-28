import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone,
  Copy,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Search,
  RotateCcw,
  Loader2,
  Send,
  Lock,
  Download,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { sincronizarSqlitesParaPastaLocal } from '../lib/localFsBridge';

export interface Entidade2faInfo {
  estado: 'bloqueado_2fa' | 'sms_autorizado' | string;
  detalhe?: string;
  updated_at?: string;
}

interface EntidadeResumo {
  id: string;
  nif?: string;
  nif_cc?: string;
  nomecli: string;
}

interface SmsBridgeConfigData {
  ok: boolean;
  token: string;
  webhook_url: string;
  painel_url: string;
  macro_download_url?: string;
  qr_svg: string;
  status?: {
    online: boolean;
    armazenamento: string;
    ttl_segundos: number;
    codigos_ativos: number;
    ultimos: Array<{
      portal: string;
      codigo_mascarado: string;
      remetente: string;
      hora: string;
      segundos_atras: number;
      expira_em_seg: number;
    }>;
  };
}

export function SmsBridgeCard() {
  const [config, setConfig] = useState<SmsBridgeConfigData | null>(null);
  const [entidades2fa, setEntidades2fa] = useState<Record<string, Entidade2faInfo>>({});
  const [entidades, setEntidades] = useState<EntidadeResumo[]>([]);
  const [busca, setBusca] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [testando, setTestando] = useState(false);
  const [msgTeste, setMsgTeste] = useState<string | null>(null);
  const [ocupadoNif, setOcupadoNif] = useState<string | null>(null);
  const [avancadoAberto, setAvancadoAberto] = useState<boolean>(false);

  const carregarDados = useCallback(async () => {
    try {
      const [cfgRes, e2faRes, entRes] = await Promise.all([
        fetch('http://127.0.0.1:8015/api/sms-bridge/config'),
        fetch('http://127.0.0.1:8015/api/entidades-2fa'),
        fetch('http://127.0.0.1:8015/api/entidades'),
      ]);
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        setConfig(cfgData);
      }
      if (e2faRes.ok) {
        const e2faData = await e2faRes.json();
        setEntidades2fa(e2faData.entidades_2fa || {});
      }
      if (entRes.ok) {
        const entData = await entRes.json();
        setEntidades(entData.entidades || []);
      }
    } catch {
      // Silencioso em modo offline
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('http://127.0.0.1:8015/api/sms-bridge/status');
        if (res.ok) {
          const st = await res.json();
          setConfig(prev => (prev ? { ...prev, status: st } : prev));
        }
      } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const copiarWebhook = () => {
    if (!config?.webhook_url) return;
    navigator.clipboard.writeText(config.webhook_url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const testarLigacao = async () => {
    setTestando(true);
    setMsgTeste(null);
    try {
      const res = await fetch('http://127.0.0.1:8015/api/sms-bridge/teste', { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        setMsgTeste(`Ligação confirmada em RAM (${d.recebido_as || 'agora'})`);
        await carregarDados();
      }
    } catch {
      setMsgTeste('Falha ao contactar a Ponte SMS.');
    } finally {
      setTestando(false);
    }
  };

  const aplicarAcao2fa = async (nif: string, acao: 'autorizar_sms' | 'bloquear' | 'limpar') => {
    if (!nif) return;
    setOcupadoNif(nif);
    try {
      const res = await fetch(`http://127.0.0.1:8015/api/entidades-2fa/${nif}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntidades2fa(data.entidades_2fa || {});
        await sincronizarSqlitesParaPastaLocal(undefined, false);
      }
    } finally {
      setOcupadoNif(null);
    }
  };

  const mapaNomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const ent of entidades) {
      const n = (ent.nif || ent.nif_cc || '').trim();
      if (n && ent.nomecli) m.set(n, ent.nomecli);
    }
    return m;
  }, [entidades]);

  const resultadosBusca = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return entidades
      .filter(e => {
        const n = (e.nif || e.nif_cc || '').trim();
        return n.includes(q) || (e.nomecli || '').toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [busca, entidades]);

  const listaMarcadas = useMemo(() => {
    return Object.entries(entidades2fa).sort((a, b) => {
      if (a[1].estado === b[1].estado) return a[0].localeCompare(b[0]);
      return a[1].estado === 'sms_autorizado' ? -1 : 1;
    });
  }, [entidades2fa]);

  return (
    <div className="space-y-4">
      <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-5 space-y-5 shadow-2xs text-foreground before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#222f3e] pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded bg-sky-100 dark:bg-[#0a1929] border border-sky-300 dark:border-sky-800 flex items-center justify-center text-[#0284c7] dark:text-sky-400">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-light text-base text-foreground">Ponte SMS 2FA (RAM Zero-Storage)</h3>
              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                TTL 5 min em RAM · Destruição imediata após uso · Filtro anti-SMS pessoais
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border border-emerald-400 dark:border-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {config?.status?.codigos_ativos
                  ? `Ligação Confirmada (${config.status.codigos_ativos} ativo)`
                  : 'Ponte Online em RAM'}
              </span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-4 flex flex-col items-center justify-center p-4 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] space-y-2">
            {config?.qr_svg ? (
              <div
                className="p-2 bg-white rounded border border-slate-200"
                dangerouslySetInnerHTML={{ __html: config.qr_svg }}
              />
            ) : (
              <div className="w-36 h-36 flex items-center justify-center text-xs font-mono text-slate-500">
                {carregando ? 'A gerar QR...' : 'QR indisponível'}
              </div>
            )}
            <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 text-center">
              Aponte a câmara do telemóvel
            </span>
          </div>

          <div className="lg:col-span-8 space-y-3">
            <div className="p-4 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] space-y-3">
              <div className="text-xs font-mono font-bold text-[#0284c7] dark:text-sky-400 uppercase tracking-wider">
                Como ligar em 3 passos simples
              </div>
              <ol className="space-y-2.5 text-xs text-slate-800 dark:text-slate-200">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#0284c7] text-white font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    <strong>Aponte a câmara do telemóvel</strong> ao QR Code ao lado e abra a ligação.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#0284c7] text-white font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    No telemóvel, toque em <strong>Importar Macro evoGex Pronta</strong> e carregue em{' '}
                    <strong>✓ Guardar</strong> no MacroDroid <em>(bateria Sem Restrições)</em>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#0284c7] text-white font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span>
                    <strong>Autorize abaixo</strong> as entidades que pretende ligar à Ponte SMS.
                  </span>
                </li>
              </ol>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setAvancadoAberto(v => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] hover:border-[#0284c7] text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {avancadoAberto ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>Opções avançadas / iPhone</span>
              </button>
            </div>

            {avancadoAberto && (
              <div className="p-4 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {config?.painel_url && (
                    <a
                      href={config.painel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] hover:border-[#0284c7] text-xs font-mono font-semibold text-[#0284c7] dark:text-sky-400"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir Página Telemóvel</span>
                    </a>
                  )}
                  {config?.macro_download_url && (
                    <a
                      href={config.macro_download_url}
                      download="evoGex_2FA.macro"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descarregar Macro Pronta</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={testarLigacao}
                    disabled={testando || carregando}
                    className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {testando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Testar Ligação</span>
                  </button>
                </div>

                {msgTeste && (
                  <div className="px-3 py-2 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-mono text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{msgTeste}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Endereço Privado Webhook (iPhone / Manual)
                    </span>
                    <button
                      type="button"
                      onClick={copiarWebhook}
                      disabled={!config?.webhook_url}
                      className="px-2.5 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] hover:border-[#0284c7] text-xs font-mono font-semibold text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3 text-[#0284c7]" />
                      <span>{copiado ? 'Copiado!' : 'Copiar Endereço'}</span>
                    </button>
                  </div>
                  <div className="px-2.5 py-2 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] font-mono text-[11px] text-[#0284c7] dark:text-sky-300 break-all select-all">
                    {config?.webhook_url || 'A carregar endereço...'}
                  </div>
                </div>

                <div className="p-3 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-white dark:bg-[#0c1520] space-y-1.5 text-xs">
                  <div className="font-mono font-bold text-[#0284c7] dark:text-sky-400">
                    iPhone / iOS (App Atalhos Apple)
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-300 text-[11.5px]">
                    <li>Automação por Mensagem contendo «AT» ou «código».</li>
                    <li>Ativar Executar Imediatamente (sem confirmação).</li>
                    <li>Obter conteúdo do URL (POST texto) para o endereço acima.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Gestão de Proteção 2FA por Entidade */}
      <div className="relative evo-card-signature bg-white dark:bg-[#0c1520] rounded-md border border-[#d7e0ea] dark:border-[#222f3e] p-5 space-y-4 shadow-2xs text-foreground before:content-[''] before:absolute before:left-0 before:top-2 before:h-5 before:w-0.5 before:bg-[#0284c7] before:z-20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-[#222f3e] pb-3">
          <div>
            <h4 className="font-display font-light text-base text-foreground">Entidades com 2FA / Autorização SMS</h4>
            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
              Apenas entidades em «SMS 2FA Ativo» usam esta ponte. Restantes entidades com 2FA são bloqueadas automaticamente.
            </p>
          </div>
          <button
            type="button"
            onClick={carregarDados}
            className="px-2.5 py-1 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-xs font-mono font-semibold text-foreground flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar empresa ou NIF para autorizar Ponte SMS (ex: Beatriz)..."
            className="w-full h-9 pl-8 pr-3 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] text-xs font-mono text-foreground outline-hidden focus:ring-1 focus:ring-[#0284c7]"
          />
        </div>

        {resultadosBusca.length > 0 && (
          <div className="rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] divide-y divide-slate-200 dark:divide-[#222f3e]">
            {resultadosBusca.map((ent) => {
              const n = (ent.nif || ent.nif_cc || '').trim();
              const est = entidades2fa[n]?.estado;
              return (
                <div key={ent.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono">
                  <div className="min-w-0">
                    <span className="font-bold text-[#0284c7] dark:text-sky-400 mr-2">{n}</span>
                    <span className="text-foreground">{ent.nomecli}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {est !== 'sms_autorizado' && (
                      <button
                        type="button"
                        disabled={ocupadoNif === n}
                        onClick={() => aplicarAcao2fa(n, 'autorizar_sms')}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                      >
                        Autorizar SMS
                      </button>
                    )}
                    {est !== 'bloqueado_2fa' && (
                      <button
                        type="button"
                        disabled={ocupadoNif === n}
                        onClick={() => aplicarAcao2fa(n, 'bloquear')}
                        className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                      >
                        Bloquear 2FA
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {listaMarcadas.length === 0 ? (
          <div className="p-4 rounded border border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#07121c] text-xs font-mono text-slate-700 dark:text-slate-300">
            Ainda não existem entidades marcadas como «2FA Bloqueado» ou «SMS 2FA Ativo».
          </div>
        ) : (
          <div className="rounded border border-[#d7e0ea] dark:border-[#222f3e] overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead className="bg-slate-100 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-b border-[#d7e0ea] dark:border-[#222f3e]">
                <tr>
                  <th className="py-2 px-3 text-left">NIF</th>
                  <th className="py-2 px-3 text-left">Entidade</th>
                  <th className="py-2 px-3 text-left">Estado 2FA</th>
                  <th className="py-2 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#222f3e]">
                {listaMarcadas.map(([nif, info]) => {
                  const autorizado = info.estado === 'sms_autorizado';
                  return (
                    <tr key={nif} className="bg-white dark:bg-[#0c1520]">
                      <td className="py-2 px-3 font-bold text-[#0284c7] dark:text-sky-400">{nif}</td>
                      <td className="py-2 px-3 font-sans text-foreground">{mapaNomes.get(nif) || 'Entidade'}</td>
                      <td className="py-2 px-3">
                        {autorizado ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-300 border border-emerald-400 dark:border-emerald-700 font-bold text-[11px]">
                            <ShieldCheck className="w-3 h-3" />
                            <span>SMS 2FA Ativo</span>
                          </span>
                        ) : (
                          <span
                            title={info.detalhe}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 dark:bg-[#231a08] text-amber-900 dark:text-amber-300 border border-amber-400 dark:border-amber-700 font-bold text-[11px]"
                          >
                            <Lock className="w-3 h-3" />
                            <span>2FA Bloqueado</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {autorizado ? (
                            <button
                              type="button"
                              disabled={ocupadoNif === nif}
                              onClick={() => aplicarAcao2fa(nif, 'bloquear')}
                              className="px-2 py-0.5 rounded bg-amber-50 dark:bg-[#231a08] border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-300 font-semibold text-[11px] cursor-pointer"
                            >
                              Bloquear
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={ocupadoNif === nif}
                              onClick={() => aplicarAcao2fa(nif, 'autorizar_sms')}
                              className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 font-semibold text-[11px] cursor-pointer"
                            >
                              Autorizar SMS
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={ocupadoNif === nif}
                            onClick={() => aplicarAcao2fa(nif, 'limpar')}
                            title="Reavaliar no próximo acesso à AT"
                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-200 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>Reavaliar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
