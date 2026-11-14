# -*- coding: utf-8 -*-
"""
Configuração Cython para compilar os módulos essenciais da API em binários C (.pyd).
Protege toda a lógica de negócio, criptografia, cofre de certificados e rotas FastAPI.
"""

from setuptools import setup, Extension
from Cython.Build import cythonize

ext_modules = [
    Extension("efatura_api", ["efatura_api.py"]),
    Extension("crypto_utils", ["crypto_utils.py"]),
    Extension("secure_vault", ["secure_vault.py"]),
    Extension("license_bridge", ["license_bridge.py"]),
    Extension("pb_client", ["pb_client.py"]),
    Extension("legado_bridge", ["legado_bridge.py"]),
    Extension("scheduler", ["scheduler.py"]),
    Extension("cofre_ledger", ["cofre_ledger.py"]),
    Extension("auth_manager", ["auth_manager.py"]),
    Extension("validador_fiscal", ["validador_fiscal.py"]),
    Extension("main", ["main.py"]),
]

setup(
    name="gevo_efatura_api_core",
    ext_modules=cythonize(
        ext_modules,
        compiler_directives={
            "language_level": "3",
            "binding": True,
            "always_allow_keywords": True
        }
    )
)
