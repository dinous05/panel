@echo off
setlocal
cd /d "%~dp0"
title PanelVid Adapter - Phase 1

where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Chua tim thay Node.js. Hay cai Node.js LTS roi chay lai file nay.
  echo Tai Node.js tu trang chinh thuc: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [LOI] Chua tim thay npm. Hay cai lai Node.js LTS co kem npm.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [LOI] Khong tim thay package.json.
  echo Hay dat file BAT nay trong thu muc PanelVid-Adapter-Phase1.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Dang cai cac dependency lan dau. Buoc nay can Internet.
  call npm install
  if errorlevel 1 goto :failed
)

echo Dang build va khoi dong PanelVid Adapter...
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo [LOI] Khong the build hoac khoi dong ung dung. Xem thong bao loi phia tren.
pause
exit /b 1
