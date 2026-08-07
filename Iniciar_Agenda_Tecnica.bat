@echo off
echo Iniciando sistema Agenda Tecnica...
cd /d %~dp0
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)
start http://localhost:5173
call npm run dev
pause
