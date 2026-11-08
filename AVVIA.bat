@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installo le dipendenze... && call npm install)
if not exist data\altimetria.png (echo Costruisco i dati del plastico (serve Internet, qualche minuto)... && call npm run dati)
if not exist data\dettaglio (echo Genero i tasselli di dettaglio per la bassa quota (serve Internet, qualche minuto)... && call node tools/build-data.mjs --solo=dettaglio)
start "" http://localhost:5800
node server.mjs --port 5800
