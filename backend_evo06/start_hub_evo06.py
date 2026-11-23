# -*- coding: utf-8 -*-
"""
Central do Cliente & Painel Início (StartHub) — EVO-06 Importador e-Fatura.
Gere avisos/changelog remotos (EVO-11 + PocketBase), estado de leitura local,
avaliação por versão (1★-5★) e reporte funcional/regras ligado ao ecossistema EVO GEX.
"""

import os
import json
import time
import urllib.request
import urllib.parse
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional

import auth_manager
import workspace_context

APP_ID = "EVO_06_EFATURA"
EVO11_CHANGELOG_URL = "http://127.0.0.1:8010/api/public/changelog?app=EVO-06&channel=DEV&limit=20"
POCKETBASE_BASE_URL = "https://licencas.evogex.com/api/collections"

DEFAULT_NOTIFICATIONS: List[Dict[str, Any]] = [
    {
        "id": "evo06-multioffice-v4229",
        "app_code": APP_ID,
        "category": "feature",
        "badge_label": "NOVIDADE · MULTI-ESCRITÓRIO",
        "version_tag": "v4.2",
        "title": "Gestão Multi-Escritório com Pastas Dados_evoGex Isoladas Lado a Lado",
        "summary": "Cada escritório licenciado dispõe agora de uma identificação própria, vagas independentes e pasta local isolada para separar clientes por escritório ou método de trabalho.",
        "highlights": [
            "O Administrador principal acede automaticamente a todos os escritórios licenciados da empresa",
            "Operadores podem aceder a um ou vários escritórios conforme autorização na conta",
            "Alternância instantânea entre escritórios no topo do menu lateral"
        ],
        "published_at": "2026-11-16 12:00",
        "is_pinned": True,
        "action_tab": "config",
        "action_label": "Ver Configurações & Pastas"
    },
    {
        "id": "evo06-sqlite-v4-engine",
        "app_code": APP_ID,
        "category": "stability",
        "badge_label": "MOTOR V4 · SQLITE",
        "version_tag": "Engine V4",
        "title": "Bases Particionadas por NIF em BdsefaturaV4 e Compatibilidade Excel V3",
        "summary": "As faturas de compras, vendas, documentos anulados e recibos verdes são gravadas diretamente em bases SQLite rápidas no seu disco local.",
        "highlights": [
            "Zero retenção de faturas na cloud: 100% Online Zero-Storage em memória efémera",
            "Consulta ultra-rápida multi-ano no Excel via Power Query sobre BdsefaturaV4",
            "Alimentação paralela opcional para mapas legados BdsefaturaV3 e BdsRV"
        ],
        "published_at": "2026-11-14 09:30",
        "is_pinned": True,
        "action_tab": "matriz",
        "action_label": "Abrir Matriz e-Fatura"
    },
    {
        "id": "evo06-recibos-anulados",
        "app_code": APP_ID,
        "category": "tip",
        "badge_label": "DICA OPERACIONAL",
        "version_tag": "Fluxo Fiscal",
        "title": "Conferência Mensal Completa: Matriz + Recibos Verdes + Anulados",
        "summary": "Utilize a Matriz e-Fatura para recolher todas as empresas em lote e valide imediatamente recibos verdes, rendas e documentos anulados pela AT.",
        "highlights": [
            "Selecione várias empresas na Matriz para recolha automática sequencial ou paralela",
            "Acompanhe os recibos em PDF guardados diretamente em Dados_evoGex\\PDFs_Recibos",
            "Use o separador Agendador para preparar recolhas programadas por empresa"
        ],
        "published_at": "2026-11-10 15:00",
        "is_pinned": False,
        "action_tab": "recibos",
        "action_label": "Abrir Recibos Verdes"
    },
]


