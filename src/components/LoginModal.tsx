import { useState } from 'react';
import { 
  UserCheck, 
  X, 
  Lock, 
  User, 
  AlertTriangle, 
  Loader2, 
  KeyRound, 
  ShieldCheck 
} from 'lucide-react';
import { useAuth } from '../lib/auth';

interface LoginModalProps {
  onClose?: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  const { login, setShowLoginModal, currentUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErro('Por favor preencha o nome de utilizador e a palavra-passe.');
      return;
    }

    setCarregando(true);
    setErro(null);

    const res = await login(username.trim(), password.trim());
    setCarregando(false);

    if (res.success) {
      if (onClose) onClose();
      setShowLoginModal(false);
    } else {
      setErro(res.error || 'Credenciais inválidas.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
      <div className="bg-card w-full max-w-md rounded-lg border border-border/80 shadow-2xl p-5 space-y-4 relative text-foreground">
        
        {/* Botão Fechar se já tiver sessão ou puder fechar */}
        <button
          type="button"
          onClick={() => {
            setShowLoginModal(false);
            if (onClose) onClose();
          }}
          className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground cursor-pointer transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Cabeçalho Oficial Gexcel EVO */}
        <div className="flex items-center space-x-3 border-b border-border/80 pb-3">
          <div className="w-10 h-10 rounded-lg bg-[#0284c7]/10 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-display font-light text-foreground tracking-tight">
              Autenticação de Operador
            </h2>
            <p className="text-[11px] font-mono text-muted-foreground">
              {currentUser ? `Sessão ativa: ${currentUser.nome}` : 'Introduza as credenciais da sua conta'}
            </p>
          </div>
        </div>

        {/* Alerta de Erro */}
        {erro && (
          <div className="p-2.5 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs font-mono flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Nome de Utilizador
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
              <input
                type="text"
                autoFocus
                placeholder="superadmin, admin ou operador"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={carregando}
                className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Palavra-passe
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={carregando}
                className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
              />
            </div>
          </div>

          {/* Dica discreta sobre a chave mestra */}
          <div className="p-2 rounded bg-muted/40 border border-border/50 text-[10px] font-mono text-muted-foreground flex items-center space-x-2">
            <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Acesso Mestre suportado para o Superadministrador do ecossistema.</span>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowLoginModal(false);
                if (onClose) onClose();
              }}
              className="px-3 py-1.5 rounded border border-border text-foreground hover:bg-muted font-mono text-xs cursor-pointer transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={carregando}
              className="px-4 py-1.5 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
            >
              {carregando ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>A validar...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Entrar</span>
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
