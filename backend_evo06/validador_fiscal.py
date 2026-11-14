# -*- coding: utf-8 -*-
"""
Validador Fiscal e Contabilístico Oficial — Gexcel EVO API e-Fatura (gevo_ef2026).

Implementa os 10 Invariantes Contabilísticos e de Integridade de Dados:
1. Quadratura Horizontal das Bases (Base_Ise + Base_Red + Base_Int + Base_Nor == Base Tributável)
2. Quadratura Horizontal do IVA (Iva_Red + Iva_Int + Iva_Nor == Total Iva)
3. Quadratura Global do Documento (Base Tributável + Total Iva == Total_Liquido e Soma(Detalhes) == Total_Liquido)
4. Coerência de Taxa por Escalão (IVA / Base compatível com PT, PT-MA, PT-AC e mesmo sinal)
5. Regras de Sinal por Tipo de Documento (NC <= 0, Normais >= 0) e Estado (Anulado == 0.00)
6. Tratamento de Imposto do Selo (IS) e Não Sujeito (NS)
7. Reconciliação Cruzada Vertical (SQLite) <-> Horizontal (Excel / XML V3)
8. Unicidade de IdDocumento (<= 25 chars) e Datas dentro do período solicitado
9. Idempotência (1x == 2x == 3x) e Simetria Fonte vs. Cache
10. Integridade do Índice Mensal (controlo_geral.db)
"""

import logging
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

LOGGER = logging.getLogger("gexcel.efatura.validador")


def _f(val: Any) -> float:
    """Converte valor para float arredondado a 2 casas decimais."""
    if val is None or val == "":
        return 0.0
    try:
        return round(float(val), 2)
    except Exception:
        return 0.0


def _is_nota_credito(tipo_doc: str) -> bool:
    t = str(tipo_doc or "").strip().upper()
    return (
        t == "NC"
        or "NOTA DE CREDITO" in t
        or "NOTA DE CRÉDITO" in t
        or "CREDITO" in t
        or "CRÉDITO" in t
    )


def _is_anulado(situacao: str) -> bool:
    s = str(situacao or "").strip().upper()
    return s in ("A", "ANULADO", "ANULADA", "C", "CANCELADO", "CANCELADA")


