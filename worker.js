/** VoiceVibe Premium Worker — Cloudflare Workers, no paid Firebase Functions required.
 * Required Worker secret: FIREBASE_SERVICE_ACCOUNT (entire service-account JSON).
 * Deploy this Worker, then set PREMIUM_WORKER_URL in app.js to its HTTPS URL.
 */
const PROJECT_ID = 'voicevibe-1b8c0';
const FIREBASE_API_KEY = 'AIzaSyDFQ4ffsLf857irvY0pTtduk35XeZCM8Ko';
const ALLOWED_ORIGINS = ['https://cotopack.github.io'];
const PRICE = 50;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const b64url = (input) => btoa(String.fromCharCode(...new Uint8Array(input)))
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const enc = (s) => new TextEncoder().encode(s);

async function serviceAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const unsigned = `${header}.${claim}`;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binary, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(unsigned));
  const assertion = `${unsigned}.${b64url(signature)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Не удалось авторизовать сервер Firebase.');
  return data.access_token;
}

async function verifyFirebaseUser(idToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  const data = await response.json();
  const user = data.users?.[0];
  if (!response.ok || !user?.localId || user.disabled) throw new Error('Сессия недействительна. Войди в аккаунт заново.');
  return user.localId;
}

function response(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin || 'https://cotopack.github.io',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'vary': 'Origin', 'cache-control': 'no-store'
  }});
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
      return response({}, 204, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) return response({ error: 'Недопустимый источник запроса.' }, 403, ALLOWED_ORIGINS[0]);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/buy-premium') return response({ error: 'Not found' }, 404, origin);
    try {
      const auth = request.headers.get('Authorization') || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!idToken) return response({ error: 'Войди в аккаунт.' }, 401, origin);
      const uid = await verifyFirebaseUser(idToken);
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
      if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.private_key || !serviceAccount.client_email)
        throw new Error('Секрет FIREBASE_SERVICE_ACCOUNT настроен неправильно.');
      const accessToken = await serviceAccessToken(serviceAccount);
      const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
      const getDoc = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const doc = await getDoc.json();
      if (!getDoc.ok) return response({ error: getDoc.status === 404 ? 'Профиль не найден.' : 'Не удалось прочитать баланс.' }, getDoc.status === 404 ? 404 : 502, origin);
      const fields = doc.fields || {};
      const balance = Math.max(0, Number(fields.vibecoinBalance?.integerValue ?? fields.vibecoinBalance?.doubleValue ?? 0));
      const currentUntil = Number(fields.premiumUntil?.integerValue ?? fields.premiumUntil?.doubleValue ?? 0);
      if (balance < PRICE) return response({ error: 'Нужно 50 Vibecoin для покупки Premium.' }, 400, origin);
      const now = Date.now();
      const premiumUntil = Math.max(now, currentUntil) + PERIOD_MS;
      const patch = await fetch(`${docUrl}?updateMask.fieldPaths=vibecoinBalance&updateMask.fieldPaths=premiumUntil&updateMask.fieldPaths=updatedAt&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: {
          vibecoinBalance: { integerValue: String(balance - PRICE) },
          premiumUntil: { integerValue: String(premiumUntil) },
          updatedAt: { integerValue: String(now) }
        }})
      });
      if (patch.status === 409 || patch.status === 400) return response({ error: 'Баланс одновременно изменился. Обнови страницу и попробуй ещё раз.' }, 409, origin);
      if (!patch.ok) return response({ error: 'Не удалось сохранить покупку. Попробуй ещё раз.' }, 502, origin);
      return response({ ok: true, premiumUntil, vibecoinBalance: balance - PRICE, message: 'Premium активирован на 30 дней!' }, 200, origin);
    } catch (error) {
      return response({ error: error?.message || 'Внутренняя ошибка сервера.' }, 500, origin);
    }
  }
};
