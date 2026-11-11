/* =====================================================================
   Spoločné jadro pre návrhy rozhraní (ui-1 … ui-5).
   Používa TO ISTÉ úložisko a formát faktúr ako index.html, takže všetky
   verzie vidia rovnaké faktúry, pečiatku aj nastavenia.
   Potrebuje: lib/qrcode.min.js, lib/html2canvas.min.js, lib/jspdf.umd.min.js
   ===================================================================== */
(function(){
'use strict';
const J = window.J = {};

/* ---------- pomocné ---------- */
J.qs  = (s,d=document)=>d.querySelector(s);
J.qsa = (s,d=document)=>Array.from(d.querySelectorAll(s));
J.esc = (s)=> String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
J.money = (n)=> (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
J.iso = (d)=> d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
J.parseIso = (s)=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m? new Date(+m[1],+m[2]-1,+m[3]) : null; };
J.fmtDate = (s)=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m? (+m[3])+'. '+(+m[2])+'. '+m[1] : (s||''); };
J.norm = (v)=> String(v??'').trim();
J.MONTHS = ['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];
J.MONTHS_CAP = J.MONTHS.map(m=>m[0].toUpperCase()+m.slice(1));
J.getPath = (o,p)=> p.split('.').reduce((a,k)=> a==null? a : a[k], o);
J.setPath = (o,p,v)=>{ const k=p.split('.'); const last=k.pop(); const t=k.reduce((a,x)=> (a[x]=a[x]||{}), o); t[last]=v; };

/* ---------- úložisko (rovnaké kľúče ako index.html) ---------- */
const KEY='invoices_v1', TRASH='simple_trash_v1', SNAP='simple_snapshots_v1', STAMP='simple_stamp_v1', THEME='simple_theme_v1', CALC='simple_calc_v1';
const get=(k)=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set=(k,v)=>{ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } };
const readJSON=(k,def)=>{ try{ const v=JSON.parse(get(k)||'null'); return v??def; }catch(e){ return def; } };
J.get=get; J.set=set; J.readJSON=readJSON;

J.load = ()=>{ const a=readJSON(KEY,[]); return Array.isArray(a)? a : []; };
function snapshot(){
  const cur=get(KEY); if(!cur || cur==='[]') return;
  const s=readJSON(SNAP,[]); if(s[0] && s[0].data===cur) return;
  s.unshift({ts:Date.now(), data:cur});
  let k=5; while(k>0 && !set(SNAP, JSON.stringify(s.slice(0,k)))) k--;
}
J.saveAll = (list)=>{ snapshot(); const ok=set(KEY, JSON.stringify(list)); if(!ok) alert('⚠️ Faktúru sa nepodarilo uložiť – pamäť prehliadača je plná. Stiahni si zálohu v hlavnej aplikácii.'); return ok; };
function toTrash(row){ const t=readJSON(TRASH,[]); t.unshift({...row, deleted_at:Date.now()}); set(TRASH, JSON.stringify(t.slice(0,50))); }
const when=(r)=> Date.parse(r.issue||'') || r.id || 0;
J.sorted = ()=> J.load().sort((a,b)=> (when(b)-when(a)) || (b.id-a.id));
J.latest = ()=> J.sorted()[0] || null;
J.remove = (id)=>{ const list=J.load(); const r=list.find(x=>x.id===id); if(!r) return false; toTrash(r); return J.saveAll(list.filter(x=>x.id!==id)); };

/* ---------- model faktúry ---------- */
J.blank = ()=>({ prefix:'faktura', number:'', issue:'', delivery:'', due:'', currency:'EUR', vat_rate:0, vs:'', site:'',
  period_from:'', period_to:'', supplier:{party:'',ico:'',dic:'',icdph:''}, buyer:{party:'',ico:'',dic:'',icdph:''},
  outro:'', addendum:'', show_qr:true, pay:{name:'',iban:'',bic:'',amount:0,use_total:true,msg:''},
  items:[{name:'',desc:'',qty:1,price:0}], sums:{sub:0,vat:0,total:0} });
// rovnaké pravidlá ako hlavná aplikácia: EUR, DPH 0 %, množstvo 1, suma platby = suma faktúry
J.normalize = (r)=>{
  const b=J.blank(), o={...b, ...JSON.parse(JSON.stringify(r||{}))};
  o.supplier={...b.supplier, ...(o.supplier||{})}; o.buyer={...b.buyer, ...(o.buyer||{})};
  o.pay={...b.pay, ...(o.pay||{}), use_total:true};
  o.prefix=o.prefix||'faktura'; o.currency='EUR'; o.vat_rate=0; o.show_qr = o.show_qr!==false;
  o.items=(Array.isArray(o.items)&&o.items.length? o.items : b.items).map(it=>{
    const q=Number(it.qty);
    const price=(it.qty===''||it.qty==null||q===1)? (Number(it.price)||0) : Math.round(q*(Number(it.price)||0)*100)/100;
    return {name:it.name||'', desc:it.desc||'', qty:1, price};
  });
  return o;
};
J.nextNumber = (n)=>{ n=J.norm(n); const m=/(\d+)(?!.*\d)/.exec(n); if(!m) return ''; const num=String(Number(m[1])+1).padStart(m[1].length,'0'); return n.slice(0,m.index)+num+n.slice(m.index+m[1].length); };
J.monthDates = (y,m)=>({ from:new Date(y,m,1), to:new Date(y,m+1,0), due:new Date(y,m+1,15) });   // splatnosť = posledný deň + 15 dní
J.setMonth = (inv,y,m)=>{ const d=J.monthDates(y,m); inv.period_from=J.iso(d.from); inv.period_to=J.iso(d.to); inv.issue=J.iso(d.to); inv.delivery=J.iso(d.to); inv.due=J.iso(d.due); };
J.monthOf = (inv)=>{ const d=J.parseIso(inv&&inv.period_from); return d? {y:d.getFullYear(), m:d.getMonth()} : null; };
J.monthLabel = (y,m)=> J.MONTHS_CAP[m]+' '+y;
J.workdays = (y,m)=>{ let n=0; const last=new Date(y,m+1,0).getDate(); for(let d=1;d<=last;d++){ const w=new Date(y,m,d).getDay(); if(w&&w!==6) n++; } return n; };
J.calcPrefs = ()=>{ const c=readJSON(CALC,{}); return {hpd:c.hpd??8, rate:c.rate??''}; };
J.saveCalcPrefs = (hpd,rate)=> set(CALC, JSON.stringify({hpd, rate}));

// návrh pre novú faktúru: ďalšie číslo a mesiac po minulej faktúre
J.suggest = (base)=>{
  const t=new Date(); let ref=new Date(t.getFullYear(), t.getMonth()-1, 1);
  const b=base && (J.parseIso(base.period_from)||J.parseIso(base.issue)); if(b) ref=new Date(b.getFullYear(), b.getMonth()+1, 1);
  return { number: base? J.nextNumber(base.number) : '', y:ref.getFullYear(), m:ref.getMonth() };
};
// nová faktúra = kópia poslednej (base ostáva na porovnanie)
J.startNew = ()=>{ const last=J.latest(); const base=last? J.normalize(last) : null; const inv=base? J.normalize(last) : J.blank(); delete inv.id; delete base?.id; J.recalc(inv, base); return {inv, base}; };

J.recalc = (inv, base)=>{
  inv.items.forEach(it=>{ it.qty=1; it.price=Math.round((Number(it.price)||0)*100)/100; });
  const sub=inv.items.reduce((s,it)=> s+(Number(it.price)||0), 0);
  inv.sums={sub, vat:0, total:sub}; inv.vat_rate=0; inv.currency='EUR';
  inv.vs = J.norm(inv.number).replace(/\D/g,'');                       // VS = číslo faktúry (len číslice)
  inv.pay.use_total=true; inv.pay.amount=sub;                          // suma platby = suma faktúry
  if(base && base.number && inv.number && base.pay && base.pay.msg){   // číslo faktúry aj v správe pre prijímateľa
    const o=J.norm(base.number), n=J.norm(inv.number), od=o.replace(/\D/g,''), nd=n.replace(/\D/g,'');
    if(base.pay.msg.includes(o)) inv.pay.msg=base.pay.msg.split(o).join(n);
    else if(od && base.pay.msg.includes(od)) inv.pay.msg=base.pay.msg.split(od).join(nd);
  }
  return inv;
};

// čo treba zmeniť oproti minulej faktúre
J.WATCH = [
  {key:'number', label:'Číslo faktúry'},
  {key:'month',  label:'Mesiac a dátumy'},
  {key:'site',   label:'Stavba'},
  {key:'price',  label:'Cena'},
];
J.status = (inv, base, confirmed=new Set())=>{
  const ne=(v)=> J.norm(v)!=='';
  const diff=(a,b)=> J.norm(a)!==J.norm(b);
  const r={};
  r.number = ne(inv.number) && (confirmed.has('number') || !base || diff(inv.number, base.number));
  r.month  = ne(inv.period_from) && (confirmed.has('month') || !base || diff(inv.period_from, base.period_from));
  r.site   = ne(inv.site) && (confirmed.has('site') || !base || diff(inv.site, base.site));
  r.price  = inv.items.some(it=>Number(it.price)>0) && (confirmed.has('price') || !base || inv.items.some((it,i)=> !base.items[i] || Number(it.price)!==Number(base.items[i].price)));
  return J.WATCH.map(w=>({...w, ok:r[w.key]}));
};

/* ---------- uloženie ---------- */
J.save = (inv, {force=false}={})=>{
  if(!J.norm(inv.number)){ alert('Chýba číslo faktúry.'); return false; }
  J.recalc(inv);
  let list=J.load();
  const same=list.find(r=> (r.prefix||'faktura')===inv.prefix && J.norm(r.number)===J.norm(inv.number) && r.id!==inv.id);
  if(same){
    if(!force && !confirm('Faktúra s číslom '+inv.number+' už je uložená.\nPrepísať ju touto novou?\n(Stará sa presunie do koša, dá sa obnoviť.)')) return false;
    toTrash(same); list=list.filter(r=>r!==same);
  }
  const row=JSON.parse(JSON.stringify(inv)); row.id=Date.now();
  list.push(row);
  if(!J.saveAll(list)) return false;
  try{ localStorage.removeItem('simple_draft_v1'); }catch(e){}       // rozpracovaná faktúra v hlavnej aplikácii je už neaktuálna
  inv.id=row.id;
  return true;
};

/* ---------- pečiatka ---------- */
J.stamp = ()=> get(STAMP);
function shrink(dataUrl, maxSide){
  return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>{ const k=Math.min(1, maxSide/Math.max(im.width,im.height)); const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.width*k)); c.height=Math.max(1,Math.round(im.height*k)); c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/png')); };
    im.onerror=rej; im.src=dataUrl; });
}
J.stampFromFile = (file)=> new Promise((res)=>{
  const r=new FileReader(); r.onload=async ()=>{
    let d; try{ d=await shrink(r.result,800); if(d.length>900000) d=await shrink(d,450); }catch(e){ alert('Tento obrázok sa nedá načítať. Skús iný (JPG alebo PNG).'); return res(null); }
    if(!set(STAMP,d)){ alert('⚠️ Pečiatku sa nepodarilo uložiť (pamäť je plná). Skús menší obrázok.'); return res(null); }
    res(d);
  }; r.readAsDataURL(file); });

