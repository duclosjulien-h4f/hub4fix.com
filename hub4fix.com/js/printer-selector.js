/**
 * Hub4Fix — sélecteur d'imprimante PARTAGÉ (source unique).
 *
 * Expose window.H4FPrinterSelector :
 *   - TREE          : l'arbre marque → gammes → modèles ({label, bed})
 *   - BRAND_COLORS  : couleur par marque (raccord identité)
 *   - colorOf(brand)
 *   - mount(host, initial)  : monte un sélecteur COMPACT dans `host` (cascade repliable)
 *   - read(host)            : lit la sélection { brand, range, model, nozzle, bed } ou null
 *
 * Consommé par : l'espace printer (parc — le worker bundle ce fichier et l'inline dans
 * la SPA + le sert à /js/printer-selector.js) ET produit.html (arbre + couleurs).
 * Le widget injecte son propre CSS (autonome, aucune dépendance aux variables du site).
 */
(function (w) {
  'use strict';

  var TREE = [
    { brand:'Creality', ranges:[
      { name:'Ender', models:[{label:'Ender 3 V3',bed:'235×235'},{label:'Ender 3 V3 SE',bed:'235×235'},{label:'Ender 3 V3 KE',bed:'235×235'},{label:'Ender 5 S1',bed:'220×220'}] },
      { name:'K1', models:[{label:'K1',bed:'220×220'},{label:'K1C',bed:'220×220'},{label:'K1 Max',bed:'300×300'},{label:'K1 SE',bed:'220×220'}] },
      { name:'K2', models:[{label:'K2',bed:'350×350'},{label:'K2 Pro',bed:'350×350'},{label:'K2 Plus',bed:'350×350'}] },
      { name:'CR', models:[{label:'CR-10 SE',bed:'300×300'},{label:'CR-10 Smart Pro',bed:'300×300'}] } ] },
    { brand:'Bambu Lab', ranges:[
      { name:'A', models:[{label:'A1 mini',bed:'180×180'},{label:'A1 mini Combo',bed:'180×180'},{label:'A1',bed:'256×256'},{label:'A1 Combo',bed:'256×256'},{label:'A2',bed:'256×256'},{label:'A2 Combo',bed:'256×256'}] },
      { name:'X', models:[{label:'X1 Carbon',bed:'256×256'},{label:'X1 Carbon Combo',bed:'256×256'},{label:'X1E',bed:'256×256'}] },
      { name:'P', models:[{label:'P1S',bed:'256×256'},{label:'P1S Combo',bed:'256×256'},{label:'P1P',bed:'256×256'}] },
      { name:'H', models:[{label:'H2D',bed:'256×256'},{label:'H2S',bed:'256×256'}] } ] },
    { brand:'Prusa', ranges:[
      { name:'MK', models:[{label:'MK4S',bed:'250×210'},{label:'MK3S+',bed:'250×210'}] },
      { name:'MINI', models:[{label:'MINI+',bed:'180×180'}] },
      { name:'XL', models:[{label:'XL (5 têtes)',bed:'360×360'}] },
      { name:'Core', models:[{label:'Core One',bed:'250×210'},{label:'Core One L',bed:'300×250'},{label:'Core One XL',bed:'360×360'}] } ] },
    { brand:'Anycubic', ranges:[ { name:'Kobra', models:[{label:'Kobra 2 Neo',bed:'220×220'},{label:'Kobra 3',bed:'250×250'},{label:'Kobra 3 Combo',bed:'250×250'}] } ] },
    { brand:'Elegoo', ranges:[ { name:'Neptune', models:[{label:'Neptune 4',bed:'235×235'},{label:'Neptune 4 Pro',bed:'235×235'},{label:'Neptune 4 Plus',bed:'320×320'},{label:'Neptune 4 Max',bed:'420×420'}] } ] },
    { brand:'Sovol', ranges:[ { name:'SV', models:[{label:'SV06',bed:'220×220'},{label:'SV06 Plus',bed:'300×300'},{label:'SV07',bed:'220×220'},{label:'SV08',bed:'350×350'}] } ] },
    { brand:'Artillery', ranges:[ { name:'Sidewinder', models:[{label:'Sidewinder X4 Plus',bed:'300×300'}] }, { name:'Genius', models:[{label:'Genius Pro',bed:'220×220'}] } ] },
    { brand:'FlashForge', ranges:[ { name:'Adventurer', models:[{label:'Adventurer 5M',bed:'220×220'},{label:'Adventurer 5M Pro',bed:'220×220'}] } ] },
    { brand:'Qidi Tech', ranges:[ { name:'X-Max', models:[{label:'X-Max 3',bed:'325×325'},{label:'X-Plus 3',bed:'280×280'}] }, { name:'Q1', models:[{label:'Q1 Pro',bed:'245×245'}] } ] },
    { brand:'Raise3D', ranges:[ { name:'Pro', models:[{label:'Pro3',bed:'300×300'},{label:'Pro3 Plus',bed:'300×300'}] } ] },
    { brand:'Voron', ranges:[ { name:'2.4', models:[{label:'2.4 R2 (350)',bed:'350×350'},{label:'2.4 R2 (300)',bed:'300×300'}] }, { name:'Trident', models:[{label:'Trident (300)',bed:'300×300'}] } ] },
    { brand:'Autre', ranges:[ { name:'—', models:[{label:'Autre imprimante',bed:''}] } ] }
  ];

  // Couleurs raccord marque (ajustables ici — une seule source).
  var BRAND_COLORS = { 'Bambu Lab':'#5DBB63','Creality':'#0E5C3A','Prusa':'#FA6831','Anycubic':'#17A2B8','Elegoo':'#2E6DB4','Sovol':'#8E44AD','Artillery':'#E84393','FlashForge':'#E67E22','Qidi Tech':'#16A085','Raise3D':'#C0392B','Voron':'#2C3E50','Autre':'#95A5A6' };
  function colorOf(b){ return BRAND_COLORS[b] || '#95A5A6'; }
  var NOZZLES = ['0.4','0.6','0.8'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function findBrand(b){ for (var i=0;i<TREE.length;i++) if (TREE[i].brand===b) return TREE[i]; return null; }

  // Monte un sélecteur d'UNE machine dans host. Cascade horizontale ; une fois la buse
  // choisie, se replie en résumé (ligne droite, pastille couleur marque). Survol/clic de
  // la pastille marque = ré-ouverture NON destructive (garde la sélection). État = host._sel.
  function mount(host, initial){
    var s = { brand:null, range:null, model:null, nozzle:null, bed:'', done:false };
    if (initial && initial.brand){ s.brand=initial.brand; s.range=initial.range||null; s.model=initial.model||null; s.nozzle=initial.nozzle||'0.4'; s.bed=initial.bed||''; s.done=!!initial.model; }
    host._sel = s;
    function chip(label, color, active, attr){ return '<span class="ps-chip ps-anim'+(active?' active':'')+'" '+(attr||'')+' style="--c:'+color+'">'+esc(label)+'</span>'; }
    function render(){
      var c = colorOf(s.brand);
      if (s.done){
        host.innerHTML = '<div class="ps ps-summary">' + chip(s.brand, c, true, 'data-reopen="1"') +
          '<span class="ps-sep">›</span><span class="ps-val">'+esc(s.model)+'</span>' +
          (s.bed ? '<span class="ps-sep">·</span><span class="ps-dim">'+esc(s.bed)+'</span>' : '') +
          '<span class="ps-sep">·</span><span class="ps-val">'+esc(s.nozzle)+' mm</span></div>';
        var re = host.querySelector('[data-reopen]');
        function reopen(){ if (s.done){ s.done=false; render(); } }
        re.addEventListener('mouseenter', reopen); re.addEventListener('click', reopen);
        return;
      }
      var h = '<div class="ps"><span class="ps-col">' + TREE.map(function(b){ return chip(b.brand, colorOf(b.brand), s.brand===b.brand, 'data-b="'+esc(b.brand)+'"'); }).join('') + '</span>';
      var bo = findBrand(s.brand);
      if (bo){
        h += '<span class="ps-arrow">›</span><span class="ps-col">' + bo.ranges.map(function(r){ return chip(r.name, c, s.range===r.name, 'data-r="'+esc(r.name)+'"'); }).join('') + '</span>';
        var ro = null; for (var i=0;i<bo.ranges.length;i++) if (bo.ranges[i].name===s.range) ro=bo.ranges[i];
        if (ro){
          h += '<span class="ps-arrow">›</span><span class="ps-col">' + ro.models.map(function(m){ return chip(m.label, c, s.model===m.label, 'data-m="'+esc(m.label)+'" data-bed="'+esc(m.bed||'')+'"'); }).join('') + '</span>';
          if (s.model) h += '<span class="ps-arrow">›</span><span class="ps-col">' + NOZZLES.map(function(n){ return chip(n+' mm', c, s.nozzle===n, 'data-n="'+n+'"'); }).join('') + '</span>';
        }
      }
      host.innerHTML = h + '</div>';
      [].forEach.call(host.querySelectorAll('[data-b]'), function(el){ el.addEventListener('click', function(){ s.brand=el.getAttribute('data-b'); s.range=null; s.model=null; s.nozzle=null; render(); }); });
      [].forEach.call(host.querySelectorAll('[data-r]'), function(el){ el.addEventListener('click', function(){ s.range=el.getAttribute('data-r'); s.model=null; s.nozzle=null; render(); }); });
      [].forEach.call(host.querySelectorAll('[data-m]'), function(el){ el.addEventListener('click', function(){ s.model=el.getAttribute('data-m'); s.bed=el.getAttribute('data-bed'); s.nozzle=s.nozzle||'0.4'; render(); }); });
      [].forEach.call(host.querySelectorAll('[data-n]'), function(el){ el.addEventListener('click', function(){ s.nozzle=el.getAttribute('data-n'); s.done=true; render(); }); });
    }
    render();
  }
  function read(host){ var s = host && host._sel; return (s && s.brand && s.model) ? { brand:s.brand, range:s.range, model:s.model, nozzle:s.nozzle||'0.4', bed:s.bed||'' } : null; }

  // CSS autonome (injecté une fois). Couleurs neutres en dur -> marche sur n'importe quelle page.
  if (typeof document !== 'undefined' && !document.getElementById('h4f-ps-css')) {
    var st = document.createElement('style'); st.id = 'h4f-ps-css';
    st.textContent = [
      '.ps{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;width:100%}',
      '.ps-chip{display:inline-flex;align-items:center;padding:.28rem .6rem;border-radius:16px;font-size:.74rem;font-weight:600;cursor:pointer;border:1.5px solid;border-color:color-mix(in srgb,var(--c) 38%,transparent);color:var(--c);background:#fff;white-space:nowrap;transition:background .18s,color .18s,border-color .18s}',
      '.ps-chip:hover{background:color-mix(in srgb,var(--c) 12%,#fff)}',
      '.ps-chip.active{background:var(--c);color:#fff;border-color:var(--c)}',
      '.ps-anim{animation:psin .24s ease both}',
      '@keyframes psin{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}',
      '.ps-arrow,.ps-sep{color:#8a8172;font-weight:700;font-size:.8rem}',
      '.ps-val{font-size:.78rem;font-weight:600;color:#1E1B18}',
      '.ps-dim{font-size:.74rem;color:#8a8172}',
      '.ps-col{display:inline-flex;flex-wrap:wrap;gap:.22rem}'
    ].join('');
    document.head.appendChild(st);
  }

  w.H4FPrinterSelector = { TREE: TREE, BRAND_COLORS: BRAND_COLORS, colorOf: colorOf, mount: mount, read: read };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
