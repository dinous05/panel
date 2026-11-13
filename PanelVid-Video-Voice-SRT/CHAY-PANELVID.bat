@echo off
setlocal
cd /d "%~dp0"
title PanelVid Offline - khoi dong
echo [PanelVid Offline - TTS Edge]

echo Kiem tra Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js.
  echo Hay cai Node.js 22 LTS tro len tu https://nodejs.org/ roi chay lai file nay.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay npm. Hay cai Node.js 22 LTS tro len va chay lai.
  pause
  exit /b 1
)

set "PYBIN="
py -3.11 --version 2>&1 | findstr /c:"Python 3" >nul
if not errorlevel 1 set "PYBIN=py -3.11"
if "%PYBIN%"=="" (
  python --version 2>&1 | findstr /c:"Python 3" >nul
  if not errorlevel 1 set "PYBIN=python"
)
if "%PYBIN%"=="" (
  echo Khong tim thay Python 3. Dang thu cai tu dong bang winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo May khong co winget. Cai tay Python 3.11 tu https://www.python.org/
    echo Nho tick o Add python.exe to PATH roi chay lai BAT.
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
  echo.
  echo Da cai Python xong. TAT cua so nay va chay lai BAT de tiep tuc.
  pause
  exit /b 0
)

echo Kiem tra Edge TTS cho giong AI...
%PYBIN% -m pip install -q edge-tts >nul 2>nul
if errorlevel 1 echo [Canh bao] Khong cai duoc edge-tts - can Internet. Voice Edge co the bao loi khi tao am thanh.
echo Bo qua engine giong clone. Neu can, chay rieng CHAY-VOICE-CLONE.bat.

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Lan dau] Dang tai cac goi can thiet. Can Internet va co the mat vai phut...
  call npm ci
  if errorlevel 1 goto install_error
)

echo Dang chuan bi giao dien...
call npm run build:renderer
if errorlevel 1 goto build_error

echo Dang mo PanelVid Offline...
call npm run app
if errorlevel 1 goto run_error
exit /b 0

:install_error
echo.
echo Cai dependencies that bai. Kiem tra ket noi Internet va thu chay lai BAT.
pause
exit /b 1

:build_error
echo.
echo Build giao dien that bai. Hay kiem tra Node.js va thu lai.
pause
exit /b 1

:run_error
echo.
echo Khong the khoi dong app. Hay kiem tra loi hien o tren.
pause
exit /b 1
