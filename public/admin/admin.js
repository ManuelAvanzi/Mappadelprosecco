// Backend: gestione di punti di interesse (con media), itinerari (tappe, tracciato OSRM, audio geolocalizzati), foto 360 e impostazioni.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (u) => (u && !/^https?:|^\//.test(u) ? '/' + u : u);
let token = sessionStorage.getItem('token') || '';
const stato = { cfg: {}, poi: [], itinerari: [], foto360: [], poiSel: null, itSel: null, fSel: null };

function toast(t, err = false) { const e = $('#toast'); e.textContent = t; e.style.background = err ? '#a33' : ''; e.classList.add('vis'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('vis'), 2600); }
async function api(metodo, percorso, corpo) {
  const r = await fetch('/api/' + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { mostraLogin(); throw new Error(j.errore || 'Accesso negato'); }
  if (!r.ok) throw new Error(j.errore || 'Errore ' + r.status);
  return j;
}
async function carica(file, cartella) {
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/upload?cartella=' + encodeURIComponent(cartella), { method: 'POST', headers: { 'x-admin-token': token }, body: fd });
  const j = await r.json(); if (!r.ok) throw new Error(j.errore || 'Caricamento fallito'); return j;
}

// ── Login e schede ──
function mostraLogin() { $('#login').classList.remove('nascosto'); $('#schede').classList.add('nascosto'); $('#esci').classList.add('nascosto'); $$('main > section:not(#login)').forEach((s) => s.classList.add('nascosto')); }
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#login-errore').textContent = '';
  try { const j = await api('POST', 'login', { password: $('#password').value }); token = j.token; sessionStorage.setItem('token', token); await avvia(); }
  catch (err) { $('#login-errore').textContent = err.message; }
});
$('#esci').addEventListener('click', () => { token = ''; sessionStorage.removeItem('token'); mostraLogin(); });
$('#schede').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mostraScheda(b.dataset.s); });
function mostraScheda(s) {
  $$('#schede button').forEach((b) => b.classList.toggle('attivo', b.dataset.s === s));
  $$('main > section').forEach((x) => x.classList.toggle('nascosto', x.id !== 's-' + s));
  location.hash = s;
}
async function avvia() {
  try { await api('GET', 'config'); } catch { return; }
  $('#login').classList.add('nascosto'); $('#schede').classList.remove('nascosto'); $('#esci').classList.remove('nascosto');
  await ricarica();
  mostraScheda(location.hash.slice(1) || 'poi');
}
async function ricarica() {
  [stato.cfg, stato.poi, stato.itinerari, stato.foto360] = await Promise.all(['config', 'poi', 'itinerari', 'foto360'].map((k) => api('GET', k)));
  renderPoiLista(); renderItLista(); renderFLista(); renderCfg();
}

// ── Mini-mappa per scegliere le coordinate (sulla mappa stradale fornita, Web Mercator) ──
const R = 6378137;
const mY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function miniMappa(lat, lon, onPick) {
  const bb = stato.cfg.bbox; if (!bb) return '';
  const u = (lon - bb.w) / (bb.e - bb.w), v = (mY(bb.n) - mY(lat)) / (mY(bb.n) - mY(bb.s));
  const id = 'mm' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect(); const uu = (e.clientX - r.left) / r.width, vv = (e.clientY - r.top) / r.height;
      const lon2 = bb.w + uu * (bb.e - bb.w); const lat2 = (2 * Math.atan(Math.exp(mY(bb.n) - vv * (mY(bb.n) - mY(bb.s)))) - Math.PI / 2) * 180 / Math.PI;
      onPick(+lat2.toFixed(5), +lon2.toFixed(5));
      const sp = el.querySelector('.spillo'); sp.style.left = uu * 100 + '%'; sp.style.top = vv * 100 + '%';
    });
  });
  const sfondo = (stato.cfg.mappe || []).find((m) => m.id === 'stradale')?.file || 'data/colori.jpg';
  return `<div class="mini-mappa" id="${id}" style="background-image:url('${esc(url(sfondo))}')" title="Clicca per posizionare"><span class="spillo" style="left:${u * 100}%;top:${v * 100}%"></span></div>`;
}

