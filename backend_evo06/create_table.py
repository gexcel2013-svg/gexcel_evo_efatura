import sqlite3
import json
import os

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "EVO-02_Core_BD", "pb_data", "data.db"))
conn = sqlite3.connect(db_path)
c = conn.cursor()

# 1. Obter campos de efatura_linhas em _collections
c.execute("SELECT fields FROM _collections WHERE name='efatura_linhas'")
row = c.fetchone()
fields = json.loads(row[0])

# Garantir que o campo id existe como primeiro elemento
if not any(f.get("name") == "id" for f in fields):
    id_field = {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": False,
        "id": "text_id_efatura",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": False,
        "primaryKey": True,
        "required": True,
        "system": True,
        "type": "text"
    }
    fields.insert(0, id_field)
    c.execute("UPDATE _collections SET fields=? WHERE name='efatura_linhas'", (json.dumps(fields),))

# 2. Criar a tabela física efatura_linhas
create_table_sql = """
CREATE TABLE IF NOT EXISTS `efatura_linhas` (
    `id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
    `id_cliente` TEXT DEFAULT '' NOT NULL,
    `hash_linha` TEXT DEFAULT '' NOT NULL,
    `id_fatura_unico` TEXT DEFAULT '' NOT NULL,
    `nif_cliente` TEXT DEFAULT '' NOT NULL,
    `fatura` TEXT DEFAULT '' NOT NULL,
    `atcud` TEXT DEFAULT '' NOT NULL,
    `data_emissao` TEXT DEFAULT '' NOT NULL,
    `tipo_documento` TEXT DEFAULT '' NOT NULL,
    `estado_documento` TEXT DEFAULT '' NOT NULL,
    `contraparte_nif` TEXT DEFAULT '' NOT NULL,
    `contraparte_nome` TEXT DEFAULT '' NOT NULL,
    `contraparte_pais` TEXT DEFAULT '' NOT NULL,
    `setor_atividade` TEXT DEFAULT '' NOT NULL,
    `tipo_imposto` TEXT DEFAULT '' NOT NULL,
    `codigo_taxa` TEXT DEFAULT '' NOT NULL,
    `taxa_percentagem` REAL DEFAULT 0 NOT NULL,
    `base_incidencia` REAL DEFAULT 0 NOT NULL,
    `valor_imposto` REAL DEFAULT 0 NOT NULL,
    `codigo_isencao` TEXT DEFAULT '' NOT NULL,
    `regiao_fiscal` TEXT DEFAULT '' NOT NULL,
    `total_liquido_doc` REAL DEFAULT 0 NOT NULL,
    `total_doc` REAL DEFAULT 0 NOT NULL,
    `created` TEXT DEFAULT '' NOT NULL,
    `updated` TEXT DEFAULT '' NOT NULL
);
"""
c.execute(create_table_sql)

# 3. Criar índice único em hash_linha
c.execute("CREATE UNIQUE INDEX IF NOT EXISTS `idx_efatura_linhas_hash` ON `efatura_linhas` (`hash_linha`);")

# 4. Criar tabela efatura_inconformidades e respetivos índices
create_inconf_sql = """
CREATE TABLE IF NOT EXISTS `efatura_inconformidades` (
    `id` TEXT PRIMARY KEY,
    `id_fatura_unico` TEXT NOT NULL,
    `modulo` TEXT NOT NULL,              -- 'compras' ou 'vendas'
    `nif_cliente` TEXT NOT NULL,
    `fatura` TEXT NOT NULL,
    `data_emissao` TEXT NOT NULL,         -- YYYY-MM-DD
    `valor_total` REAL NOT NULL,
    `data_deteccao` TEXT NOT NULL        -- YYYY-MM-DD
);
"""
c.execute(create_inconf_sql)
c.execute("CREATE UNIQUE INDEX IF NOT EXISTS `idx_inconf_fatura` ON `efatura_inconformidades` (`id_fatura_unico`);")
c.execute("CREATE INDEX IF NOT EXISTS `idx_inconf_cliente_data` ON `efatura_inconformidades` (`nif_cliente`, `data_deteccao`);")

conn.commit()
conn.close()
print("SUCESSO: Tabelas efatura_linhas e efatura_inconformidades criadas e configuradas!")

