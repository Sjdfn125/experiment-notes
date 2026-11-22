@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or later, then run this file again.
  pause
  exit /b 1
)
if not exist ".work\tmp" mkdir ".work\tmp"
set "TEMP=%CD%\.work\tmp"
set "TMP=%TEMP%"
node -e "fetch('http://127.0.0.1:5173/',{signal:AbortSignal.timeout(2000)}).then(async r=>process.exit(r.ok && (await r.text()).includes('record-title')?0:2)).catch(()=>process.exit(1))"
if errorlevel 2 (
  echo Port 5173 is being used by another application.
  pause
  exit /b 1
)
if not errorlevel 1 (
  echo Experiment Notes is running at http://127.0.0.1:5173/
  if /i not "%BROWSER%"=="none" start "" "http://127.0.0.1:5173/"
  exit /b 0
)
if not exist "node_modules\vite\bin\vite.js" goto install
if exist "node_modules\jstat\package.json" goto launch
:install
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto failed
:launch
call npm.cmd run dev -- --open
if not errorlevel 1 exit /b 0
:failed
echo Startup failed. See the message above.
pause
exit /b 1
