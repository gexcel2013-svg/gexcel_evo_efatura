import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  HelpCircle,
  KeyRound,
  Layers,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';

export type FaqCategory = 'como_funciona' | 'zero_storage' | 'licenciamento';

export interface FaqItem {
  id: string;
  category: FaqCategory;
  categoryLabel: string;
  badge: string;
  question: string;
  summary: string;
  bullets: string[];
}

export const PLATFORM_FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-efat-func-1',
    category: 'como_funciona',
    categoryLabel: 'COMO FUNCIONA',
    badge: '100% Online',
    question: 'Como funciona a plataforma evoGex.com no dia-a-dia?',
    summary:
      'A plataforma funciona diretamente no browser (Google Chrome ou Microsoft Edge), sem instalar programas pesados nos portáteis dos colaboradores e com atualizações automáticas sempre disponíveis.',
    bullets: [
      'Acesso imediato por endereço web em qualquer posto autorizado da sua empresa de contabilidade.',
      'Recolha e conferência de faturas e-Fatura, recibos verdes, rendas e documentos anulados no mesmo painel.',
      'Gravação direta na pasta Dados_evoGex do seu computador ou servidor de rede.',
    ],
  },
  {
    id: 'faq-efat-func-2',
    category: 'como_funciona',
    categoryLabel: 'COMO FUNCIONA',
    badge: 'SQLite V4 + V3',
    question: 'Onde ficam guardadas as faturas e as bases SQLite importadas da AT?',
    summary:
      'Todos os dados ficam exclusivamente na pasta local escolhida no Passo 1 das Configurações (Dados_evoGex), organizados por NIF e ano em bases SQLite rápidas (BdsefaturaV4).',
    bullets: [
      'Bases SQLite particionadas por empresa na subpasta BdsefaturaV4 para consulta imediata no Power Query e Excel.',
      'Compatibilidade opcional em paralelo com os diretórios XML clássicos (BdsefaturaV3 e BdsRV).',
      'Total soberania para fazer cópias de segurança nas pastas normais do seu escritório.',
    ],
  },
  {
    id: 'faq-efat-func-3',
    category: 'como_funciona',
    categoryLabel: 'COMO FUNCIONA',
    badge: 'Multi-Escritório',
    question: 'Posso separar vários escritórios ou pastas de trabalho na mesma empresa?',
    summary:
      'Sim. Cada escritório licenciado tem identificação própria e uma pasta Dados_evoGex isolada lado a lado no seu computador ou servidor, permitindo alternar de escritório no menu lateral.',
    bullets: [
      'Cada escritório mantém as suas próprias entidades, faturas e bases SQLite sem misturar ficheiros.',
      'O menu lateral mostra o escritório ativo e permite mudar de escritório num clique quando existem dois ou mais.',
    ],
  },
  {
    id: 'faq-efat-zs-1',
    category: 'zero_storage',
    categoryLabel: 'ZERO-STORAGE & RGPD',
    badge: '0 Bytes na Cloud',
    question: 'O que significa a arquitetura "100% Online Zero-Storage"?',
    summary:
      'Combina a facilidade de usar uma aplicação online atualizada sempre na web com a segurança de manter 0 bytes de faturas e ficheiros fiscais retidos nos nossos servidores.',
    bullets: [
      'As faturas, PDFs e bases SQLite entram e saem diretamente da sua pasta local Dados_evoGex.',
      'Não existe nenhuma base de dados central na nuvem com compras, vendas ou valores dos seus clientes.',
    ],
  },
  {
    id: 'faq-efat-zs-2',
    category: 'zero_storage',
    categoryLabel: 'ZERO-STORAGE & RGPD',
    badge: 'RGPD & OCC',
    question: 'A plataforma cumpre o RGPD e o sigilo profissional da contabilidade?',
    summary:
      'Sim. Como as bases de faturas permanecem sempre na posse física exclusiva da sua empresa de contabilidade e o processamento em nuvem ocorre apenas em memória volátil durante a operação, o sigilo é total.',
    bullets: [
      'Conformidade integral com o RGPD e normas de confidencialidade contabilística e auditoria.',
      'Os contactos de e-mail e WhatsApp registados servem exclusivamente para autenticação e suporte rápido.',
    ],
  },
  {
    id: 'faq-efat-lic-1',
    category: 'licenciamento',
    categoryLabel: 'LICENCIAMENTO & ACESSOS',
    badge: 'Login Único',
    question: 'Como funcionam as vagas por escritório e o acesso do Administrador?',
    summary:
      'Cada pessoa entra sempre com o mesmo utilizador e palavra-passe. O Administrador principal acede automaticamente a todos os escritórios licenciados da empresa, ocupando uma vaga em cada escritório.',
    bullets: [
      'Ao entrar no 1.º link de convite, o Administrador define o nome do escritório, e-mail e telemóvel WhatsApp.',
      'Os colaboradores podem ter acesso apenas a um escritório ou partilhar dois ou mais escritórios consoante as vagas.',
      'Cada utilizador mantém apenas 1 sessão ativa em simultâneo entre o escritório e casa.',
    ],
  },
  {
    id: 'faq-efat-lic-2',
    category: 'licenciamento',
    categoryLabel: 'LICENCIAMENTO & ACESSOS',
    badge: 'Contactos & Apoio',
    question: 'Porque é pedido e-mail e telemóvel WhatsApp ao criar utilizadores?',
    summary:
      'Para garantir contacto rápido e eficaz sempre que surgir uma dúvida ou aviso técnico importante. O telemóvel é obrigatório para o Administrador e facultativo para os operadores.',
    bullets: [
      'Vários operadores podem partilhar o mesmo telemóvel geral do escritório se não tiverem telemóvel dedicado.',
      'O sistema evita automaticamente envios duplicados quando vários utilizadores partilham o mesmo número.',
    ],
  },
];

