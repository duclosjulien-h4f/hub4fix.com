/**
 * Nav Mini-Mindmap — Hub4Fix
 * Replaces the classic account dropdown with a horizontal mindmap overlay.
 * Include this script on any page: <script src="js/nav-mindmap.js"></script>
 * Requires: .nav-account container with #accountBtn inside it.
 */
(function(){
  'use strict';

  /* ── Data ── */
  var NAV_TREE = [
    { id:'compte', label:'Mon compte', color:'#B8963E', icon:'user', children:[
      { id:'profil', label:'Profil' },
      { id:'commandes', label:'Commandes' },
      { id:'tokens', label:'Tokens' },
      { id:'bibliotheque', label:'Bibliotheque' },
      { id:'alertes', label:'Alertes' },
      { id:'parametres', label:'Parametres' }
    ]},
    { id:'partenaire', label:'Partenaire', color:'#6b5b95', icon:'handshake', children:[
      { id:'postuler-printer', label:'Devenir Printer' },
      { id:'postuler-modelisateur', label:'Devenir Modelisateur' }
    ]},
    { id:'espace-printer', label:'Printer', color:'#2c6e9b', icon:'printer', children:[
      { id:'missions', label:'Missions' },
      { id:'gains', label:'Gains' }
    ]},
    { id:'espace-modeler', label:'Modelisateur', color:'#a0522d', icon:'cube', children:[
      { id:'fichiers', label:'Fichiers' },
      { id:'hotlist', label:'Hot List' },
      { id:'royalties', label:'Royalties' }
    ]}
  ];

  var ICONS = {
    user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/></svg>',
    handshake:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-1.5 1.5a2.12 2.12 0 01-3-3L10 12"/><path d="M15.5 6.5L18 4a2.12 2.12 0 013 3l-3.5 3.5"/><path d="M6 6l4.5 4.5"/><path d="M13.5 13.5L18 18"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>',
    printer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="20" width="18" height="2" rx=".5"/><path d="M7 20v-5h10v5"/><path d="M12 4v6"/><path d="M9.5 10h5L12 15.5 9.5 10z"/></svg>',
    cube:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v4l9 5 9-5V7l-9-5z"/><path d="M12 22V12"/><path d="M3 7l9 5 9-5"/></svg>',
    logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
  };

  /* ── Inject CSS ── */
  var style = document.createElement('style');
  style.textContent = [
    '.nmm-overlay{position:absolute;top:calc(100% + 8px);right:0;background:white;border:1px solid #EDE6DC;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.12);display:none;z-index:200;padding:.8rem 1rem;min-width:180px}',
    '.nmm-overlay.visible{display:block;animation:nmmFade .2s ease}',
    '@keyframes nmmFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
    '.nmm-header{display:flex;align-items:center;gap:.6rem;padding:0 .2rem .6rem;border-bottom:1px solid #EDE6DC;margin-bottom:.6rem}',
    '.nmm-avatar{width:32px;height:32px;border-radius:50%;background:#B8963E;color:white;display:flex;align-items:center;justify-content:center;font-family:"Cormorant Garamond",serif;font-size:.85rem;font-weight:600;flex-shrink:0}',
    '.nmm-name{font-weight:600;font-size:.82rem;color:#1C1A18}',
    '.nmm-email{font-size:.65rem;color:#7A7268}',
    '.nmm-map{position:relative}',
    '.nmm-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible}',
    '.nmm-svg path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-dasharray:200;stroke-dashoffset:200;animation:nmmGrow .8s cubic-bezier(.25,.46,.45,.94) forwards}',
    '.nmm-svg circle{opacity:0;animation:nmmDot .4s .5s ease forwards}',
    '@keyframes nmmGrow{to{stroke-dashoffset:0}}',
    '@keyframes nmmDot{to{opacity:1}}',
    '.nmm-grid{display:grid;grid-template-columns:auto auto;gap:0 1.4rem;align-items:start;direction:rtl}',
    '.nmm-grid>*{direction:ltr}',
    '.nmm-col{display:flex;flex-direction:column;gap:.22rem;z-index:1;padding:.1rem 0}',
    '.nmm-col:empty{display:none}',
    /* Branch pills */
    '.nmm-branch{padding:.3rem .6rem;font-size:.68rem;font-weight:600;letter-spacing:.01em;background:white;border:1.5px solid #EDE6DC;border-radius:12px;cursor:pointer;transition:all .2s;white-space:nowrap;display:flex;align-items:center;gap:.3rem;color:#3B3632}',
    '.nmm-branch svg{width:12px;height:12px;flex-shrink:0;opacity:.5}',
    '.nmm-branch:hover{background:rgba(184,150,62,.08);color:#B8963E}',
    '.nmm-branch.active{color:white;box-shadow:0 2px 6px rgba(0,0,0,.1)}',
    '.nmm-branch.active svg{opacity:1}',
    '.nmm-col.has-sel .nmm-branch:not(.active){opacity:.35;transform:scale(.95)}',
    /* Leaf pills */
    '.nmm-leaf{padding:.28rem .55rem;font-size:.66rem;font-weight:500;background:white;border:1.5px solid #EDE6DC;border-radius:10px;cursor:pointer;transition:all .2s;white-space:nowrap;text-decoration:none;display:block}',
    '.nmm-leaf:hover{filter:brightness(.92)}',
    '.nmm-leaf .nmm-leaf-badge{font-family:"Courier New",monospace;font-weight:700;margin-left:.25rem;font-size:.62rem}',
    '@keyframes nmmSlide{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}',
    '.nmm-anim{animation:nmmSlide .45s cubic-bezier(.22,.61,.36,1) both}',
    /* Logout */
    '.nmm-logout{display:flex;align-items:center;gap:.4rem;padding:.5rem .2rem 0;margin-top:.5rem;border-top:1px solid #EDE6DC;font-size:.72rem;color:#7A7268;cursor:pointer;text-decoration:none;transition:color .2s}',
    '.nmm-logout:hover{color:#C8102E}',
    '.nmm-logout svg{width:14px;height:14px}'
  ].join('\n');
  document.head.appendChild(style);

  /* ── Build overlay ── */
  var navAccount = document.querySelector('.nav-account') || document.getElementById('navAccount');
  if(!navAccount) return;

  // Remove old menu if present
  var oldMenu = document.getElementById('accountMenu');
  if(oldMenu) oldMenu.remove();

  var overlay = document.createElement('div');
  overlay.className = 'nmm-overlay';
  overlay.id = 'nmmOverlay';
  overlay.innerHTML =
    '<div class="nmm-header">'+
      '<div class="nmm-avatar">JD</div>'+
      '<div><div class="nmm-name">Julien D.</div><div class="nmm-email">demo@hub4fix.com</div></div>'+
    '</div>'+
    '<div class="nmm-map" id="nmmMap">'+
      '<svg class="nmm-svg" id="nmmSvg"></svg>'+
      '<div class="nmm-grid" id="nmmGrid"></div>'+
    '</div>'+
    '<a href="demo-login.html" class="nmm-logout">'+ICONS.logout+' Deconnexion</a>';
  navAccount.appendChild(overlay);

  var nmmMap = document.getElementById('nmmMap');
  var nmmGrid = document.getElementById('nmmGrid');
  var nmmSvg = document.getElementById('nmmSvg');
  var currentBranch = null;

  /* ── SVG helpers ── */
  var _rSeed = 1;
  function rnd(){ _rSeed = (_rSeed * 16807) % 2147483647; return (_rSeed / 2147483647) - 0.5; }
  function svgC(x1,y1,x2,y2,col,op){
    var dx=x2-x1,cp=Math.min(Math.abs(dx)*.45,30);
    // Organic variation: slight random Y offset on control points
    var jy1 = rnd() * 8, jy2 = rnd() * 8;
    return '<path d="M'+x1+','+y1+' C'+(x1+cp)+','+(y1+jy1)+' '+(x2-cp)+','+(y2+jy2)+' '+x2+','+y2+'" stroke="'+col+'" opacity="'+(op||.35)+'" style="animation-delay:'+(Math.abs(rnd())*.3).toFixed(2)+'s"/>';
  }
  function svgD(x,y,r,col){ return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+col+'"/>'; }

  function alignCol(colId, parentEl){
    var col = document.getElementById(colId);
    if(!col) return;
    col.style.paddingTop = '';
    if(!parentEl || !col.firstElementChild) return;
    var pR = parentEl.getBoundingClientRect();
    var cR = col.firstElementChild.getBoundingClientRect();
    var diff = (pR.top + pR.height/2) - (cR.top + cR.height/2);
    if(diff > 3) col.style.paddingTop = (parseFloat(getComputedStyle(col).paddingTop) + diff) + 'px';
  }

  function drawWires(){
    if(!nmmSvg || !nmmMap) return;
    var box = nmmMap.getBoundingClientRect();
    var p = '';
    var activeBranch = nmmMap.querySelector('.nmm-branch.active');
    if(activeBranch){
      var aR = activeBranch.getBoundingClientRect();
      var ax = aR.left - box.left;
      var ay = aR.top + aR.height/2 - box.top;
      var col = activeBranch.dataset.color || '#B8963E';
      p += svgD(ax, ay, 2.5, col);
      nmmMap.querySelectorAll('.nmm-leaf').forEach(function(lEl){
        var lR = lEl.getBoundingClientRect();
        if(lR.height === 0) return;
        var lx = lR.right - box.left;
        var ly = lR.top + lR.height/2 - box.top;
        p += svgC(lx, ly, ax, ay, col, .3);
        p += svgD(lx, ly, 1.5, col);
      });
    }
    nmmSvg.innerHTML = p;
  }

  /* ── Render ── */
  function render(){
    currentBranch = null;
    var html = '<div class="nmm-col" id="nmmBranches">';
    NAV_TREE.forEach(function(b, i){
      html += '<div class="nmm-branch" data-idx="'+i+'" data-color="'+b.color+'" style="border-color:'+b.color+'30;color:'+b.color+'">';
      html += ICONS[b.icon] || '';
      html += b.label + '</div>';
    });
    html += '</div>';
    html += '<div class="nmm-col" id="nmmLeaves"></div>';
    /* RTL grid: first child goes right, second goes left */
    nmmGrid.innerHTML = html;

    var _timer = null;
    nmmGrid.querySelectorAll('.nmm-branch').forEach(function(el){
      el.addEventListener('mouseenter', function(){
        var idx = parseInt(this.dataset.idx);
        clearTimeout(_timer);
        _timer = setTimeout(function(){ selectBranch(idx); }, 180);
      });
      el.addEventListener('mouseleave', function(){
        clearTimeout(_timer);
      });
    });
    drawWires();
  }

  function selectBranch(idx){
    currentBranch = idx;
    var branch = NAV_TREE[idx];
    var col = branch.color;

    var branchesCol = document.getElementById('nmmBranches');
    branchesCol.classList.add('has-sel');
    nmmMap.querySelectorAll('.nmm-branch').forEach(function(el, i){
      el.classList.toggle('active', i === idx);
      el.style.background = (i === idx) ? col : '';
      el.style.color = (i === idx) ? 'white' : NAV_TREE[i].color;
      el.style.borderColor = (i === idx) ? col : NAV_TREE[i].color + '30';
    });

    var leavesCol = document.getElementById('nmmLeaves');
    var html = '';
    var colLight = col + '18';
    branch.children.forEach(function(leaf, i){
      var label = leaf.label;
      if(leaf.id === 'tokens') label += '<span class="nmm-leaf-badge">5</span>';
      html += '<a href="mon-compte.html#'+leaf.id+'" class="nmm-leaf nmm-anim" style="animation-delay:'+(i*80)+'ms;border-color:'+col+'40;color:'+col+';background:'+colLight+'">'+label+'</a>';
    });
    leavesCol.innerHTML = html;

    alignCol('nmmLeaves', nmmMap.querySelector('.nmm-branch.active'));
    drawWires();
  }

  /* ── Toggle ── */
  var btn = document.getElementById('accountBtn');
  if(!btn) return;

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    var isOpen = overlay.classList.contains('visible');
    if(isOpen){
      overlay.classList.remove('visible');
    } else {
      render();
      overlay.classList.add('visible');
    }
  });

  document.addEventListener('click', function(e){
    if(!overlay.contains(e.target) && !btn.contains(e.target)){
      overlay.classList.remove('visible');
    }
  });

  // Prevent overlay clicks from closing
  overlay.addEventListener('click', function(e){ e.stopPropagation(); });

})();
