@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installo le dipendenze... && call npm install)
if not exist data\altimetria.png (echo Costruisco i dati del plastico (serve Internet, qualche minuto)... && call npm run dati)
start "" http://localhost:5800
node server.mjs --port 5800
