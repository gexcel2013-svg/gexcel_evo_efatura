# -*- coding: utf-8 -*-
"""
Cofre Criptográfico de Segurança Máxima (Gexcel EVO).
Armazena o Certificado de Produtor de Software da AT em AES-256-GCM.
A chave é reconstruída em memória e validada contra o Gexcel Auth.
O certificado só existe em disco de forma efêmera (durante a criação da sessão TLS)
e é imediatamente triturado (wipe com zeros) após o uso.
"""

import os
import sys
import base64
import tempfile
from contextlib import contextmanager
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import license_bridge

# Payload Cifrado com AES-256-GCM
_NONCE = base64.b64decode("+rCWfo01uHCfrc5j")
_CIPHERTEXT = base64.b64decode("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")
_MASK = [88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88]
_MASKED_KEY = [31, 29, 0, 27, 29, 20, 7, 29, 14, 23, 7, 106, 104, 106, 110, 7, 25, 12, 7, 14, 25, 13, 20, 12, 7, 19, 29, 1, 7, 107, 106, 26]

def _reconstruct_vault_key() -> bytes:
    """Reconstrói a chave em memória a partir de arrays fragmentados."""
    return bytes([b ^ m for b, m in zip(_MASKED_KEY, _MASK)])

def get_decrypted_pem_bytes() -> bytes:
    """
    Desencripta o certificado PEM em memória após validação estrita da licença.
    """
    lic = license_bridge.verificar_licenca()
    if not lic.get("autorizado", False):
        motivo = lic.get("motivo", "SEM_LICENCA")
        raise PermissionError(f"Acesso ao Cofre Recusado: Licença Gexcel Auth não autorizada (Motivo: {motivo})")

    key = _reconstruct_vault_key()
    aes = AESGCM(key)
    try:
        pem_bytes = aes.decrypt(_NONCE, _CIPHERTEXT, None)
        return pem_bytes
    except Exception as e:
        raise RuntimeError(f"Falha na desencriptação do cofre de certificados: {e}")

@contextmanager
def ephemeral_producer_cert():
    """
    Gestor de contexto que disponibiliza o certificado PEM para a sessão TLS
    apenas pelo tempo estritamente necessário.
    No fecho do contexto (finally), os dados no disco são sobrescritos com zeros e eliminados.
    """
    pem_bytes = get_decrypted_pem_bytes()
    
    # Pasta temporária privada e segura
    base_temp = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "GexcelApps", ".vault")
    os.makedirs(base_temp, exist_ok=True)
    
    fd, temp_path = tempfile.mkstemp(suffix=".pem", dir=base_temp, prefix="gx_at_")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(pem_bytes)
            f.flush()
        
        yield temp_path
    finally:
        try:
            # Triturar dados no disco (Wipe com zeros antes de apagar)
            if os.path.exists(temp_path):
                file_size = os.path.getsize(temp_path)
                with open(temp_path, "wb") as f_wipe:
                    f_wipe.write(b"\x00" * file_size)
                    f_wipe.flush()
                os.remove(temp_path)
        except Exception:
            pass
