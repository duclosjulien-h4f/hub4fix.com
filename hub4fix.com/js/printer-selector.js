/**
 * Hub4Fix — sélecteur d'imprimante PARTAGÉ (source unique). Arborescence ORGANIQUE :
 * cascade marque → gamme → modèle → buse → plateau, colonnes qui se ramifient de gauche
 * à droite reliées par des connecteurs SVG courbes animés, pastilles colorées par marque,
 * navigation au survol. Se replie en résumé une fois le choix complet.
 *
 * window.H4FPrinterSelector :
 *   TREE, BRAND_COLORS, colorOf(brand)
 *   mount(host, { initial, onChange })  -> monte un sélecteur repliable dans `host`
 *   read(host)                          -> { brand, range, model, nozzle, plate, bed } | null
 *
 * Consommé par l'espace printer (parc) ET produit.html. Injecte son propre CSS (classes
 * hps-*, couleurs en dur) : autonome, aucune dépendance aux variables d'une page hôte.
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
  var BRAND_COLORS = { 'Bambu Lab':'#5DBB63','Creality':'#0E5C3A','Prusa':'#FA6831','Anycubic':'#17A2B8','Elegoo':'#2E6DB4','Sovol':'#8E44AD','Artillery':'#E84393','FlashForge':'#E67E22','Qidi Tech':'#16A085','Raise3D':'#C0392B','Voron':'#2C3E50','Autre':'#95A5A6' };
  function colorOf(b){ return BRAND_COLORS[b] || '#95A5A6'; }
  var NOZZLES = ['0.4','0.6','0.8'];
  var PLATES = [
    { id:'pei-lisse', label:'PEI', sub:'lisse' }, { id:'pei-texture', label:'PEI', sub:'texturé' },
    { id:'pey', label:'PEY', sub:'haute temp' }, { id:'peo', label:'PEO', sub:'flexible' },
    { id:'pet', label:'PET', sub:'transparent' }, { id:'cold', label:'Cold plate', sub:'verre' }, { id:'fr4', label:'FR4', sub:'garolite' }
  ];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function findBrand(b){ for (var i=0;i<TREE.length;i++) if (TREE[i].brand===b) return TREE[i]; return null; }
  function findRange(bo,n){ if(!bo) return null; for (var i=0;i<bo.ranges.length;i++) if (bo.ranges[i].name===n) return bo.ranges[i]; return null; }
  function findModel(ro,l){ if(!ro) return null; for (var i=0;i<ro.models.length;i++) if (ro.models[i].label===l) return ro.models[i]; return null; }

  // Monte un sélecteur d'UNE machine dans `host`. État vit dans host._sel.
  function mount(host, opts){
    opts = opts || {};
    var initial = opts.initial || null;
    var onChange = opts.onChange || function(){};
    var s = { brand:null, range:null, model:null, bed:'', nozzle:null, plate:null, plateLabel:'', done:false };
    if (initial && initial.brand){
      s.brand=initial.brand; s.range=initial.range||null; s.model=initial.model||null; s.bed=initial.bed||'';
      s.nozzle=initial.nozzle||null; s.plate=initial.plate||null; s.plateLabel=initial.plateLabel||'';
      s.done = !!(initial.model && initial.nozzle);
    }
    host._sel = s;

    host.classList.add('hps');
    host.innerHTML = '<div class="hps-selected"><span class="hps-selected-text">Sélectionner votre imprimante…</span><span class="hps-selected-arrow">›</span></div><div class="hps-branches"></div>';
    var selEl = host.querySelector('.hps-selected');
    var branches = host.querySelector('.hps-branches');
    var textEl = host.querySelector('.hps-selected-text');

    function summaryText(){
      if (!s.brand || !s.model) return 'Sélectionner votre imprimante…';
      var t = s.brand + ' ' + s.model;
      if (s.nozzle) t += ' · ' + s.nozzle + ' mm';
      if (s.plateLabel) t += ' · ' + s.plateLabel;
      return t;
    }
    function refreshSelected(){
      textEl.textContent = summaryText();
      selEl.classList.toggle('chosen', !!(s.brand && s.model));
    }
    function open(){ selEl.classList.add('open'); branches.classList.add('open'); render(); }
    function close(){ selEl.classList.remove('open'); branches.classList.remove('open'); }
    selEl.addEventListener('click', function(){ branches.classList.contains('open') ? close() : open(); });

    // --- Connecteurs SVG courbes (organiques) + particule lumineuse le long du chemin actif ---
    var _seed = 1, _activePath = [], _raf = null;
    function rnd(){ _seed = (_seed*16807) % 2147483647; return (_seed/2147483647) - 0.5; }
    function wire(x1,y1,x2,y2,col,op,captureEl){
      var dx=x2-x1, cp=Math.min(Math.abs(dx)*.45,40), jy1=rnd()*10, jy2=rnd()*10, d=(Math.abs(rnd())*.4).toFixed(2);
      if (captureEl) _activePath.push({ x0:x1, y0:y1, cx0:x1+cp, cy0:y1+jy1, cx1:x2-cp, cy1:y2+jy2, x1:x2, y1:y2, el:captureEl });
      return '<path d="M'+x1+','+y1+' C'+(x1+cp)+','+(y1+jy1)+' '+(x2-cp)+','+(y2+jy2)+' '+x2+','+y2+'" stroke="'+col+'" opacity="'+(op||.5)+'" style="animation-delay:'+d+'s"/>';
    }
    function dot(x,y,r,col){ return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+col+'" style="animation-delay:'+(0.3+Math.abs(rnd())*.3).toFixed(2)+'s"/>'; }

    // Particule : suit les béziers du chemin actif (root→marque→gamme→modèle→buse) à vitesse
    // constante (table longueur d'arc), traverse chaque pastille en la faisant briller.
    function runParticle(){
      if (_raf){ cancelAnimationFrame(_raf); _raf = null; }
      var map = branches.querySelector('.hps-map'); if(!map) return;
      var old = map.querySelector('.hps-particle'); if(old) old.remove();
      if (_activePath.length < 1) return;
      var box = map.getBoundingClientRect();
      function cub(t,a,b,c,d){ var u=1-t; return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d; }
      var pts=[], SPW=60, SPT=20;
      for (var w=0; w<_activePath.length; w++){
        var seg=_activePath[w];
        for (var s=0; s<=SPW; s++){ var t=s/SPW; pts.push({ x:cub(t,seg.x0,seg.cx0,seg.cx1,seg.x1), y:cub(t,seg.y0,seg.cy0,seg.cy1,seg.y1) }); }
        if (seg.el){ var r=seg.el.getBoundingClientRect(), lx=r.left-box.left, rx=r.right-box.left, cy=r.top+r.height/2-box.top; for (var s2=0; s2<=SPT; s2++){ var t2=s2/SPT; pts.push({ x:lx+(rx-lx)*t2, y:cy }); } }
      }
      if (pts.length < 2) return;
      var pills=[];
      for (var w2=0; w2<_activePath.length; w2++){ var el=_activePath[w2].el; if(!el) continue; var pr=el.getBoundingClientRect(), plx=pr.left-box.left, prx=pr.right-box.left, hw=(prx-plx)/2; pills.push({ lx:plx-hw*.4, rx:prx+hw*.4, cx:plx+hw, el:el }); }
      var arc=[0]; for (var i=1;i<pts.length;i++){ var ddx=pts[i].x-pts[i-1].x, ddy=pts[i].y-pts[i-1].y; arc.push(arc[i-1]+Math.sqrt(ddx*ddx+ddy*ddy)); }
      var total=arc[arc.length-1];
      function at(d){ var target=d*total, lo=0, hi=arc.length-1; while(lo<hi-1){ var mid=(lo+hi)>>1; if(arc[mid]<target) lo=mid; else hi=mid; } var sl=arc[hi]-arc[lo], f=sl>0?(target-arc[lo])/sl:0; return { x:pts[lo].x+(pts[hi].x-pts[lo].x)*f, y:pts[lo].y+(pts[hi].y-pts[lo].y)*f }; }
      var dotEl=document.createElement('div'); dotEl.className='hps-particle'; map.appendChild(dotEl);
      var TRAVEL=_activePath.length*900, PAUSE=1200, start=null;
      function tick(ts){
        if (!document.body.contains(map)){ return; }
        if (!start) start=ts;
        var pos=(ts-start)%(TRAVEL+PAUSE);
        if (pos>TRAVEL){ dotEl.classList.remove('active'); for (var q=0;q<pills.length;q++){ pills[q].el.style.boxShadow=''; pills[q].el.style.filter=''; } _raf=requestAnimationFrame(tick); return; }
        dotEl.classList.add('active');
        var pt=at(pos/TRAVEL); dotEl.style.left=pt.x+'px'; dotEl.style.top=pt.y+'px';
        for (var q2=0;q2<pills.length;q2++){ var pl=pills[q2], inten=0; if(pt.x>=pl.lx&&pt.x<=pl.rx){ var half=(pl.rx-pl.lx)/2; inten=1-Math.abs(pt.x-pl.cx)/half; inten*=inten; } if(inten>0.01){ pl.el.style.boxShadow='0 0 '+(14*inten).toFixed(1)+'px '+(5*inten).toFixed(1)+'px rgba(184,150,62,'+(0.5*inten).toFixed(2)+')'; pl.el.style.filter='brightness('+(1+0.12*inten).toFixed(3)+')'; } else { pl.el.style.boxShadow=''; pl.el.style.filter=''; } }
        _raf=requestAnimationFrame(tick);
      }
      _raf=requestAnimationFrame(tick);
    }

    function col(id){ return branches.querySelector('#'+id); }
    function active(sel){ return branches.querySelector(sel+'.active'); }

    function drawWires(){
      var svg = branches.querySelector('.hps-svg'), map = branches.querySelector('.hps-map');
      if(!svg||!map) return;
      var box = map.getBoundingClientRect(); var p=''; _seed=1; _activePath=[];
      var root = branches.querySelector('.hps-root'); if(!root) return;
      var rr=root.getBoundingClientRect(), rx=rr.right-box.left, ry=rr.top+rr.height/2-box.top;
      var c = colorOf(s.brand);
      var hasB = !!active('.hps-brand');
      branches.querySelectorAll('.hps-brand').forEach(function(el){
        var r=el.getBoundingClientRect(), bx=r.left-box.left, by=r.top+r.height/2-box.top, isA=el.classList.contains('active');
        var bc = colorOf(el.getAttribute('data-b'));
        p += wire(rx,ry,bx,by,bc, hasB?(isA?.6:.08):.35, isA?el:null) + dot(bx,by,isA?3.5:2,bc);
      });
      var ab = active('.hps-brand');
      if(ab){
        var abr=ab.getBoundingClientRect(), abx=abr.right-box.left, aby=abr.top+abr.height/2-box.top;
        var hasR = !!active('.hps-range');
        branches.querySelectorAll('.hps-range').forEach(function(rEl){
          var r=rEl.getBoundingClientRect(), rx2=r.left-box.left, ry2=r.top+r.height/2-box.top, isA=rEl.classList.contains('active');
          p += wire(abx,aby,rx2,ry2,c, hasR?(isA?.55:.1):.4, isA?rEl:null) + dot(rx2,ry2,isA?3:2,c);
          if(isA){
            var arx=r.right-box.left, am=active('.hps-model');
            branches.querySelectorAll('.hps-model').forEach(function(mEl){
              var mr=mEl.getBoundingClientRect(), mA=mEl.classList.contains('active');
              p += wire(arx,ry2,mr.left-box.left,mr.top+mr.height/2-box.top,c, am?(mA?.5:.1):.35, mA?mEl:null) + dot(mr.left-box.left,mr.top+mr.height/2-box.top,mA?3:2,c);
              if(mA){
                var amx=mr.right-box.left, amy=mr.top+mr.height/2-box.top, an=active('.hps-nozzle');
                branches.querySelectorAll('.hps-nozzle').forEach(function(nEl){
                  var nr=nEl.getBoundingClientRect(), nA=nEl.classList.contains('active');
                  p += wire(amx,amy,nr.left-box.left,nr.top+nr.height/2-box.top,c, an?(nA?.45:.08):.3, nA?nEl:null) + dot(nr.left-box.left,nr.top+nr.height/2-box.top,nA?3:2,c);
                  if(nA){
                    var anx=nr.right-box.left, any=nr.top+nr.height/2-box.top;
                    branches.querySelectorAll('.hps-plate').forEach(function(pEl){
                      var pr=pEl.getBoundingClientRect();
                      p += wire(anx,any,pr.left-box.left,pr.top+pr.height/2-box.top,c,.25) + dot(pr.left-box.left,pr.top+pr.height/2-box.top,1.5,c);
                    });
                  }
                });
              }
            });
          }
        });
      }
      svg.innerHTML = p;
      runParticle();
    }

    // Aligne une colonne sur le centre de son parent actif (flux à hauteur d'œil).
    function alignCol(id, parentEl){
      var c2=col(id); if(!c2) return; c2.style.paddingTop='';
      if(!parentEl || !c2.firstElementChild) return;
      var pr=parentEl.getBoundingClientRect(), pc=pr.top+pr.height/2;
      var ch=c2.children, fr=ch[0].getBoundingClientRect(), lr=ch[ch.length-1].getBoundingClientRect();
      var cc=fr.top+(lr.bottom-fr.top)/2, diff=pc-cc;
      if(diff>0) c2.style.paddingTop=(parseFloat(getComputedStyle(c2).paddingTop)+diff)+'px';
    }
    function clearCols(ids){ ids.forEach(function(id){ var c2=col(id); if(c2){ c2.innerHTML=''; c2.style.paddingTop=''; c2.classList.remove('has-active','has-selection'); } }); }

    function render(){
      var h = '<div class="hps-map"><svg class="hps-svg"></svg><div class="hps-grid">';
      h += '<div class="hps-col"><div class="hps-root">🖨 Imprimantes</div></div>';
      h += '<div class="hps-col" id="hpsB">' + TREE.map(function(b){
        return '<div class="hps-brand hps-anim'+(s.brand===b.brand?' active':'')+'" data-b="'+esc(b.brand)+'" style="--c:'+colorOf(b.brand)+'">'+esc(b.brand)+'</div>';
      }).join('') + '</div>';
      h += '<div class="hps-col" id="hpsR"></div><div class="hps-col" id="hpsM"></div><div class="hps-col" id="hpsN"></div><div class="hps-col" id="hpsP"></div>';
      h += '</div></div>';
      branches.innerHTML = h;
      branches.querySelectorAll('.hps-brand').forEach(function(el){
        el.addEventListener('mouseenter', function(){ if(el.classList.contains('active')){ reopenBrands(); return; } selectBrand(el.getAttribute('data-b')); });
      });
      // ré-affiche les niveaux déjà choisis (pré-remplissage / ré-ouverture)
      if (s.brand){ renderRanges(); if (s.range){ renderModels(); if (s.model){ renderNozzles(); if (s.nozzle){ renderPlates(); } } } }
      requestAnimationFrame(drawWires);
    }

    function markCol(id, cls, activeSel){
      var c2=col(id); if(!c2) return; c2.classList.add('has-selection'); c2.classList.remove('has-active');
    }

    function selectBrand(brand){
      s.brand=brand; s.range=null; s.model=null; s.bed=''; s.nozzle=null; s.plate=null; s.plateLabel='';
      branches.querySelectorAll('.hps-brand').forEach(function(el){ el.classList.toggle('active', el.getAttribute('data-b')===brand); });
      col('hpsB').classList.add('has-selection');
      clearCols(['hpsM','hpsN','hpsP']);
      renderRanges();
      alignCol('hpsR', active('.hps-brand'));
      requestAnimationFrame(drawWires);
    }
    function reopenBrands(){
      s.brand=null; s.range=null; s.model=null; s.nozzle=null; s.plate=null;
      branches.querySelectorAll('.hps-brand').forEach(function(el){ el.classList.remove('active'); });
      col('hpsB').classList.remove('has-selection');
      clearCols(['hpsR','hpsM','hpsN','hpsP']);
      requestAnimationFrame(drawWires);
    }
    function renderRanges(){
      var bo=findBrand(s.brand); if(!bo) return; var c=colorOf(s.brand);
      col('hpsR').innerHTML = bo.ranges.map(function(r){
        return '<div class="hps-range hps-anim'+(s.range===r.name?' active':'')+'" data-r="'+esc(r.name)+'" style="--c:'+c+'">'+esc(r.name)+'</div>';
      }).join('');
      col('hpsB').classList.add('has-selection');
      col('hpsR').querySelectorAll('.hps-range').forEach(function(el){
        el.addEventListener('mouseenter', function(){ if(el.classList.contains('active')){ reopenRanges(); return; } selectRange(el.getAttribute('data-r')); });
      });
    }
    function selectRange(name){
      s.range=name; s.model=null; s.bed=''; s.nozzle=null; s.plate=null; s.plateLabel='';
      col('hpsR').querySelectorAll('.hps-range').forEach(function(el){ el.classList.toggle('active', el.getAttribute('data-r')===name); });
      col('hpsR').classList.add('has-selection');
      clearCols(['hpsN','hpsP']);
      renderModels();
      alignCol('hpsM', active('.hps-range'));
      requestAnimationFrame(drawWires);
    }
    function reopenRanges(){
      s.range=null; s.model=null; s.nozzle=null; s.plate=null;
      col('hpsR').querySelectorAll('.hps-range').forEach(function(el){ el.classList.remove('active'); });
      col('hpsR').classList.remove('has-selection'); col('hpsB').classList.add('has-selection');
      clearCols(['hpsM','hpsN','hpsP']);
      requestAnimationFrame(drawWires);
    }
    function renderModels(){
      var ro=findRange(findBrand(s.brand), s.range); if(!ro) return; var c=colorOf(s.brand);
      col('hpsM').innerHTML = ro.models.map(function(m){
        return '<div class="hps-model hps-anim'+(s.model===m.label?' active':'')+'" data-m="'+esc(m.label)+'" data-bed="'+esc(m.bed||'')+'" style="--c:'+c+'">'+esc(m.label)+(m.bed?' <span class="hps-bed">'+esc(m.bed)+'</span>':'')+'</div>';
      }).join('');
      col('hpsR').classList.add('has-selection');
      col('hpsM').querySelectorAll('.hps-model').forEach(function(el){
        el.addEventListener('mouseenter', function(){ if(el.classList.contains('active')){ reopenModels(); return; } selectModel(el.getAttribute('data-m'), el.getAttribute('data-bed')); });
      });
    }
    function selectModel(label, bed){
      s.model=label; s.bed=bed||''; s.nozzle=null; s.plate=null; s.plateLabel='';
      col('hpsM').querySelectorAll('.hps-model').forEach(function(el){ el.classList.toggle('active', el.getAttribute('data-m')===label); });
      col('hpsM').classList.add('has-selection');
      clearCols(['hpsP']);
      renderNozzles();
      alignCol('hpsN', active('.hps-model'));
      requestAnimationFrame(drawWires);
    }
    function reopenModels(){
      s.model=null; s.nozzle=null; s.plate=null;
      col('hpsM').querySelectorAll('.hps-model').forEach(function(el){ el.classList.remove('active'); });
      col('hpsM').classList.remove('has-selection'); col('hpsR').classList.add('has-selection');
      clearCols(['hpsN','hpsP']);
      requestAnimationFrame(drawWires);
    }
    function renderNozzles(){
      var c=colorOf(s.brand);
      col('hpsN').innerHTML = NOZZLES.map(function(n){
        return '<div class="hps-nozzle hps-anim'+(s.nozzle===n?' active':'')+'" data-n="'+n+'" style="--c:'+c+'">'+n+'<span class="hps-nz-sub">mm</span></div>';
      }).join('');
      col('hpsM').classList.add('has-selection');
      col('hpsN').querySelectorAll('.hps-nozzle').forEach(function(el){
        el.addEventListener('mouseenter', function(){ if(el.classList.contains('active')){ reopenNozzles(); return; } selectNozzle(el.getAttribute('data-n')); });
      });
    }
    function selectNozzle(n){
      s.nozzle=n; s.plate=null; s.plateLabel='';
      col('hpsN').querySelectorAll('.hps-nozzle').forEach(function(el){ el.classList.toggle('active', el.getAttribute('data-n')===n); });
      col('hpsN').classList.add('has-selection');
      renderPlates();
      alignCol('hpsP', active('.hps-nozzle'));
      refreshSelected(); onChange(read(host));   // machine exploitable dès la buse (plateau = option)
      requestAnimationFrame(drawWires);
    }
    function reopenNozzles(){
      s.nozzle=null; s.plate=null;
      col('hpsN').querySelectorAll('.hps-nozzle').forEach(function(el){ el.classList.remove('active'); });
      col('hpsN').classList.remove('has-selection'); col('hpsM').classList.add('has-selection');
      clearCols(['hpsP']);
      requestAnimationFrame(drawWires);
    }
    function renderPlates(){
      var c=colorOf(s.brand);
      col('hpsP').innerHTML = PLATES.map(function(pl){
        var lbl=pl.label+(pl.sub?' '+pl.sub:'');
        return '<div class="hps-plate hps-anim'+(s.plate===pl.id?' active':'')+'" data-p="'+pl.id+'" data-label="'+esc(lbl)+'" style="--c:'+c+'">'+esc(pl.label)+'<span class="hps-pl-sub">'+esc(pl.sub)+'</span></div>';
      }).join('');
      col('hpsP').querySelectorAll('.hps-plate').forEach(function(el){
        el.addEventListener('click', function(e){ e.stopPropagation(); selectPlate(el.getAttribute('data-p'), el.getAttribute('data-label')); });
      });
    }
    function selectPlate(id, label){
      s.plate=id; s.plateLabel=label; s.done=true;
      refreshSelected(); close(); onChange(read(host));
    }

    refreshSelected();
    if (opts.openNow) open();
  }

  function read(host){
    var s = host && host._sel;
    if (!s || !s.brand || !s.model) return null;
    return { brand:s.brand, range:s.range, model:s.model, bed:s.bed||'', nozzle:s.nozzle||'0.4', plate:s.plate||null, plateLabel:s.plateLabel||'' };
  }

  // ---- CSS autonome (injecté une fois) ----
  if (typeof document !== 'undefined' && !document.getElementById('h4f-hps-css')) {
    var G='#B8963E', CREAM='#EDE6DC', EARTH='#7A7268', CHAR='#3B3632', STONE='#A89F91', GP='rgba(184,150,62,.08)';
    var css = [
      '.hps{position:relative;display:block;width:100%}',
      '.hps-selected{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.5rem .7rem;background:#fff;border:1px solid '+CREAM+';border-radius:8px;cursor:pointer;font-size:.82rem;color:'+CHAR+';transition:border-color .2s,box-shadow .2s}',
      '.hps-selected:hover{border-color:'+G+'}',
      '.hps-selected.open{border-color:'+G+';box-shadow:0 0 0 3px '+GP+'}',
      '.hps-selected.chosen .hps-selected-text{color:#0E5C3A;font-weight:600}',
      '.hps-selected-arrow{color:'+STONE+';transition:transform .3s;font-weight:700}',
      '.hps-selected.open .hps-selected-arrow{transform:rotate(90deg)}',
      '.hps-branches{display:none;margin-top:.4rem;background:#fff;border:1px solid '+CREAM+';border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.08);overflow-x:auto}',
      '.hps-branches.open{display:block;animation:hpsFade .3s}',
      '.hps-map{position:relative;padding:.8rem 1rem}',
      '.hps-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible}',
      '.hps-svg path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-dasharray:600;stroke-dashoffset:600;animation:hpsGrow .8s cubic-bezier(.25,.46,.45,.94) forwards}',
      '.hps-svg circle{opacity:0;animation:hpsDot .4s .5s ease forwards}',
      '@keyframes hpsGrow{to{stroke-dashoffset:0}}@keyframes hpsDot{to{opacity:1}}',
      '.hps-particle{position:absolute;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle,#fff 0%,#B8963E 45%,transparent 100%);box-shadow:0 0 10px 4px #B8963E,0 0 22px 8px rgba(184,150,62,.45),0 0 36px 14px rgba(184,150,62,.15);pointer-events:none;z-index:0;opacity:0;transform:translate(-50%,-50%);transition:opacity .2s}',
      '.hps-particle.active{opacity:1}',
      '.hps-grid{display:grid;grid-template-columns:auto auto auto auto auto auto;gap:0 2rem;align-items:start;position:relative;z-index:1}',
      '.hps-col{display:flex;flex-direction:column;gap:.28rem;padding:.15rem 0}',
      '.hps-col:empty{display:none}',
      '.hps-root{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .6rem;font-size:.72rem;font-weight:600;color:'+G+';white-space:nowrap;align-self:start;margin-top:.15rem}',
      '.hps-brand,.hps-range,.hps-model,.hps-nozzle,.hps-plate{padding:.32rem .65rem;font-size:.72rem;font-weight:600;background:#fff;border:1.5px solid;border-color:color-mix(in srgb,var(--c) 40%,transparent);border-radius:16px;cursor:pointer;color:var(--c);white-space:nowrap;position:relative;max-height:40px;transition:all .25s,max-height .3s,padding .3s,margin .3s,border-width .3s}',
      '.hps-brand:hover,.hps-range:hover,.hps-model:hover,.hps-nozzle:hover,.hps-plate:hover{background:color-mix(in srgb,var(--c) 12%,#fff)}',
      '.hps-brand.active,.hps-range.active,.hps-model.active,.hps-nozzle.active,.hps-plate.active{background:var(--c);color:#fff;border-color:var(--c);box-shadow:0 2px 8px rgba(0,0,0,.12)}',
      '.hps-col.has-selection .hps-brand:not(.active),.hps-col.has-selection .hps-range:not(.active),.hps-col.has-selection .hps-model:not(.active),.hps-col.has-selection .hps-nozzle:not(.active){opacity:.35;transform:scale(.93)}',
      '.hps-model{display:flex;align-items:center;gap:.3rem}',
      '.hps-bed{font-size:.58rem;color:'+STONE+';font-weight:400}',
      '.hps-nozzle{text-align:center}.hps-nz-sub{font-size:.6rem;color:'+STONE+';display:block;line-height:1}.hps-nozzle.active .hps-nz-sub{color:rgba(255,255,255,.7)}',
      '.hps-plate{text-align:center}.hps-pl-sub{font-size:.55rem;color:'+STONE+';display:block;line-height:1}.hps-plate.active .hps-pl-sub{color:rgba(255,255,255,.7)}',
      '@keyframes hpsFade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '.hps-anim{animation:hpsIn .2s ease both}@keyframes hpsIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}',
      '@media(max-width:600px){.hps-svg{display:none}.hps-grid{display:flex;flex-wrap:wrap;gap:.4rem .5rem;align-items:center}.hps-col{flex-direction:row;flex-wrap:wrap;gap:.3rem;padding:0}.hps-col:not(:empty)::before{content:"›";color:'+STONE+';margin:0 .1rem}.hps-col:first-child::before{display:none}}'
    ].join('');
    var st=document.createElement('style'); st.id='h4f-hps-css'; st.textContent=css; document.head.appendChild(st);
  }

  w.H4FPrinterSelector = { TREE: TREE, BRAND_COLORS: BRAND_COLORS, colorOf: colorOf, mount: mount, read: read };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
