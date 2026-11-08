# LEGGIMI — Mappa turistica del Prosecco (v0.1, 8 novembre 2026)

Guida per chi riprende il progetto, anche senza assistenza AI.

## 1. Che cos'è

Una webapp (Node + three.js, nessun database) che mostra un plastico 3D del territorio del Prosecco, come richiesto nel brief
"Mappa turistica del Prosecco — Vibe coding". Il brief originale e i materiali ricevuti stanno nella cartella WeTransfer
`Downloads\wetransfer_materiali-per-mappa-prosecco_2026-11-05_1914` (non copiati nel repo: ~1 GB).

## 2. Struttura

```
server.mjs                 server Express: pagine, API JSON, caricamento file, ricalcolo tracciati OSRM
public/                    la webapp
  index.html, css/app.css
  js/app.js                scena, camere (assonometrica e prospettica), menu, pannelli
  js/terreno.js            plastico: altimetria → mesh, basamento, mappe drappeggiate e sovrapposte
  js/etichette.js          punti e scritte a 3 livelli (CSS2D), anti-sovrapposizione
  js/modelli.js            modelli 3D semplificati per categoria + GLB, scala che cresce con la distanza
  js/itinerari.js          tracciati (Line2), percorso animato, audio geolocalizzati
  js/poi.js                elenco per categorie e scheda con media
  js/foto360.js            visore 360 con frecce
  js/geo.js                proiezione Web Mercator locale
  admin/                   backend (login con password, schede POI / Itinerari e audio / Foto 360 / Impostazioni)
  mappe/                   le tre mappe fornite ridotte a 4096 px (generate da tools/importa-materiali.mjs)
  modelli/                 GLB dei monumenti (pieve-san-pietro-di-feletto.glb fornito, versione leggera)
data/                      dati del plastico (tutti rigenerabili con `npm run dati`)
  config.json              riquadro geografico, soglie dei livelli, esagerazione, mappe sovrapponibili
  poi.json                 punti di interesse (MODIFICABILE dal backend)
  itinerari.json           itinerari con tracciato e audio (MODIFICABILE dal backend)
  foto360.json             foto 360 (MODIFICABILE dal backend)
  altimetria.png           rilievo 1536×987 in codifica terrarium (quota = R·256 + G + B/256 − 32768)
  colori.jpg               mappa dei colori 3072×1974 rasterizzata dai vettori OpenStreetMap
  luoghi.geojson           geocodifica dei luoghi (solo per la generazione iniziale)
  cache/                   risposte scaricate (Nominatim, OSRM, Overpass, tile): si può cancellare
  backup/                  copia precedente di ogni file salvato dal backend
uploads/                   file caricati (foto dei monumenti, audio, foto 360, GLB)
tools/
  luoghi.mjs               ELENCO CURATO: i tre livelli del brief, coordinate stimate, i 15 monumenti, gli itinerari (tappe)
  build-data.mjs           costruzione dati (vedi §4)
  importa-materiali.mjs    importa mappe, GLB e foto dei monumenti dalla cartella dei materiali
  calibra-mappe.mjs        calibrazione automatica delle mappe fornite sui vettori OSM (vedi §4)
  geometria.mjs            funzioni condivise: Mercator, Overpass → poligoni/linee, rasterizzatore
AVVIA.bat                  avvio con doppio clic su Windows
```

## 3. Avvio e uso

1. `npm install` (una volta).
2. `npm run dati` (una volta; ~6 minuti con Internet). Ricrea `data/`. **Non** sovrascrive `poi.json`, `itinerari.json`,
   `config.json` già esistenti (per rifarli: `--forza`, perdendo le modifiche del backend). Opzioni: `--solo=terreno|colori|luoghi|itinerari`, `--no-cache`.
3. `npm run materiali -- "<cartella materiali estratti>"` (facoltativo, già fatto): copia le tre mappe GRANDE ridotte, il GLB
   della pieve e le foto dei 15 monumenti dentro `uploads/poi/<id>/`, aggiungendole ai media dei POI.
4. `npm start` → http://localhost:5800. Backend su http://localhost:5800/admin (password `prosecco`, cambiabile con
   `ADMIN_PASSWORD=...` in un file `.env` nella cartella del progetto).

Nell'anteprima del Code tab il server si chiama `mappa-prosecco` (porta 5800). Nel pannello di anteprima il
`requestAnimationFrame` è lento: per collaudare il percorso animato dalla console usare `__mappa.percorso.aggiorna(0.1)` in un ciclo.

## 4. Da dove vengono i dati