/* ---------- QR (SPD 1.0, rovnaký ako hlavná aplikácia) ---------- */
J.qr = (inv)=>{
  const ascii=(t)=> (t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9 \-._+:,\/]/g,'');
  const acc=(inv.pay.iban||'').replace(/\s+/g,'').toUpperCase(); if(!acc) return '';
  const bic=(inv.pay.bic||'').trim().toUpperCase();
  const parts=['SPD*1.0','ACC:'+(bic? acc+'+'+bic : acc)];
  const am=Number(inv.sums.total||0); if(am>0) parts.push('AM:'+am.toFixed(2));
  parts.push('CC:EUR');
  if(inv.vs) parts.push('X-VS:'+inv.vs);
  const rn=ascii(inv.pay.name).slice(0,35); if(rn) parts.push('RN:'+rn);
  const msg=ascii('Faktura '+(inv.number||'')).slice(0,60); if(msg) parts.push('MSG:'+msg);
  try{ const q=qrcode(0,'M'); q.addData(parts.join('*')); q.make(); return q.createDataURL(6,2); }catch(e){ return ''; }
};

/* ---------- faktúra A4 (rovnaký vzhľad ako hlavná aplikácia) ---------- */
// opts.edit = true → hodnoty sú klikateľné (data-f), opts.state = {pole:'need'|'done'}
J.invoiceHTML = (inv, opts={})=>{
  const e=J.esc, ed=opts.edit, st=opts.state||{};
  const E=(f, html, empty='…')=> ed? `<span class="j-e ${st[f]||''}" data-f="${f}">${html||`<i class="j-empty">${empty}</i>`}</span>` : html;
  const ids=(p)=>{ const a=[p.ico,p.dic,p.icdph].filter(Boolean); return a.length? 'IČO/DIČ/IČ DPH: '+e(a.join(' / ')) : ''; };
  const s=inv.supplier, b=inv.buyer, t=inv.sums, cc='EUR';
  const iban=(inv.pay.iban||'').replace(/\s+/g,'');
  const msg=J.norm(inv.pay.msg) || (inv.vs? 'VS '+inv.vs : '');
  const pay=[]; if(J.norm(inv.pay.name)) pay.push('Prijímateľ / Empfänger: '+J.norm(inv.pay.name)); if(iban) pay.push('IBAN: '+iban);
  if(J.norm(inv.pay.bic)) pay.push('BIC: '+J.norm(inv.pay.bic)); if(t.total) pay.push('Suma / Betrag: '+Number(t.total).toFixed(2)+' '+cc); if(msg) pay.push('Správa / Verwendungszweck: '+msg);
  const qr=(inv.show_qr && iban)? J.qr(inv) : '';
  const stamp=J.stamp();
  const period=(inv.period_from||inv.period_to)? 'Obdobie / Zeitraum: '+J.fmtDate(inv.period_from)+' – '+J.fmtDate(inv.period_to) : '';
  return `<div class="j-inv">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
    <div style="font-size:22px;font-weight:800">Faktúra / Rechnung</div>
    <div style="text-align:right;min-width:220px;font-size:12px"><div style="display:flex;flex-direction:column;gap:4px">
      <div><div class="muted">Číslo / Nummer</div><div>${E('number', inv.number? e(inv.prefix+'-'+inv.number) : '')}</div></div>
      <div><div class="muted">VS / Referenz</div><div>${e(inv.vs)}</div></div>
      <div><div class="muted">Vystavená / Ausgestellt am</div><div>${E('month', e(J.fmtDate(inv.issue)))}</div></div>
      <div><div class="muted">Dodanie / Lieferdatum</div><div>${E('month', e(J.fmtDate(inv.delivery)))}</div></div>
      <div><div class="muted">Splatnosť / Fällig am</div><div>${E('month', e(J.fmtDate(inv.due)))}</div></div>
    </div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px;font-size:12px">
    <div>${E('supplier', `<div class="muted" style="font-weight:600;margin-bottom:4px">Dodávateľ / Lieferant</div><div style="white-space:pre-wrap">${e(s.party)}</div><div class="muted" style="margin-top:4px">${ids(s)}</div><div class="muted" style="margin-top:2px">Nie som platca DPH/Ich bin nicht MwSt. zahler</div>`)}</div>
    <div>${E('buyer', `<div class="muted" style="font-weight:600;margin-bottom:4px">Odberateľ / Kunde</div><div style="white-space:pre-wrap">${e(b.party)}</div><div class="muted" style="margin-top:4px">${ids(b)}</div>`)}</div>
  </div>
  <div class="muted" style="margin-top:8px;font-size:12px">${E('site', J.norm(inv.site)? 'Stavba / Baustelle: '+e(inv.site) : '', 'Stavba / Baustelle: …')}</div>
  <div class="muted" style="margin-top:4px;font-size:12px">${E('month', e(period), 'Obdobie / Zeitraum: …')}</div>
  <div style="margin-top:12px"><div class="sep"></div>
    <table class="items" style="font-size:12px">
      <colgroup><col style="width:4%"><col style="width:28%"><col style="width:38%"><col style="width:10%"><col style="width:10%"><col style="width:10%"></colgroup>
      <thead><tr><th style="width:30px">#</th><th>Názov / Bezeichnung</th><th>Popis / Beschreibung</th><th class="right" style="width:80px">Množstvo / Menge</th><th class="right" style="width:100px">Jedn. cena / Einzelpreis</th><th class="right" style="width:120px">Medzisúčet / Zwischensumme</th></tr></thead>
      <tbody style="font-size:12px">${inv.items.map((it,i)=>`<tr><td>${i+1}</td><td>${E('item', e(it.name))}</td><td>${E('item', e(it.desc), '')}</td><td class="right">1</td><td class="right">${E('price', J.money(it.price))}</td><td class="right">${J.money(it.price)}</td></tr>`).join('')}</tbody>
    </table>
  </div>
  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;margin-top:14px;align-items:flex-start">
    <div>${E('texts', `<div class="muted" style="white-space:pre-wrap;font-size:12px">${e(inv.outro)}</div><div class="muted" style="white-space:pre-wrap;margin-top:6px;font-size:12px">${e(inv.addendum)}</div>`)}</div>
    <div><table style="width:100%;font-size:13px"><tbody>
      <tr><td>Medzisúčet / Zwischensumme</td><td class="right">${J.money(t.sub)} ${cc}</td></tr>
      <tr><td>DPH / MwSt (0 %)</td><td class="right">${J.money(0)} ${cc}</td></tr>
      <tr><td style="font-weight:700">Spolu k úhrade / Gesamt</td><td class="right" style="font-weight:700">${J.money(t.total)} ${cc}</td></tr>
    </tbody></table></div>
  </div>
  <div class="sep"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px;align-items:end">
    <div>${E('pay', `<div class="muted" style="font-weight:600;margin-bottom:2px;font-size:12px">Platba / Zahlung</div><div style="white-space:pre-wrap;font-size:12px">${e(pay.join('\n'))}</div>${qr? `<div class="muted" style="margin-bottom:6px;font-size:10px">QR platba (SPD 1.0)</div><img src="${qr}" alt="QR" style="width:36mm;height:36mm;object-fit:contain;border:1px solid #e5e7eb;padding:4px;background:#fff">`:''}`)}</div>
    <div style="text-align:right"><div class="muted" style="margin-bottom:6px;font-size:12px">Pečiatka / Stempel</div>${E('stamp', stamp? `<img src="${stamp}" alt="" style="max-width:48mm;max-height:30mm;object-fit:contain;border:1px solid #e5e7eb;padding:4px;background:#fff">` : '', 'pridať pečiatku')}</div>
  </div>
</div>`;
};
// vloží faktúru do kontajnera a zmenší ju na jeho šírku
J.mount = (el, inv, opts)=>{ el.innerHTML=J.invoiceHTML(inv, opts); J.fit(el); };
J.fit = (el)=>{ const inv=el.querySelector('.j-inv'); if(!inv) return; inv.style.zoom=''; const w=el.clientWidth, full=inv.offsetWidth; if(w>0 && full>0 && w<full) inv.style.zoom=(w/full).toFixed(4); };

