# -*- coding: utf-8 -*-
"""
Suite de Testes Unitários e de Integração para o Motor de Pendentes (pendentes_service.py).
Executa 100% em base SQLite temporária isolada e utiliza estritamente NIFs fictícios.
"""

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TMP_DIR = tempfile.mkdtemp(prefix="gexcel_pend_test_")
TMP_DB = os.path.join(TMP_DIR, "pendentes_teste.db")
os.environ["GEXCEL_PENDENTES_DB_PATH"] = TMP_DB

import pendentes_service as ps  # noqa: E402


def test_1_nifs_singulares_e_catalogo_16_setores():
    assert ps.is_nif_singular("200685341") is True
    assert ps.is_nif_singular("123456789") is True
    assert ps.is_nif_singular("312345678") is True
    assert ps.is_nif_singular("451234567") is True
    assert ps.is_nif_singular("501596968") is False
    assert ps.is_nif_singular("599999001") is False
    assert ps.is_nif_singular("999999990") is False
    assert ps.is_nif_singular("12345") is False

    cat = ps.obter_catalogo(db_path=TMP_DB)
    codigos = {s["codigo"] for s in cat["setores"]}
    esperados = {f"C{i:02d}" for i in range(1, 16)} | {"C99"}
    assert codigos == esperados, f"Setores divergentes: {codigos ^ esperados}"
    assert len(cat["setores"]) == 16

    for cod_pessoal in ("C05", "C06", "C08", "C09", "C10", "C11", "C12", "C13", "C14", "C15"):
        assert cod_pessoal in ps.SETORES_AUTO_FORA
        sug = ps.calcular_preclassificacao_documento(
            {"setor_at_original": cod_pessoal, "ambito_at_original": "", "nif_emitente": "599100001", "nome_emitente": "Demo"},
            modo_tudo_fora=False,
        )
        assert sug["setor_codigo"] == cod_pessoal
        assert sug["ambito_codigo"] == "1"
        assert sug["validado"] == 0


def test_2_cascata_preclassificacao_e_historico_dividido():
    palavras = ps.listar_palavras_chave(apenas_ativas=True, db_path=TMP_DB)

    # 1. Modo Tudo Fora sobrepõe-se a tudo
    s_tf = ps.calcular_preclassificacao_documento(
        {"setor_at_original": "", "ambito_at_original": "", "nif_emitente": "599100111", "nome_emitente": "Oficina Demo"},
        modo_tudo_fora=True,
        palavras_chave=palavras,
    )
    assert s_tf["setor_codigo"] == "C99"
    assert s_tf["ambito_codigo"] == "1"
    assert s_tf["origem_sugestao"] == "tudo_fora"
    assert s_tf["validado"] == 0

    # 2. Histórico ano atual prevalece sobre ano anterior e sinaliza '%' se dividido
    hist_atual = {
        "599100222": {"setores": {"C99": 4, "C03": 1}, "ambitos": {"0": 4, "1": 1}, "ano": 2026}
    }
    hist_ant = {
        "599100222": {"setores": {"C03": 10}, "ambitos": {"1": 10}, "ano": 2025},
        "599100333": {"setores": {"C03": 5}, "ambitos": {"0": 5}, "ano": 2025},
    }
    s_ha = ps.calcular_preclassificacao_documento(
        {"setor_at_original": "", "ambito_at_original": "", "nif_emitente": "599100222", "nome_emitente": "Fornecedor Misto Demo", "ano": 2026},
        modo_tudo_fora=False,
        hist_ano_atual=hist_atual,
        hist_ano_ant=hist_ant,
        palavras_chave=palavras,
        ano_atual=2026,
        ano_anterior=2025,
    )
    assert s_ha["setor_codigo"] == "C99"
    assert s_ha["ambito_codigo"] == "0"
    assert s_ha["historico_dividido_setor"] == 1
    assert s_ha["historico_dividido_ambito"] == 1
    assert s_ha["origem_sugestao"] == "historico_ano_atual"
    assert s_ha["validado"] == 0

    # 3. Fallback para ano anterior
    s_hp = ps.calcular_preclassificacao_documento(
        {"setor_at_original": "", "ambito_at_original": "", "nif_emitente": "599100333", "nome_emitente": "Restaurante Demo", "ano": 2026},
        modo_tudo_fora=False,
        hist_ano_atual=hist_atual,
        hist_ano_ant=hist_ant,
        palavras_chave=palavras,
        ano_atual=2026,
        ano_anterior=2025,
    )
    assert s_hp["setor_codigo"] == "C03"
    assert s_hp["ambito_codigo"] == "0"
    assert s_hp["historico_dividido_setor"] == 0
    assert s_hp["historico_dividido_ambito"] == 0
    assert s_hp["origem_sugestao"] == "historico_ano_anterior"
    assert s_hp["validado"] == 0

    # 4. Fallback para palavra-chave (Ginásios C11 -> auto Fora '1')
    s_kw = ps.calcular_preclassificacao_documento(
        {"setor_at_original": "", "ambito_at_original": "", "nif_emitente": "599100444", "nome_emitente": "Holmes Place Demo SA", "ano": 2026},
        modo_tudo_fora=False,
        hist_ano_atual={},
        hist_ano_ant={},
        palavras_chave=palavras,
        ano_atual=2026,
        ano_anterior=2025,
    )
    assert s_kw["setor_codigo"] == "C11"
    assert s_kw["ambito_codigo"] == "1"
    assert s_kw["origem_sugestao"] == "palavra_chave"
    assert s_kw["validado"] == 0


