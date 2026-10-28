'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend', 'index.html');
const UPLOADS = path.join(ROOT, 'uploads', 'products');
const PRIVATE_UPLOADS = path.join(ROOT, 'private_uploads', 'passports');
const PRIVATE_RECEIPTS = path.join(ROOT, 'private_uploads', 'payment_receipts');
const PRIVATE_PROFILE_PHOTOS = path.join(ROOT, 'private_uploads', 'profile_photos');
const BACKUP_DIR = path.join(ROOT, 'backups');
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(PRIVATE_UPLOADS, { recursive: true });
fs.mkdirSync(PRIVATE_RECEIPTS, { recursive: true });
fs.mkdirSync(PRIVATE_PROFILE_PHOTOS, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const DB_PATH = path.join(ROOT, 'wesla_v4_8.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, password TEXT NOT NULL, salt TEXT NOT NULL,
 role TEXT NOT NULL,
 credit_limit INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
 business_name TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '',
 location_url TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, vehicle_type TEXT NOT NULL DEFAULT '', cost_per_km INTEGER NOT NULL DEFAULT 0,
 passport_path TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL DEFAULT 0, license_plate TEXT NOT NULL DEFAULT '', vehicle_make TEXT NOT NULL DEFAULT '', vehicle_model TEXT NOT NULL DEFAULT '', business_size TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL, name TEXT NOT NULL, sku TEXT NOT NULL, product_key TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL,
 stock INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, image_url TEXT NOT NULL DEFAULT '', credit_allowed INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, driver_id INTEGER,
 job_id INTEGER, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, sku TEXT NOT NULL, product_key TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL,
 total INTEGER NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','credit')), status TEXT NOT NULL DEFAULT 'pending',
 delivery_mode TEXT NOT NULL DEFAULT 'delivery', collection_method TEXT NOT NULL DEFAULT 'cash', requested_vehicle_type TEXT NOT NULL DEFAULT 'supplier', selected_vehicle_type TEXT NOT NULL DEFAULT '', delivery_quote_rate INTEGER NOT NULL DEFAULT 0,
 otp TEXT NOT NULL, otp_tries INTEGER NOT NULL DEFAULT 0, reserved_credit INTEGER NOT NULL DEFAULT 0,
 estimated_distance_km REAL NOT NULL DEFAULT 0, estimated_delivery_share INTEGER NOT NULL DEFAULT 0, estimated_app_fee_share INTEGER NOT NULL DEFAULT 0,
 distance_km REAL NOT NULL DEFAULT 0, delivery_fee_share INTEGER NOT NULL DEFAULT 0, app_fee_share INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, restock_done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orders_batch_supplier ON orders(batch_id,supplier_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_shop_sku ON orders(shop_id,sku,status);
CREATE TABLE IF NOT EXISTS delivery_jobs (
 id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
 collection_method TEXT NOT NULL DEFAULT 'cash', rep_id INTEGER, distance_km REAL NOT NULL, driver_rate_per_km INTEGER NOT NULL, goods_total INTEGER NOT NULL,
 delivery_fee INTEGER NOT NULL, driver_earning INTEGER NOT NULL, app_fee_percent REAL NOT NULL, app_fee INTEGER NOT NULL,
 rep_commission INTEGER NOT NULL DEFAULT 0, app_profit INTEGER NOT NULL DEFAULT 0, otp TEXT NOT NULL, otp_tries INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'assigned', assigned_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
 UNIQUE(batch_id,supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_driver ON delivery_jobs(driver_id,status);
CREATE TABLE IF NOT EXISTS shipment_fees (
 batch_id TEXT NOT NULL, supplier_id INTEGER NOT NULL, fee_amount INTEGER NOT NULL DEFAULT 0,
 rate_per_km INTEGER NOT NULL DEFAULT 0, distance_km REAL NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'quoted' CHECK(status IN ('quoted','voided','charged')),
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(batch_id,supplier_id)
);
CREATE TABLE IF NOT EXISTS invoices (
 id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
 collection_method TEXT NOT NULL DEFAULT 'cash', goods_total INTEGER NOT NULL DEFAULT 0, delivery_fee INTEGER NOT NULL DEFAULT 0, driver_earning INTEGER NOT NULL DEFAULT 0,
 app_fee_percent REAL NOT NULL DEFAULT 0, app_fee INTEGER NOT NULL DEFAULT 0, rep_id INTEGER, rep_commission INTEGER NOT NULL DEFAULT 0,
 app_profit INTEGER NOT NULL DEFAULT 0, distance_km REAL NOT NULL DEFAULT 0, total INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'unpaid', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(batch_id,supplier_id)
);
CREATE TABLE IF NOT EXISTS invoice_adjustments (
 id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, order_id INTEGER NOT NULL,
 adjustment_type TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
 debt_reduction INTEGER NOT NULL DEFAULT 0, refund_due INTEGER NOT NULL DEFAULT 0,
 quantity INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
 responsible TEXT NOT NULL DEFAULT '', beneficiary TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'approved', created_by INTEGER NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice ON invoice_adjustments(invoice_id,created_at);
CREATE TABLE IF NOT EXISTS invoice_lines (
 id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, sku TEXT NOT NULL, product_key TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '',
 qty INTEGER NOT NULL DEFAULT 1, method TEXT NOT NULL DEFAULT 'credit', line_total INTEGER NOT NULL DEFAULT 0, unpaid INTEGER NOT NULL DEFAULT 0,
 order_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_sku ON invoice_lines(sku,unpaid);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
 created_by INTEGER NOT NULL, confirmed_by INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL,
 reference TEXT NOT NULL DEFAULT '', collection_report_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rep_shops (
 shop_id INTEGER PRIMARY KEY, rep_id INTEGER NOT NULL, assigned_by INTEGER, commission_per_delivery INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS collection_reports (
 id INTEGER PRIMARY KEY, rep_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL,
 amount INTEGER NOT NULL, method TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
 reviewed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS debt_payment_requests (
 id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
 amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'transfer', receipt_path TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending', reviewed_by INTEGER, review_note TEXT NOT NULL DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_invoice_status ON debt_payment_requests(invoice_id,status);
CREATE TABLE IF NOT EXISTS debt_claims (
 id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', rep_id INTEGER, driver_id INTEGER,
 created_by INTEGER NOT NULL, assigned_by INTEGER, outcome TEXT NOT NULL DEFAULT '', outcome_note TEXT NOT NULL DEFAULT '',
 next_followup_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_debt_claims_status ON debt_claims(status,rep_id,driver_id);
CREATE TABLE IF NOT EXISTS debt_claim_updates (
 id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 next_followup_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_debt_claim_updates_claim ON debt_claim_updates(claim_id,created_at);
CREATE TABLE IF NOT EXISTS rep_earnings (
 id INTEGER PRIMARY KEY, rep_id INTEGER NOT NULL, shop_id INTEGER, event_type TEXT NOT NULL,
 amount INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rep_earnings_rep ON rep_earnings(rep_id,created_at);
CREATE TABLE IF NOT EXISTS cash_custody (
 id INTEGER PRIMARY KEY, parent_id INTEGER, source_user_id INTEGER NOT NULL, current_holder_id INTEGER,
 shop_id INTEGER, supplier_id INTEGER, invoice_id INTEGER, delivery_job_id INTEGER,
 amount INTEGER NOT NULL DEFAULT 0, supplier_component INTEGER NOT NULL DEFAULT 0,
 driver_component INTEGER NOT NULL DEFAULT 0, platform_component INTEGER NOT NULL DEFAULT 0,
 beneficiary_component INTEGER NOT NULL DEFAULT 0, beneficiary_user_id INTEGER, beneficiary_role TEXT NOT NULL DEFAULT '',
 purpose TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'cash', status TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, accepted_by INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_custody_holder_status ON cash_custody(current_holder_id,status);
CREATE INDEX IF NOT EXISTS idx_custody_supplier_invoice ON cash_custody(supplier_id,invoice_id,status);
CREATE TABLE IF NOT EXISTS cash_custody_events (
 id INTEGER PRIMARY KEY, custody_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, action TEXT NOT NULL,
 from_holder_id INTEGER, to_holder_id INTEGER, amount INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_custody_events ON cash_custody_events(custody_id,created_at);
CREATE TABLE IF NOT EXISTS supplier_remittances (
 id INTEGER PRIMARY KEY, custody_id INTEGER NOT NULL, source_custody_id INTEGER NOT NULL,
 supplier_id INTEGER NOT NULL, rep_id INTEGER, invoice_id INTEGER, amount INTEGER NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('transfer','cash_via_rep','cash_direct')),
 status TEXT NOT NULL DEFAULT 'awaiting_supplier_confirmation', reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 created_by INTEGER NOT NULL, confirmed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_remit_supplier ON supplier_remittances(supplier_id,status);
CREATE TABLE IF NOT EXISTS payouts (
 id INTEGER PRIMARY KEY, recipient_user_id INTEGER NOT NULL, recipient_role TEXT NOT NULL CHECK(recipient_role IN ('driver','rep')),
 amount INTEGER NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','transfer','other')),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent', reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 custody_id INTEGER, created_by INTEGER NOT NULL, confirmed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_recipient ON payouts(recipient_user_id,status);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,is_read,created_at);
CREATE TABLE IF NOT EXISTS order_change_requests (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, batch_id TEXT NOT NULL, supplier_id INTEGER NOT NULL, shop_id INTEGER NOT NULL,
 requested_by INTEGER NOT NULL, request_type TEXT NOT NULL CHECK(request_type IN ('cancel','stop','return')), reason TEXT NOT NULL,
 penalty_amount INTEGER NOT NULL DEFAULT 0, penalty_status TEXT NOT NULL DEFAULT 'not_applicable', penalty_responsible TEXT NOT NULL DEFAULT '', penalty_beneficiary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
 decision_by INTEGER, decision_note TEXT NOT NULL DEFAULT '', decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_change_requests_status ON order_change_requests(status,created_at);
CREATE TABLE IF NOT EXISTS role_definitions (
 code TEXT PRIMARY KEY, label TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '[]', is_builtin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS service_order_access (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, batch_id TEXT NOT NULL, supplier_id INTEGER NOT NULL,
 granted_by INTEGER NOT NULL, can_cancel INTEGER NOT NULL DEFAULT 1, can_stop INTEGER NOT NULL DEFAULT 1, can_return INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,batch_id,supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_service_order_access_user ON service_order_access(user_id,batch_id,supplier_id);
CREATE TABLE IF NOT EXISTS promises (
 id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
 amount INTEGER NOT NULL, due_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_by INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promises_shop ON promises(shop_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_promises_supplier ON promises(supplier_id,status,created_at);
`);

for (const [col,defn] of [['created_by','INTEGER NOT NULL DEFAULT 0'],['license_plate',"TEXT NOT NULL DEFAULT ''"],['vehicle_make',"TEXT NOT NULL DEFAULT ''"],['vehicle_model',"TEXT NOT NULL DEFAULT ''"],['profile_photo_path',"TEXT NOT NULL DEFAULT ''"],['business_size',"TEXT NOT NULL DEFAULT ''"],['job_title',"TEXT NOT NULL DEFAULT ''"]]) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${defn}`); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; } }
for (const [k,v] of [['platform_fee_percent','3'], ['route_factor','1.25'], ['rep_shop_registration_reward_mills','0'], ['rep_shop_assignment_reward_mills','0'], ['return_penalty_multiplier','1.5']]) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k,v);
}
const BUILTIN_ROLE_LABELS={owner:'المالك',shop:'المحل التجاري',supplier:'تاجر الجملة',driver:'السائق',rep:'المندوب',accountant:'المحاسب',supervisor:'المشرف',service_provider:'مقدم خدمة',subscriber:'مشترك',software_staff:'موظف برمجيات'};
for(const [code,label] of Object.entries(BUILTIN_ROLE_LABELS))db.prepare('INSERT OR IGNORE INTO role_definitions(code,label,permissions_json,is_builtin,active) VALUES(?,?,?,1,1)').run(code,label,'[]');

try { db.exec('ALTER TABLE products ADD COLUMN credit_allowed INTEGER NOT NULL DEFAULT 1'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
for (const [col,defn] of [['delivery_mode',"TEXT NOT NULL DEFAULT 'delivery'"],['requested_vehicle_type',"TEXT NOT NULL DEFAULT 'supplier'"],['selected_vehicle_type',"TEXT NOT NULL DEFAULT ''"],['delivery_quote_rate','INTEGER NOT NULL DEFAULT 0']]) { try { db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${defn}`); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; } }
for (const [table,col,defn] of [['orders','collection_method',"TEXT NOT NULL DEFAULT 'cash'"],['delivery_jobs','collection_method',"TEXT NOT NULL DEFAULT 'cash'"],['invoices','collection_method',"TEXT NOT NULL DEFAULT 'cash'"]]) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defn}`); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; } }
for (const [table,col,defn] of [['orders','restock_done','INTEGER NOT NULL DEFAULT 0'],['invoice_lines','order_id','INTEGER NOT NULL DEFAULT 0'],['order_change_requests','penalty_responsible',"TEXT NOT NULL DEFAULT ''"],['order_change_requests','penalty_beneficiary',"TEXT NOT NULL DEFAULT ''"],['cash_custody','beneficiary_component','INTEGER NOT NULL DEFAULT 0'],['cash_custody','beneficiary_user_id','INTEGER'],['cash_custody','beneficiary_role',"TEXT NOT NULL DEFAULT ''"],['products','product_key',"TEXT NOT NULL DEFAULT ''"],['orders','product_key',"TEXT NOT NULL DEFAULT ''"],['invoice_lines','product_key',"TEXT NOT NULL DEFAULT ''"],['invoice_lines','product_name',"TEXT NOT NULL DEFAULT ''"]]) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defn}`); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; } }
db.exec(`UPDATE products SET product_key=lower(trim(name)) WHERE product_key=''; UPDATE orders SET product_key=lower(trim(product_name)) WHERE product_key=''; UPDATE invoice_lines SET product_name=COALESCE((SELECT o.product_name FROM orders o JOIN invoices i ON i.batch_id=o.batch_id AND i.supplier_id=o.supplier_id WHERE i.id=invoice_lines.invoice_id AND o.sku=invoice_lines.sku ORDER BY o.id LIMIT 1),'') WHERE product_name=''; UPDATE invoice_lines SET product_key=lower(trim(product_name)) WHERE product_key='';`);
try { db.exec('ALTER TABLE invoice_lines ADD COLUMN supplier_unpaid INTEGER NOT NULL DEFAULT 0'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
db.exec(`UPDATE invoice_lines SET supplier_unpaid=COALESCE((SELECT o.total FROM orders o JOIN invoices i ON i.batch_id=o.batch_id AND i.supplier_id=o.supplier_id WHERE i.id=invoice_lines.invoice_id AND o.sku=invoice_lines.sku AND o.method='credit' ORDER BY o.id LIMIT 1),unpaid) WHERE supplier_unpaid=0 AND unpaid>0;`);

// V4.9: فواتير الحوالة القديمة كان فيها أجرة التوصيل ضمن إجمالي الفاتورة وخارج بنود الدين؛ نضيف بند دين للفرق مرة واحدة فقط.
db.exec(`INSERT INTO invoice_lines(invoice_id,supplier_id,sku,product_key,product_name,qty,method,line_total,unpaid,supplier_unpaid)
 SELECT i.id,i.supplier_id,'__delivery__','__delivery__','أجرة التوصيل',1,'transfer',i.delivery_fee,
  MIN(i.delivery_fee,(i.total-i.paid)-COALESCE((SELECT SUM(l.unpaid) FROM invoice_lines l WHERE l.invoice_id=i.id),0)),0
 FROM invoices i WHERE i.collection_method='transfer' AND i.delivery_fee>0
  AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id=i.id AND l.sku='__delivery__')
  AND (i.total-i.paid)-COALESCE((SELECT SUM(l.unpaid) FROM invoice_lines l WHERE l.invoice_id=i.id),0)>0;`);

const K = 1000; // تخزين الدينار بالمليم لتجنب أخطاء الفاصلة العائمة
const toM = v => { const n = Number(v); if (!Number.isFinite(n)) return NaN; const x = Math.round(n*K); return Number.isSafeInteger(x) ? x : NaN; };
const money = m => Number(m || 0) / K;
function addCustodyEvent(custodyId,actorId,action,fromHolder,toHolder,amount,note=''){
 db.prepare('INSERT INTO cash_custody_events(custody_id,actor_id,action,from_holder_id,to_holder_id,amount,note) VALUES(?,?,?,?,?,?,?)').run(custodyId,actorId,action,fromHolder??null,toHolder??null,amount||0,String(note||'').slice(0,500));
}
function addCustody({parentId=null,sourceUserId,currentHolderId,shopId=null,supplierId=null,invoiceId=null,deliveryJobId=null,amount,supplierComponent=0,driverComponent=0,platformComponent=0,beneficiaryComponent=0,beneficiaryUserId=null,beneficiaryRole='',purpose,method='cash',status,note='',createdBy,acceptedBy=null}){
 const id=Number(db.prepare(`INSERT INTO cash_custody(parent_id,source_user_id,current_holder_id,shop_id,supplier_id,invoice_id,delivery_job_id,amount,supplier_component,driver_component,platform_component,beneficiary_component,beneficiary_user_id,beneficiary_role,purpose,method,status,note,created_by,accepted_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(parentId,sourceUserId,currentHolderId,shopId,supplierId,invoiceId,deliveryJobId,amount,supplierComponent,driverComponent,platformComponent,beneficiaryComponent,beneficiaryUserId,beneficiaryRole,purpose,method,status,String(note||'').slice(0,500),createdBy,acceptedBy).lastInsertRowid);
 addCustodyEvent(id,createdBy,'created',null,currentHolderId,amount,note);return id;
}
function applyInvoicePayment(invoiceId,amount){
 let left=amount,supplierComponent=0;
 const lines=db.prepare('SELECT id,unpaid,COALESCE(supplier_unpaid,0) supplier_unpaid FROM invoice_lines WHERE invoice_id=? AND unpaid>0 ORDER BY id').all(invoiceId);
 for(const l of lines){if(left<=0)break;const part=Math.min(left,l.unpaid);const sellerPart=part>=l.unpaid?l.supplier_unpaid:Math.min(l.supplier_unpaid,Math.round(l.supplier_unpaid*part/l.unpaid));db.prepare('UPDATE invoice_lines SET unpaid=unpaid-?,supplier_unpaid=MAX(0,supplier_unpaid-?) WHERE id=?').run(part,sellerPart,l.id);left-=part;supplierComponent+=sellerPart;}
 if(left>0)bad('تعذر تخصيص المبلغ إلى بنود الدين');return supplierComponent;
}
function createRepEarning(repId,shopId,eventType,amount,createdBy,note=''){
 if(!repId||!amount||amount<=0)return null;
 return Number(db.prepare('INSERT INTO rep_earnings(rep_id,shop_id,event_type,amount,note,created_by) VALUES(?,?,?,?,?,?)').run(repId,shopId,eventType,amount,String(note||'').slice(0,250),createdBy).lastInsertRowid);
}
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') });
const same = (a,b) => { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const tmpPw = () => crypto.randomBytes(6).toString('hex');
const norm = s => String(s || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
class AppError extends Error {}
const bad = m => { throw new AppError(m); };
const log = (uid, action, detail='') => db.prepare('INSERT INTO audit(user_id,action,detail) VALUES(?,?,?)').run(uid || null, action, String(detail).slice(0,500));
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const out=fn(); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } };
const setting = key => Number(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || 0);
const hashFile = (dataUrl, folder, prefix) => {
  if (!dataUrl) return '';
  if (typeof dataUrl !== 'string' || dataUrl.length > 1_000_000) bad('حجم الصورة أكبر من المسموح (حوالي 700 كيلوبايت)');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) bad('الصورة يجب أن تكون PNG أو JPG أو WEBP');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const b = Buffer.from(m[2], 'base64');
  if (!b.length || b.length > 700_000) bad('حجم الصورة أكبر من المسموح');
  const signatureOk = (ext==='png' && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (ext==='jpg' && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) ||
    (ext==='webp' && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP');
  if (!signatureOk) bad('محتوى الصورة لا يطابق نوع الملف');
  fs.mkdirSync(folder,{recursive:true});
  const name = prefix + '-' + crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(folder,name),b,{flag:'wx'});
  return name;
};
const imageData = (file, folder) => {
  if (!file) return null;
  const full=path.join(folder,path.basename(file));
  if (!fs.existsSync(full)) return null;
  const ext=path.extname(full).toLowerCase(); const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
};
const validMap = v => { const s=String(v||'').trim(); if (!s) return ''; if(s.length>500 || !/^https:\/\//i.test(s)) bad('رابط الموقع يجب أن يبدأ بـ https://'); return s; };
function coordsFromMap(url){const s=String(url||'');const patterns=[/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,/[?&](?:q|query|center|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/];for(const re of patterns){const m=s.match(re);if(m){const lat=Number(m[1]),lng=Number(m[2]);if(Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180)return{lat,lng};}}return null;}
const validCoord = (v, min, max) => { if(v===undefined || v===null || v==='') return null; const n=Number(v); if(!Number.isFinite(n)||n<min||n>max) bad('إحداثيات الموقع غير صحيحة'); return n; };
function distanceKm(a,b){
  if(a?.lat==null||a?.lng==null||b?.lat==null||b?.lng==null) return null;
  const rad=x=>x*Math.PI/180, dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return Math.max(0,2*6371*Math.asin(Math.sqrt(Math.min(1,x)))*setting('route_factor'));
}
const VEHICLE_TYPES = new Set(['small','medium','large']);
const vehicleLabel = t => ({small:'حمولة صغيرة',medium:'حمولة متوسطة',large:'حمولة كبيرة',supplier:'يحدد المورد'})[t] || 'غير محدد';
const driverRateMin = () => db.prepare("SELECT MIN(cost_per_km) r FROM users WHERE role='driver' AND active=1 AND cost_per_km>0").get().r || 0;
const quoteRateForType = type => {
 const row = type && VEHICLE_TYPES.has(type) ? db.prepare("SELECT MAX(cost_per_km) r FROM users WHERE role='driver' AND active=1 AND cost_per_km>0 AND vehicle_type=?").get(type) : db.prepare("SELECT MAX(cost_per_km) r FROM users WHERE role='driver' AND active=1 AND cost_per_km>0 AND vehicle_type IN ('small','medium','large')").get();
 return Number(row?.r || 0);
};
const alloc = (total, items, weightFn=x=>x.total) => {
  const sum=items.reduce((s,x)=>s+weightFn(x),0); let allocated=0;
  return items.map((x,i)=>{ const part=i===items.length-1?total-allocated:(sum>0?Math.floor(total*weightFn(x)/sum):0); allocated+=part; return part; });
};
const debtOf = shopId => Number(db.prepare('SELECT COALESCE(SUM(unpaid),0) n FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.shop_id=?').get(shopId).n||0);
const activeCredit = shopId => Number(db.prepare("SELECT COALESCE(SUM(reserved_credit),0) n FROM orders WHERE shop_id=? AND method='credit' AND status IN ('pending','ready','shipping')").get(shopId).n||0);
const creditInfo = u => { const debt=debtOf(u.id), reserved=activeCredit(u.id); return {limit:u.credit_limit,debt,reserved,available:u.credit_limit-debt-reserved}; };

// نسخ SQLite متسق من قاعدة نشطة. لا ننسخ ملف DB الخام لأن SQLite قد يستخدم WAL.
function createDatabaseBackup(prefix='manual') {
 const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace('T','_');
 let target=path.join(BACKUP_DIR,`wesla_${prefix}_${stamp}.db`);
 if(fs.existsSync(target)) target=path.join(BACKUP_DIR,`wesla_${prefix}_${stamp}_${crypto.randomBytes(3).toString('hex')}.db`);
 const escaped=target.replace(/'/g,"''");
 db.exec(`VACUUM INTO '${escaped}'`);
 const files=fs.readdirSync(BACKUP_DIR)
  .filter(n=>/^wesla_(auto|manual|shutdown)_.*\.db$/.test(n))
  .map(n=>({name:n,full:path.join(BACKUP_DIR,n),mtime:fs.statSync(path.join(BACKUP_DIR,n)).mtimeMs}))
  .sort((a,b)=>b.mtime-a.mtime);
 for(const f of files.slice(20)) { try{fs.unlinkSync(f.full);}catch{} }
 log(null,'database_backup',path.basename(target));
 return {file:path.basename(target),bytes:fs.statSync(target).size,created_at:new Date().toISOString()};
}
function backupList() {
 return fs.readdirSync(BACKUP_DIR)
  .filter(n=>/^wesla_(auto|manual|shutdown)_.*\.db$/.test(n))
  .map(name=>{const st=fs.statSync(path.join(BACKUP_DIR,name));return{name,bytes:st.size,modified_at:st.mtime.toISOString()};})
  .sort((a,b)=>b.modified_at.localeCompare(a.modified_at));
}

const routes = new Map();
const def = (p, roles, fn) => routes.set(p,{roles,fn});
const ALL_AUTH_ROLES=['owner','supplier','shop','driver','rep','accountant','supervisor','service_provider','software_staff','subscriber'];
function notify(userId,eventType,title,message='',link=''){
 if(!userId)return null;
 return Number(db.prepare('INSERT INTO notifications(user_id,event_type,title,message,link) VALUES(?,?,?,?,?)').run(Number(userId),String(eventType),String(title).slice(0,140),String(message).slice(0,500),String(link).slice(0,250)).lastInsertRowid);
}
function notifyRole(role,eventType,title,message='',link=''){
 const rows=db.prepare('SELECT id FROM users WHERE role=? AND active=1').all(role);
 for(const r of rows)notify(r.id,eventType,title,message,link);
}
function notifyOwnerAndAccountants(eventType,title,message='',link=''){
 for(const r of db.prepare("SELECT id FROM users WHERE role IN ('owner','accountant') AND active=1").all())notify(r.id,eventType,title,message,link);
}

const restoreOnce = o => {
 const already = db.prepare('SELECT restock_done FROM orders WHERE id=?').get(Number(o.id));
 if (!already || Number(already.restock_done) === 1) return false;
 const guard = db.prepare('UPDATE orders SET restock_done=1 WHERE id=? AND restock_done=0').run(Number(o.id));
 if (!guard.changes) return false;
 db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(Number(o.qty),Number(o.product_id));
 return true;
};
function maybeVoidShipmentFee(batchId,supplierId){
 const fee=db.prepare('SELECT * FROM shipment_fees WHERE batch_id=? AND supplier_id=?').get(String(batchId),Number(supplierId));
 if(!fee||fee.status!=='quoted')return false;
 const remaining=db.prepare("SELECT COUNT(*) n FROM orders WHERE batch_id=? AND supplier_id=? AND delivery_mode='delivery' AND status NOT IN ('cancelled','returned','stopped')").get(String(batchId),Number(supplierId)).n;
 const job=db.prepare('SELECT id FROM delivery_jobs WHERE batch_id=? AND supplier_id=?').get(String(batchId),Number(supplierId));
 if(Number(remaining)===0&&!job){
  db.prepare("UPDATE shipment_fees SET status='voided' WHERE batch_id=? AND supplier_id=? AND status='quoted'").run(String(batchId),Number(supplierId));
  return true;
 }
 return false;
}
function rebalanceQuotedShipmentFee(batchId,supplierId){
 const fee=db.prepare("SELECT fee_amount,status FROM shipment_fees WHERE batch_id=? AND supplier_id=?").get(String(batchId),Number(supplierId));
 if(!fee||fee.status!=='quoted')return;
 const active=db.prepare("SELECT * FROM orders WHERE batch_id=? AND supplier_id=? AND delivery_mode='delivery' AND status IN ('pending','ready') AND job_id IS NULL ORDER BY id").all(String(batchId),Number(supplierId));
 if(!active.length){maybeVoidShipmentFee(batchId,supplierId);return;}
 const shares=alloc(Number(fee.fee_amount||0),active);
 active.forEach((o,i)=>db.prepare('UPDATE orders SET estimated_delivery_share=? WHERE id=?').run(shares[i],o.id));
}
const PENALTY_RULES={
 driver_delay:{responsible:'driver',penalty:false,beneficiary:''},
 app_error:{responsible:'platform',penalty:true,beneficiary:'supplier'},
 shop_error:{responsible:'shop',penalty:true,beneficiary:'supplier'},
 supplier_error:{responsible:'supplier',penalty:true,beneficiary:'shop'}
};
const mustRole = (u, role) => { if(u.role!==role) bad('غير مسموح'); };

// مالك افتراضي آمن: كلمة مرور عشوائية، تظهر في سجل أول تشغيل فقط.
if (!db.prepare("SELECT id FROM users WHERE role='owner'").get()) {
  const pw=tmpPw(),{salt,hash}=hashPw(pw);
  db.prepare("INSERT INTO users(name,phone,password,salt,role,must_change) VALUES('المالك','0000',?,?,'owner',1)").run(hash,salt);
  console.log('\n==============================\nحساب المالك: 0000\nكلمة المرور المؤقتة: '+pw+'\nسيُطلب تغييرها عند الدخول الأول.\n==============================\n');
}
setInterval(()=>db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()),3600000).unref();
const failedLogins=new Map();

// RBAC قابل للتوسع: الأدوار المخصصة تبدأ بلا صلاحيات، ويمنحها المالك أقل مجموعة لازمة.
const CUSTOM_PERMISSION_ALLOWLIST=new Set(['users/list','orders/get','invoices/list','notifications/list','notifications/unread-count','notifications/read','notifications/read-all','cash-custody/list','cash-custody/owner-receive','supplier-remittances/list','payouts/list','collections/list','collections/review','debt-payments/list','debt-payments/receipt','debt-payments/review','order-change-requests/list','order-change-requests/review','debt-claims/list','debt-claims/history','rep/shops','rep/stats','rep/earnings','delivery/list']);
def('roles/list',ALL_AUTH_ROLES,(d,u)=>u.role==='owner'?db.prepare('SELECT code,label,is_builtin,active,permissions_json FROM role_definitions WHERE active=1 ORDER BY is_builtin DESC,label').all():db.prepare('SELECT code,label,is_builtin,active FROM role_definitions WHERE active=1 ORDER BY is_builtin DESC,label').all());
def('roles/create',['owner'],(d,u)=>{
 const code=String(d.code||'').trim().toLowerCase(),label=String(d.label||'').trim();if(!/^[a-z][a-z0-9_]{2,39}$/.test(code)||label.length<2||label.length>70)bad('أدخل رمز دور بالإنجليزية (3–40 حرفًا) واسمًا عربيًا واضحًا');
 if(BUILTIN_ROLE_LABELS[code])bad('رمز الدور محجوز لدور أساسي');const perms=Array.isArray(d.permissions)?[...new Set(d.permissions.map(String))]:[];if(perms.some(x=>!CUSTOM_PERMISSION_ALLOWLIST.has(x)))bad('تحتوي الصلاحيات على إجراء غير مسموح بتفويضه لدور مخصص');
 db.prepare('INSERT INTO role_definitions(code,label,permissions_json,is_builtin,active) VALUES(?,?,?,0,1)').run(code,label,JSON.stringify(perms));log(u.id,'role_create',code);return{success:true};
});
def('roles/permissions/update',['owner'],(d,u)=>{
 const code=String(d.code||''),r=db.prepare('SELECT * FROM role_definitions WHERE code=?').get(code);if(!r||r.is_builtin)bad('يمكن تعديل صلاحيات الأدوار المخصصة فقط من هذه الشاشة');const perms=Array.isArray(d.permissions)?[...new Set(d.permissions.map(String))]:[];if(perms.some(x=>!CUSTOM_PERMISSION_ALLOWLIST.has(x)))bad('تحتوي الصلاحيات على إجراء غير مسموح');db.prepare('UPDATE role_definitions SET permissions_json=? WHERE code=?').run(JSON.stringify(perms),code);log(u.id,'role_permissions_update',code+':'+perms.join(','));return{success:true};
});

def('login','public',(d,_u,ctx)=>{
  const phone=String(d.phone||''),key=ctx.ip+'|'+phone,f=failedLogins.get(key);
  if(f&&f.count>=5&&f.until>Date.now())bad('محاولات كثيرة؛ حاول بعد 10 دقائق');
  const u=db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if(!u||!u.active||!same(hashPw(String(d.password||''),u.salt).hash,u.password)){
    const count=(f?.count||0)+1;failedLogins.set(key,{count,until:Date.now()+600000});bad('بيانات الدخول غير صحيحة');
  }
  failedLogins.delete(key); const token=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+86400000);
  ctx.setCookie(`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);log(u.id,'login');
  return {success:true,user:{id:u.id,name:u.name,role:u.role},must_change:!!u.must_change};
});
def('logout',null,(d,u,ctx)=>{if(ctx.token)db.prepare('DELETE FROM sessions WHERE token=?').run(ctx.token);ctx.setCookie('session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return{success:true};});
def('me',null,(d,u)=>{
 const p=db.prepare('SELECT business_name,contact_name,contact_phone,location_url,lat,lng,vehicle_type,cost_per_km,credit_limit,license_plate,vehicle_make,vehicle_model,passport_path,profile_photo_path,business_size,job_title FROM users WHERE id=?').get(u.id)||{};
 const user={id:u.id,name:u.name,phone:u.phone,role:u.role,member_code:'WS-'+String(u.id).padStart(6,'0'),business_name:p.business_name,contact_name:p.contact_name,contact_phone:p.contact_phone,location_url:p.location_url,lat:p.lat,lng:p.lng,business_size:p.business_size,job_title:p.job_title,has_passport:!!p.passport_path,has_profile_photo:!!p.profile_photo_path,must_change:!!u.must_change};
 if(u.role==='shop')user.credit_limit=money(p.credit_limit);
 if(['driver','rep'].includes(u.role)){user.vehicle_type=p.vehicle_type;user.license_plate=p.license_plate;user.vehicle_make=p.vehicle_make;user.vehicle_model=p.vehicle_model;}
 if(u.role==='driver')user.cost_per_km=money(p.cost_per_km);
 return {success:true,user,must_change:!!u.must_change};
});
def('password/change',null,(d,u,ctx)=>{
  const old=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);if(!same(hashPw(String(d.old||''),old.salt).hash,old.password))bad('كلمة المرور الحالية خاطئة');
  const next=String(d.new||'');if(next.length<8)bad('كلمة المرور الجديدة يجب ألا تقل عن 8 خانات');if(next===d.old)bad('اختر كلمة مرور مختلفة');
  const {salt,hash}=hashPw(next);db.prepare('UPDATE users SET password=?,salt=?,must_change=0 WHERE id=?').run(hash,salt,u.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(u.id,ctx.token);log(u.id,'password_change');return{success:true};
});

// المالك وإعدادات المنصة
def('backup/list',['owner'],()=>({backups:backupList(),retention:20}));
def('backup/create',['owner'],()=>createDatabaseBackup('manual'));

def('stats',['owner'],()=>({
 users:db.prepare('SELECT role,COUNT(*) n FROM users GROUP BY role').all(),
 orders:db.prepare('SELECT status,COUNT(*) n FROM orders GROUP BY status').all(),
 sales:db.prepare("SELECT COALESCE(SUM(total),0) n FROM invoices").get().n,
 debt:db.prepare('SELECT COALESCE(SUM(unpaid),0) n FROM invoice_lines').get().n,
 appProfit:db.prepare("SELECT COALESCE(SUM(app_profit),0) n FROM invoices").get().n,
 appRevenue:db.prepare("SELECT COALESCE(SUM(app_fee),0) n FROM invoices").get().n,
 projectedAppProfit:db.prepare("SELECT COALESCE(SUM(app_profit),0) n FROM delivery_jobs WHERE status='assigned'").get().n,
 deliveryFees:db.prepare("SELECT COALESCE(SUM(delivery_fee),0) n FROM invoices").get().n,
 cashHeld:db.prepare("SELECT COALESCE(SUM(amount),0) n FROM cash_custody WHERE status IN ('held_by_driver','held_by_rep','awaiting_owner_receipt','held_by_owner','held_by_rep_for_supplier','awaiting_supplier_confirmation')").get().n,
 supplierRemittancePending:db.prepare("SELECT COALESCE(SUM(amount),0) n FROM supplier_remittances WHERE status IN ('with_rep','awaiting_supplier_confirmation')").get().n,
 driverEarnings:db.prepare("SELECT COALESCE(SUM(driver_earning),0) n FROM delivery_jobs WHERE status='delivered'").get().n,
 repCommission:0,
 repRewards:db.prepare('SELECT COALESCE(SUM(amount),0) n FROM rep_earnings').get().n,
 aging:db.prepare(`SELECT CASE WHEN julianday('now')-julianday(i.created_at)<31 THEN '0-30' WHEN julianday('now')-julianday(i.created_at)<61 THEN '31-60' WHEN julianday('now')-julianday(i.created_at)<91 THEN '61-90' ELSE '90+' END bucket,COALESCE(SUM(l.unpaid),0) amount FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.unpaid>0 GROUP BY bucket ORDER BY MIN(julianday(i.created_at))`).all()
}));
def('settings/get',['owner'],()=>({platform_fee_percent:setting('platform_fee_percent'),route_factor:setting('route_factor'),driver_rate_min:money(driverRateMin()),rep_shop_registration_reward:money(setting('rep_shop_registration_reward_mills')),rep_shop_assignment_reward:money(setting('rep_shop_assignment_reward_mills')),return_penalty_multiplier:setting('return_penalty_multiplier')||1.5}));
def('settings/update',['owner'],(d,u)=>{
 const fee=Number(d.platform_fee_percent),factor=Number(d.route_factor);
 if(!Number.isFinite(fee)||fee<0||fee>30)bad('نسبة التطبيق يجب أن تكون بين 0 و30%');
 if(!Number.isFinite(factor)||factor<1||factor>3)bad('معامل تقدير المسافة يجب أن يكون بين 1 و3');
 const reg=d.rep_shop_registration_reward===undefined?setting('rep_shop_registration_reward_mills'):toM(d.rep_shop_registration_reward);
 const assign=d.rep_shop_assignment_reward===undefined?setting('rep_shop_assignment_reward_mills'):toM(d.rep_shop_assignment_reward);
 const penalty=Number(d.return_penalty_multiplier??setting('return_penalty_multiplier')??1.5);
 if(!Number.isSafeInteger(reg)||reg<0||reg>1000000000||!Number.isSafeInteger(assign)||assign<0||assign>1000000000)bad('مكافآت المندوب يجب أن تكون قيمًا موجبة وصحيحة');
 if(!Number.isFinite(penalty)||penalty<1||penalty>5)bad('معامل غرامة الإرجاع يجب أن يكون بين 1 و5');
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(fee),'platform_fee_percent');db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(factor),'route_factor');
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(reg),'rep_shop_registration_reward_mills');db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(assign),'rep_shop_assignment_reward_mills');
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(penalty),'return_penalty_multiplier');
 log(u.id,'settings_update',JSON.stringify({fee,factor,reg,assign}));return{success:true};
});
// صورة الملف الشخصي خاصة، ولا تظهر إلا لصاحبها أو للمالك أو للمندوب الذي أنشأ الحساب.
def('me/profile-photo/update',null,(d,u)=>{
 if(!d.profile_photo_image)bad('اختر صورة شخصية');const file=hashFile(d.profile_photo_image,PRIVATE_PROFILE_PHOTOS,'profile');if(!file)bad('تعذر حفظ الصورة');const old=db.prepare('SELECT profile_photo_path FROM users WHERE id=?').get(u.id)?.profile_photo_path||'';db.prepare('UPDATE users SET profile_photo_path=? WHERE id=?').run(file,u.id);if(old)try{fs.unlinkSync(path.join(PRIVATE_PROFILE_PHOTOS,old));}catch{}log(u.id,'profile_photo_update');return{success:true};
});
def('users/profile-photo',ALL_AUTH_ROLES,(d,u)=>{
 const t=db.prepare('SELECT id,role,created_by,profile_photo_path,name FROM users WHERE id=?').get(Number(d.id));if(!t)bad('الحساب غير موجود');const allowed=u.role==='owner'||t.id===u.id||(u.role==='rep'&&t.created_by===u.id);if(!allowed)bad('لا تملك صلاحية عرض هذه الصورة');const image=imageData(t.profile_photo_path,PRIVATE_PROFILE_PHOTOS);return{success:true,image,name:t.name};
});
def('users/member-card',ALL_AUTH_ROLES,(d,u)=>{
 const t=db.prepare('SELECT id,name,phone,role,business_name,contact_name,contact_phone,location_url,vehicle_type,license_plate,vehicle_make,vehicle_model,created_by,profile_photo_path,active FROM users WHERE id=?').get(Number(d.id));if(!t)bad('الحساب غير موجود');const allowed=u.role==='owner'||t.id===u.id||(u.role==='rep'&&t.created_by===u.id);if(!allowed)bad('لا تملك صلاحية طباعة هذه البطاقة');return{success:true,member:{...t,member_code:'WS-'+String(t.id).padStart(6,'0'),profile_photo:imageData(t.profile_photo_path,PRIVATE_PROFILE_PHOTOS)}};
});
// يسمح لكل مستخدم (بما في ذلك المالك الافتراضي) بإرفاق جوازه بنفسه بعد الموافقة.
def('me/passport/update',null,(d,u)=>{
 if(d.passport_consent!==true)bad('أكد موافقتك على حفظ مستند الهوية لغرض التحقق');
 if(!d.passport_image)bad('اختر صورة جواز السفر أولًا');
 const file=hashFile(d.passport_image,PRIVATE_UPLOADS,'passport');if(!file)bad('تعذر حفظ صورة جواز السفر');
 const old=db.prepare('SELECT passport_path FROM users WHERE id=?').get(u.id)?.passport_path||'';
 db.prepare('UPDATE users SET passport_path=? WHERE id=?').run(file,u.id);
 if(old)try{fs.unlinkSync(path.join(PRIVATE_UPLOADS,old));}catch{}
 log(u.id,'own_passport_update');return{success:true,has_passport:true};
});

def('users/list',['owner','rep','accountant'],(d,u)=>{
 const rows=u.role==='owner'
  ? db.prepare(`SELECT x.id,x.name,x.phone,x.role,x.credit_limit,x.active,x.business_name,x.contact_name,x.contact_phone,x.location_url,x.lat,x.lng,x.vehicle_type,x.cost_per_km,x.license_plate,x.vehicle_make,x.vehicle_model,x.business_size,x.job_title,x.created_at,x.created_by,c.name creator_name,CASE WHEN x.passport_path<>'' THEN 1 ELSE 0 END has_passport,CASE WHEN x.profile_photo_path<>'' THEN 1 ELSE 0 END has_profile_photo FROM users x LEFT JOIN users c ON c.id=x.created_by WHERE x.role<>'owner' ORDER BY x.role,x.name`).all()
  : u.role==='accountant'
   ? db.prepare(`SELECT id,name,phone,role,active,business_name,business_size,job_title,created_at,created_by FROM users WHERE role<>'owner' ORDER BY role,name`).all()
   : db.prepare(`SELECT x.id,x.name,x.phone,x.role,x.active,x.business_name,x.contact_name,x.contact_phone,x.location_url,x.lat,x.lng,x.vehicle_type,x.license_plate,x.vehicle_make,x.vehicle_model,x.business_size,x.job_title,x.created_at,x.created_by,CASE WHEN x.passport_path<>'' THEN 1 ELSE 0 END has_passport,CASE WHEN x.profile_photo_path<>'' THEN 1 ELSE 0 END has_profile_photo FROM users x WHERE x.created_by=? AND x.role IN ('supplier','shop','driver') ORDER BY x.role,x.name`).all(u.id);
 return rows.map(x=>{const out={...x};if(u.role==='owner'){out.credit_limit_dinar=money(x.credit_limit);out.cost_per_km_dinar=money(x.cost_per_km);}else{delete out.credit_limit;delete out.cost_per_km;}return out;});
});
def('users/add',['owner','rep'],(d,u)=>{
 const name=String(d.name||'').trim(),phone=String(d.phone||'').trim(),role=String(d.role||'');
 if(name.length<2||name.length>80)bad('الاسم الكامل مطلوب (من حرفين إلى 80 حرفًا)');
 if(!/^\+?[0-9]{4,18}$/.test(phone))bad('رقم الهاتف يجب أن يتكون من 4 إلى 18 رقمًا، ويمكن أن يبدأ بعلامة +');
 if(!db.prepare('SELECT code FROM role_definitions WHERE code=? AND active=1').get(role))bad('نوع الحساب غير صالح أو غير معتمد');
 const businessSize=['shop','supplier'].includes(role)?String(d.business_size||'small'):'';
 if(['shop','supplier'].includes(role)&&!['small','medium','large'].includes(businessSize))bad('اختر تصنيف النشاط: صغير أو متوسط أو كبير');
 const jobTitle=(['accountant','supervisor','software_staff'].includes(role)||String(d.job_title||'').trim())?String(d.job_title||'').trim().slice(0,80):'';
 if(['accountant','supervisor','software_staff'].includes(role)&&jobTitle.length<2)bad('حدد المسمى الوظيفي للموظف');
 if(u.role==='rep'&&!['supplier','shop','driver'].includes(role))bad('يمكن لمندوب المتابعة تسجيل المحال والموردين والسائقين فقط');
 if(u.role==='rep'&&(toM(d.cost_per_km||0)>0||toM(d.credit_limit||0)>0))bad('الحد الائتماني وتعرفة السائق يحددهما المالك فقط');
 if(d.passport_consent!==true)bad('يجب تأكيد موافقة صاحب الحساب على حفظ صورة جواز السفر لأغراض التحقق');
 const passport=hashFile(d.passport_image,PRIVATE_UPLOADS,'passport');if(!passport)bad('صورة جواز السفر مطلوبة لكل حساب جديد');const profilePhoto=d.profile_photo_image?hashFile(d.profile_photo_image,PRIVATE_PROFILE_PHOTOS,'profile'):'';
 const business=String(d.business_name||'').trim(),contact=String(d.contact_name||'').trim(),contactPhone=String(d.contact_phone||'').trim(),loc=validMap(d.location_url);
 let lat=validCoord(d.lat,-90,90),lng=validCoord(d.lng,-180,180);const parsed=coordsFromMap(loc);if(parsed){if(lat==null)lat=parsed.lat;if(lng==null)lng=parsed.lng;}
 const vehicleType=['driver','rep'].includes(role)?String(d.vehicle_type||''):'';
 const plate=['driver','rep'].includes(role)?String(d.license_plate||'').trim().toUpperCase():'';
 const vehicleMake=['driver','rep'].includes(role)?String(d.vehicle_make||'').trim().slice(0,60):'';
 const vehicleModel=['driver','rep'].includes(role)?String(d.vehicle_model||'').trim().slice(0,60):'';
 const limit=role==='shop'&&u.role==='owner'?toM(d.credit_limit||0):0;
 // Only the owner sets the financial tariff for drivers; reps cannot see or set it.
 const rate=role==='driver'&&u.role==='owner'?toM(d.cost_per_km||0):0;
 if(role==='shop'&&!(limit>=0))bad('الحد الائتماني غير صالح');
 if(['supplier','shop'].includes(role)){if(business.length<2)bad('أدخل اسم المحل أو شركة الجملة');if(contact.length<2)bad(role==='supplier'?'أدخل اسم مندوب المبيعات':'أدخل اسم مندوب المشتريات');if(!/^\+?[0-9\s-]{6,20}$/.test(contactPhone))bad('رقم هاتف المندوب غير صالح');if(!loc)bad('أدخل رابط موقع Google Maps');}
 if(role==='driver'){if(!VEHICLE_TYPES.has(vehicleType))bad('اختر فئة مركبة السائق: صغيرة أو متوسطة أو كبيرة');if(!/^[\p{L}\p{N}\s-]{2,24}$/u.test(plate))bad('أدخل رقم لوحة سيارة صحيحًا');if(u.role==='owner'&&!(rate>0))bad('أدخل أجرة الكيلومتر للسائق؛ ويمكن للمالك تحديدها لاحقًا عند مراجعة الحساب إذا سجل المندوب السائق');}
 if(role==='rep'&&vehicleType&&!VEHICLE_TYPES.has(vehicleType))bad('اختر فئة سيارة المندوب');
 if(['driver','rep'].includes(role)&&vehicleType&&!/^[\p{L}\p{N}\s-]{2,24}$/u.test(plate))bad('أدخل رقم لوحة السيارة أو أفرغ فئة السيارة إن لم يكن لديه سيارة');
 if(!vehicleType&&plate)bad('حدد فئة السيارة أو امسح رقم اللوحة');
 const pw=tmpPw(),{salt,hash}=hashPw(pw);let id;
 try{
  id=Number(db.prepare(`INSERT INTO users(name,phone,password,salt,role,credit_limit,business_name,contact_name,contact_phone,location_url,lat,lng,vehicle_type,cost_per_km,passport_path,created_by,license_plate,vehicle_make,vehicle_model,must_change,profile_photo_path,business_size,job_title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(name,phone,hash,salt,role,limit,business,contact,contactPhone,loc,lat,lng,vehicleType,rate,passport,u.id,plate,vehicleMake,vehicleModel,profilePhoto,businessSize,jobTitle).lastInsertRowid);
  if(role==='shop'&&u.role==='rep'){db.prepare('INSERT OR IGNORE INTO rep_shops(shop_id,rep_id,assigned_by,commission_per_delivery) VALUES(?,?,?,0)').run(id,u.id,u.id);createRepEarning(u.id,id,'shop_registration',setting('rep_shop_registration_reward_mills'),u.id,'مكافأة تسجيل محل جديد');}
 }catch(e){try{fs.unlinkSync(path.join(PRIVATE_UPLOADS,passport));}catch{}if(profilePhoto)try{fs.unlinkSync(path.join(PRIVATE_PROFILE_PHOTOS,profilePhoto));}catch{}if(String(e.message).includes('UNIQUE'))bad('رقم الهاتف مسجل مسبقًا');throw e;}
 log(u.id,'user_add',id+':'+role);notify(id,'account_created','تم إنشاء حسابك','مرحبًا بك في وِصلة جملة. غيّر كلمة المرور المؤقتة بعد أول دخول.','profile');notifyOwnerAndAccountants('user_registered','تسجيل مستخدم جديد',name+' · '+role,'users');return{success:true,id,password:pw,created_by:u.id,needs_owner_setup:role==='driver'&&u.role==='rep'};
});
const targetUser=d=>{const t=db.prepare('SELECT * FROM users WHERE id=?').get(Number(d.id));if(!t||t.role==='owner')bad('المستخدم غير موجود أو لا يمكن تعديله');return t;};
function closeClaimsForPaidInvoice(invoiceId,actorId){const rows=db.prepare("SELECT id FROM debt_claims WHERE invoice_id=? AND status<>'closed'").all(invoiceId);for(const c of rows){db.prepare("UPDATE debt_claims SET status='closed',outcome='invoice_paid',outcome_note='أغلقت آليًا بعد تسوية الفاتورة بالكامل',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(c.id);db.prepare("INSERT INTO debt_claim_updates(claim_id,actor_id,action,note) VALUES(?,?,?,?)").run(c.id,actorId,'invoice_paid','أغلقت آليًا بعد تسوية الفاتورة بالكامل');}}
def('users/toggle',['owner'],(d,u)=>{const t=targetUser(d);db.prepare('UPDATE users SET active=? WHERE id=?').run(t.active?0:1,t.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);log(u.id,'user_toggle',t.id);return{success:true};});
def('users/reset',['owner'],(d,u)=>{const t=targetUser(d),pw=tmpPw(),{salt,hash}=hashPw(pw);db.prepare('UPDATE users SET password=?,salt=?,must_change=1 WHERE id=?').run(hash,salt,t.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);log(u.id,'user_reset',t.id);return{success:true,password:pw};});
def('users/limit',['owner'],(d,u)=>{const t=targetUser(d),limit=toM(d.limit);if(t.role!=='shop'||!(limit>=0))bad('حد ائتماني غير صالح');db.prepare('UPDATE users SET credit_limit=? WHERE id=?').run(limit,t.id);log(u.id,'credit_limit',t.id+':'+limit);return{success:true};});
def('users/profile/update',['owner','rep'],(d,u)=>{
 const t=targetUser(d);
 if(u.role==='rep'&&t.created_by!==u.id)bad('يمكن لمندوب المتابعة تعديل الحسابات التي سجلها بنفسه فقط');
 if(u.role==='rep'&&((d.cost_per_km!==undefined&&toM(d.cost_per_km)>0)||(d.credit_limit!==undefined&&toM(d.credit_limit)>0)))bad('لا يملك المندوب صلاحية تعديل التعرفة أو الحد الائتماني؛ يرجى الرجوع إلى المالك');
 const business=String(d.business_name??t.business_name).trim(),contact=String(d.contact_name??t.contact_name).trim(),contactPhone=String(d.contact_phone??t.contact_phone).trim(),loc=d.location_url===undefined?t.location_url:validMap(d.location_url);
 let lat=d.lat===undefined?t.lat:validCoord(d.lat,-90,90),lng=d.lng===undefined?t.lng:validCoord(d.lng,-180,180);const parsed=coordsFromMap(loc);if(parsed){if(lat==null)lat=parsed.lat;if(lng==null)lng=parsed.lng;}
 let vehicle=t.vehicle_type,plate=String(d.license_plate??t.license_plate??'').trim().toUpperCase(),make=String(d.vehicle_make??t.vehicle_make??'').trim().slice(0,60),model=String(d.vehicle_model??t.vehicle_model??'').trim().slice(0,60);
 if(['driver','rep'].includes(t.role)){if(d.vehicle_type!==undefined)vehicle=String(d.vehicle_type||'');if(vehicle&&!VEHICLE_TYPES.has(vehicle))bad('فئة السيارة غير صحيحة');if(t.role==='driver'&&(!vehicle||!plate||! /^[\p{L}\p{N}\s-]{2,24}$/u.test(plate)))bad('السائق يحتاج فئة سيارة ورقم لوحة صحيحًا');if(t.role==='rep'&&vehicle&&!/^[\p{L}\p{N}\s-]{2,24}$/u.test(plate))bad('أدخل رقم لوحة صحيحًا أو أفرغ فئة السيارة');}
 let rate=t.cost_per_km;if(u.role==='owner'&&t.role==='driver'&&d.cost_per_km!==undefined){rate=toM(d.cost_per_km);if(!(rate>=0))bad('أجرة الكيلومتر غير صحيحة');}
 if(['shop','supplier'].includes(t.role)){if(business.length<2||contact.length<2||!/^[0-9+\s-]{6,24}$/.test(contactPhone)||!loc)bad('أكمل اسم النشاط والمندوب والهاتف وموقع Google Maps');}
 const businessSize=['shop','supplier'].includes(t.role)?String(d.business_size??t.business_size??'small'):'';const jobTitle=['accountant','supervisor','software_staff'].includes(t.role)?String(d.job_title??t.job_title??'').trim().slice(0,80):'';
 let pass=t.passport_path,newPass='';if(d.passport_image){newPass=hashFile(d.passport_image,PRIVATE_UPLOADS,'passport');if(!newPass)bad('تعذر حفظ صورة جواز السفر');pass=newPass;}let photo=t.profile_photo_path||'',newPhoto='';if(d.profile_photo_image){newPhoto=hashFile(d.profile_photo_image,PRIVATE_PROFILE_PHOTOS,'profile');if(!newPhoto)bad('تعذر حفظ الصورة الشخصية');photo=newPhoto;}
 try{db.prepare('UPDATE users SET business_name=?,contact_name=?,contact_phone=?,location_url=?,lat=?,lng=?,vehicle_type=?,cost_per_km=?,passport_path=?,license_plate=?,vehicle_make=?,vehicle_model=?,profile_photo_path=?,business_size=?,job_title=? WHERE id=?').run(business,contact,contactPhone,loc,lat,lng,vehicle,rate,pass,plate,make,model,photo,businessSize,jobTitle,t.id);}catch(e){if(newPass)try{fs.unlinkSync(path.join(PRIVATE_UPLOADS,newPass));}catch{}if(newPhoto)try{fs.unlinkSync(path.join(PRIVATE_PROFILE_PHOTOS,newPhoto));}catch{}throw e;}
 if(newPass&&t.passport_path)try{fs.unlinkSync(path.join(PRIVATE_UPLOADS,t.passport_path));}catch{}if(newPhoto&&t.profile_photo_path)try{fs.unlinkSync(path.join(PRIVATE_PROFILE_PHOTOS,t.profile_photo_path));}catch{}
 log(u.id,'user_profile_update',t.id);return{success:true};
});
def('users/passport',ALL_AUTH_ROLES,(d,u)=>{
 const t=db.prepare('SELECT * FROM users WHERE id=?').get(Number(d.id));if(!t)bad('المستخدم غير موجود');
 const permitted=(u.role==='owner'&&t.role!=='owner')||t.id===u.id||(u.role==='rep'&&t.created_by===u.id);
 if(!permitted)bad('لا تملك صلاحية الاطلاع على هذا الجواز');if(!t.passport_path)bad('لا توجد صورة جواز سفر مرفقة لهذا الحساب');
 const img=imageData(t.passport_path,PRIVATE_UPLOADS);if(!img)bad('تعذر فتح الصورة');return{success:true,image:img,name:t.name};
});

// توحيد المنتجات والصور
def('products/all',['shop','owner'],(d,u)=>{
 const rows=db.prepare('SELECT p.id,p.name,p.sku,p.product_key,p.price,p.stock,p.supplier_id,p.image_url,p.credit_allowed,s.name supplier_name,s.business_name supplier_business,s.location_url supplier_location,s.lat supplier_lat,s.lng supplier_lng FROM products p JOIN users s ON s.id=p.supplier_id WHERE p.active=1 AND s.active=1 ORDER BY p.name').all();
 const shop=u.role==='shop'?db.prepare('SELECT lat,lng FROM users WHERE id=?').get(u.id):null,feePct=setting('platform_fee_percent');
 const types=['small','medium','large','supplier'];
 return rows.map(p=>{
  const distance=shop?distanceKm(shop,{lat:p.supplier_lat,lng:p.supplier_lng}):null;
  const locked=!!(u.role==='shop'&&(db.prepare('SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.shop_id=? AND (l.sku=? OR l.product_key=?) AND l.unpaid>0 LIMIT 1').get(u.id,p.sku,p.product_key)||db.prepare("SELECT 1 FROM orders WHERE shop_id=? AND (sku=? OR product_key=?) AND method='credit' AND status IN ('pending','ready','shipping') LIMIT 1").get(u.id,p.sku,p.product_key)));
  const appPerUnit=Math.round(p.price*feePct/100),shopPrice=p.price+appPerUnit;
  const deliveryQuotes=Object.fromEntries(types.map(type=>{const rate=quoteRateForType(type),fee=(distance!=null&&rate>0)?Math.round(distance*rate):null;return[type,fee];}));
  if(u.role==='owner')return{...p,credit_locked:false,distance_estimate_km:distance,platform_fee_percent:feePct,estimated_app_fee:appPerUnit,shop_price:shopPrice,delivery_quotes:deliveryQuotes};
  // The shop gets its final selling price and total delivery quote, not base wholesale cost or internal fee rate/profit.
  return{id:p.id,name:p.name,sku:p.sku,stock:p.stock,supplier_id:p.supplier_id,image_url:p.image_url,credit_allowed:!!p.credit_allowed,supplier_name:p.supplier_name,supplier_business:p.supplier_business,supplier_location:p.supplier_location,credit_locked:locked,distance_estimate_km:distance,shop_price:shopPrice,delivery_quotes:deliveryQuotes};
 });
});
def('products/mine',['supplier'],(d,u)=>db.prepare('SELECT * FROM products WHERE supplier_id=? ORDER BY id DESC').all(u.id));
def('products/add',['supplier'],(d,u)=>{
 const name=String(d.name||'').trim(),sku=norm(d.sku),price=toM(d.price),stock=Number(d.stock),creditAllowed=d.credit_allowed===false||String(d.credit_allowed)==='0'?0:1;if(name.length<2||name.length>100)bad('اسم المنتج غير صالح');if(sku.length<3||sku.length>80)bad('أدخل رمز المنتج الموحد (SKU)');if(!(price>0))bad('السعر غير صالح');if(!Number.isInteger(stock)||stock<0||stock>1e6)bad('المخزون غير صالح');
 let image='';if(d.image_data)image='/uploads/products/'+hashFile(d.image_data,UPLOADS,'product');
 db.prepare('INSERT INTO products(supplier_id,name,sku,product_key,price,stock,image_url,credit_allowed) VALUES(?,?,?,?,?,?,?,?)').run(u.id,name,sku,norm(name),price,stock,image,creditAllowed);log(u.id,'product_add',sku);return{success:true};
});
def('products/update',['supplier'],(d,u)=>{
 const p=db.prepare('SELECT * FROM products WHERE id=? AND supplier_id=?').get(Number(d.id),u.id);if(!p)bad('المنتج غير موجود');const price=d.price===undefined?p.price:toM(d.price),stock=d.stock===undefined?p.stock:Number(d.stock),name=String(d.name??p.name).trim(),sku=norm(d.sku??p.sku),creditAllowed=d.credit_allowed===undefined?p.credit_allowed:(d.credit_allowed===false||String(d.credit_allowed)==='0'?0:1);let image=p.image_url;
 if(d.image_data){image='/uploads/products/'+hashFile(d.image_data,UPLOADS,'product');}
 if(!(price>0)||!Number.isInteger(stock)||stock<0||stock>1e6||name.length<2||sku.length<3)bad('بيانات غير صالحة');if((sku!==p.sku||norm(name)!==(p.product_key||norm(p.name)))&&(db.prepare('SELECT 1 FROM invoice_lines WHERE sku=? OR product_key=? LIMIT 1').get(p.sku,p.product_key)||db.prepare("SELECT 1 FROM orders WHERE product_id=? AND status<>'cancelled' LIMIT 1").get(p.id)))bad('لا يمكن تغيير هوية المنتج أو SKU بعد استخدامه في طلب أو فاتورة؛ اطلب مراجعة الإدارة.');db.prepare('UPDATE products SET name=?,sku=?,product_key=?,price=?,stock=?,image_url=?,credit_allowed=? WHERE id=?').run(name,sku,norm(name),price,stock,image,creditAllowed,p.id);log(u.id,'product_update',p.id);return{success:true};
});

// تقدير سعر التوصيل مسبقًا باستخدام الإحداثيات ومعدل المركبة المختارة.
function estimatesForSupplier(shopId,supplierId,items,deliveryMode,vehicleType){
 const shop=db.prepare('SELECT lat,lng FROM users WHERE id=?').get(shopId),sup=db.prepare('SELECT lat,lng FROM users WHERE id=?').get(supplierId);
 const dist=deliveryMode==='delivery'?distanceKm(shop,sup):0;
 const rate=deliveryMode==='delivery'?quoteRateForType(vehicleType==='supplier'?'supplier':vehicleType):0;
 const goods=items.reduce((s,x)=>s+x.total,0),feePct=setting('platform_fee_percent');
 const appShares=items.map(x=>Math.round(x.p.price*feePct/100)*x.qty),app=appShares.reduce((s,x)=>s+x,0);
 const delivery=(deliveryMode==='delivery'&&dist!=null&&rate>0)?Math.round(dist*rate):0;
 return{dist:dist||0,knownDistance:dist!=null,rate,goods,app,delivery,deliveryShares:alloc(delivery,items),appShares};
}
def('orders/create-batch',['shop'],(d,u)=>{
 if(!Array.isArray(d.items)||d.items.length<1||d.items.length>40)bad('السلة يجب أن تضم من 1 إلى 40 صنفًا');
 const deliveryMode=String(d.delivery_mode||'delivery'),vehicleType=String(d.vehicle_type||'supplier'),collectionMethod=String(d.collection_method||'cash');
 if(!['pickup','delivery'].includes(deliveryMode))bad('اختر استلامًا مباشرًا أو توصيلًا');
 if(!['cash','transfer'].includes(collectionMethod))bad('اختر التحصيل النقدي عند التسليم أو الحوالة عبر الإدارة');
 if(deliveryMode==='delivery'&&!['supplier',...VEHICLE_TYPES].includes(vehicleType))bad('اختر فئة سيارة صغيرة أو متوسطة أو كبيرة، أو اترك الاختيار للمورد');
 if(deliveryMode==='pickup'&&vehicleType!=='supplier')bad('الاستلام المباشر لا يحتاج إلى تحديد سيارة');
 return tx(()=>{
  const items=[],seen=new Set(),creditProductKeys=new Set(),stock=new Map(),groups=new Map();
  for(const raw of d.items){
   const id=Number(raw.product_id),qty=Number(raw.qty),method=String(raw.method||'');if(!Number.isInteger(id)||id<=0)bad('رقم المنتج غير صحيح');if(!Number.isInteger(qty)||qty<=0||qty>100000)bad('الكمية غير صحيحة');if(!['cash','credit'].includes(method))bad('طريقة الدفع غير صحيحة');if(seen.has(id))bad('المنتج مكرر في السلة');seen.add(id);
   const p=db.prepare('SELECT p.*,s.active supplier_active FROM products p JOIN users s ON s.id=p.supplier_id WHERE p.id=? AND p.active=1').get(id);if(!p||!p.supplier_active)bad('منتج غير متاح');
   stock.set(p.id,(stock.get(p.id)||0)+qty);const total=p.price*qty;if(!Number.isSafeInteger(total)||total<=0)bad('قيمة السطر غير صالحة');
   if(method==='credit'){
    if(!p.credit_allowed)bad('المورد لا يسمح بالشراء الآجل لهذا المنتج؛ اختر الدفع المسبق.');
    const debtLock=db.prepare('SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.shop_id=? AND l.sku=? AND l.unpaid>0 LIMIT 1').get(u.id,p.sku);
    const activeLock=db.prepare("SELECT 1 FROM orders WHERE shop_id=? AND sku=? AND method='credit' AND status IN ('pending','ready','shipping') LIMIT 1").get(u.id,p.sku);
    const skuKey='sku:'+String(p.sku||'').trim().toUpperCase();if(!p.sku||debtLock||activeLock||creditProductKeys.has(skuKey))bad('المنتج مقفول للشراء الآجل بسبب رصيد مستحق أو طلب آجل قائم على SKU الموحد. سدّد الرصيد أو اختر الدفع المسبق.');creditProductKeys.add(skuKey);
   }
   const it={p,qty,method,total};items.push(it);if(!groups.has(p.supplier_id))groups.set(p.supplier_id,[]);groups.get(p.supplier_id).push(it);
  }
  const estGroup=new Map();let newReserve=0;
  for(const [supplierId,its] of groups){
   const e=estimatesForSupplier(u.id,supplierId,its,deliveryMode,vehicleType);
   if(deliveryMode==='delivery'&&!e.knownDistance)bad('لا يمكن حساب التوصيل لأن إحداثيات المحل أو المورد غير مكتملة. أدخل خط العرض والطول في بيانات الحساب.');
   if(deliveryMode==='delivery'&&e.rate<=0)bad('لا يوجد سائق مسعّر لفئة السيارة المختارة. اختر فئة أخرى أو استلامًا مباشرًا.');
   estGroup.set(supplierId,e);its.forEach((it,i)=>{it.estimated_distance=e.dist;it.estimated_delivery_share=e.deliveryShares[i];it.estimated_app_fee_share=e.appShares[i];it.delivery_quote_rate=e.rate;it.reserved_credit=it.method==='credit'?it.total+e.appShares[i]:0;newReserve+=it.reserved_credit;});
  }
  const ci=creditInfo(u);if(newReserve>ci.available)bad('الطلب يتجاوز الحد الائتماني بعد احتساب المنتج والتوصيل ورسوم المنصة. المتاح: '+(Math.max(0,ci.available)/K).toFixed(3)+' د.ل');
  for(const [id,qty] of stock){if(!db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(qty,id,qty).changes)bad('تغير المخزون؛ حدّث السوق وحاول مجددًا');}
  const batch=crypto.randomUUID(),created=[];
  for(const it of items){const selected=deliveryMode==='delivery'&&vehicleType!=='supplier'?vehicleType:'';const r=db.prepare('INSERT INTO orders(batch_id,shop_id,supplier_id,product_id,product_name,sku,product_key,qty,total,method,delivery_mode,collection_method,requested_vehicle_type,selected_vehicle_type,delivery_quote_rate,otp,reserved_credit,estimated_distance_km,estimated_delivery_share,estimated_app_fee_share) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(batch,u.id,it.p.supplier_id,it.p.id,it.p.name,it.p.sku,it.p.product_key||norm(it.p.name),it.qty,it.total,it.method,deliveryMode,deliveryMode==='delivery'?collectionMethod:'cash',deliveryMode==='delivery'?vehicleType:'',selected,it.delivery_quote_rate,String(crypto.randomInt(1000,10000)),it.reserved_credit,it.estimated_distance,it.estimated_delivery_share,it.estimated_app_fee_share);created.push({id:Number(r.lastInsertRowid),name:it.p.name,supplier_id:it.p.supplier_id,qty:it.qty,customer_line_total:it.total+Number(it.estimated_app_fee_share||0),method:it.method,delivery_mode:deliveryMode,requested_vehicle_type:vehicleType});log(u.id,'order_create',r.lastInsertRowid);notify(it.p.supplier_id,'new_order','طلبية جديدة','وصل طلب جديد من المحل رقم '+u.id,'orders');}
  // سجل مستقل لأجرة الشحنة: سطر واحد لكل مورد داخل الطلب الرئيسي، وليس سطرًا مكررًا لكل منتج.
  for(const [supplierId,e] of estGroup){
   db.prepare('INSERT INTO shipment_fees(batch_id,supplier_id,fee_amount,rate_per_km,distance_km,status) VALUES(?,?,?,?,?,?)')
    .run(batch,supplierId,deliveryMode==='delivery'?Number(e.delivery||0):0,deliveryMode==='delivery'?Number(e.rate||0):0,Number(e.dist||0),deliveryMode==='delivery'?'quoted':'voided');
  }
  return{success:true,batch_id:batch,orders:created,delivery_mode:deliveryMode,vehicle_type:vehicleType,credit:creditInfo(u)};
 });
});
def('orders/cancel',['shop'],(d,u)=>{bad('لا يتم إلغاء الطلب مباشرة. أرسل طلب موافقة من صفحة طلباتي والإرجاع.');});
/* legacy cancellation transaction disabled: all cancellations must be approved in the app.
const legacyOrdersCancel = (d,u)=>tx(()=>{
 const o=db.prepare('SELECT * FROM orders WHERE id=? AND shop_id=?').get(Number(d.order_id),u.id);if(!o||o.status!=='pending')bad('لا يمكن إلغاء هذا الطلب بعد قبوله أو إسناده');
 const group=db.prepare("SELECT * FROM orders WHERE batch_id=? AND supplier_id=? AND status='pending' ORDER BY id").all(o.batch_id,o.supplier_id);
 const fixedDelivery=group.reduce((a,x)=>a+Number(x.estimated_delivery_share||0),0);
 db.prepare("UPDATE orders SET status='cancelled',reserved_credit=0 WHERE id=?").run(o.id);restoreOnce(o);
 const remain=group.filter(x=>x.id!==o.id);if(remain.length){
  // Keep one delivery charge for this supplier stop; retain the customer-facing product markup already quoted.
  const ds=alloc(fixedDelivery,remain);
  remain.forEach((x,i)=>db.prepare('UPDATE orders SET estimated_delivery_share=?,reserved_credit=? WHERE id=?').run(ds[i],x.method==='credit'?x.total+Number(x.estimated_app_fee_share||0):0,x.id));
 }
 log(u.id,'order_cancel',o.id);return{success:true,delivery_fee_kept:remain.length?fixedDelivery:0,remaining_items:remain.length};
}); */
def('orders/get',null,(d,u)=>{
 const base=`SELECT o.*,s.name shop_name,s.phone shop_phone,s.business_name shop_business,s.location_url shop_location,sp.name supplier_name,sp.business_name supplier_business,sp.location_url supplier_location,dr.name driver_name,dr.license_plate driver_license_plate,dr.vehicle_type driver_vehicle_type,dr.vehicle_make driver_vehicle_make,dr.vehicle_model driver_vehicle_model,j.otp job_otp,j.distance_km job_distance_km,j.delivery_fee job_delivery_fee,j.driver_earning job_driver_earning,j.app_fee job_app_fee,j.app_fee_percent job_app_fee_percent,j.app_profit job_app_profit FROM orders o JOIN users s ON s.id=o.shop_id JOIN users sp ON sp.id=o.supplier_id LEFT JOIN users dr ON dr.id=o.driver_id LEFT JOIN delivery_jobs j ON j.id=o.job_id`;
 const inv=`SELECT i.*,s.name shop_name,sp.name supplier_name FROM invoices i JOIN users s ON s.id=i.shop_id JOIN users sp ON sp.id=i.supplier_id`;
 let orders=[],invoices=[];
 if(u.role==='shop'){orders=db.prepare(base+' WHERE o.shop_id=? ORDER BY o.id DESC LIMIT 200').all(u.id);invoices=db.prepare(inv+' WHERE i.shop_id=? ORDER BY i.id DESC LIMIT 200').all(u.id);}
 else if(u.role==='supplier'){orders=db.prepare(base+' WHERE o.supplier_id=? ORDER BY o.id DESC LIMIT 200').all(u.id);invoices=db.prepare(inv+' WHERE i.supplier_id=? ORDER BY i.id DESC LIMIT 200').all(u.id);}
 else if(u.role==='driver'){orders=db.prepare(base+' WHERE o.driver_id=? ORDER BY o.id DESC LIMIT 200').all(u.id);}
 else if(['owner','accountant'].includes(u.role)){orders=db.prepare(base+' ORDER BY o.id DESC LIMIT 500').all();invoices=db.prepare(inv+' ORDER BY i.id DESC LIMIT 500').all();}
 else if(['service_provider','subscriber'].includes(u.role)){orders=db.prepare(base+' WHERE EXISTS (SELECT 1 FROM service_order_access a WHERE a.user_id=? AND a.batch_id=o.batch_id AND a.supplier_id=o.supplier_id) ORDER BY o.id DESC LIMIT 200').all(u.id);}
 else bad('لا توجد صلاحية لعرض الطلبات');
 // One authoritative delivery fee per batch/supplier group, never a per-item duplicate.
 const feeRows=db.prepare(`SELECT batch_id,supplier_id,COALESCE(SUM(estimated_delivery_share),0) estimated_fee FROM orders WHERE status<>'cancelled' GROUP BY batch_id,supplier_id`).all();
 const feeMap=new Map(feeRows.map(x=>[x.batch_id+'|'+x.supplier_id,Number(x.estimated_fee||0)]));
 orders.forEach(o=>{o.group_delivery_fee=Number(o.job_delivery_fee||0)>0?Number(o.job_delivery_fee):Number(feeMap.get(o.batch_id+'|'+o.supplier_id)||0);});
 orders.forEach(o=>{
  delete o.otp;if(u.role!=='shop'||o.status!=='shipping')delete o.job_otp;
  if(u.role!=='owner'){
   if(u.role==='shop'){o.customer_line_total=Number(o.total)+Number(o.estimated_app_fee_share||o.app_fee_share||0);o.total=o.customer_line_total;}
   for(const k of ['job_app_fee','job_app_fee_percent','job_app_profit','job_driver_earning','estimated_app_fee_share','app_fee_share','reserved_credit']) delete o[k];
   if(u.role==='supplier')for(const k of ['group_delivery_fee','job_delivery_fee','estimated_delivery_share','delivery_fee_share','estimated_distance_km','job_distance_km','distance_km','delivery_quote_rate','requested_vehicle_type','selected_vehicle_type','job_id','driver_id','driver_name','driver_license_plate','driver_vehicle_type','driver_vehicle_make','driver_vehicle_model']) delete o[k];
  }
 });
 if(u.role!=='owner')invoices=invoices.map(i=>{
  const out={...i};if(u.role==='shop')out.customer_goods_total=Number(i.goods_total||0)+Number(i.app_fee||0);
  for(const k of ['app_fee','app_fee_percent','app_profit','driver_earning','rep_commission','distance_km'])delete out[k];if(u.role==='supplier')delete out.delivery_fee;return out;
 });
 return{orders,invoices,credit:u.role==='shop'?creditInfo(u):null};
});
def('orders/update',['supplier'],(d,u)=>tx(()=>{
 const sample=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(d.order_id));if(!sample||sample.supplier_id!==u.id||sample.status!=='pending')bad('الطلب غير موجود أو لا يمكن تغييره');
 const group=db.prepare("SELECT * FROM orders WHERE batch_id=? AND supplier_id=? AND status='pending' ORDER BY id").all(sample.batch_id,sample.supplier_id);if(!group.length)bad('لا توجد أصناف معلقة في الطلبية');
 if(d.action==='reject'){
  for(const o of group){db.prepare("UPDATE orders SET status='cancelled',reserved_credit=0 WHERE id=?").run(o.id);restoreOnce(o);}
  maybeVoidShipmentFee(sample.batch_id,sample.supplier_id);
  log(u.id,'order_reject_group',sample.batch_id+':'+sample.supplier_id);notify(sample.shop_id,'order_rejected','تم رفض الطلبية','رفض المورد طلبيتك رقم '+sample.batch_id.slice(0,8)+'؛ أُعيدت الكميات والحد الائتماني المحجوز.','orders');notifyOwnerAndAccountants('order_rejected','رفض مورد طلبية','الطلبية '+sample.batch_id.slice(0,8),'orders');return{success:true,changed:group.length};
 }
 if(d.action!=='accept')bad('إجراء غير صالح');
 let selected=sample.selected_vehicle_type||'';
 if(sample.delivery_mode==='delivery'){
  if(sample.requested_vehicle_type==='supplier'){
   selected=String(d.vehicle_type||'');if(!VEHICLE_TYPES.has(selected))bad('اختر نوع السيارة: حمولة صغيرة أو متوسطة أو كبيرة');
   const activeRate=quoteRateForType(selected);if(!(activeRate>0))bad('لا يوجد سائق مسعّر لهذه الفئة');
   // سعر التوصيل حُسب وعُرض للمحل عند تأكيد السلة؛ اختيار فئة السيارة لا يغير السعر بعد الطلب.
   // تم استخدام سقف تعريفة السائقين النشطين عند تسعير خيار "يحدد المورد".
   for(const o of group)db.prepare("UPDATE orders SET selected_vehicle_type=?,status='ready' WHERE id=? AND status='pending'").run(selected,o.id);
  } else {
   if(!VEHICLE_TYPES.has(selected))bad('فئة السيارة المطلوبة غير صحيحة');
   for(const o of group)db.prepare("UPDATE orders SET selected_vehicle_type=?,status='ready' WHERE id=? AND status='pending'").run(selected,o.id);
  }
 } else {
  for(const o of group)db.prepare("UPDATE orders SET status='ready' WHERE id=? AND status='pending'").run(o.id);
 }
 log(u.id,'order_accept_group',sample.batch_id+':'+sample.supplier_id+':'+selected);notify(sample.shop_id,'order_accepted','تم قبول الطلبية','المورد قبل طلبك رقم '+sample.batch_id.slice(0,8),'orders');if(sample.delivery_mode==='delivery'){for(const dr of db.prepare("SELECT id FROM users WHERE role='driver' AND active=1 AND vehicle_type=?").all(selected))notify(dr.id,'delivery_available','شحنة توصيل متاحة','توجد شحنة مناسبة لفئة سيارتك','orders');}return{success:true,changed:group.length,selected_vehicle_type:selected};
}));

def('orders/pickup-confirm',['shop'],(d,u)=>tx(()=>{
 const batch=String(d.batch_id||''),supplierId=Number(d.supplier_id);if(!batch||!Number.isInteger(supplierId))bad('رقم الطلب غير صالح');
 const group=db.prepare("SELECT * FROM orders WHERE batch_id=? AND supplier_id=? AND shop_id=? AND delivery_mode='pickup' AND status='ready' ORDER BY id").all(batch,supplierId,u.id);if(!group.length)bad('لا توجد طلبية استلام مباشر جاهزة للتأكيد');
 if(db.prepare('SELECT id FROM invoices WHERE batch_id=? AND supplier_id=?').get(batch,supplierId))bad('تم إصدار فاتورة هذه الطلبية مسبقًا');
 const goods=group.reduce((a,o)=>a+o.total,0),app=group.reduce((a,o)=>a+o.estimated_app_fee_share,0),total=goods+app;
 const lines=group.map(o=>({o,line:o.total+o.estimated_app_fee_share})),cash=lines.filter(x=>x.o.method==='cash').reduce((a,x)=>a+x.line,0),credit=lines.filter(x=>x.o.method==='credit').reduce((a,x)=>a+x.line,0);
 const inv=Number(db.prepare("INSERT INTO invoices(batch_id,shop_id,supplier_id,goods_total,delivery_fee,driver_earning,app_fee_percent,app_fee,rep_id,rep_commission,app_profit,distance_km,total,paid,status) VALUES(?,?,?,?,0,0,?,?,NULL,0,?,?,?, ?,?)").run(batch,u.id,supplierId,goods,goods>0?(app/goods)*100:setting('platform_fee_percent'),app,app,0,total,cash,cash>=total?'paid':cash>0?'partial':'unpaid').lastInsertRowid);
 for(const x of lines){db.prepare('INSERT INTO invoice_lines(invoice_id,supplier_id,sku,product_key,product_name,qty,method,line_total,unpaid,supplier_unpaid,order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(inv,supplierId,x.o.sku,x.o.product_key||norm(x.o.product_name),x.o.product_name,x.o.qty,x.o.method,x.line,x.o.method==='credit'?x.line:0,x.o.method==='credit'?x.o.total:0,x.o.id);db.prepare("UPDATE orders SET status='delivered',reserved_credit=0 WHERE id=?").run(x.o.id);}
 if(cash>0)db.prepare('INSERT INTO payments(invoice_id,shop_id,supplier_id,created_by,confirmed_by,amount,method,reference) VALUES(?,?,?,?,?,?,?,?)').run(inv,u.id,supplierId,u.id,u.id,cash,'cash','استلام مباشر '+batch);
 log(u.id,'pickup_confirm',batch+':invoice='+inv);notify(supplierId,'pickup_completed','تم الاستلام المباشر','أكد المحل استلام الطلبية وصدرت الفاتورة.','invoices');notifyOwnerAndAccountants('pickup_completed','استلام مباشر مكتمل','فاتورة #'+inv,'invoices');return{success:true,invoice_id:inv,total,paid:cash,unpaid:credit};
}));

// مهام التوصيل: تظهر الشحنات المؤهلة للسائق مباشرةً بعد اختيار فئة السيارة واعتماد المورد.
def('delivery/list',null,(d,u)=>{
 if(!['owner','accountant','driver','shop','supplier'].includes(u.role))bad('لا توجد صلاحية لعرض التوصيلات');
 const base=`SELECT j.*,s.name shop_name,s.phone shop_phone,s.business_name shop_business,s.location_url shop_location,sp.name supplier_name,sp.phone supplier_phone,sp.business_name supplier_business,sp.location_url supplier_location,dr.name driver_name,dr.phone driver_phone,dr.vehicle_type,dr.cost_per_km,dr.license_plate,dr.vehicle_make,dr.vehicle_model,r.name rep_name,i.id invoice_id,i.total invoice_total,i.paid invoice_paid FROM delivery_jobs j JOIN users s ON s.id=j.shop_id JOIN users sp ON sp.id=j.supplier_id JOIN users dr ON dr.id=j.driver_id LEFT JOIN users r ON r.id=j.rep_id LEFT JOIN invoices i ON i.batch_id=j.batch_id AND i.supplier_id=j.supplier_id`;
 let jobs=[];
 if(['owner','accountant'].includes(u.role))jobs=db.prepare(base+' ORDER BY j.id DESC LIMIT 300').all();
 else if(u.role==='driver')jobs=db.prepare(base+' WHERE j.driver_id=? ORDER BY j.id DESC LIMIT 300').all(u.id);
 else if(u.role==='shop')jobs=db.prepare(base+' WHERE j.shop_id=? ORDER BY j.id DESC LIMIT 300').all(u.id);
 else jobs=db.prepare(base+' WHERE j.supplier_id=? ORDER BY j.id DESC LIMIT 300').all(u.id);
 const raw=db.prepare(`SELECT o.batch_id,o.shop_id,o.supplier_id,o.selected_vehicle_type,o.collection_method,COUNT(*) item_count,SUM(o.total) goods_total,COALESCE(MAX(sf.fee_amount),SUM(o.estimated_delivery_share)) delivery_quote,SUM(o.estimated_app_fee_share) app_quote,MIN(o.estimated_distance_km) estimate_km,MAX(o.delivery_quote_rate) quote_rate,SUM(CASE WHEN o.method='cash' THEN o.total ELSE 0 END) cash_goods,SUM(CASE WHEN o.method='cash' THEN o.estimated_app_fee_share ELSE 0 END) cash_app,s.name shop_name,s.phone shop_phone,s.business_name shop_business,s.location_url shop_location,sp.name supplier_name,sp.business_name supplier_business,sp.location_url supplier_location,sp.lat supplier_lat,sp.lng supplier_lng,s.lat shop_lat,s.lng shop_lng,rs.rep_id,r.name rep_name,rs.commission_per_delivery FROM orders o JOIN users s ON s.id=o.shop_id JOIN users sp ON sp.id=o.supplier_id LEFT JOIN rep_shops rs ON rs.shop_id=o.shop_id LEFT JOIN users r ON r.id=rs.rep_id LEFT JOIN shipment_fees sf ON sf.batch_id=o.batch_id AND sf.supplier_id=o.supplier_id WHERE o.status='ready' AND o.delivery_mode='delivery' AND o.job_id IS NULL AND o.selected_vehicle_type IN ('small','medium','large') GROUP BY o.batch_id,o.shop_id,o.supplier_id,o.selected_vehicle_type,o.collection_method ORDER BY MIN(o.id)`).all();
 let groups=raw.map(g=>({...g,goods_total_dinar:money(g.goods_total),delivery_quote_dinar:money(g.delivery_quote),app_quote_dinar:money(g.app_quote),cash_due_from_shop:g.collection_method==='cash'?Number(g.cash_goods||0)+Number(g.cash_app||0)+Number(g.delivery_quote||0):0,cash_goods_due:Number(g.cash_goods||0)+Number(g.cash_app||0),rep_commission_dinar:money(g.commission_per_delivery||0),distance_estimate_km:Number(g.estimate_km||0)}));
 if(u.role==='supplier')groups=groups.filter(g=>Number(g.supplier_id)===u.id);
 if(u.role==='driver'){
  jobs=jobs.map(j=>{const cash=db.prepare("SELECT COALESCE(SUM(CASE WHEN method='cash' THEN total+app_fee_share ELSE 0 END),0) goods_cash FROM orders WHERE job_id=?").get(j.id).goods_cash;return {...j,cash_goods_due:Number(cash||0),cash_due_from_shop:j.collection_method==='cash'?Number(cash||0)+Number(j.delivery_fee||0):0};});
  const driver=db.prepare("SELECT vehicle_type,cost_per_km FROM users WHERE id=? AND active=1").get(u.id);
  groups=groups.filter(g=>g.selected_vehicle_type===driver.vehicle_type&&Number(driver.cost_per_km)>0&&Number(driver.cost_per_km)<=Number(g.quote_rate));
 } else if(u.role==='shop')groups=[];
 jobs.forEach(j=>{
  delete j.otp;
  if(u.role!=='owner'){
   // Financial internals are owner-only. Each role sees only what is needed to fulfil its own task.
   for(const k of ['app_fee','app_fee_percent','app_profit','rep_commission','assigned_by','rep_id'])delete j[k];
   if(u.role==='shop')for(const k of ['driver_rate_per_km','driver_phone','driver_earning','goods_total'])delete j[k];
   if(u.role==='supplier')for(const k of ['delivery_fee','delivery_fee_share','group_delivery_fee','driver_earning','driver_rate_per_km','driver_phone','driver_vehicle_type','driver_license_plate','driver_vehicle_make','driver_vehicle_model','app_fee','app_fee_percent','app_fee_percent','app_profit','rep_commission','rep_id','assigned_by','shop_phone','distance_km','goods_total','cash_due_from_shop','cash_goods_due','delivery_quote','driver_rate_per_km'])delete j[k];
   if(u.role==='driver')for(const k of ['invoice_total','invoice_paid','driver_phone','goods_total'])delete j[k];
  }
 });
 if(u.role==='driver')groups=groups.map(g=>{const out={...g,customer_goods_total:Number(g.goods_total||0)+Number(g.app_quote||0)};for(const k of ['app_quote','quote_rate','cash_app','cash_goods','goods_total','goods_total_dinar','app_quote_dinar','delivery_quote_dinar','rep_id','rep_name','commission_per_delivery','shop_phone','shop_name','shop_business','shop_location','shop_lat','shop_lng','supplier_name','supplier_business','supplier_location','supplier_lat','supplier_lng'])delete out[k];return out;});
 if(u.role==='supplier')groups=groups.map(g=>{const out={...g};for(const k of ['delivery_quote','delivery_quote_dinar','delivery_quote_rate','quote_rate','estimate_km','distance_estimate_km','app_quote','app_quote_dinar','cash_app','cash_goods','rep_id','rep_name','commission_per_delivery','rep_commission_dinar','shop_phone','shop_lat','shop_lng'])delete out[k];return out;});
 if(u.role==='shop')groups=[];
 return{jobs,groups,drivers:u.role==='owner'?db.prepare("SELECT id,name,phone,vehicle_type,cost_per_km FROM users WHERE role='driver' AND active=1 ORDER BY name").all().map(x=>({...x,vehicle_label:vehicleLabel(x.vehicle_type),cost_per_km_dinar:money(x.cost_per_km)})):[],settings:u.role==='owner'?{platform_fee_percent:setting('platform_fee_percent')}:null};
});

function doAssignDelivery(d,u,driverId,isDriver){
 const batch=String(d.batch_id||''),supplierId=Number(d.supplier_id);if(!batch||!Number.isInteger(supplierId))bad('بيانات الإسناد ناقصة');
 if(db.prepare('SELECT id FROM delivery_jobs WHERE batch_id=? AND supplier_id=?').get(batch,supplierId))bad('تم إسناد هذه الشحنة مسبقًا');
 const group=db.prepare("SELECT * FROM orders WHERE batch_id=? AND supplier_id=? AND delivery_mode='delivery' AND status='ready' AND job_id IS NULL ORDER BY id").all(batch,supplierId);if(!group.length)bad('لا توجد طلبات توصيل جاهزة لهذه المجموعة');
 const any=db.prepare("SELECT COUNT(*) n FROM orders WHERE batch_id=? AND supplier_id=? AND delivery_mode='delivery' AND status NOT IN ('cancelled')").get(batch,supplierId).n;if(any!==group.length)bad('يجب أن تكون جميع أصناف المجموعة جاهزة قبل الإسناد');
 const driver=db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND active=1").get(Number(driverId));if(!driver||driver.cost_per_km<=0)bad('السائق غير فعال أو لم تحدد أجرة الكيلومتر له');
 const required=group[0].selected_vehicle_type,quoteRate=Number(group[0].delivery_quote_rate);if(!VEHICLE_TYPES.has(required)||driver.vehicle_type!==required)bad('فئة سيارة السائق لا تطابق فئة الشحنة المطلوبة');if(driver.cost_per_km>quoteRate)bad('أجرة هذا السائق أعلى من السعر المحسوب عند تأكيد الطلب؛ لا يمكن إسناد الشحنة إليه.');
 const distance=Number(group[0].estimated_distance_km);if(!Number.isFinite(distance)||distance<=0)bad('مسافة التوصيل غير متوفرة؛ راجع إحداثيات المحل والمورد');
 const goods=group.reduce((a,o)=>a+o.total,0),feeRecord=db.prepare('SELECT fee_amount FROM shipment_fees WHERE batch_id=? AND supplier_id=?').get(batch,supplierId),delivery=feeRecord?Number(feeRecord.fee_amount||0):group.reduce((a,o)=>a+o.estimated_delivery_share,0),appFee=group.reduce((a,o)=>a+o.estimated_app_fee_share,0),pct=goods>0?(appFee/goods)*100:setting('platform_fee_percent');
 const rs=db.prepare('SELECT rep_id,commission_per_delivery FROM rep_shops WHERE shop_id=?').get(group[0].shop_id),repId=rs?.rep_id||null;
 const repFee=0;
 const driverEarning=Math.round(distance*driver.cost_per_km),profit=appFee+delivery-driverEarning;
 const otp=String(crypto.randomInt(1000,10000));
 db.prepare("UPDATE shipment_fees SET status='charged' WHERE batch_id=? AND supplier_id=? AND status='quoted'").run(batch,supplierId);
 const jid=Number(db.prepare(`INSERT INTO delivery_jobs(batch_id,shop_id,supplier_id,driver_id,collection_method,rep_id,distance_km,driver_rate_per_km,goods_total,delivery_fee,driver_earning,app_fee_percent,app_fee,rep_commission,app_profit,otp,assigned_by,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'assigned')`).run(batch,group[0].shop_id,supplierId,driver.id,group[0].collection_method||'cash',repId,distance,driver.cost_per_km,goods,delivery,driverEarning,pct,appFee,repFee,profit,otp,isDriver?null:u.id).lastInsertRowid);
 const dShares=alloc(delivery,group),aShares=alloc(appFee,group);group.forEach((o,i)=>db.prepare("UPDATE orders SET job_id=?,driver_id=?,status='shipping',distance_km=?,delivery_fee_share=?,app_fee_share=?,reserved_credit=? WHERE id=? AND status='ready' AND job_id IS NULL").run(jid,driver.id,distance,dShares[i],aShares[i],o.method==='credit'?o.total+aShares[i]:0,o.id));
 log(u.id,isDriver?'delivery_claim':'delivery_assign',jid+':'+distance+':'+driver.id);notify(group[0].shop_id,'delivery_assigned','تم إسناد سائق لطلبيتك','رمز التسليم أصبح ظاهرًا في صفحة طلباتي؛ أعطه للسائق عند الاستلام فقط.','orders');notify(supplierId,'delivery_assigned','سائق في الطريق لاستلام الطلبية','تم إسناد شحنة لسائق، جهّز الطلبية للاستلام.','deliveries');if(!isDriver)notify(driver.id,'delivery_assigned_to_you','تم إسناد شحنة إليك','افتح مهام التوصيل لمراجعة التفاصيل.','orders');notifyOwnerAndAccountants('delivery_assigned','تم إسناد شحنة','مهمة التوصيل رقم '+jid,'deliveries');return{success:true,job_id:jid,distance_km:distance,delivery_fee:delivery,driver_earning:driverEarning,goods_total:goods,app_fee:appFee,app_fee_percent:pct,rep_id:repId,rep_commission:repFee,app_profit:profit};
}
def('delivery/assign',['owner'],(d,u)=>tx(()=>doAssignDelivery(d,u,Number(d.driver_id),false)));
def('delivery/claim',['driver'],(d,u)=>tx(()=>doAssignDelivery(d,u,u.id,true)));

def('delivery/complete',['driver'],(d,u)=>tx(()=>{
 const j=db.prepare('SELECT * FROM delivery_jobs WHERE id=? AND driver_id=?').get(Number(d.job_id),u.id);if(!j||j.status!=='assigned')bad('مهمة التوصيل غير موجودة أو مكتملة');if(j.otp_tries>=5)bad('تم قفل الرمز بعد محاولات خاطئة؛ تواصل مع الإدارة');
 if(!same(String(d.otp||''),j.otp)){db.prepare('UPDATE delivery_jobs SET otp_tries=otp_tries+1 WHERE id=?').run(j.id);log(u.id,'delivery_otp_failed',j.id);return{error:'رمز التسليم غير صحيح'};}
 const orders=db.prepare("SELECT * FROM orders WHERE job_id=? AND status='shipping' ORDER BY id").all(j.id);if(!orders.length)bad('لا توجد بنود لهذه المهمة');
 const total=j.goods_total+j.delivery_fee+j.app_fee;const aShares=alloc(j.app_fee,orders);
 // سياسة موحدة: أجرة التوصيل تُحصّل عند الباب في كل الحالات؛ البضائع الآجلة فقط تُسجّل دينًا.
 const lines=orders.map((o,i)=>({o,line:o.total+aShares[i]}));
 const cashGoods=lines.filter(x=>x.o.method==='cash').reduce((s,x)=>s+x.line,0);
 const cashPaid=j.collection_method==='cash'?cashGoods+j.delivery_fee:0;
 const unpaid=lines.filter(x=>x.o.method==='credit'||j.collection_method==='transfer').reduce((s,x)=>s+x.line,0)+(j.collection_method==='transfer'?Number(j.delivery_fee||0):0);
 if(j.collection_method==='cash'&&cashPaid>0&&d.cash_collected!==true)bad('يجب تأكيد استلام المبلغ النقدي الظاهر للسائق، ويشمل أجرة التوصيل حتى إذا كانت البضاعة آجلة.');
 const inv=Number(db.prepare(`INSERT INTO invoices(batch_id,shop_id,supplier_id,collection_method,goods_total,delivery_fee,driver_earning,app_fee_percent,app_fee,rep_id,rep_commission,app_profit,distance_km,total,paid,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(j.batch_id,j.shop_id,j.supplier_id,j.collection_method||'cash',j.goods_total,j.delivery_fee,j.driver_earning,j.app_fee_percent,j.app_fee,j.rep_id,j.rep_commission,j.app_profit,j.distance_km,total,cashPaid,cashPaid>=total?'paid':cashPaid>0?'partial':'unpaid').lastInsertRowid);
 for(const x of lines){const lineUnpaid=(x.o.method==='credit'||j.collection_method==='transfer')?x.line:0;const supplierUnpaid=(x.o.method==='credit'||j.collection_method==='transfer')?x.o.total:0;db.prepare('INSERT INTO invoice_lines(invoice_id,supplier_id,sku,product_key,product_name,qty,method,line_total,unpaid,supplier_unpaid,order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(inv,j.supplier_id,x.o.sku,x.o.product_key||norm(x.o.product_name),x.o.product_name,x.o.qty,x.o.method,x.line,lineUnpaid,supplierUnpaid,x.o.id);db.prepare("UPDATE orders SET status='delivered',reserved_credit=0 WHERE id=?").run(x.o.id);}
  if(j.collection_method==='transfer'&&j.delivery_fee>0)db.prepare('INSERT INTO invoice_lines(invoice_id,supplier_id,sku,product_key,product_name,qty,method,line_total,unpaid,supplier_unpaid) VALUES(?,?,?,?,?,?,?,?,?,?)').run(inv,j.supplier_id,'__delivery__','__delivery__','أجرة التوصيل',1,'transfer',j.delivery_fee,j.delivery_fee,0);
 if(cashPaid>0){
  db.prepare('INSERT INTO payments(invoice_id,shop_id,supplier_id,created_by,confirmed_by,amount,method,reference) VALUES(?,?,?,?,?,?,?,?)').run(inv,j.shop_id,j.supplier_id,u.id,u.id,cashPaid,'cash','تحصيل نقدي عند التسليم (قيمة النقدي + التوصيل) لمهمة #'+j.id);
  const supplierComponent=lines.filter(x=>x.o.method==='cash').reduce((a,x)=>a+x.o.total,0),driverComponent=Number(j.driver_earning||0),platformComponent=Math.max(0,cashPaid-supplierComponent-driverComponent);
  addCustody({sourceUserId:u.id,currentHolderId:u.id,shopId:j.shop_id,supplierId:j.supplier_id,invoiceId:inv,deliveryJobId:j.id,amount:cashPaid,supplierComponent,driverComponent,platformComponent,purpose:'delivery_collection',method:'cash',status:'held_by_driver',note:'تحصيل عند التسليم؛ يجب تسليم العهدة للمالك أو توثيقها حسب الصلاحية',createdBy:u.id});
 }
 db.prepare("UPDATE delivery_jobs SET status='delivered',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(j.id);log(u.id,'delivery_complete',j.id+':invoice='+inv);notify(j.shop_id,'delivery_completed','تم تسليم الطلب','تم تسليم الشحنة وإصدار الفاتورة','invoices');notify(j.supplier_id,'delivery_completed','تم تسليم الطلبية','تم تسليم طلبية المورد وإصدار الفاتورة','invoices');notifyOwnerAndAccountants('delivery_completed','تم إكمال توصيل','تم إكمال مهمة التوصيل رقم '+j.id,'deliveries');
 return{success:true,invoice_id:inv,total,paid:cashPaid,unpaid,collection_method:j.collection_method||'cash',driver_earning:j.driver_earning,app_profit:j.app_profit};
}));

def('invoices/pay',['owner','accountant'],(d,u)=>tx(()=>{
 const id=Number(d.invoice_id),inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);if(!inv)bad('الفاتورة غير موجودة أو لا تملك صلاحية الوصول');
 const amount=toM(d.amount);if(!(amount>0)||amount>inv.total-inv.paid)bad('قيمة الدفعة غير صالحة');const method=['cash','transfer','other'].includes(d.method)?d.method:'other';
 const supplierComponent=applyInvoicePayment(id,amount),paid=inv.paid+amount,status=paid>=inv.total?'paid':paid>0?'partial':'unpaid';db.prepare('UPDATE invoices SET paid=?,status=? WHERE id=?').run(paid,status,id);if(paid>=inv.total)closeClaimsForPaidInvoice(id,u.id);
 db.prepare('INSERT INTO payments(invoice_id,shop_id,supplier_id,created_by,confirmed_by,amount,method,reference) VALUES(?,?,?,?,?,?,?,?)').run(id,inv.shop_id,inv.supplier_id,u.id,u.id,amount,method,String(d.reference||'').slice(0,120));
 addCustody({sourceUserId:inv.shop_id,currentHolderId:u.id,shopId:inv.shop_id,supplierId:inv.supplier_id,invoiceId:id,amount,supplierComponent,driverComponent:0,platformComponent:Math.max(0,amount-supplierComponent),purpose:'shop_debt_payment',method,status:'held_by_owner',note:'تحصيل معتمد في الخزينة؛ توريد حصة المورد يبقى معلقًا حتى تأكيد المورد',createdBy:u.id,acceptedBy:u.id});
 log(u.id,'invoice_pay',id+':'+amount);return{success:true,paid,remaining:inv.total-paid,supplier_component:supplierComponent};
}));

// تكليف المندوب وعمولته لكل توصيل
const assignmentList=()=>db.prepare('SELECT rs.shop_id,rs.rep_id,s.name shop_name,s.phone shop_phone,s.business_name shop_business,r.name rep_name,r.phone rep_phone FROM rep_shops rs JOIN users s ON s.id=rs.shop_id JOIN users r ON r.id=rs.rep_id ORDER BY s.name').all();
def('reps/assignments',['owner'],()=>assignmentList());
def('reps/assign',['owner'],(d,u)=>tx(()=>{
 const shop=db.prepare("SELECT id FROM users WHERE id=? AND role='shop' AND active=1").get(Number(d.shop_id)),rep=db.prepare("SELECT id FROM users WHERE id=? AND role='rep' AND active=1").get(Number(d.rep_id));if(!shop||!rep)bad('اختر محلًا ومندوبًا فعالًا');
 const previous=db.prepare('SELECT rep_id FROM rep_shops WHERE shop_id=?').get(shop.id);
 db.prepare('INSERT INTO rep_shops(shop_id,rep_id,assigned_by,commission_per_delivery) VALUES(?,?,?,0) ON CONFLICT(shop_id) DO UPDATE SET rep_id=excluded.rep_id,assigned_by=excluded.assigned_by,commission_per_delivery=0,created_at=CURRENT_TIMESTAMP').run(shop.id,rep.id,u.id);
 if(!previous||Number(previous.rep_id)!==Number(rep.id))createRepEarning(rep.id,shop.id,'shop_assignment',setting('rep_shop_assignment_reward_mills'),u.id,'مكافأة إسناد محل إلى المندوب');
 log(u.id,'rep_assign',rep.id+':'+shop.id);return{success:true};
}));
def('rep/shops',['rep'],(d,u)=>{
 const shops=db.prepare(`SELECT s.id,s.name,s.phone,s.business_name,s.location_url,COALESCE((SELECT SUM(l.unpaid) FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.shop_id=s.id),0) debt FROM rep_shops rs JOIN users s ON s.id=rs.shop_id WHERE rs.rep_id=? AND s.active=1 ORDER BY s.name`).all(u.id);
 const invoices=db.prepare(`SELECT i.id,i.shop_id,i.total,i.paid,i.status,s.name shop_name,sup.name supplier_name FROM invoices i JOIN rep_shops rs ON rs.shop_id=i.shop_id AND rs.rep_id=? JOIN users s ON s.id=i.shop_id JOIN users sup ON sup.id=i.supplier_id WHERE i.total>i.paid ORDER BY i.created_at`).all(u.id);return{shops,invoices};
});
def('rep/stats',['rep'],(d,u)=>({
 completed:db.prepare("SELECT COUNT(*) n,COALESCE(SUM(distance_km),0) km,COALESCE(SUM(rep_commission),0) commission FROM delivery_jobs WHERE rep_id=? AND status='delivered'").get(u.id),
 pending:db.prepare("SELECT COUNT(*) n,COALESCE(SUM(rep_commission),0) commission FROM delivery_jobs WHERE rep_id=? AND status='assigned'").get(u.id),
 jobs:db.prepare("SELECT j.id,j.distance_km,j.rep_commission,j.status,j.created_at,s.name shop_name,sp.name supplier_name FROM delivery_jobs j JOIN users s ON s.id=j.shop_id JOIN users sp ON sp.id=j.supplier_id WHERE j.rep_id=? ORDER BY j.id DESC LIMIT 200").all(u.id)
}));
def('rep/earnings',['owner','rep'],(d,u)=>{
 const base=`SELECT e.*,r.name rep_name,s.name shop_name FROM rep_earnings e JOIN users r ON r.id=e.rep_id LEFT JOIN users s ON s.id=e.shop_id`;
 const rows=u.role==='owner'?db.prepare(base+' ORDER BY e.id DESC LIMIT 500').all():db.prepare(base+' WHERE e.rep_id=? ORDER BY e.id DESC LIMIT 300').all(u.id);
 return {rows};
});
def('rep/collections',['rep'],(d,u)=>db.prepare(`SELECT cr.*,s.name shop_name,i.total invoice_total,i.paid invoice_paid,sup.name supplier_name FROM collection_reports cr JOIN users s ON s.id=cr.shop_id JOIN invoices i ON i.id=cr.invoice_id JOIN users sup ON sup.id=i.supplier_id WHERE cr.rep_id=? ORDER BY cr.id DESC LIMIT 200`).all(u.id));
def('rep/collection/create',['rep'],(d,u)=>{
 const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(d.invoice_id));if(!inv||!db.prepare('SELECT 1 FROM rep_shops WHERE rep_id=? AND shop_id=?').get(u.id,inv.shop_id))bad('الفاتورة ليست ضمن المحال المسندة إليك');if(inv.status==='paid')bad('الفاتورة مسددة');const amount=toM(d.amount),method=d.method;if(!(amount>0)||amount>inv.total-inv.paid)bad('المبلغ غير صالح');if(!['cash','transfer','other'].includes(method))bad('طريقة تحصيل غير صالحة');const pending=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM collection_reports WHERE invoice_id=? AND status='pending'").get(inv.id).n;if(amount>inv.total-inv.paid-pending)bad('المبلغ يتجاوز المتبقي بعد التحصيلات المعلقة');const rid=Number(db.prepare('INSERT INTO collection_reports(rep_id,shop_id,invoice_id,amount,method,note) VALUES(?,?,?,?,?,?)').run(u.id,inv.shop_id,inv.id,amount,method,String(d.note||'').slice(0,250)).lastInsertRowid);log(u.id,'rep_collection',rid);return{success:true,report_id:rid};
});
def('collections/list',['owner','accountant','supplier'],(d,u)=>{
 const sql=`SELECT cr.*,r.name rep_name,s.name shop_name,i.supplier_id,i.total invoice_total,i.paid invoice_paid,sup.name supplier_name FROM collection_reports cr JOIN users r ON r.id=cr.rep_id JOIN users s ON s.id=cr.shop_id JOIN invoices i ON i.id=cr.invoice_id JOIN users sup ON sup.id=i.supplier_id`;
 return ['owner','accountant'].includes(u.role)?db.prepare(sql+' ORDER BY cr.id DESC LIMIT 300').all():db.prepare(sql+' WHERE i.supplier_id=? ORDER BY cr.id DESC LIMIT 300').all(u.id);
});
def('collections/review',['owner','accountant'],(d,u)=>tx(()=>{
 const cr=db.prepare('SELECT * FROM collection_reports WHERE id=?').get(Number(d.id));if(!cr||cr.status!=='pending')bad('طلب التحصيل غير موجود أو تمت مراجعته');const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(cr.invoice_id);if(!inv)bad('الفاتورة غير موجودة ضمن التحصيل');if(!['approve','reject'].includes(d.action))bad('قرار غير صالح');
 if(d.action==='reject'){db.prepare("UPDATE collection_reports SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,cr.id);log(u.id,'collection_reject',cr.id);return{success:true};}
 if(cr.amount>inv.total-inv.paid)bad('المبلغ يتجاوز المتبقي');const supplierComponent=applyInvoicePayment(inv.id,cr.amount);const paid=inv.paid+cr.amount;db.prepare('UPDATE invoices SET paid=?,status=? WHERE id=?').run(paid,paid>=inv.total?'paid':paid>0?'partial':'unpaid',inv.id);if(paid>=inv.total)closeClaimsForPaidInvoice(inv.id,u.id);db.prepare('INSERT INTO payments(invoice_id,shop_id,supplier_id,created_by,confirmed_by,amount,method,reference,collection_report_id) VALUES(?,?,?,?,?,?,?,?,?)').run(inv.id,inv.shop_id,inv.supplier_id,cr.rep_id,u.id,cr.amount,cr.method,cr.note,cr.id);
 addCustody({sourceUserId:cr.rep_id,currentHolderId:cr.rep_id,shopId:inv.shop_id,supplierId:inv.supplier_id,invoiceId:inv.id,amount:cr.amount,supplierComponent,driverComponent:0,platformComponent:Math.max(0,cr.amount-supplierComponent),purpose:'rep_collection',method:cr.method,status:'held_by_rep',note:'تحصيل معتمد؛ المندوب يحمل العهدة حتى تسليمها إلى المالك أو المحاسب',createdBy:u.id,acceptedBy:u.id});
 db.prepare("UPDATE collection_reports SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,cr.id);log(u.id,'collection_approve',cr.id);notify(cr.rep_id,'collection_review','تمت مراجعة تقرير التحصيل','تم اعتماد تقرير التحصيل رقم '+cr.id,'collections');notifyOwnerAndAccountants('collection_approved','تم اعتماد تحصيل','تم اعتماد تقرير التحصيل رقم '+cr.id,'collections');return{success:true,supplier_component:supplierComponent};
}));

// طلبات سداد الدين من المحل مع صورة الإيصال؛ لا يتغير الدين حتى اعتماد المورد أو المالك.
def('debt-payments/create',['shop'],(d,u)=>tx(()=>{
 const inv=db.prepare('SELECT * FROM invoices WHERE id=? AND shop_id=?').get(Number(d.invoice_id),u.id);if(!inv)bad('الفاتورة غير موجودة في حسابك');
 const outstanding=inv.total-inv.paid;if(outstanding<=0)bad('الفاتورة مسددة بالكامل');const amount=toM(d.amount);if(!(amount>0)||amount>outstanding)bad('قيمة التسديد غير صالحة');
 const pending=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM debt_payment_requests WHERE invoice_id=? AND status='pending'").get(inv.id).n;if(amount>outstanding-pending)bad('قيمة الطلب تتجاوز الرصيد بعد طلبات التسديد المعلقة');
 if(!d.receipt_image)bad('ارفع صورة إيصال التسديد لإرسال الطلب');const receipt=hashFile(d.receipt_image,PRIVATE_RECEIPTS,'receipt');
 try{const id=Number(db.prepare('INSERT INTO debt_payment_requests(invoice_id,shop_id,supplier_id,amount,method,receipt_path,note) VALUES(?,?,?,?,?,?,?)').run(inv.id,u.id,inv.supplier_id,amount,['cash','transfer','other'].includes(d.method)?d.method:'transfer',receipt,String(d.note||'').slice(0,300)).lastInsertRowid);log(u.id,'debt_payment_submit',id+':invoice='+inv.id);notifyOwnerAndAccountants('debt_payment_submitted','طلب تسديد دين جديد','طلب رقم '+id+' من المحل '+u.id,'debtPayments');notify(inv.supplier_id,'debt_payment_submitted','طلب تسديد دين','أرسل أحد المحال طلب تسديد للفاتورة #'+inv.id,'debtPayments');return{success:true,id,message:'تم استلام طلب التسديد. سيتم مراجعة المبلغ وصورة الإيصال، وعند الاعتماد سيتم تحديث الدين وخصم المبلغ المعتمد.'};}catch(e){try{fs.unlinkSync(path.join(PRIVATE_RECEIPTS,receipt));}catch{}throw e;}
}));
def('debt-payments/list',['owner','accountant','supplier','shop'],(d,u)=>{
 const base=`SELECT r.*,s.name shop_name,s.business_name shop_business,sup.name supplier_name,i.total invoice_total,i.paid invoice_paid FROM debt_payment_requests r JOIN users s ON s.id=r.shop_id JOIN users sup ON sup.id=r.supplier_id JOIN invoices i ON i.id=r.invoice_id`;
 const rows=['owner','accountant'].includes(u.role)?db.prepare(base+' ORDER BY r.id DESC LIMIT 300').all():u.role==='supplier'?db.prepare(base+' WHERE r.supplier_id=? ORDER BY r.id DESC LIMIT 300').all(u.id):db.prepare(base+' WHERE r.shop_id=? ORDER BY r.id DESC LIMIT 200').all(u.id);
 return rows.map(x=>{const out={...x,has_receipt:!!x.receipt_path};delete out.receipt_path;return out;});
});
def('debt-payments/receipt',['owner','accountant','supplier','shop'],(d,u)=>{
 const r=db.prepare('SELECT * FROM debt_payment_requests WHERE id=?').get(Number(d.id));if(!r)bad('طلب التسديد غير موجود');
 if(u.role==='shop'&&r.shop_id!==u.id)bad('لا تملك صلاحية عرض هذا الإيصال');if(u.role==='supplier'&&r.supplier_id!==u.id)bad('لا تملك صلاحية عرض هذا الإيصال');
 const image=imageData(r.receipt_path,PRIVATE_RECEIPTS);if(!image)bad('صورة الإيصال غير موجودة');return{success:true,image};
});
def('debt-payments/review',['owner','accountant'],(d,u)=>tx(()=>{
 const r=db.prepare("SELECT * FROM debt_payment_requests WHERE id=? AND status='pending'").get(Number(d.id));if(!r)bad('طلب التسديد غير موجود أو تمت مراجعته');if(u.role==='supplier'&&r.supplier_id!==u.id)bad('هذا الطلب لا يخص فواتيرك');
 if(!['approve','reject'].includes(d.action))bad('قرار المراجعة غير صالح');const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(r.invoice_id);if(!inv||inv.supplier_id!==r.supplier_id)bad('الفاتورة غير متطابقة');
 if(d.action==='reject'){db.prepare("UPDATE debt_payment_requests SET status='rejected',reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,String(d.note||'').slice(0,300),r.id);log(u.id,'debt_payment_reject',r.id);notify(r.shop_id,'debt_payment_rejected','لم يعتمد طلب التسديد','طلب التسديد #'+r.id+' يحتاج إلى المراجعة','debtPayments');return{success:true};}
 if(r.amount>inv.total-inv.paid)bad('لم يعد الرصيد كافيًا لاعتماد الطلب');const supplierComponent=applyInvoicePayment(inv.id,r.amount);
 const paid=inv.paid+r.amount,status=paid>=inv.total?'paid':paid>0?'partial':'unpaid';db.prepare('UPDATE invoices SET paid=?,status=? WHERE id=?').run(paid,status,inv.id);if(paid>=inv.total)closeClaimsForPaidInvoice(inv.id,u.id);
 db.prepare('INSERT INTO payments(invoice_id,shop_id,supplier_id,created_by,confirmed_by,amount,method,reference) VALUES(?,?,?,?,?,?,?,?)').run(inv.id,r.shop_id,r.supplier_id,r.shop_id,u.id,r.amount,r.method,'اعتماد طلب تسديد #'+r.id+(r.note?' - '+r.note:''));
 if(['owner','accountant'].includes(u.role))addCustody({sourceUserId:r.shop_id,currentHolderId:u.id,shopId:r.shop_id,supplierId:r.supplier_id,invoiceId:inv.id,amount:r.amount,supplierComponent,driverComponent:0,platformComponent:Math.max(0,r.amount-supplierComponent),purpose:'shop_debt_payment',method:r.method,status:'held_by_owner',note:'اعتمد المالك إيصال المحل؛ حصة المورد غير معدودة مستلمة حتى تأكيد المورد',createdBy:u.id,acceptedBy:u.id});
 db.prepare("UPDATE debt_payment_requests SET status='approved',reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,String(d.note||'تم اعتماد الإيصال').slice(0,300),r.id);log(u.id,'debt_payment_approve',r.id+':'+r.amount);notify(r.shop_id,'debt_payment_approved','تم اعتماد التسديد','تم اعتماد مبلغ '+money(r.amount)+' د.ل للفاتورة #'+inv.id,'debtPayments');notifyOwnerAndAccountants('debt_payment_approved','تم اعتماد تسديد دين','طلب تسديد #'+r.id,'debtPayments');return{success:true,paid,remaining:inv.total-paid,supplier_component:supplierComponent};
}));

// دفتر العهدة: الأموال تبقى على حاملها حتى يؤكد الطرف التالي استلامها.
def('cash-custody/list',['owner','accountant','driver','rep'],(d,u)=>{
 const base=`SELECT c.*,src.name source_name,h.name holder_name,s.name shop_name,s.business_name shop_business,sup.name supplier_name,sup.business_name supplier_business,i.total invoice_total FROM cash_custody c LEFT JOIN users src ON src.id=c.source_user_id LEFT JOIN users h ON h.id=c.current_holder_id LEFT JOIN users s ON s.id=c.shop_id LEFT JOIN users sup ON sup.id=c.supplier_id LEFT JOIN invoices i ON i.id=c.invoice_id`;
 let rows;if(['owner','accountant'].includes(u.role))rows=db.prepare(base+" WHERE c.status NOT IN ('closed','received_by_supplier') OR c.status='received_by_supplier' ORDER BY c.id DESC LIMIT 500").all();else rows=db.prepare(base+" WHERE c.current_holder_id=? AND c.status IN ('held_by_driver','held_by_rep','awaiting_owner_receipt','held_by_rep_for_supplier','awaiting_supplier_confirmation') ORDER BY c.id DESC LIMIT 200").all(u.id);
 return rows.map(x=>{if(!['owner','accountant'].includes(u.role)){delete x.supplier_component;delete x.driver_component;delete x.platform_component;delete x.app_profit;delete x.source_name;delete x.invoice_total;if(u.role==='driver')delete x.supplier_business;}return x;});
});

def('cash-custody/treasury-deposit',['owner','accountant'],(d,u)=>tx(()=>{
 const amount=toM(d.amount);if(!(amount>0))bad('أدخل مبلغًا موجبًا');const method=String(d.method||'cash');if(!['cash','transfer','other'].includes(method))bad('اختر طريقة استلام صحيحة');const id=addCustody({sourceUserId:u.id,currentHolderId:u.id,amount,supplierComponent:0,driverComponent:0,platformComponent:amount,purpose:String(d.purpose||'إيداع في الخزينة').slice(0,120),method,status:'held_by_owner',note:String(d.note||'تم الاستلام فعليًا وتسجيله بالخزينة').slice(0,400),createdBy:u.id,acceptedBy:u.id});log(u.id,'treasury_deposit',id+':'+amount);notifyOwnerAndAccountants('treasury_deposit','تم تسجيل مبلغ داخل الخزينة','سجل #'+id,'custody');return{success:true,id};
}));
def('cash-custody/request-handover',['driver','rep'],(d,u)=>tx(()=>{
 const c=db.prepare('SELECT * FROM cash_custody WHERE id=? AND current_holder_id=?').get(Number(d.id),u.id);if(!c||!['held_by_driver','held_by_rep'].includes(c.status))bad('هذه العهدة ليست بحوزتك أو تم إرسالها مسبقًا');const toStatus='awaiting_owner_receipt';db.prepare("UPDATE cash_custody SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(toStatus,c.id);addCustodyEvent(c.id,u.id,'handover_requested',u.id,null,c.amount,String(d.note||'طلب تسليم العهدة للمالك'));log(u.id,'cash_handover_requested',c.id);return{success:true};
}));
def('cash-custody/owner-receive',['owner','accountant'],(d,u)=>tx(()=>{
 const c=db.prepare("SELECT * FROM cash_custody WHERE id=? AND status IN ('held_by_driver','held_by_rep','awaiting_owner_receipt')").get(Number(d.id));if(!c||!c.current_holder_id||c.current_holder_id===u.id)bad('لا توجد عهدة معلقة لدى طرف آخر لاستلامها');const from=c.current_holder_id;db.prepare("UPDATE cash_custody SET current_holder_id=?,status='held_by_owner',accepted_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,u.id,c.id);addCustodyEvent(c.id,u.id,'owner_received',from,u.id,c.amount,String(d.note||'استلام المبلغ بواسطة المالك'));log(u.id,'cash_owner_received',c.id);notify(from,'custody_received','تم استلام العهدة','تم تأكيد استلام العهدة رقم '+c.id,'custody');notifyOwnerAndAccountants('custody_received','تم استلام عهدة','تم استلام العهدة رقم '+c.id,'custody');return{success:true};
}));
def('supplier-remittances/create',['owner','accountant'],(d,u)=>tx(()=>{
 const source=db.prepare("SELECT * FROM cash_custody WHERE id=? AND current_holder_id=? AND status='held_by_owner'").get(Number(d.custody_id),u.id);if(!source)bad('العهدة يجب أن تكون مستلمة لدى المالك قبل التوريد للمورد');const amount=toM(d.amount);if(!(amount>0)||amount>source.supplier_component||amount>source.amount)bad('قيمة التوريد أكبر من مستحق المورد المتاح في العهدة');const method=String(d.method||'transfer');if(!['transfer','cash_via_rep','cash_direct'].includes(method))bad('اختر طريقة توريد صحيحة');let repId=null,holder=u.id,status='awaiting_supplier_confirmation',custodyStatus='awaiting_supplier_confirmation';if(method==='cash_via_rep'){const rep=db.prepare("SELECT id FROM users WHERE id=? AND role='rep' AND active=1").get(Number(d.rep_id));if(!rep)bad('اختر مندوبًا فعالًا لاستلام المبلغ وتسليمه للمورد');repId=rep.id;holder=rep.id;status='with_rep';custodyStatus='held_by_rep_for_supplier';}
 db.prepare(`UPDATE cash_custody SET amount=amount-?,supplier_component=supplier_component-?,status=CASE WHEN amount-?=0 THEN 'closed' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(amount,amount,amount,source.id);addCustodyEvent(source.id,u.id,'supplier_remittance_created',u.id,holder,amount,'تحويل جزء من العهدة إلى توريد للمورد');
 const child=addCustody({parentId:source.id,sourceUserId:u.id,currentHolderId:holder,shopId:source.shop_id,supplierId:source.supplier_id,invoiceId:source.invoice_id,deliveryJobId:source.delivery_job_id,amount,supplierComponent:amount,driverComponent:0,platformComponent:0,purpose:'supplier_remittance',method,status:custodyStatus,note:'مستحق للمورد؛ لا يعتبر مستلمًا حتى يؤكد المورد',createdBy:u.id});const id=Number(db.prepare('INSERT INTO supplier_remittances(custody_id,source_custody_id,supplier_id,rep_id,invoice_id,amount,method,status,reference,note,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(child,source.id,source.supplier_id,repId,source.invoice_id,amount,method,status,String(d.reference||'').slice(0,120),String(d.note||'').slice(0,300),u.id).lastInsertRowid);log(u.id,'supplier_remittance_create',id);notifyRole('supplier','supplier_remittance','توريد مستحقات مورد','لديك سجل توريد جديد بانتظار المراجعة','remittances');return{success:true,id};
}));
def('supplier-remittances/list',['owner','accountant','supplier','rep'],(d,u)=>{
 const base=`SELECT r.*,sup.name supplier_name,sup.business_name supplier_business,rep.name rep_name,src.name shop_name,i.id invoice_number FROM supplier_remittances r JOIN users sup ON sup.id=r.supplier_id LEFT JOIN users rep ON rep.id=r.rep_id LEFT JOIN cash_custody c ON c.id=r.custody_id LEFT JOIN users src ON src.id=c.shop_id LEFT JOIN invoices i ON i.id=r.invoice_id`;
 let rows;if(['owner','accountant'].includes(u.role))rows=db.prepare(base+' ORDER BY r.id DESC LIMIT 500').all();else if(u.role==='supplier')rows=db.prepare(base+' WHERE r.supplier_id=? ORDER BY r.id DESC LIMIT 300').all(u.id);else rows=db.prepare(base+' WHERE r.rep_id=? ORDER BY r.id DESC LIMIT 200').all(u.id);
 return rows.map(x=>{if(!['owner','accountant'].includes(u.role)){delete x.source_custody_id;delete x.custody_id;delete x.created_by;}return x;});
});
def('supplier-remittances/handover',['rep'],(d,u)=>tx(()=>{
 const r=db.prepare("SELECT * FROM supplier_remittances WHERE id=? AND rep_id=? AND status='with_rep'").get(Number(d.id),u.id);if(!r)bad('التوريد غير مسند إليك أو تم تحديث حالته');db.prepare("UPDATE supplier_remittances SET status='awaiting_supplier_confirmation',note=CASE WHEN note='' THEN 'أفاد المندوب بتسليم المبلغ للمورد' ELSE note||' | أفاد المندوب بتسليم المبلغ للمورد' END WHERE id=?").run(r.id);db.prepare("UPDATE cash_custody SET status='awaiting_supplier_confirmation',updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_holder_id=?").run(r.custody_id,u.id);addCustodyEvent(r.custody_id,u.id,'rep_handover_to_supplier',u.id,null,r.amount,'المندوب يطلب من المورد تأكيد الاستلام');return{success:true};
}));
def('supplier-remittances/confirm',['supplier'],(d,u)=>tx(()=>{
 const r=db.prepare("SELECT * FROM supplier_remittances WHERE id=? AND supplier_id=? AND status='awaiting_supplier_confirmation'").get(Number(d.id),u.id);if(!r)bad('لا يوجد تحويل بانتظار تأكيدك');db.prepare("UPDATE supplier_remittances SET status='received',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,r.id);db.prepare("UPDATE cash_custody SET status='received_by_supplier',current_holder_id=?,accepted_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,u.id,r.custody_id);addCustodyEvent(r.custody_id,u.id,'supplier_confirmed_receipt',null,u.id,r.amount,String(d.note||'أكد المورد استلام المبلغ'));log(u.id,'supplier_remittance_received',r.id);notify(r.created_by,'supplier_remittance_confirmed','أكد المورد استلام المستحق','أكد المورد استلام المبلغ للسجل #'+r.id,'remittances');notifyOwnerAndAccountants('supplier_remittance_confirmed','أكد المورد الاستلام','توريد رقم '+r.id,'remittances');return{success:true};
}));
def('payouts/list',['owner','accountant','driver','rep'],(d,u)=>{
 const base=`SELECT p.*,x.name recipient_name,x.role recipient_role FROM payouts p JOIN users x ON x.id=p.recipient_user_id`;
 const rows=['owner','accountant'].includes(u.role)?db.prepare(base+' ORDER BY p.id DESC LIMIT 500').all():db.prepare(base+' WHERE p.recipient_user_id=? ORDER BY p.id DESC LIMIT 200').all(u.id);
 return rows;
});
def('payouts/eligible',['owner','accountant'],()=>{
 const users=db.prepare("SELECT id,name,role FROM users WHERE active=1 AND role IN ('driver','rep') ORDER BY role,name").all();
 const rows=users.map(x=>{let earned=0;if(x.role==='driver')earned=Number(db.prepare("SELECT COALESCE(SUM(driver_earning),0) n FROM delivery_jobs WHERE driver_id=? AND status='delivered'").get(x.id).n||0);else earned=Number(db.prepare('SELECT COALESCE(SUM(amount),0) n FROM rep_earnings WHERE rep_id=?').get(x.id).n||0);const paid=Number(db.prepare("SELECT COALESCE(SUM(amount),0) n FROM payouts WHERE recipient_user_id=? AND status IN ('sent','confirmed')").get(x.id).n||0);return{...x,earned,paid,available:Math.max(0,earned-paid)};});
 return {rows};
});
def('payouts/create',['owner','accountant'],(d,u)=>tx(()=>{
 const recipient=db.prepare("SELECT id,role FROM users WHERE id=? AND active=1 AND role IN ('driver','rep')").get(Number(d.recipient_user_id));if(!recipient)bad('اختر سائقًا أو مندوبًا فعالًا');const amount=toM(d.amount),method=String(d.method||'cash');if(!(amount>0)||!['cash','transfer','other'].includes(method))bad('قيمة أو طريقة الدفع غير صحيحة');const reason=recipient.role==='driver'?'delivery_earning':'rep_reward';let earned=0;if(recipient.role==='driver')earned=Number(db.prepare("SELECT COALESCE(SUM(driver_earning),0) n FROM delivery_jobs WHERE driver_id=? AND status='delivered'").get(recipient.id).n||0);else earned=Number(db.prepare('SELECT COALESCE(SUM(amount),0) n FROM rep_earnings WHERE rep_id=?').get(recipient.id).n||0);const paid=Number(db.prepare("SELECT COALESCE(SUM(amount),0) n FROM payouts WHERE recipient_user_id=? AND status IN ('sent','confirmed')").get(recipient.id).n||0);if(amount>earned-paid)bad('المبلغ أكبر من المستحق غير المدفوع للمستفيد');if(!d.custody_id)bad('لا يمكن تسجيل صرف خارج الخزينة؛ اختر عهدة استلمها المالك أو المحاسب أولًا');const custodyId=Number(d.custody_id);const c=db.prepare("SELECT * FROM cash_custody WHERE id=? AND current_holder_id=? AND status='held_by_owner'").get(custodyId,u.id);if(!c||c.amount<amount)bad('العهدة المختارة لا تكفي لتغطية الدفعة');if(recipient.role==='driver'&&c.driver_component+c.platform_component<amount)bad('العهدة المختارة لا تحتوي على رصيد كافٍ لصرف مستحق السائق');if(recipient.role==='rep'&&c.platform_component<amount)bad('العهدة المختارة لا تحتوي على رصيد منصة كافٍ لصرف مكافأة المندوب');if(recipient.role==='driver'){const fromDriver=Math.min(c.driver_component,amount),fromPlatform=amount-fromDriver;db.prepare(`UPDATE cash_custody SET amount=amount-?,driver_component=driver_component-?,platform_component=platform_component-?,status=CASE WHEN amount-?=0 THEN 'closed' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(amount,fromDriver,fromPlatform,amount,c.id);}else db.prepare(`UPDATE cash_custody SET amount=amount-?,platform_component=platform_component-?,status=CASE WHEN amount-?=0 THEN 'closed' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(amount,amount,amount,c.id);addCustodyEvent(c.id,u.id,'payout_from_custody',u.id,recipient.id,amount,'صرف مستحق من عهدة الخزينة');
 const id=Number(db.prepare('INSERT INTO payouts(recipient_user_id,recipient_role,amount,method,reason,status,reference,note,custody_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(recipient.id,recipient.role,amount,method,reason,'sent',String(d.reference||'').slice(0,120),String(d.note||'').slice(0,300),custodyId,u.id).lastInsertRowid);log(u.id,'payout_create',id+':'+amount);notify(recipient.id,'payout_sent','تم إرسال مستحقاتك','تم تسجيل مبلغ مستحق لك بانتظار التأكيد','payouts');return{success:true,id};
}));
def('payouts/confirm',['driver','rep'],(d,u)=>tx(()=>{
 const p=db.prepare("SELECT * FROM payouts WHERE id=? AND recipient_user_id=? AND status='sent'").get(Number(d.id),u.id);if(!p)bad('لا يوجد مستحق مرسل بانتظار تأكيدك');db.prepare("UPDATE payouts SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=?").run(u.id,p.id);log(u.id,'payout_confirm',p.id);return{success:true};
}));

// مطالبات المورد بتحصيل الدين، مع إسناد مقيد للمالك، ومواقع الطرفين للمندوب والسائق المسندين فقط.
def('debt-claims/create',['supplier'],(d,u)=>tx(()=>{
 const inv=db.prepare('SELECT * FROM invoices WHERE id=? AND supplier_id=?').get(Number(d.invoice_id),u.id);if(!inv)bad('الفاتورة غير موجودة ضمن حساب المورد');const remaining=inv.total-inv.paid;if(remaining<=0)bad('الفاتورة مسددة بالكامل');
 const amount=d.amount===undefined||d.amount===''?remaining:toM(d.amount);if(!(amount>0)||amount>remaining)bad('مبلغ المطالبة غير صالح');
 const open=db.prepare("SELECT id FROM debt_claims WHERE invoice_id=? AND status IN ('new','assigned','in_progress','follow_up','disputed')").get(inv.id);if(open)bad('توجد مطالبة مفتوحة بالفعل لهذه الفاتورة');
 const id=Number(db.prepare("INSERT INTO debt_claims(supplier_id,shop_id,invoice_id,amount,note,status,created_by) VALUES(?,?,?,?,?,'new',?)").run(u.id,inv.shop_id,inv.id,amount,String(d.note||'').slice(0,300),u.id).lastInsertRowid);log(u.id,'debt_claim_create',id);notifyOwnerAndAccountants('debt_claim_created','مطالبة دين جديدة','المورد أنشأ مطالبة للفاتورة #'+inv.id,'claims');return{success:true,id};
}));
def('debt-claims/list',['owner','accountant','supplier','shop','driver','rep'],(d,u)=>{
 const base=`SELECT c.*,s.name shop_name,s.phone shop_phone,s.business_name shop_business,s.location_url shop_location,sp.name supplier_name,sp.phone supplier_phone,sp.business_name supplier_business,sp.location_url supplier_location,i.total invoice_total,i.paid invoice_paid,dr.name driver_name,r.name rep_name FROM debt_claims c JOIN users s ON s.id=c.shop_id JOIN users sp ON sp.id=c.supplier_id JOIN invoices i ON i.id=c.invoice_id LEFT JOIN users dr ON dr.id=c.driver_id LEFT JOIN users r ON r.id=c.rep_id`;
 let rows;if(['owner','accountant'].includes(u.role))rows=db.prepare(base+' ORDER BY c.id DESC LIMIT 300').all();else if(u.role==='supplier')rows=db.prepare(base+' WHERE c.supplier_id=? ORDER BY c.id DESC LIMIT 200').all(u.id);else if(u.role==='shop')rows=db.prepare(base+' WHERE c.shop_id=? ORDER BY c.id DESC LIMIT 200').all(u.id);else if(u.role==='driver')rows=db.prepare(base+' WHERE c.driver_id=? ORDER BY c.id DESC LIMIT 200').all(u.id);else rows=db.prepare(base+' WHERE c.rep_id=? ORDER BY c.id DESC LIMIT 200').all(u.id);return rows;
});
def('debt-claims/assign',['owner'],(d,u)=>tx(()=>{
 const c=db.prepare('SELECT * FROM debt_claims WHERE id=?').get(Number(d.id));if(!c||!['new','assigned','in_progress','follow_up'].includes(c.status))bad('المطالبة غير موجودة أو مغلقة');
 const rep=db.prepare("SELECT id FROM users WHERE id=? AND role='rep' AND active=1").get(Number(d.rep_id)),driver=db.prepare("SELECT id FROM users WHERE id=? AND role='driver' AND active=1").get(Number(d.driver_id));if(!rep||!driver)bad('اختر مندوب متابعة وسائقًا فعالين');
 db.prepare("UPDATE debt_claims SET rep_id=?,driver_id=?,assigned_by=?,status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(rep.id,driver.id,u.id,c.id);db.prepare('INSERT INTO debt_claim_updates(claim_id,actor_id,action,note) VALUES(?,?,?,?)').run(c.id,u.id,'assigned',String(d.note||'إسناد من الإدارة').slice(0,300));log(u.id,'debt_claim_assign',c.id+':rep='+rep.id+':driver='+driver.id);notify(rep.id,'debt_claim_assigned','مطالبة دين مسندة إليك','المطالبة #'+c.id,'claims');notify(driver.id,'debt_claim_assigned','مهمة متابعة تحصيل مسندة إليك','المطالبة #'+c.id,'claims');return{success:true};
}));
def('debt-claims/update',['driver','rep'],(d,u)=>tx(()=>{
 const c=db.prepare('SELECT * FROM debt_claims WHERE id=?').get(Number(d.id));if(!c)bad('المطالبة غير موجودة');if(u.role==='driver'&&c.driver_id!==u.id)bad('المطالبة ليست مسندة إليك');if(u.role==='rep'&&c.rep_id!==u.id)bad('المطالبة ليست مسندة إليك');
 const allowed=['visited','promise_to_pay','no_answer','disputed','follow_up','visit_failed'];if(!allowed.includes(d.action))bad('اختر نتيجة متابعة صحيحة');const date=String(d.next_followup_date||'');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))bad('تاريخ المتابعة يجب أن يكون YYYY-MM-DD');if(d.action==='promise_to_pay'&&!date)bad('حدد تاريخ وعد السداد');
 const status=d.action==='disputed'?'disputed':d.action==='follow_up'||d.action==='promise_to_pay'?'follow_up':'in_progress';const note=String(d.note||'').slice(0,500);
 db.prepare('UPDATE debt_claims SET status=?,outcome=?,outcome_note=?,next_followup_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,d.action,note,date||null,c.id);db.prepare('INSERT INTO debt_claim_updates(claim_id,actor_id,action,note,next_followup_date) VALUES(?,?,?,?,?)').run(c.id,u.id,d.action,note,date||null);log(u.id,'debt_claim_update',c.id+':'+d.action);return{success:true};
}));
def('debt-claims/history',['owner','accountant','supplier','driver','rep','shop'],(d,u)=>{
 const c=db.prepare('SELECT * FROM debt_claims WHERE id=?').get(Number(d.id));if(!c)bad('المطالبة غير موجودة');if(u.role==='supplier'&&c.supplier_id!==u.id)bad('لا تملك الصلاحية');if(u.role==='shop'&&c.shop_id!==u.id)bad('لا تملك الصلاحية');if(u.role==='driver'&&c.driver_id!==u.id)bad('لا تملك الصلاحية');if(u.role==='rep'&&c.rep_id!==u.id)bad('لا تملك الصلاحية');return db.prepare('SELECT h.*,u.name actor_name FROM debt_claim_updates h JOIN users u ON u.id=h.actor_id WHERE h.claim_id=? ORDER BY h.id DESC').all(c.id);
});

// نظام العهود/التعهدات المالية
def('promises/create',['owner','accountant','shop','supplier'],(d,u)=>tx(()=>{
 const shop_id=Number(d.shop_id),supplier_id=Number(d.supplier_id),amount=Number(d.amount),due_date=String(d.due_date||'').trim();
 if(!shop_id||!supplier_id||!amount||amount<=0)bad('أدخل بيانات العهدة بشكل صحيح');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(due_date))bad('تاريخ الاستحقاق يجب أن يكون YYYY-MM-DD');
 const now=new Date();const due=new Date(due_date+'T23:59:59');if(due<now)bad('تاريخ الاستحقاق يجب أن يكون في المستقبل');
 const shop=db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(shop_id);if(!shop||shop.role!=='shop')bad('المحل غير موجود أو غير فعال');
 const supplier=db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(supplier_id);if(!supplier||supplier.role!=='supplier')bad('المورد غير موجود أو غير فعال');
 const id=Number(db.prepare('INSERT INTO promises(shop_id,supplier_id,amount,due_date,status,created_by,note) VALUES(?,?,?,?,?,?,?)').run(shop_id,supplier_id,amount,due_date,'pending',u.id,String(d.note||'').slice(0,500)).lastInsertRowid);
 notify(supplier_id,'promise_created','عهدة مالية جديدة','تم إنشاء عهدة بقيمة '+String(amount)+' من '+shop.name+' تستحق في '+due_date,'promises');
 log(u.id,'promise_create','#'+id);return{success:true,id};
}));
def('promises/list',['owner','accountant','shop','supplier'],(d,u)=>{
 let base='SELECT p.*,s.name shop_name,s.business_name shop_business,sp.name supplier_name,sp.business_name supplier_business FROM promises p JOIN users s ON s.id=p.shop_id JOIN users sp ON sp.id=p.supplier_id';
 const params=[];
 if(u.role==='shop'){base+=' WHERE p.shop_id=?';params.push(u.id);}
 else if(u.role==='supplier'){base+=' WHERE p.supplier_id=?';params.push(u.id);}
 else{base+=' WHERE 1=1';}
 const status=String(d.status||'').trim();if(status){base+=(params.length?' AND ':' WHERE ')+'p.status=?';params.push(status);}
 base+=' ORDER BY p.id DESC LIMIT 300';return db.prepare(base).all(...params);
});
def('promises/update',['owner','accountant'],(d,u)=>tx(()=>{
 const p=db.prepare('SELECT * FROM promises WHERE id=?').get(Number(d.id));if(!p)bad('العهدة غير موجودة');
 const status=String(d.status||'').trim();if(!['pending','confirmed','fulfilled','cancelled'].includes(status))bad('حالة غير صحيحة');
 db.prepare("UPDATE promises SET status=?,note=?,updated_at=datetime('now') WHERE id=?").run(status,String(d.note||p.note).slice(0,500),p.id);
 log(u.id,'promise_update','#'+p.id+'->'+status);
 const targetId=p.shop_id?p.shop_id:p.supplier_id;
 notify(targetId,'promise_updated','تحديث حالة العهدة #'+p.id,'الحالة الجديدة: '+status,'promises');
 return{success:true};
}));

// إشعارات داخل التطبيق مع عدّاد غير المقروء. الإشعارات تُسجل على الخادم لكل مستلم.
def('notifications/list',ALL_AUTH_ROLES,(d,u)=>db.prepare('SELECT id,event_type,title,message,link,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(u.id));
def('notifications/unread-count',ALL_AUTH_ROLES,(d,u)=>({count:Number(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get(u.id).n||0)}));
def('notifications/read',ALL_AUTH_ROLES,(d,u)=>{const id=Number(d.id);db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(id,u.id);return{success:true};});
def('notifications/read-all',ALL_AUTH_ROLES,(d,u)=>{db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(u.id);return{success:true};});

// إسناد حق طلب تغيير طلبية لمقدم خدمة أو مشترك: لا يرى هؤلاء إلا الطلبات المسندة لهم.
def('service-order-access/list',['owner','accountant','service_provider','subscriber'],(d,u)=>{
 const base=`SELECT a.*,o.id sample_order_id,s.name shop_name,sp.name supplier_name,s.business_name shop_business,sup.business_name supplier_business FROM service_order_access a JOIN orders o ON o.batch_id=a.batch_id AND o.supplier_id=a.supplier_id JOIN users s ON s.id=o.shop_id JOIN users sp ON sp.id=o.supplier_id JOIN users sup ON sup.id=o.supplier_id`;
 if(['owner','accountant'].includes(u.role))return db.prepare(`SELECT a.*,o.id sample_order_id,s.name shop_name,sp.name supplier_name,s.business_name shop_business,sup.business_name supplier_business,usr.name user_name,usr.role user_role FROM service_order_access a JOIN orders o ON o.batch_id=a.batch_id AND o.supplier_id=a.supplier_id JOIN users s ON s.id=o.shop_id JOIN users sp ON sp.id=o.supplier_id JOIN users sup ON sup.id=o.supplier_id JOIN users usr ON usr.id=a.user_id WHERE o.id=(SELECT MIN(id) FROM orders x WHERE x.batch_id=a.batch_id AND x.supplier_id=a.supplier_id) ORDER BY a.id DESC LIMIT 300`).all();
 return db.prepare(`SELECT a.*,o.id sample_order_id,s.name shop_name,sp.name supplier_name,s.business_name shop_business,sup.business_name supplier_business FROM service_order_access a JOIN orders o ON o.batch_id=a.batch_id AND o.supplier_id=a.supplier_id JOIN users s ON s.id=o.shop_id JOIN users sp ON sp.id=o.supplier_id JOIN users sup ON sup.id=o.supplier_id WHERE a.user_id=? AND o.id=(SELECT MIN(id) FROM orders x WHERE x.batch_id=a.batch_id AND x.supplier_id=a.supplier_id) ORDER BY a.id DESC`).all(u.id);
});
def('service-order-access/assign',['owner'],(d,u)=>tx(()=>{
 const target=db.prepare("SELECT id,role FROM users WHERE id=? AND active=1 AND role IN ('service_provider','subscriber')").get(Number(d.user_id));if(!target)bad('اختر مقدم خدمة أو مشتركًا فعالًا');const o=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(d.order_id));if(!o)bad('الطلب غير موجود');
 db.prepare('INSERT INTO service_order_access(user_id,batch_id,supplier_id,granted_by,can_cancel,can_stop,can_return) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,batch_id,supplier_id) DO UPDATE SET granted_by=excluded.granted_by,can_cancel=excluded.can_cancel,can_stop=excluded.can_stop,can_return=excluded.can_return').run(target.id,o.batch_id,o.supplier_id,u.id,d.can_cancel===false?0:1,d.can_stop===false?0:1,d.can_return===false?0:1);
 notify(target.id,'service_order_assigned','تم إسناد طلبية لك','يمكنك الآن متابعة الطلبية وطلب إلغاء أو إيقاف أو إرجاع وفق الصلاحيات','requests');log(u.id,'service_order_access_assign',target.id+':'+o.batch_id+':'+o.supplier_id);return{success:true};
}));

// إدارة طلبات الإلغاء/الإيقاف/الإرجاع. لا يتم تغيير حالة الطلب مباشرة من الخدمة المشتركة.
def('order-change-requests/create',['service_provider','subscriber','shop'],(d,u)=>tx(()=>{
 const o=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(d.order_id));
 if(!o)bad('الطلب غير موجود');
 if(u.role==='shop'&&o.shop_id!==u.id)bad('هذا الطلب لا يخص محلك');
 if(['service_provider','subscriber'].includes(u.role)){
  const a=db.prepare('SELECT * FROM service_order_access WHERE user_id=? AND batch_id=? AND supplier_id=?').get(u.id,o.batch_id,o.supplier_id);
  if(!a)bad('هذه الطلبية غير مسندة إلى حسابك');
 }
 const type=String(d.request_type||''),reason=String(d.reason||'').trim();
 if(!['cancel','stop','return'].includes(type))bad('نوع الإجراء غير صالح');
 if(!reason)bad('سبب الإجراء مطلوب');
 if(['service_provider','subscriber'].includes(u.role)){
  const a=db.prepare('SELECT * FROM service_order_access WHERE user_id=? AND batch_id=? AND supplier_id=?').get(u.id,o.batch_id,o.supplier_id);
  if(!a||(type==='cancel'&&!a.can_cancel)||(type==='stop'&&!a.can_stop)||(type==='return'&&!a.can_return))bad('لا توجد صلاحية لهذا الإجراء على الطلبية المسندة');
 }
 if(type==='return'&&!Object.keys(PENALTY_RULES).includes(reason))bad('اختر سبب الإرجاع المحدد');
 if(type==='cancel'&&o.status==='pending'){
  // إلغاء مباشر لصنف معلّق فقط، مع حفظ السجل وإشعار المورد.
  const id=Number(db.prepare(`INSERT INTO order_change_requests
   (order_id,batch_id,supplier_id,shop_id,requested_by,request_type,reason,penalty_amount,penalty_status,penalty_responsible,penalty_beneficiary,status,decision_by,decision_note,decided_at)
   VALUES(?,?,?,?,?,'cancel',?,0,'not_applicable','','','approved',?,?,CURRENT_TIMESTAMP)`)
   .run(o.id,o.batch_id,o.supplier_id,o.shop_id,u.id,reason,u.id,'إلغاء مباشر قبل قبول المورد').lastInsertRowid);
  restoreOnce(o);
  db.prepare("UPDATE orders SET status='cancelled',reserved_credit=0 WHERE id=? AND status='pending'").run(o.id);
  maybeVoidShipmentFee(o.batch_id,o.supplier_id);
  rebalanceQuotedShipmentFee(o.batch_id,o.supplier_id);
  log(u.id,'order_cancel_pending',o.id+':'+reason);
  notify(o.supplier_id,'order_cancelled','إلغاء صنف معلّق','أُلغي الصنف #'+o.id+' قبل قبول المورد. السبب: '+reason,'orders');
  notifyOwnerAndAccountants('order_cancelled','إلغاء صنف قبل القبول','الصنف #'+o.id+' من الطلبية '+o.batch_id.slice(0,8),'orders');
  return{success:true,id,immediate:true,order_id:o.id};
 }
 if(type==='cancel'&&!['ready','shipping'].includes(o.status))bad('لا يمكن إلغاء الصنف في حالته الحالية');
 if(type==='stop'&&!['pending','ready','shipping'].includes(o.status))bad('لا يمكن إيقاف الصنف في حالته الحالية');
 if(type==='return'&&o.status!=='delivered')bad('لا يمكن طلب الإرجاع إلا بعد تسليم الصنف');
 const open=db.prepare("SELECT id FROM order_change_requests WHERE order_id=? AND status='pending'").get(o.id);
 if(open)bad('يوجد طلب تغيير مفتوح لهذا الصنف');
 let penalty=0,penaltyStatus='not_applicable',responsible='',beneficiary='';
 if(type==='return'){
  const rule=PENALTY_RULES[reason];responsible=rule.responsible;beneficiary=rule.beneficiary;
  if(rule.penalty){penalty=Math.round((Number(o.total)+Number(o.estimated_app_fee_share||0))*(setting('return_penalty_multiplier')||1.5));penaltyStatus='pending_settlement';}
  else penaltyStatus='exempted';
 }
 const id=Number(db.prepare(`INSERT INTO order_change_requests
  (order_id,batch_id,supplier_id,shop_id,requested_by,request_type,reason,penalty_amount,penalty_status,penalty_responsible,penalty_beneficiary,status)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')`).run(o.id,o.batch_id,o.supplier_id,o.shop_id,u.id,type,reason,penalty,penaltyStatus,responsible,beneficiary).lastInsertRowid);
 notifyOwnerAndAccountants('order_change_request','طلب موافقة على '+({cancel:'إلغاء',stop:'إيقاف',return:'إرجاع'}[type]),
  'الصنف '+o.product_name+' — السبب: '+reason+' — طلب #'+id,'order-change-requests');
 log(u.id,'order_change_request',id+':'+type+':'+reason);
 return{success:true,id,immediate:false,penalty_amount:penalty,penalty_status:penaltyStatus,penalty_responsible:responsible,penalty_beneficiary:beneficiary};
}));
def('order-change-requests/list',['owner','accountant','service_provider','subscriber','shop'],(d,u)=>{
 const base=`SELECT r.*,o.total order_total,o.status order_status,o.product_name,o.qty,o.method,s.name shop_name,s.business_name shop_business,sup.name supplier_name,req.name requester_name FROM order_change_requests r JOIN orders o ON o.id=r.order_id JOIN users s ON s.id=r.shop_id JOIN users sup ON sup.id=r.supplier_id JOIN users req ON req.id=r.requested_by`;
 if(['owner','accountant'].includes(u.role))return db.prepare(base+' ORDER BY r.id DESC LIMIT 300').all();
 return db.prepare(base+' WHERE (r.requested_by=? OR r.shop_id=? OR r.supplier_id=?) ORDER BY r.id DESC LIMIT 200').all(u.id,u.id,u.id);
});
def('order-change-requests/review',['owner','accountant'],(d,u)=>tx(()=>{
 const r=db.prepare("SELECT * FROM order_change_requests WHERE id=? AND status='pending'").get(Number(d.id));
 if(!r)bad('طلب الموافقة غير موجود أو تمت مراجعته');
 const action=String(d.action||'');
 if(!['approve','reject'].includes(action))bad('اختر الموافقة أو الرفض');
 const o=db.prepare('SELECT * FROM orders WHERE id=?').get(r.order_id);
 if(!o)bad('الصنف الأصلي غير موجود');
 if(action==='approve'){
  if(r.request_type==='cancel'){
   if(!['ready','shipping'].includes(o.status))bad('حالة الصنف تغيرت؛ أعد المراجعة');
   restoreOnce(o);
   db.prepare("UPDATE orders SET status='cancelled',reserved_credit=0 WHERE id=?").run(o.id);
   if(o.job_id){
    const j=db.prepare('SELECT * FROM delivery_jobs WHERE id=?').get(o.job_id);
    if(j&&j.status==='assigned'){
     const ng=Math.max(0,Number(j.goods_total)-Number(o.total));
     const na=Math.max(0,Number(j.app_fee)-Number(o.estimated_app_fee_share||0));
     db.prepare('UPDATE delivery_jobs SET goods_total=?,app_fee=?,app_profit=? WHERE id=?').run(ng,na,na+Number(j.delivery_fee)-Number(j.driver_earning),j.id);
    }
   }
   maybeVoidShipmentFee(r.batch_id,r.supplier_id);
   rebalanceQuotedShipmentFee(r.batch_id,r.supplier_id);
  } else if(r.request_type==='stop'){
   if(!['pending','ready','shipping'].includes(o.status))bad('حالة الصنف تغيرت؛ أعد المراجعة');
   db.prepare("UPDATE orders SET status='stopped',reserved_credit=0 WHERE id=?").run(o.id);
   maybeVoidShipmentFee(r.batch_id,r.supplier_id);
   rebalanceQuotedShipmentFee(r.batch_id,r.supplier_id);
  } else if(r.request_type==='return'){
   if(o.status!=='delivered')bad('لا يمكن إرجاع صنف غير مسلّم');
   const inv=db.prepare('SELECT * FROM invoices WHERE batch_id=? AND supplier_id=?').get(r.batch_id,r.supplier_id);
   if(!inv)bad('فاتورة الصنف غير موجودة؛ لا يمكن تسجيل الإرجاع');
   let line=db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? AND order_id=? AND line_total>0 ORDER BY id LIMIT 1').get(inv.id,o.id);
   // توافق مع الفواتير القديمة التي لم تحفظ order_id داخل بند الفاتورة.
   if(!line)line=db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? AND sku=? AND line_total>0 ORDER BY id LIMIT 1').get(inv.id,o.sku);
   if(!line)bad('لم يتم العثور على بند الفاتورة المطابق للصنف');
   const amount=Number(line.line_total||0);
   const debtReduction=Math.min(Number(line.unpaid||0),amount);
   const refundDue=Math.max(0,amount-debtReduction);
   const oldUnpaid=Number(line.unpaid||0),oldSupplierUnpaid=Number(line.supplier_unpaid||0);
   const supplierReduction=oldUnpaid>0?Math.min(oldSupplierUnpaid,Math.round(oldSupplierUnpaid*debtReduction/oldUnpaid)):0;
   db.prepare(`INSERT INTO invoice_adjustments(invoice_id,order_id,adjustment_type,amount,debt_reduction,refund_due,quantity,reason,responsible,beneficiary,status,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(inv.id,o.id,'return_credit',amount,debtReduction,refundDue,o.qty,r.reason,r.penalty_responsible||'',r.penalty_beneficiary||'',refundDue>0?'refund_due':'approved',u.id);
   // تسوية محاسبية موثقة: لا تخصم الغرامة من الدين ولا تسجل المرتجع كدفعة نقدية.
   db.prepare('UPDATE invoice_lines SET line_total=MAX(0,line_total-?),unpaid=MAX(0,unpaid-?),supplier_unpaid=MAX(0,supplier_unpaid-?) WHERE id=?')
    .run(amount,debtReduction,supplierReduction,line.id);
   db.prepare(`UPDATE invoices SET total=MAX(0,total-?),paid=MAX(0,paid-?),
    goods_total=MAX(0,goods_total-?),app_fee=MAX(0,app_fee-?),
    app_profit=MAX(0,app_profit-?),
    status=CASE WHEN MAX(0,paid-?)>=MAX(0,total-?) THEN 'paid' WHEN MAX(0,paid-?)>0 THEN 'partial' ELSE 'unpaid' END
    WHERE id=?`).run(amount,refundDue,Number(o.total||0),Math.max(0,amount-Number(o.total||0)),Math.max(0,amount-Number(o.total||0)),refundDue,amount,refundDue,inv.id);
   restoreOnce(o);
   db.prepare("UPDATE orders SET status='returned',reserved_credit=0 WHERE id=?").run(o.id);
   log(u.id,'invoice_return_adjustment',inv.id+':order='+o.id+':amount='+amount+':debt='+debtReduction+':refund_due='+refundDue);
  }
  notify(r.shop_id,'order_change_approved','تمت الموافقة على '+({cancel:'إلغاء الصنف',stop:'إيقاف الصنف',return:'إرجاع الصنف'}[r.request_type]),'الصنف #'+r.order_id,'orders');
  notify(r.supplier_id,'order_change_approved','تمت الموافقة على طلب تغيير','الصنف #'+r.order_id,'orders');
 } else {
  notify(r.shop_id,'order_change_rejected','رُفض طلب تغيير الصنف','الصنف #'+r.order_id,'orders');
  notify(r.supplier_id,'order_change_rejected','رُفض طلب تغيير الصنف','الصنف #'+r.order_id,'orders');
 }
 db.prepare('UPDATE order_change_requests SET status=?,decision_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=?')
  .run(action==='approve'?'approved':'rejected',u.id,String(d.note||'').slice(0,500),r.id);
 log(u.id,'order_change_review',r.id+':'+action);
 return{success:true,penalty_amount:action==='approve'?r.penalty_amount:0,penalty_status:r.penalty_status,penalty_responsible:r.penalty_responsible,penalty_beneficiary:r.penalty_beneficiary};
}));
def('order-change-requests/collect-penalty',['owner','accountant'],(d,u)=>tx(()=>{
 const r=db.prepare("SELECT * FROM order_change_requests WHERE id=? AND status='approved' AND penalty_status IN ('pending_settlement','pending_collection') AND penalty_amount>0").get(Number(d.id));if(!r)bad('لا توجد مطالبة غرامة تنتظر التسوية');
 const o=db.prepare('SELECT driver_id FROM orders WHERE id=?').get(r.order_id);
 const sourceUserId=r.penalty_responsible==='shop'?r.shop_id:r.penalty_responsible==='supplier'?r.supplier_id:r.penalty_responsible==='driver'?(o?.driver_id||r.requested_by):u.id;
 const beneficiaryUserId=r.penalty_beneficiary==='supplier'?r.supplier_id:r.penalty_beneficiary==='shop'?r.shop_id:null;
 const supplierComponent=r.penalty_beneficiary==='supplier'?r.penalty_amount:0;
 const platformComponent=r.penalty_beneficiary==='platform'?r.penalty_amount:0;
 const beneficiaryComponent=['shop','other'].includes(r.penalty_beneficiary)?r.penalty_amount:0;
 const custody=addCustody({sourceUserId,currentHolderId:u.id,shopId:r.shop_id,supplierId:r.supplier_id,amount:r.penalty_amount,
  supplierComponent,driverComponent:0,platformComponent,beneficiaryComponent,beneficiaryUserId,beneficiaryRole:r.penalty_beneficiary||'',
  purpose:'تسوية مطالبة إرجاع — المستفيد: '+(r.penalty_beneficiary||'غير محدد')+' — طلب #'+r.order_id,
  method:String(d.method||'cash'),status:'held_by_owner',note:String(d.note||'تسوية مستقلة ضمن الخزينة؛ لا تخصم تلقائيًا من دين المحل').slice(0,500),createdBy:u.id,acceptedBy:u.id});
 db.prepare("UPDATE order_change_requests SET penalty_status='settled' WHERE id=?").run(r.id);
 notify(r.requested_by,'return_penalty_collected','تم تسجيل تسوية مطالبة الغرامة عبر الخزينة','طلب #'+r.order_id,'order-change-requests');
 log(u.id,'return_penalty_settlement',r.id+':custody='+custody);
 return{success:true,custody_id:custody};
}));

// الملفات العامة: صور المنتجات فقط؛ الإيصالات وجوازات السفر لا تُقدم إلا عبر مسارات تحقق الصلاحية.
const server=http.createServer((req,res)=>{
 const headers={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"};for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(FRONTEND));}
 if(req.method==='GET'&&/^\/uploads\/products\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(req.url)){
  const name=path.basename(req.url),file=path.join(UPLOADS,name);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg','Cache-Control':'public, max-age=86400'});return fs.createReadStream(file).pipe(res);
 }
 if(req.method!=='POST'||!req.url.startsWith('/api/')){res.writeHead(404);return res.end();}
 let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>1_200_000){res.writeHead(413);res.end(JSON.stringify({error:'حجم الطلب أكبر من المسموح'}));req.destroy();}else body+=chunk;});
 req.on('end',()=>{
  const send=(status,obj)=>{if(res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
  let d;try{d=body?JSON.parse(body):{};}catch{return send(400,{error:'صيغة الطلب غير صالحة'});}if(!d||typeof d!=='object')d={};
  const p=req.url.slice(5),route=routes.get(p);if(!route)return send(404,{error:'المسار غير موجود'});
  const cookie=/session=([a-f0-9]{64})/.exec(req.headers.cookie||''),token=cookie?cookie[1]:null;let u=null;
  if(token){const ss=db.prepare('SELECT user_id,expires_at FROM sessions WHERE token=?').get(token);if(ss&&ss.expires_at>Date.now())u=db.prepare('SELECT id,name,phone,role,credit_limit,must_change FROM users WHERE id=? AND active=1').get(ss.user_id);}
  if(route.roles!=='public'){
   if(!u)return send(401,{error:'غير مصرح'});if(u.must_change&&!['password/change','logout','me'].includes(p))return send(403,{error:'يجب تغيير كلمة المرور أولًا',must_change:true});if(Array.isArray(route.roles)&&!route.roles.includes(u.role)){const rd=db.prepare('SELECT permissions_json,active FROM role_definitions WHERE code=?').get(u.role);let perms=[];try{perms=rd&&rd.active?JSON.parse(rd.permissions_json||'[]'):[];}catch{}if(!perms.includes(p))return send(403,{error:'لا تملك صلاحية تنفيذ هذا الإجراء'});}
  }
  try{send(200,route.fn(d,u,{token,ip:req.socket.remoteAddress,setCookie:v=>res.setHeader('Set-Cookie',v)}));}catch(e){if(e instanceof AppError)send(400,{error:e.message});else{console.error(e);send(500,{error:'خطأ داخلي في الخادم'});}}
 });
});
function listenWithFallback(port){
 server.once('error',err=>{
  if(err.code==='EADDRINUSE'&&!process.env.PORT&&port<3010){console.warn(`المنفذ ${port} مشغول؛ تجربة المنفذ ${port+1}...`);listenWithFallback(port+1);return;}
  console.error('تعذر تشغيل الخادم:',err.code||err.message);
  console.error('أغلق البرنامج الذي يستخدم المنفذ أو حدد PORT مختلفًا ثم أعد التشغيل.');
  process.exitCode=1;
 });
 server.listen(port,HOST,()=>{
   console.log(`✅ وِصلة جملة V1.0.1 يعمل على المنفذ ${port}.`);
   console.log(`على هذا الكمبيوتر: http://127.0.0.1:${port}`);
   if(HOST==='0.0.0.0'||HOST==='::'){
    console.log('روابط محتملة للهواتف على الشبكة نفسها (اختر عنوان محول Wi-Fi):');
    const nets=os.networkInterfaces();
    for(const [name,items] of Object.entries(nets)){for(const item of (items||[])){if(item.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')) console.log(`  ${name}: http://${item.address}:${port}`);}}
   }
   if(process.platform==='win32')require('node:child_process').exec('start http://127.0.0.1:'+port);
  });
}
listenWithFallback(PORT);

// نسخة أولية بعد دقيقة، ثم نسخة كل ست ساعات. تُحفظ آخر 20 نسخة داخل backups/.
// نستخدم setTimeout/setInterval غير حاجبَين كي لا يمنعا إيقاف الخادم.
const initialBackupTimer=setTimeout(()=>{try{const b=createDatabaseBackup('auto');console.log('نسخة احتياطية تلقائية:',b.file);}catch(e){console.error('فشل النسخ الاحتياطي:',e.message);}},60_000);
initialBackupTimer.unref();
const periodicBackupTimer=setInterval(()=>{try{const b=createDatabaseBackup('auto');console.log('نسخة احتياطية تلقائية:',b.file);}catch(e){console.error('فشل النسخ الاحتياطي:',e.message);}},6*60*60*1000);
periodicBackupTimer.unref();

let isShuttingDown=false;
function shutdown(signal) {
 if(isShuttingDown)return; isShuttingDown=true;
 console.log(`إيقاف الخادم (${signal})...`);
 clearTimeout(initialBackupTimer);clearInterval(periodicBackupTimer);
 try{const b=createDatabaseBackup('shutdown');console.log('نسخة إيقاف:',b.file);}catch(e){console.error('تعذر إنشاء نسخة الإيقاف:',e.message);}
 try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch(e){console.error('تعذر إغلاق WAL:',e.message);}
 server.close(()=>{try{db.close();}catch{}process.exit(0);});
 setTimeout(()=>process.exit(0),5000).unref();
}
process.once('SIGINT',()=>shutdown('SIGINT'));
process.once('SIGTERM',()=>shutdown('SIGTERM'));
