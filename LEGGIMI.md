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
  js/dettaglio.js          dettaglio a bassa quota: carica i 4 tasselli intorno al punto osservato e li passa allo shader del terreno
  js/ambiente.js           tavolo, fondale (studio/cielo con sole e nuvole), luce per ora del giorno, ombre, ombra di contatto
  js/post.js               post-produzione (miniatura tilt-shift, bagliore, vignetta, saturazione, contrasto, temperatura, grana)
  js/vista.js              pannello Visualizzazione con i cursori e il salvataggio del predefinito (config.vista)
  admin/                   backend (login con password, schede POI / Itinerari e audio / Foto 360 / Impostazioni)
  mappe/                   satellite.jpg: mosaico Sentinel-2 cloudless 2016 (EOX, CC BY 4.0) generato da tools/satellite.mjs
  icona.svg, anteprima.jpg icona del sito e immagine per le anteprime social (meta Open Graph in index.html)
  modelli/                 GLB dei monumenti (pieve-san-pietro-di-feletto.glb fornito, versione leggera)
data/                      dati del plastico (tutti rigenerabili con `npm run dati`)
  config.json              riquadro geografico, soglie dei livelli, esagerazione, mappe sovrapponibili
  poi.json                 punti di interesse (MODIFICABILE dal backend)
  itinerari.json           itinerari con tracciato e audio (MODIFICABILE dal backend)
  foto360.json             foto 360 (MODIFICABILE dal backend)
  altimetria.png           rilievo 1536×987 in codifica terrarium (quota = R·256 + G + B/256 − 32768)
  colori.jpg               mappa dei colori 4096×2632 rasterizzata dai vettori OpenStreetMap
  maschera.png             R acqua, G vigneti, B boschi (2048 px): guida lo shader che anima acqua e vegetazione
  dettaglio/               16 tasselli ad alta risoluzione (colori-x-y.jpg 4096 px ≈ 2,4 m/px + maschera-x-y.png) per la bassa quota
  luoghi.geojson           geocodifica dei luoghi (solo per la generazione iniziale)
  cache/                   risposte scaricate (Nominatim, OSRM, Overpass, tile): si può cancellare
  backup/                  copia precedente di ogni file salvato dal backend
uploads/                   file caricati (foto dei monumenti, audio, foto 360, GLB)
tools/
  luoghi.mjs               ELENCO CURATO: i tre livelli del brief, coordinate stimate, i 15 monumenti, gli itinerari (tappe)
  build-data.mjs           costruzione dati (vedi §4)
  importa-materiali.mjs    importa GLB e foto dei monumenti dalla cartella dei materiali (le mappe Google solo con --mappe)
  calibra-mappe.mjs        calibrazione automatica delle mappe fornite sui vettori OSM (vedi §4; richiede le mappe Google importate con --mappe)
  satellite.mjs            scarica il mosaico satellitare libero Sentinel-2 (EOX) sul riquadro e aggiorna config.mappe
  crediti.mjs              cerca le foto dei monumenti su Wikimedia Commons e scrive autore e licenza nei media dei POI
Dockerfile, render.yaml    pubblicazione (vedi §7); .env.example: variabili d'ambiente
  geometria.mjs            funzioni condivise: Mercator, Overpass → poligoni/linee, rasterizzatore
