export type UserRole = 'superadmin' | 'admin' | 'subutilizador';

export interface CentroDadosItem {
  id: string;
  nome: string;
  hostname: string;
  pasta_evogex: string;
  pasta_motor?: string;
  pasta_safedrive?: string;
  pasta_index_core?: string;
  pasta_v4_evogex?: string;
  pasta_gexcel_antiga: string;
  ip_local?: string;
  ativo: boolean;
  selecionado: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AppUser {
  id: number;
  username: string;
  nome: string;
  email?: string;
  role: UserRole;
  ativo: boolean;
  is_system: boolean;
  centros_permitidos?: string[];
  created_at?: string;
  ultimo_login?: string;
}

export interface AppConfig {
  modo_dados: 'integrado' | 'autonomo';
  total_users: number;
  total_admins: number;
  max_users?: number;
  setup_completo: boolean;
  db_path?: string;
  pasta_v4?: string;
  pasta_v3?: string;
  pasta_bdsrv?: string;
  pasta_pdfs?: string;
  versao?: string;
  build_number?: number;
  origem_motor?: 'local' | 'cloud';
  centro_dados_ativo_id?: string;
  centro_dados_nome?: string;
  centro_dados_hostname?: string;
  centro_dados_pasta_evogex?: string;
  centro_dados_pasta_motor?: string;
  centro_dados_pasta_safedrive?: string;
  centro_dados_pasta_index_core?: string;
  centro_dados_pasta_gexcel_antiga?: string;
  centro_dados_hwid?: string;
  centro_dados_ip?: string;
  centro_dados_online?: boolean;
  centros_dados?: CentroDadosItem[];
}
