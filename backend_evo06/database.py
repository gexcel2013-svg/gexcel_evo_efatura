import sqlite3
import os
import secret_store

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'dados_efatura.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS entidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_contabilidade TEXT NOT NULL,
            nif TEXT NOT NULL UNIQUE,
            subutilizador TEXT NOT NULL,
            password TEXT NOT NULL,
            nome TEXT DEFAULT ""
        )
    ''')
    # Migrate passwords if needed
    c.execute('SELECT id, password FROM entidades')
    for entity_id, password in c.fetchall():
        if not secret_store.is_protected(password):
            c.execute(
                'UPDATE entidades SET password = ? WHERE id = ?',
                (secret_store.protect_secret(password), entity_id),
            )
    conn.commit()
    conn.close()

def add_entidade(id_cont, nif, subutilizador, password, nome=""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        protected_password = secret_store.protect_secret(password)
        c.execute('INSERT INTO entidades (id_contabilidade, nif, subutilizador, password, nome) VALUES (?, ?, ?, ?, ?)',
                  (id_cont, nif, subutilizador, protected_password, nome))
        conn.commit()
        return True, "Adicionado com sucesso"
    except sqlite3.IntegrityError:
        # Se falhar porque o NIF já existe, podemos fazer um UPDATE em vez de falhar.
        c.execute('UPDATE entidades SET id_contabilidade=?, subutilizador=?, password=?, nome=? WHERE nif=?', 
                  (id_cont, subutilizador, protected_password, nome, nif))
        conn.commit()
        return True, "Atualizado com sucesso (já existia)"
    finally:
        conn.close()

def get_entidades():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, id_contabilidade, nif, subutilizador, password, nome FROM entidades')
    rows = [
        (entity_id, id_cont, nif, subuser, secret_store.unprotect_secret(password), nome)
        for entity_id, id_cont, nif, subuser, password, nome in c.fetchall()
    ]
    conn.close()
    return rows

def delete_entidade(nif):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM entidades WHERE nif = ?', (nif,))
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
