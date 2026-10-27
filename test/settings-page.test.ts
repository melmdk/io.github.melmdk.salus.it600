import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// Compiled to .test-build/test; the page lives in the source tree.
const html = fs.readFileSync(path.resolve(__dirname, '../../settings/index.html'), 'utf8');
// The inline script (the homey.js tag has a src attribute).
const pageScript = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

const WRONG_EUID = 'Wrong EUID: check the 16 characters on the gateway label';

/** The bits of a DOM element the page touches. */
class FakeElement {
  value = '';
  checked = false;
  textContent = '';
  className = '';
  disabled = false;
  style: Record<string, string> = {};
  private readonly listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  click(): void {
    this.listeners.get('click')?.();
  }
}

/**
 * Run the settings page's script against fake DOM elements and a fake Homey
 * settings API. `appWrites` plays the app writing a setting.
 */
function openPage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const saves: Array<{ key: string; value: Record<string, unknown> }> = [];
  const listeners: Array<(key: string) => void> = [];
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id) as FakeElement;
  };
  const homey = {
    get: (key: string, callback: (err: Error | null, value: unknown) => void) => callback(null, values.get(key) ?? null),
    set: (key: string, value: Record<string, unknown>, callback?: (err: Error | null) => void) => {
      values.set(key, value);
      saves.push({ key, value });
      callback?.(null);
    },
    on: (event: string, listener: (key: string) => void) => {
      if (event === 'settings.set') listeners.push(listener);
    },
    ready: () => undefined,
  };
  const context = vm.createContext({
    document: { getElementById: element },
    // The 45 s give-up timer never fires in these tests.
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  vm.runInContext(pageScript, context);
  (context as { onHomeyReady: (h: typeof homey) => void }).onHomeyReady(homey);

  const host = element('host');
  const euid = element('euid');
  const save = element('save');
  const status = element('status');
  return {
    host,
    euid,
    save,
    saves,
    /** The status line, or null while it is hidden. */
    statusText: () => (status.style.display === 'none' ? null : status.textContent),
    busy: () => save.disabled,
    appWrites: (key: string, value: unknown) => {
      values.set(key, value);
      listeners.forEach((listener) => listener(key));
    },
  };
}

test('the page script is found', () => {
  assert.match(pageScript, /function onHomeyReady/);
});

for (const typed of ['0123456789ABCDE', '0123456789ABCDEFG', 'GHIJKLMNOPQRSTUV', '0123-4567-89AB-CDEF', '0123456789A']) {
  test(`an EUID like "${typed}" is refused without saving`, () => {
    const page = openPage();
    page.host.value = '10.0.0.9';
    page.euid.value = typed;
    page.save.click();
    assert.equal(page.statusText(), WRONG_EUID);
    assert.deepEqual(page.saves, []);
    assert.equal(page.busy(), false);
  });
}

for (const [typed, expected] of [[' 0123 4567 89ab cdef ', '0123456789ABCDEF'], ['0123 4567 89ab', '0123456789AB']]) {
  test(`an EUID typed as "${typed}" is saved as ${expected}`, () => {
    const page = openPage();
    page.host.value = ' 10.0.0.9 ';
    page.euid.value = typed;
    page.save.click();
    assert.equal(page.saves.length, 1);
    assert.equal(page.saves[0].key, 'gateway_input');
    assert.equal(page.saves[0].value.host, '10.0.0.9');
    assert.equal(page.saves[0].value.euid, expected);
    assert.equal(page.busy(), true);
  });
}

test('an empty EUID still asks for one', () => {
  const page = openPage();
  page.host.value = '10.0.0.9';
  page.save.click();
  assert.equal(page.statusText(), 'Gateway EUID is required.');
  assert.deepEqual(page.saves, []);
});

test('the page waits for the status of its own save, not a background one', () => {
  const page = openPage({ gateway_status: { ok: true, message: 'Connected to 10.0.0.1', at: '2026-10-27T08:00:00.000Z' } });
  assert.equal(page.statusText(), 'Connected to 10.0.0.1', 'the last outcome is shown on open');

  page.host.value = '10.0.0.9';
  page.euid.value = '0123456789ABCDEF';
  page.save.click();
  const { at } = page.saves[0].value;
  assert.equal(page.busy(), true);
  assert.equal(page.statusText(), null);

  // A background reconnect of the old gateway reports while the save is being applied.
  page.appWrites('gateway_status', { ok: false, message: 'No gateway answering at 10.0.0.1', at: new Date().toISOString() });
  assert.equal(page.busy(), true, 'still waiting');
  assert.equal(page.statusText(), null, 'the background outcome is not shown as the answer');

  page.appWrites('gateway_status', { ok: true, message: 'Connected to 10.0.0.9', at: new Date().toISOString(), input: at });
  assert.equal(page.busy(), false);
  assert.equal(page.statusText(), 'Connected to 10.0.0.9');
});