AVVIA.bat                  avvio con doppio clic su Windows
```

## 3. Avvio e uso

1. `npm install` (una volta).
2. `npm run dati` (una volta; ~6 minuti con Internet). Ricrea `data/`. **Non** sovrascrive `poi.json`, `itinerari.json`,
   `config.json` già esistenti (per rifarli: `--forza`, perdendo le modifiche del backend). Opzioni: `--solo=terreno|colori|dettaglio|luoghi|itinerari`, `--no-cache`.
3. `npm run materiali -- "<cartella materiali estratti>"` (facoltativo, già fatto): copia il GLB della pieve e le foto dei
   15 monumenti dentro `uploads/poi/<id>/`, aggiungendole ai media dei POI. Con `--mappe` copia anche le tre mappe GRANDE
   (screenshot Google Maps): servono solo alla calibrazione e **non vanno pubblicate** (termini d'uso Google).
   `node tools/satellite.mjs` genera invece il satellite pubblicabile; `node tools/crediti.mjs` aggiorna i crediti delle foto.
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
- **Dettaglio a bassa quota**: `node tools/build-data.mjs --solo=dettaglio` ridisegna gli stessi vettori su una griglia 4×4 di
  tasselli da 4096 px (≈ 2,4 m/px invece di 10) aggiungendo la viabilità minore (`highway` residential/unclassified), in
  `data/dettaglio/`. La webapp (`dettaglio.js`) carica solo i 4 tasselli intorno al punto osservato quando la camera scende sotto
  i 9 km di distanza equivalente (percorso animato, zoom forte) e lo shader del terreno li fonde sulla mappa di base, maschera
  compresa. Si spegne con "Dettaglio a bassa quota" (Ambiente); su telefono parte spento. Richiede Overpass raggiungibile per il
  tema `stradine` (se fallisce, i tasselli vengono comunque generati senza).
- **Luoghi**: i tre livelli del brief sono in `tools/luoghi.mjs` (`LIVELLI`); ogni luogo prende il livello più basso in cui compare.
  Le coordinate stimate sono affinate con Nominatim (91/93 trovate; Molinetto della Croda e Abbazia di Santa Bona restano stimate).
- **Itinerari**: tappe dalla mappa ufficiale Strada del Prosecco (PDF Touring fornito); tracciato su strada con OSRM.
- **Monumenti**: i 15 delle cartelle immagini; modelli procedurali per categoria (castello, abbazia, chiesa, pieve, campanile,
  villa, loggia, mulino, grotta, lago); la Pieve di San Pietro di Feletto usa il GLB Meshy fornito (quello da 0,6 MB; quello da
  11 MB è troppo pesante per il web).
- **Satellite**: mosaico senza nuvole Sentinel-2 del 2016 di EOX IT Services (dati Copernicus), licenza CC BY 4.0 valida anche
  per uso commerciale con l'attribuzione (già nel pannello Mappe e nella riga in basso). Gli anni dal 2017 in poi sono
  CC BY-NC-SA, quindi non utilizzabili su un sito promozionale. Le ortofoto AGEA della Regione Veneto e del Geoportale Nazionale
  sono state scartate: le prime sono "tutti i diritti riservati", il WMS nazionale restituisce immagini vuote.
- **Foto dei monumenti**: 61 su 75 vengono da Wikimedia Commons (licenze CC BY, CC BY-SA 2.0–4.0 e pubblico dominio): autore e
  licenza sono nel campo `credito` di ogni media (scritti da `tools/crediti.mjs`) e compaiono nel visore a tutto schermo con
  il link alla pagina di origine. Le 14 senza credito sono le foto della pieve di San Pietro di Feletto (del committente) e la
  veduta ottocentesca del castello di San Salvatore: da confermare con il committente prima della pubblicazione.

## 4b. Visualizzazione (pannello con i cursori)

Icona dei cursori in alto a destra. Quattro sezioni: **Ambiente** (fondale studio o cielo, tavolo su cui appoggia il plastico,
nuvole, foschia), **Luce** (ora del giorno che muove il sole e scalda i colori, forza del sole e della luce diffusa, esposizione,
ombre), **Effetti** (miniatura tilt-shift, vignettatura, saturazione, contrasto, temperatura, bagliore, contorni, grana) e
**Inquadratura** (assonometria/prospettiva, altezza e rotazione della camera, ingrandimento, focale, esagerazione del rilievo).
"Veduta aerea con questi valori" riporta la camera; "Salva come predefinito" chiede la password del backend e scrive `vista` in
`data/config.json`: da quel momento è la visualizzazione iniziale per tutti. Su telefono effetti e ombre partono spenti.

**Acqua e vegetazione "vive"**: lo shader del terreno (`terreno.js`, `vivacizza`) legge `data/maschera.png` e, dove c'è acqua,
scurisce il colore, abbassa la ruvidità (riflessi del sole) e increspa la normale con un rumore in movimento; sui vigneti aggiunge
screziature e filari, sui boschi chiazze di chiome con un leggero rilievo. Tutto sfuma con la distanza (fwidth) per non sfarfallare
nella veduta aerea. La sezione **Acqua e vegetazione** del pannello regola tutto: "Vivacità generale" (0 = colori piatti) e, per
acqua, vigneti e boschi, la **tinta** (selettore colore) con la sua intensità e le proprietà: acqua → lucentezza, onde, velocità e
ampiezza delle onde; vigneti → screziatura, filari e passo dei filari in metri; boschi → chiazze, rilievo e dimensione delle chiome.
I valori si salvano con "Salva come predefinito" insieme al resto (`vista` in config.json); in `terreno.js` arrivano come uniform
(`impostaVegetazione`).

## 5. Backend

- **Punti di interesse**: nome, categoria, livello 1-2-3, tipo, coordinate (anche cliccando sulla mini-mappa), visibilità,
  descrizione, modello 3D (forma, scala, rotazione, GLB caricabile), media (immagini, video o link YouTube, audio, foto 360),
  copertina. "Visibile" spento = tappa di servizio per gli itinerari senza scritta.
- **Itinerari e audio**: nome, colore, descrizione, tappe (id di POI o `lon,lat`), ricalcolo del tracciato su strada, audio
  geolocalizzati (file, posizione, raggio in metri). Se un file audio manca o non si carica, il percorso mostra "Audio non disponibile" e riparte da solo.
- **Foto 360**: immagine equirettangolare 2:1, tipo aerea/terra, posizione, POI collegato, direzione iniziale, collegamenti
  (frecce) con direzione in gradi (se vuota è calcolata dalle coordinate), anche reciproci.
- **Impostazioni**: soglie dei livelli (distanza camera in metri), esagerazione, fattore dei modelli, titolo, riquadro mappe;
  esporta/ripristina JSON.
- Ogni salvataggio fa una copia in `data/backup/`. Il token di accesso vive in memoria del server: riavviando il server bisogna rifare il login.

## 6. Sicurezza

- Login del backend: confronto a tempo costante, massimo 5 tentativi sbagliati per indirizzo poi 15 minuti di attesa, token
  valido 12 ore (in memoria: il riavvio del server scollega tutti).
- In produzione (`NODE_ENV=production`) il backend si attiva solo se `ADMIN_PASSWORD` ha almeno 8 caratteri e non è quella
  predefinita; altrimenti `/api/login` risponde 503 e la mappa pubblica funziona lo stesso.
- Caricamenti: solo immagini, video, audio e GLB (controllo sull'estensione), massimo 300 MB; intestazioni `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`; nessun cookie, quindi nessun banner.

## 7. Pubblicazione (Render)

**ONLINE dal 9 novembre 2026 su https://mappa-prosecco.onrender.com** (backend: `/admin`, controllo: `/salute`). Servizio Render
`mappa-prosecco` creato dal Blueprint omonimo (piano Starter, Francoforte, disco da 1 GB in `/var/dati`). Ogni push su `main`
rifà il deploy. La password del backend è in Render → servizio → Environment → `ADMIN_PASSWORD` (modificabile lì).

Procedura seguita. Il repository è su GitHub (`ManuelAvanzi/Mappadelprosecco`) e contiene `Dockerfile` e `render.yaml` (Blueprint).
1. Su Render: New → Blueprint → scegliere il repository. Crea il servizio web `mappa-prosecco` (piano Starter, Francoforte) con un
   disco da 1 GB montato in `/var/dati`; `DATA_DIR` e `UPLOADS_DIR` puntano lì, così dati e file caricati sopravvivono ai deploy.
   Al primo avvio il server copia sul disco i dati del repository (plastico, POI, foto): poi comandano quelli sul disco.
2. Nel pannello Environment impostare `ADMIN_PASSWORD` (almeno 8 caratteri). Senza, il backend resta spento.
3. Ogni `git push` su `main` rifà il deploy. I tasselli di dettaglio (`data/dettaglio`, 21 MB) sono nel repository apposta.
4. Controllo: `https://<servizio>.onrender.com/salute` risponde `{"ok":true,"admin":true}`.
Per un dominio proprio: Render → Settings → Custom Domains, poi un record CNAME dal gestore del dominio.

## 8. Limiti noti / prossimi passi

- Il riquadro è modificabile anche a mano dal backend (Impostazioni), ma poi richiede la rigenerazione di terreno e colori.
- A bassa quota la mappa di base (10 m/px) è integrata dai tasselli di dettaglio (2,4 m/px); i tasselli pesano ~1 MB l'uno
  e ne vengono scaricati 4 alla volta.
- Nessuna foto 360 è ancora caricata (il committente non ne ha fornite): si aggiungono dal backend.
- Gli audio geolocalizzati vanno registrati e caricati dal backend.
- Non c'è ancora un deploy online: il server è un Express semplice, pubblicabile su Fly/Render come gli altri progetti
  (serve un volume per `uploads/` e `data/`).
- Licenze: molte foto dei monumenti provengono da Wikimedia Commons (vedi nomi file con "Foto di Paolo Steffan", "Paolo Monti"):
  prima di pubblicare, verificare licenze e aggiungere le attribuzioni.
