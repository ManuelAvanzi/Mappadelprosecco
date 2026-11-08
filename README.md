# Mappa turistica del Prosecco

Plastico 3D interattivo del territorio del Prosecco (colline di Conegliano Valdobbiadene, dal Piave alle Prealpi), con:

- **rilievo reale** delle colline da dati altimetrici aperti, esagerazione verticale regolabile, basamento in stile plastico;
- **mappa dei colori in vettoriale** (vigneti, boschi, centri abitati, acque, strade e ferrovie da OpenStreetMap) e le **tre mappe fornite** (stradale, rilievo, satellite) sovrapponibili con opacità;
- **punti di interesse** rappresentati da punti e scritte su **tre livelli** ("scale importance code"): da lontano solo il livello 1, avvicinandosi il 2 e il 3; i livelli si cambiano nel backend;
- **modelli 3D semplificati** dei 15 monumenti principali, sempre visibili: molto grandi da lontano, si riducono fino alla dimensione reale avvicinandosi (la Pieve di San Pietro di Feletto usa il GLB fornito);
- **itinerari** in vettoriale, separati dal territorio, scelti da un elenco; tracciati sulla rete stradale (OSRM);
- **percorso animato**: camera a ~10 m di quota, arretrata e allineata con il percorso, tasto play, velocità e quota regolabili;
- **audio geolocalizzati** lungo gli itinerari: quando parte un audio l'animazione si ferma e riprende alla fine;
- **foto 360** aeree e a terra a tutto schermo, con frecce per passare da una foto all'altra e tasto "Plastico 3D" per tornare alla veduta aerea;
- **backend** (`/admin`) per inserire e modificare punti di interesse con testi, immagini, video, audio e foto 360, itinerari, audio, livelli e impostazioni.

Menu: **Veduta aerea** (territorio da sud in assonometria, ruotabile e zoomabile con le dita) · **Itinerari** · **Punti di interesse** (per categorie) · **Foto 360**.

## Avvio

```
npm install
npm run dati        # una volta sola: scarica rilievo, vettori OSM, geocodifica, tracciati (serve Internet, ~6 minuti)
npm start           # http://localhost:5800  — backend su /admin (password: ADMIN_PASSWORD nel file .env, predefinita "prosecco")
```

Su Windows basta `AVVIA.bat`. Vedi [LEGGIMI.md](LEGGIMI.md) per la guida completa (struttura, dati, backend, materiali, limiti).

## Fonti dei dati

- Rilievo: Mapzen / AWS Terrain Tiles (terrarium), dati SRTM ed EU-DEM.
- Vettori (vigneti, boschi, abitati, acque, strade): © OpenStreetMap contributors, ODbL, via Overpass API.
- Geocodifica: Nominatim (OpenStreetMap). Tracciati stradali: OSRM (router.project-osrm.org).
- Mappe stradale/rilievo/satellite: materiali forniti dal committente (screenshot Google Maps, uso interno).
- Foto dei monumenti: cartella "IMMAGINI 15 MONUMENTI" fornita (molte da Wikimedia Commons: verificare licenze e attribuzioni prima della pubblicazione).
