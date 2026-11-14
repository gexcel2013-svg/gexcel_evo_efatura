import streamlit as st
import pandas as pd
import database
import efatura_api
from datetime import date
import zeep.exceptions

# Inicializar Base de Dados
database.init_db()

st.set_page_config(page_title="Importador e-Fatura MVP", layout="wide")

st.title("Importador e-Fatura API (MVP)")

DEFAULT_VISIBLE_COLUMNS = [
    "NIF Cliente",
    "Fatura",
    "Data",
    "Tipo Documento",
    "Contraparte NIF",
    "Contraparte",
    "Base Incidência",
    "Taxa IVA",
    "Valor IVA",
    "Total Documento",
]

# Tabs principais
tab_crud, tab_import = st.tabs(["Gestão de Entidades (CRUD)", "Importação e Visualização"])

# --- TAB 1: CRUD ---
with tab_crud:
    st.header("Entidades Registadas")
    
    col1, col2 = st.columns([1, 2])
    
    with col1:
        st.subheader("Adicionar Nova")
        with st.form("form_add_entidade"):
            id_cont = st.text_input("ID Contabilidade")
            nome = st.text_input("Nome da Entidade (Opcional)")
            nif = st.text_input("NIF").strip()
            sub = st.text_input("Utilizador AT (Ex: 123456789 ou 123456789/1)").strip()
            pwd = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Registar Entidade")
            
            if submitted:
                if nif and sub and pwd:
                    success, msg = database.add_entidade(id_cont, nif, sub, pwd, nome)
                    if success:
                        st.success(msg)
                    else:
                        st.error(msg)
                else:
                    st.warning("Preenche os campos obrigatórios.")
                    
        st.subheader("Importar em Lote (XML)")
        import xml_importer
        xml_file = st.file_uploader("Ficheiro tCredenciais.xml", type=["xml"])
        if st.button("Processar Ficheiro"):
            if xml_file is not None:
                xml_content = xml_file.getvalue()
                sucesso, msg = xml_importer.importar_xml_para_db(xml_content)
                if sucesso:
                    st.success(msg)
                    # Dá um tempo para ver a mensagem e atualiza
                    import time
                    time.sleep(1.5)
                    st.rerun()
                else:
                    st.error(msg)
            else:
                st.warning("Selecione um ficheiro XML primeiro.")
                    
    with col2:
        st.subheader("Lista de Entidades")
        entidades = database.get_entidades()
        if entidades:
            df_entidades = pd.DataFrame(entidades, columns=["ID_DB", "ID_Contabilidade", "NIF", "Subutilizador", "Password", "Nome"])
            
            # Esconder a password na UI por segurança
            df_display = df_entidades.drop(columns=["Password", "ID_DB"])
            st.dataframe(df_display, width="stretch")
            
            # Apagar Entidade
            with st.expander("Apagar Entidade"):
                nif_to_delete = st.selectbox("Escolhe o NIF a apagar:", df_entidades["NIF"])
                if st.button("Eliminar"):
                    database.delete_entidade(nif_to_delete)
                    st.success(f"Entidade {nif_to_delete} eliminada!")
                    st.rerun()
        else:
            st.info("Nenhuma entidade registada.")


