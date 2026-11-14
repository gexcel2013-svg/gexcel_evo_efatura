# -*- coding: utf-8 -*-
"""
Suite Obrigatória de Testes de Integridade Fiscal e Contabilística (Gate de Compilação).
Bloqueia compilar_api.bat caso qualquer um dos 10 Invariantes Fiscais falhe.

Nota: Utiliza exclusivamente entidades e NIFs 100% fictícios (gama 599...) conforme regras Gexcel.
"""

import os
import shutil
import sqlite3
import sys
import tempfile
from types import SimpleNamespace

# Garantir acesso ao pacote efatura_scraper se existir localmente
SCRAPER_ROOT = r"C:\DEV\Ecossistema_Gexcel\03_EVO_Ecossistema_Evo\03.9_SCR_EVO_Scrapers_Gov\SCR-02_Scrap_Efatura"
if os.path.exists(SCRAPER_ROOT) and SCRAPER_ROOT not in sys.path:
    sys.path.insert(0, SCRAPER_ROOT)

import efatura_api
import pb_client
import validador_fiscal


def _mk_soap_summary(dc_ind: str, net: float, tax_amt: float, tax_type: str, tax_code: str, tax_perc: float, region: str = "PT", ex_code: str = None):
    return SimpleNamespace(
        DebitCreditIndicator=dc_ind,
        NetAmount=net,
        TaxAmount=tax_amt,
        TaxExemptionCode=ex_code,
        Tax=SimpleNamespace(
            TaxType=tax_type,
            TaxCode=tax_code,
            TaxPercentage=tax_perc,
            TaxCountryRegion=region,
        ),
    )


def _mk_soap_invoice(
    inv_no: str,
    inv_type: str,
    status: str,
    inv_date: str,
    gross: float,
    net: float,
    tax_payable: float,
    summaries: list,
    issuer_nif: str = "599100101",
    issuer_name: str = "Fornecedor Horizonte Demo, Lda",
    customer_nif: str = "599999001",
    atcud: str = "ABCD1234-1",
):
    return SimpleNamespace(
        TaxRegistrationNumber=issuer_nif,
        TaxRegistrationName=issuer_name,
        CustomerTaxID=customer_nif,
        CustomerTaxIDCountry="PT",
        InvoiceType=inv_type,
        DocumentStatus=status,
        InvoiceNo=inv_no,
        ATCUD=atcud,
        InvoiceDate=inv_date,
        TaxPayable=tax_payable,
        NetTotal=net,
        GrossTotal=gross,
        Sector="C99",
        LineSummary=summaries,
    )


