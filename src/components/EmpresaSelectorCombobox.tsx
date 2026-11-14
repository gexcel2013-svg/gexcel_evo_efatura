import { useState, useEffect, useMemo, useRef } from 'react';
import { Building2, ChevronDown, Search, Check, X } from 'lucide-react';

export interface EmpresaComboboxOption {
  id: string;
  nif: string;
  nif_cc?: string;
  nomecli: string;
  cod?: string;
}

interface EmpresaSelectorComboboxProps {
  entidades: EmpresaComboboxOption[];
  value: string;
  onChange: (nif: string) => void;
  modoPrivacidade?: boolean;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  dropdownClassName?: string;
  align?: 'left' | 'right';
  title?: string;
}

function mascararTexto(texto: string): string {
  if (!texto) return '';
  return texto.replace(/[^\s]/g, '■');
}

export function EmpresaSelectorCombobox({
  entidades,
  value,
  onChange,
  modoPrivacidade = false,
  allowAll = true,
  allLabel = 'Todas as Empresas',
  placeholder = 'Pesquisar NIF, nome ou código...',
  disabled = false,
  className = 'min-w-[280px] sm:min-w-[340px] max-w-[460px]',
  dropdownClassName = 'w-96 md:w-[460px]',
  align = 'left',
  title = 'Pesquisar e selecionar empresa',
}: EmpresaSelectorComboboxProps) {
  const [aberto, setAberto] = useState<boolean>(false);
  const [pesquisaInterna, setPesquisaInterna] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fecharEDescartarPesquisa = () => {
    setAberto(false);
    setPesquisaInterna('');
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        fecharEDescartarPesquisa();
      }
    };
    if (aberto) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [aberto]);

  useEffect(() => {
    if (aberto) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(timer);
    }
  }, [aberto]);

  const getNif = (ent: EmpresaComboboxOption) => (ent.nif || ent.nif_cc || '').trim();

  const entidadeSelecionada = useMemo(() => {
    if (!value) return null;
    return entidades.find(e => getNif(e) === value || e.nif === value || e.nif_cc === value) || null;
  }, [entidades, value]);

  const entidadesFiltradas = useMemo(() => {
    const q = pesquisaInterna.trim().toLowerCase();
    if (!q) return entidades;
    return entidades.filter(e => {
      const nome = (e.nomecli || '').toLowerCase();
      const nif = (e.nif || '').toLowerCase();
      const nifCc = (e.nif_cc || '').toLowerCase();
      const cod = (e.cod || '').toLowerCase();
      return nome.includes(q) || nif.includes(q) || nifCc.includes(q) || cod.includes(q);
    });
  }, [entidades, pesquisaInterna]);

  const selecionarNif = (nif: string) => {
    onChange(nif);
    fecharEDescartarPesquisa();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      fecharEDescartarPesquisa();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (pesquisaInterna.trim() === '' && allowAll) {
        selecionarNif('');
      } else if (entidadesFiltradas.length > 0) {
        selecionarNif(getNif(entidadesFiltradas[0]));
      }
    }
  };

  const nomeSelecionado = entidadeSelecionada?.nomecli || value;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (aberto) {
            fecharEDescartarPesquisa();
          } else {
            setAberto(true);
          }
        }}
        className={`w-full flex items-center justify-between space-x-2 rounded px-3 py-1.5 text-xs transition cursor-pointer shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed ${
          value
            ? 'bg-sky-50 dark:bg-[#0a1929] border border-[#0284c7] dark:border-sky-500 hover:bg-sky-100 dark:hover:bg-[#0f243a]'
            : 'bg-white dark:bg-[#0c1520] hover:bg-slate-50 dark:hover:bg-[#152332] border border-[#d7e0ea] dark:border-[#222f3e]'
        }`}
        title={title}
      >
        <div className="flex items-center space-x-2 truncate min-w-0">
          <Building2
            className={`w-3.5 h-3.5 shrink-0 ${
              value ? 'text-[#0284c7] dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          />
          <div className="truncate flex items-center space-x-1.5 text-xs min-w-0">
            {value ? (
              <>
                <span className="font-mono text-[#0284c7] dark:text-sky-400 font-bold bg-white dark:bg-[#07121c] px-1.5 py-0.5 rounded text-[11px] border border-sky-300 dark:border-sky-700 shrink-0">
                  {modoPrivacidade ? '■■■■■■■■■' : value}
                </span>
                <span
                  className={`font-sans font-semibold text-foreground truncate ${
                    modoPrivacidade ? 'font-mono' : ''
                  }`}
                >
                  {modoPrivacidade ? mascararTexto(nomeSelecionado) : nomeSelecionado}
                </span>
              </>
            ) : (
              <span className="text-slate-700 dark:text-slate-200 font-medium truncate">
                {allLabel} ({entidades.length})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-1 shrink-0 ml-1">
          {value && allowAll && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => {
                e.stopPropagation();
                selecionarNif('');
              }}
              title="Limpar seleção (mostrar todas)"
              className="p-0.5 rounded-full hover:bg-sky-200 dark:hover:bg-[#1a334d] text-slate-600 dark:text-slate-300 hover:text-foreground cursor-pointer transition"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform ${
              aberto ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {aberto && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-1 ${dropdownClassName} max-w-[92vw] bg-white dark:bg-[#0c1520] border border-[#d7e0ea] dark:border-[#222f3e] rounded-md shadow-2xl z-50 overflow-hidden flex flex-col`}
        >
          {/* Pesquisa Interna (filtra apenas a lista de sugestões; tabela só filtra ao selecionar) */}
          <div className="p-2 border-b border-[#d7e0ea] dark:border-[#222f3e] bg-slate-50 dark:bg-[#101b28]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500 dark:text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                value={pesquisaInterna}
                onChange={e => setPesquisaInterna(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full pl-8 pr-7 py-1 bg-white dark:bg-[#07121c] border border-[#d7e0ea] dark:border-[#222f3e] rounded text-xs text-foreground placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-[#0284c7] font-mono"
              />
              {pesquisaInterna && (
                <button
                  type="button"
                  onClick={() => setPesquisaInterna('')}
                  className="absolute right-2 top-1.5 text-slate-500 hover:text-foreground cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Lista de Empresas */}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-[#162536]">
            {allowAll && (
              <button
                type="button"
                onClick={() => selecionarNif('')}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition cursor-pointer ${
                  !value
                    ? 'bg-sky-50 dark:bg-[#0a1929] text-[#0284c7] dark:text-sky-300 font-semibold border-l-2 border-[#0284c7]'
                    : 'bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#142333] text-foreground'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                  <span>{allLabel}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#1a2d42] text-slate-700 dark:text-slate-300">
                  {entidades.length}
                </span>
              </button>
            )}

            {entidadesFiltradas.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400 font-mono bg-white dark:bg-[#0c1520]">
                Nenhuma empresa encontrada
              </div>
            ) : (
              entidadesFiltradas.map(ent => {
                const nifEnt = getNif(ent);
                const isSelected = Boolean(value) && nifEnt === value;
                return (
                  <button
                    key={ent.id || nifEnt}
                    type="button"
                    onClick={() => selecionarNif(nifEnt)}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition cursor-pointer ${
                      isSelected
                        ? 'bg-sky-50 dark:bg-[#0a1929] text-foreground font-semibold border-l-2 border-[#0284c7] dark:border-sky-400'
                        : 'bg-white dark:bg-[#0c1520] hover:bg-slate-100 dark:hover:bg-[#142333] text-foreground'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span
                        className={`truncate font-sans font-medium text-xs text-foreground ${
                          modoPrivacidade ? 'font-mono' : ''
                        }`}
                      >
                        {modoPrivacidade ? mascararTexto(ent.nomecli) : ent.nomecli}
                      </span>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-[10.5px] text-[#0284c7] dark:text-sky-400 font-semibold">
                          {modoPrivacidade ? '■■■■■■■■■' : nifEnt}
                        </span>
                        {ent.cod && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            · Cód. {ent.cod}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-[#0284c7] dark:text-sky-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