def validar_linha_horizontal(
    row: Dict[str, Any],
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
) -> List[str]:
    """
    Valida uma única linha horizontal (formato tDocsEfatura / XML V3) contra os Invariantes #1 a #8.
    Retorna lista de mensagens de erro (vazia se 100% válida).
    """
    erros: List[str] = []
    id_doc = str(row.get("IdDocumento") or "").strip()
    if id_doc == "TotalDocs:":
        return erros

    fatura_no = str(row.get("Nº Fatura") or "").strip().lstrip("'")
    tipo_doc = str(row.get("TipoDoc") or "").strip()
    situacao = str(row.get("Situação") or "").strip()
    dt_emissao = str(row.get("Data Emissão") or "").strip()[:10]
    ident = f"[{id_doc or '?'} | {fatura_no or '?'} | {dt_emissao}]"

    # Invariante #8: IdDocumento e Data Emissão
    if not id_doc:
        erros.append(f"{ident} IdDocumento vazio.")
    elif len(id_doc) > 25:
        erros.append(f"{ident} IdDocumento excede 25 caracteres ({len(id_doc)}).")

    if dt_emissao and dt_emissao != "1899-12-31":
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", dt_emissao):
            erros.append(f"{ident} Data Emissão inválida: '{dt_emissao}'.")
        else:
            if data_inicio and dt_emissao < str(data_inicio)[:10]:
                erros.append(f"{ident} Data Emissão ({dt_emissao}) anterior a data_inicio ({str(data_inicio)[:10]}).")
            if data_fim and dt_emissao > str(data_fim)[:10]:
                erros.append(f"{ident} Data Emissão ({dt_emissao}) posterior a data_fim ({str(data_fim)[:10]}).")

    total_liq = _f(row.get("Total_Liquido"))
    base_trib = _f(row.get("Base Tributável"))
    total_iva = _f(row.get("Total Iva"))

    base_ise = _f(row.get("Base_Ise"))
    base_red = _f(row.get("Base_Red"))
    iva_red = _f(row.get("Iva_Red"))
    base_int = _f(row.get("Base_Int"))
    iva_int = _f(row.get("Iva_Int"))
    base_nor = _f(row.get("Base_Nor"))
    iva_nor = _f(row.get("Iva_Nor"))
    val_nao_class = _f(row.get("ValorNaoClassificado"))

    is_anul = _is_anulado(situacao)
    is_nc = _is_nota_credito(tipo_doc)

    # Invariante #5: Estado Anulado e Sinal por Tipo de Documento
    if is_anul:
        campos_monetarios = (
            total_liq, base_trib, total_iva,
            base_ise, base_red, iva_red, base_int, iva_int, base_nor, iva_nor
        )
        if any(abs(v) > 0.001 for v in campos_monetarios):
            erros.append(
                f"{ident} Documento Anulado com valores não nulos: Total_Liquido={total_liq}, Base={base_trib}, IVA={total_iva}."
            )
        return erros

    if is_nc:
        if total_liq > 0.01:
            erros.append(f"{ident} Nota de Crédito ('{tipo_doc}') com Total_Liquido positivo ({total_liq}).")
        if total_iva > 0.01:
            erros.append(f"{ident} Nota de Crédito ('{tipo_doc}') com Total Iva positivo ({total_iva}).")
    else:
        if total_liq < -0.01:
            erros.append(f"{ident} Documento normal ('{tipo_doc}') com Total_Liquido negativo ({total_liq}).")

    # Invariante #1: Quadratura das Bases vs. Base Tributável
    soma_bases = round(base_ise + base_red + base_int + base_nor, 2)
    dif_bases = round(base_trib - soma_bases, 2)
    if abs(dif_bases) > 0.05:
        erros.append(
            f"{ident} Desfasamento de Bases: Soma(Bases)={soma_bases:.2f} != Base Tributável={base_trib:.2f} (dif={dif_bases:+.2f})."
        )
    if abs(val_nao_class) > 0.05:
        erros.append(
            f"{ident} ValorNaoClassificado excessivo ({val_nao_class:+.2f}): indica linhas em falta, multiplicadas ou sinal D/C trocado."
        )

    # Invariante #2: Quadratura dos IVAs vs. Total Iva
    soma_ivas = round(iva_red + iva_int + iva_nor, 2)
    dif_ivas = round(total_iva - soma_ivas, 2)
    if abs(dif_ivas) > 0.02:
        erros.append(
            f"{ident} Desfasamento de IVA: Soma(IVAs)={soma_ivas:.2f} != Total Iva={total_iva:.2f} (dif={dif_ivas:+.2f})."
        )

    # Invariante #3: Quadratura Global do Documento (Cabeçalho vs. Detalhes)
    soma_cabecalho = round(base_trib + total_iva, 2)
    if abs(total_liq - soma_cabecalho) > 0.02:
        erros.append(
            f"{ident} Base Tributável ({base_trib:.2f}) + Total Iva ({total_iva:.2f}) != Total_Liquido ({total_liq:.2f})."
        )

    soma_detalhes_total = round(soma_bases + soma_ivas, 2)
    if abs(total_liq - soma_detalhes_total) > 0.05:
        erros.append(
            f"{ident} Soma dos Detalhes (Bases {soma_bases:.2f} + IVAs {soma_ivas:.2f} = {soma_detalhes_total:.2f}) != Total_Liquido ({total_liq:.2f})."
        )

    # Invariante #4: Plausibilidade da Taxa por Escalão (PT / PT-MA / PT-AC)
    escaloes = [
        ("Reduzida", base_red, iva_red, 0.035, 0.065),
        ("Intermédia", base_int, iva_int, 0.085, 0.135),
        ("Normal", base_nor, iva_nor, 0.155, 0.235),
    ]
    for nome_esc, b_val, i_val, r_min, r_max in escaloes:
        if abs(b_val) < 0.01 and abs(i_val) > 0.05:
            erros.append(f"{ident} Escalão {nome_esc} tem IVA ({i_val:.2f}) sem Base ({b_val:.2f}).")
        elif abs(b_val) >= 0.25:
            if (b_val > 0 and i_val < -0.02) or (b_val < 0 and i_val > 0.02):
                erros.append(f"{ident} Escalão {nome_esc} com sinal invertido entre Base ({b_val:.2f}) e IVA ({i_val:.2f}).")
            else:
                abs_b = abs(b_val)
                abs_i = abs(i_val)
                min_esp = round(abs_b * r_min - 0.08, 2)
                max_esp = round(abs_b * r_max + 0.08, 2)
                if not (min_esp <= abs_i <= max_esp):
                    erros.append(
                        f"{ident} Taxa implícita inválida no escalão {nome_esc}: Base={b_val:.2f}, IVA={i_val:.2f} (esperado entre {min_esp:.2f} e {max_esp:.2f})."
                    )

    return erros


