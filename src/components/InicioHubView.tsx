import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileSpreadsheet,
  FolderOpen,
  HelpCircle,
  KeyRound,
  Mail,
  MessageSquareWarning,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { formatPhoneDisplay, validateEmail, validatePhone } from '../lib/contactValidation';
import { obterResumoDestinosConfigurados } from '../lib/localFsBridge';
import { APP_BUILD, APP_CHANNEL, APP_VERSION } from '../lib/version';
import {
  PLATFORM_FAQ_ITEMS,
  PlatformFaqModal,
  type FaqCategory,
} from './PlatformFaqModal';

interface StartHubNotification {
  id: string;
  app_code: string;
  category: string;
  badge_label: string;
  version_tag: string;
  title: string;
  summary: string;
  highlights: string[];
  published_at: string;
  is_pinned?: boolean;
  is_read?: boolean;
  action_tab?: string;
  action_label?: string;
}

interface StartHubRating {
  id: string;
  app_version: string;
  version_context: string;
  stars: number;
  comment: string;
  dificuldades: string[];
  pediu_contacto: boolean;
  submitted_at: string;
}

interface StartHubLogicReport {
  id: string;
  app_version: string;
  category: string;
  subject: string;
  expected_behavior: string;
  pediu_contacto: boolean;
  status: string;
  created_at: string;
}

interface EntidadeResumoRow {
  nif: string;
  nomecli: string;
  temCredenciais: boolean;
  docsAno: number;
  pendente: boolean;
}

interface InicioHubViewProps {
  ano: number;
  modoPrivacidade: boolean;
  onNavigateTab: (tab: string) => void;
  onNavegarParaDados: (nif: string, ano: number, mes?: number, tipo?: 'compras' | 'vendas') => void;
  onUnreadCountChange?: (count: number) => void;
}

type EntidadeSortKey = 'nomecli' | 'credenciais' | 'docsAno' | 'estado';
type FeedbackSortKey = 'data' | 'versao' | 'tipo' | 'resumo' | 'estado';

const CHIPS_DIFICULDADES = [
  'Importação / Credenciais AT',
  'Recibos Verdes e Rendas',
  'Deteção de Anulados',
  'Exportação para Excel / SQLite V4',
  'Pastas Locais / Multi-Escritório',
];

const CHIPS_SUGESTOES = [
  'Rapidez na Matriz Anual',
  'Organização SQLite V4',
  'Conciliação de Anulados',
  'Melhoria para Próxima Versão',
];

const VERSION_CONTEXT_OPTIONS = [
  { id: 'ATUAL', label: 'Referente a esta versão' },
  { id: 'POS_UPDATE', label: 'Pós-Atualização' },
  { id: 'SUGESTAO_PROXIMA', label: 'Ideia p/ Próxima Versão' },
];

const SCHEDULE_OPTIONS = [
  'Qualquer horário (9h–18h)',
  'Manhã (9h–13h)',
  'Tarde (14h–18h)',
];

function maskPriv(val: string, active: boolean, keepChars = 2): string {
  if (!active || !val) return val;
  if (val.length <= keepChars) return '■'.repeat(val.length);
  return `${val.slice(0, keepChars)}${'■'.repeat(Math.min(12, val.length - keepChars))}`;
}

