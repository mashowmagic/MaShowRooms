/* ============================================================
   MaShowRooms — ui.jsx
   React overlay UI · MASHOWMAGIC design tokens
   Loads after: catalog.js · engine.js · tweaks-panel.jsx
   ============================================================ */

const { useState, useEffect, useRef } = React;

// ─── Inline SVG icon paths (Lucide-compatible) ─────────────────────────
const ROOM_ICON_PATHS = {
  cursor:   '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>',
  box:      '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="3.27" y1="6.96" x2="20.73" y2="6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  eraser:   '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon:     '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  undo:     '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  reset:    '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  chevL:    '<path d="m15 18-6-6 6-6"/>',
  chevR:    '<path d="m9 18 6-6-6-6"/>',
  x:        '<path d="M18 6 6 18M6 6l12 12"/>',
};

function RoomIcon({ name, size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ROOM_ICON_PATHS[name] || '' }} />
  );
}

// ─── Micro primitives ─────────────────────────────────────────────────────
function MonoLabel({ children, style: s }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
      letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-subtle)',
      ...s
    }}>{children}</span>
  );
}

function PanelDivider() {
  return <div style={{ height: 1, background: 'var(--border)', flexShrink: 0, marginBlock: 1 }} />;
}

// ─── Hoverable icon button (top bar) ─────────────────────────────────────
function BarBtn({ icon, title, onClick, active }) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 34, height: 34, border: 'none', borderRadius: 9,
        background: active ? 'var(--accent-soft)' : hov ? 'var(--surface-2)' : 'transparent',
        color: active ? 'var(--accent)' : hov ? 'var(--fg)' : 'var(--fg-muted)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}>
      <RoomIcon name={icon} size={16} />
    </button>
  );
}

// ─── Mode button ─────────────────────────────────────────────────────────
function ModeButton({ icon, label, active, onClick }) {
  const [hov, setHov] = useState(false);
  const bg  = active ? 'var(--accent)' : hov ? 'var(--surface-2)' : 'transparent';
  const clr = active ? '#fff' : hov ? 'var(--fg)' : 'var(--fg-muted)';
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 5, padding: '9px 4px',
        background: bg, color: clr, border: 'none', borderRadius: 11,
        cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500,
        transition: 'background 0.18s, color 0.18s, transform 0.15s',
        transform: hov && !active ? 'translateY(-1px)' : 'none',
      }}>
      <RoomIcon name={icon} size={15} color={clr} />
      {label}
    </button>
  );
}

// ─── Color swatch ────────────────────────────────────────────────────────
function ColorSwatch({ color, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={() => onClick(color)} title={color}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 22, height: 22, borderRadius: 6, background: color,
        cursor: 'pointer', border: 'none', outline: 'none',
        boxShadow: active
          ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)'
          : hov ? '0 0 0 2px var(--surface), 0 0 0 3.5px var(--border-strong)' : 'none',
        transform: active || hov ? 'scale(1.18)' : 'scale(1)',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }} />
  );
}

// ─── Asset card ──────────────────────────────────────────────────────────
const CAT_EMOJI = { furniture: '🪑', tech: '💻', decor: '🪴' };

function AssetCard({ item, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} title={'Place ' + item.name}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 5, padding: '9px 6px',
        background: active ? 'var(--accent-soft)' : hov ? 'var(--surface-2)' : 'var(--surface)',
        border: '1.5px solid ' + (active ? 'var(--accent)' : hov ? 'var(--border-strong)' : 'var(--border)'),
        borderRadius: 12, cursor: 'pointer', minHeight: 62,
        boxShadow: hov ? 'var(--shadow-card)' : 'none',
        transform: hov ? 'translateY(-1px)' : 'none',
        transition: 'all 0.18s var(--ease-out)',
      }}>
      <span style={{ fontSize: 20, lineHeight: 1 }}>{CAT_EMOJI[item.cat]}</span>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 500,
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        textAlign: 'center', lineHeight: 1.25, width: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInline: 2,
      }}>{item.name}</span>
    </button>
  );
}

