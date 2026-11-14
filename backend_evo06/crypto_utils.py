import os
import time
import base64
import hashlib
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.x509 import load_pem_x509_certificate
from cryptography.hazmat.backends import default_backend

def load_public_key(cert_path):
    with open(cert_path, "rb") as f:
        cert_data = f.read()
    cert = load_pem_x509_certificate(cert_data, default_backend())
    return cert.public_key()

def generate_nonce_key():
    # 128 bit AES key = 16 bytes
    return os.urandom(16)

def rsa_encrypt_nonce(nonce_key, public_key):
    # Usually AT uses PKCS1v15 padding
    encrypted = public_key.encrypt(
        nonce_key,
        asym_padding.PKCS1v15()
    )
    return base64.b64encode(encrypted).decode('utf-8')

def aes_ecb_encrypt(key, data):
    padder = padding.PKCS7(128).padder() # PKCS5 is identical to PKCS7 for 128-bit blocks
    padded_data = padder.update(data) + padder.finalize()
    cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
    encryptor = cipher.encryptor()
    return encryptor.update(padded_data) + encryptor.finalize()

def generate_digest(nonce_key, created_str, password_str):
    # digest = Base64( AES_ECB( SHA1( Ks + Created + SenhaPF ) ) )
    hasher = hashlib.sha1()
    hasher.update(nonce_key)
    hasher.update(created_str.encode('utf-8'))
    hasher.update(password_str.encode('utf-8'))
    hash_result = hasher.digest()
    
    encrypted_hash = aes_ecb_encrypt(nonce_key, hash_result)
    return base64.b64encode(encrypted_hash).decode('utf-8')

def encrypt_password(nonce_key, password_str):
    encrypted = aes_ecb_encrypt(nonce_key, password_str.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')

def generate_ws_security_header_data(cert_path, username, password):
    public_key = load_public_key(cert_path)
    nonce_key = generate_nonce_key()
    
    created_dt = datetime.now(timezone.utc)
    # Format according to w3c iso 8601 (e.g. 2015-03-09T20:45:05.424Z)
    created_str = created_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    
    encrypted_nonce = rsa_encrypt_nonce(nonce_key, public_key)
    encrypted_password = encrypt_password(nonce_key, password)
    digest = generate_digest(nonce_key, created_str, password)
    
    return {
        "Username": username,
        "Password": encrypted_password,
        "Digest": digest,
        "Nonce": encrypted_nonce,
        "Created": created_str
    }
