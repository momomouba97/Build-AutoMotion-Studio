'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { Cache } = require('../cache/cache');
const { Scanner } = require('../media/scanner');
const { ProxyService } = require('../media/proxy');
const { AudioService } = require('../audio/audio_service');
const ff = require('../media/ffmpeg');
const { resolveSettings } = require('../export/presets');
const { renderProject } = require('../rendering/renderer');
const { deserialize } = require('../project/project');

const SMOKE = process.argv.includes('--smoke-test');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536');
if (SMOKE) { app.commandLine.appendSwitch('no-sandbox'); app.disableHardwareAcceleration(); }

let win = null;
let cache, scanner, proxies, audio, config, presets;
let exportAbort = null;

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0d0e11', title: 'AutoMotion Studio', show: !SMOKE,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.on('closed', () => { win = null; });
  buildMenu();
}

function buildMenu() {
  const act = (a) => () => send('menu', a);
  const tpl = [
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: act('new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: act('open') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: act('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: act('saveAs') },
      { type: 'separator' },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: act('export') },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: act('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: act('redo') },
      { type: 'separator' },
      { label: 'Clear Cache', click: act('clearCache') },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function registerIpc() {
  ipcMain.handle('app:config', () => ({ config, presets, version: app.getVersion() }));
  ipcMain.handle('app:encoders', () => ff.detectEncoders());
  ipcMain.handle('app:reveal', (_e, p) => { shell.showItemInFolder(p); });

  ipcMain.handle('media:import', async (_e, kind) => {
    if (SMOKE && process.env.AMS_TEST_DIR) return scanner.scan([path.join(process.env.AMS_TEST_DIR, kind)], kind);
    const exts = kind === 'music' ? config.audioExtensions : config.videoExtensions;
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'music' ? 'Import music (files or folder)' : kind === 'moving' ? 'Import MOVING cars (folder or files)' : 'Import PARKED cars (folder or files)',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Media', extensions: exts }],
    });
    if (r.canceled || !r.filePaths.length) return [];
    return scanner.scan(r.filePaths, kind, (p) => send('scan:progress', { kind, ...p }));
  });
  ipcMain.handle('media:thumbs', (_e, items) => {
    scanner.requestThumbs(items, (id, p) => send('thumb:ready', { id, path: p }));
    return true;
  });
  ipcMain.handle('media:proxies', async (_e, items) => {
    await proxies.request(items, (id, p) => send('proxy:ready', { id, path: p }));
    return true;
  });
  ipcMain.handle('audio:analyze', async (_e, item) => {
    const r = await audio.analyze(item.path, (stage) => send('audio:stage', { id: item.id, stage }));
    return r.analysis;
  });

  ipcMain.handle('export:choosePath', async (_e, name, ext) => {
    if (SMOKE && process.env.AMS_TEST_DIR) return path.join(process.env.AMS_TEST_DIR, `ui-export.${ext}`);
    const r = await dialog.showSaveDialog(win, { title: 'Export video', defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('export:start', async (_e, { timeline, settings: ui, outPath, totalDur }) => {
    if (exportAbort) throw new Error('An export is already running.');
    exportAbort = new AbortController();
    try {
      const enc = await ff.detectEncoders();
      const s = resolveSettings(ui, presets, enc);
      const res = await renderProject({
        timeline, settings: s, outPath, cache, totalDur, signal: exportAbort.signal,
        onProgress: (p) => send('export:progress', Object.assign({ encoder: s.encoder }, p)),
      });
      res.warnings = s.warnings;
      cache.prune('segments', config.segmentCacheMaxMB * 1048576).catch(() => {});
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, cancelled: !!e.cancelled, error: String(e.message || e) };
    } finally { exportAbort = null; }
  });
  ipcMain.handle('export:cancel', () => { if (exportAbort) exportAbort.abort(); return true; });

  ipcMain.handle('project:save', async (_e, text, filePath, suggested) => {
    let target = filePath;
    if (!target) {
      const r = await dialog.showSaveDialog(win, { defaultPath: (suggested || 'Untitled') + '.amsproj', filters: [{ name: 'AutoMotion project', extensions: ['amsproj'] }] });
      if (r.canceled) return null;
      target = r.filePath;
    }
    await fs.promises.writeFile(target, text);
    return target;
  });
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'AutoMotion project', extensions: ['amsproj'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const text = await fs.promises.readFile(r.filePaths[0], 'utf8');
    try { return { path: r.filePaths[0], data: deserialize(text, (p) => fs.existsSync(p)) }; }
    catch (e) { return { error: String(e.message) }; }
  });
  ipcMain.handle('cache:clear', async () => { await cache.clear(); return true; });
}

app.whenReady().then(async () => {
  config = paths.loadConfig();
  presets = paths.loadPresets();
  cache = new Cache(paths.cacheDir());
  scanner = new Scanner(cache, config);
  proxies = new ProxyService(cache, config);
  audio = new AudioService(cache, config);
  registerIpc();
  createWindow();
  cache.prune('thumbs', 500 * 1048576).catch(() => {});
  cache.prune('proxy', config.cacheMaxMB * 1048576).catch(() => {});
  if (SMOKE) require('./smoke').run(win, app);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { ff.killAll(); app.quit(); });
app.on('before-quit', () => ff.killAll());