def test_3_bloco_fornecedor_validacao_cliente_e_travao_termo():
    cli1 = "299000101"
    cli2 = "299000202"
    forn_a = "599200111"
    forn_b = "599200222"

    docs_cli1 = [
        {
            "id_documento": "1001", "id_fatura_unico": "C1001", "data_emissao": "2026-03-10",
            "nif_emitente": forn_a, "nome_emitente": "Fornecedor Alfa Demo",
            "tipo_documento": "FT", "tipo_documento_desc": "Fatura", "numero_documento": "FT 2026/1",
            "valor_total": 123.0, "base_tributavel": 100.0, "valor_iva": 23.0,
            "estado_beneficio": "P", "actividade_emitente": "", "actividade_prof": "",
        },
        {
            "id_documento": "1002", "id_fatura_unico": "C1002", "data_emissao": "2026-03-12",
            "nif_emitente": forn_a, "nome_emitente": "Fornecedor Alfa Demo",
            "tipo_documento": "FT", "tipo_documento_desc": "Fatura", "numero_documento": "FT 2026/2",
            "valor_total": 61.5, "base_tributavel": 50.0, "valor_iva": 11.5,
            "estado_beneficio": "P", "actividade_emitente": "", "actividade_prof": "",
        },
        {
            "id_documento": "1003", "id_fatura_unico": "C1003", "data_emissao": "2026-03-15",
            "nif_emitente": forn_b, "nome_emitente": "Fornecedor Beta Demo",
            "tipo_documento": "FT", "tipo_documento_desc": "Fatura", "numero_documento": "FT 2026/3",
            "valor_total": 30.0, "base_tributavel": 30.0, "valor_iva": 0.0,
            "estado_beneficio": "P", "actividade_emitente": "", "actividade_prof": "",
        },
        # Documento não admitido (Orçamento) deve ser ignorado
        {
            "id_documento": "1004", "id_fatura_unico": "C1004", "data_emissao": "2026-03-16",
            "nif_emitente": forn_b, "nome_emitente": "Fornecedor Beta Demo",
            "tipo_documento": "OR", "tipo_documento_desc": "Orçamentos", "numero_documento": "OR 2026/4",
            "valor_total": 500.0, "base_tributavel": 500.0, "valor_iva": 0.0,
            "estado_beneficio": "P", "actividade_emitente": "", "actividade_prof": "",
        },
    ]
    docs_cli2 = [
        {
            "id_documento": "2001", "id_fatura_unico": "C2001", "data_emissao": "2026-03-11",
            "nif_emitente": forn_a, "nome_emitente": "Fornecedor Alfa Demo",
            "tipo_documento": "FT", "tipo_documento_desc": "Fatura", "numero_documento": "FT 2026/9",
            "valor_total": 246.0, "base_tributavel": 200.0, "valor_iva": 46.0,
            "estado_beneficio": "P", "actividade_emitente": "", "actividade_prof": "",
        },
    ]

    r1 = ps.guardar_documentos_pendentes_entidade(cli1, "Contribuinte Demo Um", 2026, docs_cli1, db_path=TMP_DB)
    r2 = ps.guardar_documentos_pendentes_entidade(cli2, "Contribuinte Demo Dois", 2026, docs_cli2, db_path=TMP_DB)
    assert r1["total_pendentes"] == 3
    assert r2["total_pendentes"] == 1

    # Classificar fornecedor_cliente no cli1 -> NÃO deve afetar forn_a no cli2!
    ps.classificar_documentos(
        escopo="fornecedor_cliente",
        ano=2026,
        nif_cliente=cli1,
        nif_emitente=forn_a,
        setor_codigo="C01",
        ambito_codigo="0",
        db_path=TMP_DB,
    )
    consulta = ps.consultar_pendentes(ano=2026, db_path=TMP_DB)
    docs_map = {d["chave_linha"]: d for d in consulta["documentos"]}
    assert docs_map[f"{cli1}:1001"]["setor_codigo"] == "C01"
    assert docs_map[f"{cli1}:1002"]["setor_codigo"] == "C01"
    assert docs_map[f"{cli1}:1001"]["ambito_codigo"] == "0"
    assert docs_map[f"{cli2}:2001"]["setor_codigo"] == ""

    # Validar preenchidos do cli1 -> valida 1001 e 1002, ignora 1003 (incompleto)
    v_res = ps.validar_documentos(
        escopo="cliente_preenchidos",
        acao="validar",
        ano=2026,
        nif_cliente=cli1,
        utilizador="Tester Demo",
        db_path=TMP_DB,
    )
    assert v_res["atualizados"] == 2
    assert v_res["ignorados_incompletos"] == 1

    # Travão Fiscal: recusar termo não aceite
    recusou = False
    try:
        ps.registar_termo_responsabilidade(
            ano=2026,
            termo_aceite=False,
            texto_termo="Declaro...",
            utilizador="Tester Demo",
            db_path=TMP_DB,
        )
    except ValueError:
        recusou = True
    assert recusou is True

    # Travão Fiscal no job se termo_id inválido
    jobs = {"j_block": {"status": "em_progresso", "cancelar": False}}
    ps.executar_job_submissao_pendentes("j_block", jobs, ano=2026, termo_id="termo_inexistente", db_path=TMP_DB)
    assert jobs["j_block"]["status"] == "erro"

    # Registar termo válido + simulação
    termo = ps.registar_termo_responsabilidade(
        ano=2026,
        termo_aceite=True,
        texto_termo="Declaro responsabilidade.",
        utilizador="Tester Demo",
        email_utilizador="demo@gexcel.pt",
        nifs=[cli1],
        db_path=TMP_DB,
    )
    assert termo["total_documentos"] == 2
    assert len(termo["resumo_sha256"]) == 64

    jobs2 = {"j_sim": {"status": "em_progresso", "cancelar": False}}
    ps.executar_job_submissao_pendentes(
        "j_sim",
        jobs2,
        ano=2026,
        termo_id=termo["termo_id"],
        nifs=[cli1],
        modo_simulacao=True,
        db_path=TMP_DB,
    )
    assert jobs2["j_sim"]["status"] == "concluido"
    termos = ps.listar_termos_responsabilidade(db_path=TMP_DB)
    assert len(termos) == 1 and termos[0]["id"] == termo["termo_id"]


