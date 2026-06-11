/* ============================================================
   MaShowRooms — engine.js
   Plain-JS Three.js voxel room engine. Exposes window.RoomEngine.

   Responsibilities:
   - Isometric orthographic camera rig (4-corner snap OR free orbit)
   - 12×12 room: checker floor, 4 walls (back walls auto-hidden), window
   - Voxel grid build/erase with ghost preview
   - Furniture placement (ghost, rotate, occupancy) + removal
   - Interactions: hover outline, click bounce, lamp / screen / eq / spin
   - Theme (light/dark lighting) + room palettes + undo
   - Persistence: room state auto-saved to LocalStorage (debounced)
     and restored on page load; falls back to the starter scene
   Talks to the React UI via .on(event, cb):
     'hover'   {name,x,y,inter} | null   (tooltip)
     'view'    'SE'|'SW'|'NW'|'NE'|'FREE'
     'placing' itemId | null
     'mode'    mode string
   ============================================================ */

(function () {
  var T = THREE;
  var SIZE = 12, WALL_H = 6, HALF = SIZE / 2;
  var VIEW_LABELS = ['SE', 'SW', 'NW', 'NE'];
  var SAVE_KEY = 'mashowrooms.room.v1';

  function keyOf(x, y, z) { return x + ',' + y + ',' + z; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var THEMES = {
    light: { hemiSky: '#ffffff', hemiGround: '#d8d2c8', hemiInt: 0.85, dirColor: '#fff3e0', dirInt: 0.95, winColor: '#bfdcf5', winEmis: '#bfdcf5', winInt: 0.35, lampInt: 0.7 },
    dark:  { hemiSky: '#6a70a8', hemiGround: '#16161c', hemiInt: 0.4,  dirColor: '#9aa3ff', dirInt: 0.28, winColor: '#27305e', winEmis: '#39427c', winInt: 0.8,  lampInt: 1.5 }
  };

  function RoomEngine(container, opts) {
    this.container = container;
    this.opts = Object.assign({ theme: 'light', paletteIndex: 0, cameraVariant: 'snap', isoAngle: 35, bounce: true }, opts || {});
    this.listeners = {};
    this.mode = 'interact';
    this.buildColor = ROOM_PALETTES[this.opts.paletteIndex].swatches[5];
    this.placing = null;       // def being placed
    this.placeRot = 0;
    this.ghostFurn = null;
    this.voxels = new Map();   // key -> mesh
    this.furniture = [];
    this.occ = new Map();      // "x,z" -> instance
    this.undoStack = [];
    this.anims = [];
    this.selectedInst = null;  // selected furniture (persistent amber outline)
    this.hovered = null;       // furniture instance under cursor
    this.hoverVoxelMesh = null;
    this.buildTarget = null;   // {cell:[x,y,z]} valid build position
    this.placeCell = null;     // [cx,cz] valid furn position
    this.elapsed = 0;
    this.lastClient = { x: 0, y: 0 };
    this.matCache = new Map();

    this._initThree();
    this._initRoom();
    this._initLights();
    this._initGhosts();
    this.setPalette(this.opts.paletteIndex);
    this.setTheme(this.opts.theme);
    this._initEvents();
    if (!this._restoreSaved()) this._loadStarter();
    this.clock = new T.Clock();
    var self = this;
    (function loop() { requestAnimationFrame(loop); self._tick(); })();
  }

  RoomEngine.prototype.on = function (e, cb) { (this.listeners[e] = this.listeners[e] || []).push(cb); };
  RoomEngine.prototype.emit = function (e, d) { (this.listeners[e] || []).forEach(function (f) { f(d); }); };

  /* ---------------- setup ---------------- */

  RoomEngine.prototype._initThree = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    if (T.SRGBColorSpace !== undefined) { this.renderer.outputColorSpace = T.SRGBColorSpace; } else { this.renderer.outputEncoding = 3001; }
    this.container.appendChild(this.renderer.domElement);

    this.scene = new T.Scene();
    this.target = new T.Vector3(0, 1.4, 0);
    this.frustH = 9.2;
    var aspect = w / h;
    this.camera = new T.OrthographicCamera(-this.frustH * aspect, this.frustH * aspect, this.frustH, -this.frustH, 0.1, 200);
    this.azIndex = 0;
    this.az = Math.PI / 4;       // camera in +x,+z quadrant => SE corner
    this.azTarget = this.az;
    this.polar = this.opts.isoAngle * Math.PI / 180;
    this.dist = 60;
    this.zoom = 1; this.zoomTarget = 1;
    this.raycaster = new T.Raycaster();
    this.pointer = new T.Vector2();

    this.voxelGroup = new T.Group();
    this.furnRoot = new T.Group();
    this.scene.add(this.voxelGroup, this.furnRoot);
  };

  RoomEngine.prototype._matFor = function (hex) {
    if (!this.matCache.has(hex)) {
      this.matCache.set(hex, new T.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0 }));
    }
    return this.matCache.get(hex);
  };

  RoomEngine.prototype._initRoom = function () {
    // Floor: box with checker texture on top face
    this.floorSideMat = new T.MeshStandardMaterial({ color: '#b08561', roughness: 0.9 });
    this.floorTopMat = new T.MeshStandardMaterial({ roughness: 0.92 });
    var mats = [this.floorSideMat, this.floorSideMat, this.floorTopMat, this.floorSideMat, this.floorSideMat, this.floorSideMat];
    this.floor = new T.Mesh(new T.BoxGeometry(SIZE, 0.6, SIZE), mats);
    this.floor.position.y = -0.3;
    this.floor.receiveShadow = true;
    this.floor.userData.floor = true;
    this.scene.add(this.floor);

    // Build-mode grid overlay
    this.grid = new T.GridHelper(SIZE, SIZE, 0x000000, 0x000000);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.12;
    this.grid.position.y = 0.012;
    this.grid.visible = false;
    this.scene.add(this.grid);

    // Walls
    this.wallMat = new T.MeshStandardMaterial({ roughness: 0.95 });
    this.wallMat2 = new T.MeshStandardMaterial({ roughness: 0.95 });
    this.baseMat = new T.MeshStandardMaterial({ roughness: 0.95 });
    var t = 0.3;

    function slab(geoW, geoD, mat) {
      var m = new T.Mesh(new T.BoxGeometry(geoW, WALL_H, geoD), mat);
      m.position.y = WALL_H / 2;
      m.receiveShadow = true;
      return m;
    }
    this.walls = {};
    this.walls.n = new T.Group(); this.walls.n.add(slab(SIZE + 2 * t, t, this.wallMat));
    this.walls.n.position.set(0, 0, -HALF - t / 2);
    this.walls.s = new T.Group(); this.walls.s.add(slab(SIZE + 2 * t, t, this.wallMat));
    this.walls.s.position.set(0, 0, HALF + t / 2);
    this.walls.w = new T.Group(); this.walls.w.add(slab(t, SIZE + 2 * t, this.wallMat2));
    this.walls.w.position.set(-HALF - t / 2, 0, 0);
    this.walls.e = new T.Group(); this.walls.e.add(slab(t, SIZE + 2 * t, this.wallMat2));
    this.walls.e.position.set(HALF + t / 2, 0, 0);

    // Baseboards (proud strips on inner faces)
    var bbN = new T.Mesh(new T.BoxGeometry(SIZE, 0.5, 0.1), this.baseMat); bbN.position.set(0, 0.25, t / 2 + 0.05);
    var bbS = bbN.clone(); bbS.position.z = -(t / 2 + 0.05);
    var bbW = new T.Mesh(new T.BoxGeometry(0.1, 0.5, SIZE), this.baseMat); bbW.position.set(t / 2 + 0.05, 0.25, 0);
    var bbE = bbW.clone(); bbE.position.x = -(t / 2 + 0.05);
    this.walls.n.add(bbN); this.walls.s.add(bbS); this.walls.w.add(bbW); this.walls.e.add(bbE);

    // Window on the north wall
    var win = new T.Group();
    var frameMat = new T.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.8 });
    var frame = new T.Mesh(new T.BoxGeometry(3.2, 2.4, 0.14), frameMat);
    this.winPaneMat = new T.MeshStandardMaterial({ color: '#bfdcf5', roughness: 0.4, emissive: '#bfdcf5', emissiveIntensity: 0.35 });
    var pane = new T.Mesh(new T.BoxGeometry(2.8, 2.0, 0.08), this.winPaneMat);
    pane.position.z = 0.02;
    var barV = new T.Mesh(new T.BoxGeometry(0.1, 2.0, 0.1), frameMat); barV.position.z = 0.04;
    var barH = new T.Mesh(new T.BoxGeometry(2.8, 0.1, 0.1), frameMat); barH.position.z = 0.04;
    win.add(frame, pane, barV, barH);
    win.position.set(1.0, 3.0, t / 2 + 0.04);
    this.walls.n.add(win);

    var self = this;
    Object.keys(this.walls).forEach(function (k) { self.scene.add(self.walls[k]); });
  };

  RoomEngine.prototype._initLights = function () {
    this.hemi = new T.HemisphereLight('#ffffff', '#d8d2c8', 0.85);
    this.dir = new T.DirectionalLight('#fff3e0', 0.95);
    this.dir.position.set(9, 15, 8);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(2048, 2048);
    this.dir.shadow.camera.left = -12; this.dir.shadow.camera.right = 12;
    this.dir.shadow.camera.top = 12; this.dir.shadow.camera.bottom = -12;
    this.dir.shadow.camera.near = 1; this.dir.shadow.camera.far = 50;
    this.dir.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.dir);
  };

  RoomEngine.prototype._initGhosts = function () {
    // Ghost voxel for build mode
    this.ghostMat = new T.MeshStandardMaterial({ color: this.buildColor, transparent: true, opacity: 0.55, depthWrite: false });
    this.ghostVoxel = new T.Mesh(new T.BoxGeometry(1, 1, 1), this.ghostMat);
    var edges = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: '#5865f2' }));
    this.ghostVoxel.add(edges);
    this.ghostVoxel.visible = false;
    this.scene.add(this.ghostVoxel);

    // Hover highlight box for voxels (erase mode)
    this.voxelHover = new T.Mesh(new T.BoxGeometry(1.04, 1.04, 1.04),
      new T.MeshBasicMaterial({ color: '#f23f43', transparent: true, opacity: 0.4, depthWrite: false }));
    this.voxelHover.visible = false;
    this.scene.add(this.voxelHover);

    this.outlineMatBlue     = new T.MeshBasicMaterial({ color: '#5865f2', side: T.BackSide });
    this.outlineMatRed      = new T.MeshBasicMaterial({ color: '#f23f43', side: T.BackSide });
    this.outlineMatSelected = new T.MeshBasicMaterial({ color: '#f0b232', side: T.BackSide });
  };

  /* ---------------- furniture ---------------- */

  RoomEngine.prototype._buildFurnGroup = function (def, ghost) {
    var root = new T.Group();
    var fpx = def.fp[0], fpz = def.fp[1];
    var tags = {}, meshes = [];
    def.parts.forEach(function (pt) {
      var sw = pt.s[0], sh = pt.s[1], sd = pt.s[2];
      var mat = new T.MeshStandardMaterial({ color: pt.c, roughness: 0.85, metalness: 0 });
      if (ghost) { mat.transparent = true; mat.opacity = 0.55; mat.depthWrite = false; }
      var m = new T.Mesh(new T.BoxGeometry(sw, sh, sd), mat);
      m.position.set(pt.p[0] + sw / 2 - fpx / 2, pt.p[1] + sh / 2, pt.p[2] + sd / 2 - fpz / 2);
      m.castShadow = !ghost; m.receiveShadow = !ghost;
      m.userData.size = [sw, sh, sd];
      if (pt.tag) { (tags[pt.tag] = tags[pt.tag] || []).push(m); }
      if (pt.tag === 'bar') { m.userData.baseY = m.position.y; m.userData.baseH = sh; }
      root.add(m);
      meshes.push(m);
    });
    return { root: root, tags: tags, meshes: meshes };
  };

  RoomEngine.prototype._rotatedFp = function (def, rot) {
    return (rot % 2 === 1) ? [def.fp[1], def.fp[0]] : [def.fp[0], def.fp[1]];
  };

  RoomEngine.prototype._furnWorldPos = function (def, cell, rot) {
    var d = this._rotatedFp(def, rot);
    return new T.Vector3(-HALF + cell[0] + d[0] / 2, 0, -HALF + cell[1] + d[1] / 2);
  };

  RoomEngine.prototype._footprintCells = function (def, cell, rot) {
    var d = this._rotatedFp(def, rot), cells = [];
    for (var x = 0; x < d[0]; x++) for (var z = 0; z < d[1]; z++) cells.push([cell[0] + x, cell[1] + z]);
    return cells;
  };

  RoomEngine.prototype._canPlaceFurn = function (def, cell, rot) {
    var d = this._rotatedFp(def, rot);
    if (cell[0] < 0 || cell[1] < 0 || cell[0] + d[0] > SIZE || cell[1] + d[1] > SIZE) return false;
    if (def.noBlock) return true;
    var cells = this._footprintCells(def, cell, rot);
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (this.occ.has(c[0] + ',' + c[1])) return false;
      if (this.voxels.has(keyOf(c[0], 0, c[1]))) return false;
    }
    return true;
  };

  RoomEngine.prototype._placeFurn = function (defId, cell, rot, initialOn, skipUndo) {
    var def = FURNITURE.find(function (f) { return f.id === defId; });
    if (!def || !this._canPlaceFurn(def, cell, rot)) return null;
    var built = this._buildFurnGroup(def, false);
    var root = built.root;
    root.position.copy(this._furnWorldPos(def, cell, rot));
    root.rotation.y = rot * Math.PI / 2;

    // Inverted-hull hover outline
    var og = new T.Group(); og.visible = false;
    var ogMeshes = [];
    built.meshes.forEach(function (m) {
      var s = m.userData.size;
      var o = new T.Mesh(m.geometry, this.outlineMatBlue);
      o.position.copy(m.position);
      o.scale.set((s[0] + 0.09) / s[0], (s[1] + 0.09) / s[1], (s[2] + 0.09) / s[2]);
      og.add(o); ogMeshes.push(o);
    }, this);
    root.add(og);

    var inst = { def: def, root: root, tags: built.tags, meshes: built.meshes, og: og, ogMeshes: ogMeshes, cell: cell.slice(), rot: rot, state: { on: false }, light: null };
    built.meshes.forEach(function (m) { m.userData.furn = inst; });

    if (def.inter === 'lamp') {
      var L = new T.PointLight('#ffd9a0', 0, 7, 2);
      L.position.set(def.light[0] - def.fp[0] / 2, def.light[1], def.light[2] - def.fp[1] / 2);
      L.visible = false;
      root.add(L);
      inst.light = L;
    }
    if (!def.noBlock) {
      this._footprintCells(def, cell, rot).forEach(function (c) { this.occ.set(c[0] + ',' + c[1], inst); }, this);
    }
    this.furnRoot.add(root);
    this.furniture.push(inst);
    if (initialOn && def.inter) { inst.state.on = true; this._applyState(inst); }
    if (!skipUndo) this._pushUndo({ t: 'furn+', inst: inst });
    this._scheduleSave();
    return inst;
  };

  RoomEngine.prototype._removeFurn = function (inst, skipUndo, instant) {
    var self = this;
    var idx = this.furniture.indexOf(inst);
    if (idx < 0) return;
    this.furniture.splice(idx, 1);
    if (!inst.def.noBlock) {
      this._footprintCells(inst.def, inst.cell, inst.rot).forEach(function (c) {
        if (self.occ.get(c[0] + ',' + c[1]) === inst) self.occ.delete(c[0] + ',' + c[1]);
      });
    }
    if (this.hovered === inst) { this.hovered = null; this.emit('hover', null); }
    if (this.selectedInst === inst) { this.selectedInst = null; this.emit('selected', null); }
    if (!skipUndo) this._pushUndo({ t: 'furn-', data: { defId: inst.def.id, cell: inst.cell.slice(), rot: inst.rot, on: inst.state.on } });
    this._scheduleSave();
    if (instant) { this.furnRoot.remove(inst.root); return; }
    this.anims.push({
      obj: inst.root, t: 0, dur: 0.2,
      fn: function (o, k) { var s = 1 - k; o.scale.set(s, s, s); },
      done: function () { self.furnRoot.remove(inst.root); }
    });
  };

  RoomEngine.prototype._applyState = function (inst) {
    var on = inst.state.on;
    var th = THEMES[this.theme || 'light'];
    if (inst.def.inter === 'lamp') {
      (inst.tags.shade || []).forEach(function (m) {
        m.material.emissive.set('#ffc24d');
        m.material.emissiveIntensity = on ? 0.95 : 0;
      });
      if (inst.light) { inst.light.visible = on; inst.light.intensity = th.lampInt; }
    } else if (inst.def.inter === 'screen') {
      (inst.tags.screen || []).forEach(function (m) {
        m.material.color.set(on ? '#aeb8ff' : '#101014');
        m.material.emissive.set('#5865f2');
        m.material.emissiveIntensity = on ? 0.9 : 0;
      });
    } else if (inst.def.inter === 'eq' && !on) {
      (inst.tags.bar || []).forEach(function (m) {
        m.scale.y = 1;
        m.position.y = m.userData.baseY;
      });
    }
  };

  RoomEngine.prototype._activate = function (inst) {
    if (this.opts.bounce) this._bounce(inst.root);
    if (inst.def.inter) {
      inst.state.on = !inst.state.on;
      this._applyState(inst);
      this._scheduleSave();
    }
  };

  RoomEngine.prototype._bounce = function (obj) {
    this.anims = this.anims.filter(function (a) { return a.obj !== obj; });
    obj.scale.set(1, 1, 1);
    this.anims.push({
      obj: obj, t: 0, dur: 0.55,
      fn: function (o, k) {
        var decay = Math.exp(-4.5 * k);
        var s = 1 - 0.32 * decay * Math.cos(k * Math.PI * 3.2);
        var sxz = 1 + (1 - s) * 0.6;
        if (k >= 1) { o.scale.set(1, 1, 1); } else { o.scale.set(sxz, s, sxz); }
      }
    });
  };

  /* ---------------- voxels ---------------- */

  RoomEngine.prototype._addVoxel = function (cell, color, skipUndo) {
    var k = keyOf(cell[0], cell[1], cell[2]);
    if (this.voxels.has(k)) return;
    var m = new T.Mesh(new T.BoxGeometry(1, 1, 1), this._matFor(color));
    m.position.set(cell[0] - HALF + 0.5, cell[1] + 0.5, cell[2] - HALF + 0.5);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.voxel = true; m.userData.cell = cell.slice(); m.userData.color = color;
    this.voxelGroup.add(m);
    this.voxels.set(k, m);
    // pop-in
    var baseY = m.position.y;
    this.anims.push({
      obj: m, t: 0, dur: 0.35,
      fn: function (o, k2) {
        var s = 1 - 0.6 * Math.exp(-6 * k2) * Math.cos(k2 * 5);
        if (k2 >= 1) s = 1;
        o.scale.set(s, s, s);
        o.position.y = baseY - (1 - s) * 0.5;
      }
    });
    if (!skipUndo) this._pushUndo({ t: 'vox+', key: k });
    this._scheduleSave();
  };

  RoomEngine.prototype._removeVoxel = function (k, skipUndo) {
    var m = this.voxels.get(k);
    if (!m) return;
    this.voxels.delete(k);
    this.voxelGroup.remove(m);
    if (!skipUndo) this._pushUndo({ t: 'vox-', key: k, color: m.userData.color, cell: m.userData.cell });
    this._scheduleSave();
  };

  /* ---------------- save / load (LocalStorage) ---------------- */

  RoomEngine.prototype.serialize = function () {
    var furniture = this.furniture.map(function (inst) {
      return {
        id: inst.def.id,
        x: inst.cell[0], y: 0, z: inst.cell[1],
        rot: inst.rot,
        on: !!inst.state.on
      };
    });
    var voxels = [];
    this.voxels.forEach(function (m) {
      var c = m.userData.cell;
      voxels.push({ x: c[0], y: c[1], z: c[2], color: m.userData.color });
    });
    return { v: 1, furniture: furniture, voxels: voxels };
  };

  RoomEngine.prototype._scheduleSave = function () {
    if (this._restoring) return;
    var self = this;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function () { self.saveNow(); }, 150);
  };

  RoomEngine.prototype.saveNow = function () {
    clearTimeout(this._saveTimer);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
    } catch (e) { /* storage unavailable or full — keep running without persistence */ }
  };

  RoomEngine.prototype._restoreSaved = function () {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {}
    if (!raw) return false;
    var state;
    try { state = JSON.parse(raw); } catch (e) { return false; }
    if (!state || !Array.isArray(state.furniture)) return false;
    this._restoring = true;
    var self = this;
    (state.voxels || []).forEach(function (v) {
      if (typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return;
      if (v.x < 0 || v.x >= SIZE || v.y < 0 || v.y >= WALL_H || v.z < 0 || v.z >= SIZE) return;
      self._addVoxel([v.x, v.y, v.z], v.color || '#5865f2', true);
    });
    state.furniture.forEach(function (f) {
      if (typeof f.x !== 'number' || typeof f.z !== 'number') return;
      self._placeFurn(f.id, [f.x, f.z], ((f.rot || 0) % 4 + 4) % 4, !!f.on, true);
    });
    this._restoring = false;
    return true;
  };

  /* ---------------- undo / reset / starter ---------------- */

  RoomEngine.prototype._pushUndo = function (a) {
    this.undoStack.push(a);
    if (this.undoStack.length > 60) this.undoStack.shift();
  };

  RoomEngine.prototype.undo = function () {
    var a = this.undoStack.pop();
    if (!a) return;
    if (a.t === 'vox+') this._removeVoxel(a.key, true);
    else if (a.t === 'vox-') this._addVoxel(a.cell, a.color, true);
    else if (a.t === 'furn+') this._removeFurn(a.inst, true);
    else if (a.t === 'furn-') this._placeFurn(a.data.defId, a.data.cell, a.data.rot, a.data.on, true);
  };

  RoomEngine.prototype.resetRoom = function () {
    var self = this;
    this.furniture.slice().forEach(function (i) { self._removeFurn(i, true, true); });
    Array.from(this.voxels.keys()).forEach(function (k) { self._removeVoxel(k, true); });
    this.undoStack = [];
    this._loadStarter();
  };

  RoomEngine.prototype._loadStarter = function () {
    var self = this;
    STARTER.forEach(function (s) { self._placeFurn(s.id, s.cell, s.rot, !!s.on, true); });
  };

  /* ---------------- public controls ---------------- */

  RoomEngine.prototype.setMode = function (m) {
    if (this.placing && m !== 'place') this.cancelPlacing(true);
    this.mode = m;
    this.grid.visible = (m === 'build' || m === 'place');
    this.ghostVoxel.visible = false;
    this.voxelHover.visible = false;
    this._setSelected(null);
    this._setHovered(null);
    this.container.style.cursor = (m === 'build' || m === 'erase') ? 'crosshair' : 'default';
    this.emit('mode', m);
  };

  RoomEngine.prototype.setBuildColor = function (hex) {
    this.buildColor = hex;
    this.ghostMat.color.set(hex);
  };

  RoomEngine.prototype.startPlacing = function (defId) {
    this.cancelPlacing(true);
    var def = FURNITURE.find(function (f) { return f.id === defId; });
    if (!def) return;
    this.placing = def;
    this.placeRot = 0;
    var built = this._buildFurnGroup(def, true);
    this.ghostFurn = built.root;
    this.ghostFurn.visible = false;
    this.ghostMats = built.meshes.map(function (m) { return m.material; });
    this.ghostColors = built.meshes.map(function (m) { return m.material.color.getHex(); });
    this.scene.add(this.ghostFurn);
    this.mode = 'place';
    this.grid.visible = true;
    this.ghostVoxel.visible = false;
    this.voxelHover.visible = false;
    this._setHovered(null);
    this.container.style.cursor = 'copy';
    this.emit('mode', 'place');
    this.emit('placing', defId);
  };

  RoomEngine.prototype.cancelPlacing = function (silent) {
    if (this.ghostFurn) { this.scene.remove(this.ghostFurn); this.ghostFurn = null; }
    this.placing = null;
    this.placeCell = null;
    if (!silent) {
      this.emit('placing', null);
      this.setMode('interact');
    } else {
      this.emit('placing', null);
    }
  };

  RoomEngine.prototype.rotatePlacing = function () {
    if (!this.placing) return;
    this.placeRot = (this.placeRot + 1) % 4;
    if (this.ghostFurn) this.ghostFurn.rotation.y = this.placeRot * Math.PI / 2;
    this._refreshHover();
    this.emit('placeRot', this.placeRot);
  };

  RoomEngine.prototype.rotateCamera = function (dir) {
    if (this.opts.cameraVariant !== 'snap') return;
    this.azIndex = ((this.azIndex + dir) % 4 + 4) % 4;
    this.azTarget += dir * Math.PI / 2;
    this.emit('view', VIEW_LABELS[this.azIndex]);
  };

  RoomEngine.prototype.zoomBy = function (f) {
    this.zoomTarget = clamp(this.zoomTarget * f, 0.5, 3.2);
  };

  RoomEngine.prototype.setCameraVariant = function (v) {
    this.opts.cameraVariant = v;
    if (v === 'snap') {
      var idx = Math.round((this.az - Math.PI / 4) / (Math.PI / 2));
      this.azTarget = Math.PI / 4 + idx * Math.PI / 2;
      this.azIndex = ((idx % 4) + 4) % 4;
      this.emit('view', VIEW_LABELS[this.azIndex]);
    } else {
      this.emit('view', 'FREE');
    }
  };

  RoomEngine.prototype.setIsoAngle = function (deg) {
    this.polar = deg * Math.PI / 180;
  };

  RoomEngine.prototype.setBounce = function (b) { this.opts.bounce = b; };

  /* ---- Selection helpers (called from UI) ---- */
  RoomEngine.prototype.rotateInPlace = function (inst) {
    if (!inst) return;
    var def = inst.def, cell = inst.cell.slice();
    var newRot = (inst.rot + 1) % 4, wasOn = inst.state.on;
    this._removeFurn(inst, true, true);
    var ni = this._placeFurn(def.id, cell, newRot, wasOn, true);
    if (ni) { this._setSelected(ni); if (this.opts.bounce) this._bounce(ni.root); }
  };

  RoomEngine.prototype.startMoving = function (inst) {
    if (!inst) return;
    var defId = inst.def.id, rot = inst.rot;
    this._setSelected(null);
    this._removeFurn(inst, false);
    this.startPlacing(defId);
    this.placeRot = rot;
    if (this.ghostFurn) this.ghostFurn.rotation.y = rot * Math.PI / 2;
    this.emit('placeRot', rot);
  };

  RoomEngine.prototype.deleteSelected = function () {
    if (!this.selectedInst) return;
    var inst = this.selectedInst;
    this._setSelected(null);
    this._removeFurn(inst);
  };

  RoomEngine.prototype.setTheme = function (theme) {
    this.theme = theme;
    var th = THEMES[theme];
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.hemi.intensity = th.hemiInt;
    this.dir.color.set(th.dirColor);
    this.dir.intensity = th.dirInt;
    this.winPaneMat.color.set(th.winColor);
    this.winPaneMat.emissive.set(th.winEmis);
    this.winPaneMat.emissiveIntensity = th.winInt;
    var self = this;
    this.furniture.forEach(function (inst) {
      if (inst.def.inter === 'lamp') {
        if (theme === 'dark' && !inst.state.on) inst.state.on = true;  // cozy auto-on
        self._applyState(inst);
      }
    });
    this._scheduleSave();
  };

  RoomEngine.prototype.setPalette = function (idx) {
    var p = ROOM_PALETTES[idx];
    if (!p) return;
    this.paletteIndex = idx;
    this.wallMat.color.set(p.wall);
    this.wallMat2.color.set(p.wall2);
    this.baseMat.color.set(p.base);
    this.floorSideMat.color.set(p.floorB);
    // checkerboard floor texture
    var c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    var ctx = c.getContext('2d');
    for (var x = 0; x < SIZE; x++) for (var z = 0; z < SIZE; z++) {
      ctx.fillStyle = ((x + z) % 2 === 0) ? p.floorA : p.floorB;
      ctx.fillRect(x, z, 1, 1);
    }
    var tex = new T.CanvasTexture(c);
    tex.magFilter = T.NearestFilter;
    if (T.SRGBColorSpace !== undefined) { tex.colorSpace = T.SRGBColorSpace; } else { tex.encoding = 3001; }
    this.floorTopMat.map = tex;
    this.floorTopMat.color.set('#ffffff');
    this.floorTopMat.needsUpdate = true;
  };

  /* ---------------- events ---------------- */

  RoomEngine.prototype._initEvents = function () {
    var self = this;
    var el = this.renderer.domElement;
    this.down = null;

    el.addEventListener('pointerdown', function (e) {
      self.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, lastCell: null };
    });

    window.addEventListener('pointermove', function (e) {
      self.lastClient = { x: e.clientX, y: e.clientY };
      var rect = el.getBoundingClientRect();
      self.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      self.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (self.down) {
        var dx = e.clientX - self.down.x, dy = e.clientY - self.down.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) self.down.moved = true;
        if (self.down.moved) {
          if (self.down.button === 2) self._pan(e.movementX, e.movementY);
          else if (self.down.button === 0 && self.opts.cameraVariant === 'free') {
            self.az -= e.movementX * 0.006;
            self.azTarget = self.az;
          }
        }
      }
      self._refreshHover();
      /* Continuous drag-build / drag-erase */
      if (self.down && self.down.moved && self.down.button === 0) {
        if (self.mode === 'build' && self.buildTarget) {
          var ck = self.buildTarget.cell.join(',');
          if (ck !== self.down.lastCell) {
            self._addVoxel(self.buildTarget.cell.slice(), self.buildColor);
            self.down.lastCell = ck;
          }
        } else if (self.mode === 'erase') {
          if (self.eraseTarget && self.eraseTarget.voxel) {
            var vc = self.eraseTarget.voxel.userData.cell;
            var vk = vc[0] + ',' + vc[1] + ',' + vc[2];
            if (vk !== self.down.lastCell) {
              self._removeVoxel(vk);
              self.down.lastCell = vk;
              self.voxelHover.visible = false;
              self.eraseTarget = null;
            }
          } else if (self.eraseTarget && self.eraseTarget.furn) {
            var finst = self.eraseTarget.furn;
            var fk = finst.def.id + finst.cell.join('');
            if (fk !== self.down.lastCell) {
              self._removeFurn(finst);
              self.down.lastCell = fk;
              self.eraseTarget = null;
            }
          }
        }
      }
    });

    window.addEventListener('pointerup', function (e) {
      var d = self.down; self.down = null;
      if (!d || d.moved) return;
      if (e.target !== el) return;
      if (d.button === 0) self._click();
      else if (d.button === 2 && self.placing) self.cancelPlacing();
    });

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoomBy(Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });

    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'r' || e.key === 'R') self.rotatePlacing();
      else if (e.key === 'Escape') { if (self.placing) self.cancelPlacing(); else self.setMode('interact'); }
      else if (e.key === 'q' || e.key === 'Q') self.rotateCamera(1);
      else if (e.key === 'e' || e.key === 'E') self.rotateCamera(-1);
    });

    window.addEventListener('resize', function () { self._resize(); });

    // Flush any pending debounced save before the page goes away
    window.addEventListener('beforeunload', function () { self.saveNow(); });
  };

  RoomEngine.prototype._pan = function (mx, my) {
    var wpp = (this.frustH * 2 / this.zoom) / this.container.clientHeight;
    var right = new T.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    var fwd = new T.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    this.target.addScaledVector(right, -mx * wpp);
    this.target.addScaledVector(fwd, my * wpp * 1.6);
    this.target.x = clamp(this.target.x, -6, 6);
    this.target.z = clamp(this.target.z, -6, 6);
  };

  RoomEngine.prototype._resize = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    var aspect = w / h;
    this.camera.left = -this.frustH * aspect;
    this.camera.right = this.frustH * aspect;
    this.camera.updateProjectionMatrix();
  };

  /* ---------------- hover / click ---------------- */

  RoomEngine.prototype._setHovered = function (inst, red) {
    if (this.hovered && this.hovered !== inst && this.hovered !== this.selectedInst) {
      this.hovered.og.visible = false;
    }
    this.hovered = inst;
    if (inst && inst !== this.selectedInst) {
      var mat = red ? this.outlineMatRed : this.outlineMatBlue;
      inst.ogMeshes.forEach(function (o) { o.material = mat; });
      inst.og.visible = true;
    }
  };

  RoomEngine.prototype._setSelected = function (inst) {
    var self = this;
    if (this.selectedInst && this.selectedInst !== inst) {
      if (this.selectedInst !== this.hovered) {
        this.selectedInst.og.visible = false;
      } else {
        this.selectedInst.ogMeshes.forEach(function (o) { o.material = self.outlineMatBlue; });
      }
    }
    this.selectedInst = inst;
    if (inst) {
      inst.ogMeshes.forEach(function (o) { o.material = self.outlineMatSelected; });
      inst.og.visible = true;
    }
    this.emit('selected', inst ? {
      name: inst.def.name, defId: inst.def.id, cat: inst.def.cat,
      inter: inst.def.inter || null, rot: inst.rot,
    } : null);
  };

  RoomEngine.prototype._ray = function (objects, recursive) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  };

  RoomEngine.prototype._refreshHover = function () {
    var m = this.mode;
    this.ghostVoxel.visible = false;
    this.voxelHover.visible = false;

    if (m === 'interact') {
      var hits = this._ray(this.furnRoot.children, true);
      var inst = null;
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].object.userData.furn) { inst = hits[i].object.userData.furn; break; }
      }
      this._setHovered(inst, false);
      this.container.style.cursor = inst ? 'pointer' : 'default';
      this.emit('hover', inst ? { name: inst.def.name, inter: inst.def.inter || null, x: this.lastClient.x, y: this.lastClient.y } : null);

    } else if (m === 'erase') {
      var hits2 = this._ray(this.furnRoot.children.concat(this.voxelGroup.children), true);
      var found = null;
      for (var j = 0; j < hits2.length; j++) {
        var o = hits2[j].object;
        if (o.userData.furn || o.userData.voxel) { found = o; break; }
      }
      if (found && found.userData.voxel) {
        this._setHovered(null);
        this.voxelHover.position.copy(found.position);
        this.voxelHover.visible = true;
        this.eraseTarget = { voxel: found };
      } else if (found && found.userData.furn) {
        this._setHovered(found.userData.furn, true);
        this.eraseTarget = { furn: found.userData.furn };
      } else {
        this._setHovered(null);
        this.eraseTarget = null;
      }

    } else if (m === 'build') {
      var targets = this.voxelGroup.children.concat([this.floor]);
      var hits3 = this._ray(targets, false);
      this.buildTarget = null;
      if (hits3.length) {
        var h = hits3[0], cell = null;
        if (h.object.userData.voxel) {
          var n = h.face.normal;
          var c0 = h.object.userData.cell;
          cell = [c0[0] + Math.round(n.x), c0[1] + Math.round(n.y), c0[2] + Math.round(n.z)];
        } else {
          cell = [Math.floor(h.point.x + HALF), 0, Math.floor(h.point.z + HALF)];
        }
        cell[0] = clamp(cell[0], 0, SIZE - 1);
        cell[2] = clamp(cell[2], 0, SIZE - 1);
        var ok = cell[1] >= 0 && cell[1] < WALL_H &&
          !this.voxels.has(keyOf(cell[0], cell[1], cell[2])) &&
          !(cell[1] === 0 && this.occ.has(cell[0] + ',' + cell[2]));
        if (ok) {
          this.buildTarget = { cell: cell };
          this.ghostVoxel.position.set(cell[0] - HALF + 0.5, cell[1] + 0.5, cell[2] - HALF + 0.5);
          this.ghostVoxel.visible = true;
        }
      }

    } else if (m === 'place' && this.placing && this.ghostFurn) {
      var hits4 = this._ray([this.floor], false);
      this.placeCell = null;
      this.ghostFurn.visible = false;
      if (hits4.length) {
        var p = hits4[0].point;
        var d = this._rotatedFp(this.placing, this.placeRot);
        var cx = clamp(Math.floor(p.x + HALF) - Math.floor(d[0] / 2) + (d[0] > 1 ? 0 : 0), 0, SIZE - d[0]);
        var cz = clamp(Math.floor(p.z + HALF) - Math.floor(d[1] / 2), 0, SIZE - d[1]);
        cx = clamp(Math.floor(p.x + HALF - d[0] / 2 + 0.5), 0, SIZE - d[0]);
        cz = clamp(Math.floor(p.z + HALF - d[1] / 2 + 0.5), 0, SIZE - d[1]);
        var valid = this._canPlaceFurn(this.placing, [cx, cz], this.placeRot);
        this.ghostFurn.position.copy(this._furnWorldPos(this.placing, [cx, cz], this.placeRot));
        this.ghostFurn.rotation.y = this.placeRot * Math.PI / 2;
        this.ghostFurn.visible = true;
        var self = this;
        this.ghostMats.forEach(function (mt, i2) {
          if (valid) mt.color.setHex(self.ghostColors[i2]);
          else mt.color.set('#f23f43');
        });
        if (valid) this.placeCell = [cx, cz];
      }
    }
  };

  RoomEngine.prototype._click = function () {
    this._refreshHover();
    var m = this.mode;
    if (m === 'interact') {
      if (this.hovered) {
        this._setSelected(this.hovered);
        this._activate(this.hovered);
      } else {
        this._setSelected(null);
      }
    } else if (m === 'build') {
      if (this.buildTarget) this._addVoxel(this.buildTarget.cell, this.buildColor);
    } else if (m === 'erase') {
      if (this.eraseTarget) {
        if (this.eraseTarget.voxel) {
          var mesh = this.eraseTarget.voxel;
          this._removeVoxel(keyOf(mesh.userData.cell[0], mesh.userData.cell[1], mesh.userData.cell[2]));
          this.voxelHover.visible = false;
        } else if (this.eraseTarget.furn) {
          this._removeFurn(this.eraseTarget.furn);
        }
        this.eraseTarget = null;
      }
    } else if (m === 'place') {
      if (this.placeCell) {
        var inst = this._placeFurn(this.placing.id, this.placeCell, this.placeRot);
        if (inst && this.opts.bounce) this._bounce(inst.root);
        this._refreshHover();
      }
    }
  };

  /* ---------------- frame loop ---------------- */

  RoomEngine.prototype._tick = function () {
    var dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    // smooth camera
    var k = 1 - Math.exp(-dt * 9);
    this.az += (this.azTarget - this.az) * k;
    this.zoom += (this.zoomTarget - this.zoom) * k;
    this.camera.zoom = this.zoom;
    var hr = this.dist * Math.cos(this.polar);
    this.camera.position.set(
      this.target.x + hr * Math.cos(this.az),
      this.target.y + this.dist * Math.sin(this.polar),
      this.target.z + hr * Math.sin(this.az)
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();

    // hide walls nearest the camera
    var cp = this.camera.position;
    this.walls.w.visible = cp.x >= 0;
    this.walls.e.visible = cp.x < 0;
    this.walls.n.visible = cp.z >= 0;
    this.walls.s.visible = cp.z < 0;

    // one-shot anims
    for (var i = this.anims.length - 1; i >= 0; i--) {
      var a = this.anims[i];
      a.t += dt;
      var kk = Math.min(1, a.t / a.dur);
      a.fn(a.obj, kk);
      if (kk >= 1) { if (a.done) a.done(); this.anims.splice(i, 1); }
    }

    // living widgets
    var el = this.elapsed;
    this.furniture.forEach(function (inst) {
      if (inst.def.inter === 'eq' && inst.state.on) {
        (inst.tags.bar || []).forEach(function (m, bi) {
          var s = 0.55 + Math.abs(Math.sin(el * 5 + bi * 1.4)) * 1.6;
          m.scale.y = s;
          m.position.y = m.userData.baseY - m.userData.baseH / 2 + (m.userData.baseH * s) / 2;
        });
      }
      if (inst.def.inter === 'spin' && inst.state.on) {
        (inst.tags.disc || []).forEach(function (m) { m.rotation.y += dt * 4; });
      }
    });

    this.renderer.render(this.scene, this.camera);
  };

  window.RoomEngine = RoomEngine;
})();
