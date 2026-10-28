const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const {DatabaseSync}=require('node:sqlite');
const SRC=process.argv[2]||require('path').join(__dirname,'..'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const findings=[]; const note=(sev,area,msg,ev)=>findings.push({sev,area,msg,ev});
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aud-'));
 fs.mkdirSync(path.join(dir,'backend'),{recursive:true});
 fs.mkdirSync(path.join(dir,'frontend'),{recursive:true});
 fs.mkdirSync(path.join(dir,'uploads'),{recursive:true});
 fs.mkdirSync(path.join(dir,'private_uploads'),{recursive:true});
 fs.copyFileSync(path.join(SRC,'backend','server.js'),path.join(dir,'backend','server.js'));
 fs.copyFileSync(path.join(SRC,'frontend','index.html'),path.join(dir,'frontend','index.html'));
 const port=39200+Math.floor(Math.random()*500);
 const proc=cp.spawn(process.execPath,['--no-warnings','backend/server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await sleep(100);}
 const db=new DatabaseSync(path.join(dir,'wesla_v4_8.db'));
 async function req(p,data={},cookie=''){const r=await fetch(base+'/api/'+p,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}};const sc=r.headers.get('set-cookie');return {j,status:r.status,cookie:sc?sc.split(';')[0]:''};}
 const login=async(ph,pw)=>{const r=await req('login',{phone:ph,password:pw});if(!r.j.success)throw new Error('login '+ph+JSON.stringify(r.j));return r.cookie;};
 const ready=async(ph,pw)=>{const c=await login(ph,pw);const r=await req('password/change',{old:pw,new:'SecurePass123!'},c);if(!r.j.success)throw new Error('pw '+JSON.stringify(r.j));return c;};
 const pw0=(out.match(/كلمة المرور المؤقتة: (\S+)/)||[])[1]; if(!pw0)throw new Error('no owner pw: '+out+err);
 let owner=await login('0000',pw0); await req('password/change',{old:pw0,new:'OwnerNewPass123!'},owner);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ocAAAAASUVORK5CYII=';
 const add=async d=>{const r=await req('users/add',{passport_image:png,passport_consent:true,...d},owner);if(!r.j.success)throw new Error('add '+JSON.stringify(r.j));return r.j;};
 const loc=(a,b)=>`https://www.google.com/maps/@${a},${b},16z`;
 const supA=await add({name:'SupA',phone:'111111',role:'supplier',business_name:'SA',contact_name:'Contact Person',contact_phone:'+218911111111',location_url:loc(32.88,13.19)});
 const shopU=await add({name:'ShopA',phone:'222222',role:'shop',business_name:'ShA',contact_name:'Contact Person',contact_phone:'+218922222222',location_url:loc(32.89,13.20),credit_limit:500});
 const drvU=await add({name:'DrvA',phone:'333333',role:'driver',vehicle_type:'small',license_plate:'29-12345',vehicle_make:'Toyota',vehicle_model:'Hilux',cost_per_km:0.5});
 const accU=await add({name:'AccA',phone:'666666',role:'accountant',job_title:'Accountant',contact_name:'Contact Person',contact_phone:'+218966666666'});
 const supC=await ready('111111',supA.password),shopC=await ready('222222',shopU.password),drvC=await ready('333333',drvU.password),accC=await ready('666666',accU.password);
 const mk=async(n,sku,price,stock)=>{const r=await req('products/add',{name:n,sku,price,stock,credit_allowed:true},supC);if(!r.j.success)throw new Error('prod '+JSON.stringify(r.j));};
 await mk('Rice','RICE',20,200);await mk('Oil','OIL',30,200);await mk('Sugar','SUGAR',10,200);await mk('Flour','FLOUR',12,200);await mk('Tea','TEA',8,200);
 const prods=(await req('products/all',{},shopC)).j; const P=s=>prods.find(x=>x.sku===s.toLowerCase());
 const q=(sql,...a)=>db.prepare(sql).all(...a); const one=(sql,...a)=>db.prepare(sql).get(...a);
 const notifs=()=>Object.fromEntries(q("SELECT user_id,COUNT(*) n FROM notifications GROUP BY user_id").map(r=>[r.user_id,r.n]));
 const idName={1:'owner',[supA.id]:'supplier',[shopU.id]:'shop',[drvU.id]:'driver',[accU.id]:'accountant'};
 const diffN=(a,b)=>Object.keys(b).filter(k=>(b[k]||0)>(a[k]||0)).map(k=>idName[k]||k);
 const nlog={};
 // ---- flow helper
 async function flow(name,{items,mode='delivery',collection='cash',stop='complete'}){
  let n0=notifs();
  const c=await req('orders/create-batch',{items,delivery_mode:mode,vehicle_type:mode==='delivery'?'small':'supplier',collection_method:collection},shopC);
  if(!c.j.success){note('info','flow',name+': create failed '+JSON.stringify(c.j));return null;}
  let n1=notifs();nlog[name+' | create']=diffN(n0,n1);
  const batch=c.j.batch_id;const os_=(await req('orders/get',{},supC)).j.orders.filter(o=>o.batch_id===batch);
  const a=await req('orders/update',{order_id:os_[0].id,action:'accept',batch_id:batch,supplier_id:supA.id,vehicle_type:'small'},supC);
  if(!a.j.success){note('info','flow',name+': accept failed '+JSON.stringify(a.j));return null;}
  let n2=notifs();nlog[name+' | accept']=diffN(n1,n2);
  if(mode==='pickup'){const np0=notifs();const r=await req('orders/pickup-confirm',{batch_id:batch,supplier_id:supA.id},shopC);nlog[name+' | pickup-confirm']=diffN(np0,notifs());if(!r.j.success){note('info','flow',name+': pickup failed '+JSON.stringify(r.j));return null;}
   return {batch,inv:one('SELECT * FROM invoices WHERE batch_id=?',batch)};}
  const cl=await req('delivery/claim',{batch_id:batch,supplier_id:supA.id},drvC);if(!cl.j.success){note('info','flow',name+': claim failed '+JSON.stringify(cl.j));return null;}
  let n3=notifs();nlog[name+' | claim']=diffN(n2,n3);
  const sh=(await req('orders/get',{},shopC)).j.orders.find(o=>o.batch_id===batch&&o.job_otp);
  const job=(await req('delivery/list',{},drvC)).j.jobs.find(j=>j.batch_id===batch);
  const cm=await req('delivery/complete',{job_id:job.id,otp:sh.job_otp,cash_collected:true},drvC);
  if(!cm.j.success){note('info','flow',name+': complete failed '+JSON.stringify(cm.j));return null;}
  let n4=notifs();nlog[name+' | complete']=diffN(n3,n4);
  return {batch,job,inv:one('SELECT * FROM invoices WHERE batch_id=?',batch),complete:cm.j};
 }
 const inv={};
 inv.A=await flow('A cash-goods/delivery/cash-collection',{items:[{product_id:P('RICE').id,qty:2,method:'cash'}]});
 inv.B=await flow('B credit-goods/delivery/cash-collection',{items:[{product_id:P('OIL').id,qty:2,method:'credit'}]});
 inv.C=await flow('C cash-goods/delivery/TRANSFER',{items:[{product_id:P('SUGAR').id,qty:3,method:'cash'}],collection:'transfer'});
 inv.D=await flow('D credit-goods/delivery/TRANSFER',{items:[{product_id:P('FLOUR').id,qty:2,method:'credit'}],collection:'transfer'});
 inv.E=await flow('E credit+cash/pickup',{items:[{product_id:P('TEA').id,qty:2,method:'credit'},{product_id:P('RICE').id,qty:1,method:'cash'}],mode:'pickup'});
 // ---- invariants per invoice
 for(const [k,f] of Object.entries(inv)){ if(!f||!f.inv)continue; const i=one('SELECT * FROM invoices WHERE id=?',f.inv.id);
  const lines=q('SELECT * FROM invoice_lines WHERE invoice_id=?',i.id); const lineUnpaid=lines.reduce((s,l)=>s+l.unpaid,0); const lineTotal=lines.filter(l=>l.sku!=='__delivery__').reduce((s,l)=>s+l.line_total,0);
  const pays=one('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?',i.id).s;
  const refundCredits=one('SELECT COALESCE(SUM(refund_due),0) s FROM invoice_adjustments WHERE invoice_id=?',i.id).s;
  const remaining=i.total-i.paid;
  if(remaining!==lineUnpaid) note('high','finance',`سيناريو ${k}: المتبقي على الفاتورة (${remaining}) لا يساوي مجموع بنود الدين (${lineUnpaid}); الفرق ${remaining-lineUnpaid} مليم`,{invoice:i.id,total:i.total,paid:i.paid,delivery_fee:i.delivery_fee,lineUnpaid});
  if(i.paid!==pays-refundCredits) note('high','finance',`سيناريو ${k}: المدفوع الصافي على الفاتورة (${i.paid}) لا يساوي الدفعات ناقص أرصدة الإرجاع (${pays-refundCredits})`,{invoice:i.id,refundCredits});
  if(i.total!==lineTotal+i.delivery_fee) note('med','finance',`سيناريو ${k}: إجمالي الفاتورة (${i.total}) ≠ بنودها + التوصيل (${lineTotal+i.delivery_fee})`,{});
  for(const c of q('SELECT * FROM cash_custody WHERE invoice_id=?',i.id)){ if(c.amount!==c.supplier_component+c.driver_component+c.platform_component+(c.beneficiary_component||0)) note('high','finance',`عهدة #${c.id}: المبلغ ≠ مكوناته`,c); }
 }
 // ---- try to fully settle each invoice with remaining
 const settle={};
 for(const [k,f] of Object.entries(inv)){ if(!f||!f.inv)continue; const i=one('SELECT * FROM invoices WHERE id=?',f.inv.id); const rem=i.total-i.paid; if(rem<=0){settle[k]='already paid';continue;}
  const r=await req('invoices/pay',{invoice_id:i.id,amount:rem/1000,method:'cash'},accC); const after=one('SELECT * FROM invoices WHERE id=?',i.id);
  settle[k]=r.j.success?`ok → status=${after.status}, remaining=${after.total-after.paid}`:`FAILED: ${r.j.error}`;
  if(!r.j.success) note('high','finance',`سيناريو ${k}: تعذر سداد كامل المتبقي (${rem/1000} د.ل) — ${r.j.error}`,{invoice:i.id,remaining:rem});
  else if(after.status!=='paid') note('high','finance',`سيناريو ${k}: بعد السداد الكامل حالة الفاتورة ${after.status}`,{});
 }
 // ---- credit info after everything settled
 const me=(await req('me',{},shopC)).j; const credit=me.credit||me.credit_info||null;
 const debt=one('SELECT COALESCE(SUM(unpaid),0) n FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.shop_id=?',shopU.id).n;
 const resv=one("SELECT COALESCE(SUM(reserved_credit),0) n FROM orders WHERE shop_id=? AND status IN ('pending','ready','shipping')",shopU.id).n;
 if(debt!==0||resv!==0) note('high','credit',`بعد سداد كل الفواتير ما زال الدين ${debt} والمحجوز ${resv}`,{});
 // ---- debt payment request flow on a fresh credit order
 const fD=await flow('F credit/delivery/cash for debt-request',{items:[{product_id:P('RICE').id,qty:2,method:'credit'}]});
 if(fD&&fD.inv){ const i=one('SELECT * FROM invoices WHERE id=?',fD.inv.id); const nA=notifs();
  const pr=await req('debt-payments/create',{invoice_id:i.id,amount:(i.total-i.paid)/2000,method:'transfer',note:'t',receipt_image:png},shopC);
  const nB=notifs(); nlog['G debt-payment request created']=diffN(nA,nB);
  if(!pr.j.success)note('high','finance','طلب سداد دين فشل: '+JSON.stringify(pr.j));
  else{ const rv=await req('debt-payments/review',{id:pr.j.id,action:'approve'},accC); const nC=notifs(); nlog['G debt-payment approved']=diffN(nB,nC);
   if(!rv.j.success) note('high','finance','اعتماد سداد الدين فشل: '+JSON.stringify(rv.j));
   const i2=one('SELECT * FROM invoices WHERE id=?',i.id); const lu=one('SELECT COALESCE(SUM(unpaid),0) n FROM invoice_lines WHERE invoice_id=?',i.id).n;
   if(i2.total-i2.paid!==lu) note('high','finance',`بعد اعتماد سداد جزئي: المتبقي ${i2.total-i2.paid} ≠ بنود ${lu}`,{});
  } }
 // ---- stats consistency
 const st=(await req('stats',{},owner)).j;
 const sumProfit=one('SELECT COALESCE(SUM(app_profit),0) n FROM invoices').n;
 // ---- owner profit sanity: app_profit = app_fee + delivery - driver_earning
 for(const j of q("SELECT * FROM delivery_jobs WHERE status='delivered'")){ if(j.app_profit!==j.app_fee+j.delivery_fee-j.driver_earning) note('med','finance',`ربح المنصة في المهمة #${j.id} غير متسق`,j); }
 const negProfit=q("SELECT id,app_profit FROM delivery_jobs WHERE app_profit<0"); if(negProfit.length) note('high','finance',`مهام بربح منصة سالب: ${negProfit.map(x=>x.id)} (أجرة السائق أعلى من التوصيل + رسوم المنصة)`,negProfit);
 // reject scenario
 {let a0=notifs();const c=await req('orders/create-batch',{items:[{product_id:P('RICE').id,qty:1,method:'cash'}],delivery_mode:'pickup',vehicle_type:'supplier'},shopC);
  const o=(await req('orders/get',{},supC)).j.orders.find(x=>x.batch_id===c.j.batch_id);const a1=notifs();
  const r=await req('orders/update',{order_id:o.id,action:'reject',batch_id:c.j.batch_id,supplier_id:supA.id},supC);const a2=notifs();
  nlog['H supplier rejects order']=r.j.success?diffN(a1,a2):['reject failed '+JSON.stringify(r.j)];}
  // driver payout from treasury custody (transfer-mode earnings)
 {const el=(await req('payouts/eligible',{},accC)).j.rows.find(r=>r.role==='driver'); const dep=await req('cash-custody/treasury-deposit',{amount:50,method:'transfer',purpose:'t'},accC);
  const po=await req('payouts/create',{recipient_user_id:drvU.id,amount:1,method:'cash',custody_id:dep.j.id},accC);
  console.error('PAYOUT driver earned='+el.earned+' available='+el.available+' | payout from treasury custody => '+(po.j.success?'OK':'FAILED: '+po.j.error)); globalThis.__payoutOk=po.j.success;
  const cu=q("SELECT purpose,amount,driver_component,platform_component FROM cash_custody"); console.error('CUSTODY '+JSON.stringify(cu.map(c=>[c.purpose,c.amount,c.driver_component])));}
 // ---- notification coverage report
 const all=q('SELECT event_type,COUNT(*) n FROM notifications GROUP BY event_type');
 console.log(JSON.stringify({payoutOk:globalThis.__payoutOk,findings,settle,notif_by_step:nlog,notif_event_types:all,stats:{appProfit:st.appProfit,sumInvoiceProfit:sumProfit}},null,1));


 if(process.env.UICHECK){
  const {chromium}=require('playwright'); const br=await chromium.launch(); const res=[];
  const run=async(label,ph,pw,steps)=>{const ctx=await br.newContext({viewport:{width:1280,height:800},locale:'ar'});const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
   await pg.goto(base);await pg.fill('#phone',ph);await pg.fill('#password',pw);await pg.click('#login button');await pg.waitForTimeout(1200);
   const out={role:label,landing:await pg.evaluate(()=>document.querySelector('#content h2')?.textContent),firstTab:await pg.evaluate(()=>document.querySelector('nav button.on')?.textContent)};
   for(const t of steps){await pg.evaluate(k=>go(k),t);await pg.waitForTimeout(900);out[t]=await pg.evaluate(()=>document.querySelector('#content h2')?.textContent||document.querySelector('#content')?.textContent.slice(0,40));}
   out.pageErrors=errs; res.push(out); return {pg,ctx};};
  await run('shop','222222','SecurePass123!',['notifications','requests','market','orders']);
  await run('supplier','111111','SecurePass123!',['notifications','products','orders']);
  await run('driver','333333','SecurePass123!',['notifications','earnings','payouts']);
  await run('owner','0000','OwnerNewPass123!',['notifications','roles','requests','users']);
  // live notification: open shop page, create event by another user, wait for poll
  const {pg:spg,ctx:sctx}=await run('shop-live','222222','SecurePass123!',[]);
  const before=await spg.evaluate(()=>document.querySelector('#notifCount')?.textContent);
  const c=await req('orders/create-batch',{items:[{product_id:P('TEA').id,qty:1,method:'cash'}],delivery_mode:'pickup',vehicle_type:'supplier'},shopC);
  const o=(await req('orders/get',{},supC)).j.orders.find(x=>x.batch_id===c.j.batch_id);
  await req('orders/update',{order_id:o.id,action:'reject',batch_id:c.j.batch_id,supplier_id:supA.id},supC);
  await spg.waitForTimeout(14000);
  const after=await spg.evaluate(()=>({badge:document.querySelector('#notifCount')?.textContent,title:document.title,toast:document.querySelector('#toast')?.textContent}));
  res.push({live:{before,after}});
  console.error('UICHECK '+JSON.stringify(res,null,1)); await br.close();
 }
 proc.kill(); process.exit(0);
})().catch(e=>{console.error('AUDIT ERROR',e.stack||e);process.exit(1);});