// ── Punti di interesse ──
const CATEGORIE = ['Città e paesi', 'Castelli', 'Abbazie e chiese', 'Palazzi e ville', 'Natura', 'Luoghi della tradizione', 'Cantine e sapori', 'Altro'];
const TIPI_MODELLO = ['castello', 'abbazia', 'chiesa', 'pieve', 'campanile', 'villa', 'loggia', 'mulino', 'grotta', 'lago'];
function renderPoiLista() {
  const q = ($('#poi-cerca').value || '').toLowerCase(), f = $('#poi-filtro-liv').value;
  const lista = stato.poi.filter((p) => (!q || p.nome.toLowerCase().includes(q)) && (!f || (f === 'mon' ? !!p.modello : String(p.livello) === f)))
    .sort((a, b) => (a.livello || 3) - (b.livello || 3) || a.nome.localeCompare(b.nome));
  $('#poi-lista').innerHTML = lista.map((p) => `<button class="riga ${stato.poiSel === p.id ? 'attiva' : ''}" data-id="${esc(p.id)}">${p.copertina ? `<img src="${esc(url(p.copertina))}" alt="">` : ''}<span><b>${esc(p.nome)}</b><small>${esc(p.categoria || '')}${p.visibile === false ? ' · nascosto' : ''}</small></span><span class="badge">${p.modello ? '3D · ' : ''}liv. ${p.livello || 3}</span></button>`).join('') || '<p class="nota" style="padding:12px">Nessun risultato.</p>';
  $$('#poi-lista .riga').forEach((b) => b.addEventListener('click', () => { stato.poiSel = b.dataset.id; renderPoiLista(); renderPoiForm(); }));
}
$('#poi-cerca').addEventListener('input', renderPoiLista); $('#poi-filtro-liv').addEventListener('change', renderPoiLista);
$('#poi-nuovo').addEventListener('click', () => { stato.poiSel = null; renderPoiForm({ nome: '', tipo: 'paese', categoria: 'Città e paesi', livello: 3, visibile: true, lat: 45.9, lon: 12.17, descrizione: '', media: [], modello: null }); });
function renderPoiForm(nuovo) {
  const p = nuovo || stato.poi.find((x) => x.id === stato.poiSel); if (!p) return;
  const el = $('#poi-form'); el.classList.remove('vuota');
  el.innerHTML = `
    <h2>${nuovo ? 'Nuovo punto di interesse' : esc(p.nome)}</h2>
    <div class="griglia2">
      <label>Nome <input name="nome" value="${esc(p.nome)}" required></label>
      <label>Categoria <select name="categoria">${CATEGORIE.map((c) => `<option ${p.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}${CATEGORIE.includes(p.categoria) || !p.categoria ? '' : `<option selected>${esc(p.categoria)}</option>`}</select></label>
      <label>Livello (scale importance code) <select name="livello"><option value="1" ${p.livello == 1 ? 'selected' : ''}>1 — sempre visibile</option><option value="2" ${p.livello == 2 ? 'selected' : ''}>2 — avvicinandosi</option><option value="3" ${p.livello == 3 || !p.livello ? 'selected' : ''}>3 — da vicino</option></select></label>
      <label>Tipo <select name="tipo">${['citta', 'paese', 'frazione', 'monumento', 'cantina', 'altro'].map((t) => `<option ${p.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Latitudine <input name="lat" type="number" step="0.00001" value="${p.lat}"></label>
      <label>Longitudine <input name="lon" type="number" step="0.00001" value="${p.lon}"></label>
    </div>
    ${miniMappa(p.lat, p.lon, (lat, lon) => { el.querySelector('[name=lat]').value = lat; el.querySelector('[name=lon]').value = lon; })}
    <label><input type="checkbox" name="visibile" ${p.visibile !== false ? 'checked' : ''}> Visibile sulla mappa (le tappe di servizio degli itinerari possono restare nascoste)</label>
    <label>Descrizione <textarea name="descrizione">${esc(p.descrizione || '')}</textarea></label>
    <h2>Modello 3D</h2>
    <label><input type="checkbox" name="haModello" ${p.modello ? 'checked' : ''}> Mostra un modello 3D semplificato su questo punto</label>
    <div class="griglia3" id="modello-campi" ${p.modello ? '' : 'style="display:none"'}>
      <label>Forma <select name="mTipo">${TIPI_MODELLO.map((t) => `<option ${p.modello?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Scala <input name="mScala" type="number" step="0.1" min="0.1" value="${p.modello?.scala ?? 1}"></label>
      <label>Rotazione (°) <input name="mRot" type="number" step="5" value="${p.modello?.rotazione ?? 0}"></label>
      <label style="grid-column:1/-1">File GLB (opzionale, sostituisce la forma) <input name="mGlb" value="${esc(p.modello?.glb || '')}" placeholder="modelli/nome.glb oppure uploads/…"> <span class="carica"><input type="file" id="glb-file" accept=".glb"><small>carica un .glb</small></span></label>
      <label>Dimensione reale del GLB (m) <input name="mDim" type="number" step="1" value="${p.modello?.dimensione ?? 40}"></label>
    </div>
    <h2>Contenuti multimediali</h2>
    <div class="media" id="media-lista"></div>
    <div class="carica"><select id="media-tipo"><option value="immagine">Immagine</option><option value="video">Video</option><option value="audio">Audio</option><option value="foto360">Foto 360</option><option value="link">Link / video YouTube</option></select>
      <input type="file" id="media-file" accept="image/*,video/*,audio/*"><input id="media-url" placeholder="oppure URL (YouTube, sito…)" style="max-width:260px"><button type="button" class="secondario" id="media-aggiungi">Aggiungi</button></div>
    <label>Copertina (URL di una delle immagini) <input name="copertina" value="${esc(p.copertina || '')}"></label>
    <div class="azioni"><button class="primario" id="poi-salva">Salva</button>${nuovo ? '' : '<button class="pericolo" id="poi-elimina">Elimina</button>'}<span class="nota" id="poi-esito"></span></div>`;
  const media = [...(p.media || [])];
  const renderMedia = () => {
    $('#media-lista', el).innerHTML = media.map((m, i) => `<div class="voce-media">${m.tipo === 'immagine' || m.tipo === 'foto360' ? `<img src="${esc(url(m.url))}" alt="">` : ''}<span class="tipo">${esc(m.tipo)}</span><input data-i="${i}" value="${esc(m.titolo || '')}" placeholder="titolo"><small>${esc(m.url.split('/').pop())}</small><button type="button" data-del="${i}" title="Rimuovi">×</button></div>`).join('') || '<p class="nota">Nessun contenuto.</p>';
    $$('#media-lista input', el).forEach((i) => i.addEventListener('input', () => (media[+i.dataset.i].titolo = i.value)));
    $$('#media-lista [data-del]', el).forEach((b) => b.addEventListener('click', () => { media.splice(+b.dataset.del, 1); renderMedia(); }));
  };
  renderMedia();
  $('[name=haModello]', el).addEventListener('change', (e) => ($('#modello-campi', el).style.display = e.target.checked ? '' : 'none'));
  $('#glb-file', el).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const j = await carica(f, 'modelli'); $('[name=mGlb]', el).value = j.url; toast('GLB caricato'); } catch (err) { toast(err.message, true); } });
  $('#media-aggiungi', el).addEventListener('click', async () => {
    const tipo = $('#media-tipo', el).value, file = $('#media-file', el).files[0], u = $('#media-url', el).value.trim();
    try {
      if (file) { const j = await carica(file, 'poi/' + (p.id || 'nuovo')); media.push({ tipo, url: j.url, titolo: file.name.replace(/\.[^.]+$/, '') }); }
      else if (u) media.push({ tipo: tipo === 'immagine' && !/youtu|vimeo/.test(u) ? 'immagine' : (/youtu|vimeo/.test(u) ? 'video' : tipo), url: u, titolo: '' });
      else return toast('Scegli un file o inserisci un URL', true);
      $('#media-file', el).value = ''; $('#media-url', el).value = ''; renderMedia();
    } catch (err) { toast(err.message, true); }
  });
  $('#poi-salva', el).addEventListener('click', async () => {
    const v = (n) => $(`[name=${n}]`, el).value;
    const dati = { nome: v('nome'), categoria: v('categoria'), livello: +v('livello'), tipo: v('tipo'), lat: +v('lat'), lon: +v('lon'), visibile: $('[name=visibile]', el).checked, descrizione: v('descrizione'), media, copertina: v('copertina') || (media.find((m) => m.tipo === 'immagine')?.url || null),
      modello: $('[name=haModello]', el).checked ? { tipo: v('mTipo'), scala: +v('mScala') || 1, rotazione: +v('mRot') || 0, glb: v('mGlb') || null, dimensione: +v('mDim') || 40 } : null };
    if (!dati.nome) return toast('Il nome è obbligatorio', true);
    try {
      if (nuovo) { const r = await api('POST', 'poi', dati); stato.poiSel = r.id; } else await api('PUT', 'poi/' + p.id, dati);
      toast('Salvato'); await ricarica(); renderPoiForm();
    } catch (err) { toast(err.message, true); }
  });
  $('#poi-elimina', el)?.addEventListener('click', async () => { if (!confirm(`Eliminare "${p.nome}"?`)) return; await api('DELETE', 'poi/' + p.id); stato.poiSel = null; el.classList.add('vuota'); el.textContent = 'Eliminato.'; await ricarica(); });
}

// ── Itinerari ──
function renderItLista() {
  $('#it-lista').innerHTML = stato.itinerari.map((it) => `<button class="riga ${stato.itSel === it.id ? 'attiva' : ''}" data-id="${esc(it.id)}"><span class="colore" style="background:${esc(it.colore || '#c62828')}"></span><span><b>${esc(it.nome)}</b><small>${esc(it.sottotitolo || '')}${it.visibile === false ? ' · nascosto' : ''}</small></span><span class="badge">${it.km ? it.km + ' km' : ''}${it.audio?.length ? ' · ' + it.audio.length + ' audio' : ''}</span></button>`).join('');
  $$('#it-lista .riga').forEach((b) => b.addEventListener('click', () => { stato.itSel = b.dataset.id; renderItLista(); renderItForm(); }));
}
$('#it-nuovo').addEventListener('click', () => { stato.itSel = null; renderItForm({ nome: '', sottotitolo: '', descrizione: '', colore: '#c62828', visibile: true, tappe: [], geometria: [], audio: [] }); });
function renderItForm(nuovo) {
  const it = nuovo || stato.itinerari.find((x) => x.id === stato.itSel); if (!it) return;
  const el = $('#it-form'); el.classList.remove('vuota');
  const poiOpz = stato.poi.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
  el.innerHTML = `
    <h2>${nuovo ? 'Nuovo itinerario' : esc(it.nome)}</h2>
    <div class="griglia2">
      <label>Nome <input name="nome" value="${esc(it.nome)}"></label>
      <label>Sottotitolo <input name="sottotitolo" value="${esc(it.sottotitolo || '')}"></label>
      <label>Colore <input name="colore" type="color" value="${esc(it.colore || '#c62828')}" style="max-width:80px;height:38px;padding:2px"></label>
      <label><input type="checkbox" name="visibile" ${it.visibile !== false ? 'checked' : ''}> Visibile nell'elenco</label>
    </div>
    <label>Descrizione <textarea name="descrizione">${esc(it.descrizione || '')}</textarea></label>
    <h2>Tappe</h2>
    <p>Una tappa per riga: l'id di un punto di interesse (es. <code>conegliano</code>) oppure coordinate <code>lon,lat</code>. Il tracciato stradale si ricalcola con il tasto qui sotto.</p>
    <div class="carica"><select id="tappa-poi"><option value="">Aggiungi una tappa dall'elenco…</option>${poiOpz}</select></div>
    <textarea class="tappe" name="tappe">${esc((it.tappe || []).map((t) => (Array.isArray(t) ? t.join(',') : t)).join('\n'))}</textarea>
    <div class="azioni"><button type="button" class="secondario" id="it-traccia">Ricalcola il tracciato su strada (OSRM)</button><span class="nota">${it.geometria?.length ? `${it.geometria.length} punti, ${it.km || '?'} km (${it.fonte || ''})` : 'nessun tracciato'}</span></div>
    <h2>Audio geolocalizzati</h2>
    <p>Durante il percorso animato, entrando nel raggio di un audio l'animazione si ferma e l'audio parte; riprende alla fine.</p>
    <div id="audio-lista"></div>
    <div class="carica"><input type="file" id="audio-file" accept="audio/*"><button type="button" class="secondario" id="audio-aggiungi">Aggiungi audio</button><small>Posizione iniziale: il punto di partenza; poi correggi lat/lon (o clicca sulla mini-mappa)</small></div>
    ${miniMappa(it.geometria?.[0]?.[1] || 45.9, it.geometria?.[0]?.[0] || 12.17, (lat, lon) => { const sel = $('#audio-lista .sel', el); if (sel) { sel.querySelector('[data-k=lat]').value = lat; sel.querySelector('[data-k=lon]').value = lon; sel.querySelector('[data-k=lat]').dispatchEvent(new Event('input')); } else toast('Seleziona prima una riga audio (clic sul titolo)'); })}
    <div class="azioni"><button class="primario" id="it-salva">Salva</button>${nuovo ? '' : '<button class="pericolo" id="it-elimina">Elimina</button>'}</div>`;
  const audio = (it.audio || []).map((a) => ({ ...a }));
  const renderAudio = () => {
    $('#audio-lista', el).innerHTML = audio.length ? '<div class="audio-riga nota"><span>Titolo</span><span>Lat</span><span>Lon</span><span>Raggio m</span><span>File</span><span></span></div>' + audio.map((a, i) => `<div class="audio-riga" data-i="${i}"><input data-k="titolo" value="${esc(a.titolo || '')}" placeholder="titolo"><input data-k="lat" type="number" step="0.00001" value="${a.lat}"><input data-k="lon" type="number" step="0.00001" value="${a.lon}"><input data-k="raggio" type="number" step="10" value="${a.raggio || 150}"><small>${esc((a.url || '').split('/').pop())}</small><button type="button" data-del="${i}" style="border:0;background:none;color:#a33;cursor:pointer;font-size:18px">×</button></div>`).join('') : '<p class="nota">Nessun audio.</p>';
    $$('#audio-lista input', el).forEach((i) => { i.addEventListener('input', () => { const a = audio[+i.closest('.audio-riga').dataset.i]; a[i.dataset.k] = i.dataset.k === 'titolo' ? i.value : +i.value; }); i.addEventListener('focus', () => { $$('#audio-lista .audio-riga', el).forEach((r) => r.classList.remove('sel')); i.closest('.audio-riga').classList.add('sel'); }); });
    $$('#audio-lista [data-del]', el).forEach((b) => b.addEventListener('click', () => { audio.splice(+b.dataset.del, 1); renderAudio(); }));
  };
  renderAudio();
  $('#tappa-poi', el).addEventListener('change', (e) => { if (!e.target.value) return; const ta = $('[name=tappe]', el); ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + e.target.value; e.target.value = ''; });
  const leggiTappe = () => $('[name=tappe]', el).value.split(/\n/).map((s) => s.trim()).filter(Boolean).map((s) => (/^-?[\d.]+\s*,\s*-?[\d.]+$/.test(s) ? s.split(',').map(Number) : s));
  $('#audio-aggiungi', el).addEventListener('click', async () => {
    const f = $('#audio-file', el).files[0]; if (!f) return toast('Scegli un file audio', true);
    try { const j = await carica(f, 'audio'); const p0 = it.geometria?.[0] || [12.17, 45.9]; audio.push({ titolo: f.name.replace(/\.[^.]+$/, ''), url: j.url, lat: +p0[1].toFixed(5), lon: +p0[0].toFixed(5), raggio: 150 }); renderAudio(); $('#audio-file', el).value = ''; } catch (err) { toast(err.message, true); }
  });
  const salva = async (poiTraccia = false) => {
    const v = (n) => $(`[name=${n}]`, el).value;
    const dati = { nome: v('nome'), sottotitolo: v('sottotitolo'), descrizione: v('descrizione'), colore: v('colore'), visibile: $('[name=visibile]', el).checked, tappe: leggiTappe(), audio };
    if (!dati.nome) return toast('Il nome è obbligatorio', true);
    let id = it.id;
    if (nuovo) { const r = await api('POST', 'itinerari', { ...dati, geometria: [], km: null }); id = r.id; stato.itSel = id; } else await api('PUT', 'itinerari/' + id, dati);
    if (poiTraccia) { toast('Calcolo del tracciato…'); await api('POST', `itinerari/${id}/traccia`, { tappe: dati.tappe }); }
    toast('Salvato'); await ricarica(); renderItForm();
  };
  $('#it-salva', el).addEventListener('click', () => salva(false).catch((e) => toast(e.message, true)));
  $('#it-traccia', el).addEventListener('click', () => salva(true).catch((e) => toast(e.message, true)));
  $('#it-elimina', el)?.addEventListener('click', async () => { if (!confirm(`Eliminare "${it.nome}"?`)) return; await api('DELETE', 'itinerari/' + it.id); stato.itSel = null; el.classList.add('vuota'); el.textContent = 'Eliminato.'; await ricarica(); });
}

// ── Foto 360 ──
function renderFLista() {
  $('#f-lista').innerHTML = stato.foto360.map((f) => `<button class="riga ${stato.fSel === f.id ? 'attiva' : ''}" data-id="${esc(f.id)}"><img src="${esc(url(f.anteprima || f.url))}" alt=""><span><b>${esc(f.titolo || 'Foto 360')}</b><small>${esc(f.tipo || 'terra')} · ${f.collegamenti?.length || 0} collegamenti</small></span></button>`).join('') || '<p class="nota" style="padding:12px">Nessuna foto 360. Caricane una.</p>';
  $$('#f-lista .riga').forEach((b) => b.addEventListener('click', () => { stato.fSel = b.dataset.id; renderFLista(); renderFForm(); }));
}
$('#f-nuova').addEventListener('click', () => { stato.fSel = null; renderFForm({ titolo: '', descrizione: '', tipo: 'terra', url: '', lat: 45.9, lon: 12.17, poi: '', direzioneIniziale: 0, collegamenti: [] }); });
function renderFForm(nuovo) {
  const f = nuovo || stato.foto360.find((x) => x.id === stato.fSel); if (!f) return;
  const el = $('#f-form'); el.classList.remove('vuota');
  const altre = stato.foto360.filter((x) => x.id !== f.id);
  el.innerHTML = `
    <h2>${nuovo ? 'Nuova foto 360' : esc(f.titolo)}</h2>
    <div class="griglia2">
      <label>Titolo <input name="titolo" value="${esc(f.titolo || '')}"></label>
      <label>Tipo <select name="tipo"><option value="terra" ${f.tipo !== 'aerea' ? 'selected' : ''}>a terra</option><option value="aerea" ${f.tipo === 'aerea' ? 'selected' : ''}>aerea (drone)</option></select></label>
      <label>Latitudine <input name="lat" type="number" step="0.00001" value="${f.lat}"></label>
      <label>Longitudine <input name="lon" type="number" step="0.00001" value="${f.lon}"></label>
      <label>Punto di interesse collegato <select name="poi"><option value="">nessuno</option>${stato.poi.map((p) => `<option value="${esc(p.id)}" ${f.poi === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Direzione iniziale dello sguardo (°, 0 = nord) <input name="direzioneIniziale" type="number" step="5" value="${f.direzioneIniziale || 0}"></label>
    </div>
    ${miniMappa(f.lat, f.lon, (lat, lon) => { el.querySelector('[name=lat]').value = lat; el.querySelector('[name=lon]').value = lon; })}
    <label>Descrizione <textarea name="descrizione">${esc(f.descrizione || '')}</textarea></label>
    <label>Immagine equirettangolare (JPG 2:1, consigliati 6000–8000 px) <input name="url" value="${esc(f.url || '')}" placeholder="uploads/foto360/…"> <span class="carica"><input type="file" id="f-file" accept="image/*"><small>carica</small></span></label>
    ${f.url ? `<img class="anteprima" src="${esc(url(f.url))}" alt="" style="max-height:160px">` : ''}
    <h2>Collegamenti (frecce verso altre foto)</h2>
    <p>Direzione in gradi da nord (0 = nord, 90 = est); se vuota, viene calcolata dalle coordinate delle due foto.</p>
    <div id="coll-lista"></div>
    <div class="carica"><select id="coll-dest"><option value="">Aggiungi un collegamento verso…</option>${altre.map((x) => `<option value="${esc(x.id)}">${esc(x.titolo || x.id)}</option>`).join('')}</select><label style="margin:0"><input type="checkbox" id="coll-reciproco" checked> anche il ritorno</label></div>
    <div class="azioni"><button class="primario" id="f-salva">Salva</button>${nuovo ? '' : '<button class="pericolo" id="f-elimina">Elimina</button>'}</div>`;
  const coll = (f.collegamenti || []).map((c) => ({ ...c }));
  const renderColl = () => {
    $('#coll-lista', el).innerHTML = coll.length ? coll.map((c, i) => { const d = stato.foto360.find((x) => x.id === c.a); return `<div class="coll-riga"><span>→ ${esc(d?.titolo || c.a)}</span><input data-i="${i}" data-k="direzione" type="number" step="5" placeholder="auto" value="${c.direzione ?? ''}"><input data-i="${i}" data-k="altezza" type="number" step="5" placeholder="-12" value="${c.altezza ?? ''}"><button type="button" data-del="${i}" style="border:0;background:none;color:#a33;cursor:pointer;font-size:18px">×</button></div>`; }).join('') : '<p class="nota">Nessun collegamento.</p>';
    $$('#coll-lista input', el).forEach((i) => i.addEventListener('input', () => { coll[+i.dataset.i][i.dataset.k] = i.value === '' ? undefined : +i.value; }));
    $$('#coll-lista [data-del]', el).forEach((b) => b.addEventListener('click', () => { coll.splice(+b.dataset.del, 1); renderColl(); }));
  };
  renderColl();
  $('#coll-dest', el).addEventListener('change', (e) => { if (e.target.value && !coll.some((c) => c.a === e.target.value)) { coll.push({ a: e.target.value, reciproco: $('#coll-reciproco', el).checked }); renderColl(); } e.target.value = ''; });
  $('#f-file', el).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const j = await carica(file, 'foto360'); $('[name=url]', el).value = j.url; toast('Immagine caricata'); } catch (err) { toast(err.message, true); } });
  $('#f-salva', el).addEventListener('click', async () => {
    const v = (n) => $(`[name=${n}]`, el).value;
    const dati = { titolo: v('titolo'), tipo: v('tipo'), lat: +v('lat'), lon: +v('lon'), poi: v('poi') || null, direzioneIniziale: +v('direzioneIniziale') || 0, descrizione: v('descrizione'), url: v('url'), collegamenti: coll.map(({ reciproco, ...c }) => c) };
    if (!dati.url) return toast('Carica l’immagine 360', true);
    try {
      let id = f.id;
      if (nuovo) { const r = await api('POST', 'foto360', dati); id = r.id; stato.fSel = id; } else await api('PUT', 'foto360/' + id, dati);
      // collegamenti reciproci
      for (const c of coll.filter((c) => c.reciproco)) { const d = stato.foto360.find((x) => x.id === c.a); if (d && !(d.collegamenti || []).some((k) => k.a === id)) await api('PUT', 'foto360/' + d.id, { collegamenti: [...(d.collegamenti || []), { a: id }] }); }
      toast('Salvato'); await ricarica(); renderFForm();
    } catch (err) { toast(err.message, true); }
  });
  $('#f-elimina', el)?.addEventListener('click', async () => { if (!confirm('Eliminare la foto 360?')) return; await api('DELETE', 'foto360/' + f.id); stato.fSel = null; el.classList.add('vuota'); el.textContent = 'Eliminata.'; await ricarica(); });
}

// ── Impostazioni ──
function renderCfg() {
  const c = stato.cfg, f = $('#cfg-form');
  f.liv2.value = c.livelli?.[2] ?? 26000; f.liv3.value = c.livelli?.[3] ?? 11000;
  f.esagerazione.value = c.esagerazione ?? 1.7; f.fattoreDistanza.value = c.modelli?.fattoreDistanza ?? 0.035; f.titolo.value = c.titolo || '';
  for (const k of ['w', 'e', 'n', 's']) f[k].value = c.bbox?.[k] ?? '';
}
$('#cfg-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  try {
    await api('PUT', 'config', { titolo: f.titolo.value, livelli: { 2: +f.liv2.value, 3: +f.liv3.value }, esagerazione: +f.esagerazione.value, vista: { ...(stato.cfg.vista || {}), esagerazione: +f.esagerazione.value }, modelli: { ...(stato.cfg.modelli || {}), fattoreDistanza: +f.fattoreDistanza.value }, bbox: { w: +f.w.value, e: +f.e.value, n: +f.n.value, s: +f.s.value } });
    $('#cfg-esito').textContent = 'Impostazioni salvate: ricarica la mappa per vederle.'; await ricarica();
  } catch (err) { toast(err.message, true); }
});
$('#esporta').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ config: stato.cfg, poi: stato.poi, itinerari: stato.itinerari, foto360: stato.foto360 }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mappa-prosecco-${new Date().toISOString().slice(0, 10)}.json`; a.click();
});
$('#importa').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!confirm('Sostituire tutti i contenuti con quelli del file?')) return;
    if (j.config) await api('PUT', 'config', j.config);
    for (const k of ['poi', 'itinerari', 'foto360']) if (Array.isArray(j[k])) await api('PUT', k, j[k]);
    toast('Ripristinato'); await ricarica();
  } catch (err) { toast(err.message, true); }
});

if (token) avvia(); else mostraLogin();
