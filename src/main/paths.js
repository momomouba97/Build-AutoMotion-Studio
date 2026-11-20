'use strict';
// Resolves binary / cache / config locations. Works inside Electron and in plain Node (tests, CLI).
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWin = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '..');

function inElectron() {
  return !!process.versions.electron;
}

function electronApp() {
  if (!inElectron()) return null;
  try { return require('electron').app || null; } catch (_) { return null; }
}

function binDir() {
  if (process.env.AMS_BIN_DIR) return process.env.AMS_BIN_DIR;
  const app = electronApp();
  if (app && app.isPackaged && process.resourcesPath) return path.join(process.resourcesPath, 'bin');
  return path.join(ROOT, 'resources', 'bin');
}

function resolveBin(name) {
  const file = path.join(binDir(), name + (isWin ? '.exe' : ''));
  if (fs.existsSync(file)) return file;
  return name; // fall back to PATH (developer machines)
}

const ffmpegPath = () => resolveBin('ffmpeg');
const ffprobePath = () => resolveBin('ffprobe');

function cacheDir() {
  let dir = process.env.AMS_CACHE_DIR;
  if (!dir) {
    const app = electronApp();
    if (app) dir = path.join(app.getPath('userData'), 'cache');
    else dir = path.join(os.tmpdir(), 'automotion-studio-cache');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const loadConfig = () => loadJSON('config/app_config.json');
const loadPresets = () => loadJSON('resources/presets/export_presets.json');

module.exports = { ROOT, binDir, ffmpegPath, ffprobePath, cacheDir, loadConfig, loadPresets, inElectron };
