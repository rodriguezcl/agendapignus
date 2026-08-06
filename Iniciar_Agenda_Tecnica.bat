@echo off
echo Iniciando sistema Agenda Tecnica...
cd /d %~dp0
call npm install
start http://localhost:5173
call npm run dev
pause

