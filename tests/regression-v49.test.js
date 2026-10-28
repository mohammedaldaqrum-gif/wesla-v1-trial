'use strict';
// اختبار انحدار V4.9: يشغّل النظام فعليًا بكل سيناريوهات الدفع والتوصيل ويفحص الموازين المحاسبية والإشعارات.
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');

test('V4.9: الموازين المالية والتسوية الكاملة وصرف السائق والإشعارات', { timeout: 240000 }, () => {
  const r = cp.spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, 'audit-harness.js'), path.join(__dirname, '..')], { encoding: 'utf8', maxBuffer: 50e6 });
  assert.equal(r.status, 0, 'تعذر تشغيل أداة التدقيق: ' + r.stderr);
  const d = JSON.parse(r.stdout);
  // 1) لا فروق محاسبية: المتبقي على كل فاتورة = مجموع بنود الدين، والمدفوع = مجموع الدفعات
  assert.deepEqual(d.findings.filter((f) => f.sev !== 'info').map((f) => f.msg), [], 'توجد فروق محاسبية');
  // 2) كل فاتورة (نقدي/آجل × تحصيل نقدي/حوالة × توصيل/استلام) تُسدَّد بالكامل وتصبح paid
  for (const [k, v] of Object.entries(d.settle)) assert.ok(v === 'already paid' || /status=paid, remaining=0/.test(v), `السيناريو ${k}: ${v}`);
  // 3) السائق يُصرف له مستحقه من عهدة الخزينة (دخل الحوالات)
  assert.equal(d.payoutOk, true, 'تعذر صرف مستحق السائق من عهدة الخزينة');
  // 4) الإشعارات الحرجة موجودة
  const n = d.notif_by_step, has = (step, who) => assert.ok((n[step] || []).includes(who), `${step}: لم يُشعَر ${who}`);
  has('A cash-goods/delivery/cash-collection | claim', 'shop');
  has('A cash-goods/delivery/cash-collection | claim', 'supplier');
  has('A cash-goods/delivery/cash-collection | complete', 'shop');
  has('E credit+cash/pickup | pickup-confirm', 'supplier');
  has('G debt-payment request created', 'supplier');
  has('G debt-payment approved', 'shop');
  has('H supplier rejects order', 'shop');
});