class StartHubEvo06Service:
    """Serviço de gestão do painel Início para o Importador e-Fatura (EVO-06)."""

    def _state_file(self) -> str:
        if workspace_context.is_cloud_zero_storage():
            return os.path.join(workspace_context.get_ephemeral_root_dir(), "start_hub_evo06.json")
        db_path = auth_manager.obter_caminho_db_app()
        return os.path.join(os.path.dirname(db_path), "start_hub_evo06.json")

    def _load_data(self) -> Dict[str, Any]:
        path = self._state_file()
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
        return {
            "read_ids": [],
            "rating": None,
            "rating_history": [],
            "logic_reports": [],
            "confirmed_contact": None,
            "remote_cache": [],
            "remote_cached_at": 0.0,
        }

    def _save_data(self, data: Dict[str, Any]) -> None:
        path = self._state_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def _fetch_remote_notifications(self) -> List[Dict[str, Any]]:
        collected: List[Dict[str, Any]] = []
        # 1. Changelog público interno do EVO-11 (:8010)
        try:
            req = urllib.request.Request(EVO11_CHANGELOG_URL, headers={"User-Agent": f"GexcelEVO/{APP_ID}"})
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                raw = json.loads(resp.read().decode("utf-8", errors="replace"))
                for rel in (raw.get("releases") or [])[:6]:
                    ver = str(rel.get("versao") or "").strip()
                    rel_id = str(rel.get("id") or f"chg-{ver}")
                    itens = rel.get("items") or rel.get("itens") or rel.get("entries") or []
                    highlights = [str(it.get("titulo") or it.get("title") or "").strip() for it in itens[:4] if str(it.get("titulo") or it.get("title") or "").strip()]
                    if ver or highlights:
                        collected.append({
                            "id": f"evo11-rel-{rel_id}",
                            "app_code": APP_ID,
                            "category": "feature",
                            "badge_label": f"VERSÃO {ver or 'DEV'}",
                            "version_tag": ver or "DEV",
                            "title": str(rel.get("tituloRelease") or rel.get("titulo") or f"Atualização Importador e-Fatura {ver}"),
                            "summary": str(rel.get("resumoExecutivo") or rel.get("resumo") or "Novidades e melhorias publicadas no ecossistema EVO GEX."),
                            "highlights": highlights,
                            "published_at": str(rel.get("dataPublicacao") or rel.get("published_at") or rel.get("created_at") or "")[:16].replace("T", " "),
                            "is_pinned": False,
                        })
        except Exception:
            pass

        # 2. Notificações globais / app no PocketBase
        try:
            flt = urllib.parse.quote(f"(cod_app='{APP_ID}' || cod_app='ALL') && ativo=true")
            url = f"{POCKETBASE_BASE_URL}/notificacoes_appsGexcel/records?filter={flt}&sort=-published_at&perPage=15"
            req = urllib.request.Request(url, headers={"User-Agent": f"GexcelEVO/{APP_ID}"})
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                raw = json.loads(resp.read().decode("utf-8", errors="replace"))
                for rec in (raw.get("items") or []):
                    collected.append({
                        "id": f"pb-{rec.get('id')}",
                        "app_code": str(rec.get("cod_app") or APP_ID),
                        "category": str(rec.get("categoria") or "feature"),
                        "badge_label": str(rec.get("badge_label") or "COMUNICADO").upper(),
                        "version_tag": str(rec.get("versao_tag") or ""),
                        "title": str(rec.get("titulo") or ""),
                        "summary": str(rec.get("resumo") or ""),
                        "highlights": rec.get("destaques") if isinstance(rec.get("destaques"), list) else [],
                        "published_at": str(rec.get("published_at") or rec.get("created") or "")[:16].replace("T", " "),
                        "is_pinned": bool(rec.get("fixado")),
                    })
        except Exception:
            pass

        return collected

    def get_overview(self, refresh_remote: bool = False) -> Dict[str, Any]:
        local_data = self._load_data()
        now_ts = time.time()
        cached = local_data.get("remote_cache") or []
        cached_at = float(local_data.get("remote_cached_at") or 0.0)

        if refresh_remote or (now_ts - cached_at) > 300:
            remote_items = self._fetch_remote_notifications()
            if remote_items:
                cached = remote_items
                local_data["remote_cache"] = cached
            local_data["remote_cached_at"] = now_ts
            self._save_data(local_data)

        read_ids = set(str(x) for x in (local_data.get("read_ids") or []))
        seen_ids = set()
        merged: List[Dict[str, Any]] = []
        for item in [*cached, *DEFAULT_NOTIFICATIONS]:
            nid = str(item.get("id") or "")
            if not nid or nid in seen_ids or not item.get("title"):
                continue
            seen_ids.add(nid)
            merged.append({
                **item,
                "is_read": nid in read_ids,
            })

        unread_count = sum(1 for n in merged if not n.get("is_read"))
        return {
            "status": "ok",
            "notifications": merged,
            "unread_count": unread_count,
            "rating": local_data.get("rating"),
            "rating_history": (local_data.get("rating_history") or [])[:25],
            "logic_reports": (local_data.get("logic_reports") or [])[:25],
            "confirmed_contact": local_data.get("confirmed_contact"),
        }

    def mark_notifications_read(self, notification_ids: List[str], mark_all: bool = False) -> Dict[str, Any]:
        overview = self.get_overview(refresh_remote=False)
        local_data = self._load_data()
        read_set = set(str(x) for x in (local_data.get("read_ids") or []))
        if mark_all:
            for n in overview.get("notifications") or []:
                read_set.add(str(n.get("id") or ""))
        else:
            for nid in (notification_ids or []):
                if nid:
                    read_set.add(str(nid))
        local_data["read_ids"] = sorted(read_set)
        self._save_data(local_data)
        return self.get_overview(refresh_remote=False)

    def submit_rating(
        self,
        stars: int,
        comment: str = "",
        app_version: str = "",
        version_context: str = "ATUAL",
        operator_name: str = "",
        client_nif: str = "",
        client_name: str = "",
        office_id: str = "",
        dificuldades: Optional[List[str]] = None,
        frequencia: str = "",
        pediu_contacto: bool = False,
        contacto_nome: str = "",
        contacto_telefone: str = "",
        contacto_email: str = "",
        horario_preferencial: str = "",
    ) -> Dict[str, Any]:
        stars_clamped = max(1, min(5, int(stars or 5)))
        difs = [str(d).strip() for d in (dificuldades or []) if str(d).strip()]
        ver_str = str(app_version or "").strip().lstrip("vV")
        ver_ctx = str(version_context or "ATUAL").strip().upper()

        clean_phone = str(contacto_telefone or "").strip()
        clean_email = str(contacto_email or "").strip()
        if pediu_contacto:
            clean_phone = auth_manager._validar_telemovel_contacto(clean_phone, obrigatorio=True)
            clean_email = auth_manager._validar_email_obrigatorio(clean_email)
        else:
            if clean_phone:
                try:
                    clean_phone = auth_manager._validar_telemovel_contacto(clean_phone, obrigatorio=False)
                except ValueError:
                    pass

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        contact_name_final = str(contacto_nome or operator_name or "").strip()

        entry = {
            "id": f"rat-{int(time.time() * 1000)}",
            "app_code": APP_ID,
            "app_version": ver_str,
            "version_context": ver_ctx,
            "stars": stars_clamped,
            "comment": str(comment or "").strip(),
            "dificuldades": difs,
            "frequencia": str(frequencia or "").strip(),
            "pediu_contacto": bool(pediu_contacto),
            "contacto_nome": contact_name_final,
            "contacto_telefone": clean_phone,
            "contacto_email": clean_email,
            "horario_preferencial": str(horario_preferencial or "").strip(),
            "operator_name": str(operator_name or "").strip(),
            "submitted_at": now_str,
        }

        local_data = self._load_data()
        local_data["rating"] = entry
        history = local_data.get("rating_history") or []
        history.insert(0, entry)
        local_data["rating_history"] = history[:30]
        if clean_phone or clean_email:
            local_data["confirmed_contact"] = {
                "contacto_nome": contact_name_final,
                "contacto_telefone": clean_phone,
                "contacto_email": clean_email,
                "horario_preferencial": entry["horario_preferencial"],
                "updated_at": now_str,
            }
        self._save_data(local_data)

        assunto_auto = f"[v{ver_str or 'dev'}] Avaliação {stars_clamped}★"
        if difs:
            assunto_auto += f" — {', '.join(difs[:2])}"

        self._post_gateway_payload("feedback_appsGexcel", {
            "cod_app": APP_ID,
            "versao_app": ver_str,
            "nif_cliente": client_nif or "ONLINE_ZERO_STORAGE",
            "nome_cliente": client_name or contact_name_final,
            "empresa_licenca": client_name or office_id or "EVO GEX Online",
            "plano_licenca": office_id or "MULTI-ESCRITORIO",
            "operador": entry["operator_name"] or contact_name_final,
            "tipo": "AVALIACAO",
            "estrelas": stars_clamped,
            "categoria": "QUESTIONARIO_AVALIACAO" if stars_clamped <= 3 else "AVALIACAO_GERAL",
            "dificuldades": ", ".join(difs),
            "frequencia": entry["frequencia"],
            "assunto": assunto_auto,
            "mensagem": entry["comment"],
            "detalhe_observado": f"[Versão: v{ver_str or '—'} | Contexto: {ver_ctx} | Escritório: {office_id or '—'}]",
            "pediu_contacto": bool(pediu_contacto),
            "contacto_nome": contact_name_final,
            "contacto_telefone": clean_phone,
            "contacto_email": clean_email,
            "horario_preferencial": entry["horario_preferencial"],
            "estado_interno": "PEDIDO_AJUDA" if pediu_contacto else "NOVO",
            "data_registo": now_str,
        })

        return {
            "status": "ok",
            "rating": entry,
            "rating_history": local_data["rating_history"][:25],
            "confirmed_contact": local_data.get("confirmed_contact"),
            "message": (
                "Avaliação e pedido de apoio registados! A equipa EVO GEX entrará em contacto consigo."
                if pediu_contacto
                else "Avaliação registada com sucesso! Obrigado pelo seu contributo."
            ),
        }

    def submit_logic_report(
        self,
        category: str,
        subject: str,
        expected_behavior: str,
        actual_behavior: str = "",
        app_version: str = "",
        version_context: str = "ATUAL",
        operator_name: str = "",
        client_nif: str = "",
        client_name: str = "",
        office_id: str = "",
        pediu_contacto: bool = True,
        contacto_nome: str = "",
        contacto_telefone: str = "",
        contacto_email: str = "",
        horario_preferencial: str = "",
    ) -> Dict[str, Any]:
        if not str(subject or "").strip() or not str(expected_behavior or "").strip():
            raise ValueError("Preencha o assunto e a explicação do caso ou melhoria pretendida.")

        clean_phone = str(contacto_telefone or "").strip()
        clean_email = str(contacto_email or "").strip()
        if pediu_contacto:
            clean_phone = auth_manager._validar_telemovel_contacto(clean_phone, obrigatorio=True)
            clean_email = auth_manager._validar_email_obrigatorio(clean_email)

        ver_str = str(app_version or "").strip().lstrip("vV")
        ver_ctx = str(version_context or "ATUAL").strip().upper()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        contact_name_final = str(contacto_nome or operator_name or "").strip()

        report = {
            "id": f"rep-{int(time.time() * 1000)}",
            "app_code": APP_ID,
            "app_version": ver_str,
            "version_context": ver_ctx,
            "category": str(category or "REGRA_EFATURA").strip(),
            "subject": str(subject).strip(),
            "expected_behavior": str(expected_behavior).strip(),
            "actual_behavior": str(actual_behavior or "").strip(),
            "operator_name": str(operator_name or "").strip(),
            "pediu_contacto": bool(pediu_contacto),
            "contacto_nome": contact_name_final,
            "contacto_telefone": clean_phone,
            "contacto_email": clean_email,
            "horario_preferencial": str(horario_preferencial or "").strip(),
            "status": "REGISTADO",
            "created_at": now_str,
        }

        local_data = self._load_data()
        reports = local_data.get("logic_reports") or []
        reports.insert(0, report)
        local_data["logic_reports"] = reports[:50]
        if clean_phone or clean_email:
            local_data["confirmed_contact"] = {
                "contacto_nome": contact_name_final,
                "contacto_telefone": clean_phone,
                "contacto_email": clean_email,
                "horario_preferencial": report["horario_preferencial"],
                "updated_at": now_str,
            }
        self._save_data(local_data)

        self._post_gateway_payload("feedback_appsGexcel", {
            "cod_app": APP_ID,
            "versao_app": ver_str,
            "nif_cliente": client_nif or "ONLINE_ZERO_STORAGE",
            "nome_cliente": client_name or contact_name_final,
            "empresa_licenca": client_name or office_id or "EVO GEX Online",
            "plano_licenca": office_id or "MULTI-ESCRITORIO",
            "operador": report["operator_name"] or contact_name_final,
            "tipo": "REPORTE_REGRA",
            "estrelas": 0,
            "categoria": report["category"],
            "dificuldades": report["category"],
            "assunto": f"[v{ver_str or 'dev'}] {report['subject']}",
            "mensagem": report["expected_behavior"],
            "detalhe_observado": f"{report['actual_behavior']}\n[Versão: v{ver_str or '—'} | Escritório: {office_id or '—'}]".strip(),
            "pediu_contacto": bool(pediu_contacto),
            "contacto_nome": contact_name_final,
            "contacto_telefone": clean_phone,
            "contacto_email": clean_email,
            "horario_preferencial": report["horario_preferencial"],
            "estado_interno": "PEDIDO_AJUDA" if pediu_contacto else "NOVO",
            "data_registo": now_str,
        })

        return {
            "status": "ok",
            "report": report,
            "logic_reports": local_data["logic_reports"][:25],
            "confirmed_contact": local_data.get("confirmed_contact"),
            "message": "Reporte registado com sucesso! A equipa EVO GEX irá analisar o caso.",
        }

    def _post_gateway_payload(self, collection: str, payload: Dict[str, Any]) -> None:
        def _worker() -> None:
            try:
                url = f"{POCKETBASE_BASE_URL}/{collection}/records"
                body = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": f"GexcelEVO/{APP_ID}",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=4.0) as _:
                    pass
            except Exception as e:
                print(f"[AVISO] Sincronização PocketBase StartHub ({collection}): {e}")

        threading.Thread(target=_worker, daemon=True).start()


start_hub_evo06 = StartHubEvo06Service()
