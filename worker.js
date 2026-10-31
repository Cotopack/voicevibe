/** VoiceVibe API Worker — Premium + referrals, no Firebase Functions required.
 * Required Worker secret: FIREBASE_SERVICE_ACCOUNT (entire service-account JSON).
 * Routes: POST /buy-premium, POST /referral/ensure, POST /referral/claim
 */
const PROJECT_ID = 'voicevibe-1b8c0';
const FIREBASE_API_KEY = 'AIzaSyDFQ4ffsLf857irvY0pTtduk35XeZCM8Ko';
const ALLOWED_ORIGINS = ['https://cotopack.github.io'];
const PREMIUM_PRICE = 50;
const PREMIUM_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const REFERRAL_REWARD = 10;
const REFERRAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const b64url = (input) => btoa(String.fromCharCode(...new Uint8Array(input)))
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const enc = (s) => new TextEncoder().encode(s);
const numberField = (fields, key) => Math.max(0, Number(fields?.[key]?.integerValue ?? fields?.[key]?.doubleValue ?? 0));
const stringField = (fields, key) => String(fields?.[key]?.stringValue ?? '');
const docName = (path) => `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
const docUrl = (path) => `https://firestore.googleapis.com/v1/${docName(path)}`;

async function serviceAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
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
  return user;
}

function response(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin || ALLOWED_ORIGINS[0],
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'vary': 'Origin', 'cache-control': 'no-store'
  }});
}

async function getDocument(accessToken, path) {
  const res = await fetch(docUrl(path), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error('Не удалось прочитать данные Firestore.');
  return data;
}

async function commit(accessToken, writes) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error?.message || 'Не удалось сохранить изменения Firestore.');
    error.status = res.status;
    throw error;
  }
  return data;
}

function updateWrite(path, fields, fieldPaths, updateTime) {
  return { update: { name: docName(path), fields }, updateMask: { fieldPaths }, currentDocument: { updateTime } };
}

