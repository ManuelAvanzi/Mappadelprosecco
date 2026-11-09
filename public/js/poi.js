// Elenco dei punti di interesse per categoria e scheda di dettaglio con i contenuti multimediali.
const ICONE = {
  'Città e paesi': '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V8l4-3 4 3v13M13 21v-9h6v9M8 11h2M8 15h2M16 15h1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  'Castelli': '<svg viewBox="0 0 24 24"><path d="M4 21V9l2-2V4h3v3h2V4h2v3h2V4h3v3l2 2v12zM10 21v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  'Abbazie e chiese': '<svg viewBox="0 0 24 24"><path d="M5 21V12l7-5 7 5v9zM12 3v4M10 5h4M10 21v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  'Palazzi e ville': '<svg viewBox="0 0 24 24"><path d="M3 21h18M4 10l8-5 8 5M5 10v11M19 10v11M9 21v-6h6v6M9 13h0M15 13h0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  'Natura': '<svg viewBox="0 0 24 24"><path d="M3 20l6-10 4 6 3-4 5 8zM15 5a2 2 0 1 0 0 .1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  'Luoghi della tradizione': '<svg viewBox="0 0 24 24"><circle cx="9" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 9v10M4 14h10M14 20V9l6 3v8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const iconaDi = (c) => ICONE[c] || '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (u) => (u && !/^https?:|^\//.test(u) ? '/' + u : u);

export class PannelloPoi {
  constructor(app) { this.app = app; this.filtro = null; }
  /** html dell'elenco per il pannello laterale */
  render(corpo) {
    const poi = this.app.poi.filter((p) => p.visibile !== false);
    const categorie = [...new Set(poi.map((p) => p.categoria || 'Altro'))];
    const ordine = ['Castelli', 'Abbazie e chiese', 'Palazzi e ville', 'Natura', 'Luoghi della tradizione', 'Città e paesi'];
    categorie.sort((a, b) => (ordine.indexOf(a) + 1 || 99) - (ordine.indexOf(b) + 1 || 99));
    corpo.innerHTML = '';
    const filtri = document.createElement('div'); filtri.className = 'filtri';
    filtri.innerHTML = `<button class="${!this.filtro ? 'attivo' : ''}" data-f="">Tutti</button>` + categorie.map((c) => `<button class="${this.filtro === c ? 'attivo' : ''}" data-f="${esc(c)}">${esc(c)}</button>`).join('');
    filtri.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.filtro = b.dataset.f || null; this.render(corpo); });
    corpo.appendChild(filtri);
    for (const c of categorie) {
      if (this.filtro && this.filtro !== c) continue;
      const h = document.createElement('h3'); h.textContent = c; corpo.appendChild(h);
      const lista = poi.filter((p) => (p.categoria || 'Altro') === c).sort((a, b) => (a.livello || 3) - (b.livello || 3) || a.nome.localeCompare(b.nome));
      for (const p of lista) {
        const b = document.createElement('button'); b.className = 'voce';
        const cop = p.copertina || p.media?.find((m) => m.tipo === 'immagine')?.url;
        b.innerHTML = (cop ? `<img class="copertina" loading="lazy" src="${esc(url(cop))}" alt="">` : `<span class="segna">${iconaDi(c)}</span>`) +
          `<span class="testo"><b>${esc(p.nome)}</b><small>${esc(p.descrizione || (p.tipo === 'monumento' ? 'Monumento' : 'Località'))}</small></span>` +
          (p.tipo !== 'monumento' ? `<span class="badge">liv. ${p.livello || 3}</span>` : (p.modello ? '<span class="badge">3D</span>' : ''));
        b.addEventListener('click', () => this.app.apriPoi(p, true));
        corpo.appendChild(b);
      }
    }
  }
  /** scheda di dettaglio */
  renderDettaglio(p, corpo) {
    const imgs = (p.media || []).filter((m) => m.tipo === 'immagine');
    const altri = (p.media || []).filter((m) => m.tipo !== 'immagine');
    const cop = p.copertina || imgs[0]?.url;
    const f360 = this.app.foto360.filter((f) => f.poi === p.id || (f.lat && Math.hypot((f.lat - p.lat) * 111000, (f.lon - p.lon) * 77000) < 400));
    let h = cop ? `<img class="copertina" src="${esc(url(cop))}" alt="${esc(p.nome)}">` : '';
    h += `<div class="contenuto"><div class="categoria">${esc(p.categoria || '')}</div><h2>${esc(p.nome)}</h2>`;
    if (p.descrizione) h += `<p>${esc(p.descrizione).replace(/\n/g, '<br>')}</p>`;
    h += `<div class="azioni"><button class="bottone primario" data-az="vai"><svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Vai sul plastico</button>`;
    for (const f of f360) h += `<button class="bottone" data-az="360" data-id="${esc(f.id)}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="8" ry="3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${esc(f.titolo || 'Foto 360')}</button>`;
    h += '</div>';
    if (imgs.length > 1 || (imgs.length === 1 && !cop)) {
      h += '<div class="galleria">' + imgs.slice(0, 8).map((m, i) => `<img loading="lazy" src="${esc(url(m.url))}" alt="${esc(m.titolo || '')}" data-i="${i}">`).join('') + (imgs.length > 8 ? `<div class="altro" data-i="8">+${imgs.length - 8}</div>` : '') + '</div>';
    }
    if (altri.length) {
      h += '<div class="media-lista">' + altri.map((m) => {
        const t = m.titolo ? `<div class="titolo-media">${esc(m.titolo)}</div>` : '';
        if (m.tipo === 'video') return t + (/youtube|youtu\.be|vimeo/.test(m.url) ? `<a class="bottone" href="${esc(m.url)}" target="_blank" rel="noopener">Guarda il video</a>` : `<video controls preload="metadata" src="${esc(url(m.url))}"></video>`);
        if (m.tipo === 'audio') return t + `<audio controls preload="none" src="${esc(url(m.url))}"></audio>`;
        if (m.tipo === 'foto360') return t + `<button class="bottone" data-az="360url" data-url="${esc(url(m.url))}" data-titolo="${esc(m.titolo || p.nome)}">Apri la foto 360</button>`;
        if (m.tipo === 'link') return `<a class="bottone" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.titolo || m.url)}</a>`;
        return '';
      }).join('') + '</div>';
    }
    h += '</div>';
    corpo.innerHTML = h;
    corpo.querySelector('[data-az=vai]').addEventListener('click', () => this.app.volaA(p));
    corpo.querySelectorAll('[data-az="360"]').forEach((b) => b.addEventListener('click', () => this.app.foto.apri(b.dataset.id)));
    corpo.querySelectorAll('[data-az="360url"]').forEach((b) => b.addEventListener('click', () => this.app.foto.apriUrl(b.dataset.url, b.dataset.titolo)));
    corpo.querySelectorAll('.galleria img, .galleria .altro').forEach((el) => el.addEventListener('click', () => lightbox(imgs, +el.dataset.i)));
    const copEl = corpo.querySelector('.copertina'); if (copEl && imgs.length) copEl.addEventListener('click', () => lightbox(imgs, Math.max(0, imgs.findIndex((m) => m.url === cop))));
  }
}

