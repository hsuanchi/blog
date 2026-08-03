(function(){
  var shops = {
    1:  {name:'GOODMANS COFFEE',   rating:'4.9',reviews:69,  signal:64, natl:'\u{1F1F9}\u{1F1FC}77% \u{1F1FA}\u{1F1F8}23%', collapsed:false},
    2:  {name:'Ningin Coffee',     rating:'4.7',reviews:259, signal:59, natl:'\u{1F1F9}\u{1F1FC}88% \u{1F1FA}\u{1F1F8}12%', collapsed:false},
    3:  {name:'coffee shop Majya', rating:'4.5',reviews:26,  signal:85, natl:'\u{1F1EF}\u{1F1F5}65% \u{1F1FA}\u{1F1F8}8%', collapsed:false},
    4:  {name:'LB CAFE',           rating:'4.4',reviews:127, signal:52, natl:'\u{1F1F9}\u{1F1FC}92% \u{1F1FA}\u{1F1F8}8%', collapsed:false},
    5:  {name:'Cafe Nuis',         rating:'4.6',reviews:264, signal:50, natl:'\u{1F1F9}\u{1F1FC}88% \u{1F1FA}\u{1F1F8}12%', collapsed:false},
    6:  {name:'ensemble coffee',   rating:'4.4',reviews:217, signal:62, natl:'\u{1F1F9}\u{1F1FC}83% \u{1F1FA}\u{1F1F8}16%', collapsed:true},
    7:  {name:'SR COFFEE',         rating:'4.2',reviews:16,  signal:62, natl:'\u{1F1F9}\u{1F1FC}50% \u{1F1FA}\u{1F1F8}50%', collapsed:true},
    8:  {name:"Doug's Coffee",     rating:'4.0',reviews:189, signal:74, natl:'\u{1F1F9}\u{1F1FC}89% \u{1F1FA}\u{1F1F8}11%', collapsed:true},
    9:  {name:'Sunayama Cafe',     rating:'4.6',reviews:428, signal:22, natl:'\u{1F1F9}\u{1F1FC}91% \u{1F1FA}\u{1F1F8}8%', collapsed:true},
    10: {name:'Coffee Barista',    rating:'4.1',reviews:41,  signal:71, natl:'\u{1F1F9}\u{1F1FC}90% \u{1F1FA}\u{1F1F8}10%', collapsed:true},
    11: {name:'PANIPANI',          rating:'4.4',reviews:336, signal:27, natl:'\u{1F1F9}\u{1F1FC}94% \u{1F1FA}\u{1F1F8}6%', collapsed:true},
    12: {name:'Karakara',          rating:'4.2',reviews:104, signal:24, natl:'\u{1F1F9}\u{1F1FC}88% \u{1F1FA}\u{1F1F8}12%', collapsed:true},
    13: {name:'cafe furari',       rating:'4.6',reviews:36,  signal:14, natl:'\u{1F1EF}\u{1F1F5}56% \u{1F1F9}\u{1F1FC}22%', collapsed:true},
    14: {name:'Sima cafe',         rating:'4.3',reviews:400, signal:22, natl:'\u{1F1F9}\u{1F1FC}95% \u{1F1FA}\u{1F1F8}5%', collapsed:true},
    15: {name:'chill Miyako',      rating:'4.6',reviews:301, signal:2,  natl:'\u{1F1F9}\u{1F1FC}96% \u{1F1FA}\u{1F1F8}4%', collapsed:true},
  };
  var tt = document.getElementById('mapTooltip');
  function sigColor(p){return p>=60?'#5C2E0E':p>=30?'#A0673A':'#4A8FA8';}
  document.querySelectorAll('.map-dot').forEach(function(dot){
    var id = parseInt(dot.dataset.id), s = shops[id];
    if(!s) return;
    dot.addEventListener('mouseenter', function(e){
      document.getElementById('ttName').textContent = s.name;
      document.getElementById('ttRating').textContent = '\u2B50 '+s.rating+' \u00B7 '+s.reviews+' \u5247';
      var el = document.getElementById('ttSignal');
      el.textContent = '\u5496\u5561\u4FE1\u865F '+s.signal+'%';
      el.style.color = sigColor(s.signal);
      document.getElementById('ttNatl').textContent = s.natl;
      tt.style.display = 'block';
    });
    dot.addEventListener('mousemove', function(e){
      var x = e.clientX+16, y = e.clientY+16;
      if(x+240>innerWidth) x = e.clientX-240;
      if(y+120>innerHeight) y = e.clientY-120;
      tt.style.left = x+'px'; tt.style.top = y+'px';
    });
    dot.addEventListener('mouseleave', function(){ tt.style.display='none'; });
    dot.addEventListener('click', function(){
      tt.style.display='none';
      if(s.collapsed && typeof toggleShop==='function') toggleShop(id);
      var t = document.getElementById('item-'+id);
      if(t) setTimeout(function(){t.scrollIntoView({behavior:'smooth',block:'start'});}, s.collapsed?150:0);
    });
  });
})();

