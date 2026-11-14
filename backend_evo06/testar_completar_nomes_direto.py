# -*- coding: utf-8 -*-
"""
testar_completar_nomes_direto.py - Teste de bancada direto para resolver
os nomes em falta na base de dados de vendas (500320462) sem necessidade do Excel.
"""
import sys
import os
import pb_client
import efatura_api
import main

def main_test():
    nif_titular = "500320462"
    print("=" * 70)
    print(f" [TESTE DIRETO] Resolução de Nomes de Vendas para NIF {nif_titular}")
    print("=" * 70)

    # 1. Obter credenciais
    sub, pwd = pb_client.get_credentials(nif_titular)
    if not pwd:
        print("[ERRO] Senha não encontrada no PocketBase/tCredenciais para", nif_titular)
        return

    print(f"Credenciais obtidas: Subutilizador='{sub or ''}', Senha=OK")

    # 2. Verificar NIFs sem nome na BD de vendas
    missing = pb_client.obter_nifs_vendas_sem_nome(nif_titular)
    print(f"NIFs com faturas sem nome na base de dados SQLite: {len(missing)}")
    if not missing:
        print("Não há faturas sem nome para resolver nesta base de dados!")
        return

    # 3. Chamar a função oficial do pipeline
    print("\nA disparar resolver_e_completar_nomes_vendas...")
    h_out, v_out = main.resolver_e_completar_nomes_vendas(
        nif_titular=nif_titular,
        password=pwd,
        subuser=sub,
        horizontal_rows=[],
        vertical_rows=[],
        salvar_sqlite=True
    )
    print("\n" + "=" * 70)
    print(" [CONCLUÍDO] Teste finalizado com sucesso!")
    print("=" * 70)

if __name__ == "__main__":
    main_test()