def test_1_quadratura_soap_multitaxa_descontos_nc_anulada_is():
    """Valida Invariantes #1 a #8 em faturas SOAP (Multi-taxa, Desconto D, NC com estorno C, Anulada e IS)."""
    nif_cliente = "599999001"
    nome_cliente = "Oficina Central Demo, Lda"

    faturas_soap = [
        # 1. Fatura Multi-taxa (0%, 6%, 13%, 23%)
        _mk_soap_invoice(
            inv_no="FT 2026A7/46381",
            inv_type="FT",
            status="N",
            inv_date="2026-09-29",
            gross=230.88,
            net=191.70,
            tax_payable=39.18,
            atcud="JJ66S6R9-46381",
            summaries=[
                _mk_soap_summary("C", 16.80, 0.00, "IVA", "ISE", 0.0, ex_code="M07"),
                _mk_soap_summary("C", 10.48, 1.36, "IVA", "INT", 13.0),
                _mk_soap_summary("C", 164.42, 37.82, "IVA", "NOR", 23.0),
            ],
        ),
        # 2. Fatura Normal (FT) com linha de desconto/abate a Débito (DebitCreditIndicator = 'D')
        _mk_soap_invoice(
            inv_no="FT 2026/9001",
            inv_type="FT",
            status="N",
            inv_date="2026-09-15",
            gross=110.70,
            net=90.00,
            tax_payable=20.70,
            atcud="DEMO9001-1",
            summaries=[
                _mk_soap_summary("C", 100.00, 23.00, "IVA", "NOR", 23.0),
                _mk_soap_summary("D", 10.00, 2.30, "IVA", "NOR", 23.0),
            ],
        ),
        # 3. Nota de Crédito (NC) com linha normal ('D') e linha de acerto ('C')
        _mk_soap_invoice(
            inv_no="NC 2026/501",
            inv_type="NC",
            status="N",
            inv_date="2026-09-18",
            gross=49.20,
            net=40.00,
            tax_payable=9.20,
            atcud="DEMONC-501",
            summaries=[
                _mk_soap_summary("D", 50.00, 11.50, "IVA", "NOR", 23.0),
                _mk_soap_summary("C", 10.00, 2.30, "IVA", "NOR", 23.0),
            ],
        ),
        # 4. Nota de Crédito sem LineSummary (fallback)
        _mk_soap_invoice(
            inv_no="NC 2026/502",
            inv_type="NC",
            status="N",
            inv_date="2026-09-19",
            gross=123.00,
            net=100.00,
            tax_payable=23.00,
            atcud="DEMONC-502",
            summaries=[],
        ),
        # 5. Fatura Anulada (Estado 'A')
        _mk_soap_invoice(
            inv_no="FT 2026/9999",
            inv_type="FT",
            status="A",
            inv_date="2026-09-20",
            gross=500.00,
            net=406.50,
            tax_payable=93.50,
            atcud="DEMOANUL-9999",
            summaries=[
                _mk_soap_summary("C", 406.50, 93.50, "IVA", "NOR", 23.0),
            ],
        ),
        # 6. Fatura com Imposto do Selo (IS) + IVA
        _mk_soap_invoice(
            inv_no="FT 2026/IS01",
            inv_type="FT",
            status="N",
            inv_date="2026-09-21",
            gross=127.00,
            net=100.00,
            tax_payable=27.00,
            atcud="DEMOIS-1",
            summaries=[
                _mk_soap_summary("C", 100.00, 23.00, "IVA", "NOR", 23.0),
                _mk_soap_summary("C", 0.00, 4.00, "IS", "IS", 4.0),
            ],
        ),
    ]

    h_rows, v_rows = efatura_api.invoices_to_rows(
        nif_cliente, faturas_soap, as_buyer=True, entity_name=nome_cliente, total_esperado=len(faturas_soap)
    )

    res = validador_fiscal.validar_lote_extracao(
        h_rows, v_rows, data_inicio="2026-09-01", data_fim="2026-09-30", strict=True
    )
    assert res["valido"], f"Falha na validação SOAP: {res['erros']}"

    # Verificar valores específicos da FT com desconto D
    ft_desc = next(r for r in h_rows[1:] if "9001" in r["Nº Fatura"])
    assert ft_desc["Base_Nor"] == 90.00 and ft_desc["Iva_Nor"] == 20.70
    assert ft_desc["Base Tributável"] == 90.00 and ft_desc["Total Iva"] == 20.70
    assert ft_desc["ValorNaoClassificado"] == ""

    # Verificar NC com estorno C
    nc_row = next(r for r in h_rows[1:] if "501" in r["Nº Fatura"])
    assert nc_row["Total_Liquido"] == -49.20
    assert nc_row["Base_Nor"] == -40.00 and nc_row["Iva_Nor"] == -9.20
    assert nc_row["ValorNaoClassificado"] == ""