export function lightbox(imgs, i = 0) {
  let idx = i;
  const box = document.createElement('div'); box.id = 'lightbox';
  const mostra = () => {
    const m = imgs[idx];
    // credito e licenza (foto da Wikimedia Commons o di altri autori): obbligatori per le licenze CC
    const credito = m.credito ? `<div class="credito">${m.fonteUrl ? `<a href="${esc(m.fonteUrl)}" target="_blank" rel="noopener">${esc(m.credito)}</a>` : esc(m.credito)}</div>` : '';
    box.innerHTML = `<img src="${esc(url(m.url))}" alt=""><div class="didascalia">${esc(m.titolo || '')} ${imgs.length > 1 ? `· ${idx + 1}/${imgs.length}` : ''}${credito}</div><button class="icona" aria-label="Chiudi"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
  };
  mostra();
  box.addEventListener('click', (e) => { if (e.target.tagName === 'IMG' && imgs.length > 1) { idx = (idx + 1) % imgs.length; mostra(); } else box.remove(); });
  const tast = (e) => { if (e.key === 'Escape') { box.remove(); removeEventListener('keydown', tast); } if (e.key === 'ArrowRight') { idx = (idx + 1) % imgs.length; mostra(); } if (e.key === 'ArrowLeft') { idx = (idx - 1 + imgs.length) % imgs.length; mostra(); } };
  addEventListener('keydown', tast);
  document.body.appendChild(box);
}
