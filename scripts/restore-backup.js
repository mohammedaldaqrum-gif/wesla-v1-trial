'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sourceArg = process.argv.slice(2).find(x => !x.startsWith('--'));
if (!sourceArg || sourceArg === '--help' || process.argv.includes('--help')) {
  console.log('Usage: node scripts/restore-backup.js <backup-file.db> [--root <project-folder>]');
  process.exit(sourceArg === '--help' || process.argv.includes('--help') ? 0 : 2);
}
const projectRoot = path.resolve(argValue('--root', path.resolve(__dirname, '..')));
const source = path.resolve(sourceArg);
const target = path.join(projectRoot, 'wesla_v4_8.db');
const backupDir = path.join(projectRoot, 'backups');
const requiredTables = ['users', 'orders', 'invoices', 'cash_custody'];

function ensureValidDatabase(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('ملف النسخة الاحتياطية غير موجود.');
  const d = new DatabaseSync(file);
  try {
    const integrity = d.prepare('PRAGMA integrity_check').get();
    if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('فشل فحص سلامة قاعدة البيانات.');
    const tables = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    const missing = requiredTables.filter(x => !tables.has(x));
    if (missing.length) throw new Error('النسخة لا تحتوي جداول أساسية: ' + missing.join(', '));
  } finally { d.close(); }
}
async function isWeslaListening(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 350);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {signal:controller.signal, cache:'no-store'});
    if (!response.ok) return false;
    const body = await response.text();
    return body.includes('وِصلة جملة') || body.includes('WESLA WHOLESALE');
  } catch { return false; }
  finally { clearTimeout(timer); }
}
(async () => {
  if (!fs.existsSync(projectRoot)) throw new Error('مجلد المشروع غير موجود: ' + projectRoot);
  if (source === target) throw new Error('اختر ملف نسخة احتياطية منفصلًا عن قاعدة البيانات الحالية.');
  await ensureValidDatabase(source);
  const openPorts = [];
  for (let p = 3000; p <= 3010; p++) if (await isWeslaListening(p)) openPorts.push(p);
  if (openPorts.length) {
    throw new Error('يبدو أن نسخة وِصلة جملة تعمل على المنفذ/المنافذ ' + openPorts.join(', ') +
      '. أوقف WESLA أولًا (Ctrl+C) ثم أعد الاستعادة.');
  }
  fs.mkdirSync(backupDir, {recursive:true});
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace('T','_');
  const temp = path.join(projectRoot, `.wesla_restore_${crypto.randomBytes(4).toString('hex')}.db`);
  let safety = '';
  try {
    if (fs.existsSync(target)) {
      safety = path.join(backupDir, `wesla_pre_restore_${stamp}.db`);
      const current = new DatabaseSync(target);
      try {
        current.exec(`VACUUM INTO '${safety.replace(/'/g,"''")}'`);
        current.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally { current.close(); }
    }
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
    ensureValidDatabase(temp);
    for (const suffix of ['-wal','-shm']) {
      const sidecar = target + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
    const oldTarget = fs.existsSync(target) ? path.join(backupDir, `wesla_previous_file_${stamp}.db`) : '';
    if (oldTarget) fs.renameSync(target, oldTarget);
    try { fs.renameSync(temp, target); }
    catch (e) {
      if (oldTarget && fs.existsSync(oldTarget) && !fs.existsSync(target)) fs.renameSync(oldTarget, target);
      throw e;
    }
    ensureValidDatabase(target);
    console.log('تمت استعادة قاعدة البيانات بنجاح.');
    console.log('قاعدة البيانات:', target);
    if (safety) console.log('نسخة أمان قبل الاستعادة:', safety);
    console.log('افتح WESLA من جديد. لا يمكن التراجع إلا باستعادة النسخة السابقة.');
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  }
})().catch(e => { console.error('فشلت الاستعادة:', e.message); process.exitCode = 1; });