// ─── Left panel ──────────────────────────────────────────────────────────
function LeftPanel({ engine, mode, onMode, buildColor, onBuildColor, placing, palette, placeRot }) {
  const [cat, setCat] = useState('furniture');
  const swatches  = (palette || ROOM_PALETTES[0]).swatches;
  const items     = FURNITURE.filter(function(f) { return f.cat === cat; });
  const placingDef = placing ? FURNITURE.find(function(f) { return f.id === placing; }) : null;

  return (
    <div style={{
      position: 'absolute', left: 16, top: 16, bottom: 16, width: 244,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      {/* ── Logo ── */}
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🏠</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.025em', lineHeight: 1.1 }}>MaShowRooms</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Voxel Builder</div>
        </div>
      </div>

      {/* ── Mode toolbar ── */}
      <div style={{ padding: '10px 10px 8px', flexShrink: 0 }}>
        <MonoLabel style={{ display: 'block', marginBottom: 7, paddingLeft: 2 }}>Tools</MonoLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          <ModeButton icon="cursor" label="Select" active={mode === 'interact'} onClick={function() { engine.setMode('interact'); onMode('interact'); }} />
          <ModeButton icon="box"    label="Build"  active={mode === 'build'}    onClick={function() { engine.setMode('build');    onMode('build');    }} />
          <ModeButton icon="eraser" label="Erase"  active={mode === 'erase'}    onClick={function() { engine.setMode('erase');    onMode('erase');    }} />
        </div>
      </div>

      {/* ── Paint colour picker — build mode only ── */}
      {mode === 'build' && (
        <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
          <MonoLabel style={{ display: 'block', marginBottom: 6 }}>Paint color</MonoLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {swatches.map(function(c) {
              return <ColorSwatch key={c} color={c} active={buildColor === c} onClick={function(col) { onBuildColor(col); engine.setBuildColor(col); }} />;
            })}
          </div>
        </div>
      )}

      {/* ── Placing banner ── */}
      {placingDef && (
        <div style={{ marginInline: 10, marginBottom: 8, flexShrink: 0 }}>
          <div style={{
            padding: '7px 10px 7px 12px', background: 'var(--accent-soft)',
            borderRadius: 10, border: '1px solid var(--blurple-200)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: 'var(--accent)', lineHeight: 1.3 }}>Placing: {placingDef.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--accent)', letterSpacing: '0.06em', opacity: 0.75 }}>CLICK DROP · ESC CANCEL</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--accent)', opacity: 0.5, letterSpacing: '0.05em' }}>FACE</span>
                {[0,1,2,3].map(function(r) {
                  var arrows = ['→','↓','←','↑'];
                  var isAct  = placeRot === r;
                  return <span key={r} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: isAct ? 700 : 400, color: isAct ? 'var(--accent)' : 'rgba(88,101,242,0.25)', transition: 'color 0.15s' }}>{arrows[r]}</span>;
                })}
                <button onClick={function() { engine.rotatePlacing(); }} style={{ marginLeft: 2, padding: '2px 7px', background: 'rgba(88,101,242,0.12)', border: '1px solid var(--blurple-200)', borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--accent)' }}>R</button>
              </div>
            </div>
            <button onClick={function() { engine.cancelPlacing(); }} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'rgba(88,101,242,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <RoomIcon name="x" size={12} color="var(--accent)" />
            </button>
          </div>
        </div>
      )}

      <PanelDivider />

      {/* ── Asset palette ── */}
      <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
        <MonoLabel style={{ display: 'block', marginBottom: 8 }}>Assets</MonoLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          {['furniture', 'tech', 'decor'].map(function(c) {
            var act = cat === c;
            return (
              <button key={c} onClick={function() { setCat(c); }} style={{
                flex: 1, padding: '4px 0',
                background: act ? 'var(--accent-soft)' : 'transparent',
                border: '1px solid ' + (act ? 'var(--blurple-200)' : 'var(--border)'),
                borderRadius: 8, cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600,
                textTransform: 'capitalize',
                color: act ? 'var(--accent)' : 'var(--fg-muted)',
                transition: 'all 0.15s',
              }}>{c}</button>
            );
          })}
        </div>
      </div>

      {/* ── Asset grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 10px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {items.map(function(item) {
            return (
              <AssetCard key={item.id} item={item} active={placing === item.id}
                onClick={function() { engine.startPlacing(item.id); onMode('place'); }} />
            );
          })}
        </div>
      </div>

      {/* ── Keyboard hints ── */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {[['R','Rotate'], ['Esc','Cancel'], ['Q/E','View'], ['⏩','Zoom']].map(function(pair) {
            return (
              <span key={pair[0]} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, padding: '1px 4px', background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 4, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{pair[0]}</kbd>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, color: 'var(--fg-subtle)' }}>{pair[1]}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────
function TopBar({ engine, theme, onTheme, paletteIndex, onPalette, onReset, showTweaks, onTweaks }) {
  const [hovTheme, setHovTheme] = useState(false);

  return (
    <div style={{
      position: 'absolute', left: 276, right: 16, top: 16, height: 52,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)',
      display: 'flex', alignItems: 'center', paddingInline: 10, gap: 4,
    }}>
      <BarBtn icon="undo"  title="Undo"       onClick={function() { engine.undo(); }} />
      <BarBtn icon="reset" title="Reset room" onClick={onReset} />

      <div style={{ flex: 1 }} />

      {/* Palette selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <MonoLabel>Palette</MonoLabel>
        <div style={{ display: 'flex', gap: 5 }}>
          {ROOM_PALETTES.map(function(p, i) {
            var isAct = paletteIndex === i;
            return (
              <button key={i} title={p.name}
                onClick={function() { engine.setPalette(i); onPalette(i); }}
                style={{
                  width: 22, height: 22, borderRadius: '50%', outline: 'none',
                  background: 'conic-gradient(' + p.preview[0] + ' 0deg 120deg, ' + p.preview[1] + ' 120deg 240deg, ' + p.preview[2] + ' 240deg 360deg)',
                  border: 'none', cursor: 'pointer',
                  boxShadow: isAct ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : '0 0 0 1.5px var(--border)',
                  transform: isAct ? 'scale(1.18)' : 'scale(1)',
                  transition: 'transform 0.18s var(--ease-spring), box-shadow 0.18s',
                }} />
            );
          })}
        </div>
      </div>

      <div style={{ width: 1, height: 26, background: 'var(--border)', marginInline: 4 }} />

      {/* Theme toggle */}
      <button onClick={function() {
        var next = theme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        engine.setTheme(next);
        onTheme(next);
      }}
        onMouseEnter={function() { setHovTheme(true); }}
        onMouseLeave={function() { setHovTheme(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px',
          background: hovTheme ? 'var(--surface-2)' : 'transparent',
          border: '1px solid ' + (hovTheme ? 'var(--border-strong)' : 'var(--border)'),
          borderRadius: 10, cursor: 'pointer', color: 'var(--fg-muted)',
          fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500,
          transition: 'all 0.18s',
        }}>
        <RoomIcon name={theme === 'light' ? 'moon' : 'sun'} size={14} />
        {theme === 'light' ? 'Dark' : 'Light'}
      </button>

      <BarBtn icon="settings" title="Tweaks" onClick={onTweaks} active={showTweaks} />
    </div>
  );
}

// ─── Camera corner snap controls ─────────────────────────────────────────
var CORNER_DEFS = [
  { label: 'NW', row: 1, col: 1, azIdx: 2 },
  { label: 'NE', row: 1, col: 2, azIdx: 3 },
  { label: 'SW', row: 2, col: 1, azIdx: 1 },
  { label: 'SE', row: 2, col: 2, azIdx: 0 },
];

function CameraControls({ engine, view }) {
  return (
    <div style={{
      position: 'absolute', bottom: 20, right: 20,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, boxShadow: 'var(--shadow-card)',
      padding: '10px 10px 9px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
    }}>
      <MonoLabel>{view}</MonoLabel>

      {/* 2×2 snap grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '28px 28px', gridTemplateRows: '28px 28px', gap: 3 }}>
        {CORNER_DEFS.map(function(def) {
          var isAct = view === def.label;
          return (
            <button key={def.label} title={'View from ' + def.label}
              onClick={function() {
                engine.azIndex  = def.azIdx;
                engine.azTarget = Math.PI / 4 + def.azIdx * Math.PI / 2;
                engine.emit('view', def.label);
              }}
              style={{
                gridRow: def.row, gridColumn: def.col,
                background: isAct ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: '1.5px solid ' + (isAct ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 8, cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700,
                color: isAct ? 'var(--accent)' : 'var(--fg-subtle)',
                transition: 'all 0.15s',
              }}>{def.label}</button>
          );
        })}
      </div>

      {/* Rotate L / R */}
      <div style={{ display: 'flex', gap: 3 }}>
        {[{ dir: 1, icon: 'chevL', title: 'Rotate left (Q)' }, { dir: -1, icon: 'chevR', title: 'Rotate right (E)' }].map(function(b) {
          return (
            <button key={b.dir} title={b.title} onClick={function() { engine.rotateCamera(b.dir); }}
              style={{
                width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface-2)',
                borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--fg-muted)', transition: 'background 0.15s',
              }}
              onMouseEnter={function(e) { e.currentTarget.style.background = 'var(--border)'; }}
              onMouseLeave={function(e) { e.currentTarget.style.background = 'var(--surface-2)'; }}>
              <RoomIcon name={b.icon} size={14} />
            </button>
          );
        })}
      </div>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9, color: 'var(--fg-subtle)' }}>Scroll to zoom</span>
    </div>
  );
}

// ─── Hover tooltip ────────────────────────────────────────────────────────
var INTER_LABELS = {
  lamp:   '💡 Click to toggle light',
  screen: '🖥 Click to power on/off',
  eq:     '🎵 Click to play music',
  spin:   '💿 Click to spin',
};

function HoverTooltip({ info }) {
  if (!info) return null;
  return (
    <div style={{
      position: 'fixed', left: info.x + 14, top: info.y - 8,
      pointerEvents: 'none', zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-pop)',
      padding: '6px 11px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{info.name}</span>
      {info.inter && (
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--fg-muted)' }}>{INTER_LABELS[info.inter] || '✨ Click to interact'}</span>
      )}
    </div>
  );
}

// ─── Reset confirmation modal ─────────────────────────────────────────────
function ResetModal({ onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 8000,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '28px 32px', textAlign: 'center',
        boxShadow: 'var(--shadow-pop)', maxWidth: 300,
      }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>🏗️</div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>Reset the room?</h3>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', marginBottom: 22, lineHeight: 1.5 }}>All custom edits will be lost and the cozy bedroom will be restored.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onCancel} style={{ padding: '8px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg)' }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: '#f23f43', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: '#fff' }}>Reset</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tweaks panel content ─────────────────────────────────────────────────
function TweakContent({ engine }) {
  var defaults = {
    cameraMode: 'Snap corners',
    isoAngle:   35,
    bounce:     true,
    showGrid:   false,
  };
  var tweakResult = useTweaks(defaults);
  var tweaks   = tweakResult[0];
  var setTweak = tweakResult[1];

  useEffect(function() { if (engine) engine.setCameraVariant(tweaks.cameraMode === 'Snap corners' ? 'snap' : 'free'); }, [tweaks.cameraMode, engine]);
  useEffect(function() { if (engine) engine.setIsoAngle(tweaks.isoAngle); }, [tweaks.isoAngle, engine]);
  useEffect(function() { if (engine) engine.setBounce(tweaks.bounce); }, [tweaks.bounce, engine]);
  useEffect(function() { if (engine && engine.grid) engine.grid.visible = tweaks.showGrid; }, [tweaks.showGrid, engine]);

  return (
    <TweaksPanel>
      <TweakSection label="Camera" />
      <TweakRadio  label="Mode"       value={tweaks.cameraMode} options={['Snap corners', 'Free orbit']} onChange={function(v) { setTweak('cameraMode', v); }} />
      <TweakSlider label="Iso angle"  value={tweaks.isoAngle}   min={20} max={60} step={1} onChange={function(v) { setTweak('isoAngle', v); }} />
      <TweakSection label="Room" />
      <TweakToggle label="Bounce on click" value={tweaks.bounce}   onChange={function(v) { setTweak('bounce', v); }} />
      <TweakToggle label="Show build grid" value={tweaks.showGrid} onChange={function(v) { setTweak('showGrid', v); }} />
    </TweaksPanel>
  );
}

// ─── Selection action bar ────────────────────────────────────────────────
function SelectionBar({ info, engine }) {
  if (!info) return null;
  var hovState = useState(null); var hovBtn = hovState[0]; var setHovBtn = hovState[1];
  var emoji = CAT_EMOJI[info.cat] || '✦';
  var btns = [
    { key: 'rotate', label: '↺  Rotate', color: 'var(--fg)',   fn: function() { engine.rotateInPlace(engine.selectedInst); } },
    { key: 'move',   label: '⇄  Move',   color: 'var(--fg)',   fn: function() { engine.startMoving(engine.selectedInst);  } },
    { key: 'del',    label: '🗑  Delete', color: '#f23f43',     fn: function() { engine.deleteSelected(); } },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, boxShadow: 'var(--shadow-pop)',
      padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{emoji}</span>
      <div style={{ paddingRight: 8, borderRight: '1px solid var(--border)', minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.25 }}>{info.name}</div>
        {info.inter && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--fg-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{info.inter}</div>}
      </div>
      {btns.map(function(b) {
        var h = hovBtn === b.key;
        return (
          <button key={b.key} onClick={b.fn}
            onMouseEnter={function() { setHovBtn(b.key); }}
            onMouseLeave={function() { setHovBtn(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px',
              background: h ? 'var(--surface-2)' : 'transparent',
              border: '1px solid ' + (h ? 'var(--border-strong)' : 'var(--border)'),
              borderRadius: 8, cursor: 'pointer', color: b.color,
              fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 500,
              transition: 'all 0.15s',
            }}>{b.label}</button>
        );
      })}
      <button onClick={function() { engine._setSelected(null); }}
        style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-subtle)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RoomIcon name="x" size={12} />
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────
function RoomApp() {
  var engineRef  = useRef(null);
  var stateHooks = [useState(false), useState('interact'), useState('light'), useState(0), useState(ROOM_PALETTES[0].swatches[5]), useState(null), useState(null), useState('SE'), useState(false), useState(false)];
  var ready      = stateHooks[0][0]; var setReady      = stateHooks[0][1];
  var mode       = stateHooks[1][0]; var setMode       = stateHooks[1][1];
  var theme      = stateHooks[2][0]; var setTheme      = stateHooks[2][1];
  var paletteIdx = stateHooks[3][0]; var setPaletteIdx = stateHooks[3][1];
  var buildColor = stateHooks[4][0]; var setBuildColor = stateHooks[4][1];
  var placing    = stateHooks[5][0]; var setPlacing    = stateHooks[5][1];
  var hover      = stateHooks[6][0]; var setHover      = stateHooks[6][1];
  var view       = stateHooks[7][0]; var setView       = stateHooks[7][1];
  var showReset  = stateHooks[8][0]; var setShowReset  = stateHooks[8][1];
  var showTweaks = stateHooks[9][0]; var setShowTweaks = stateHooks[9][1];
  var _plr = useState(0);    var placeRot = _plr[0]; var setPlaceRot = _plr[1];
  var _sel = useState(null); var selected = _sel[0]; var setSelected = _sel[1];

  useEffect(function() {
    var container = document.getElementById('canvas-root');
    if (!container || engineRef.current) return;
    var eng = new RoomEngine(container, { theme: 'light', paletteIndex: 0, cameraVariant: 'snap', isoAngle: 35, bounce: true });
    eng.on('hover',   function(i) { setHover(i); });
    eng.on('view',    function(v) { setView(v); });
    eng.on('mode',    function(m) { setMode(m); });
    eng.on('placing', function(id) { setPlacing(id); setPlaceRot(0); });
    eng.on('placeRot', function(r) { setPlaceRot(r); });
    eng.on('selected', function(info) { setSelected(info); });
    engineRef.current = eng;
    window.engine = eng;
    setReady(true);
  }, []);

  var eng = engineRef.current;

  return (
    <React.Fragment>
      {/* Left panel */}
      <div style={{ pointerEvents: 'auto' }}>
        {ready && (
          <LeftPanel engine={eng} mode={mode} onMode={setMode}
            buildColor={buildColor} onBuildColor={setBuildColor}
            placing={placing} palette={ROOM_PALETTES[paletteIdx]} placeRot={placeRot} />
        )}
      </div>

      {/* Top bar */}
      {ready && (
        <div style={{ pointerEvents: 'auto' }}>
          <TopBar engine={eng} theme={theme} onTheme={setTheme}
            paletteIndex={paletteIdx} onPalette={setPaletteIdx}
            onReset={function() { setShowReset(true); }}
            showTweaks={showTweaks} onTweaks={function() { setShowTweaks(function(s) { return !s; }); }} />
        </div>
      )}

      {/* Camera snap controls */}
      {ready && (
        <div style={{ pointerEvents: 'auto' }}>
          <CameraControls engine={eng} view={view} />
        </div>
      )}

      {/* Selection action bar */}
      {selected && ready && (
        <div style={{ pointerEvents: 'auto' }}>
          <SelectionBar info={selected} engine={eng} />
        </div>
      )}

      {/* Hover tooltip — pointer-events none handled by element */}
      <HoverTooltip info={hover} />

      {/* Tweaks panel — always mounted so hook persists */}
      {ready && <TweakContent engine={eng} />}

      {/* Reset modal */}
      {showReset && ready && (
        <div style={{ pointerEvents: 'auto' }}>
          <ResetModal
            onConfirm={function() { eng.resetRoom(); setShowReset(false); }}
            onCancel={function()  { setShowReset(false); }} />
        </div>
      )}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('ui-root')).render(React.createElement(RoomApp));
