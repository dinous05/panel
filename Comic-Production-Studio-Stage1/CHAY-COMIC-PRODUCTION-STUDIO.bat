@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Comic Production Studio

echo ============================================================
echo   COMIC PRODUCTION STUDIO - LAUNCHER
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay Node.js.
  echo Hay cai Node.js 22 LTS hoac moi hon, sau do mo lai file BAT nay.
  goto :failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay npm. Hay cai lai Node.js 22 LTS hoac moi hon.
  goto :failed
)

for /f %%V in ('node -p "parseInt(process.versions.node,10)" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo [LOI] Khong doc duoc phien ban Node.js.
  goto :failed
)
if %NODE_MAJOR% LSS 22 (
  echo [LOI] Phien ban Node.js hien tai la %NODE_MAJOR%. Can Node.js 22 LTS hoac moi hon.
  goto :failed
)
echo [OK] Node.js %NODE_MAJOR% da san sang.

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo Dang cai cac goi phu thuoc. Lan dau can ket noi Internet...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [LOI] Cai dependencies that bai.
    goto :failed
  )
)

echo.
echo Dang build Comic Production Studio...
call npm run build
if errorlevel 1 (
  echo [LOI] Build that bai. Xem thong bao loi phia tren.
  goto :failed
)

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
echo Kiem tra Node.js 22+, ket noi Internet trong lan cai dau tien,
echo roi thu mo lai file nay. Neu van loi, gui lai noi dung loi hien tren.
echo.
pause
exit /b 1