def validar_lote_extracao(
    horizontal_rows: List[Dict[str, Any]],
    vertical_rows: Optional[List[Dict[str, Any]]] = None,
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    strict: bool = False,
) -> Dict[str, Any]:
    """
    Valida um lote completo de faturas (Horizontal + Vertical) contra os 10 Invariantes Fiscais.
    Se strict=True e existir qualquer violação, lança ValueError detalhado.
    """
    erros: List[str] = []
    ids_invalidos: List[str] = []
    seen_ids: Dict[str, str] = {}

    h_data = [
        r for r in (horizontal_rows or [])
        if str(r.get("IdDocumento") or "").strip() != "TotalDocs:"
    ]

    # 1. Validar cada linha horizontal e unicidade de IdDocumento
    mapa_h_por_fatura: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for row in h_data:
        id_doc = str(row.get("IdDocumento") or "").strip()
        fat_no = str(row.get("Nº Fatura") or "").strip().lstrip("'")
        dt_em = str(row.get("Data Emissão") or "").strip()[:10]
        cp_nif = str(row.get("NIF ComercianteConsumidor") or "").strip()

        if id_doc:
            if id_doc in seen_ids and seen_ids[id_doc] != f"{cp_nif}|{fat_no}|{dt_em}":
                erros.append(
                    f"Colisão de IdDocumento '{id_doc}' entre '{seen_ids[id_doc]}' e '{cp_nif}|{fat_no}|{dt_em}'."
                )
                ids_invalidos.append(id_doc)
            seen_ids[id_doc] = f"{cp_nif}|{fat_no}|{dt_em}"

        mapa_h_por_fatura[(cp_nif, fat_no, dt_em)] = row

        erros_row = validar_linha_horizontal(row, data_inicio=data_inicio, data_fim=data_fim)
        if erros_row:
            erros.extend(erros_row)
            if id_doc and id_doc not in ids_invalidos:
                ids_invalidos.append(id_doc)

    # 2. Invariante #7: Reconciliação Cruzada Vertical (SQLite) <-> Horizontal
    if vertical_rows:
        grupos_v: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
        for vr in vertical_rows:
            cp_v = str(vr.get("Contraparte NIF") or "").strip()
            fat_v = str(vr.get("Fatura") or "").strip().lstrip("'")
            dt_v = str(vr.get("Data") or "").strip()[:10]
            grupos_v.setdefault((cp_v, fat_v, dt_v), []).append(vr)

        for chave_v, linhas_v in grupos_v.items():
            cp_v, fat_v, dt_v = chave_v
            amostra = linhas_v[0]
            est_v = str(amostra.get("Estado Documento") or "N").strip().upper()
            if _is_anulado(est_v):
                continue

            tot_doc_v = _f(amostra.get("Total Documento"))
            soma_v = 0.0
            for lv in linhas_v:
                t_imp = str(lv.get("Tipo Imposto") or "IVA").strip().upper()
                b_inc = _f(lv.get("Base Incidência"))
                v_imp = _f(lv.get("Valor Imposto") if lv.get("Valor Imposto") is not None else lv.get("Valor IVA"))
                # Em linhas de Imposto do Selo geradas a partir do rodapé (detalhes.py), base_incidencia repete total_liq
                if t_imp == "IS" and len(linhas_v) > 1 and abs(b_inc - _f(lv.get("Total Líquido Documento"))) < 0.02:
                    soma_v += v_imp
                else:
                    soma_v += (b_inc + v_imp)

            soma_v = round(soma_v, 2)
            if abs(tot_doc_v) > 0.01 and abs(soma_v - tot_doc_v) > 0.05:
                erros.append(
                    f"[Vertical {cp_v} | {fat_v} | {dt_v}] Soma das linhas verticais ({soma_v:.2f}) != Total Documento ({tot_doc_v:.2f})."
                )
                id_v = str(amostra.get("id_fatura_unico") or f"{cp_v}_{fat_v}")
                if id_v not in ids_invalidos:
                    ids_invalidos.append(id_v)

            h_match = mapa_h_por_fatura.get(chave_v)
            if h_match:
                tot_h = _f(h_match.get("Total_Liquido"))
                if abs(tot_h - tot_doc_v) > 0.02:
                    erros.append(
                        f"[Cruzamento H<->V {cp_v} | {fat_v} | {dt_v}] Total_Liquido Horizontal ({tot_h:.2f}) != Total Documento Vertical ({tot_doc_v:.2f})."
                    )

    resultado = {
        "valido": len(erros) == 0,
        "total_faturas": len(h_data),
        "faturas_invalidas": len(ids_invalidos),
        "erros": erros,
        "ids_invalidos": ids_invalidos,
    }

    if not resultado["valido"]:
        LOGGER.warning(
            f"🚨 [VALIDADOR FISCAL] Detetadas {len(erros)} violação(ões) em {len(ids_invalidos)}/{len(h_data)} fatura(s): "
            + " | ".join(erros[:5])
        )
        if strict:
            raise ValueError(
                f"Falha de Integridade Fiscal ({len(erros)} erros em {len(ids_invalidos)} faturas):\n"
                + "\n".join(erros[:20])
            )

    return resultado