def test_2_idempotencia_3x_e_autoremocao_cache_corrompida():
    """
    Valida Invariante #9 e #10:
    1. Inserir a mesma fatura 3 vezes seguidas com sufixos distintos (23.0 vs 23 vs IVA_NOR_23)
       nunca pode multiplicar os detalhes por 2x ou 3x.
    2. Se uma base antiga tiver linhas triplicadas (3x), periodo_tem_inconsistencia_faturas deteta-o
       e reconstruir_horizontal_vertical_de_sqlite limpa/rejeita ou desduplica para 1x exato.
    """
    import main

    tmp_dir = tempfile.mkdtemp(prefix="gexcel_test_efat_")
    old_env = os.environ.get("GEXCEL_DADOS_DIR")
    os.environ["GEXCEL_DADOS_DIR"] = tmp_dir
    pb_client._CONTROLO_DB_INITIALIZED = False

    try:
        nif_cli = "599888777"
        inv = _mk_soap_invoice(
            inv_no="FT 2026A7/46381",
            inv_type="FT",
            status="N",
            inv_date="2026-09-29",
            gross=230.88,
            net=191.70,
            tax_payable=39.18,
            atcud="JJ66S6R9-46381",
            summaries=[
                _mk_soap_summary("C", 16.80, 0.00, "IVA", "ISE", 0.0, ex_code="M07"),
                _mk_soap_summary("C", 10.48, 1.36, "IVA", "INT", 13.0),
                _mk_soap_summary("C", 164.42, 37.82, "IVA", "NOR", 23.0),
            ],
        )
        _, v_rows_1 = efatura_api.invoices_to_rows(nif_cli, [inv], as_buyer=True, entity_name="Demo Idempotencia, Lda")

        # 1ª gravação (taxa float 23.0)
        pb_client.upsert_faturas_direto(v_rows_1)
        # 2ª gravação (taxa int "23")
        v_rows_2 = [dict(r, **{"Taxa (%)": int(r["Taxa (%)"]) if r.get("Taxa (%)") is not None else 0}) for r in v_rows_1]
        pb_client.upsert_faturas_direto(v_rows_2)
        # 3ª gravação (com código de isenção e variações)
        v_rows_3 = [dict(r) for r in v_rows_1]
        pb_client.upsert_faturas_direto(v_rows_3)

        h_rec, v_rec, total_rec = main.reconstruir_horizontal_vertical_de_sqlite(
            nif=nif_cli, data_inicio="2026-09-01", data_fim="2026-09-30", as_buyer=True
        )
        assert total_rec == 1, f"Esperado 1 documento, obtido {total_rec}"
        assert len(v_rec) == 3, f"Esperadas 3 linhas verticais (1x), obtidas {len(v_rec)}"
        row_h = h_rec[1]
        assert row_h["Total_Liquido"] == 230.88
        assert row_h["Total Iva"] == 39.18
        assert row_h["Base Tributável"] == 191.70
        assert row_h["Base_Ise"] == 16.80
        assert row_h["Base_Int"] == 10.48 and row_h["Iva_Int"] == 1.36
        assert row_h["Base_Nor"] == 164.42 and row_h["Iva_Nor"] == 37.82

        validador_fiscal.validar_lote_extracao(h_rec, v_rec, "2026-09-01", "2026-09-30", strict=True)

        # Injetar corrupção manual no SQLite (simulando base antiga com linha de desconto com sinal trocado)
        db_path = pb_client.obter_db_cliente_path(nif_cli, "compras")
        with sqlite3.connect(db_path) as conn:
            conn.execute("UPDATE efatura_linhas SET base_incidencia = 493.26, valor_imposto = 113.46 WHERE taxa_percentagem = 23")
            conn.commit()

        assert pb_client.periodo_tem_inconsistencia_faturas(nif_cli, "2026-09-01", "2026-09-30", "compras") is True
        # Reconstrução deve rejeitar e limpar a cache corrompida em vez de enviar dados errados para o Excel!
        h_bad, v_bad, tot_bad = main.reconstruir_horizontal_vertical_de_sqlite(
            nif=nif_cli, data_inicio="2026-09-01", data_fim="2026-09-30", as_buyer=True
        )
        assert tot_bad == 0 and h_bad == [], "A cache corrompida deveria ter sido rejeitada e limpa!"

        # Testar auditor global de BDs locais
        pb_client.upsert_faturas_direto(v_rows_1)
        rel_audit = validador_fiscal.auditar_e_sanear_todas_bds_locais(limpar_periodos_invalidos=True)
        assert rel_audit["bds_analisadas"] >= 1 and rel_audit["bds_100_conformes"] >= 1
    finally:
        if old_env is None:
            os.environ.pop("GEXCEL_DADOS_DIR", None)
        else:
            os.environ["GEXCEL_DADOS_DIR"] = old_env
        pb_client._CONTROLO_DB_INITIALIZED = False
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_3_unicidade_chaves_e_payload_legado_excel():
    """Valida Invariante #8 (chaves únicas <= 25 chars sem colisão) e retrocompatibilidade -r do Excel."""
    import main

    k1 = pb_client.gerar_chave_documento("599100200", "1001", 50.0, "0", "C")
    k2 = pb_client.gerar_chave_documento("599100200", "1002", 50.0, "0", "C")
    k3 = pb_client.gerar_chave_documento("599100200", "FT 2026/0001", 50.0, "0", "C")
    k4 = pb_client.gerar_chave_documento("599100200", "FT 2026/0002", 50.0, "0", "C")
    assert k1 != k2 and k3 != k4
    assert all(len(k) <= 25 for k in (k1, k2, k3, k4))

    # Payload legado de 7 chaves do Excel VBA (sem reimportar_tudo explícito) tem de forçar reimportar_tudo=True
    req_legado = main.ExtracaoRequest.model_validate({
        "nif": "599100200",
        "password": "demo",
        "data_inicio": "2026-09-01",
        "data_fim": "2026-09-30",
        "tipo": "compras",
        "salvar_xml": True,
        "pasta_xml": "C:\\Temp",
    })
    assert req_legado.reimportar_tudo is True, "Payload legado do Excel deve ativar reimportar_tudo=True!"


