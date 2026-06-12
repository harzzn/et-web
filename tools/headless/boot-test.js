// Headless boot test: load the web client, capture console + status for N seconds.
const puppeteer = require('puppeteer-core');

const URL = process.env.ET_URL || 'http://localhost:8666/';
const SECS = Number(process.env.ET_SECS || 90);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: process.env.ET_HEADLESS === '0' ? false : 'new',
    protocolTimeout: 300000,
    args: ['--use-angle=metal', '--enable-webgl', '--window-size=1400,900'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => console.log(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

  await page.evaluateOnNewDocument(require('fs').readFileSync('/tmp/glspy.js', 'utf8'));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  let lastStatus = '';
  let keysSent = false;
  while (Date.now() - t0 < SECS * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await page.$eval('#status', (el) => el.textContent).catch(() => '?');
    if (status !== lastStatus) {
      console.log(`[status] ${status}`);
      lastStatus = status;
    }
    if (status.startsWith('FAILED')) break;
    if (!keysSent && process.env.ET_PRESS_ESC && Date.now() - t0 > Number(process.env.ET_PRESS_ESC) * 1000) {
      keysSent = true;
      await page.click('#canvas').catch(() => {});
      await page.keyboard.press('Escape');
      console.log('[harness] sent Escape');
      await new Promise((r) => setTimeout(r, 3000));
      await page.mouse.click(640, 380);
      console.log('[harness] clicked canvas (follow)');
    }
    if ((Date.now() - t0) % 20000 < 2200) {
      await page.screenshot({ path: `/tmp/etweb-${Math.round((Date.now()-t0)/1000)}s.png` }).catch((e) => console.log('[shot] ' + e.message));
    }
  }
  await page.screenshot({ path: '/tmp/etweb-shot.png' });
  await browser.close();
})();
