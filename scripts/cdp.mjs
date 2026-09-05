/**
 * A browser, driven straight over the Chrome DevTools Protocol.
 *
 * Node's own WebSocket talks to the Playwright headless shell that is already
 * on this machine, so there is no dependency to install and nothing between the
 * script and the browser. That last part is the point: `agent-browser` hangs on
 * launch here, and a QA run through it never returns.
 *
 * Two objects: `Cdp` is the wire, `Page` is one attached target with the four
 * things a screenshot run needs on top of it, which are reading the rendered
 * text, waiting for a phrase, resizing, and saving a PNG.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest headless shell Playwright has installed. */
export function headlessShell() {
  const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  const builds = readdirSync(root)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const exe = join(root, build, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error(`No chromium_headless_shell build under ${root}. Run: npx playwright install.`);
}

async function debuggerUrl(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body = await response.json();
      if (typeof body.webSocketDebuggerUrl === 'string') return body.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('The headless shell never opened its debugging port.');
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });
}

/** The smallest CDP client that does the job: request, reply, and events. */
export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) {
        for (const listener of this.listeners) listener(message);
        return;
      }
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  on(listener) {
    this.listeners.push(listener);
  }

  send(method, params = {}, sessionId) {
    const id = (this.nextId += 1);
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /**
   * A fresh storage partition. One browser, one context per scheme: the seeded
   * IndexedDB lives as long as the context, so the fixture is built once per
   * scheme rather than once per route.
   */
  async newPage(outDir) {
    const { browserContextId } = await this.send('Target.createBrowserContext', {
      disposeOnDetach: false,
    });
    const { targetId } = await this.send('Target.createTarget', {
      url: 'about:blank',
      browserContextId,
    });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, outDir);
    await page.call('Runtime.enable');
    await page.call('Page.enable');
    return page;
  }
}

/** Starts the shell on a scratch profile and returns the connected client. */
export async function launchBrowser({ port, profile }) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });

  const child = spawn(headlessShell(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const cdp = new Cdp(await openSocket(await debuggerUrl(port)));
  return { cdp, close: () => child.kill('SIGKILL') };
}

export class Page {
  constructor(cdp, sessionId, outDir) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.outDir = outDir;
    this.consoleErrors = [];
    cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        const description = details.exception?.description ?? '';
        this.consoleErrors.push(`exception: ${details.text} ${description}`.slice(0, 300));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        this.consoleErrors.push(`console.error: ${text}`.slice(0, 300));
      }
    });
  }

  call(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result.value;
  }

  text() {
    return this.evaluate('document.body ? document.body.innerText : ""');
  }

  setViewport({ width, height, deviceScaleFactor }) {
    return this.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
  }

  setScheme(scheme) {
    return this.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
  }

  /** An IANA zone for the page, which is what the app reads its day from. */
  setTimezone(timezoneId) {
    return this.call('Emulation.setTimezoneOverride', { timezoneId });
  }

  navigate(url) {
    return this.call('Page.navigate', { url });
  }

  /** Polls the rendered text until one of the phrases shows up, or gives up. */
  async waitForText(phrases, timeoutMs, pollMs) {
    const wanted = phrases.map((phrase) => phrase.toLowerCase());
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        last = (await this.text()) ?? '';
        const haystack = last.toLowerCase();
        if (wanted.some((phrase) => haystack.includes(phrase))) return { ok: true, text: last };
      } catch {
        /* mid-navigation: the context is gone for a moment */
      }
      await sleep(pollMs);
    }
    return { ok: false, text: last };
  }

  async capture(name, clip) {
    const params = { format: 'png' };
    if (clip !== undefined) {
      params.clip = clip;
      params.captureBeyondViewport = true;
    }
    const shot = await this.call('Page.captureScreenshot', params);
    const bytes = Buffer.from(shot.data, 'base64');
    writeFileSync(join(this.outDir, `${name}.png`), bytes);
    return { bytes: bytes.length };
  }

  /**
   * The height the page would need to show everything.
   *
   * react-native-web scrolls inside a nested element, not the document, so the
   * document is always exactly one viewport tall and `captureBeyondViewport`
   * alone returns the same crop. The overflow that matters is the tallest inner
   * scroller, and the honest full-page shot is the viewport grown to hold it.
   */
  contentHeight() {
    return this.evaluate(`(() => {
      const doc = document.documentElement.scrollHeight;
      let overflow = 0;
      for (const el of document.querySelectorAll('*')) {
        const style = getComputedStyle(el);
        if (!/(auto|scroll)/.test(style.overflowY)) continue;
        const extra = el.scrollHeight - el.clientHeight;
        if (extra > overflow) overflow = extra;
      }
      return doc + overflow;
    })()`);
  }

  /** Clicks the middle-left of a box, clear of a set row's own Edit target. */
  async clickBox(box) {
    const x = Math.round(box.x + box.width * 0.3);
    const y = Math.round(box.y + box.height / 2);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.call('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });
      await sleep(60);
    }
  }
}
