@echo off
setlocal
cd /d "%~dp0"
title Panel Cutter Offline - khoi dong
echo [Panel Cutter Offline]

echo.
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

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Lan dau] Dang tai dependencies can thiet. Can Internet va co the mat vai phut...
  call npm ci
  if errorlevel 1 goto install_error
)

echo Dang build giao dien Panel Cutter...
call npm run build
if errorlevel 1 goto build_error

echo Dang mo Panel Cutter Offline...
call npm run app
if errorlevel 1 goto run_error
exit /b 0

:install_error
echo.
echo Cai dependencies that bai. Kiem tra ket noi Internet va chay lai BAT.
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
