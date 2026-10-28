'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

function makeDb(file, value) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);
           CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT);
           CREATE TABLE invoices(id INTEGER PRIMARY KEY, total INTEGER);
           CREATE TABLE cash_custody(id INTEGER PRIMARY KEY, amount INTEGER);`);
  db.prepare('INSERT INTO users VALUES(1,?)').run(value);
  db.prepare('INSERT INTO orders VALUES(1,?)').run(value);
  db.prepare('INSERT INTO invoices VALUES(1,1000)').run();
  db.prepare('INSERT INTO cash_custody VALUES(1,500)').run();
  db.close();
}
test('backup restore validates integrity and preserves a pre-restore safety snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'wesla-restore-test-'));
  const backupDir = path.join(root,'backups');
  fs.mkdirSync(backupDir,{recursive:true});
  const target = path.join(root,'wesla_v4_8.db');
  const source = path.join(root,'source-backup.db');
  makeDb(source,'restored-source');
  makeDb(target,'old-target');

  const out = cp.spawnSync(process.execPath,[path.join(__dirname,'..','scripts','restore-backup.js'),source,'--root',root],{encoding:'utf8',timeout:30000});
  assert.equal(out.status,0,`restore exit=${out.status}\n${out.stdout}\n${out.stderr}`);
  const restored = new DatabaseSync(target);
  assert.equal(restored.prepare('SELECT name FROM users WHERE id=1').get().name,'restored-source');
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  restored.close();
  const backups = fs.readdirSync(backupDir);
  assert.ok(backups.some(n=>n.startsWith('wesla_pre_restore_')), 'safety backup created');
  const safety = new DatabaseSync(path.join(backupDir,backups.find(n=>n.startsWith('wesla_pre_restore_'))));
  assert.equal(safety.prepare('SELECT name FROM users WHERE id=1').get().name,'old-target');
  safety.close();
  fs.rmSync(root,{recursive:true,force:true});
});
