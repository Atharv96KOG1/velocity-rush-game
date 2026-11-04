/**
 * DOM overlay: one panel per human viewport plus shared team bar and minimap.
 * Writes are cached so unchanged values never touch the DOM.
 */
export class HUD {
  constructor(viewCount, { team = false, minimap = null, hint = '' } = {}) {
    this.root = document.getElementById('hud');
    // Own container, so disposing an old session never clears the new session's HUD.
    this.el = document.createElement('div');
    this.root.appendChild(this.el);
    this.cache = new Map();
    this.views = [];
    this.timers = [];
    for (let i = 0; i < viewCount; i++) {
      const top = viewCount === 1 ? 0 : i * 50, height = viewCount === 1 ? 100 : 50;
      const v = document.createElement('div');
      v.className = 'view';
      v.style.top = top + '%';
      v.style.height = height + '%';
      v.innerHTML = `
        <div class="speedlines"></div><div class="vignette"></div>
        <div class="hud-power"><div class="pw-icon"></div><div class="pw-body"><div class="pw-name"></div><div class="pw-bar"><i></i></div></div></div>
        <div class="hud-pos"></div><div class="hud-info"></div><div class="hud-drift"></div>
        <div class="hud-msg"></div><div class="hud-center"></div>
        <div class="hud-speed"><b>0</b><span>KM/H</span><div class="boost"><i></i></div></div>`;
      this.el.appendChild(v);
      const q = s => v.querySelector(s);
      this.views.push({ pos: q('.hud-pos'), info: q('.hud-info'), drift: q('.hud-drift'), msg: q('.hud-msg'), center: q('.hud-center'), speed: q('.hud-speed b'), boost: q('.boost'), boostFill: q('.boost i'),
        lines: q('.speedlines'), vignette: q('.vignette'), power: q('.hud-power'), pwIcon: q('.pw-icon'), pwName: q('.pw-name'), pwFill: q('.pw-bar i') });
      this.timers.push({ msg: 0, center: 0 });
    }
    if (team) {
      this.team = document.createElement('div');
      this.team.className = 'hud-team';
      this.team.innerHTML = '<span style="background:var(--teamA)">0</span><span style="background:var(--teamB)">0</span>';
      this.el.appendChild(this.team);
    }
    if (minimap) {
      minimap.canvas.className = 'hud-minimap' + (viewCount > 1 ? ' split' : '');
      this.el.appendChild(minimap.canvas);
    }
    if (hint) {
      const h = document.createElement('div');
      h.className = 'hud-hint';
      h.textContent = hint;
      this.el.appendChild(h);
      setTimeout(() => h.remove(), 9000);
    }
  }

  put(el, key, value, html = false) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (html) el.innerHTML = value; else el.textContent = value;
  }

  /** d: { pos (html), info, drift, kmh, boost, nitro, rush 0..1, tint, power {icon,name,charge,key,color} } */
  set(i, d) {
    const v = this.views[i];
    this.put(v.pos, i + 'p', d.pos ?? '', true);
    this.put(v.info, i + 'i', d.info ?? '');
    this.put(v.drift, i + 'd', d.drift ?? '');
    this.put(v.speed, i + 's', String(d.kmh));
    const b = Math.round(d.boost * 100) + '%';
    if (this.cache.get(i + 'b') !== b) { this.cache.set(i + 'b', b); v.boostFill.style.width = b; }
    if (this.cache.get(i + 'n') !== d.nitro) { this.cache.set(i + 'n', d.nitro); v.boost.classList.toggle('on', d.nitro); }
    const rush = (Math.round((d.rush ?? 0) * 20) / 20).toString();
    if (this.cache.get(i + 'r') !== rush) { this.cache.set(i + 'r', rush); v.lines.style.opacity = rush; }
    if (this.cache.get(i + 'v') !== (d.tint ?? '')) { this.cache.set(i + 'v', d.tint ?? ''); v.vignette.style.boxShadow = d.tint ? `inset 0 0 160px 40px ${d.tint}` : 'none'; }
    const p = d.power;
    v.power.style.display = p ? '' : 'none';
    if (!p) return;
    this.put(v.pwIcon, i + 'pi', p.icon);
    this.put(v.pwName, i + 'pn', p.charge >= 1 ? `${p.name} · READY [${p.key}]` : p.name);
    const w = Math.floor(p.charge * 100) + '%';
    if (this.cache.get(i + 'pw') !== w) { this.cache.set(i + 'pw', w); v.pwFill.style.width = w; v.power.classList.toggle('ready', p.charge >= 1); }
    if (this.cache.get(i + 'pc') !== p.color) { this.cache.set(i + 'pc', p.color); v.power.style.setProperty('--pw', p.color); }
  }

  setTeams(a, b) {
    if (!this.team) return;
    const [sa, sb] = this.team.children;
    this.put(sa, 'ta', 'BLUE ' + a);
    this.put(sb, 'tb', b + ' RED');
  }

  /** Big centre text. idx null = every view. */
  center(text, dur = 1.2, idx = null) {
    this.each(idx, (v, t) => { v.center.textContent = text; t.center = dur; });
  }

  msg(text, dur = 2.5, idx = null, color = '') {
    this.each(idx, (v, t) => { v.msg.textContent = text; v.msg.style.color = color; t.msg = dur; });
  }

  each(idx, fn) {
    this.views.forEach((v, i) => { if (idx === null || idx === i) fn(v, this.timers[i]); });
  }

  tick(dt) {
    this.views.forEach((v, i) => {
      const t = this.timers[i];
      if (t.msg > 0 && (t.msg -= dt) <= 0) v.msg.textContent = '';
      if (t.center > 0 && (t.center -= dt) <= 0) v.center.textContent = '';
    });
  }

  dispose() { this.el.remove(); }
}