const CATEGORY_META: Record<
  'todos' | FaqCategory,
  { label: string; count: number; icon: typeof HelpCircle }
> = {
  todos: {
    label: 'Todas as Questões',
    count: PLATFORM_FAQ_ITEMS.length,
    icon: HelpCircle,
  },
  como_funciona: {
    label: 'Como Funciona',
    count: PLATFORM_FAQ_ITEMS.filter((i) => i.category === 'como_funciona').length,
    icon: Layers,
  },
  zero_storage: {
    label: 'Zero-Storage & RGPD',
    count: PLATFORM_FAQ_ITEMS.filter((i) => i.category === 'zero_storage').length,
    icon: ShieldCheck,
  },
  licenciamento: {
    label: 'Licenciamento & Escritórios',
    count: PLATFORM_FAQ_ITEMS.filter((i) => i.category === 'licenciamento').length,
    icon: KeyRound,
  },
};

interface PlatformFaqModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: 'todos' | FaqCategory;
}

export const PlatformFaqModal: React.FC<PlatformFaqModalProps> = ({
  isOpen,
  onClose,
  initialCategory = 'todos',
}) => {
  const [activeCategory, setActiveCategory] = useState<'todos' | FaqCategory>(initialCategory);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>('faq-efat-zs-1');

  useEffect(() => {
    if (isOpen) {
      setActiveCategory(initialCategory);
      setSearchTerm('');
      const firstMatch = PLATFORM_FAQ_ITEMS.find(
        (f) => initialCategory === 'todos' || f.category === initialCategory
      );
      setExpandedId(firstMatch ? firstMatch.id : PLATFORM_FAQ_ITEMS[0].id);
    }
  }, [isOpen, initialCategory]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return PLATFORM_FAQ_ITEMS.filter((item) => {
      if (activeCategory !== 'todos' && item.category !== activeCategory) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.bullets.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [activeCategory, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-white dark:bg-[#0c1520] text-foreground border border-slate-300 dark:border-[#222f3e] rounded-lg shadow-2xl overflow-hidden">
        <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-[#222f3e] bg-slate-50 dark:bg-[#091420] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0284c7] text-white flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-light text-base sm:text-lg text-foreground truncate">
                Perguntas Frequentes · Como Funciona, Zero-Storage & Escritórios
              </h2>
              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
                Arquitetura Online EVO GEX com dados 100% nas suas pastas locais
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md bg-white dark:bg-[#132233] border border-slate-300 dark:border-[#222f3e] text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1c314a] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-[#222f3e] bg-white dark:bg-[#0c1520] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['todos', 'como_funciona', 'zero_storage', 'licenciamento'] as const).map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 rounded font-mono text-[11px] font-semibold border flex items-center gap-1.5 cursor-pointer transition ${
                    active
                      ? 'bg-[#0284c7] text-white border-[#0284c7]'
                      : 'bg-slate-50 dark:bg-[#132233] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#222f3e] hover:bg-slate-100 dark:hover:bg-[#1a2c40]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{meta.label}</span>
                  <span className="text-[10px] opacity-80">({meta.count})</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar dúvida..."
              className="w-full pl-8 pr-3 py-1.5 rounded border border-slate-300 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] text-xs font-mono text-foreground focus:outline-none focus:border-[#0284c7]"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2.5 bg-slate-50 dark:bg-[#07121c]">
          {filteredItems.map((item) => {
            const expanded = expandedId === item.id;
            const badgeClass =
              item.category === 'zero_storage'
                ? 'bg-emerald-50 dark:bg-[#091e1a] text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                : item.category === 'licenciamento'
                ? 'bg-amber-50 dark:bg-[#241a08] text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                : 'bg-sky-50 dark:bg-[#0a1929] text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-700';

            return (
              <div
                key={item.id}
                className="rounded-lg border border-slate-300 dark:border-[#222f3e] bg-white dark:bg-[#0c1520] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="w-full px-4 py-3 text-left flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#132233]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${badgeClass}`}>
                        {item.badge}
                      </span>
                      <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                        {item.categoryLabel}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{item.question}</h3>
                  </div>
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 text-[#0284c7] shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                </button>

                {expanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-200 dark:border-[#222f3e] bg-slate-50 dark:bg-[#132233] space-y-2.5 text-xs">
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">{item.summary}</p>
                    <ul className="space-y-1.5">
                      {item.bullets.map((b, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
