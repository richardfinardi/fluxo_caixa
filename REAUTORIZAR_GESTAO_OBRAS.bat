@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Reautorizar Google e Publicar Gestao de Obras
color 0A

echo ============================================================
echo   GESTAO DE OBRAS - REAUTORIZACAO AUTOMATICA
echo ============================================================
echo.
echo Este processo vai:
echo   1. Reautorizar o Google Apps Script (clasp)
echo   2. Atualizar o secret CLASPRC_JSON no GitHub
echo   3. Disparar o deploy do Gestao de Obras
echo.
echo Voce so precisara confirmar os logins no navegador.
echo.
pause

echo.
echo [1/6] Verificando Node/NPM...
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERRO: Node.js/NPM nao encontrado.
  echo Instale o Node.js e execute este arquivo novamente.
  pause
  exit /b 1
)

echo [2/6] Verificando clasp...
where clasp.cmd >nul 2>&1
if errorlevel 1 (
  echo clasp nao encontrado. Instalando...
  call npm install -g @google/clasp@3.4.1
  if errorlevel 1 (
    echo ERRO ao instalar clasp.
    pause
    exit /b 1
  )
)

echo.
echo [3/6] Reautorizando Google...
echo O navegador sera aberto. Entre na mesma conta Google do Apps Script.
echo.
call clasp.cmd login
if errorlevel 1 (
  echo.
  echo ERRO: a autorizacao Google nao foi concluida.
  pause
  exit /b 1
)

if not exist "%USERPROFILE%\.clasprc.json" (
  echo ERRO: arquivo .clasprc.json nao foi criado.
  pause
  exit /b 1
)

echo.
echo [4/6] Verificando GitHub CLI...
set "GH_EXE="
where gh.exe >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%G in ('where gh.exe') do if not defined GH_EXE set "GH_EXE=%%G"
)

if not defined GH_EXE (
  if exist "C:\Program Files\GitHub CLI\gh.exe" set "GH_EXE=C:\Program Files\GitHub CLI\gh.exe"
)

if not defined GH_EXE (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo.
    echo ERRO: GitHub CLI nao encontrado e o winget nao esta disponivel.
    echo O arquivo de autorizacao foi criado em:
    echo %USERPROFILE%\.clasprc.json
    echo.
    echo Fale com o ChatGPT que o BAT parou na etapa do GitHub CLI.
    pause
    exit /b 1
  )

  echo GitHub CLI nao encontrado. Instalando...
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
  if exist "C:\Program Files\GitHub CLI\gh.exe" set "GH_EXE=C:\Program Files\GitHub CLI\gh.exe"
)

if not defined GH_EXE (
  echo ERRO: GitHub CLI nao localizado apos instalacao.
  pause
  exit /b 1
)

echo.
echo [5/6] Autenticando GitHub e atualizando secret...
"%GH_EXE%" auth status -h github.com >nul 2>&1
if errorlevel 1 (
  echo O navegador sera aberto para autorizar o GitHub.
  "%GH_EXE%" auth login --web -h github.com -p https
  if errorlevel 1 (
    echo ERRO: login no GitHub nao concluido.
    pause
    exit /b 1
  )
)

type "%USERPROFILE%\.clasprc.json" | "%GH_EXE%" secret set CLASPRC_JSON --repo richardfinardi/fluxo_caixa
if errorlevel 1 (
  echo ERRO ao atualizar o secret CLASPRC_JSON.
  pause
  exit /b 1
)

echo.
echo [6/6] Disparando deploy do Gestao de Obras...
"%GH_EXE%" workflow run deploy-gestao-obras.yml --repo richardfinardi/fluxo_caixa
if errorlevel 1 (
  echo ERRO ao disparar workflow.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   REAUTORIZACAO CONCLUIDA
echo ============================================================
echo.
echo O deploy foi disparado no GitHub.
echo Aguarde cerca de 1 minuto e atualize o sistema com Ctrl+F5.
echo.
pause
endlocal