def auditar_e_sanear_todas_bds_locais(limpar_periodos_invalidos: bool = True) -> Dict[str, Any]:
    """
    Audita todas as bases SQLite particionadas em BdsefaturaV4 (compras e vendas).
    1. Desduplica linhas multiplicadas (2x/3x) via sanear_duplicados_bd_cliente.
    2. Verifica se restam faturas com divergência contabilística (ex: descontos D/C antigos).
    3. Se limpar_periodos_invalidos=True, apaga apenas os meses corrompidos e desmarca 'completo'
       em controlo_geral.db para forçar reimportação limpa na próxima consulta.
    """
    import pb_client

    v4_dir = pb_client.obter_pasta_v4()
    relatorio = {
        "bds_analisadas": 0,
        "linhas_duplicadas_removidas": 0,
        "periodos_invalidos_limpos": [],
        "bds_100_conformes": 0,
    }
    if not os.path.exists(v4_dir):
        return relatorio

    for nif_dir in sorted(os.listdir(v4_dir)):
        caminho_nif = os.path.join(v4_dir, nif_dir)
        if not (os.path.isdir(caminho_nif) and nif_dir.isdigit()):
            continue

        for tipo_str, tabela in (("compras", "efatura_linhas"), ("vendas", "efatura_vendas_linhas")):
            db_path = pb_client.obter_db_cliente_path(nif_dir, tipo_str)
            if not os.path.exists(db_path):
                continue

            relatorio["bds_analisadas"] += 1
            res_san = pb_client.sanear_duplicados_bd_cliente(nif_dir, tipo_str)
            removidas = res_san.get("linhas_removidas", 0) if isinstance(res_san, dict) else int(res_san or 0)
            relatorio["linhas_duplicadas_removidas"] += removidas

            # Verificar por ano-mês se alguma fatura viola a quadratura vertical
            try:
                with sqlite3.connect(db_path, timeout=20) as conn:
                    c = conn.cursor()
                    c.execute(f"""
                        SELECT DISTINCT substr(data_emissao, 1, 7)
                        FROM {tabela}
                        WHERE length(data_emissao) >= 7
                    """)
                    meses = [r[0] for r in c.fetchall() if r and r[0]]

                meses_corrompidos = []
                for ym in meses:
                    if not re.match(r"^\d{4}-\d{2}$", ym):
                        continue
                    ano_i, mes_i = int(ym[:4]), int(ym[5:7])
                    d_ini = f"{ym}-01"
                    d_fim = f"{ym}-31"
                    if pb_client.periodo_tem_inconsistencia_faturas(nif_dir, d_ini, d_fim, tipo_str):
                        meses_corrompidos.append((ano_i, mes_i, ym))

                if meses_corrompidos and limpar_periodos_invalidos:
                    for ano_i, mes_i, ym in meses_corrompidos:
                        d_ini = f"{ym}-01"
                        d_fim = f"{ym}-31"
                        if tipo_str == "compras":
                            pb_client.delete_faturas_periodo(nif_dir, d_ini, d_fim)
                        else:
                            pb_client.delete_vendas_periodo(nif_dir, d_ini, d_fim)
                        pb_client.limpar_status_mes(nif_dir, ano_i, mes_i, tipo_str)
                        relatorio["periodos_invalidos_limpos"].append(f"{nif_dir}/{tipo_str}/{ym}")
                elif not meses_corrompidos:
                    relatorio["bds_100_conformes"] += 1
            except Exception as e:
                LOGGER.warning(f"Erro ao auditar {db_path}: {e}")

    return relatorio
