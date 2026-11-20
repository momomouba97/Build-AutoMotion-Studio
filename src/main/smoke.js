'use strict';
// Headless self-test used by CI/dev: loads the UI, checks it booted, exercises the preload bridge, optionally screenshots.
const fs = require('fs');
module.exports.run = function run(win, app) {
  const out = process.env.AMS_SMOKE_OUT || '/tmp/ams-smoke.json';
  const logs = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) logs.push(message); });
  win.webContents.on('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const result = await win.webContents.executeJavaScript(`(async () => {
        const r = { hasApi: !!window.ams, hasApp: !!window.App, panels: ['library','preview','inspector','timeline'].map(id => !!document.getElementById(id)) };
        r.encoders = await window.ams.encoders();
        r.selfTest = window.App && window.App.selfTest ? await window.App.selfTest() : null;
        return r;
      })()`);
      if (process.env.AMS_SMOKE_SCRIPT) {
        result.flow = await win.webContents.executeJavaScript(fs.readFileSync(process.env.AMS_SMOKE_SCRIPT, 'utf8'));
        if (process.env.AMS_SMOKE_SHOT) { const img0 = await win.webContents.capturePage(); fs.writeFileSync(process.env.AMS_SMOKE_SHOT, img0.toPNG()); }
      }
      result.consoleErrors = logs;
      fs.writeFileSync(out, JSON.stringify(result, null, 1));
      app.exit(result.consoleErrors.length || !result.hasApp ? 1 : 0);
    } catch (e) {
      fs.writeFileSync(out, JSON.stringify({ error: String(e) }));
      app.exit(2);
    }
  });
};