- **Riquadro del plastico**: è quello delle tre mappe fornite (screenshot Google Maps 12292×7898 px in Web Mercator, stesso
  inquadramento). Prima stima in `tools/build-data.mjs` (`ANCORE`: pixel delle etichette di tre città ↔ nodi OSM), poi
  **calibrazione automatica** con `node tools/calibra-mappe.mjs --tema=strade --applica`: registra la maschera delle strade grigie
  della mappa stradale sui vettori stradali OpenStreetMap (scala conforme + spostamento) e scrive `bbox` e `calibrazione` in
  config.json; i ritagli `data/cache/calibrazione-controllo-*.jpg` mostrano i vettori OSM in rosso sulla mappa per il controllo
  visivo. Precisione ottenuta ≈ 10–20 m (le strade coincidono); i laghi di Revine appaiono leggermente diversi perché Google e
  OSM hanno contorni diversi, non per errore di calibrazione. Dopo una nuova calibrazione rigenerare terreno e colori
  (`--solo=terreno`, `--solo=colori`). Il tema "acqua" (fiumi) è meno affidabile: i letti del Piave differiscono tra le fonti.
- **Rilievo**: tile terrarium zoom 12 (≈27 m/px) ricampionati sul riquadro. Quote 13–1550 m. Esagerazione predefinita 1,7.
- **Colori**: vettori OpenStreetMap via Overpass (vigneti `landuse=vineyard`, boschi, abitati, industriali, acque, fiumi,
  strade principali, ferrovie) rasterizzati con tavolozza "mappa di carta" (`COLORI` in build-data.mjs). La base cambia tinta per
  fascia altimetrica. Questa è la "mappa dei colori semplificati in vettoriale" chiesta dal brief; la mappa satellitare fornita è
  comunque sovrapponibile.
- **Luoghi**: i tre livelli del brief sono in `tools/luoghi.mjs` (`LIVELLI`); ogni luogo prende il livello più basso in cui compare.
  Le coordinate stimate sono affinate con Nominatim (91/93 trovate; Molinetto della Croda e Abbazia di Santa Bona restano stimate).
- **Itinerari**: tappe dalla mappa ufficiale Strada del Prosecco (PDF Touring fornito); tracciato su strada con OSRM.
- **Monumenti**: i 15 delle cartelle immagini; modelli procedurali per categoria (castello, abbazia, chiesa, pieve, campanile,
  villa, loggia, mulino, grotta, lago); la Pieve di San Pietro di Feletto usa il GLB Meshy fornito (quello da 0,6 MB; quello da
  11 MB è troppo pesante per il web).

## 5. Backend

- **Punti di interesse**: nome, categoria, livello 1-2-3, tipo, coordinate (anche cliccando sulla mini-mappa), visibilità,
  descrizione, modello 3D (forma, scala, rotazione, GLB caricabile), media (immagini, video o link YouTube, audio, foto 360),
  copertina. "Visibile" spento = tappa di servizio per gli itinerari senza scritta.
- **Itinerari e audio**: nome, colore, descrizione, tappe (id di POI o `lon,lat`), ricalcolo del tracciato su strada, audio
  geolocalizzati (file, posizione, raggio in metri).
- **Foto 360**: immagine equirettangolare 2:1, tipo aerea/terra, posizione, POI collegato, direzione iniziale, collegamenti
  (frecce) con direzione in gradi (se vuota è calcolata dalle coordinate), anche reciproci.
- **Impostazioni**: soglie dei livelli (distanza camera in metri), esagerazione, fattore dei modelli, titolo, riquadro mappe;
  esporta/ripristina JSON.
- Ogni salvataggio fa una copia in `data/backup/`. Il token di accesso vive in memoria del server: riavviando il server bisogna rifare il login.

## 6. Limiti noti / prossimi passi

- Il riquadro è modificabile anche a mano dal backend (Impostazioni), ma poi richiede la rigenerazione di terreno e colori.
- La texture dei colori (13 m/px) è sfocata a bassa quota nel percorso animato: si può aumentare `W` in `colori()` (es. 6144)
  o aggiungere tile raster per lo zoom alto.
- Nessuna foto 360 è ancora caricata (il committente non ne ha fornite): si aggiungono dal backend.
- Gli audio geolocalizzati vanno registrati e caricati dal backend.
- Non c'è ancora un deploy online: il server è un Express semplice, pubblicabile su Fly/Render come gli altri progetti
  (serve un volume per `uploads/` e `data/`).
- Licenze: molte foto dei monumenti provengono da Wikimedia Commons (vedi nomi file con "Foto di Paolo Steffan", "Paolo Monti"):
  prima di pubblicare, verificare licenze e aggiungere le attribuzioni.
