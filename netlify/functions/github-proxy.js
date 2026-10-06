// LinguaPulse — GitHub CORS proxy (Netlify Functions v2, ESM).
//
// GitHub's /login/device/code and /login/oauth/access_token endpoints send NO
// Access-Control-Allow-Origin header, so a browser cannot call them directly.
// This function runs same-origin with the app and forwards the request to GitHub,
// adding CORS headers on the way back. It only forwards to github.com — it is not
// an open proxy.
//
// Deploy: place this file at netlify/functions/github-proxy.js and add the redirect
// in netlify.toml so the app can call /api/github/* as its proxy base URL.
//
// App usage: Settings → "GitHub CORS proxy" = https://<your-site>/.netlify/functions/github-proxy
// (or https://<your-site>/api/github if the redirect below is used).

const GH = 'https://github.com';

function stripPrefix(path) {
  // Accept either the default /.netlify/functions/github-proxy path or /api/github.
  let p = path.replace(/^.*\/github-proxy/, '');
  if (p === path) p = p.replace(/^\/api\/github/, '');
  return p === '' ? '/' : p;
}

export const handler = async (event) => {
  const path = stripPrefix(event.path || '/');
  const query = event.rawQuery ? '?' + event.rawQuery : '';
  const url = GH + path + query;

  // Forward only safe, relevant headers; never forward host.
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (k.toLowerCase() === 'host' || k.toLowerCase() === 'content-length') continue;
    headers[k] = v;
  }
  headers['accept'] = headers['accept'] || 'application/json';

  try {
    const upstream = await fetch(url, {
      method: event.httpMethod || 'POST',
      headers,
      body: event.body || undefined,
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'proxy_failed', error_description: String(e && e.message || e) }),
    };
  }
};
