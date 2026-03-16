/**
 * Garmin Connect -> ZWO Converter  v1.8
 *
 * Selector strategy (zero hashed class names):
 *  - [data-step-id]            - every step and repeat wrapper
 *  - div#N                     - repeat child container (id = repeat's step-id)
 *  - i[class*="icon-activity-"]- sport type detection
 *  - label text content        - field identification
 *  - contenteditable="false"   - workout name
 *  - textarea[id*="note"]      - description
 *  - #headerBtnRightState-edit - ZWO button injection anchor
 *  - #pageContainer (last)     - scoping root (handles double-body pages)
 */

'use strict';

// -----------------------------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------------------------

function parseTime(str) {
  if (!str) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60  + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function fmtTime(sec) {
  if (sec == null) return '?:??';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function parseZone(text) {
  if (!text) return null;
  const m = text.match(/(?:Leistungsbereich|Zone|Z)\s*(\d+)/i);
  return m ? `Z${m[1]}` : null;
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cdata(s) {
  return `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function safeComment(str) {
  return String(str ?? '')
    .replace(/--/g, '\u2013')
    .replace(/-$/,  '\u2013');
}

// -----------------------------------------------------------------------------
// Scoping root
// Always use the LAST #pageContainer.
// Falls back to walking up from the first [data-step-id] if absent.
// -----------------------------------------------------------------------------

function getPageContainer() {
  const all = document.querySelectorAll('#pageContainer');
  if (all.length) return all[all.length - 1];

  // Fallback: walk up from first step element
  const firstStep = document.querySelector('[data-step-id]');
  if (firstStep) {
    let el = firstStep.parentElement;
    while (el && el !== document.body) {
      if (el.id ||
          el.className.includes('workoutPage') ||
          el.className.includes('content')) {
        return el;
      }
      el = el.parentElement;
    }
  }
  return document.body;
}

// -----------------------------------------------------------------------------
// Metadata readers
// -----------------------------------------------------------------------------

function readWorkoutName(root) {
  const el = root.querySelector('div[contenteditable="false"]');
  return el ? el.textContent.trim() : '';
}

function readDescription(root) {
  const ta = root.querySelector('textarea[id*="note"]')
          ?? root.querySelector('textarea');
  return ta ? ta.value.trim() : '';
}

function readSportType(root) {
  const icon = root.querySelector('i[class*="icon-activity-"]');
  if (!icon) return 'cycling';
  const cls = icon.className;
  if (cls.includes('cycling') || cls.includes('bike'))  return 'cycling';
  if (cls.includes('running') || cls.includes('run'))   return 'running';
  if (cls.includes('swimming')|| cls.includes('swim'))  return 'swimming';
  if (cls.includes('walking'))                          return 'walking';
  return 'cycling';
}

// -----------------------------------------------------------------------------
// Step-title reader
// -----------------------------------------------------------------------------

function readStepTitle(stepEl) {
  const editBtn = stepEl.querySelector(
    'button[class*="editStepLink"], ' +
    'button[aria-label*="bearbeiten"], ' +
    'button[aria-label*="Edit"], ' +
    'button[aria-label*="edit"]'
  );

  if (editBtn) {
    const parent = editBtn.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === editBtn) break;
        if (child.tagName === 'DIV') {
          const text = child.textContent.trim();
          if (text && text.length <= 60) return text;
        }
      }
    }
    let node = editBtn.previousElementSibling;
    while (node) {
      if (node.tagName === 'DIV') {
        const text = node.textContent.trim();
        if (text && text.length <= 60) return text;
      }
      node = node.previousElementSibling;
    }
  }

  for (const div of stepEl.querySelectorAll('div')) {
    if (div.closest('[aria-hidden="true"]')) continue;
    if (div.closest('[role="tooltip"]'))     continue;
    if (div.querySelector('*'))              continue;
    const text = div.textContent.trim();
    if (!text || text.length > 60)           continue;
    if (/\d+\s*W/i.test(text))              continue;
    if (/löschen|delete|bearbeiten|edit/i.test(text)) continue;
    if (/^\d/.test(text))                    continue;
    return text;
  }

  return '';
}

// -----------------------------------------------------------------------------
// Step-field reader
// -----------------------------------------------------------------------------

const DURATION_LABELS = [
  'gesamtzeit', 'duration', 'dauer', 'time', 'zeit'
];
const INTENSITY_LABELS = [
  'intensitätsziel', 'intensity', 'intensitet',
  'zone', 'power', 'leistung', 'pace', 'tempo',
  'heart rate', 'herzfrequenz'
];

function readStepFields(stepEl) {
  let duration    = null;
  let zone        = null;
  let isOpenEnded = false;

  for (const div of stepEl.querySelectorAll('div')) {
    const kids = Array.from(div.children).filter(c => c.tagName === 'DIV');
    if (kids.length !== 2) continue;

    const [dataWrapper, labelDiv] = kids;
    if (labelDiv.querySelector('div')) continue;

    const labelText = labelDiv.textContent.trim().toLowerCase();
    if (!labelText || labelText.length > 80) continue;

    if (DURATION_LABELS.some(l => labelText.includes(l))) {
      const raw = dataWrapper.textContent.trim();
      if (/lap|taste|button|press/i.test(raw)) {
        isOpenEnded = true;
        duration    = null;
      } else {
        duration = parseTime(raw);
      }
    }

    if (INTENSITY_LABELS.some(l => labelText.includes(l))) {
      zone = parseZone(dataWrapper.textContent.trim());
    }
  }

  return { duration, zone, isOpenEnded };
}

// -----------------------------------------------------------------------------
// Tree builder
// -----------------------------------------------------------------------------

function directStepChildren(parent) {
  const result = [];
  (function walk(node) {
    for (const child of node.children) {
      if (child.hasAttribute('data-step-id')) result.push(child);
      else walk(child);
    }
  })(parent);
  return result;
}

function parseNode(el) {
  const stepId = el.getAttribute('data-step-id');
  const childContainer = el.querySelector(`div#${CSS.escape(stepId)}`);

  if (childContainer) {
    const countInput =
      el.querySelector('input[type="text"][aria-label*="Wiederholung"]') ??
      el.querySelector('input[type="text"][aria-label*="Repeat"]')       ??
      el.querySelector('input[type="text"]');
    const count = Math.max(1, parseInt(countInput?.value ?? '1', 10) || 1);
    const children = directStepChildren(childContainer).map(parseNode);
    return { kind: 'repeat', count, children };
  }

  const title = readStepTitle(el);
  const { duration, zone, isOpenEnded } = readStepFields(el);
  return { kind: 'step', title, duration, zone, isOpenEnded };
}

function findStepsContainer(root) {
  const allStepEls = Array.from(root.querySelectorAll('[data-step-id]'));
  if (!allStepEls.length) return null;

  const topLevel = allStepEls.filter(el => {
    let parent = el.parentElement;
    while (parent && parent !== root) {
      if (parent.hasAttribute('data-step-id')) return false;
      parent = parent.parentElement;
    }
    return true;
  });

  if (!topLevel.length) return null;
  return topLevel[0].parentElement;
}

// -----------------------------------------------------------------------------
// ZWO power table
// -----------------------------------------------------------------------------

const ZONE_POWER = {
  Z1: 0.55, Z2: 0.68, Z3: 0.83, Z4: 0.95,
  Z5: 1.08, Z6: 1.20, Z7: 1.50,
};

function zoneToPower(zone) {
  return ZONE_POWER[zone] ?? 0.75;
}

function resolvedDuration(node, fallback = 120) {
  return node.isOpenEnded ? fallback : (node.duration ?? fallback);
}

// -----------------------------------------------------------------------------
// ZWO XML serialiser
// -----------------------------------------------------------------------------

function nodeToZwoLines(node, indent) {
  const lines = [];

  if (node.kind === 'repeat') {
    const { count, children } = node;

    if (children.length === 2) {
      const on  = children[0];
      const off = children[1];
      lines.push(
        `${indent}<!-- ${safeComment(`Repeat ${count}x: [${on.title || 'on'}] / [${off.title || 'off'}]`)} -->`,
        `${indent}<IntervalsT` +
          ` Repeat="${count}"` +
          ` OnDuration="${resolvedDuration(on, 30)}"` +
          ` OffDuration="${resolvedDuration(off, 120)}"` +
          ` OnPower="${zoneToPower(on.zone).toFixed(2)}"` +
          ` OffPower="${zoneToPower(off.zone).toFixed(2)}"/>`
      );
    } else {
      lines.push(
        `${indent}<!-- ${safeComment(`Repeat ${count}x \u2013 ${children.length} steps flattened`)} -->`
      );
      for (let i = 0; i < count; i++) {
        if (count > 1) {
          lines.push(
            `${indent}<!-- ${safeComment(`iteration ${i + 1} of ${count}`)} -->`
          );
        }
        children.forEach(child => {
          nodeToZwoLines(child, indent).forEach(l => lines.push(l));
        });
      }
    }

  } else {
    const dur   = node.duration;
    const zone  = node.zone;
    const power = zoneToPower(zone);
    const label = safeComment(
      `${node.title || 'Step'} \u2013 ${fmtTime(dur)} @ ${zone ?? 'no zone'}`
    );

    if (node.isOpenEnded || zone == null) {
      const freeDur = node.isOpenEnded ? 120 : (dur ?? 120);
      const suffix  = node.isOpenEnded
        ? ' (open ended lap button)'
        : ' (no intensity zone)';
      lines.push(
        `${indent}<!-- ${label}${suffix} -->`,
        `${indent}<FreeRide Duration="${freeDur}" FlatRoad="1"/>`
      );
    } else if (dur == null) {
      lines.push(`${indent}<!-- SKIPPED: ${label} (no duration) -->`);
    } else {
      lines.push(
        `${indent}<!-- ${label} -->`,
        `${indent}<SteadyState Duration="${dur}" Power="${power.toFixed(2)}"/>`
      );
    }
  }

  return lines;
}

function buildZwo({ name, description, sportType, nodes }) {
  const workoutLines = [];
  nodes.forEach(n => nodeToZwoLines(n, '    ').forEach(l => workoutLines.push(l)));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<workout_file>',
    `  <author>Garmin Connect</author>`,
    `  <name>${escXml(name)}</name>`,
    `  <description>${cdata(description)}</description>`,
    `  <sportType>${escXml(sportType)}</sportType>`,
    `  <tags/>`,
    `  <workout>`,
    ...workoutLines,
    `  </workout>`,
    '</workout_file>',
  ].join('\n');
}

// -----------------------------------------------------------------------------
// Extract + download
// -----------------------------------------------------------------------------

function extractWorkout() {
  const root = getPageContainer();
  if (!root) {
    console.warn('[GarminZWO] No root container found');
    return null;
  }

  const name        = readWorkoutName(root);
  const description = readDescription(root);
  const sportType   = readSportType(root);
  const container   = findStepsContainer(root);

  if (!container) {
    console.warn('[GarminZWO] Steps container not found');
    return null;
  }

  const nodes = directStepChildren(container).map(parseNode);
  console.log('[GarminZWO] Extracted:', { name, sportType, nodeCount: nodes.length });
  return { name, description, sportType, nodes };
}

function downloadZwo(data) {
  const xml      = buildZwo(data);
  const safeName = data.name
    .replace(/[^\w\s\-()\u00C0-\u024F]/g, '')
    .replace(/\s+/g, '_') || 'workout';
  const filename = `${safeName}.zwo`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'),
                             { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}

// -----------------------------------------------------------------------------
// Toast notification
// -----------------------------------------------------------------------------

function toast(msg, isError = false) {
  document.getElementById('garmin-zwo-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'garmin-zwo-toast';
  Object.assign(el.style, {
    position:     'fixed',
    bottom:       '30px',
    right:        '30px',
    zIndex:       '99999',
    background:   isError ? '#c0392b' : '#27ae60',
    color:        '#fff',
    padding:      '12px 20px',
    borderRadius: '6px',
    fontFamily:   'system-ui, sans-serif',
    fontSize:     '14px',
    boxShadow:    '0 4px 12px rgba(0,0,0,.25)',
    transition:   'opacity .4s',
    opacity:      '1',
    maxWidth:     '340px',
    wordBreak:    'break-word',
  });
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 3200);
  setTimeout(() => { el.remove(); },             3700);
}

// -----------------------------------------------------------------------------
// Readiness check
// All three conditions must pass before we attempt injection or extraction.
// -----------------------------------------------------------------------------

function isWorkoutPageReady() {
  // 1. Must have at least one step
  const steps = document.querySelectorAll('[data-step-id]');
  if (!steps.length) return false;

  // 2. At least one step must have readable field content
  const hasFieldData = Array.from(steps).some(step => {
    return Array.from(step.querySelectorAll('div')).some(div => {
      const kids = Array.from(div.children).filter(c => c.tagName === 'DIV');
      if (kids.length !== 2) return false;
      const labelText = kids[1].textContent.trim().toLowerCase();
      return DURATION_LABELS.some(l => labelText.includes(l)) ||
             INTENSITY_LABELS.some(l => labelText.includes(l));
    });
  });
  if (!hasFieldData) return false;

  // 3. The workout name must be present and non-empty
  const root = getPageContainer();
  if (!root) return false;
  const name = readWorkoutName(root);
  if (!name) return false;

  return true;
}

// -----------------------------------------------------------------------------
// Button creation
// -----------------------------------------------------------------------------

function createZwoButton() {
  const btn = document.createElement('button');
  btn.id          = 'garmin-zwo-btn';
  btn.textContent = 'Download .zwo';
  btn.title       = 'Download as Zwift ZWO file';
  Object.assign(btn.style, {
    marginLeft:   '8px',
    padding:      '8px 16px',
    background:   '#11a9ed',
    color:        '#fff',
    border:       'none',
    borderRadius: '4px',
    cursor:       'pointer',
    fontWeight:   '600',
    fontSize:     '14px',
    fontFamily:   'inherit',
    lineHeight:   '1.4',
    transition:   'background .2s',
  });
  btn.addEventListener('mouseenter', () => { btn.style.background = '#0d8bbf'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#11a9ed'; });
  btn.addEventListener('click', () => {
    try {
      const data = extractWorkout();
      if (!data)              { toast('Could not extract workout data.', true); return; }
      if (!data.nodes.length) { toast('No steps found in this workout.',  true); return; }
      toast(`Downloaded: ${downloadZwo(data)}`);
    } catch (err) {
      console.error('[GarminZWO]', err);
      toast(`Error: ${err.message}`, true);
    }
  });
  return btn;
}

// -----------------------------------------------------------------------------
// Button injection
// Always appends to the right of existing header buttons.
// -----------------------------------------------------------------------------

function injectButton() {
  // Already injected and still in DOM
  if (document.getElementById('garmin-zwo-btn')) return true;

  const btn = createZwoButton();

  // Strategy 1: find the header right wrapper via the Save button's parent
  const saveBtn = document.querySelector('#headerBtnRightState-edit');
  if (saveBtn && saveBtn.parentElement) {
    const btnWrapper = document.createElement('div');
    btnWrapper.id = 'garmin-zwo-btn-wrapper';
    btnWrapper.appendChild(btn);
    saveBtn.parentElement.appendChild(btnWrapper);
    console.log('[GarminZWO] Button appended to header right wrapper.');
    return true;
  }

  // Strategy 2: find by class prefix (hashed suffix may vary)
  const headerRight = document.querySelector('[class*="headerRightWrapper"]');
  if (headerRight) {
    const btnWrapper = document.createElement('div');
    btnWrapper.id = 'garmin-zwo-btn-wrapper';
    btnWrapper.appendChild(btn);
    headerRight.appendChild(btnWrapper);
    console.log('[GarminZWO] Button appended via class prefix match.');
    return true;
  }

  // Strategy 3: floating fixed button as last resort
  btn.style.position   = 'fixed';
  btn.style.top        = '12px';
  btn.style.right      = '12px';
  btn.style.zIndex     = '99998';
  btn.style.boxShadow  = '0 2px 8px rgba(0,0,0,.3)';
  btn.style.marginLeft = '0';
  document.body.appendChild(btn);
  console.log('[GarminZWO] Button injected as floating fallback.');
  return true;
}

// -----------------------------------------------------------------------------
// Bootstrap — poll + MutationObserver for SPA navigation support
// -----------------------------------------------------------------------------

let observerActive   = false;
let lastInjectedPath = '';

function tryActivate() {
  if (!isWorkoutPageReady()) return false;
  injectButton();
  lastInjectedPath = location.pathname;
  return true;
}

function startObserver() {
  if (observerActive) return;
  observerActive = true;

  const observer = new MutationObserver(() => {
    const btn = document.getElementById('garmin-zwo-btn');

    // Page navigated to a new workout — remove stale button and re-inject
    if (btn && location.pathname !== lastInjectedPath) {
      document.getElementById('garmin-zwo-btn-wrapper')?.remove();
      btn.remove();
      lastInjectedPath = '';
    }

    // Button missing and page is ready — inject
    if (!document.getElementById('garmin-zwo-btn') && isWorkoutPageReady()) {
      injectButton();
      lastInjectedPath = location.pathname;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[GarminZWO] MutationObserver active.');
}

function bootstrap() {
  let attempts   = 0;
  const MAX      = 60;   // 60 × 500ms = 30 seconds
  const INTERVAL = 500;

  const iv = setInterval(() => {
    if (++attempts > MAX) {
      clearInterval(iv);
      startObserver();
      console.warn('[GarminZWO] Poll timed out, observer still watching.');
      return;
    }

    if (tryActivate()) {
      clearInterval(iv);
      startObserver();
      console.log(`[GarminZWO] Ready after ${attempts * INTERVAL}ms.`);
    }
  }, INTERVAL);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
