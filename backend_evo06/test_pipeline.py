# -*- coding: utf-8 -*-
"""
Script de Validação e Verificação da Arquitetura de Produção da API e-Fatura V4.
"""

import os
import sys

def testar_tudo():
    print("==================================================")
    print(" INICIANDO TESTES DA ARQUITETURA DE PRODUÇÃO")
    print("==================================================")

    # 1. Testar Licenciamento Gexcel Auth
    print("\n[TESTE 1] Licenciamento Gexcel Auth (Headless / Silent)...")
    import license_bridge
    lic = license_bridge.verificar_licenca()
    print(f" -> Autorizado: {lic.get('autorizado')}")
    print(f" -> Plano: {lic.get('plano')}")
    print(f" -> Hardware ID: {lic.get('hardware_id')}")
    assert lic.get("autorizado") is True, f"Licença não autorizada: {lic}"
    print(" [OK] Gexcel Auth operacional!")

    # 2. Testar Cofre Criptográfico (AES-256-GCM + Memória Efêmera)
    print("\n[TESTE 2] Cofre Criptográfico de Certificados (secure_vault)...")
    import secure_vault
    with secure_vault.ephemeral_producer_cert() as cert_path:
        print(f" -> Certificado efémero criado em: {cert_path}")
        assert os.path.exists(cert_path), "Certificado não foi gerado no disco!"
        with open(cert_path, "rb") as f:
            data = f.read()
        assert len(data) == 6312, f"Tamanho inesperado do PEM: {len(data)}"
        assert b"PRIVATE KEY" in data, "Chave privada em falta no PEM desencriptado!"
        assert b"CERTIFICATE" in data, "Certificado X509 em falta no PEM desencriptado!"
        print(" -> Leitura de chave e certificado em memória validada com 100% de integridade.")

    # Verificar se o ficheiro foi triturado e eliminado
    assert not os.path.exists(cert_path), "Falha de segurança: Ficheiro efémero ainda existe no disco após fecho do contexto!"
    print(" -> Ficheiro efémero foi triturado e apagado do disco com sucesso!")
    print(" [OK] Cofre criptográfico validado com segurança máxima!")

    # 3. Testar Endpoints Stateless do FastAPI (main.py)
    print("\n[TESTE 3] Endpoints FastAPI e Healthcheck (main.py)...")
    import main
    root_data = main.read_root()
    print(f" -> Healthcheck / : {root_data}")
    assert root_data["status"] == "ok", "Status não é ok!"
    assert root_data["assinatura"] == "API Importador e-Fatura Gexcel", "Assinatura oficial incorreta!"
    assert root_data["app_id"] == "efaturaV4api", "APP_ID incorreto!"
    assert root_data["porta"] == 8015, "Porta padrão não é 8015!"
    print(" [OK] Assinatura oficial e rotas core validadas!")

    # 4. Testar Ficheiro de Descoberta e Funções de Rede (arrancador.py)
    print("\n[TESTE 4] Descoberta de Portas e Assinatura (arrancador.py)...")
    import arrancador
    fich_desc = arrancador.obter_caminho_ficheiro_descoberta()
    arrancador.gravar_registo_descoberta(8015)
    print(f" -> Ficheiro de descoberta gerado em: {fich_desc}")
    assert os.path.exists(fich_desc), "Ficheiro de descoberta não foi gravado!"
    
    # Testar verificação de assinatura
    tem_assinatura = arrancador.verificar_assinatura_na_porta(8015)
    print(f" -> Verificação da assinatura oficial na porta 8015: {tem_assinatura}")
    assert tem_assinatura is True, "Porta 8015 ativa não respondeu com a assinatura correta!"
    print(" [OK] Gestão e descoberta de portas operacional!")

    print("\n==================================================")
    print(" [SUCESSO TOTAL] TODOS OS 4 TESTES PASSARAM A 100%!")
    print("==================================================")

if __name__ == "__main__":
    testar_tudo()