/* ---------- PDF a tlač ---------- */
J.fileName = (inv)=>{ const p=(inv.prefix||'faktura').trim(), n=J.norm(inv.number); return (p&&n)? p+'-'+n : (n||p||'faktura'); };
J.pdf = async (inv)=>{
  const ready=()=> window.html2canvas && window.jspdf && window.jspdf.jsPDF;
  if(!ready()){ return J.print(inv); }
  const host=document.createElement('div'); host.style.cssText='position:absolute;left:-10000px;top:0;width:820px;background:#fff';
  host.innerHTML=J.invoiceHTML(inv); document.body.appendChild(host);
  try{
    await Promise.all(J.qsa('img',host).map(i=> i.complete? 0 : new Promise(r=>{ i.onload=i.onerror=r; })));
    const node=host.querySelector('.j-inv');
    const canvas=await html2canvas(node,{scale:Math.min(3,Math.max(2,devicePixelRatio||2)), backgroundColor:'#fff', useCORS:true, allowTaint:true});
    const pdf=new window.jspdf.jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
    const pxW=canvas.width, pxH=canvas.height, pageH=Math.floor(pxW*(297/210)); let y=0, page=0;
    while(y<pxH){ const h=Math.min(pageH, pxH-y); const c=document.createElement('canvas'); c.width=pxW; c.height=h; c.getContext('2d').drawImage(canvas,0,-y);
      if(page>0) pdf.addPage('a4','portrait'); pdf.addImage(c.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,h*210/pxW); y+=h; page++; }
    pdf.save(J.fileName(inv)+'.pdf');
  } finally { host.remove(); }
};
J.print = (inv)=>{
  const host=document.createElement('div'); host.className='j-print'; host.innerHTML=J.invoiceHTML(inv); document.body.appendChild(host);
  const t=document.title; document.title=J.fileName(inv); document.documentElement.classList.add('j-printing');
  setTimeout(()=>{ window.print(); document.documentElement.classList.remove('j-printing'); document.title=t; host.remove(); }, 60);
};