/** 2D overview map. Roads drawn once to an offscreen layer; markers each frame. */
export class Minimap {
  constructor(tracks, size = 190, bounds = null) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (bounds) [minX, maxX, minZ, maxZ] = bounds;
    else for (const t of tracks) for (let i = 0; i < t.N; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const pad = 12, span = Math.max(maxX - minX, maxZ - minZ);
    this.scale = (size - pad * 2) / span;
    this.ox = pad + ((size - pad * 2) - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = pad + ((size - pad * 2) - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    this.size = size;
    const dpr = Math.min(2, devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size * dpr;
    this.canvas.style.width = this.canvas.style.height = size + 'px';
    this.g = this.canvas.getContext('2d');
    this.g.scale(dpr, dpr);
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = size * dpr;
    const b = this.bg.getContext('2d');
    b.scale(dpr, dpr);
    b.lineCap = b.lineJoin = 'round';
    for (const [w, col] of [[6, 'rgba(255,255,255,.25)'], [3, 'rgba(255,255,255,.85)']]) {
      b.lineWidth = w;
      b.strokeStyle = col;
      for (const t of tracks) {
        b.beginPath();
        for (let i = 0; i < t.N; i++) {
          const [x, y] = this.map(t.px[i], t.pz[i]);
          if (i) b.lineTo(x, y); else b.moveTo(x, y);
        }
        if (t.closed) b.closePath();
        b.stroke();
      }
    }
  }

  // Map is drawn mirrored on x so it matches the chase view (screen-right = world -x).
  map(x, z) { return [this.size - (this.ox + x * this.scale), this.size - (this.oz + z * this.scale)]; }

  draw(markers) {
    const g = this.g, s = this.size;
    g.clearRect(0, 0, s, s);
    g.drawImage(this.bg, 0, 0, s, s);
    for (const m of markers) {
      const [x, y] = this.map(m.x, m.z);
      if (x < 0 || y < 0 || x > s || y > s) continue;
      g.fillStyle = m.color;
      g.beginPath();
      if (m.yaw !== undefined) {
        // Arrow pointing along heading.
        const fx = -Math.sin(m.yaw), fy = -Math.cos(m.yaw), r = m.r ?? 6;
        g.moveTo(x + fx * r, y + fy * r);
        g.lineTo(x - fx * r * 0.6 - fy * r * 0.6, y - fy * r * 0.6 + fx * r * 0.6);
        g.lineTo(x - fx * r * 0.6 + fy * r * 0.6, y - fy * r * 0.6 - fx * r * 0.6);
        g.closePath();
        g.fill();
        g.strokeStyle = '#000';
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.arc(x, y, m.r ?? 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