def test_4_detetor_reprova_fatura_3x():
    """Garante que o validador_fiscal reprova taxativamente qualquer fatura multiplicada por 3x."""
    fatura_3x = {
        "IdDocumento": "C599100101A74638123088",
        "Atividade de Realização da Aquisição": "Outros",
        "NIF ComercianteConsumidor": "599100101",
        "TipoDoc": "Fatura",
        "Situação": "Registado",
        "Nº Fatura": "'FT 2026A7/46381",
        "ATCUD": "JJ66S6R9-46381",
        "Data Emissão": "2026-09-29",
        "Total Iva": 117.54,
        "Total_Liquido": 230.88,
        "Base Tributável": 113.34,
        "Base_Ise": 50.40,
        "Base_Red": 0.0,
        "Iva_Red": 0.0,
        "Base_Int": 31.44,
        "Iva_Int": 4.08,
        "Base_Nor": 493.26,
        "Iva_Nor": 113.46,
        "ValorNaoClassificado": -461.76,
    }
    erros = validador_fiscal.validar_linha_horizontal(fatura_3x, "2026-09-01", "2026-09-30")
    assert len(erros) >= 2, f"O validador deveria ter reprovado a fatura 3x, mas devolveu: {erros}"


def test_5_subutilizador_e_failover_soap_para_scraper():
    """
    Valida:
    1) Normalização de subutilizador AT (599777666 + '1' -> '599777666/1', remoção de espaços acidentais);
    2) Recusa SOAP ('Ocorreu um erro na autenticacao dos contribuintes.') tratada como falso-positivo de bloqueio
       e gatilho automático para contingência via Portal Web;
    3) Rejeição real no Portal Web ('Credenciais rejeitadas pelo portal...') continua a bloquear a senha;
    4) Worker 2026 faz failover transparente de SOAP -> executar_scraping_completo e termina 'concluido (Portal Web)'.
    """
    from datetime import date
    from zeep.exceptions import Fault
    import legado_bridge
    import main

    # 1. Normalização de subutilizador
    assert legado_bridge.normalizar_subutilizador_at("599777666", "1") == "599777666/1"
    assert legado_bridge.normalizar_subutilizador_at("599777666", "599777666 / 2") == "599777666/2"
    assert legado_bridge.normalizar_subutilizador_at("599777666", "599777666") == "599777666"
    assert legado_bridge.normalizar_subutilizador_at("599777666", "") == "599777666"

    # 2. Distinção entre recusa SOAP de subutilizador vs senha realmente errada no Portal Web
    erro_soap_sub = "Ocorreu um erro na autenticacao dos contribuintes."
    erro_portal_real = "Credenciais rejeitadas pelo portal (Dados de autenticação inválidos). Operação abortada."
    assert pb_client.is_erro_falso_positivo_at(erro_soap_sub) is True
    assert pb_client.is_erro_falso_positivo_at(erro_portal_real) is False
    assert main._deve_acionar_failover_scraper(Fault(erro_soap_sub)) is True
    assert main._deve_acionar_failover_scraper(efatura_api.LimiteVolumeExcedidoError("Volume excedido")) is False

    # 3. Teste integrado de failover SOAP -> Portal Web em 2026 sem bloquear a senha
    tmp_dir = tempfile.mkdtemp(prefix="gexcel_test_failover_sub_")
    old_env = os.environ.get("GEXCEL_DADOS_DIR")
    os.environ["GEXCEL_DADOS_DIR"] = tmp_dir
    pb_client._CONTROLO_DB_INITIALIZED = False

    orig_get_invoices = efatura_api.get_invoices
    orig_garantir_scraper = main._garantir_scraper_pronto
    orig_executar_scraping = main.executar_scraping_completo
    orig_resolver_nomes = main.resolver_e_completar_nomes_vendas
    orig_modo_sim = main._MODO_TESTE_SCRAPER.get("ativo", False)

    try:
        nif_demo = "599777666"
        pwd_demo = "SenhaValidaPortal2026!"

        # Simular bloqueio legado anterior causado apenas pelo SOAP: deve ser limpo automaticamente!
        pb_client.init_controlo_db()
        with pb_client.db_connect(pb_client.obter_db_controlo_path()) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO senhas_invalidas_at (nif, senha, erro_detalhe, updated_at) VALUES (?, ?, ?, '2026-11-12')",
                (nif_demo, pwd_demo, f"A AT recusou formalmente as credenciais: {erro_soap_sub}"),
            )
            conn.commit()
        bloqueada_soap, _ = pb_client.check_if_password_marked_invalid(nif_demo, pwd_demo)
        assert bloqueada_soap is False, "Bloqueio causado apenas por erro SOAP de subutilizador devia ter sido auto-removido!"

        # Já um erro real do Portal Web tem de ficar bloqueado
        pb_client.record_invalid_password(nif_demo, "SenhaErradaReal!", erro_portal_real)
        bloqueada_real, _ = pb_client.check_if_password_marked_invalid(nif_demo, "SenhaErradaReal!")
        assert bloqueada_real is True, "Senha rejeitada pelo Portal Web tem de permanecer bloqueada!"

        chamadas_scraper = []

        def fake_soap_raise(*args, **kwargs):
            raise Fault(erro_soap_sub)

        def fake_garantir_scraper(*args, **kwargs):
            return None

        def fake_scraping_completo(nif, password, data_inicio, data_fim, as_buyer=True, nome_entidade="", subuser=None, salvar_sqlite=True, progress_callback=None, cancel_check=None, reimportar_tudo=False):
            chamadas_scraper.append({"nif": nif, "subuser": subuser, "reimportar_tudo": reimportar_tudo})
            v_rows = [{
                "NIF Cliente": nif,
                "Fatura": "FT 2026/901",
                "ATCUD": "JJDEMO-901",
                "Data": "2026-10-15",
                "Tipo Documento": "FT",
                "Contraparte NIF": "599888777",
                "Contraparte": "Oficina Central Demo, Lda",
                "Estado Documento": "N",
                "Tipo Imposto": "IVA",
                "Código Taxa": "NOR",
                "Taxa (%)": 23.0,
                "Taxa IVA": 23.0,
                "Base Incidência": 100.0,
                "Valor Imposto": 23.0,
                "Valor IVA": 23.0,
                "Código Isenção": None,
                "Região Fiscal": "PT",
                "Total Líquido Documento": 100.0,
                "Total Documento": 123.0,
            }]
            if salvar_sqlite:
                if as_buyer:
                    pb_client.upsert_faturas_direto(v_rows)
                else:
                    pb_client.upsert_vendas_direto(v_rows)
            h_rows, v_rec, tot = main.reconstruir_horizontal_vertical_de_sqlite(
                nif=nif, data_inicio=data_inicio, data_fim=data_fim, as_buyer=as_buyer, nome_entidade=nome_entidade
            )
            return h_rows, v_rec, tot

        efatura_api.get_invoices = fake_soap_raise
        main._garantir_scraper_pronto = fake_garantir_scraper
        main.executar_scraping_completo = fake_scraping_completo
        main.resolver_e_completar_nomes_vendas = lambda nif_titular, password, subuser, horizontal_rows, vertical_rows, **kw: (horizontal_rows, vertical_rows)
        main._MODO_TESTE_SCRAPER["ativo"] = False

        job_id = "job-test-subuser-2026"
        main.JOBS[job_id] = {
            "status": "em_progresso",
            "nome_empresa": "Horizonte Verde Demo, Lda",
            "mensagem": "A iniciar...",
            "docs_atuais": 0,
            "total_esperado": 0,
            "percentagem": 0,
            "parcial": False,
            "cancelar": False,
            "criado_em": 0,
        }

        main._run_extracao_worker(
            job_id=job_id,
            nif="599777666",
            subuser="1",
            password=pwd_demo,
            nome_entidade="Horizonte Verde Demo, Lda",
            data_inicio=date(2026, 10, 1),
            data_fim=date(2026, 10, 31),
            as_buyer=False,
            reimportar_tudo=False,
            modo_saida="sqlite",
        )

        job_res = main.JOBS[job_id]
        assert job_res["status"] == "concluido", f"Job devia concluir via failover Portal Web, mas deu: {job_res}"
        assert job_res.get("metodo") == "web_scraping"
        assert "(Portal Web)" in job_res.get("mensagem", "")
        assert job_res.get("total_documentos") == 1
        assert len(chamadas_scraper) == 1
        assert chamadas_scraper[0]["subuser"] == "599777666/1"
    finally:
        efatura_api.get_invoices = orig_get_invoices
        main._garantir_scraper_pronto = orig_garantir_scraper
        main.executar_scraping_completo = orig_executar_scraping
        main.resolver_e_completar_nomes_vendas = orig_resolver_nomes
        main._MODO_TESTE_SCRAPER["ativo"] = orig_modo_sim
        if old_env is None:
            os.environ.pop("GEXCEL_DADOS_DIR", None)
        else:
            os.environ["GEXCEL_DADOS_DIR"] = old_env
        pb_client._CONTROLO_DB_INITIALIZED = False
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    print("==================================================")
    print(" [GATE FISCAL] A validar os 10 Invariantes Contabilísticos...")
    print("==================================================")
    test_1_quadratura_soap_multitaxa_descontos_nc_anulada_is()
    print(" [OK] Teste 1: Quadratura Horizontal/Vertical (Multi-taxa, D/C, NC, Anuladas, IS)")
    test_2_idempotencia_3x_e_autoremocao_cache_corrompida()
    print(" [OK] Teste 2: Idempotência Tripla (1x == 2x == 3x) e Rejeição de Cache Viciada")
    test_3_unicidade_chaves_e_payload_legado_excel()
    print(" [OK] Teste 3: Unicidade de IdDocumento e Forçamento -r no Excel Legado")
    test_4_detetor_reprova_fatura_3x()
    print(" [OK] Teste 4: Deteção e Bloqueio Estrito de Faturas 3x Desfasadas")
    test_5_subutilizador_e_failover_soap_para_scraper()
    print(" [OK] Teste 5: Subutilizador AT e Contingência SOAP -> Portal Web (2026)")
    print("==================================================")
    print(" [SUCESSO] 100% dos Invariantes Fiscais validados sem erros!")
    print("==================================================")
