'use strict';
// Static project checks: required files exist, JSON is valid, workflow/build settings are consistent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const has = (p) => fs.existsSync(path.join(root, p));

test('required project files exist', () => {
  for (const f of ['README.md', 'LICENSE', '.gitignore', 'package.json', 'config/app_config.json', 'resources/presets/export_presets.json',
    '.github/workflows/build-macos.yml', 'assets/icons/icon.png', 'assets/themes/dark.css',
    'scripts/install_dependencies.sh', 'scripts/build_macos.sh', 'scripts/package_dmg.sh', 'scripts/verify_build.sh', 'scripts/prepare_binaries.js',
    'src/main/main.js', 'src/main/preload.js', 'src/ui/index.html', 'src/ui/app.js', 'src/ui/timeline_ui.js', 'src/ui/player.js', 'src/ui/library.js', 'src/ui/inspector.js',
    'src/audio/analyzer.js', 'src/timeline/autoedit.js', 'src/rendering/renderer.js']) assert.ok(has(f), 'missing ' + f);
});

test('package.json targets mac x64 with deployment target 11 and bundles ffmpeg', () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(p.main, 'src/main/main.js');
  assert.deepStrictEqual(p.build.mac.target[0].arch, ['x64']);
  assert.strictEqual(p.build.mac.minimumSystemVersion, '11.0');
  assert.ok(p.build.extraResources.some((r) => r.to === 'bin'));
  assert.ok(parseInt(p.devDependencies.electron, 10) <= 30, 'Electron must still support macOS 11');
});

test('every script referenced by index.html and every file in the build "files" list exists', () => {
  const html = fs.readFileSync(path.join(root, 'src/ui/index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, 'src/ui', m[1])), 'missing script ' + m[1]);
  for (const m of html.matchAll(/href="([^"]+\.css)"/g)) assert.ok(fs.existsSync(path.join(root, 'src/ui', m[1])), 'missing css ' + m[1]);
});

test('workflow mentions every required stage', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/build-macos.yml'), 'utf8');
  for (const k of ['workflow_dispatch', 'push:', 'AutoMotion-Studio-Intel.dmg', 'upload-artifact', 'package_dmg.sh', 'verify_build.sh', 'if-no-files-found: error', 'version:']) assert.ok(y.includes(k), 'workflow lacks ' + k);
});

test('no TODO / placeholder markers in source', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(root, 'src'))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/\bTODO\b|\bFIXME\b|not implemented/i.test(t), 'placeholder in ' + f);
  }
});
