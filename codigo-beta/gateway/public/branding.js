// Ratoeira presentation overlay. The upstream Paseo bundle remains unchanged.
(() => {
  function brand() {
    if (document.title === 'Paseo') document.title = 'Ratoeira';
    for (const icon of document.head.querySelectorAll('link[rel="icon"]')) {
      const url = new URL(icon.href, location.origin);
      if (url.pathname === '/favicon.ico' || /\/favicon-(light|dark)/.test(url.pathname)) {
        icon.href = '/_ratoeira/favicon.png';
        icon.type = 'image/png';
      }
    }
  }
  new MutationObserver(brand).observe(document.head, { childList:true, subtree:true, attributes:true, attributeFilter:['href'], characterData:true });
  brand();
})();