/* ---------- tmavý / svetlý režim (spoločná voľba s hlavnou aplikáciou) ---------- */
J.isDark = ()=>{ const t=document.documentElement.getAttribute('data-theme'); return t? t==='dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
J.initTheme = (btn)=>{
  const label=()=>{ if(btn) btn.textContent = J.isDark()? '☀️' : '🌙'; if(btn) btn.title = J.isDark()? 'Svetlý režim' : 'Tmavý režim'; };
  if(btn) btn.onclick=()=>{ const next=J.isDark()? 'light':'dark'; document.documentElement.setAttribute('data-theme',next); set(THEME,next); label(); };
  try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label); }catch(e){}
  label();
};

/* ---------- vysúvacie okno (sheet) a formulár stálych údajov ---------- */
J.sheet = (title, body, onClose)=>{
  const bg=document.createElement('div'); bg.className='j-sheet-bg';
  bg.innerHTML=`<div class="j-sheet" role="dialog" aria-modal="true" aria-label="${J.esc(title)}"><div class="j-sheet-h"><b>${J.esc(title)}</b><button type="button" class="j-x" aria-label="Zavrieť">✕</button></div></div>`;
  const sh=bg.firstElementChild; sh.appendChild(body);
  const close=()=>{ bg.remove(); document.removeEventListener('keydown',esc); onClose&&onClose(); };
  const esc=(e)=>{ if(e.key==='Escape') close(); };
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); }); sh.querySelector('.j-x').onclick=close; document.addEventListener('keydown',esc);
  document.body.appendChild(bg); return close;
};
J.fixedForm = (inv, onChange)=>{
  const el=document.createElement('div'); el.className='j-form';
  const F=(p,label,ta)=>{ const v=J.getPath(inv,p)??''; return `<label>${label}</label>`+(ta? `<textarea data-p="${p}">${J.esc(v)}</textarea>` : `<input data-p="${p}" value="${J.esc(v)}">`); };
  el.innerHTML=`
    <h4>🏢 Dodávateľ (ja)</h4>${F('supplier.party','Meno a adresa',1)}<div class="row2"><div>${F('supplier.ico','IČO')}</div><div>${F('supplier.dic','DIČ')}</div></div>${F('supplier.icdph','IČ DPH')}
    <h4>🏗️ Odberateľ (firma)</h4>${F('buyer.party','Názov a adresa',1)}<div class="row2"><div>${F('buyer.ico','IČO')}</div><div>${F('buyer.dic','DIČ')}</div></div>${F('buyer.icdph','IČ DPH')}
    <h4>🏦 Platba</h4>${F('pay.name','Prijímateľ')}${F('pay.iban','IBAN')}${F('pay.bic','BIC')}${F('pay.msg','Správa pre prijímateľa')}
    <label class="j-chk"><input type="checkbox" data-p="show_qr" ${inv.show_qr!==false?'checked':''}> Zobraziť QR kód na platbu</label>
    <h4>✍️ Texty na faktúre</h4>${F('outro','Text po faktúre',1)}${F('addendum','Dodatok')}
    <h4>🔏 Pečiatka</h4><div class="j-stamp"><img alt="Pečiatka"><div class="j-stamp-t"></div><label class="j-btn">📷 Vybrať pečiatku<input type="file" accept="image/*" hidden></label></div>`;
  const upd=()=>{ const s=J.stamp(), img=el.querySelector('.j-stamp img'); img.style.display=s?'':'none'; if(s) img.src=s; el.querySelector('.j-stamp-t').textContent = s? '✓ uložená – pridá sa sama' : 'zatiaľ bez pečiatky'; };
  const h=(e)=>{ const p=e.target.dataset.p; if(!p) return; J.setPath(inv,p, e.target.type==='checkbox'? e.target.checked : e.target.value); onChange&&onChange(); };
  el.addEventListener('input',h); el.addEventListener('change',h);
  el.querySelector('input[type=file]').onchange=async(e)=>{ const f=e.target.files[0]; e.target.value=''; if(f && await J.stampFromFile(f)){ upd(); onChange&&onChange(); } };
  upd(); return el;
};

