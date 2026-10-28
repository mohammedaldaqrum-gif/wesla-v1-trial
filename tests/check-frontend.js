'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'frontend', 'index.html');
if (!fs.existsSync(htmlPath)) {
  console.error('Frontend file not found:', htmlPath);
  process.exit(1);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!blocks.length) {
  console.error('No inline JavaScript blocks were found.');
  process.exit(1);
}
const tempFile = path.join(os.tmpdir(), `wesla-frontend-check-${process.pid}.js`);
try {
  fs.writeFileSync(tempFile, blocks.map(x => x[1]).join('\n;\n'), 'utf8');
  const result = spawnSync(process.execPath, ['--check', tempFile], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status || 1);
  }
  console.log(`Frontend JavaScript syntax OK (${blocks.length} script block(s)).`);
} finally {
  try { fs.unlinkSync(tempFile); } catch {}
}
