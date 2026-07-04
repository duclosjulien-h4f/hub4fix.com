/**
 * Hub4Fix — format de code postal adapté au pays.
 *
 * Le code postal ne suit pas les mêmes règles partout (5 chiffres en
 * France/Allemagne/Italie/Espagne, NN-NNN en Pologne, alphanumérique au
 * Royaume-Uni, quasi absent au Sénégal/Côte d'Ivoire/Cameroun...).
 *
 * Le pays est déterminé par un signal EXPLICITE — l'indicatif téléphonique
 * déjà choisi par l'utilisateur dans le formulaire, ou le country_code
 * renvoyé par la géolocalisation — jamais déduit du texte tapé (trop
 * ambigu : plusieurs pays partagent le même nombre de chiffres).
 */
(function(){
  var INDICATIF_TO_ISO = {
    '+33':'FR','+32':'BE','+41':'CH','+352':'LU','+49':'DE','+34':'ES','+39':'IT',
    '+351':'PT','+31':'NL','+44':'GB','+353':'IE','+43':'AT','+48':'PL','+1':'US',
    '+212':'MA','+213':'DZ','+216':'TN','+221':'SN','+225':'CI','+237':'CM'
  };
  var ISO_TO_INDICATIF = {};
  Object.keys(INDICATIF_TO_ISO).forEach(function(k){ ISO_TO_INDICATIF[INDICATIF_TO_ISO[k]] = k; });

  // Pattern HTML (sans ancres ^$, l'attribut pattern les ajoute implicitement).
  var TABLE = {
    FR:{ pattern:'\\d{5}', example:'75001', required:true },
    BE:{ pattern:'\\d{4}', example:'1000', required:true },
    CH:{ pattern:'\\d{4}', example:'8000', required:true },
    LU:{ pattern:'\\d{4}', example:'1000', required:true },
    DE:{ pattern:'\\d{5}', example:'10115', required:true },
    ES:{ pattern:'\\d{5}', example:'28001', required:true },
    IT:{ pattern:'\\d{5}', example:'00100', required:true },
    PT:{ pattern:'\\d{4}-\\d{3}', example:'1000-001', required:true },
    NL:{ pattern:'\\d{4}\\s?[A-Za-z]{2}', example:'1012 AB', required:true },
    GB:{ pattern:'[A-Za-z]{1,2}\\d[A-Za-z\\d]?\\s?\\d[A-Za-z]{2}', example:'SW1A 1AA', required:true },
    IE:{ pattern:'[A-Za-z]\\d{2}\\s?[A-Za-z0-9]{4}', example:'D02 AF30', required:false },
    AT:{ pattern:'\\d{4}', example:'1010', required:true },
    PL:{ pattern:'\\d{2}-\\d{3}', example:'00-001', required:true },
    US:{ pattern:'\\d{5}(-\\d{4})?', example:'10001', required:true },
    MA:{ pattern:'\\d{5}', example:'20000', required:true },
    DZ:{ pattern:'\\d{5}', example:'16000', required:true },
    TN:{ pattern:'\\d{4}', example:'1000', required:true },
    SN:{ pattern:'.*', example:'', required:false },
    CI:{ pattern:'.*', example:'', required:false },
    CM:{ pattern:'.*', example:'', required:false }
  };
  var GENERIC = { pattern:'.*', example:'', required:false };

  function apply(input, iso){
    if(!input) return;
    var c = (iso && TABLE[iso]) || GENERIC;
    input.pattern = c.pattern;
    input.placeholder = c.example || '';
    input.required = c.required;

    var hint = input.parentNode.querySelector('.cp-hint');
    if(!hint){
      hint = document.createElement('small');
      hint.className = 'cp-hint';
      hint.style.cssText = 'display:block;margin-top:.3rem;font-size:.72rem;color:#A89F91';
      input.insertAdjacentElement('afterend', hint);
    }
    hint.textContent = c.required === false
      ? 'Facultatif pour ce pays'
      : (c.example ? 'Format attendu : ex. ' + c.example : '');
  }

  window.H4FPostal = {
    isoFromIndicatif: function(indicatif){ return INDICATIF_TO_ISO[indicatif] || null; },
    indicatifFromIso: function(iso){ return ISO_TO_INDICATIF[iso] || null; },
    apply: apply
  };
})();
