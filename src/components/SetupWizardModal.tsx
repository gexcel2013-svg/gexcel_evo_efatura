import { useState } from 'react';
import { 
  Sparkles, 
  User, 
  Lock, 
  AlertTriangle, 
  Loader2, 
  CheckCircle2, 
  ShieldCheck, 
  KeyRound, 
  Mail 
} from 'lucide-react';
import { useAuth } from '../lib/auth';

export function SetupWizardModal() {
  const { setShowSetupWizard, login, refreshConfig } = useAuth();
  const [nome, setNome] = useState('');
  const [username, setUsername] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Modo Superadmin direto no Wizard
  const [modoSuperadmin, setModoSuperadmin] = useState(false);
  const [masterPass, setMasterPass] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !username.trim() || !password.trim()) {
      setErro('Por favor preencha o Nome, Utilizador e Palavra-passe.');
      return;
    }
    if (password !== confirmPassword) {
      setErro('As palavras-passe não coincidem.');
      return;
    }
    if (password.length < 4) {
      setErro('A palavra-passe deve ter pelo menos 4 caracteres.');
      return;
    }

    setCarregando(true);
    setErro(null);

    try {
      const res = await fetch('http://127.0.0.1:8015/api/app/setup-inicial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_admin: nome.trim(),
          username_admin: username.trim(),
          password_admin: password.trim(),
          email_admin: email.trim()
        })
      });

      if (res.ok) {
        // Autenticar de imediato
        await login(username.trim(), password.trim());
        await refreshConfig();
        setShowSetupWizard(false);
      } else {
        const errJson = await res.json();
        setErro(errJson.detail || 'Falha ao criar administrador inicial.');
      }
    } catch (err: any) {
      setErro(err.message || 'Sem ligação à API.');
    } finally {
      setCarregando(false);
    }
  };

  const handleSuperadminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterPass.trim()) return;

    setCarregando(true);
    setErro(null);

    const res = await login('superadmin', masterPass.trim());
    setCarregando(false);

    if (res.success) {
      setShowSetupWizard(false);
    } else {
      setErro(res.error || 'Chave mestra inválida.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
      <div className="bg-card w-full max-w-lg rounded-xl border border-border shadow-2xl p-6 space-y-5 relative text-foreground">
        
        {/* Cabeçalho com Selo de Inicialização */}
        <div className="flex items-center space-x-3.5 border-b border-border/80 pb-4">
          <div className="w-11 h-11 rounded-xl bg-[#0284c7]/15 flex items-center justify-center text-[#0284c7] dark:text-sky-400 shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-[#0284c7] dark:text-sky-400 font-semibold block">
              GEXCEL EVO · SETUP INICIAL
            </span>
            <h2 className="text-lg font-display font-light text-foreground tracking-tight">
              Configuração Inicial do Sistema
            </h2>
            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
              Defina o Administrador principal desta instalação independente.
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

        {!modoSuperadmin ? (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Nome do Administrador
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="ex: Dr. António Ferreira"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    disabled={carregando}
                    className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Nome de Utilizador (Login)
                </label>
                <input
                  type="text"
                  required
                  placeholder="admin"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={carregando}
                  className="w-full h-9 px-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Email de Contacto (Opcional)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
                <input
                  type="email"
                  placeholder="admin@empresa.pt"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={carregando}
                  className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Palavra-passe
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={carregando}
                    className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Confirmar Palavra-passe
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  disabled={carregando}
                  className="w-full h-9 px-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-[#0284c7] outline-hidden"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-border/80">
              <button
                type="button"
                onClick={() => setModoSuperadmin(true)}
                className="text-[11px] font-mono text-muted-foreground hover:text-[#0284c7] dark:hover:text-sky-400 flex items-center space-x-1 cursor-pointer transition"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Sou o Programador (Superadmin)</span>
              </button>

              <button
                type="submit"
                disabled={carregando}
                className="px-5 py-2 rounded bg-[#0284c7] hover:bg-[#0284c7]/90 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
              >
                {carregando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>A inicializar...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Criar Administrador & Iniciar</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSuperadminLogin} className="space-y-4">
            <div className="p-3 rounded bg-purple-500/10 border border-purple-500/30 text-xs font-mono space-y-1">
              <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Acesso Mestre do Superadministrador</span>
              </span>
              <p className="text-[11px] text-muted-foreground">
                Introduza a Chave Mestra universal configurada para o programador.
              </p>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Chave Mestra Oficial (Superadmin)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
                <input
                  type="password"
                  autoFocus
                  placeholder="Introduza a chave mestra..."
                  value={masterPass}
                  onChange={e => setMasterPass(e.target.value)}
                  disabled={carregando}
                  className="w-full h-9 pl-9 pr-3 rounded bg-muted/50 border border-border/80 text-foreground font-mono text-xs focus:ring-1 focus:ring-purple-500 outline-hidden"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/80 pt-2">
              <button
                type="button"
                onClick={() => setModoSuperadmin(false)}
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground cursor-pointer transition"
              >
                ← Voltar ao registo de Administrador
              </button>

              <button
                type="submit"
                disabled={carregando}
                className="px-5 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white font-mono text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-50"
              >
                {carregando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>A validar chave...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Entrar como Superadmin</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