async function ensureReferral(accessToken, uid) {
  const userPath = `users/${uid}`;
  const user = await getDocument(accessToken, userPath);
  if (!user) throw new Error('Профиль не найден. Обнови страницу и войди снова.');
  const code = `VV${uid.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
  const existingCode = stringField(user.fields, 'referralCode') || code;
  const codePath = `referralCodes/${existingCode}`;
  const codeDoc = await getDocument(accessToken, codePath);
  if (codeDoc && stringField(codeDoc.fields, 'uid') !== uid) throw new Error('Не удалось создать уникальный реферальный код.');

  const balance = numberField(user.fields, 'vibecoinBalance');
  const premiumUntil = numberField(user.fields, 'premiumUntil');
  const now = Date.now();
  const writes = [updateWrite(userPath, {
    referralCode: { stringValue: existingCode },
    vibecoinBalance: { integerValue: String(balance) },
    premiumUntil: { integerValue: String(premiumUntil) },
    updatedAt: { integerValue: String(now) }
  }, ['referralCode', 'vibecoinBalance', 'premiumUntil', 'updatedAt'], user.updateTime)];
  if (!codeDoc) writes.push({
    update: { name: docName(codePath), fields: { uid: { stringValue: uid }, createdAt: { integerValue: String(now) } } },
    currentDocument: { exists: false }
  });
  await commit(accessToken, writes);
  return { referralCode: existingCode, vibecoinBalance: balance, premiumUntil, referredBy: stringField(user.fields, 'referredBy') || null };
}

async function claimReferral(accessToken, uid, authUser, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^VV[A-Z0-9]{5,12}$/.test(code)) throw new Error('Проверь реферальный код.');
  const createdAt = Number(authUser.createdAt || 0);
  if (!createdAt || Date.now() - createdAt > REFERRAL_MAX_AGE_MS) throw new Error('Код можно применить только в течение 7 дней после регистрации.');

  const codeDoc = await getDocument(accessToken, `referralCodes/${code}`);
  if (!codeDoc) throw new Error('Такой реферальный код не найден.');
  const referrerUid = stringField(codeDoc.fields, 'uid');
  if (!referrerUid || referrerUid === uid) throw new Error('Нельзя использовать собственный код.');

  const [newUser, referrer, previousClaim] = await Promise.all([
    getDocument(accessToken, `users/${uid}`),
    getDocument(accessToken, `users/${referrerUid}`),
    getDocument(accessToken, `referralClaims/${uid}`)
  ]);
  if (!newUser || !referrer) throw new Error('Профиль не найден.');
  if (previousClaim || stringField(newUser.fields, 'referredBy')) throw new Error('Реферальный бонус для этого аккаунта уже использован.');

  const now = Date.now();
  const newBalance = numberField(referrer.fields, 'vibecoinBalance') + REFERRAL_REWARD;
  await commit(accessToken, [
    { update: { name: docName(`referralClaims/${uid}`), fields: {
      referredUid: { stringValue: uid }, referrerUid: { stringValue: referrerUid },
      code: { stringValue: code }, claimedAt: { integerValue: String(now) }
    }}, currentDocument: { exists: false } },
    updateWrite(`users/${uid}`, {
      referredBy: { stringValue: referrerUid }, referredAt: { integerValue: String(now) }
    }, ['referredBy', 'referredAt'], newUser.updateTime),
    updateWrite(`users/${referrerUid}`, {
      vibecoinBalance: { integerValue: String(newBalance) }, updatedAt: { integerValue: String(now) }
    }, ['vibecoinBalance', 'updatedAt'], referrer.updateTime)
  ]);
  return { ok: true, message: 'Код принят! Пригласивший друг получил 10 Vibecoin.' };
}


async function createGroup(accessToken, uid, body) {
  const name = String(body?.name || '').trim().slice(0, 40);
  const selected = [...new Set((Array.isArray(body?.members) ? body.members : []).filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) && x !== uid))];
  if (!name || selected.length < 1 || selected.length > 49) throw new Error('Введи название и выбери от 1 до 49 друзей.');
  for (const member of selected) {
    const [a,b] = await Promise.all([getDocument(accessToken, `users/${uid}/friends/${member}`), getDocument(accessToken, `users/${member}/friends/${uid}`)]);
    if (!a || !b) throw new Error('Добавлять можно только взаимных друзей.');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await commit(accessToken, [{update: {name: docName(`groups/${id}`), fields: {
    name: {stringValue:name}, createdBy: {stringValue:uid},
    members: {arrayValue:{values:[uid,...selected].map(x=>({stringValue:x}))}},
    createdAt: {integerValue:String(now)}, updatedAt: {integerValue:String(now)}, lastMessage: {stringValue:'Группа создана'}
  }},currentDocument:{exists:false}}]);
  return {id,name};
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
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405, origin);
    const route = url.pathname.replace(/\/$/, '');
    if (!['/buy-premium', '/referral/ensure', '/referral/claim', '/create-group', '/claim-ad-coins'].includes(route)) return response({ error: 'Not found' }, 404, origin);

    try {
      const auth = request.headers.get('Authorization') || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!idToken) return response({ error: 'Войди в аккаунт.' }, 401, origin);
      const authUser = await verifyFirebaseUser(idToken);
      const uid = authUser.localId;
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
      if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.private_key || !serviceAccount.client_email)
        throw new Error('Секрет FIREBASE_SERVICE_ACCOUNT настроен неправильно.');
      const accessToken = await serviceAccessToken(serviceAccount);

      if (route === '/referral/ensure') {
        const data = await ensureReferral(accessToken, uid);
        return response(data, 200, origin);
      }
      if (route === '/referral/claim') {
        const body = await request.json().catch(() => ({}));
        const data = await claimReferral(accessToken, uid, authUser, body.code);
        return response(data, 200, origin);
      }

      if (route === '/claim-ad-coins') return response({error:'Реклама пока не подключена. Монеты не начислены.'}, 400, origin);
      if (route === '/create-group') {
        const body = await request.json().catch(() => ({}));
        return response(await createGroup(accessToken, uid, body), 200, origin);
      }
      const userDocUrl = docUrl(`users/${uid}`);
      const getDoc = await fetch(userDocUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const doc = await getDoc.json();
      if (!getDoc.ok) return response({ error: getDoc.status === 404 ? 'Профиль не найден.' : 'Не удалось прочитать баланс.' }, getDoc.status === 404 ? 404 : 502, origin);
      const fields = doc.fields || {};
      const balance = numberField(fields, 'vibecoinBalance');
      const currentUntil = numberField(fields, 'premiumUntil');
      if (balance < PREMIUM_PRICE) return response({ error: 'Нужно 50 Vibecoin для покупки Premium.' }, 400, origin);
      const now = Date.now();
      const premiumUntil = Math.max(now, currentUntil) + PREMIUM_PERIOD_MS;
      const patch = await fetch(`${userDocUrl}?updateMask.fieldPaths=vibecoinBalance&updateMask.fieldPaths=premiumUntil&updateMask.fieldPaths=updatedAt&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: {
          vibecoinBalance: { integerValue: String(balance - PREMIUM_PRICE) },
          premiumUntil: { integerValue: String(premiumUntil) }, updatedAt: { integerValue: String(now) }
        }})
      });
      if (patch.status === 409 || patch.status === 400) return response({ error: 'Баланс одновременно изменился. Обнови страницу и попробуй ещё раз.' }, 409, origin);
      if (!patch.ok) return response({ error: 'Не удалось сохранить покупку. Попробуй ещё раз.' }, 502, origin);
      return response({ ok: true, premiumUntil, vibecoinBalance: balance - PREMIUM_PRICE, message: 'Premium активирован на 30 дней!' }, 200, origin);
    } catch (error) {
      const message = error?.status === 409 ? 'Реферальная операция уже выполнена или данные изменились. Обнови страницу.' : (error?.message || 'Внутренняя ошибка сервера.');
      return response({ error: message }, error?.status === 409 ? 409 : 400, origin);
    }
  }
};