/* ---------- spoločné štýly (faktúra, okno, formulár, tlač) ---------- */
const css=`
.j-inv{width:210mm;min-height:297mm;padding:12mm;box-sizing:border-box;margin:0 auto;background:#fff;color:#111827;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial;font-size:16px;line-height:normal;text-align:left;color-scheme:light}
.j-inv .muted{color:#6b7280}.j-inv .right{text-align:right}
.j-inv tr{background:transparent!important}.j-inv td{border-bottom:0}
.j-inv table{width:100%;border-collapse:collapse}.j-inv th,.j-inv td{padding:8px;vertical-align:top}
.j-inv thead th{background:#f3f4f6;color:#374151;font-weight:600;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:left}
.j-inv thead th.right{text-align:right}
.j-inv tbody td{border-top:1px solid #e5e7eb}.j-inv .sep{border-top:1px dashed #e5e7eb;margin:10px 0}
.j-inv .items th+th,.j-inv .items td+td{border-left:1px dashed #e5e7eb}
.j-e{cursor:pointer;border-radius:4px;outline:2px dashed transparent;outline-offset:2px;transition:outline-color .2s,background .2s;display:inline-block;min-width:20px}
.j-e:hover{outline-color:#93c5fd;background:#eff6ff}
.j-e.need{outline:2px solid #f0a3a3;background:#fff4f4}.j-e.done{outline:2px solid #9fd5b2;background:#f3fbf6}
.j-empty{color:#c0c4cc;font-style:normal}
.j-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:flex-end;justify-content:center}
.j-sheet{background:var(--surface,#fff);color:var(--ink,#111827);width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:0 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);box-sizing:border-box}
@media(min-width:700px){.j-sheet-bg{align-items:center}.j-sheet{border-radius:20px}}
.j-sheet-h{display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;top:0;background:inherit;padding:14px 0 10px;z-index:1}
.j-sheet-h b{font-size:20px}.j-x{border:none;background:transparent;font-size:24px;cursor:pointer;color:inherit;padding:4px 8px}
.j-form label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px;color:var(--muted,#6b7280)}
.j-form input:not([type=checkbox]):not([type=file]),.j-form textarea{width:100%;box-sizing:border-box;font:inherit;font-size:17px;padding:11px 12px;border:1.5px solid var(--line,#d1d5db);border-radius:10px;background:var(--input,#fff);color:inherit}
.j-form textarea{min-height:64px;resize:vertical}.j-form h4{margin:20px 0 0;font-size:17px}
.j-form .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.j-form .j-chk{display:flex;gap:10px;align-items:center;color:inherit;font-weight:500;font-size:16px;margin-top:14px}
.j-form .j-chk input{width:20px;height:20px}
.j-stamp{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px}
.j-stamp img{width:110px;height:70px;object-fit:contain;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
.j-stamp-t{flex:1;min-width:120px;font-size:15px;color:var(--muted,#6b7280)}
.j-btn{display:inline-block;padding:10px 14px;border-radius:10px;border:1.5px solid var(--line,#d1d5db);cursor:pointer;font-weight:600;font-size:15px;color:inherit;background:transparent}
.j-print{display:none}
@media print{@page{size:A4;margin:0} html.j-printing body>*:not(.j-print){display:none!important} html.j-printing .j-print{display:block!important} html.j-printing body{margin:0;background:#fff!important} html.j-printing .j-inv{zoom:1!important}}
`;
const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
})();
