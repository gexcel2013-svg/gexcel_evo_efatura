from datetime import date

import database
import efatura_api

def main():
    print("A iniciar a consulta de produção pelo cliente SOAP...")

    entidades = database.get_entidades()
    if not entidades:
        raise SystemExit("Nenhuma entidade está configurada na base de dados.")

    _, _, nif, nif_sub, pwd = entidades[0]
    today = date.today()
    data_inicio = today.replace(day=1)
    data_fim = today

    try:
        invoices = efatura_api.get_invoices(
            nif, nif_sub, pwd, data_inicio, data_fim, as_buyer=True
        )
        res = efatura_api.invoices_to_rows(nif, invoices, as_buyer=True)
        if isinstance(res, tuple):
            horizontal_rows, rows = res
        else:
            rows = res
        print("\n=== CONSULTA CONCLUÍDA ===")
        print(f"Documentos: {len(invoices)}")
        print(f"Linhas fiscais: {len(rows)}")
    except efatura_api.ATAPIError as exc:
        print(f"\n=== PEDIDO REJEITADO PELA AT ({exc.code}) ===")
        print(exc.description)
    except Exception as e:
        print("\n=== ERRO DE LIGAÇÃO/PROCESSAMENTO ===")
        print(e)

if __name__ == "__main__":
    main()
