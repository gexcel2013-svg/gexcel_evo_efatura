"""Proteção local de credenciais com o DPAPI do Windows."""

import base64
import ctypes
import os
from ctypes import wintypes


PREFIX = "dpapi:"
CRYPTPROTECT_UI_FORBIDDEN = 0x01


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _input_blob(data):
    buffer = ctypes.create_string_buffer(data)
    blob = DATA_BLOB(
        len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))
    )
    return blob, buffer


def _require_windows():
    if os.name != "nt":
        raise OSError("A proteção DPAPI só está disponível no Windows.")


def _windows_apis():
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    blob_pointer = ctypes.POINTER(DATA_BLOB)

    crypt32.CryptProtectData.argtypes = [
        blob_pointer,
        wintypes.LPCWSTR,
        blob_pointer,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        blob_pointer,
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [
        blob_pointer,
        ctypes.POINTER(wintypes.LPWSTR),
        blob_pointer,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        blob_pointer,
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    return crypt32, kernel32


def is_protected(value):
    return isinstance(value, str) and value.startswith(PREFIX)


def protect_secret(value):
    _require_windows()
    if is_protected(value):
        return value

    source, source_buffer = _input_blob(value.encode("utf-8"))
    output = DATA_BLOB()
    crypt32, kernel32 = _windows_apis()

    if not crypt32.CryptProtectData(
        ctypes.byref(source),
        "Gexcel e-Fatura",
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output),
    ):
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        encrypted = ctypes.string_at(output.pbData, output.cbData)
        return PREFIX + base64.b64encode(encrypted).decode("ascii")
    finally:
        kernel32.LocalFree(output.pbData)
        del source_buffer


def unprotect_secret(value):
    _require_windows()
    if not is_protected(value):
        return value

    encrypted = base64.b64decode(value[len(PREFIX):])
    source, source_buffer = _input_blob(encrypted)
    output = DATA_BLOB()
    crypt32, kernel32 = _windows_apis()

    if not crypt32.CryptUnprotectData(
        ctypes.byref(source),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output),
    ):
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
    finally:
        kernel32.LocalFree(output.pbData)
        del source_buffer
