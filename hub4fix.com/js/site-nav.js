/* Hub4Fix — comportements de navigation partagés du tronc B2C.
 * - Menu mobile (hamburger)
 * - Effet "aspiration" au clic sur le logo (repris de l'index)
 */
(function () {
  'use strict';

  // Menu mobile
  var burger = document.querySelector('.hamburger-btn');
  var mobileNav = document.querySelector('.mobile-nav');
  if (burger && mobileNav) {
    burger.addEventListener('click', function () { mobileNav.classList.toggle('open'); });
  }

  // Logo : petite animation d'aspiration avant navigation
  var brand = document.querySelector('.nav-brand');
  if (brand) {
    brand.addEventListener('click', function (e) {
      var href = brand.getAttribute('href') || 'kintsugi.html';
      if (!href || href === '#') return;
      e.preventDefault();
      document.body.style.transformOrigin = 'top center';
      document.body.classList.add('page-sucking');
      var navigated = false;
      function go() { if (!navigated) { navigated = true; window.location.assign(href); } }
      document.body.addEventListener('animationend', go);
      setTimeout(go, 700);
    });
  }
})();
