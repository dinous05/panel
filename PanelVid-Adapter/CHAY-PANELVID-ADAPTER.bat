@echo off
setlocal
cd /d "%~dp0"
title PanelVid Adapter - Phase 1

where node >nul 2>&1
if errorlevel 1 goto :missing_node
where npm >nul 2>&1
if errorlevel 1 goto :missing_npm

if not exist "package.json" (
  echo [LOI] Khong tim thay package.json.
  echo Hay dat file BAT nay trong thu muc goc PanelVid-Adapter-Phase1.
  goto :failed
)

set "NEEDS_INSTALL=0"
if not exist "node_modules\electron\dist\electron.exe" set "NEEDS_INSTALL=1"
if not exist "node_modules\.bin\esbuild.cmd" set "NEEDS_INSTALL=1"
if not exist "node_modules\.bin\vite.cmd" set "NEEDS_INSTALL=1"
if not exist "node_modules\.bin\tsc.cmd" set "NEEDS_INSTALL=1"
if not exist "node_modules\.bin\concurrently.cmd" set "NEEDS_INSTALL=1"
if not exist "node_modules\.bin\wait-on.cmd" set "NEEDS_INSTALL=1"
if "%NEEDS_INSTALL%"=="0" (
  call npm ls --depth=0 >nul 2>&1
  if errorlevel 1 set "NEEDS_INSTALL=1"
)

if "%NEEDS_INSTALL%"=="1" (
  echo Dependency chua du hoac bi loi. Dang cai/sua dependency...
  echo Buoc nay can Internet neu package chua co trong cache npm.
  call npm install
  if errorlevel 1 goto :dependency_failed
  call npm ls --depth=0 >nul 2>&1
  if errorlevel 1 goto :dependency_failed
)

echo Dang build va khoi dong PanelVid Adapter...
call npm run dev
if errorlevel 1 goto :run_failed
exit /b 0

:missing_node
echo [LOI] Chua tim thay Node.js trong PATH.
echo Hay cai Node.js LTS, dong cua so nay, mo lai Windows Terminal roi chay BAT.
echo Trang tai chinh thuc: https://nodejs.org/
goto :failed

:missing_npm
echo [LOI] Chua tim thay npm trong PATH.
echo Hay cai lai Node.js LTS voi npm, sau do chay lai BAT.
goto :failed

:dependency_failed
echo.
echo [LOI] Khong cai duoc dependency day du.
echo Kiem tra Internet, quyen ghi thu muc va thong bao npm o phia tren.
goto :failed

:run_failed
echo.
echo [LOI] Build hoac khoi dong that bai.
echo Xem dong loi o phia tren. Thu chay npm run typecheck de hien chi tiet neu can.
goto :failed

:failed
echo.
pause
exit /b 1
