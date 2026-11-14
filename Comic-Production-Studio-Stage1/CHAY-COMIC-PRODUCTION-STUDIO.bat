@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Comic Production Studio

echo ============================================================
echo   COMIC PRODUCTION STUDIO - LAUNCHER
echo ============================================================
echo.
if not exist "package.json" (
  echo [LOI] Khong tim thay package.json. Hay giai nen day du goi ZIP vao mot thu muc.
  goto :failed
)
if not exist "package-lock.json" (
  echo [LOI] Khong tim thay package-lock.json. Goi source co the bi thieu file.
  goto :failed
)
where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay Node.js. Hay cai Node.js 22.12.0 LTS hoac moi hon.
  goto :failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay npm. Hay cai lai Node.js 22.12.0 LTS hoac moi hon.
  goto :failed
)
for /f "tokens=1,2 delims=." %%A in ('node -p "process.versions.node" 2^>nul') do (set "NODE_MAJOR=%%A"&set "NODE_MINOR=%%B")
if not defined NODE_MAJOR (
  echo [LOI] Khong doc duoc phien ban Node.js.
  goto :failed
)
if %NODE_MAJOR% LSS 22 goto :node_too_old
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 12 goto :node_too_old
echo [OK] Node.js %NODE_MAJOR%.%NODE_MINOR% da san sang.

if not exist "node_modules\electron\dist\electron.exe" goto :install_deps
if not exist "node_modules\.package-lock.json" goto :install_deps
if not exist "node_modules\.bin\electron.cmd" goto :install_deps
call npm ls --depth=0 >nul 2>nul
if errorlevel 1 goto :install_deps
goto :build_app

:node_too_old
echo [LOI] Can Node.js 22.12.0 LTS hoac moi hon de chay Electron.
goto :failed

:install_deps
echo.
echo Dang cai hoac sua dependency. Lan dau can ket noi Internet...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo [LOI] Cai/sua dependency that bai. Kiem tra Internet, dung luong dia va thu lai.
  goto :failed
)

:build_app
echo.
echo Dang build Comic Production Studio...
call npm run build
if errorlevel 1 goto :repair_deps
goto :verify_electron

:verify_electron
echo.
echo Dang kiem tra Electron runtime (lan dau co the can tai binary)...
call node_modules\.bin\electron.cmd --version
if errorlevel 1 goto :repair_deps
goto :launch_app

:repair_deps
echo.
echo [CANH BAO] Build/runtime loi. Dang cai lai dependency va thu lai mot lan...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo [LOI] Khong the cai lai dependency. Kiem tra ket noi Internet va thu lai.
  goto :failed
)
call npm run build
if errorlevel 1 (
  echo [LOI] Build van that bai sau khi cai lai dependency. Gui phan loi ben tren.
  goto :failed
)
echo Dang thu lai Electron runtime...
call node_modules\.bin\electron.cmd --version
if errorlevel 1 (
  echo [LOI] Khong cai duoc Electron runtime. Kiem tra Internet, antivirus va dung luong dia.
  goto :failed
)

:launch_app
echo.
echo Dang mo ung dung...
call npm start
if errorlevel 1 (
  echo [LOI] Ung dung dong voi ma loi. Xem thong bao loi phia tren.
  goto :failed
)
exit /b 0

:failed
echo.
echo Hay kiem tra Node.js 22.12.0+, Internet cho lan cai/sua dependency,
echo dung luong dia va viec giai nen day du. Sau do mo lai file BAT.
echo.
pause
exit /b 1
