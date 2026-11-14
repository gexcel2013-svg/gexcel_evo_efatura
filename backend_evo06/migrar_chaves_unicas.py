# -*- coding: utf-8 -*-
"""
Gexcel EVO - Script de Migração de Chaves Únicas e Resolução de Nomes
Ajusta todas as chaves existentes para o novo formato (<= 25 chars, sem caracteres especiais)
e preenche nomes de clientes em falta em vendas através do histórico local.
"""

import sys
import os
import sqlite3
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import pb_client

CHUNK_SIZE = 50000

def migrar_compras():
    print("=" * 60)
    print("1. Migração de Chaves em Compras (efatura_linhas)...")
    print("=" * 60)
    
    db_path = pb_client.DB_PATH
    if not os.path.exists(db_path):
        print(f"Base de dados nao encontrada: {db_path}")
        return 0

    with sqlite3.connect(db_path, timeout=60) as conn:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 60000;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_efatura_contraparte ON efatura_linhas(contraparte_nif);")
        conn.commit()

        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM efatura_linhas")
        total_rows = c.fetchone()[0]
        print(f"Total de registos de compras a verificar: {total_rows}")

        c.execute("""
            SELECT id, contraparte_nif, nif_cliente, fatura, atcud, total_doc, id_fatura_unico
            FROM efatura_linhas
        """)

        total_atualizados = 0
        amostras = []
        batch_updates = []

        while True:
            rows = c.fetchmany(CHUNK_SIZE)
            if not rows:
                break

            for r in rows:
                row_id, contraparte_nif, nif_cli, fatura, atcud, total_doc, id_antigo = r
                nif_emissor = str(contraparte_nif or nif_cli or "000000000").strip()
                nova_chave = pb_client.gerar_chave_documento(
                    nif=nif_emissor,
                    fatura=fatura,
                    total_doc=total_doc,
                    atcud=atcud,
                    prefixo="C"
                )
                
                if nova_chave != id_antigo:
                    batch_updates.append((nova_chave, row_id))
                    if len(amostras) < 5:
                        amostras.append((id_antigo, nova_chave, fatura, total_doc))

            if batch_updates:
                conn.executemany("UPDATE efatura_linhas SET id_fatura_unico = ? WHERE id = ?", batch_updates)
                conn.commit()
                total_atualizados += len(batch_updates)
                print(f"  Progresso: {total_atualizados} / {total_rows} linhas atualizadas...")
                batch_updates.clear()

        print(f"[OK] Total compras atualizadas: {total_atualizados}")
        if amostras:
            print("\nAmostras de Chaves de Compras (Antiga -> Nova):")
            for ant, nova, fat, tot in amostras:
                print(f"  Doc: {str(fat):<20} | Tot: {tot:>7.2f}€ | '{ant}' ({len(ant)}) -> '{nova}' ({len(nova)})")

    return total_atualizados

def migrar_vendas():
    print("\n" + "=" * 60)
    print("2. Migração de Chaves e Nomes em Vendas (efatura_vendas_linhas)...")
    print("=" * 60)
    
    db_vendas_path = pb_client.DB_VENDAS_PATH
    if not os.path.exists(db_vendas_path):
        print(f"Base de dados de vendas nao encontrada: {db_vendas_path}")
        return 0

    with sqlite3.connect(db_vendas_path, timeout=60) as conn:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 60000;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vendas_contraparte ON efatura_vendas_linhas(contraparte_nif);")
        conn.commit()

        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM efatura_vendas_linhas")
        total_rows = c.fetchone()[0]
        print(f"Total de registos de vendas a verificar: {total_rows}")

        c.execute("""
            SELECT id, nif_cliente, contraparte_nif, fatura, atcud, total_doc, contraparte_nome, id_fatura_unico
            FROM efatura_vendas_linhas
        """)

        cache_nomes = {}
        total_atualizados = 0
        nomes_preenchidos = 0
        amostras_chaves = []
        batch_updates = []

        while True:
            rows = c.fetchmany(CHUNK_SIZE)
            if not rows:
                break

            for r in rows:
                row_id, nif_cli, contraparte_nif, fatura, atcud, total_doc, nome_antigo, id_antigo = r
                nif_emissor = str(nif_cli or "000000000").strip()
                nova_chave = pb_client.gerar_chave_documento(
                    nif=nif_emissor,
                    fatura=fatura,
                    total_doc=total_doc,
                    atcud=atcud,
                    prefixo="V"
                )
                
                nome_final = str(nome_antigo or "").strip()
                if not nome_final and contraparte_nif:
                    nome_resolvido = pb_client.resolver_nome_nif_local(contraparte_nif, cache_nomes)
                    if nome_resolvido:
                        nome_final = nome_resolvido
                        nomes_preenchidos += 1

                if nova_chave != id_antigo or nome_final != (nome_antigo or ""):
                    batch_updates.append((nova_chave, nome_final, row_id))
                    if len(amostras_chaves) < 5:
                        amostras_chaves.append((id_antigo, nova_chave, fatura, contraparte_nif, nome_final))

            if batch_updates:
                conn.executemany("UPDATE efatura_vendas_linhas SET id_fatura_unico = ?, contraparte_nome = ? WHERE id = ?", batch_updates)
                conn.commit()
                total_atualizados += len(batch_updates)
                print(f"  Progresso Vendas: {total_atualizados} / {total_rows} linhas atualizadas...")
                batch_updates.clear()

        print(f"[OK] Total vendas atualizadas: {total_atualizados} ({nomes_preenchidos} nomes recuperados)")
        if amostras_chaves:
            print("\nAmostras de Chaves e Nomes de Vendas:")
            for ant, nova, fat, nif_c, nome_c in amostras_chaves:
                print(f"  Doc: {str(fat):<18} | Cliente: {nif_c} - {str(nome_c)[:30]:<30}")
                print(f"    Antiga: '{ant}' ({len(ant)}) -> Nova: '{nova}' ({len(nova)})")

    return total_atualizados

if __name__ == "__main__":
    t0 = time.time()
    migrar_compras()
    migrar_vendas()
    print(f"\n[CONCLUIDO] Migracao concluida em {time.time() - t0:.2f}s.")
