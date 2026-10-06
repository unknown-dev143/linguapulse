// LinguaPulse — GitHub CORS proxy as a Cloudflare Pages Function.
//
// GitHub's /login/device/code and /login/oauth/access_token endpoints send NO
// Access-Control-Allow-Origin header, so a browser cannot call them directly.
// This function runs on Cloudflare (same domain as the app when hosted on Pages)
// and forwards the request to GitHub, adding CORS headers on the way back. It only
// forwards to github.com — it is not an open proxy.
//
// Deploy: drop this file into functions/api/github/ and deploy the folder to
// Cloudflare Pages (connect a git repo, or `npx wrangler pages deploy .`). The app's
// "GitHub CORS proxy" base URL then becomes https://<your-project>.pages.dev/api/github
//
// App usage: Settings → "GitHub CORS proxy" = https://<your-project>.pages.dev/api/github

const GH = 'https://github.com';

export async function onRequest(context) {
  const { request } = context;

  // Answer CORS preflight directly (avoids an unnecessary hop to GitHub).
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
    });
  }

  const url = new URL(request.url);
  const ghPath = url.pathname.replace(/^\/api\/github/, '') || '/';
  const target = GH + ghPath + url.search;

  // Forward only safe headers; never forward host.
  const headers = {};
  for (const [k, v] of request.headers.entries()) {
    if (k.toLowerCase() === 'host' || k.toLowerCase() === 'content-length') continue;
    headers[k] = v;
  }
  headers['accept'] = headers['accept'] || 'application/json';

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'proxy_failed', error_description: String(e && e.message || e) }),
      { status: 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }
    );
  }
}
