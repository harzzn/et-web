const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', protocolTimeout: 240000,
    args: ['--use-angle=metal', '--window-size=1440,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err] ' + m.text().slice(0, 140)); });
  await page.goto('http://localhost:8666/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/etweb-landing.png' });
  console.log('landing captured');
  await page.type('#callsign', 'WebRecruit');
  await page.click('#btn-online');
  console.log('clicked deploy');
  await new Promise((r) => setTimeout(r, 75000));
  await page.screenshot({ path: '/tmp/etweb-deployed.png' });
  const status = await page.$eval('#status', (el) => el.textContent);
  console.log('status: ' + status);
  await browser.close();
})();