export const InicioHubView: React.FC<InicioHubViewProps> = ({
  ano,
  modoPrivacidade,
  onNavigateTab,
  onNavegarParaDados,
  onUnreadCountChange,
}) => {
  const { currentUser, clientCode, clientName, licensedOffices } = useAuth();
  const resumoDestinos = obterResumoDestinosConfigurados();

  const activeOffice = useMemo(() => {
    if (licensedOffices.length === 0) return null;
    return licensedOffices.find((o) => o.officeId === resumoDestinos.id) || licensedOffices[0];
  }, [licensedOffices, resumoDestinos.id]);

  // Estado do Hub
  const [notifications, setNotifications] = useState<StartHubNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [ratingHistory, setRatingHistory] = useState<StartHubRating[]>([]);
  const [logicReports, setLogicReports] = useState<StartHubLogicReport[]>([]);
  const [hubLoading, setHubLoading] = useState<boolean>(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'alert' | 'version' | 'faqs'>('all');
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>('faq-efat-zs-1');
  const [isFaqModalOpen, setIsFaqModalOpen] = useState<boolean>(false);
  const [faqInitialCategory, setFaqInitialCategory] = useState<'todos' | FaqCategory>('todos');

  // Resumo Operacional de Empresas do Escritório Ativo
  const [entidadesRows, setEntidadesRows] = useState<EntidadeResumoRow[]>([]);
  const [entidadesLoading, setEntidadesLoading] = useState<boolean>(false);
  const [entidadeFiltro, setEntidadeFiltro] = useState<'TODAS' | 'PENDENTES'>('TODAS');
  const [entSortKey, setEntSortKey] = useState<EntidadeSortKey>('nomecli');
  const [entSortDir, setEntSortDir] = useState<'asc' | 'desc'>('asc');

  // Avaliação & Reporte
  const [feedbackViewMode, setFeedbackViewMode] = useState<'form' | 'history'>('form');
  const [stars, setStars] = useState<number>(5);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [versionContext, setVersionContext] = useState<string>('ATUAL');
  const [ratingComment, setRatingComment] = useState<string>('');
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [wantsSupportContact, setWantsSupportContact] = useState<boolean>(false);
  const [contactName] = useState<string>(() => currentUser?.nome || '');
  const [contactPhone, setContactPhone] = useState<string>(() => currentUser?.telefone || '');
  const [contactEmail, setContactEmail] = useState<string>(() => currentUser?.email || '');
  const [contactSchedule, setContactSchedule] = useState<string>('Qualquer horário (9h–18h)');
  const [useAltContact, setUseAltContact] = useState<boolean>(false);
  const [submittingRating, setSubmittingRating] = useState<boolean>(false);
  const [ratingSuccess, setRatingSuccess] = useState<string | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [fbSortKey, setFbSortKey] = useState<FeedbackSortKey>('data');
  const [fbSortDir, setFbSortDir] = useState<'asc' | 'desc'>('desc');

  // Modal Reportar Caso / Regra
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [reportCategory, setReportCategory] = useState<string>('REGRA_EFATURA');
  const [reportSubject, setReportSubject] = useState<string>('');
  const [reportExpected, setReportExpected] = useState<string>('');
  const [reportActual, setReportActual] = useState<string>('');
  const [reportWantsContact, setReportWantsContact] = useState<boolean>(true);
  const [submittingReport, setSubmittingReport] = useState<boolean>(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadHubOverview = useCallback(
    async (refresh = false) => {
      setHubLoading(true);
      try {
        const res = await fetch(`/api/start-hub/overview?refresh=${refresh}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications || []);
          const unread = Number(data.unread_count || 0);
          setUnreadCount(unread);
          if (onUnreadCountChange) onUnreadCountChange(unread);
          setRatingHistory(data.rating_history || []);
          setLogicReports(data.logic_reports || []);
          if (data.confirmed_contact) {
            if (!contactPhone && data.confirmed_contact.contacto_telefone) {
              setContactPhone(data.confirmed_contact.contacto_telefone);
            }
            if (!contactEmail && data.confirmed_contact.contacto_email) {
              setContactEmail(data.confirmed_contact.contacto_email);
            }
          }
          if (!expandedNotifId && Array.isArray(data.notifications) && data.notifications.length > 0) {
            setExpandedNotifId(data.notifications[0].id);
          }
        }
      } catch {
        // tolerar indisponibilidade temporária
      } finally {
        setHubLoading(false);
      }
    },
    [onUnreadCountChange, expandedNotifId, contactPhone, contactEmail]
  );

  const loadOfficeSummary = useCallback(async () => {
    setEntidadesLoading(true);
    try {
      const [entRes, matRes] = await Promise.all([
        fetch('http://127.0.0.1:8015/api/entidades').catch(() => null),
        fetch(`http://127.0.0.1:8015/api/estatisticas/matriz-anual/${ano}?tipo=compras`).catch(() => null),
      ]);
      const entData = entRes && entRes.ok ? await entRes.json().catch(() => null) : null;
      const matData = matRes && matRes.ok ? await matRes.json().catch(() => null) : null;
      const rawEntidades = Array.isArray(entData?.entidades) ? entData.entidades : [];
      const matMap = (matData?.empresas || {}) as Record<string, any>;

      const rows: EntidadeResumoRow[] = rawEntidades.map((e: any) => {
        const nif = String(e.nif || e.id || '').trim();
        const mInfo = matMap[nif] || {};
        const docsAno = Number(mInfo.total_docs_ano || 0);
        const temCreds = Boolean(e.tem_credenciais_at);
        return {
          nif,
          nomecli: String(e.nomecli || nif).trim(),
          temCredenciais: temCreds,
          docsAno,
          pendente: !temCreds || docsAno === 0,
        };
      });
      setEntidadesRows(rows);
    } finally {
      setEntidadesLoading(false);
    }
  }, [ano]);

  useEffect(() => {
    loadHubOverview(false);
    loadOfficeSummary();
  }, [loadHubOverview, loadOfficeSummary]);

  const handleMarkRead = async (id: string) => {
    const target = notifications.find((n) => n.id === id);
    if (!target || target.is_read) return;
    try {
      const res = await fetch('/api/start-hub/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: [id], mark_all: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        const unread = Number(data.unread_count || 0);
        setUnreadCount(unread);
        if (onUnreadCountChange) onUnreadCountChange(unread);
      }
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch('/api/start-hub/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: [], mark_all: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(0);
        if (onUnreadCountChange) onUnreadCountChange(0);
      }
    } catch {}
  };

  const sortedEntidades = useMemo(() => {
    const filtered = entidadesRows.filter((r) => (entidadeFiltro === 'PENDENTES' ? r.pendente : true));
    filtered.sort((a, b) => {
      let cmp = 0;
      if (entSortKey === 'nomecli') cmp = a.nomecli.localeCompare(b.nomecli, 'pt');
      else if (entSortKey === 'credenciais') cmp = Number(b.temCredenciais) - Number(a.temCredenciais);
      else if (entSortKey === 'docsAno') cmp = a.docsAno - b.docsAno;
      else cmp = Number(a.pendente) - Number(b.pendente);
      return entSortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [entidadesRows, entidadeFiltro, entSortKey, entSortDir]);

  const unifiedFeedbackHistory = useMemo(() => {
    const items = [
      ...ratingHistory.map((r) => ({
        id: r.id,
        data: r.submitted_at,
        versao: r.app_version || APP_VERSION,
        tipo: `Avaliação ${r.stars}★`,
        resumo: r.comment || r.dificuldades?.join(', ') || `${r.stars} estrelas`,
        estado: r.pediu_contacto ? 'Pedido de Apoio' : 'Registado',
      })),
      ...logicReports.map((rep) => ({
        id: rep.id,
        data: rep.created_at,
        versao: rep.app_version || APP_VERSION,
        tipo: rep.category,
        resumo: rep.subject,
        estado: rep.pediu_contacto ? 'Apoio Solicitado' : rep.status,
      })),
    ];
    items.sort((a, b) => {
      let cmp = 0;
      if (fbSortKey === 'data') cmp = (a.data || '').localeCompare(b.data || '');
      else if (fbSortKey === 'versao') cmp = (a.versao || '').localeCompare(b.versao || '', 'pt');
      else if (fbSortKey === 'tipo') cmp = (a.tipo || '').localeCompare(b.tipo || '', 'pt');
      else if (fbSortKey === 'resumo') cmp = (a.resumo || '').localeCompare(b.resumo || '', 'pt');
      else cmp = (a.estado || '').localeCompare(b.estado || '', 'pt');
      return fbSortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [ratingHistory, logicReports, fbSortKey, fbSortDir]);

  const filteredNotifications = useMemo(() => {
    if (feedFilter === 'all') return notifications;
    if (feedFilter === 'alert') return notifications.filter((n) => n.category === 'alert' || n.category === 'tip');
    return notifications.filter((n) => n.category === 'feature' || n.category === 'stability');
  }, [notifications, feedFilter]);

  const totalDocsAno = useMemo(() => entidadesRows.reduce((acc, r) => acc + r.docsAno, 0), [entidadesRows]);
  const totalCredsOk = useMemo(() => entidadesRows.filter((r) => r.temCredenciais).length, [entidadesRows]);

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    setRatingError(null);
    setRatingSuccess(null);

    if (stars <= 3 && selectedChips.length === 0 && !ratingComment.trim()) {
      setRatingError('Selecione um tópico ou escreva uma breve nota sobre o que melhorar.');
      return;
    }

    const needsContact = wantsSupportContact || stars <= 2;
    if (needsContact) {
      const pCheck = validatePhone(contactPhone, true);
      if (!pCheck.valid) {
        setRatingError(pCheck.error);
        setUseAltContact(true);
        return;
      }
      const eCheck = validateEmail(contactEmail);
      if (!eCheck.valid) {
        setRatingError(eCheck.error);
        setUseAltContact(true);
        return;
      }
    }

    try {
      setSubmittingRating(true);
      const res = await fetch('/api/start-hub/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stars,
          comment: ratingComment,
          app_version: `${APP_VERSION} (${APP_BUILD})`,
          version_context: versionContext,
          operator_name: currentUser?.nome || currentUser?.username || '',
          client_name: clientName || resumoDestinos.nome,
          office_id: activeOffice?.officeId || resumoDestinos.id,
          dificuldades: selectedChips,
          pediu_contacto: needsContact,
          contacto_nome: contactName || currentUser?.nome || '',
          contacto_telefone: contactPhone,
          contacto_email: contactEmail,
          horario_preferencial: contactSchedule,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRatingError(data?.detail || 'Falha ao registar avaliação.');
        return;
      }
      setRatingHistory(data?.rating_history || []);
      setRatingComment('');
      setSelectedChips([]);
      setRatingSuccess(data?.message || 'Avaliação registada com sucesso!');
      setTimeout(() => setRatingSuccess(null), 5000);
    } catch {
      setRatingError('Erro de comunicação ao enviar avaliação.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportError(null);
    setReportSuccess(null);
    if (!reportSubject.trim() || !reportExpected.trim()) {
      setReportError('Preencha o assunto e a explicação pretendida.');
      return;
    }
    if (reportWantsContact) {
      const pCheck = validatePhone(contactPhone, true);
      if (!pCheck.valid) {
        setReportError(pCheck.error);
        setUseAltContact(true);
        return;
      }
      const eCheck = validateEmail(contactEmail);
      if (!eCheck.valid) {
        setReportError(eCheck.error);
        setUseAltContact(true);
        return;
      }
    }
    try {
      setSubmittingReport(true);
      const res = await fetch('/api/start-hub/report-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: reportCategory,
          subject: reportSubject,
          expected_behavior: reportExpected,
          actual_behavior: reportActual,
          app_version: `${APP_VERSION} (${APP_BUILD})`,
          version_context: versionContext,
          operator_name: currentUser?.nome || currentUser?.username || '',
          client_name: clientName || resumoDestinos.nome,
          office_id: activeOffice?.officeId || resumoDestinos.id,
          pediu_contacto: reportWantsContact,
          contacto_nome: contactName || currentUser?.nome || '',
          contacto_telefone: contactPhone,
          contacto_email: contactEmail,
          horario_preferencial: contactSchedule,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setReportError(data?.detail || 'Não foi possível registar o reporte.');
        return;
      }
      setLogicReports(data?.logic_reports || []);
      setReportSuccess(data?.message || 'Reporte registado!');
      setReportSubject('');
      setReportExpected('');
      setReportActual('');
      setTimeout(() => {
        setIsReportModalOpen(false);
        setReportSuccess(null);
      }, 1800);
    } catch {
      setReportError('Erro de comunicação ao enviar reporte.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const renderEntSort = (key: EntidadeSortKey) =>
    entSortKey === key ? (
      <span className="ml-1 text-[#0284c7] dark:text-sky-400">{entSortDir === 'asc' ? '▲' : '▼'}</span>
    ) : (
      <span className="ml-1 opacity-45">⇅</span>
    );

  const renderFbSort = (key: FeedbackSortKey) =>
    fbSortKey === key ? (
      <span className="ml-1 text-[#0284c7] dark:text-sky-400">{fbSortDir === 'asc' ? '▲' : '▼'}</span>
    ) : (
      <span className="ml-1 opacity-45">⇅</span>
    );

  const renderContactBox = () => (
    <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] space-y-2 text-xs">
      {!useAltContact && contactPhone && contactEmail ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              Contacto confirmado para retorno rápido:
            </div>
            <div className="font-mono font-bold text-foreground flex flex-wrap items-center gap-2">
              <span>{formatPhoneDisplay(contactPhone)}</span>
              <span>· {contactEmail}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 font-mono text-[10px] font-bold">
              <UserCheck className="w-3 h-3" />
              Confirmado
            </span>
            <button
              type="button"
              onClick={() => setUseAltContact(true)}
              className="px-2 py-0.5 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] font-mono text-[10px] font-semibold cursor-pointer"
            >
              Alterar
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block font-mono text-[9.5px] uppercase text-slate-700 dark:text-slate-300 mb-0.5">
              Telemóvel / WhatsApp *
            </label>
            <div className="relative">
              <Phone className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+351 912 345 678"
                className="w-full pl-6 pr-2 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] font-mono text-xs text-foreground"
              />
            </div>
          </div>
          <div>
            <label className="block font-mono text-[9.5px] uppercase text-slate-700 dark:text-slate-300 mb-0.5">
              E-mail *
            </label>
            <div className="relative">
              <Mail className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@empresa.pt"
                className="w-full pl-6 pr-2 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] font-mono text-xs text-foreground"
              />
            </div>
          </div>
          <div>
            <label className="block font-mono text-[9.5px] uppercase text-slate-700 dark:text-slate-300 mb-0.5">
              Horário Preferencial
            </label>
            <select
              value={contactSchedule}
              onChange={(e) => setContactSchedule(e.target.value)}
              className="w-full px-2 py-1 rounded bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] text-xs text-foreground"
            >
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden gap-3 select-none">
      {/* 1. FAIXA EXECUTIVA DE TOPO (100% OPACA) */}
      <div className="shrink-0 bg-white dark:bg-[#0c1520] text-foreground border border-slate-300 dark:border-[#222f3e] rounded-md px-5 py-3 flex flex-wrap items-center justify-between gap-4 relative before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7]">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">
              CENTRAL DO CLIENTE · EVOGEX.COM
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
              <Building2 className="w-3 h-3 shrink-0" />
              <span>
                {activeOffice
                  ? `${activeOffice.officeId} · ${resumoDestinos.nome}`
                  : clientCode
                  ? `${clientCode} · ${resumoDestinos.nome}`
                  : resumoDestinos.nome}
              </span>
            </span>
            {currentUser?.role && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-sky-300 dark:border-sky-800 uppercase">
                {currentUser.role === 'superadmin' ? '@evoGex' : currentUser.role === 'admin' ? 'Administrador' : 'Operador'}
              </span>
            )}
          </div>
          <h1 className="font-display font-light text-lg tracking-[-0.015em] text-foreground mt-0.5">
            Início{currentUser?.nome ? ` · Bem-vindo, ${currentUser.nome}` : ' · Bem-vindo'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              <strong>{APP_VERSION}</strong> · {APP_BUILD}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-[#241a08] text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-[9.5px] font-bold uppercase">
              {APP_CHANNEL}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setFaqInitialCategory('todos');
              setIsFaqModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold cursor-pointer transition"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>FAQs · Zero-Storage</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReportError(null);
              setReportSuccess(null);
              setIsReportModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-[#241a08] hover:bg-amber-100 dark:hover:bg-[#31230b] text-amber-900 dark:text-amber-200 border border-amber-400 dark:border-amber-700 text-xs font-semibold cursor-pointer transition"
          >
            <MessageSquareWarning className="w-3.5 h-3.5" />
            <span>Reportar Caso / Regra</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab(resumoDestinos.evogexConfirmado ? 'matriz' : 'config')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold cursor-pointer transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{resumoDestinos.evogexConfirmado ? 'Ir para e-Fatura' : 'Ligar Pasta do Escritório'}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 1.5 FAIXA DE DESTAQUE FAQs & ZERO-STORAGE (100% OPACA) */}
      <div className="shrink-0 rounded-md border border-[#0284c7] bg-sky-50 dark:bg-[#0a1929] px-4 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3 relative before:absolute before:left-0 before:top-2.5 before:h-5 before:w-1 before:bg-[#0284c7]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#0284c7] text-white flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#0284c7] text-white font-mono text-[9.5px] font-bold uppercase tracking-wider">
                FAQs ESSENCIAIS DA PLATAFORMA
              </span>
              <span className="font-mono text-[10.5px] font-semibold text-emerald-800 dark:text-emerald-300">
                100% Online Zero-Storage · 0 Bytes na Cloud
              </span>
            </div>
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 mt-0.5 truncate">
              Veja como os dados ficam protegidos nas suas pastas locais e como gerir múltiplos escritórios.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setFaqInitialCategory('como_funciona');
              setIsFaqModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#132233] text-foreground border border-slate-300 dark:border-[#222f3e] text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <Cpu className="w-3.5 h-3.5 text-[#0284c7]" />
            <span>1. Como Funciona</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFaqInitialCategory('zero_storage');
              setIsFaqModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#132233] text-foreground border border-emerald-400 dark:border-emerald-700 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>2. Zero-Storage (RGPD)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFaqInitialCategory('licenciamento');
              setIsFaqModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-md bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#132233] text-foreground border border-amber-400 dark:border-amber-700 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>3. Escritórios & Vagas</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFaqInitialCategory('todos');
              setIsFaqModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
          >
            <span>Todas ({PLATFORM_FAQ_ITEMS.length})</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. GRELHA PRINCIPAL (4/12 AVISOS + 8/12 EMPRESAS DO ESCRITÓRIO & FEEDBACK) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        {/* COLUNA ESQUERDA (4/12): AVISOS & NOTAS DE VERSÃO */}
        <section className="lg:col-span-4 flex flex-col min-h-0 bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] rounded-md overflow-hidden">
          <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 dark:border-[#222f3e] flex items-center justify-between gap-2 relative before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7]">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
              <h2 className="font-display font-light text-sm text-foreground truncate">
                Avisos & Notas de Versão
              </h2>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full font-mono text-[9.5px] font-bold bg-[#0284c7] text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground cursor-pointer"
                >
                  <CheckCheck className="w-3 h-3 text-emerald-500" />
                  <span>Lidas</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => loadHubOverview(true)}
                disabled={hubLoading}
                className="p-1 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-200 cursor-pointer"
                title="Atualizar avisos"
              >
                <RefreshCw className={`w-3 h-3 ${hubLoading ? 'animate-spin text-[#0284c7]' : ''}`} />
              </button>
            </div>
          </div>

          <div className="shrink-0 px-3 py-1.5 border-b border-slate-200 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] flex flex-wrap items-center gap-1">
            {[
              { id: 'all', label: 'Todas', count: notifications.length },
              {
                id: 'alert',
                label: 'Dicas & Alertas',
                count: notifications.filter((n) => n.category === 'alert' || n.category === 'tip').length,
              },
              {
                id: 'version',
                label: 'Versões',
                count: notifications.filter((n) => n.category === 'feature' || n.category === 'stability').length,
              },
              { id: 'faqs', label: 'FAQs', count: PLATFORM_FAQ_ITEMS.length },
            ].map((tab) => {
              const active = feedFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedFilter(tab.id as any)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold cursor-pointer border ${
                    active
                      ? 'bg-[#0284c7] text-white border-[#0284c7]'
                      : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#222f3e]'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
            {feedFilter === 'faqs'
              ? PLATFORM_FAQ_ITEMS.map((faq) => {
                  const exp = expandedFaqId === faq.id;
                  return (
                    <div
                      key={faq.id}
                      className="rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedFaqId(exp ? null : faq.id)}
                        className="w-full p-2.5 text-left flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <span className="inline-block px-1.5 py-0.2 rounded font-mono text-[9px] font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-sky-300 dark:border-sky-800 mb-1">
                            {faq.badge}
                          </span>
                          <div className="text-xs font-semibold text-foreground">{faq.question}</div>
                        </div>
                        {exp ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                      {exp && (
                        <div className="px-2.5 pb-2.5 pt-1.5 border-t border-slate-200 dark:border-[#222f3e] bg-white dark:bg-[#0c1520] text-[11px] text-slate-700 dark:text-slate-200">
                          {faq.summary}
                        </div>
                      )}
                    </div>
                  );
                })
              : filteredNotifications.map((notif) => {
                  const exp = expandedNotifId === notif.id;
                  return (
                    <div
                      key={notif.id}
                      className={`rounded border overflow-hidden ${
                        notif.is_read
                          ? 'border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233]'
                          : 'border-[#0284c7] bg-sky-50 dark:bg-[#0a1929]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedNotifId(exp ? null : notif.id);
                          void handleMarkRead(notif.id);
                        }}
                        className="w-full p-2.5 text-left flex items-start justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9.5px]">
                            <span className="px-1.5 py-0.2 rounded font-bold bg-white dark:bg-[#0c1520] text-[#0284c7] dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                              {notif.badge_label}
                            </span>
                            <span className="text-slate-600 dark:text-slate-400">{notif.published_at}</span>
                          </div>
                          <div className="text-xs font-semibold text-foreground">{notif.title}</div>
                        </div>
                        {exp ? <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-1" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-1" />}
                      </button>
                      {exp && (
                        <div className="px-2.5 pb-2.5 pt-2 border-t border-slate-200 dark:border-[#222f3e] bg-white dark:bg-[#0c1520] space-y-2 text-[11px] text-slate-700 dark:text-slate-200">
                          <p>{notif.summary}</p>
                          {notif.highlights?.length > 0 && (
                            <ul className="space-y-1">
                              {notif.highlights.map((h, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                  <span>{h}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {notif.action_tab && (
                            <button
                              type="button"
                              onClick={() => onNavigateTab(notif.action_tab!)}
                              className="px-2.5 py-1 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-[10px] font-bold cursor-pointer"
                            >
                              {notif.action_label || 'Abrir'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
          </div>
        </section>

        {/* COLUNA DIREITA (8/12): RESUMO OPERACIONAL DO ESCRITÓRIO + AVALIAÇÃO POR VERSÃO */}
        <div className="lg:col-span-8 flex flex-col min-h-0 gap-3 overflow-y-auto pr-0.5">
          {/* BLOCO 1: RESUMO DO ESCRITÓRIO & EMPRESAS */}
          <section className="bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] rounded-md flex flex-col shrink-0">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#222f3e] flex flex-wrap items-center justify-between gap-2 relative before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7]">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#0284c7]" />
                <h2 className="font-display font-light text-sm text-foreground">
                  Estado do Escritório ({ano}) & Empresas Carregadas
                </h2>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] font-bold">
                  {sortedEntidades.length}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setEntidadeFiltro('TODAS')}
                  className={`px-2 py-0.5 rounded border cursor-pointer ${
                    entidadeFiltro === 'TODAS'
                      ? 'bg-[#0284c7] text-white border-[#0284c7] font-bold'
                      : 'bg-slate-50 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#222f3e]'
                  }`}
                >
                  Todas ({entidadesRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setEntidadeFiltro('PENDENTES')}
                  className={`px-2 py-0.5 rounded border cursor-pointer ${
                    entidadeFiltro === 'PENDENTES'
                      ? 'bg-[#0284c7] text-white border-[#0284c7] font-bold'
                      : 'bg-slate-50 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#222f3e]'
                  }`}
                >
                  Por Recolher ({entidadesRows.filter((r) => r.pendente).length})
                </button>
                <button
                  type="button"
                  onClick={loadOfficeSummary}
                  className="p-1 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] cursor-pointer"
                  title="Atualizar resumo"
                >
                  <RefreshCw className={`w-3 h-3 ${entidadesLoading ? 'animate-spin text-[#0284c7]' : ''}`} />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* 4 KPIs 100% Opacos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                <div className="p-2.5 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233]">
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">Pasta Ativa</div>
                  <div className="font-bold text-foreground truncate" title={resumoDestinos.pastaEvogex}>
                    {resumoDestinos.pastaEvogex}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233]">
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">Empresas</div>
                  <div className="font-bold text-foreground tabular-nums">{entidadesRows.length}</div>
                </div>
                <div className="p-2.5 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233]">
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">Credenciais AT</div>
                  <div className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {totalCredsOk} / {entidadesRows.length}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233]">
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">Faturas {ano}</div>
                  <div className="font-bold text-[#0284c7] dark:text-sky-300 tabular-nums">
                    {totalDocsAno.toLocaleString('pt-PT')}
                  </div>
                </div>
              </div>

              {sortedEntidades.length === 0 ? (
                <div className="p-5 text-center border border-dashed border-slate-300 dark:border-[#222f3e] rounded-md bg-slate-50 dark:bg-[#132233] space-y-2">
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    Ainda não existem empresas carregadas para este escritório.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('config')}
                    className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold cursor-pointer"
                  >
                    Configurar Pasta & Carregar Empresas
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded border border-slate-300 dark:border-[#222f3e]">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead className="bg-slate-100 dark:bg-[#132233] border-b border-slate-300 dark:border-[#222f3e] text-[10px] text-slate-700 dark:text-slate-300 sticky top-0">
                      <tr>
                        <th
                          onClick={() => {
                            if (entSortKey === 'nomecli') setEntSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else {
                              setEntSortKey('nomecli');
                              setEntSortDir('asc');
                            }
                          }}
                          className="py-2 px-3 cursor-pointer hover:text-foreground"
                        >
                          Empresa / NIF {renderEntSort('nomecli')}
                        </th>
                        <th
                          onClick={() => {
                            if (entSortKey === 'credenciais') setEntSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else {
                              setEntSortKey('credenciais');
                              setEntSortDir('asc');
                            }
                          }}
                          className="py-2 px-2.5 cursor-pointer hover:text-foreground"
                        >
                          Credenciais AT {renderEntSort('credenciais')}
                        </th>
                        <th
                          onClick={() => {
                            if (entSortKey === 'docsAno') setEntSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else {
                              setEntSortKey('docsAno');
                              setEntSortDir('desc');
                            }
                          }}
                          className="py-2 px-2.5 text-right cursor-pointer hover:text-foreground"
                        >
                          Docs ({ano}) {renderEntSort('docsAno')}
                        </th>
                        <th
                          onClick={() => {
                            if (entSortKey === 'estado') setEntSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            else {
                              setEntSortKey('estado');
                              setEntSortDir('asc');
                            }
                          }}
                          className="py-2 px-2.5 cursor-pointer hover:text-foreground"
                        >
                          Estado {renderEntSort('estado')}
                        </th>
                        <th className="py-2 px-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#1b2b3d] bg-white dark:bg-[#0c1520]">
                      {sortedEntidades.slice(0, 25).map((r) => (
                        <tr key={r.nif} className="hover:bg-slate-50 dark:hover:bg-[#132233]">
                          <td className="py-1.5 px-3">
                            <div className="font-semibold text-foreground truncate max-w-[220px]">
                              {maskPriv(r.nomecli, modoPrivacidade, 3)}
                            </div>
                            <div className="text-[10px] text-[#0284c7] dark:text-sky-400">
                              NIF {maskPriv(r.nif, modoPrivacidade, 3)}
                            </div>
                          </td>
                          <td className="py-1.5 px-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                r.temCredenciais
                                  ? 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                                  : 'bg-amber-50 dark:bg-[#241a08] text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                              }`}
                            >
                              {r.temCredenciais ? 'Prontas' : 'Em falta'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-bold tabular-nums">{r.docsAno}</td>
                          <td className="py-1.5 px-2.5 text-[11px]">
                            {r.pendente ? 'Por atualizar' : 'Atualizada'}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                r.docsAno > 0 ? onNavegarParaDados(r.nif, ano) : onNavigateTab('matriz')
                              }
                              className="px-2 py-0.5 rounded bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-sky-300 dark:border-sky-800 text-[10px] font-bold cursor-pointer"
                            >
                              {r.docsAno > 0 ? 'Ver Dados' : 'Importar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* BLOCO 2: AVALIAÇÃO & FEEDBACK POR VERSÃO */}
          <section className="bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] rounded-md flex flex-col shrink-0">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#222f3e] flex flex-wrap items-center justify-between gap-2 relative before:absolute before:left-0 before:top-3 before:h-5 before:w-0.5 before:bg-[#0284c7]">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <h2 className="font-display font-light text-sm text-foreground">
                  Avaliação & Feedback por Versão
                </h2>
                <span className="px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                  {APP_VERSION}
                </span>
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-[#132233] p-0.5 rounded border border-slate-300 dark:border-[#222f3e] text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setFeedbackViewMode('form')}
                  className={`px-2.5 py-0.5 rounded cursor-pointer ${
                    feedbackViewMode === 'form' ? 'bg-[#0284c7] text-white font-bold' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Novo Feedback
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackViewMode('history')}
                  className={`px-2.5 py-0.5 rounded cursor-pointer ${
                    feedbackViewMode === 'history' ? 'bg-[#0284c7] text-white font-bold' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Meus Envios ({unifiedFeedbackHistory.length})
                </button>
              </div>
            </div>

            {feedbackViewMode === 'form' ? (
              <form onSubmit={handleSubmitRating} className="p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e]">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-700 dark:text-slate-300">Avaliação:</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((num) => {
                        const active = (hoverStars || stars) >= num;
                        return (
                          <button
                            key={num}
                            type="button"
                            onMouseEnter={() => setHoverStars(num)}
                            onMouseLeave={() => setHoverStars(0)}
                            onClick={() => {
                              setStars(num);
                              setSelectedChips([]);
                              if (num <= 2) setWantsSupportContact(true);
                            }}
                            className="p-0.5 cursor-pointer"
                          >
                            <Star
                              className={`w-5 h-5 ${
                                active ? 'text-amber-400 fill-amber-400' : 'text-slate-400'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <span className="font-mono text-xs font-bold tabular-nums">{hoverStars || stars}/5</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {VERSION_CONTEXT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setVersionContext(opt.id)}
                        className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer ${
                          versionContext === opt.id
                            ? 'bg-[#0284c7] text-white border-[#0284c7] font-bold'
                            : 'bg-white dark:bg-[#0c1520] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#222f3e]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(stars <= 3 ? CHIPS_DIFICULDADES : CHIPS_SUGESTOES).map((chip) => {
                    const selected = selectedChips.includes(chip);
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() =>
                          setSelectedChips((prev) =>
                            prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
                          )
                        }
                        className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer ${
                          selected
                            ? 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 border-[#0284c7] font-bold'
                            : 'bg-slate-50 dark:bg-[#132233] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#222f3e]'
                        }`}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  rows={2}
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="Deixe a sua opinião ou sugestão de melhoria..."
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] text-xs text-foreground focus:outline-none focus:border-[#0284c7]"
                />

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wantsSupportContact || stars <= 2}
                    onChange={(e) => setWantsSupportContact(e.target.checked)}
                  />
                  <span>Pretendo contacto rápido por WhatsApp / E-mail sobre este ponto</span>
                </label>

                {(wantsSupportContact || stars <= 2) && renderContactBox()}

                {ratingError && (
                  <div className="p-2 rounded bg-rose-50 dark:bg-[#290f14] border border-rose-400 text-rose-800 dark:text-rose-200 text-xs font-mono">
                    {ratingError}
                  </div>
                )}
                {ratingSuccess && (
                  <div className="p-2 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 text-emerald-800 dark:text-emerald-200 text-xs font-mono">
                    {ratingSuccess}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingRating}
                    className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-mono text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{submittingRating ? 'A enviar...' : 'Enviar Feedback'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-3 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead className="bg-slate-100 dark:bg-[#132233] border-b border-slate-300 dark:border-[#222f3e] text-[10px]">
                    <tr>
                      <th
                        onClick={() => {
                          if (fbSortKey === 'data') setFbSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setFbSortKey('data');
                            setFbSortDir('desc');
                          }
                        }}
                        className="py-2 px-2.5 cursor-pointer"
                      >
                        Data {renderFbSort('data')}
                      </th>
                      <th
                        onClick={() => {
                          if (fbSortKey === 'versao') setFbSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setFbSortKey('versao');
                            setFbSortDir('asc');
                          }
                        }}
                        className="py-2 px-2.5 cursor-pointer"
                      >
                        Versão {renderFbSort('versao')}
                      </th>
                      <th
                        onClick={() => {
                          if (fbSortKey === 'tipo') setFbSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setFbSortKey('tipo');
                            setFbSortDir('asc');
                          }
                        }}
                        className="py-2 px-2.5 cursor-pointer"
                      >
                        Tipo {renderFbSort('tipo')}
                      </th>
                      <th
                        onClick={() => {
                          if (fbSortKey === 'resumo') setFbSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setFbSortKey('resumo');
                            setFbSortDir('asc');
                          }
                        }}
                        className="py-2 px-2.5 cursor-pointer"
                      >
                        Resumo {renderFbSort('resumo')}
                      </th>
                      <th
                        onClick={() => {
                          if (fbSortKey === 'estado') setFbSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setFbSortKey('estado');
                            setFbSortDir('asc');
                          }
                        }}
                        className="py-2 px-2.5 cursor-pointer"
                      >
                        Estado {renderFbSort('estado')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#1b2b3d] bg-white dark:bg-[#0c1520]">
                    {unifiedFeedbackHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-5 text-center text-slate-600 dark:text-slate-400">
                          Ainda não enviou avaliações ou reportes.
                        </td>
                      </tr>
                    ) : (
                      unifiedFeedbackHistory.map((item) => (
                        <tr key={item.id}>
                          <td className="py-1.5 px-2.5">{item.data}</td>
                          <td className="py-1.5 px-2.5">{item.versao}</td>
                          <td className="py-1.5 px-2.5">{item.tipo}</td>
                          <td className="py-1.5 px-2.5">{item.resumo}</td>
                          <td className="py-1.5 px-2.5">{item.estado}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <PlatformFaqModal
        isOpen={isFaqModalOpen}
        onClose={() => setIsFaqModalOpen(false)}
        initialCategory={faqInitialCategory}
      />

      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-[#0c1520] border border-slate-300 dark:border-[#222f3e] shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#222f3e] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#0284c7]" />
                <h3 className="text-base font-display font-light text-foreground">
                  Reportar Caso Prático ou Sugestão de Regra
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="p-1 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-3 text-xs font-mono">
              <div>
                <label className="block text-[10px] uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Área
                </label>
                <select
                  value={reportCategory}
                  onChange={(e) => setReportCategory(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground"
                >
                  <option value="REGRA_EFATURA">Importador e-Fatura (Compras / Vendas)</option>
                  <option value="RECIBOS_VERDES">Recibos Verdes & Rendas</option>
                  <option value="ANULADOS">Documentos Anulados</option>
                  <option value="MULTI_ESCRITORIO">Pastas Locais / Multi-Escritório</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Assunto *
                </label>
                <input
                  type="text"
                  required
                  value={reportSubject}
                  onChange={(e) => setReportSubject(e.target.value)}
                  placeholder="Ex.: Fatura específica não aparece nos anulados"
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-slate-700 dark:text-slate-300 mb-1">
                  O que pretendia que acontecesse *
                </label>
                <textarea
                  rows={3}
                  required
                  value={reportExpected}
                  onChange={(e) => setReportExpected(e.target.value)}
                  className="w-full p-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Situação observada (Opcional)
                </label>
                <input
                  type="text"
                  value={reportActual}
                  onChange={(e) => setReportActual(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-foreground"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reportWantsContact}
                  onChange={(e) => setReportWantsContact(e.target.checked)}
                />
                <span>Autorizar contacto rápido via WhatsApp / E-mail</span>
              </label>
              {reportWantsContact && renderContactBox()}

              {reportError && (
                <div className="p-2 rounded bg-rose-50 dark:bg-[#290f14] border border-rose-400 text-rose-800 dark:text-rose-200 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{reportError}</span>
                </div>
              )}
              {reportSuccess && (
                <div className="p-2 rounded bg-emerald-50 dark:bg-[#091e1a] border border-emerald-400 text-emerald-800 dark:text-emerald-200">
                  {reportSuccess}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReportModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {submittingReport ? 'A enviar...' : 'Enviar Reporte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
