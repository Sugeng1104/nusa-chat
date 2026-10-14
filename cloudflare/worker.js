// PASURA Chat V18 — Cloudflare Worker (FCM HTTP v1)
// This worker intentionally requires a trusted server-side shared secret for push requests.
// Never expose PUSH_API_SECRET in browser JavaScript or a public GitHub repository.
const enc = new TextEncoder();
function b64url(data) {
  const bytes = data instanceof Uint8Array ? data : enc.encode(data);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claim}`;
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput)));
  const assertion = `${signingInput}.${b64url(sig)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error('OAuth token request failed');
  return (await response.json()).access_token;
}
function reply(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return reply({ ok: true, service: 'PASURA Chat FCM worker', configured: Boolean(env.FIREBASE_SERVICE_ACCOUNT) });
    if (url.pathname !== '/send' || request.method !== 'POST') return reply({ error: 'Not found' }, 404);
    // Server-to-server only: not safe for direct calls from a public web app.
    if (!env.PUSH_API_SECRET || request.headers.get('x-push-api-secret') !== env.PUSH_API_SECRET) return reply({ error: 'Unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    if (typeof body.token !== 'string' || body.token.length > 4096 || body.token.length < 20) return reply({ error: 'Invalid FCM token' }, 400);
    if (typeof body.title !== 'string' || body.title.length > 100 || typeof body.message !== 'string' || body.message.length > 300) return reply({ error: 'Invalid notification' }, 400);
    if (!env.FIREBASE_SERVICE_ACCOUNT) return reply({ error: 'Server not configured' }, 503);
    try {
      const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      const accessToken = await getAccessToken(sa);
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { token: body.token, notification: { title: body.title, body: body.message }, webpush: { notification: { icon: '/icons/icon-192.png' } } } })
      });
      if (!response.ok) return reply({ error: 'FCM request failed', status: response.status }, 502);
      return reply({ ok: true });
    } catch { return reply({ error: 'Push delivery failed' }, 500); }
  }
};
