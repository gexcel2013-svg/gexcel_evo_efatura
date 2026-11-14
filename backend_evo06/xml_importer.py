import xml.etree.ElementTree as ET
import base64
import database

def importar_xml_para_db(xml_content):
    """
    Receives XML content (string or bytes), parses it, extracts credentials,
    decodes Base64 passwords, and inserts into the SQLite database.
    """
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        return False, f"Erro ao ler XML: {str(e)}"
    
    count_novos = 0
    count_atualizados = 0
    count_erros = 0
    
    for linha in root.findall('Linha'):
        try:
            nif = linha.findtext('Nif')
            if not nif or nif == "0":
                continue
                
            id_contab = linha.findtext('IDContab') or ""
            nome = linha.findtext('Nome') or ""
            u_at = linha.findtext('U_AT') or ""
            p_at_raw = linha.findtext('P_AT') or ""
            
            # Se P_AT for null ou não tiver o formato esperado
            if not p_at_raw or p_at_raw == "0":
                continue
                
            # O formato da password no XML costuma ser "xx|BASE_64_AQUI|xx"
            password_limpa = p_at_raw
            if "xx|" in p_at_raw and "|xx" in p_at_raw:
                try:
                    b64_str = p_at_raw.split("xx|")[1].split("|xx")[0]
                    password_limpa = base64.b64decode(b64_str).decode('utf-8')
                except Exception:
                    # Se falhar o base64, usa o bruto
                    password_limpa = p_at_raw
            
            # Subutilizador: o Utilizador_AT do XML já traz o subutilizador se existir (ex: NIF/1)
            # O sistema e-fatura aceita apenas "NIF" se não for subutilizador, ou "NIF/ID" se for.
            subutilizador = u_at
            
            sucesso, msg = database.add_entidade(id_contab, nif, subutilizador, password_limpa, nome)
            if "Atualizado" in msg:
                count_atualizados += 1
            elif sucesso:
                count_novos += 1
            else:
                count_erros += 1
        except Exception as e:
            count_erros += 1
            continue

    return True, f"Importação Concluída! {count_novos} novos, {count_atualizados} atualizados, {count_erros} ignorados/erros."