function mapCalloutClick(id) {
  // For collapsed shops (#6-15), expand first
  if(id >= 6 && typeof toggleShop === 'function') {
    var row = document.getElementById('row-' + id);
    var detail = document.getElementById('detail-' + id);
    if(row && detail && detail.style.display !== 'block') {
      toggleShop(id);
    }
  }
  var t = document.getElementById('item-' + id);
  if(t) setTimeout(function(){ t.scrollIntoView({behavior:'smooth', block:'start'}); }, id >= 6 ? 150 : 0);
}



function toggleShop(num) {
  var detail = document.getElementById('detail-' + num);
  var row = document.getElementById('row-' + num);
  var btn = row.querySelector('.c-expand-btn');

  if (detail.style.display === 'block') {
    detail.style.display = 'none';
    row.classList.remove('active');
    btn.textContent = '展開';
  } else {
    detail.style.display = 'block';
    row.classList.add('active');
    btn.textContent = '收合';
    // scroll into view smoothly
    setTimeout(function() {
      document.getElementById('item-' + num).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }
}

/* ═══ Review expand / paginate ═══ */
function expandRev(shopId, nPages) {
  document.getElementById('rev-preview-' + shopId).style.display = 'none';
  var full = document.getElementById('rev-full-' + shopId);
  full.style.display = 'block';
  window._revPage = window._revPage || {};
  window._revPage[shopId] = 1;
  // scroll
  setTimeout(function() {
    document.getElementById('rev-wrap-' + shopId).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function changeRevPage(shopId, nPages, dir) {
  window._revPage = window._revPage || {};
  var cur = window._revPage[shopId] || 1;
  var np = cur + dir;
  if (np < 1 || np > nPages) return;
  var oldEl = document.getElementById('rev-page-' + shopId + '-' + cur);
  var newEl = document.getElementById('rev-page-' + shopId + '-' + np);
  if (oldEl) oldEl.style.display = 'none';
  if (newEl) newEl.style.display = 'block';
  window._revPage[shopId] = np;
  var ind = document.getElementById('rev-page-indicator-' + shopId);
  if (ind) ind.textContent = '第 ' + np + '/' + nPages + ' 頁';
  var prevBtn = document.getElementById('rev-prev-' + shopId);
  var nextBtn = document.getElementById('rev-next-' + shopId);
  if (prevBtn) prevBtn.disabled = np <= 1;
  if (nextBtn) nextBtn.disabled = np >= nPages;
  // scroll to top of wrap
  setTimeout(function() {
    var wrap = document.getElementById('rev-wrap-' + shopId);
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}



document.querySelectorAll('.cafe-guide-miyako .collapsed-row, .cafe-guide-miyako .map-callout-label').forEach(function (control) {
  control.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.click(); }
  });
});
