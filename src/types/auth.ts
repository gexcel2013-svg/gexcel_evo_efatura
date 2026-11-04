export type UserRole = 'superadmin' | 'admin' | 'subutilizador';

export interface AppUser {
  id: number;
  username: string;
  nome: string;
  email?: string;
  role: UserRole;
  ativo: boolean;
  is_system: boolean;
  created_at?: string;
  ultimo_login?: string;
}

export interface AppConfig {
  modo_dados: 'integrado' | 'autonomo';
  total_users: number;
  total_admins: number;
  setup_completo: boolean;
  db_path?: string;
}
