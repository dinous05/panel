@echo off
setlocal
cd /d "%~dp0"
title PanelVid Voice Clone - khoi dong
echo [PanelVid Voice Clone]

where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Cai Node.js 22 LTS tu https://nodejs.org/ roi chay lai.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay npm. Cai lai Node.js 22 LTS roi chay lai.
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
  echo Khong tim thay Python 3. Cai Python 3.11 tu https://www.python.org/ va tick Add Python to PATH.
  pause
  exit /b 1
)

echo [1/3] Kiem tra Chatterbox...
%PYBIN% -c "import chatterbox" >nul 2>nul
if errorlevel 1 (
  echo Lan dau can tai khoang 3GB cho engine clone. Hay giu ket noi Internet.
  %PYBIN% -m pip install chatterbox-tts
  if errorlevel 1 goto install_error
  %PYBIN% -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
  if errorlevel 1 echo [Canh bao] Khong cai duoc ban CUDA; Chatterbox co the chay CPU neu torch da duoc cai.
  %PYBIN% -m pip install -q setuptools==80.9.0 >nul 2>nul
) else echo Chatterbox da co san.

echo [2/3] Kiem tra VieNeu-TTS (clone tieng Viet)...
%PYBIN% -c "import vieneu" >nul 2>nul
if errorlevel 1 (
  echo Lan dau can tai model va thu vien VieNeu. Hay giu ket noi Internet.
  %PYBIN% -m pip install vieneu
  if errorlevel 1 goto install_error
) else echo VieNeu da co san.

echo [3/3] Chuan bi giao dien clone rieng...
if not exist "node_modules\electron\dist\electron.exe" (
  call npm ci
  if errorlevel 1 goto install_error
)
call npm run build:renderer
if errorlevel 1 goto build_error
set "PANELVID_VOICE_CLONE_ONLY=1"
echo Dang mo PanelVid Voice Clone...
call npm run app
if errorlevel 1 goto run_error
exit /b 0

:install_error
echo.
echo Cai engine hoac dependencies that bai. Kiem tra Internet, dung luong dia va chay lai BAT.
pause
exit /b 1
:build_error
echo.
echo Build giao dien that bai. Hay kiem tra Node.js va thu lai.
pause
exit /b 1
:run_error
echo.
echo Khong the khoi dong Voice Clone. Hay kiem tra loi o tren.
pause
exit /b 1