def test_4_crud_palavras_chave_e_tudo_fora():
    kw = ps.guardar_palavra_chave("GINASIO DEMO TESTE", "C11", "", db_path=TMP_DB)
    assert kw["setor_codigo"] == "C11"
    assert kw["ambito_codigo"] == "1"
    assert ps.eliminar_palavra_chave(kw["id"], db_path=TMP_DB) is True


def test_5_ensaio_visivel_nao_destrutivo():
    cli1 = "299000101"

    class _FakeRouteReq:
        def __init__(self, url):
            self.url = url

    class _FakeRoute:
        def __init__(self, url):
            self.request = _FakeRouteReq(url)
            self.action = None

        def continue_(self):
            self.action = "continue"

        def abort(self):
            self.action = "abort"

    class _FakeLocator:
        def __init__(self, count_val=0, visible_val=False):
            self._count = count_val
            self._visible = visible_val

        def count(self):
            return self._count

        def is_visible(self, timeout=0):
            return self._visible

        def click(self, timeout=0):
            return None

    class _FakePage:
        def __init__(self):
            self.url = "https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action"
            self.route_handler = None
            self.evals = []
            self.gotos = []
            self.context = type("Ctx", (), {"pages": [self]})()

        def set_viewport_size(self, vp):
            self.viewport = vp

        def bring_to_front(self):
            pass

        def route(self, pattern, handler):
            self.route_handler = handler

        def goto(self, url, wait_until="domcontentloaded", timeout=30000):
            self.gotos.append(url)
            self.url = url

        def wait_for_timeout(self, ms):
            pass

        def locator(self, selector):
            if selector == "select[name='listaPendencias_length']":
                return _FakeLocator(count_val=1)
            return _FakeLocator(count_val=0, visible_val=False)

        def select_option(self, selector, value):
            pass

        def evaluate(self, script, arg=None):
            self.evals.append((script, arg))
            if "document.querySelectorAll('#listaPendencias tbody tr" in script:
                return ["1001", "1002"]
            if script == ps._JS_PREENCHER_LINHA_AT:
                return {
                    "encontrou": True,
                    "setor_clicado": True,
                    "ambito_clicado": True,
                    "setor_ativo": True,
                    "ambito_ativo": True,
                    "tem_ambito": True,
                }
            if "#listaPendencias_next" in script:
                return False
            return None

        def screenshot(self, type="jpeg", quality=78, full_page=False):
            return b"\xff\xd8\xff\xe0FAKEJPEGDATA"

    fake_page = _FakePage()
    fake_browser = type("Br", (), {"is_connected": lambda self: True})()

    class _FakeSessao:
        def __init__(self):
            self.page = fake_page
            self.browser = fake_browser
            self.closed = False

        def close(self):
            self.closed = True

    orig_creds = ps._obter_credenciais_entidade
    orig_platform = ps.sys.platform
    termos_antes = len(ps.listar_termos_responsabilidade(db_path=TMP_DB))
    jobs_ensaio = {"j_ensaio": {"status": "em_progresso", "cancelar": False}}

    try:
        ps._obter_credenciais_entidade = lambda nif: (nif, "senha_teste_demo")
        ps.sys.platform = "linux"
        ps.executar_job_ensaio_visivel_pendentes(
            job_id="j_ensaio",
            jobs_dict=jobs_ensaio,
            ano=2026,
            nifs=[cli1],
            iniciar_sessao_fn=lambda **kw: _FakeSessao(),
            db_path=TMP_DB,
        )
    finally:
        ps._obter_credenciais_entidade = orig_creds
        ps.sys.platform = orig_platform

    st = jobs_ensaio["j_ensaio"]
    assert st["status"] == "concluido"
    assert st["docs_atuais"] == 2
    assert len(st["ensaio_paginas_b64"]) == 1
    assert len(st["ensaio_itens"]) == 2
    assert all(it["preenchido_ecra"] is True for it in st["ensaio_itens"])
    assert st["ensaio_frame_b64"] != ""

    # Confirmar bloqueio de submissao na AT mas permissao da pagina Form
    assert fake_page.route_handler is not None
    r_form = _FakeRoute("https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action")
    r_post = _FakeRoute("https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirente.action")
    r_ind = _FakeRoute("https://faturas.portaldasfinancas.gov.pt/resolverPendenciaAdquirente.action")
    fake_page.route_handler(r_form)
    fake_page.route_handler(r_post)
    fake_page.route_handler(r_ind)
    assert r_form.action == "continue"
    assert r_post.action == "abort"
    assert r_ind.action == "abort"

    # Confirmar nao-destrutividade na BD (zero alteracoes nos documentos nem novos termos)
    consulta = ps.consultar_pendentes(ano=2026, nifs=[cli1], db_path=TMP_DB)
    docs_map = {d["id_documento"]: d for d in consulta["documentos"]}
    assert docs_map["1001"]["estado_submissao"] == "pendente"
    assert docs_map["1001"]["validado"] is True
    assert docs_map["1002"]["estado_submissao"] == "pendente"
    assert docs_map["1002"]["validado"] is True
    termos_depois = len(ps.listar_termos_responsabilidade(db_path=TMP_DB))
    assert termos_depois == termos_antes


if __name__ == "__main__":
    test_1_nifs_singulares_e_catalogo_16_setores()
    test_2_cascata_preclassificacao_e_historico_dividido()
    test_3_bloco_fornecedor_validacao_cliente_e_travao_termo()
    test_4_crud_palavras_chave_e_tudo_fora()
    test_5_ensaio_visivel_nao_destrutivo()
    print("OK: Todos os testes do motor pendentes_service passaram a 100%!")
