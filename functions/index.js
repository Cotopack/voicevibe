const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();
const money = n => Math.max(0, Number(n || 0));
const makeCode = uid => `VV${String(uid).replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;

exports.ensureReferralAccount = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войди в аккаунт.');
  const uid = request.auth.uid;
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('failed-precondition', 'Профиль ещё не создан. Обнови страницу.');
  const code = makeCode(uid);
  const codeRef = db.doc(`referralCodes/${code}`);
  await db.runTransaction(async tx => {
    const [freshUser, codeSnap] = await Promise.all([tx.get(userRef), tx.get(codeRef)]);
    if (!freshUser.exists) throw new HttpsError('failed-precondition', 'Профиль не найден.');
    if (codeSnap.exists && codeSnap.data().uid !== uid) throw new HttpsError('already-exists', 'Не удалось создать уникальный код.');
    tx.set(codeRef, { uid, createdAt: Date.now() }, { merge: true });
    tx.set(userRef, {
      referralCode: freshUser.data().referralCode || code,
      vibecoinBalance: money(freshUser.data().vibecoinBalance),
      premiumUntil: Number(freshUser.data().premiumUntil || 0),
      updatedAt: Date.now()
    }, { merge: true });
  });
  const latest = (await userRef.get()).data();
  return { referralCode: latest.referralCode || code, vibecoinBalance: money(latest.vibecoinBalance), premiumUntil: Number(latest.premiumUntil || 0), referredBy: latest.referredBy || null };
});

exports.claimReferral = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войди в аккаунт.');
  const uid = request.auth.uid;
  const code = String(request.data?.code || '').trim().toUpperCase();
  if (!/^VV[A-Z0-9]{5,12}$/.test(code)) throw new HttpsError('invalid-argument', 'Проверь реферальный код.');
  const codeSnap = await db.doc(`referralCodes/${code}`).get();
  if (!codeSnap.exists) throw new HttpsError('not-found', 'Такой реферальный код не найден.');
  const referrerUid = codeSnap.data().uid;
  if (!referrerUid || referrerUid === uid) throw new HttpsError('failed-precondition', 'Нельзя использовать собственный код.');
  const account = await getAuth().getUser(uid);
  const createdAt = Date.parse(account.metadata.creationTime || '') || 0;
  if (!createdAt || Date.now() - createdAt > 7 * 24 * 60 * 60 * 1000) throw new HttpsError('failed-precondition', 'Код можно применить только в течение 7 дней после регистрации.');
  const newUserRef = db.doc(`users/${uid}`);
  const referrerRef = db.doc(`users/${referrerUid}`);
  const claimRef = db.doc(`referralClaims/${uid}`);
  await db.runTransaction(async tx => {
    const [newUserSnap, referrerSnap, claimSnap] = await Promise.all([tx.get(newUserRef), tx.get(referrerRef), tx.get(claimRef)]);
    if (!newUserSnap.exists || !referrerSnap.exists) throw new HttpsError('failed-precondition', 'Профиль не найден.');
    if (claimSnap.exists || newUserSnap.data().referredBy) throw new HttpsError('already-exists', 'Реферальный бонус для этого аккаунта уже использован.');
    tx.set(claimRef, { referredUid: uid, referrerUid, code, claimedAt: Date.now() });
    tx.set(newUserRef, { referredBy: referrerUid, referredAt: Date.now() }, { merge: true });
    tx.set(referrerRef, { vibecoinBalance: money(referrerSnap.data().vibecoinBalance) + 10, updatedAt: Date.now() }, { merge: true });
  });
  return { ok: true, message: 'Код принят! Пригласивший друг получил 10 Vibecoin.' };
});

exports.purchasePremium = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войди в аккаунт.');
  const ref = db.doc(`users/${request.auth.uid}`);
  const now = Date.now();
  const until = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Профиль не найден.');
    const balance = money(snap.data().vibecoinBalance);
    if (balance < 50) throw new HttpsError('failed-precondition', 'Нужно 50 Vibecoin для покупки Premium.');
    const premiumUntil = Math.max(now, Number(snap.data().premiumUntil || 0)) + 30 * 24 * 60 * 60 * 1000;
    tx.update(ref, { vibecoinBalance: balance - 50, premiumUntil, updatedAt: now });
    return premiumUntil;
  });
  return { ok: true, premiumUntil: until, message: 'Premium активирован на 30 дней!' };
});

exports.claimAdCoins = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войди в аккаунт.');
  throw new HttpsError('failed-precondition', 'Попробуйте позже — реклама пока не подключена.');
});

exports.createGroup = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войди в аккаунт.');
  const uid = request.auth.uid;
  const name = String(request.data?.name || '').trim().slice(0, 40);
  const selected = [...new Set((Array.isArray(request.data?.members) ? request.data.members : []).map(String).filter(x => x && x !== uid))];
  if (!name) throw new HttpsError('invalid-argument', 'Введи название группы.');
  if (!selected.length || selected.length > 49) throw new HttpsError('invalid-argument', 'Выбери от 1 до 49 друзей.');
  for (const memberUid of selected) {
    const [a, b] = await Promise.all([db.doc(`users/${uid}/friends/${memberUid}`).get(), db.doc(`users/${memberUid}/friends/${uid}`).get()]);
    if (!a.exists || !b.exists) throw new HttpsError('permission-denied', 'В группу можно добавить только взаимных друзей.');
  }
  const ref = await db.collection('groups').add({ name, createdBy: uid, members: [uid, ...selected], createdAt: Date.now(), updatedAt: Date.now(), lastMessage: 'Группа создана' });
  return { id: ref.id, name };
});