# --- TAB 2: IMPORTAÇÃO E VISUALIZAÇÃO ---
with tab_import:
    st.header("Painel de Extração e-Fatura")
    
    entidades = database.get_entidades()
    if not entidades:
        st.warning("Vai ao separador de Gestão para adicionar clientes primeiro.")
    else:
        df_entidades = pd.DataFrame(entidades, columns=["ID_DB", "ID_Contabilidade", "NIF", "Subutilizador", "Password", "Nome"])
        lista_nifs = df_entidades["NIF"].tolist()
        
        # Criar dicionário para mostrar NIF + Nome no dropdown
        nif_display = {}
        for _, row in df_entidades.iterrows():
            nome = str(row["Nome"]).strip()
            if nome and nome != "None":
                nif_display[row["NIF"]] = f"{row['NIF']} - {nome}"
            else:
                nif_display[row["NIF"]] = row["NIF"]
        
        today = date.today()
        first_day_current_month = today.replace(day=1)

        col_filtro1, col_filtro2, col_filtro3, col_filtro4 = st.columns(4)
        
        with col_filtro1:
            clientes_selecionados = st.multiselect(
                "Selecionar Clientes:", 
                options=lista_nifs, 
                default=lista_nifs[0:1] if lista_nifs else None,
                format_func=lambda nif: nif_display.get(nif, nif)
            )
        with col_filtro2:
            tipo_importacao = st.selectbox(
                "Tipo de documentos",
                options=["Compras", "Vendas"],
            )
        with col_filtro3:
            data_inicio = st.date_input("Data Início", value=first_day_current_month)
        with col_filtro4:
            data_fim = st.date_input("Data Fim", value=today)
            
        if st.button("Extrair dados da AT", type="primary"):
            if not clientes_selecionados:
                st.error("Seleciona pelo menos um cliente.")
            elif data_inicio > data_fim:
                st.error("A data inicial não pode ser posterior à data final.")
            else:
                with st.spinner("A comunicar com os WebServices de PRODUÇÃO da AT..."):
                    real_data_extracted = []
                    failed_clients = 0
                    as_buyer = tipo_importacao == "Compras"
                    
                    for nif in clientes_selecionados:
                        row = df_entidades[df_entidades["NIF"] == nif].iloc[0]
                        nif_sub = row["Subutilizador"]
                        pwd = row["Password"]
                        nome_empresa = row["Nome"]
                        display_name = f"{nif} - {nome_empresa}" if nome_empresa and str(nome_empresa).strip() != "None" else nif
                        
                        progress_container = st.empty()
                        progress_container.info(f"A iniciar comunicação com a AT para a empresa: {display_name}...")
                        
                        def update_ui(msg):
                            progress_container.info(msg)
                        
                        try:
                            invoices = efatura_api.get_invoices(
                                nif,
                                nif_sub,
                                pwd,
                                data_inicio,
                                data_fim,
                                as_buyer=as_buyer,
                                progress_callback=update_ui
                            )
                            res = efatura_api.invoices_to_rows(
                                nif, invoices, as_buyer=as_buyer, entity_name=nome_empresa
                            )
                            if isinstance(res, tuple):
                                horizontal_rows, vertical_rows = res
                                rows = vertical_rows
                            else:
                                rows = res
                            real_data_extracted.extend(rows)

                            if invoices:
                                progress_container.success(
                                    f"✅ AT consultada para {display_name}: "
                                    f"{len(invoices)} documento(s)."
                                )
                            else:
                                progress_container.warning(
                                    f"⚠️ Sem documentos para a empresa {display_name} neste período."
                                )
                            
                        except efatura_api.ATAPIError as e:
                            failed_clients += 1
                            progress_container.error(
                                f"❌ A AT rejeitou o pedido para {display_name} "
                                f"(código {e.code}): {e.description}"
                            )
                        except zeep.exceptions.Fault as e:
                            failed_clients += 1
                            progress_container.error(f"❌ Erro Oficial da AT para {display_name}: {e.message}")
                        except Exception as e:
                            failed_clients += 1
                            progress_container.error(f"❌ Falha de ligação para {display_name}: {str(e)}")

                    successful_clients = len(clientes_selecionados) - failed_clients
                    if successful_clients:
                        st.success(
                            f"Processo concluído para {successful_clients} cliente(s)."
                        )
                    
                    if real_data_extracted:
                        df_resultados = pd.DataFrame(real_data_extracted)
                        st.subheader(f"Resultados e-Fatura — {tipo_importacao}")
                        default_columns = [
                            column
                            for column in DEFAULT_VISIBLE_COLUMNS
                            if column in df_resultados.columns
                        ]
                        visible_columns = st.multiselect(
                            "Campos a visualizar",
                            options=df_resultados.columns.tolist(),
                            default=default_columns,
                            help=(
                                "Todos os campos recebidos da AT estão disponíveis. "
                                "Escolha aqui quais pretende mostrar na tabela."
                            ),
                        )
                        if visible_columns:
                            st.dataframe(
                                df_resultados[visible_columns], width="stretch"
                            )
                        else:
                            st.info(
                                "Selecione pelo menos um campo para visualizar a tabela."
                            )
                        
                        st.subheader("Resumo de Totais Reais")
                        try:
                            col_base = "Base Incidência" if "Base Incidência" in df_resultados.columns else None
                            col_iva = "Valor IVA" if "Valor IVA" in df_resultados.columns else ("Valor Imposto" if "Valor Imposto" in df_resultados.columns else None)
                            
                            agg_dict = {}
                            if col_base: agg_dict[col_base] = "sum"
                            if col_iva: agg_dict[col_iva] = "sum"
                            
                            if agg_dict and "NIF Cliente" in df_resultados.columns:
                                bases_impostos = (
                                    df_resultados.groupby("NIF Cliente", as_index=False)
                                    .agg(agg_dict)
                                )
                                subset_cols = [c for c in ["NIF Cliente", "Contraparte NIF", "Fatura", "Data"] if c in df_resultados.columns]
                                if "Total Documento" in df_resultados.columns:
                                    totais_documentos = (
                                        df_resultados.drop_duplicates(subset=subset_cols)
                                        .groupby("NIF Cliente", as_index=False)
                                        .agg({"Total Documento": "sum"})
                                    )
                                    resumo = bases_impostos.merge(
                                        totais_documentos, on="NIF Cliente", how="left"
                                    )
                                else:
                                    resumo = bases_impostos
                                st.dataframe(resumo, width="stretch")
                        except Exception as e:
                            st.warning(f"Não foi possível calcular o resumo automático: {e}")
                        
                        st.subheader("Exportação Avançada")
                        col_exp1, col_exp2 = st.columns(2)
                        with col_exp1:
                            # Botão para exportar TODOS os dados (mesmo os ocultos na tabela) em JSON
                            json_data = df_resultados.to_json(orient="records", force_ascii=False, indent=4, date_format="iso")
                            st.download_button(
                                label="📥 Descarregar JSON Completo (Todos os Campos)",
                                data=json_data,
                                file_name=f"extracao_at_{tipo_importacao.lower()}_{data_inicio}_a_{data_fim}.json",
                                mime="application/json",
                                type="secondary",
                                help="Útil para confirmar os campos exatos (mesmo os mais obscuros) que a AT devolveu."
                            )
                        with col_exp2:
                            # Botão para exportar em CSV para o Excel
                            csv_data = df_resultados.to_csv(index=False, sep=";").encode("utf-8-sig")
                            st.download_button(
                                label="📥 Descarregar CSV (Excel)",
                                data=csv_data,
                                file_name=f"extracao_at_{tipo_importacao.lower()}_{data_inicio}_a_{data_fim}.csv",
                                mime="text/csv",
                                type="primary",
                                help="Descarrega uma folha de cálculo CSV diretamente compatível com o Excel (formato europeu)."
                            )
                    elif not failed_clients:
                        st.info("Não existem dados reais para exibir.")
