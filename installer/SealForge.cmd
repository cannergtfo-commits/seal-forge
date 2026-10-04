@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo First launch is installing files...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
echo Seal Forge is starting at http://127.0.0.1:8080
start "" http://127.0.0.1:8080
call npm run dev
