(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('editorCanvas');
  const stage = $('canvasStage');
  const ctx = canvas.getContext('2d', { alpha: false });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const uid = (prefix = 'o') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const PRODUCTS = [
    { id: 'DL', code: 'DL', name: 'Down Light', ar: 'داون لايت', category: 'سبوت', color: '#ed1f24', shape: 'dot', effect: 'radial', glow: '#ffd07a', radius: 44, intensity: 1.00, kelvin: 3000 },
    { id: 'SLWP', code: 'SLWP', name: 'Spot Light Waterproof', ar: 'سبوت مقاوم للماء', category: 'سبوت', color: '#174bd4', shape: 'waterproof', effect: 'radial', glow: '#b9d9ff', radius: 40, intensity: .90, kelvin: 5000 },
    { id: 'SLS', code: 'SLS', name: 'Mini Spot Light', ar: 'ميني سبوت', category: 'سبوت', color: '#2ed244', shape: 'dotLabel', effect: 'radial', glow: '#ffe1a1', radius: 30, intensity: .72, kelvin: 3000 },
    { id: 'TRACK2', code: 'TR2', name: 'Magnetic Track 2m', ar: 'تراك مغناطيسي 2م', category: 'خطي', color: '#f04444', shape: 'track', effect: 'linear', glow: '#ffd27f', radius: 32, intensity: .90, kelvin: 3000 },
    { id: 'TRACK3', code: 'TR3', name: 'Magnetic Track 3m', ar: 'تراك مغناطيسي 3م', category: 'خطي', color: '#f04444', shape: 'trackLong', effect: 'linearLong', glow: '#ffd27f', radius: 35, intensity: .95, kelvin: 3000 },
    { id: 'LL30', code: 'LL30', name: 'Linear Light 30cm', ar: 'إنارة خطية 30سم', category: 'خطي', color: '#d7dde5', shape: 'linear', effect: 'linear', glow: '#ffe4a8', radius: 27, intensity: .72, kelvin: 3000 },
    { id: 'LL60', code: 'LL60', name: 'Linear Light 60cm', ar: 'إنارة خطية 60سم', category: 'خطي', color: '#d7dde5', shape: 'linearLong', effect: 'linearLong', glow: '#ffe4a8', radius: 32, intensity: .78, kelvin: 3000 },
    { id: 'FOCUS', code: 'FL', name: 'Focus Light', ar: 'فوكَس لايت', category: 'ديكوري', color: '#e5e9ee', shape: 'focus', effect: 'directional', glow: '#ffd27d', radius: 48, intensity: 1.05, kelvin: 3000 },
    { id: 'STRIP', code: 'ST', name: 'Strip Light', ar: 'شريط LED', category: 'مخفي', color: '#7da5ff', shape: 'strip', effect: 'strip', glow: '#ffc96d', radius: 30, intensity: .78, kelvin: 3000 },
    { id: 'PS100', code: '100W', name: 'Power Supply 100W', ar: 'مزود طاقة 100 واط', category: 'ملحقات', color: '#ed1f24', shape: 'supply', effect: 'none', glow: '#ffffff', radius: 0, intensity: 0, kelvin: 3000 },
  ];

  const state = {
    analysis: null,
    projectId: null,
    currentPage: 0,
    filename: '',
    page: { width: 1000, height: 700 },
    styles: [],
    entities: [],
    texts: [],
    entityMap: new Map(),
    textMap: new Map(),
    deleted: new Set(),
    deletedTexts: new Set(),
    overrides: new Map(),
    textOverrides: new Map(),
    objects: [],
    selection: new Set(),
    tool: 'select',
    activeProduct: 'DL',
    camera: { zoom: 1, panX: 0, panY: 0 },
    draft: null,
    interaction: null,
    snap: true,
    snapPoint: null,
    selectionFilter: 'structural',
    layers: { geometry: true, text: true, fills: true, edits: true, lights: true, effects: true, dimensions: true },
    darkPlan: true,
    lightingSimulation: true,
    simulationMix: 1,
    masterLight: 1,
    scaleCmPerPoint: null,
    history: [],
    historyIndex: -1,
    dirty: false,
    pageLoaded: false,
    spaceDown: false,
    category: 'الكل',
    endpointIndex: new Map(),
    endpointCell: 24,
  };

  function toast(message, error = false) {
    const el = document.createElement('div');
    el.className = `toast${error ? ' error' : ''}`;
    el.textContent = message;
    $('toastStack').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function setDirty(value = true) {
    state.dirty = value;
    $('saveState').textContent = value ? 'تغييرات غير محفوظة' : 'محفوظ محلياً';
    $('saveState').style.color = value ? '#ff8580' : '#7f8996';
  }

  function snapshot() {
    return {
      deleted: [...state.deleted],
      deletedTexts: [...state.deletedTexts],
      overrides: [...state.overrides.entries()],
      textOverrides: [...state.textOverrides.entries()],
      objects: clone(state.objects),
      scaleCmPerPoint: state.scaleCmPerPoint,
    };
  }

  function applySnapshot(snap) {
    state.deleted = new Set(snap.deleted || []);
    state.deletedTexts = new Set(snap.deletedTexts || []);
    state.overrides = new Map(snap.overrides || []);
    state.textOverrides = new Map(snap.textOverrides || []);
    state.objects = clone(snap.objects || []);
    state.scaleCmPerPoint = snap.scaleCmPerPoint || null;
    state.selection.clear();
    updatePanels();
    render();
  }

  function commitHistory(initial = false) {
    const snap = snapshot();
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snap);
    if (state.history.length > 80) state.history.shift();
    state.historyIndex = state.history.length - 1;
    if (!initial) setDirty(true);
    persistLocal();
    updatePanels();
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    applySnapshot(state.history[state.historyIndex]);
    setDirty(true);
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    applySnapshot(state.history[state.historyIndex]);
    setDirty(true);
  }

  function persistLocal() {
    try {
      localStorage.setItem('a2z-vector-cad-edits', JSON.stringify({
        projectTitle: $('projectTitle').value,
        filename: state.filename,
        pageIndex: state.currentPage,
        ...snapshot(),
      }));
    } catch (_) {}
  }

  function saveNow() {
    persistLocal();
    setDirty(false);
    toast('تم حفظ التعديلات محلياً');
  }

  function setTool(tool) {
    state.tool = tool;
    state.draft = null;
    state.snapPoint = null;
    document.querySelectorAll('.tool[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    const cursors = { select: 'default', pan: 'grab', line: 'crosshair', measure: 'crosshair', calibrate: 'crosshair', light: 'copy', distribute: 'crosshair' };
    canvas.style.cursor = cursors[tool] || 'crosshair';
    render();
  }

  function screenPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  function toWorld(p) { return { x: (p.x - state.camera.panX) / state.camera.zoom, y: (p.y - state.camera.panY) / state.camera.zoom }; }
  function toScreen(p) { return { x: p.x * state.camera.zoom + state.camera.panX, y: p.y * state.camera.zoom + state.camera.panY }; }

  function getProduct(id) { return PRODUCTS.find(p => p.id === id) || PRODUCTS[0]; }
  function getEntity(id) { return state.overrides.get(id) || state.entityMap.get(id); }
  function getTextEntity(id) { return state.textOverrides.get(id) || state.textMap.get(id); }
  function getObject(id) { return state.objects.find(o => o.id === id); }


  function parseColor(color) {
    if (!color || color === 'none' || color === 'transparent') return null;
    if (color.startsWith('#')) {
      const raw = color.slice(1);
      const full = raw.length === 3 ? raw.split('').map(x => x + x).join('') : raw.slice(0, 6);
      if (/^[0-9a-fA-F]{6}$/.test(full)) return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
    }
    const m = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
  }

  function rgba(color, alpha) {
    const c = parseColor(color) || { r: 255, g: 216, b: 135 };
    return `rgba(${c.r},${c.g},${c.b},${clamp(alpha, 0, 1)})`;
  }

  function temperatureColor(kelvin, fallback = '#ffd27f') {
    const k = Number(kelvin) || 3000;
    if (k <= 2700) return '#ffb85e';
    if (k <= 3200) return '#ffd27f';
    if (k <= 4300) return '#fff0c7';
    if (k <= 5500) return '#d8ebff';
    if (k > 5500) return '#9fc9ff';
    return fallback;
  }

  function planStroke(color) {
    if (!state.darkPlan) return color || '#111111';
    const c = parseColor(color);
    if (!c) return '#8d98a4';
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    const saturation = max - min;
    const brightness = .299 * c.r + .587 * c.g + .114 * c.b;
    if (saturation > 55 && max > 105) {
      const boost = v => Math.round(v + (255 - v) * .22);
      return `rgb(${boost(c.r)},${boost(c.g)},${boost(c.b)})`;
    }
    if (brightness < 95) return '#8d98a4';
    if (brightness > 235) return '#65717d';
    const v = Math.round(130 + brightness * .28);
    return `rgb(${v},${v + 5},${v + 10})`;
  }

  function planFill(color) {
    if (!state.darkPlan) return color;
    const c = parseColor(color);
    if (!c) return null;
    const brightness = .299 * c.r + .587 * c.g + .114 * c.b;
    if (brightness > 225) return null;
    if (brightness < 55) return '#111820';
    return `rgba(${Math.round(c.r * .25)},${Math.round(c.g * .25)},${Math.round(c.b * .25)},.45)`;
  }

  function createLight(productId, x, y, rotation = 0) {
    const p = getProduct(productId);
    return {
      id: uid(), type: 'light', productId, x, y, rotation, scale: 1,
      intensity: p.intensity ?? .85, spread: 1, temperature: p.kelvin || 3000,
      lightOn: p.effect !== 'none', bornAt: performance.now()
    };
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    render();
  }

  function fitToScreen() {
    if (!state.pageLoaded) return;
    const margin = 35;
    const zoom = Math.min((stage.clientWidth - margin * 2) / state.page.width, (stage.clientHeight - margin * 2) / state.page.height);
    state.camera.zoom = clamp(zoom, 0.04, 12);
    state.camera.panX = (stage.clientWidth - state.page.width * state.camera.zoom) / 2;
    state.camera.panY = (stage.clientHeight - state.page.height * state.camera.zoom) / 2;
    updateZoomLabel();
    render();
  }

  function setZoom(next, sx = stage.clientWidth / 2, sy = stage.clientHeight / 2) {
    const old = state.camera.zoom;
    const wx = (sx - state.camera.panX) / old;
    const wy = (sy - state.camera.panY) / old;
    state.camera.zoom = clamp(next, 0.04, 28);
    state.camera.panX = sx - wx * state.camera.zoom;
    state.camera.panY = sy - wy * state.camera.zoom;
    updateZoomLabel();
    render();
  }
  function updateZoomLabel() { $('zoomValue').textContent = `${Math.round(state.camera.zoom * 100)}%`; }

  function setStyleForEntity(c, e, exportMode = false) {
    const source = state.styles[e.s] || { stroke: '#111111', fill: null, width: .3, strokeAlpha: 1, fillAlpha: 1 };
    const style = { ...source, stroke: planStroke(source.stroke), fill: planFill(source.fill) };
    c.strokeStyle = style.stroke || (state.darkPlan ? '#8d98a4' : '#111111');
    c.fillStyle = style.fill || 'transparent';
    c.globalAlpha = source.strokeAlpha == null ? (state.darkPlan ? .78 : 1) : source.strokeAlpha * (state.darkPlan ? .82 : 1);
    c.lineWidth = exportMode ? Math.max(source.width || .3, .18) : Math.max(source.width || .3, .45 / state.camera.zoom);
    c.lineCap = 'butt';
    c.lineJoin = 'miter';
    c.setLineDash([]);
    return style;
  }

  function pathEntity(c, e) {
    const p = e.p;
    c.beginPath();
    if (e.t === 'line') {
      c.moveTo(p[0], p[1]); c.lineTo(p[2], p[3]);
    } else if (e.t === 'curve') {
      c.moveTo(p[0], p[1]); c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
    } else if (e.t === 'poly') {
      c.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
      if (e.closed) c.closePath();
    }
  }

  function drawBase(c, exportMode = false) {
    if (!state.layers.geometry) return;
    for (const source of state.entities) {
      if (state.deleted.has(source.id)) continue;
      const e = state.overrides.get(source.id) || source;
      const style = setStyleForEntity(c, e, exportMode);
      pathEntity(c, e);
      if (style.fill && state.layers.fills && e.t === 'poly') {
        c.save(); c.globalAlpha = style.fillAlpha == null ? .7 : style.fillAlpha; c.fill(); c.restore();
      }
      if (style.stroke) c.stroke();
    }
  }

  function drawTexts(c) {
    if (!state.layers.text) return;
    c.textBaseline = 'alphabetic';
    for (const source of state.texts) {
      if (state.deletedTexts.has(source.id)) continue;
      const t = state.textOverrides.get(source.id) || source;
      c.save();
      c.translate(t.x, t.y);
      c.rotate((t.angle || 0) * Math.PI / 180);
      c.fillStyle = state.darkPlan ? planStroke(t.color || '#111') : (t.color || '#111');
      c.globalAlpha = 1;
      c.font = `${Math.max(1, t.size || 9)}px "Segoe UI",Arial,sans-serif`;
      c.fillText(t.text, 0, 0);
      c.restore();
    }
  }

  function lightRadius(o) { return 5.5 * (o.scale || 1); }

  function drawGlowDisk(c, color, radius, alpha, sx = 1, sy = 1, offsetX = 0) {
    if (radius <= 0 || alpha <= 0) return;
    c.save();
    c.translate(offsetX, 0);
    c.scale(sx, sy);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(.16, rgba(color, alpha * .72));
    g.addColorStop(.46, rgba(color, alpha * .30));
    g.addColorStop(.78, rgba(color, alpha * .10));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawLightingEffect(c, o) {
    const p = getProduct(o.productId);
    if (!state.lightingSimulation || !state.layers.effects || !o.lightOn || p.effect === 'none') return;
    let strength = clamp((o.intensity ?? p.intensity ?? .8) * state.masterLight * state.simulationMix, 0, 1.8);
    if (o.bornAt) { const age = performance.now() - o.bornAt; const fade = clamp(age / 420, 0, 1); strength *= 1 - Math.pow(1 - fade, 3); if (fade < 1) requestAnimationFrame(render); else delete o.bornAt; }
    if (strength <= .01) return;
    const spread = clamp(o.spread || 1, .35, 3);
    const color = temperatureColor(o.temperature || p.kelvin, p.glow);
    const radius = (p.radius || 36) * spread;
    c.save();
    c.translate(o.x, o.y);
    c.rotate((o.rotation || 0) * Math.PI / 180);
    c.globalCompositeOperation = 'lighter';
    if (p.effect === 'directional') {
      drawGlowDisk(c, color, radius, .44 * strength, 1.65, .68, radius * .42);
      drawGlowDisk(c, color, radius * .42, .58 * strength, 1.15, .68, radius * .10);
    } else if (p.effect === 'linear' || p.effect === 'linearLong') {
      const long = p.effect === 'linearLong' ? 1.85 : 1.35;
      drawGlowDisk(c, color, radius, .34 * strength, long, .58, 0);
      drawGlowDisk(c, color, radius * .52, .44 * strength, long * .95, .38, 0);
    } else if (p.effect === 'strip') {
      drawGlowDisk(c, color, radius, .30 * strength, 2.25, .48, 0);
      c.shadowColor = color; c.shadowBlur = radius * .45; c.strokeStyle = rgba(color, .35 * strength); c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(-radius * 1.55, 0); c.lineTo(radius * 1.55, 0); c.stroke();
    } else {
      drawGlowDisk(c, color, radius, .42 * strength, 1, 1, 0);
      drawGlowDisk(c, color, radius * .38, .62 * strength, 1, 1, 0);
    }
    c.restore();
  }

  function drawLightingEffects(c) {
    if (!state.layers.lights || !state.layers.effects || !state.lightingSimulation) return;
    for (const o of state.objects) if (o.type === 'light') drawLightingEffect(c, o);
  }

  function drawLightSymbol(c, o, selected = false) {
    const p = getProduct(o.productId);
    const r = lightRadius(o);
    c.save();
    c.translate(o.x, o.y);
    c.rotate((o.rotation || 0) * Math.PI / 180);
    c.globalAlpha = 1;
    c.strokeStyle = p.color;
    c.fillStyle = p.color;
    c.lineWidth = Math.max(1.1 / state.camera.zoom, 1.1);
    if (p.shape === 'dot' || p.shape === 'dotLabel') {
      c.beginPath(); c.arc(0, 0, r * .65, 0, Math.PI * 2); c.fill();
      if (p.shape === 'dotLabel') { c.fillStyle = '#178a2d'; c.font = `${r * .85}px Arial`; c.fillText('SLS', r, 2); }
    } else if (p.shape === 'waterproof') {
      c.beginPath(); c.arc(0, -1.5, r * .62, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#111'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-r, r * .8); c.lineTo(r, r * .8); c.stroke();
    } else if (p.shape === 'track' || p.shape === 'trackLong') {
      const len = p.shape === 'trackLong' ? r * 4.8 : r * 3.3;
      c.fillRect(-len / 2, -r * .38, len, r * .76); c.strokeStyle = '#fff'; c.lineWidth = .7; c.strokeRect(-len / 2, -r * .38, len, r * .76);
    } else if (p.shape === 'linear' || p.shape === 'linearLong') {
      const len = p.shape === 'linearLong' ? r * 4.3 : r * 2.5;
      c.fillRect(-len / 2, -r * .34, len, r * .68);
    } else if (p.shape === 'strip') {
      c.lineWidth = r * .35; c.beginPath(); c.moveTo(-r * 2.4, 0); c.lineTo(r * 2.4, 0); c.stroke();
    } else if (p.shape === 'supply') {
      c.fillRect(-r * .65, -r * 1.25, r * 1.3, r * 2.5);
    } else if (p.shape === 'focus') {
      c.beginPath(); c.arc(0, -r * .6, r * .35, 0, Math.PI * 2); c.fill();
      c.lineWidth = 1; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * r * .3, 0); c.lineTo(i * r * .55, r * 1.25); c.stroke(); }
    }
    if (selected) {
      c.strokeStyle = '#3fdcff'; c.lineWidth = 1.5 / state.camera.zoom; c.setLineDash([3 / state.camera.zoom, 2 / state.camera.zoom]);
      c.strokeRect(-r * 2.8, -r * 2.2, r * 5.6, r * 4.4);
    }
    c.restore();
  }

  function drawDimension(c, o, selected = false) {
    const [x1, y1, x2, y2] = o.p;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    c.save();
    c.strokeStyle = '#ef2e2e'; c.fillStyle = '#ef2e2e'; c.lineWidth = Math.max(1 / state.camera.zoom, .65);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    const tick = 4 / state.camera.zoom;
    c.beginPath(); c.moveTo(x1 - nx * tick, y1 - ny * tick); c.lineTo(x1 + nx * tick, y1 + ny * tick); c.moveTo(x2 - nx * tick, y2 - ny * tick); c.lineTo(x2 + nx * tick, y2 + ny * tick); c.stroke();
    const label = dimensionLabel(len);
    c.font = `${9 / state.camera.zoom}px "Segoe UI",Arial`;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(label, (x1 + x2) / 2 + nx * 7 / state.camera.zoom, (y1 + y2) / 2 + ny * 7 / state.camera.zoom);
    if (selected) { c.strokeStyle = '#3fdcff'; c.lineWidth = 1.3 / state.camera.zoom; c.strokeRect(Math.min(x1, x2) - 3 / state.camera.zoom, Math.min(y1, y2) - 3 / state.camera.zoom, Math.abs(dx) + 6 / state.camera.zoom, Math.abs(dy) + 6 / state.camera.zoom); }
    c.restore();
  }

  function drawObjects(c, exportMode = false) {
    for (const o of state.objects) {
      const selected = !exportMode && state.selection.has(`o:${o.id}`);
      if (o.type === 'line' && state.layers.edits) {
        c.save(); c.strokeStyle = o.color || '#20c8ec'; c.lineWidth = Math.max(o.width || 1, .7 / state.camera.zoom); c.beginPath(); c.moveTo(o.p[0], o.p[1]); c.lineTo(o.p[2], o.p[3]); c.stroke();
        if (selected) { c.strokeStyle = '#3fdcff'; c.lineWidth = 2 / state.camera.zoom; c.stroke(); }
        c.restore();
      } else if (o.type === 'light' && state.layers.lights) drawLightSymbol(c, o, selected);
      else if (o.type === 'dimension' && state.layers.dimensions) drawDimension(c, o, selected);
    }
  }

  function drawSelection(c) {
    const keys = [...state.selection];
    if (!keys.length) return;
    c.save(); c.strokeStyle = '#3fdcff'; c.fillStyle = '#3fdcff'; c.globalAlpha = 1; c.lineWidth = 2 / state.camera.zoom; c.setLineDash([5 / state.camera.zoom, 3 / state.camera.zoom]);
    for (const key of keys) {
      if (key.startsWith('b:')) {
        const e = getEntity(key.slice(2)); if (!e) continue; pathEntity(c, e); c.stroke();
      } else if (key.startsWith('t:')) {
        const t = getTextEntity(key.slice(2)); if (!t) continue; const b = t.bbox; c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      }
    }
    c.setLineDash([]);
    if (keys.length === 1) {
      const geom = selectedLineGeometry(keys[0]);
      if (geom) {
        const radius = 4.5 / state.camera.zoom;
        for (const p of [{ x: geom.p[0], y: geom.p[1] }, { x: geom.p[2], y: geom.p[3] }]) {
          c.beginPath(); c.arc(p.x, p.y, radius, 0, Math.PI * 2); c.fillStyle = '#0f151a'; c.fill(); c.strokeStyle = '#3fdcff'; c.lineWidth = 1.5 / state.camera.zoom; c.stroke();
        }
      }
    }
    c.restore();
  }

  function drawDraft(c) {
    if (!state.draft) return;
    const d = state.draft;
    if (['line', 'measure', 'calibrate', 'distribute'].includes(d.type) && d.end) {
      c.save(); c.strokeStyle = d.type === 'measure' ? '#ef2e2e' : '#3fdcff'; c.lineWidth = 1.5 / state.camera.zoom; c.setLineDash([6 / state.camera.zoom, 4 / state.camera.zoom]); c.beginPath(); c.moveTo(d.start.x, d.start.y); c.lineTo(d.end.x, d.end.y); c.stroke(); c.restore();
    }
    if (d.type === 'box' && d.end) {
      const x = Math.min(d.start.x, d.end.x), y = Math.min(d.start.y, d.end.y), w = Math.abs(d.end.x - d.start.x), h = Math.abs(d.end.y - d.start.y);
      c.save(); c.fillStyle = 'rgba(63,216,255,.12)'; c.strokeStyle = '#3fdcff'; c.lineWidth = 1 / state.camera.zoom; c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h); c.restore();
    }
    if (state.snapPoint) { c.save(); c.strokeStyle = '#ffcf4a'; c.lineWidth = 1.2 / state.camera.zoom; const r = 5 / state.camera.zoom; c.strokeRect(state.snapPoint.x - r, state.snapPoint.y - r, r * 2, r * 2); c.restore(); }
  }

  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth, h = stage.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#11151a'; ctx.fillRect(0, 0, w, h);
    // Screen grid
    ctx.strokeStyle = '#1d232a'; ctx.lineWidth = 1;
    const gap = 24;
    for (let x = ((state.camera.panX % gap) + gap) % gap; x < w; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = ((state.camera.panY % gap) + gap) % gap; y < h; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (!state.pageLoaded) return;
    ctx.save();
    ctx.translate(state.camera.panX, state.camera.panY); ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = 24 / state.camera.zoom; ctx.shadowOffsetY = 8 / state.camera.zoom; ctx.fillStyle = state.darkPlan ? '#06090d' : '#ffffff'; ctx.fillRect(0, 0, state.page.width, state.page.height); ctx.shadowColor = 'transparent';
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, state.page.width, state.page.height); ctx.clip();
    drawBase(ctx); drawTexts(ctx); drawLightingEffects(ctx); drawObjects(ctx); drawSelection(ctx); drawDraft(ctx);
    ctx.restore();
    ctx.strokeStyle = state.darkPlan ? '#36414c' : '#a9b1ba'; ctx.lineWidth = 1 / state.camera.zoom; ctx.strokeRect(0, 0, state.page.width, state.page.height);
    ctx.restore();
  }

  function dimensionLabel(pointLength) {
    if (!state.scaleCmPerPoint) return `${pointLength.toFixed(1)} pt`;
    const cm = pointLength * state.scaleCmPerPoint;
    return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(1)} cm`;
  }

  function bboxIntersects(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
  function pointInBox(p, b, margin = 0) { return p.x >= b[0] - margin && p.x <= b[2] + margin && p.y >= b[1] - margin && p.y <= b[3] + margin; }
  function distanceToSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2; return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }
  function cubicPoint(p, t) {
    const mt = 1 - t;
    return { x: mt ** 3 * p[0] + 3 * mt ** 2 * t * p[2] + 3 * mt * t ** 2 * p[4] + t ** 3 * p[6], y: mt ** 3 * p[1] + 3 * mt ** 2 * t * p[3] + 3 * mt * t ** 2 * p[5] + t ** 3 * p[7] };
  }
  function distanceToEntity(p, e) {
    if (e.t === 'line') return distanceToSegment(p, { x: e.p[0], y: e.p[1] }, { x: e.p[2], y: e.p[3] });
    if (e.t === 'curve') { let min = Infinity, prev = cubicPoint(e.p, 0); for (let i = 1; i <= 14; i++) { const next = cubicPoint(e.p, i / 14); min = Math.min(min, distanceToSegment(p, prev, next)); prev = next; } return min; }
    if (e.t === 'poly') { let min = Infinity; const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push({ x: e.p[i], y: e.p[i + 1] }); for (let i = 0; i < pts.length - 1; i++) min = Math.min(min, distanceToSegment(p, pts[i], pts[i + 1])); if (e.closed) min = Math.min(min, distanceToSegment(p, pts[pts.length - 1], pts[0])); return min; }
    return Infinity;
  }
  function structuralEntity(e) {
    if (state.selectionFilter === 'all') return true;
    if (e.t === 'line') return (e.len || Math.hypot(e.p[2] - e.p[0], e.p[3] - e.p[1])) >= 4;
    const b = e.bbox; return Math.hypot(b[2] - b[0], b[3] - b[1]) >= 7;
  }

  function hitTest(world) {
    const tol = 8 / state.camera.zoom;
    // Custom objects first.
    for (let i = state.objects.length - 1; i >= 0; i--) {
      const o = state.objects[i];
      if (o.type === 'light' && state.layers.lights && Math.hypot(world.x - o.x, world.y - o.y) <= lightRadius(o) * 3 + tol) return `o:${o.id}`;
      if (o.type === 'line' && state.layers.edits && distanceToSegment(world, { x: o.p[0], y: o.p[1] }, { x: o.p[2], y: o.p[3] }) <= tol) return `o:${o.id}`;
      if (o.type === 'dimension' && state.layers.dimensions && distanceToSegment(world, { x: o.p[0], y: o.p[1] }, { x: o.p[2], y: o.p[3] }) <= tol) return `o:${o.id}`;
    }
    if (state.layers.geometry) {
      for (let i = state.entities.length - 1; i >= 0; i--) {
        const source = state.entities[i]; if (state.deleted.has(source.id)) continue;
        const e = state.overrides.get(source.id) || source;
        if (!structuralEntity(e) || !pointInBox(world, e.bbox, tol)) continue;
        if (distanceToEntity(world, e) <= tol) return `b:${e.id}`;
      }
    }
    if (state.layers.text && state.selectionFilter === 'all') {
      for (let i = state.texts.length - 1; i >= 0; i--) {
        const source = state.texts[i]; if (state.deletedTexts.has(source.id)) continue;
        const t = state.textOverrides.get(source.id) || source;
        if (pointInBox(world, t.bbox, tol)) return `t:${t.id}`;
      }
    }
    return null;
  }

  function selectedLineGeometry(key) {
    if (key.startsWith('b:')) { const e = getEntity(key.slice(2)); return e && e.t === 'line' ? e : null; }
    if (key.startsWith('o:')) { const o = getObject(key.slice(2)); return o && o.type === 'line' ? o : null; }
    return null;
  }

  function endpointHandleAt(world) {
    if (state.selection.size !== 1) return null;
    const key = [...state.selection][0]; const e = selectedLineGeometry(key); if (!e) return null;
    const tol = 9 / state.camera.zoom;
    if (Math.hypot(world.x - e.p[0], world.y - e.p[1]) <= tol) return { key, index: 0 };
    if (Math.hypot(world.x - e.p[2], world.y - e.p[3]) <= tol) return { key, index: 1 };
    return null;
  }

  function rebuildEndpointIndex() {
    state.endpointIndex = new Map();
    const cell = state.endpointCell;
    const add = (x, y) => {
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      if (!state.endpointIndex.has(key)) state.endpointIndex.set(key, []);
      state.endpointIndex.get(key).push({ x, y });
    };
    for (const e of state.entities) {
      if (e.t !== 'line' || (e.len || 0) < 3) continue;
      add(e.p[0], e.p[1]); add(e.p[2], e.p[3]);
    }
  }

  function findSnap(world) {
    if (!state.snap || !state.pageLoaded) return world;
    const tol = 9 / state.camera.zoom;
    let best = null, bestDist = tol;
    const cell = state.endpointCell;
    const cx = Math.floor(world.x / cell), cy = Math.floor(world.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const points = state.endpointIndex.get(`${gx},${gy}`) || [];
      for (const p of points) { const d = Math.hypot(world.x - p.x, world.y - p.y); if (d < bestDist) { bestDist = d; best = p; } }
    }
    for (const o of state.objects) {
      if (!o.p) continue;
      for (const p of [{ x: o.p[0], y: o.p[1] }, { x: o.p[2], y: o.p[3] }]) { const d = Math.hypot(world.x - p.x, world.y - p.y); if (d < bestDist) { bestDist = d; best = p; } }
    }
    if (best) { state.snapPoint = best; return { ...best }; }
    const grid = 5;
    const gridPoint = { x: Math.round(world.x / grid) * grid, y: Math.round(world.y / grid) * grid };
    state.snapPoint = gridPoint;
    return gridPoint;
  }

  function translateGeometry(e, dx, dy) {
    const out = clone(e); out.p = out.p.map((n, i) => n + (i % 2 === 0 ? dx : dy)); out.bbox = [e.bbox[0] + dx, e.bbox[1] + dy, e.bbox[2] + dx, e.bbox[3] + dy]; return out;
  }

  function updateLineEndpoint(key, index, point) {
    if (key.startsWith('b:')) {
      const id = key.slice(2); const e = clone(getEntity(id)); const offset = index * 2; e.p[offset] = point.x; e.p[offset + 1] = point.y; e.bbox = [Math.min(e.p[0], e.p[2]), Math.min(e.p[1], e.p[3]), Math.max(e.p[0], e.p[2]), Math.max(e.p[1], e.p[3])]; e.len = Math.hypot(e.p[2] - e.p[0], e.p[3] - e.p[1]); state.overrides.set(id, e);
    } else {
      const o = getObject(key.slice(2)); const offset = index * 2; o.p[offset] = point.x; o.p[offset + 1] = point.y;
    }
  }

  function selectBox(box, additive = false) {
    if (!additive) state.selection.clear();
    if (state.layers.geometry) {
      for (const source of state.entities) {
        if (state.deleted.has(source.id)) continue; const e = state.overrides.get(source.id) || source;
        if (structuralEntity(e) && bboxIntersects(e.bbox, box)) state.selection.add(`b:${e.id}`);
      }
    }
    if (state.layers.text && state.selectionFilter === 'all') for (const source of state.texts) { if (!state.deletedTexts.has(source.id)) { const t = state.textOverrides.get(source.id) || source; if (bboxIntersects(t.bbox, box)) state.selection.add(`t:${t.id}`); } }
    for (const o of state.objects) {
      let b;
      if (o.p) b = [Math.min(o.p[0], o.p[2]), Math.min(o.p[1], o.p[3]), Math.max(o.p[0], o.p[2]), Math.max(o.p[1], o.p[3])];
      else b = [o.x - lightRadius(o) * 3, o.y - lightRadius(o) * 3, o.x + lightRadius(o) * 3, o.y + lightRadius(o) * 3];
      if (bboxIntersects(b, box)) state.selection.add(`o:${o.id}`);
    }
    updatePanels();
  }

  function deleteSelection() {
    if (!state.selection.size) return toast('حدد خطاً أو مجموعة عناصر أولاً', true);
    for (const key of state.selection) {
      if (key.startsWith('b:')) state.deleted.add(key.slice(2));
      else if (key.startsWith('t:')) state.deletedTexts.add(key.slice(2));
      else if (key.startsWith('o:')) state.objects = state.objects.filter(o => o.id !== key.slice(2));
    }
    const count = state.selection.size; state.selection.clear(); commitHistory(); render(); toast(`تم حذف ${count} عنصر هندسي`);
  }

  function duplicateSelection() {
    if (state.selection.size !== 1) return;
    const key = [...state.selection][0]; let created = null;
    if (key.startsWith('o:')) { const o = clone(getObject(key.slice(2))); o.id = uid(); if (o.p) o.p = o.p.map((n, i) => n + (i % 2 === 0 ? 8 : 8)); else { o.x += 8; o.y += 8; } created = o; }
    else if (key.startsWith('b:')) { const e = getEntity(key.slice(2)); if (e.t === 'line') created = { id: uid(), type: 'line', p: [e.p[0] + 8, e.p[1] + 8, e.p[2] + 8, e.p[3] + 8], color: state.styles[e.s]?.stroke || '#111', width: state.styles[e.s]?.width || .5 }; }
    if (created) { state.objects.push(created); state.selection = new Set([`o:${created.id}`]); commitHistory(); render(); }
  }

  function finalizeDraft() {
    const d = state.draft; if (!d || !d.end) return;
    const dist = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
    if (dist < 1 / state.camera.zoom) { state.draft = null; render(); return; }
    if (d.type === 'line') {
      const o = { id: uid(), type: 'line', p: [d.start.x, d.start.y, d.end.x, d.end.y], color: '#17c7ef', width: .8 };
      state.objects.push(o); state.selection = new Set([`o:${o.id}`]); commitHistory();
    } else if (d.type === 'measure') {
      const o = { id: uid(), type: 'dimension', p: [d.start.x, d.start.y, d.end.x, d.end.y] }; state.objects.push(o); state.selection = new Set([`o:${o.id}`]); commitHistory();
    } else if (d.type === 'calibrate') {
      const input = prompt('أدخل الطول الحقيقي بالسنتيمتر:', '400'); const cm = Number(input); if (cm > 0) { state.scaleCmPerPoint = cm / dist; commitHistory(); toast(`تمت المعايرة: ${cm} سم`); }
    } else if (d.type === 'distribute') {
      const count = clamp(Number($('distributionCount').value) || 6, 2, 50); const productId = state.activeProduct;
      for (let i = 0; i < count; i++) { const t = count === 1 ? .5 : i / (count - 1); state.objects.push(createLight(productId, d.start.x + (d.end.x - d.start.x) * t, d.start.y + (d.end.y - d.start.y) * t)); }
      commitHistory(); toast(`تم توزيع ${count} وحدات بالتساوي`);
    }
    state.draft = null; state.snapPoint = null; updatePanels(); render();
  }

  function canvasPointerDown(evt) {
    if (!state.pageLoaded) return;
    canvas.setPointerCapture(evt.pointerId);
    const screen = screenPoint(evt), raw = toWorld(screen);
    if (evt.button === 1 || state.spaceDown || state.tool === 'pan') { state.interaction = { type: 'pan', screen, panX: state.camera.panX, panY: state.camera.panY }; canvas.style.cursor = 'grabbing'; return; }
    const world = ['line', 'measure', 'calibrate', 'distribute'].includes(state.tool) ? findSnap(raw) : raw;
    if (state.tool === 'light') {
      const o = createLight(state.activeProduct, world.x, world.y);
      state.objects.push(o); state.selection = new Set([`o:${o.id}`]); commitHistory(); render(); return;
    }
    if (['line', 'measure', 'calibrate', 'distribute'].includes(state.tool)) { state.draft = { type: state.tool, start: world, end: world }; state.interaction = { type: 'draft' }; render(); return; }
    if (state.tool !== 'select') return;
    const handle = endpointHandleAt(raw);
    if (handle) { state.interaction = { type: 'endpoint', ...handle, before: snapshot() }; return; }
    const hit = hitTest(raw);
    if (hit) {
      if (evt.shiftKey || evt.ctrlKey) { if (state.selection.has(hit)) state.selection.delete(hit); else state.selection.add(hit); }
      else if (!state.selection.has(hit)) state.selection = new Set([hit]);
      state.interaction = { type: 'drag', key: hit, start: raw, before: snapshot(), original: getMovableCopy(hit) };
      updatePanels(); render();
    } else {
      if (!evt.shiftKey && !evt.ctrlKey) state.selection.clear();
      state.draft = { type: 'box', start: raw, end: raw, additive: evt.shiftKey || evt.ctrlKey };
      state.interaction = { type: 'box' }; updatePanels(); render();
    }
  }

  function getMovableCopy(key) {
    if (key.startsWith('b:')) return clone(getEntity(key.slice(2)));
    if (key.startsWith('t:')) return clone(getTextEntity(key.slice(2)));
    if (key.startsWith('o:')) return clone(getObject(key.slice(2)));
    return null;
  }

  function canvasPointerMove(evt) {
    if (!state.pageLoaded) return;
    const screen = screenPoint(evt), raw = toWorld(screen);
    $('cursorStatus').textContent = `X: ${raw.x.toFixed(2)}   Y: ${raw.y.toFixed(2)}`;
    if (!state.interaction) { if (['line', 'measure', 'calibrate', 'distribute'].includes(state.tool)) { findSnap(raw); render(); } return; }
    const it = state.interaction;
    if (it.type === 'pan') { state.camera.panX = it.panX + screen.x - it.screen.x; state.camera.panY = it.panY + screen.y - it.screen.y; render(); return; }
    if (it.type === 'draft') { state.draft.end = findSnap(raw); render(); return; }
    if (it.type === 'box') { state.draft.end = raw; render(); return; }
    if (it.type === 'endpoint') { updateLineEndpoint(it.key, it.index, findSnap(raw)); updatePanels(); render(); return; }
    if (it.type === 'drag') {
      const dx = raw.x - it.start.x, dy = raw.y - it.start.y, key = it.key;
      if (key.startsWith('b:')) { const moved = translateGeometry(it.original, dx, dy); state.overrides.set(key.slice(2), moved); }
      else if (key.startsWith('t:')) { const t = clone(it.original); t.x += dx; t.y += dy; t.bbox = [t.bbox[0] + dx, t.bbox[1] + dy, t.bbox[2] + dx, t.bbox[3] + dy]; state.textOverrides.set(key.slice(2), t); }
      else if (key.startsWith('o:')) { const current = getObject(key.slice(2)); if (it.original.p) current.p = it.original.p.map((n, i) => n + (i % 2 === 0 ? dx : dy)); else { current.x = it.original.x + dx; current.y = it.original.y + dy; } }
      updateProperties(); render();
    }
  }

  function canvasPointerUp(evt) {
    if (!state.interaction) return;
    const it = state.interaction; state.interaction = null; canvas.style.cursor = state.tool === 'pan' ? 'grab' : (state.tool === 'select' ? 'default' : 'crosshair');
    if (it.type === 'draft') finalizeDraft();
    else if (it.type === 'box') { const d = state.draft; if (d && d.end) { const b = [Math.min(d.start.x, d.end.x), Math.min(d.start.y, d.end.y), Math.max(d.start.x, d.end.x), Math.max(d.start.y, d.end.y)]; selectBox(b, d.additive); } state.draft = null; render(); }
    else if (it.type === 'endpoint' || it.type === 'drag') { commitHistory(); state.snapPoint = null; render(); }
  }

  function wheelZoom(evt) { if (!state.pageLoaded) return; evt.preventDefault(); const p = screenPoint(evt); setZoom(state.camera.zoom * (evt.deltaY < 0 ? 1.12 : .89), p.x, p.y); }

  function updateSelectionHud() {
    const count = state.selection.size; $('selectionHud').classList.toggle('hidden', !count); $('selectionCount').textContent = count;
    $('selectionStatus').textContent = count ? `${count} عنصر محدد` : 'لا يوجد تحديد';
  }

  function updateProperties() {
    const keys = [...state.selection]; updateSelectionHud();
    if (keys.length !== 1) { $('noSelection').classList.remove('hidden'); $('propertiesForm').classList.add('hidden'); return; }
    $('noSelection').classList.add('hidden'); $('propertiesForm').classList.remove('hidden');
    const key = keys[0]; let x = 0, y = 0, type = '', id = key.slice(2), color = '#3fdcff', rotation = 0, scale = 1, showTransform = false, selectedLight = null;
    if (key.startsWith('b:')) { const e = getEntity(id); type = e.t === 'line' ? 'PDF Line' : e.t === 'curve' ? 'PDF Bézier' : 'PDF Polyline'; x = (e.bbox[0] + e.bbox[2]) / 2; y = (e.bbox[1] + e.bbox[3]) / 2; color = state.styles[e.s]?.stroke || '#111'; }
    else if (key.startsWith('t:')) { const t = getTextEntity(id); type = 'PDF Text'; x = t.x; y = t.y; color = t.color; }
    else { const o = getObject(id); if (!o) return; if (o.type === 'light') { selectedLight = o; type = getProduct(o.productId).name; x = o.x; y = o.y; rotation = o.rotation || 0; scale = o.scale || 1; color = getProduct(o.productId).color; showTransform = true; } else { type = o.type === 'line' ? 'User Line' : 'Dimension'; x = o.p ? (o.p[0] + o.p[2]) / 2 : 0; y = o.p ? (o.p[1] + o.p[3]) / 2 : 0; color = o.color || '#ef2e2e'; } }
    $('propertyType').textContent = type; $('propertyId').textContent = id; $('propertyColor').style.background = color; $('propX').value = x.toFixed(2); $('propY').value = y.toFixed(2); $('propRotation').value = rotation; $('propScale').value = scale; $('propRotationRow').classList.toggle('hidden', !showTransform); $('propScaleRow').classList.toggle('hidden', !showTransform); $('lightEffectFields').classList.toggle('hidden', !selectedLight); if (selectedLight) { const p = getProduct(selectedLight.productId); $('propIntensity').value = selectedLight.intensity ?? p.intensity ?? .8; $('propSpread').value = selectedLight.spread || 1; $('propTemperature').value = String(selectedLight.temperature || p.kelvin || 3000); $('propLightOn').checked = selectedLight.lightOn !== false; $('effectStateLabel').textContent = selectedLight.lightOn === false ? 'متوقف' : 'مُشغّل'; }
  }

  function quantities() {
    const map = new Map();
    for (const o of state.objects) if (o.type === 'light') map.set(o.productId, (map.get(o.productId) || 0) + 1);
    return map;
  }

  function updateBoq() {
    const map = quantities(); let total = 0; const rows = [];
    for (const [id, count] of map) { total += count; const p = getProduct(id); rows.push(`<tr><td>${p.code}</td><td>${p.ar}</td><td>${count}</td></tr>`); }
    $('totalLights').textContent = total; $('usedTypes').textContent = map.size; $('boqBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3" class="empty-row">لم تتم إضافة إنارة بعد</td></tr>';
  }

  function updatePanels() {
    updateProperties(); updateBoq();
    $('scaleStatus').textContent = state.scaleCmPerPoint ? `المقياس: ${state.scaleCmPerPoint.toFixed(4)} سم/نقطة` : 'المقياس: غير معاير';
    if (state.pageLoaded) {
      $('geometryCount').textContent = `${state.entities.length - state.deleted.size} عنصر`;
      $('textCount').textContent = `${state.texts.length - state.deletedTexts.size} نص`;
      const stats = state.vectorStats || {};
      $('statLines').textContent = stats.lines || 0; $('statCurves').textContent = stats.curves || 0; $('statPolys').textContent = stats.polygons || 0; $('statTexts').textContent = stats.texts || 0;
    }
  }

  function renderProducts() {
    const categories = ['الكل', ...new Set(PRODUCTS.map(p => p.category))];
    $('categoryChips').innerHTML = categories.map(c => `<button class="${c === state.category ? 'active' : ''}" data-category="${c}">${c}</button>`).join('');
    const q = $('productSearch').value.trim().toLowerCase();
    const list = PRODUCTS.filter(p => (state.category === 'الكل' || p.category === state.category) && (!q || `${p.name} ${p.ar} ${p.code}`.toLowerCase().includes(q)));
    $('productGrid').innerHTML = list.map(p => `<div class="product-card ${p.id === state.activeProduct ? 'selected' : ''}" data-product="${p.id}"><span class="product-code">${p.code}</span><div class="product-symbol">${productSvg(p)}</div><strong>${p.ar}</strong><small>${p.name}</small><span class="effect-preview" style="--glow:${p.glow};opacity:${p.effect === 'none' ? .18 : 1}"></span></div>`).join('');
    $('productCount').textContent = PRODUCTS.length;
  }

  function productSvg(p) {
    if (p.shape === 'dot' || p.shape === 'dotLabel') return `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="7" fill="${p.color}"/>${p.shape === 'dotLabel' ? '<text x="39" y="34" font-size="8" fill="#36ce4e">SLS</text>' : ''}</svg>`;
    if (p.shape === 'waterproof') return `<svg viewBox="0 0 60 60"><circle cx="30" cy="25" r="7" fill="${p.color}"/><path d="M18 39h24" stroke="#ddd" stroke-width="3"/></svg>`;
    if (p.shape.startsWith('track')) return `<svg viewBox="0 0 60 60"><rect x="${p.shape === 'trackLong' ? 7 : 13}" y="25" width="${p.shape === 'trackLong' ? 46 : 34}" height="10" rx="2" fill="${p.color}"/></svg>`;
    if (p.shape.startsWith('linear')) return `<svg viewBox="0 0 60 60"><rect x="${p.shape === 'linearLong' ? 8 : 17}" y="25" width="${p.shape === 'linearLong' ? 44 : 26}" height="10" fill="${p.color}"/></svg>`;
    if (p.shape === 'strip') return `<svg viewBox="0 0 60 60"><path d="M10 30h40" stroke="${p.color}" stroke-width="5"/></svg>`;
    if (p.shape === 'supply') return `<svg viewBox="0 0 60 60"><rect x="23" y="12" width="14" height="36" fill="${p.color}"/></svg>`;
    return `<svg viewBox="0 0 60 60"><circle cx="30" cy="20" r="5" fill="${p.color}"/><path d="M18 45l7-18m5 18V27m12 18l-7-18" stroke="#ddd" stroke-width="2"/></svg>`;
  }

  function showLoading(title, detail) { $('loadingTitle').textContent = title; $('loadingDetail').textContent = detail; $('loadingOverlay').classList.remove('hidden'); }
  function hideLoading() { $('loadingOverlay').classList.add('hidden'); }

  async function analyzeFile(file) {
    if (!file) return;
    $('welcomeModal').classList.add('hidden'); showLoading('جارٍ قراءة ملف PDF...', 'فحص الصفحات والهندسة المتجهية');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/analyze', { method: 'POST', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'فشل رفع الملف');
      state.analysis = data; state.projectId = data.project_id; state.filename = data.filename; $('analysisBtn').disabled = false; showAnalysis();
    } catch (e) { toast(e.message, true); $('welcomeModal').classList.remove('hidden'); }
    finally { hideLoading(); }
  }

  async function loadSample() {
    $('welcomeModal').classList.add('hidden'); showLoading('جارٍ فتح المخطط النموذجي...', 'استخراج هندسة الصفحة الأصلية');
    try { const r = await fetch('/api/sample'); const data = await r.json(); state.analysis = data; state.projectId = data.project_id; state.filename = data.filename; $('analysisBtn').disabled = false; await openVectorPage(0); }
    catch (e) { toast('تعذر فتح النموذج: ' + e.message, true); $('welcomeModal').classList.remove('hidden'); }
    finally { hideLoading(); }
  }

  function showAnalysis() {
    const data = state.analysis; if (!data) return;
    $('analysisSubtitle').textContent = `${data.filename} - ${data.page_count} صفحة`;
    const totalVectors = data.pages.reduce((s, p) => s + p.vector_entities, 0); const totalTexts = data.pages.reduce((s, p) => s + p.text_spans, 0);
    $('analysisOverview').innerHTML = `<div><strong>${data.page_count}</strong><span>صفحات</span></div><div><strong>${totalVectors.toLocaleString()}</strong><span>عناصر متجهية</span></div><div><strong>${totalTexts.toLocaleString()}</strong><span>كتل نصية</span></div><div><strong>${data.size_mb}</strong><span>MB</span></div>`;
    $('pagesGrid').innerHTML = data.pages.map(p => `<div class="page-card"><img src="${p.thumbnail}" loading="lazy"/><h4>الصفحة ${p.number}</h4><div class="page-meta"><span>${p.vector_entities.toLocaleString()} Vector</span><span>${p.lines.toLocaleString()} Lines</span><span>${p.text_spans} Text</span>${p.scale ? `<span>Scale ${p.scale}</span>` : ''}</div><button data-import-page="${p.index}">${p.vector_entities ? 'استيراد كعناصر هندسية' : 'فتح كمرجع'}</button></div>`).join('');
    $('analysisModal').classList.remove('hidden');
  }

  async function openVectorPage(index) {
    $('analysisModal').classList.add('hidden'); showLoading('تحويل PDF إلى عناصر قابلة للتحرير...', 'استخراج خطوط، منحنيات، أشكال ونصوص منفصلة');
    try {
      const response = await fetch(`/api/project/${state.projectId}/vectors/${index}`); const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'فشل استيراد الصفحة');
      state.currentPage = index; state.page = { width: data.width, height: data.height }; state.styles = data.styles; state.entities = data.entities; state.texts = data.texts; state.entityMap = new Map(data.entities.map(e => [e.id, e])); rebuildEndpointIndex(); state.textMap = new Map(data.texts.map(t => [t.id, t])); state.deleted.clear(); state.deletedTexts.clear(); state.overrides.clear(); state.textOverrides.clear(); state.objects = []; state.selection.clear(); state.vectorStats = data.stats; state.pageLoaded = true; state.history = []; state.historyIndex = -1; state.scaleCmPerPoint = null;
      $('emptyCanvas').classList.add('hidden'); $('filePill').textContent = `${state.filename} - صفحة ${index + 1}`; $('vectorPill').textContent = `${data.stats.entities.toLocaleString()} عنصر هندسي`; $('sourceBadge').className = 'status-badge vector'; $('sourceBadge').textContent = 'PDF Vector مستورد'; $('engineStatus').textContent = `تم استيراد ${data.stats.lines.toLocaleString()} خط فعلي`;
      commitHistory(true); setDirty(false); updatePanels(); fitToScreen(); toast(`تم استيراد ${data.stats.entities.toLocaleString()} عنصر كـ Vector حقيقي`);
    } catch (e) { toast(e.message, true); }
    finally { hideLoading(); }
  }

  function selectedCenter() {
    if (state.selection.size !== 1) return null; const key = [...state.selection][0];
    if (key.startsWith('b:')) { const e = getEntity(key.slice(2)); return { x: (e.bbox[0] + e.bbox[2]) / 2, y: (e.bbox[1] + e.bbox[3]) / 2 }; }
    if (key.startsWith('t:')) { const t = getTextEntity(key.slice(2)); return { x: t.x, y: t.y }; }
    const o = getObject(key.slice(2)); if (!o) return null; return o.p ? { x: (o.p[0] + o.p[2]) / 2, y: (o.p[1] + o.p[3]) / 2 } : { x: o.x, y: o.y };
  }

  function moveSelectedCenter(nx, ny) {
    if (state.selection.size !== 1) return; const key = [...state.selection][0], center = selectedCenter(); if (!center) return; const dx = nx - center.x, dy = ny - center.y;
    if (key.startsWith('b:')) { const id = key.slice(2); state.overrides.set(id, translateGeometry(getEntity(id), dx, dy)); }
    else if (key.startsWith('t:')) { const id = key.slice(2), t = clone(getTextEntity(id)); t.x += dx; t.y += dy; t.bbox = [t.bbox[0] + dx, t.bbox[1] + dy, t.bbox[2] + dx, t.bbox[3] + dy]; state.textOverrides.set(id, t); }
    else { const o = getObject(key.slice(2)); if (o.p) o.p = o.p.map((n, i) => n + (i % 2 === 0 ? dx : dy)); else { o.x += dx; o.y += dy; } }
    commitHistory(); render();
  }

  function csvExport() {
    const rows = [['Code', 'Product', 'Quantity']]; for (const [id, count] of quantities()) { const p = getProduct(id); rows.push([p.code, p.name, count]); }
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n'); downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'A2Z-Lighting-BOQ.csv');
  }

  function svgEscape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
  function styleSvg(e) { const s = state.styles[e.s] || {}; const stroke = planStroke(s.stroke || '#111'); const fill = state.layers.fills ? planFill(s.fill) : null; return `stroke="${stroke}" stroke-width="${Math.max(s.width || .3, .18)}" stroke-opacity="${(s.strokeAlpha ?? 1) * (state.darkPlan ? .82 : 1)}" fill="${fill || 'none'}" fill-opacity="${s.fillAlpha ?? 1}"`; }
  function entitySvg(e) { if (e.t === 'line') return `<line x1="${e.p[0]}" y1="${e.p[1]}" x2="${e.p[2]}" y2="${e.p[3]}" ${styleSvg(e)}/>`; if (e.t === 'curve') return `<path d="M${e.p[0]} ${e.p[1]} C${e.p[2]} ${e.p[3]} ${e.p[4]} ${e.p[5]} ${e.p[6]} ${e.p[7]}" ${styleSvg(e)}/>`; const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push(`${e.p[i]},${e.p[i + 1]}`); return `<polygon points="${pts.join(' ')}" ${styleSvg(e)}/>`; }
  function lightEffectSvg(o) {
    const p = getProduct(o.productId);
    if (!state.lightingSimulation || !state.layers.effects || !o.lightOn || p.effect === 'none') return '';
    const strength = clamp((o.intensity ?? p.intensity ?? .8) * state.masterLight, 0, 1.8);
    const color = temperatureColor(o.temperature || p.kelvin, p.glow);
    const radius = (p.radius || 36) * clamp(o.spread || 1, .35, 3);
    const id = `glow-${svgEscape(o.id)}`;
    let shape = `<circle r="${radius}" fill="url(#${id})"/>`;
    let transform = `translate(${o.x} ${o.y}) rotate(${o.rotation || 0})`;
    if (p.effect === 'directional') shape = `<ellipse cx="${radius * .42}" rx="${radius * 1.65}" ry="${radius * .68}" fill="url(#${id})"/>`;
    else if (p.effect === 'linear' || p.effect === 'linearLong') shape = `<ellipse rx="${radius * (p.effect === 'linearLong' ? 1.85 : 1.35)}" ry="${radius * .58}" fill="url(#${id})"/>`;
    else if (p.effect === 'strip') shape = `<ellipse rx="${radius * 2.25}" ry="${radius * .48}" fill="url(#${id})"/>`;
    return `<g transform="${transform}" style="mix-blend-mode:screen"><defs><radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${.62 * strength}"/><stop offset=".22" stop-color="${color}" stop-opacity="${.38 * strength}"/><stop offset=".58" stop-color="${color}" stop-opacity="${.13 * strength}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>${shape}</g>`;
  }

  function lightSvg(o) { const p = getProduct(o.productId), r = lightRadius(o), tr = `translate(${o.x} ${o.y}) rotate(${o.rotation || 0})`; if (p.shape === 'dot' || p.shape === 'dotLabel') return `<g transform="${tr}"><circle r="${r * .65}" fill="${p.color}"/>${p.shape === 'dotLabel' ? `<text x="${r}" y="2" font-size="${r * .85}" fill="#178a2d">SLS</text>` : ''}</g>`; if (p.shape === 'waterproof') return `<g transform="${tr}"><circle cy="-1.5" r="${r * .62}" fill="${p.color}"/><line x1="${-r}" y1="${r * .8}" x2="${r}" y2="${r * .8}" stroke="#111" stroke-width="1.5"/></g>`; if (p.shape.startsWith('track')) { const len = p.shape === 'trackLong' ? r * 4.8 : r * 3.3; return `<rect transform="${tr}" x="${-len / 2}" y="${-r * .38}" width="${len}" height="${r * .76}" fill="${p.color}"/>`; } if (p.shape.startsWith('linear')) { const len = p.shape === 'linearLong' ? r * 4.3 : r * 2.5; return `<rect transform="${tr}" x="${-len / 2}" y="${-r * .34}" width="${len}" height="${r * .68}" fill="#111"/>`; } if (p.shape === 'strip') return `<line transform="${tr}" x1="${-r * 2.4}" y1="0" x2="${r * 2.4}" y2="0" stroke="${p.color}" stroke-width="${r * .35}"/>`; if (p.shape === 'supply') return `<rect transform="${tr}" x="${-r * .65}" y="${-r * 1.25}" width="${r * 1.3}" height="${r * 2.5}" fill="${p.color}"/>`; return `<g transform="${tr}" stroke="#222" fill="none"><circle cy="${-r * .6}" r="${r * .35}" fill="#222"/><path d="M${-r} ${r * 1.2} L${-r * .4} 0 M0 ${r * 1.2} V0 M${r} ${r * 1.2} L${r * .4} 0"/></g>`; }
  function buildSvg() {
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${state.page.width}" height="${state.page.height}" viewBox="0 0 ${state.page.width} ${state.page.height}"><rect width="100%" height="100%" fill="${state.darkPlan ? '#06090d' : 'white'}"/>`];
    if (state.layers.geometry) for (const src of state.entities) if (!state.deleted.has(src.id)) parts.push(entitySvg(state.overrides.get(src.id) || src));
    if (state.layers.text) for (const src of state.texts) if (!state.deletedTexts.has(src.id)) { const t = state.textOverrides.get(src.id) || src; parts.push(`<text x="${t.x}" y="${t.y}" transform="rotate(${t.angle || 0} ${t.x} ${t.y})" font-family="Arial,sans-serif" font-size="${t.size}" fill="${state.darkPlan ? planStroke(t.color) : t.color}">${svgEscape(t.text)}</text>`); }
    if (state.layers.effects) for (const o of state.objects) if (o.type === 'light') parts.push(lightEffectSvg(o));
    for (const o of state.objects) { if (o.type === 'line' && state.layers.edits) parts.push(`<line x1="${o.p[0]}" y1="${o.p[1]}" x2="${o.p[2]}" y2="${o.p[3]}" stroke="${o.color || '#17c7ef'}" stroke-width="${o.width || .8}"/>`); else if (o.type === 'light' && state.layers.lights) parts.push(lightSvg(o)); else if (o.type === 'dimension' && state.layers.dimensions) { const label = dimensionLabel(Math.hypot(o.p[2] - o.p[0], o.p[3] - o.p[1])); parts.push(`<g stroke="#ef2e2e" fill="#ef2e2e"><line x1="${o.p[0]}" y1="${o.p[1]}" x2="${o.p[2]}" y2="${o.p[3]}"/><text x="${(o.p[0] + o.p[2]) / 2}" y="${(o.p[1] + o.p[3]) / 2 - 3}" font-size="8" text-anchor="middle" stroke="none">${svgEscape(label)}</text></g>`); } }
    parts.push('</svg>'); return parts.join('');
  }

  function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function exportSvg() { downloadBlob(new Blob([buildSvg()], { type: 'image/svg+xml;charset=utf-8' }), 'A2Z-Lighting-Plan.svg'); }
  async function exportPdf() { showLoading('جارٍ إنشاء PDF متجهي...', 'إعادة بناء المخطط من العناصر الحالية'); try { const r = await fetch('/api/svg-to-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg: buildSvg() }) }); if (!r.ok) { const e = await r.json(); throw new Error(e.detail); } downloadBlob(await r.blob(), 'A2Z-Lighting-Plan.pdf'); } catch (e) { toast(e.message, true); } finally { hideLoading(); } }
  function exportPng() {
    if (!state.pageLoaded) return; const scale = Math.min(3, 5000 / Math.max(state.page.width, state.page.height)); const off = document.createElement('canvas'); off.width = Math.round(state.page.width * scale); off.height = Math.round(state.page.height * scale); const oc = off.getContext('2d'); oc.setTransform(scale, 0, 0, scale, 0, 0); oc.fillStyle = state.darkPlan ? '#06090d' : '#fff'; oc.fillRect(0, 0, state.page.width, state.page.height); drawBase(oc, true); drawTexts(oc); drawLightingEffects(oc); drawObjects(oc, true); off.toBlob(blob => downloadBlob(blob, 'A2Z-Lighting-Plan.png'), 'image/png');
  }
  function exportJson() { downloadBlob(new Blob([JSON.stringify({ version: 2, title: $('projectTitle').value, source: state.filename, page: state.currentPage, ...snapshot() }, null, 2)], { type: 'application/json' }), 'A2Z-Lighting-Project.json'); }

  function selectedLightObject() {
    if (state.selection.size !== 1) return null;
    const key = [...state.selection][0];
    if (!key.startsWith('o:')) return null;
    const o = getObject(key.slice(2));
    return o && o.type === 'light' ? o : null;
  }

  function syncSimulationUi() {
    $('simulationToggle').classList.toggle('simulation-active', state.lightingSimulation);
    $('simulationToggle').textContent = state.lightingSimulation ? '💡 التأثير ON' : '◌ التأثير OFF';
    $('effectsToggle').checked = state.lightingSimulation && state.layers.effects;
  }

  function toggleSimulation() {
    const target = state.lightingSimulation ? 0 : 1;
    state.lightingSimulation = !state.lightingSimulation;
    state.layers.effects = state.lightingSimulation;
    syncSimulationUi();
    const from = state.simulationMix;
    const start = performance.now();
    const duration = 320;
    const step = now => {
      const t = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      state.simulationMix = from + (target - from) * eased;
      render();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // UI events
  document.querySelectorAll('.tool[data-tool]').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
  document.querySelectorAll('.panel-tab').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b === btn)); document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active')); $(`panel-${btn.dataset.panel}`).classList.add('active'); }));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden')));
  $('uploadBtn').onclick = $('emptyUpload').onclick = $('welcomeUpload').onclick = () => $('fileInput').click();
  $('sampleBtn').onclick = $('emptySample').onclick = $('welcomeSample').onclick = loadSample;
  $('fileInput').addEventListener('change', e => analyzeFile(e.target.files[0]));
  $('analysisBtn').onclick = showAnalysis; $('compareBtn').onclick = () => $('compareModal').classList.remove('hidden'); $('saveBtn').onclick = saveNow;
  $('fitBtn').onclick = fitToScreen; $('zoomInBtn').onclick = () => setZoom(state.camera.zoom * 1.18); $('zoomOutBtn').onclick = () => setZoom(state.camera.zoom / 1.18); $('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
  $('deleteBtn').onclick = $('hudDelete').onclick = $('propertyDelete').onclick = deleteSelection; $('hudClear').onclick = () => { state.selection.clear(); updatePanels(); render(); }; $('duplicateBtn').onclick = duplicateSelection;
  $('snapToggle').onchange = e => state.snap = e.target.checked; $('selectionFilter').onchange = e => state.selectionFilter = e.target.value;
  $('darkPlanToggle').onclick = () => { state.darkPlan = !state.darkPlan; $('darkPlanToggle').classList.toggle('mode-active', state.darkPlan); $('darkPlanToggle').textContent = state.darkPlan ? '◐ مخطط داكن' : '◑ مخطط أبيض'; render(); };
  $('simulationToggle').onclick = () => toggleSimulation();
  $('effectsToggle').onchange = e => { state.layers.effects = e.target.checked; state.lightingSimulation = e.target.checked; syncSimulationUi(); render(); };
  $('masterLight').oninput = e => { state.masterLight = Number(e.target.value) || 1; render(); };
  $('startDistribution').onclick = () => setTool('distribute'); $('exportCsvBtn').onclick = csvExport;
  $('productSearch').oninput = renderProducts;
  $('categoryChips').onclick = e => { const btn = e.target.closest('[data-category]'); if (!btn) return; state.category = btn.dataset.category; renderProducts(); };
  $('productGrid').onclick = e => { const card = e.target.closest('[data-product]'); if (!card) return; state.activeProduct = card.dataset.product; renderProducts(); setTool('light'); };
  $('pagesGrid').onclick = e => { const btn = e.target.closest('[data-import-page]'); if (btn) openVectorPage(Number(btn.dataset.importPage)); };
  $('projectTitle').oninput = () => setDirty(true);
  $('propX').onchange = () => { const c = selectedCenter(); if (c) moveSelectedCenter(Number($('propX').value), c.y); };
  $('propY').onchange = () => { const c = selectedCenter(); if (c) moveSelectedCenter(c.x, Number($('propY').value)); };
  $('propRotation').onchange = () => { if (state.selection.size !== 1) return; const key = [...state.selection][0]; if (!key.startsWith('o:')) return; const o = getObject(key.slice(2)); if (o?.type === 'light') { o.rotation = Number($('propRotation').value) || 0; commitHistory(); render(); } };
  $('propScale').oninput = () => { if (state.selection.size !== 1) return; const key = [...state.selection][0]; if (!key.startsWith('o:')) return; const o = getObject(key.slice(2)); if (o?.type === 'light') { o.scale = Number($('propScale').value) || 1; updateProperties(); render(); } };
  $('propScale').onchange = () => commitHistory();
  $('propIntensity').oninput = () => { const o = selectedLightObject(); if (!o) return; o.intensity = Number($('propIntensity').value) || 0; render(); };
  $('propIntensity').onchange = () => commitHistory();
  $('propSpread').oninput = () => { const o = selectedLightObject(); if (!o) return; o.spread = Number($('propSpread').value) || 1; render(); };
  $('propSpread').onchange = () => commitHistory();
  $('propTemperature').onchange = () => { const o = selectedLightObject(); if (!o) return; o.temperature = Number($('propTemperature').value) || 3000; commitHistory(); render(); };
  $('propLightOn').onchange = () => { const o = selectedLightObject(); if (!o) return; o.lightOn = $('propLightOn').checked; $('effectStateLabel').textContent = o.lightOn ? 'مُشغّل' : 'متوقف'; commitHistory(); render(); };
  document.querySelectorAll('[data-layer]').forEach(input => input.onchange = () => { state.layers[input.dataset.layer] = input.checked; render(); });
  $('exportBtn').onclick = e => { e.stopPropagation(); $('exportMenu').classList.toggle('hidden'); };
  $('exportMenu').onclick = async e => { const btn = e.target.closest('[data-export]'); if (!btn) return; $('exportMenu').classList.add('hidden'); const action = btn.dataset.export; if (!state.pageLoaded) return toast('افتح مخططاً أولاً', true); if (action === 'svg') exportSvg(); else if (action === 'pdf') await exportPdf(); else if (action === 'png') exportPng(); else if (action === 'json') exportJson(); else if (action === 'csv') csvExport(); };
  document.addEventListener('click', () => $('exportMenu').classList.add('hidden'));

  canvas.addEventListener('pointerdown', canvasPointerDown); canvas.addEventListener('pointermove', canvasPointerMove); canvas.addEventListener('pointerup', canvasPointerUp); canvas.addEventListener('pointercancel', canvasPointerUp); canvas.addEventListener('wheel', wheelZoom, { passive: false });
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', e => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return; if (e.code === 'Space') { state.spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); } if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { redo(); e.preventDefault(); } if (e.key === 'Escape') { state.selection.clear(); state.draft = null; setTool('select'); updatePanels(); render(); } });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { state.spaceDown = false; canvas.style.cursor = state.tool === 'pan' ? 'grab' : 'default'; } });

  renderProducts(); syncSimulationUi(); updatePanels(); resizeCanvas();
})();
