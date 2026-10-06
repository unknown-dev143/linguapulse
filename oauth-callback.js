/* OAuth redirect callback (runs as oauth-callback.html in a popup).
   The provider redirects back here with the result in the URL fragment
   (implicit/token flow) or query string (authorization code). We pull the
   relevant fields out and postMessage them to the opener window, then close.
   No third-party script is loaded — this page is fully same-origin. */
(function () {
  function parseQS(str) {
    const out = {};
    if (!str) return out;
    str = str.replace(/^[#?&]/, '');
    str.split('&').forEach(function (pair) {
      if (!pair) return;
      const i = pair.indexOf('=');
      const k = i < 0 ? pair : pair.slice(0, i);
      const v = i < 0 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    });
    return out;
  }

  let params = {};
  try { params = Object.assign({}, parseQS(location.search), parseQS(location.hash)); }
  catch (e) { params = {}; }

  // Normalise the fields we care about
  const result = {
    type: 'lp_oauth',
    provider: (location.hash && location.hash.indexOf('google') > -1) ? 'google' :
              (location.hash && location.hash.indexOf('discord') > -1) ? 'discord' :
              (location.search && location.search.indexOf('apple') > -1) ? 'apple' :
              (params.state && String(params.state).split(':')[0]) || '',
    access_token: params.access_token || '',
    id_token: params.id_token || '',
    code: params.code || '',
    state: params.state || '',
    expires_in: params.expires_in || '',
    error: params.error || '',
    error_description: params.error_description || ''
  };

  function done() {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(result, location.origin);
      }
    } catch (e) {}
    // Close automatically; if blocked, show a message.
    try { window.close(); } catch (e) {}
    document.body.innerHTML = '<div style="color:#cbb9ff;font:14px Inter,system-ui;text-align:center;padding:20px">'
      + (result.error ? 'Sign-in was cancelled or failed.<br>You may close this tab.' : 'Signed in. You can close this tab.')
      + '</div>';
  }

  // Give the opener a moment to attach its message listener, then send.
  setTimeout(done, 250);
  window.addEventListener('load', function () { setTimeout(done, 600); });
})();
