@echo off
setlocal enabledelayedexpansion
title Gexcel EVO - Parar Servidores Importador
cd /d "%~dp0"

echo ======================================================================
echo    GEXCEL EVO - IMPORTADOR E-FATURA
echo    Paragem dos Servidores Locais
echo ======================================================================
echo.

REM 1. Parar Frontend Vite - Porta 5173 (Correspondência estrita de porta)
set "FOUND_5173=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":5173 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    set "FOUND_5173=1"
)
if "!FOUND_5173!"=="1" (
    echo [OK] Frontend Vite - Porta 5173 encerrado.
) else (
    echo [-] Frontend Vite - Porta 5173 nao estava em execucao.
)

REM 2. Parar Motor API e-Fatura - Porta 8015 (Correspondência estrita de porta)
set "FOUND_8015=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":8015 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    set "FOUND_8015=1"
)
if "!FOUND_8015!"=="1" (
    echo [OK] Motor Python e-Fatura - Porta 8015 encerrado.
) else (
    echo [-] Motor Python e-Fatura - Porta 8015 nao estava em execucao.
)

REM 3. PocketBase Core BD - Porta 8090 (Base Central Partilhada do Ecossistema)
echo.
echo [AVISO] O PocketBase Core BD (:8090) e partilhado por multiplos modulos do Gexcel EVO CRM.
set "PARAR_PB=N"
set /p PARAR_PB="Deseja encerrar tambem o PocketBase Core BD (:8090)? [s/N]: "
if /i "!PARAR_PB!"=="s" (
    set "FOUND_8090=0"
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":8090 " ^| findstr "LISTENING"') do (
        taskkill /f /pid %%a >nul 2>&1
        set "FOUND_8090=1"
    )
    if "!FOUND_8090!"=="1" (
        echo [OK] PocketBase Core BD - Porta 8090 encerrado.
    ) else (
        echo [-] PocketBase Core BD - Porta 8090 nao estava em execucao.
    )
) else (
    echo [INFO] PocketBase Core BD (:8090) mantido ativo em seguranca para outros modulos.
)

echo.
echo ======================================================================
echo    Todos os servidores do Importador foram terminados com sucesso.
echo ======================================================================
echo.
ping 127.0.0.1 -n 3 >nul
exit
