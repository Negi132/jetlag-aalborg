// Boots the real index.html + scripts inside jsdom so tests can drive the app.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// `url` opens the page at a different address (e.g. a shared-map invite);
// `beforeScripts(window)` can install fakes such as the relay before the app runs.
export function bootApp({ url = 'https://example.github.io/hideseek/', beforeScripts = null } = {}) {
  const errors = [];
  // Strip the CDN tags; local copies from node_modules are injected below.
  const page = html
    .replace(/<script src="https:[^"]*"[^>]*><\/script>/g, '')
    .replace(/<link rel="stylesheet" href="https:[^"]*"[^>]*>/g, '');
  const dom = new JSDOM(page, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url
  });
  const { window } = dom;
  window.addEventListener('error', (e) => errors.push('window error: ' + e.message));

  // jsdom lacks these; Leaflet and the app need them.
  window.SVGElement.prototype.createSVGRect = function () {};
  // The map uses Leaflet's Canvas renderer, so hand it a 2D context whose methods do nothing.
  const fakeCanvas2d = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  window.HTMLCanvasElement.prototype.getContext = () => fakeCanvas2d;
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 800, configurable: true });
  window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => 'Test zone';
  window.navigator.clipboard = { writeText: async () => {} };
  const geo = { watchCalls: 0 };
  window.navigator.geolocation = {
    watchPosition(success) {
      geo.watchCalls++;
      success({ coords: { longitude: 9.9217, latitude: 57.0488, accuracy: 18 }, timestamp: Date.now() });
      return 73;
    },
    clearWatch() {}
  };
  window.innerWidth = 1200;
  // Browser stream/compression APIs that jsdom lacks; Node has the same ones.
  for (const name of ['CompressionStream', 'DecompressionStream', 'ReadableStream']) {
    if (!window[name]) window[name] = globalThis[name];
  }
  if (beforeScripts) beforeScripts(window);

  // Run each file as a classic <script> would, so its top-level functions and
  // constants are globals the checks can reach through window.eval.
  const vmContext = dom.getInternalVMContext();
  const run = (file) => {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.basename(file) }).runInContext(vmContext);
    } catch (e) {
      errors.push(`${path.basename(file)}: ${e.message}\n${(e.stack || '').split('\n')[1] || ''}`);
    }
  };
  // Read the browser builds straight from node_modules (some packages don't export them).
  const nodeModules = path.join(ROOT, 'node_modules');
  run(path.join(nodeModules, 'leaflet/dist/leaflet-src.js'));
  run(path.join(nodeModules, '@turf/turf/turf.min.js'));
  run(path.join(nodeModules, 'proj4/dist/proj4.js'));
  // Local scripts in the same order index.html loads them.
  for (const [, src] of html.matchAll(/<script src="(?!https:)([^"?]+)[^"]*"><\/script>/g)) {
    run(path.join(ROOT, src));
  }

  const doc = window.document;
  return {
    window, doc, errors, geo,
    $: (s) => doc.querySelector(s),
    click: (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })),
    ev: (code) => window.eval(code)
  };
}

export function reporter() {
  let pass = 0, fail = 0;
  return {
    check(name, cond, extra = '') {
      if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
      else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
    },
    finish() {
      console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
      process.exit(fail ? 1 : 0);
    }
  };
}
