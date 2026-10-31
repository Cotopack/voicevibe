import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, 
            collection, 
            doc, 
            setDoc, 
            getDoc,
            deleteDoc, arrayUnion, arrayRemove, 
            onSnapshot, query, where, orderBy, limit, getDocs, addDoc, updateDoc, serverTimestamp, runTransaction
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        
        const appId = 'voicevibe-1b8c0';
        // Owner UID: only this account can manage admin stars.
        const DEVELOPER_UID = 'NL0ho7jXHmSswotGoe5H5wpA5X43';

        const firebaseConfig = {
            apiKey: "AIzaSyDFQ4ffsLf857irvY0pTtduk35XeZCM8Ko",
            authDomain: "voicevibe-1b8c0.firebaseapp.com",
            projectId: "voicevibe-1b8c0",
            storageBucket: "voicevibe-1b8c0.firebasestorage.app",
            messagingSenderId: "60527601868",
            appId: "1:60527601868:web:8512e2219ac0d056ebfa69",
            measurementId: "G-8HJBHBNSCG"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        // Premium and referral rewards are handled by the same Cloudflare Worker.
        // Replace YOUR-SUBDOMAIN with the workers.dev subdomain shown by Cloudflare.
        const WORKER_BASE_URL = 'https://vibevoice.smart-nikitos.workers.dev';
        const PREMIUM_WORKER_URL = `${WORKER_BASE_URL}/buy-premium`;
        async function workerPost(path, payload = {}) {
            if (WORKER_BASE_URL.includes('YOUR-SUBDOMAIN')) throw new Error('Укажи свой адрес Cloudflare Worker в WORKER_BASE_URL.');
            if (!state.user) throw new Error('Сначала войди в аккаунт.');
            const idToken = await state.user.getIdToken(true);
            const res = await fetch(`${WORKER_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Ошибка сервера VoiceVibe.');
            return { data };
        }
        const ensureReferralAccount = () => workerPost('/referral/ensure');
        const claimReferralCall = (payload) => workerPost('/referral/claim', payload);
        const claimAdCoinsCall = () => workerPost('/claim-ad-coins');
        const createGroupCall = (payload) => workerPost('/create-group', payload);
        const pendingReferralCode = new URLSearchParams(location.search).get('ref') || localStorage.getItem('vv_pending_referral') || '';
        if (new URLSearchParams(location.search).get('ref')) localStorage.setItem('vv_pending_referral', new URLSearchParams(location.search).get('ref'));
        // Keep the same account signed in across normal browser restarts.
        await setPersistence(auth, browserLocalPersistence).catch(err => console.warn('Auth persistence:', err));
        getRedirectResult(auth).catch(err => { if (err?.code) console.warn('Google redirect result:', err); });

        // --- State Management ---
        const state = {
            selectedAge: null,
            localStream: null,
            peer: null,
            myPeerId: null,
            currentCall: null,
            audioContext: null,
            analyser: null,
            isMicMuted: false,
            isSearching: false,
            isConnected: false,
            isPaused: false,
            user: null,
            userProfile: null,
            queueUnsub: null,
            connectingTo: null,
            isHandlingDisconnect: false,
            currentMatchUid: null,
            currentFriendUid: null,
            messageUnsub: null,
            socialUnsubs: [],
            unreadUnsubs: [],
            unreadCounts: new Map(),
            presenceUnsubs: [],
            presenceCache: new Map(),
            presenceHeartbeat: null,
            friendProfiles: new Map(),
            challengeSending: false,
            snakeTimer: null,
            snakeState: null,
            snakeChallengeId: null,
            searchStarting: false,
            peerReconnectTimer: null,
            storyUploading: false,
            groupUnsub: null
        };

        // UI Bindings
        const screenAgeSelect = document.getElementById('screenAgeSelect');
        const screenChat = document.getElementById('screenChat');
        const selectedCategoryBadge = document.getElementById('selectedCategoryBadge');
        
        const peerStatusDot = document.getElementById('peerStatusDot');
        const peerStatusText = document.getElementById('peerStatusText');
        const micLevelBar = document.getElementById('micLevelBar');
        const remoteAudio = document.getElementById('remoteAudio');

        const avatarCircle = document.getElementById('avatarCircle');
        const avatarIcon = document.getElementById('avatarIcon');
        const chatStatusTitle = document.getElementById('chatStatusTitle');
        const chatStatusDesc = document.getElementById('chatStatusDesc');

        const btnStartSearch = document.getElementById('btnStartSearch');
        const btnSkip = document.getElementById('btnSkip');
        const btnPause = document.getElementById('btnPause');
        const btnToggleMic = document.getElementById('btnToggleMic');
        const micBtnIcon = document.getElementById('micBtnIcon');
        const micBtnText = document.getElementById('micBtnText');
        const btnExitMenu = document.getElementById('btnExitMenu');
        const btnExitMenuBottom = document.getElementById('btnExitMenuBottom');

        // Authentication is explicit: email/password or phone/SMS. No anonymous account is created.
        let resolveAuthReady;
        const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
        onAuthStateChanged(auth, async (user) => {
            state.user = user || null;
            if (user) {
                // Hide the sign-in screen immediately; profile loading happens behind the app.
                document.getElementById('authOverlay')?.classList.add('hidden');
                try {
                    const profileSnap = await getDoc(doc(db, 'users', user.uid));
                    state.userProfile = profileSnap.exists() ? profileSnap.data() : {
                        displayName: user.displayName || 'Пользователь',
                        photoURL: user.photoURL || '',
                        bio: '',
                        username: '',
                        createdAt: Date.now()
                    };
                    if (!profileSnap.exists()) await setDoc(doc(db, 'users', user.uid), state.userProfile);
                    try {
                        const walletResult = await ensureReferralAccount();
                        state.userProfile = { ...(state.userProfile || {}), ...(walletResult.data || {}) };
                        const referralToClaim = pendingReferralCode.trim();
                        if (referralToClaim && referralToClaim.toUpperCase() !== String(walletResult.data?.referralCode || '').toUpperCase() && !walletResult.data?.referredBy) {
                            try { const claimResult = await claimReferralCall({ code: referralToClaim }); state.userProfile = { ...(state.userProfile || {}), vibecoinBalance: claimResult.data?.vibecoinBalance ?? state.userProfile?.vibecoinBalance, referredBy: true }; localStorage.removeItem('vv_pending_referral'); }
                            catch (claimErr) { console.warn('Automatic referral claim:', claimErr); }
                        }
                    } catch (walletErr) { console.warn('Vibecoin backend is not deployed/configured yet:', walletErr); }
                    applyProfileToUI();
                    document.getElementById('authOverlay')?.classList.add('hidden');
                    document.getElementById('profileBtn')?.classList.remove('hidden');
                    document.getElementById('bottomNav')?.classList.remove('hidden');
                    startSocialListeners();
                    renderSocialProfile();
                } catch (err) {
                    console.error('Profile load failed:', err);
                    showAuthMessage('Вход выполнен, но не удалось загрузить профиль. Проверьте Rules Firestore.');
                }
            } else {
                state.userProfile = null;
                document.getElementById('authOverlay')?.classList.remove('hidden');
                document.getElementById('profileBtn')?.classList.add('hidden');
                document.getElementById('bottomNav')?.classList.add('hidden');
                stopSocialListeners();
            }
            resolveAuthReady(user);
        });

        function showAuthMessage(message) {
            const el = document.getElementById('authMessage');
            if (el) { el.textContent = message; el.classList.remove('hidden'); }
        }
        function applyProfileToUI() {
            const profile = state.userProfile || {};
            const name = profile.displayName || state.user?.displayName || 'Мой профиль';
            const photoURL = Object.prototype.hasOwnProperty.call(profile, 'photoURL') ? profile.photoURL : state.user?.photoURL;
            const nameEl = document.getElementById('profileHeaderName');
            const avatarEl = document.getElementById('profileHeaderAvatar');
            if (nameEl) nameEl.textContent = name;
            if (avatarEl) {
                avatarEl.innerHTML = '';
                if (profile.photoURL || state.user?.photoURL) {
                    const img = document.createElement('img');
                    img.src = profile.photoURL || state.user.photoURL;
                    img.alt = 'Аватар'; img.className = 'w-full h-full object-cover rounded-full';
                    img.onerror = () => { avatarEl.textContent = (name[0] || 'П').toUpperCase(); };
                    avatarEl.appendChild(img);
                } else avatarEl.textContent = (name[0] || 'П').toUpperCase();
            }
        }

        document.getElementById('btnGoogleLogin')?.addEventListener('click', async () => {
            const btn = document.getElementById('btnGoogleLogin');
            if (btn) { btn.disabled = true; btn.textContent = 'Подключаем Google…'; }
            try {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                await signInWithPopup(auth, provider);
            } catch (err) {
                console.error('Google sign-in failed:', err);
                if (['auth/popup-blocked','auth/cancelled-popup-request','auth/operation-not-supported-in-this-environment'].includes(err?.code)) {
                    try { await signInWithRedirect(auth, new GoogleAuthProvider()); }
                    catch (redirectErr) { showAuthMessage(authErrorMessage(redirectErr)); }
                } else showAuthMessage(authErrorMessage(err));
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-brands fa-google mr-2"></i>Продолжить с Google'; }
            }
        });

        document.getElementById('btnEmailLogin')?.addEventListener('click', async () => {
            const email = document.getElementById('emailInput').value.trim();
            const password = document.getElementById('emailPassword').value;
            if (!email || !password) return showAuthMessage('Введи почту и пароль.');
            try { showAuthMessage(''); await signInWithEmailAndPassword(auth, email, password); }
            catch (err) { console.error('Email login failed:', err); showAuthMessage(authErrorMessage(err)); }
        });
        document.getElementById('btnEmailRegister')?.addEventListener('click', async () => {
            const email = document.getElementById('emailInput').value.trim();
            const password = document.getElementById('emailPassword').value;
            if (!email || password.length < 6) return showAuthMessage('Введи почту и пароль минимум из 6 символов.');
            try { showAuthMessage(''); await createUserWithEmailAndPassword(auth, email, password); }
            catch (err) { console.error('Email registration failed:', err); showAuthMessage(authErrorMessage(err)); }
        });

        function authErrorMessage(err) {
            const messages = {
                'auth/unauthorized-domain': 'Добавь cotopack.github.io в Firebase Authentication → Settings → Authorized domains.',
                'auth/account-exists-with-different-credential': 'Эта почта уже привязана к другому способу входа. Войди прежним способом.',
                'auth/network-request-failed': 'Нет соединения или браузер блокирует запрос. Проверь интернет и попробуй снова.',
                'auth/operation-not-allowed': 'Этот способ входа не включён в Firebase Console → Authentication → Sign-in method.',
                'auth/popup-closed-by-user': 'Окно входа закрыто. Попробуй ещё раз.',
                'auth/invalid-phone-number': 'Проверь номер телефона и международный код.',
                'auth/invalid-credential': 'Неверная почта или пароль.',
                'auth/email-already-in-use': 'Эта почта уже зарегистрирована — попробуй войти.',
                'auth/weak-password': 'Пароль должен содержать не менее 6 символов.',
                'auth/too-many-requests': 'Слишком много попыток. Подожди и попробуй позже.',
                'auth/billing-not-enabled': 'Для SMS-аутентификации проверь требования тарифного плана Firebase.'
            };
            return messages[err?.code] || `Не удалось войти (${err?.code || 'ошибка'}). Проверь настройки Firebase и попробуй ещё раз.`;
        }

        const profileModal = document.getElementById('profileModal');
        document.getElementById('profileBtn')?.addEventListener('click', () => {
            const p = state.userProfile || {};
            document.getElementById('profileNameInput').value = p.displayName || state.user?.displayName || '';
            document.getElementById('profileUsernameInput').value = p.username ? '@' + p.username : '';
            document.getElementById('profileBioInput').value = p.bio || '';
            const preview = document.getElementById('profileEditAvatarPreview');
            if (preview) preview.innerHTML = avatarMarkup(p, 'h-14 w-14');
            const removeAvatarButton = document.getElementById('btnRemoveAvatar');
            if (removeAvatarButton) { removeAvatarButton.dataset.remove = 'false'; removeAvatarButton.innerHTML = '<i class="fa-regular fa-trash-can mr-1"></i> Удалить аватар'; removeAvatarButton.classList.remove('border-rose-500/50','text-rose-200'); }
            document.getElementById('profileEmailText').textContent = state.user?.email || 'Аккаунт VoiceVibe';
            const changedAt = Number(p.usernameChangedAt || 0);
            const remaining = Math.max(0, 14*24*60*60*1000 - (Date.now()-changedAt));
            const hint = document.getElementById('usernameChangeHint');
            if (hint) hint.textContent = remaining ? `Следующая смена @nickname через ${Math.ceil(remaining/86400000)} дн.` : 'Можно менять @nickname. Следующая смена будет доступна через 14 дней.';
            profileModal.classList.remove('hidden');
        });
        document.getElementById('btnCloseProfile')?.addEventListener('click', () => profileModal.classList.add('hidden'));
        document.getElementById('btnRemoveAvatar')?.addEventListener('click', () => {
            const button = document.getElementById('btnRemoveAvatar');
            button.dataset.remove = button.dataset.remove === 'true' ? 'false' : 'true';
            const preview = document.getElementById('profileEditAvatarPreview');
            if (button.dataset.remove === 'true') {
                const name = document.getElementById('profileNameInput').value.trim() || 'V';
                preview.innerHTML = `<span class="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600">${escapeHTML(name.slice(0,1).toUpperCase())}</span>`;
                button.innerHTML = '<i class="fa-solid fa-rotate-left mr-1"></i> Оставить фото';
                button.classList.add('border-rose-500/50','text-rose-200');
            } else {
                preview.innerHTML = avatarMarkup(state.userProfile || {}, 'h-14 w-14');
                button.innerHTML = '<i class="fa-regular fa-trash-can mr-1"></i> Удалить аватар';
                button.classList.remove('border-rose-500/50','text-rose-200');
            }
        });
        document.getElementById('profileAvatarFile')?.addEventListener('change', () => {
            const button = document.getElementById('btnRemoveAvatar'); if (button) button.dataset.remove = 'false';
            const file = document.getElementById('profileAvatarFile')?.files?.[0];
            if (!file || !file.type.startsWith('image/')) return;
            const preview = document.getElementById('profileEditAvatarPreview');
            if (preview) { const url = URL.createObjectURL(file); preview.innerHTML = `<img src="${url}" alt="Предпросмотр аватара" class="h-14 w-14 rounded-full object-cover" onload="URL.revokeObjectURL(this.src)">`; }
        });
        document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
            if (!state.user) return;
            const displayName = document.getElementById('profileNameInput').value.trim().slice(0,30);
            const bio = document.getElementById('profileBioInput').value.trim().slice(0,160);
            const file = document.getElementById('profileAvatarFile')?.files?.[0];
            let photoURL = state.userProfile?.photoURL || state.user?.photoURL || '';
            const username = normalizeUsername(document.getElementById('profileUsernameInput').value.replace(/^@/,''));
            if (displayName.length < 1) { alert('Укажи отображаемое имя.'); return; }
            if (!/^[a-z0-9_]{3,24}$/.test(username)) { alert('@nickname: 3–24 символа, латинские буквы, цифры и _.'); return; }
            if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5*1024*1024)) { alert('Выбери JPG, PNG или WebP размером до 5 МБ.'); return; }
            const oldUsername = state.userProfile?.username || '';
            const changedAt = Number(state.userProfile?.usernameChangedAt || 0);
            const changing = oldUsername !== username;
            if (changing && oldUsername && Date.now()-changedAt < 14*86400000) {
                const days = Math.ceil((14*86400000-(Date.now()-changedAt))/86400000);
                alert(`Менять @nickname можно раз в 14 дней. Осталось ${days} дн.`); return;
            }
            try {
                const usernameRef = doc(db,'usernames',username);
                const usernameSnap = await getDoc(usernameRef);
                if (usernameSnap.exists() && usernameSnap.data().uid !== state.user.uid) { alert('Этот @nickname уже занят.'); return; }
                if (file) photoURL = await uploadAvatarToCloudinary(await compressAvatar(file));
                if (document.getElementById('btnRemoveAvatar')?.dataset.remove === 'true') photoURL = '';
                await setDoc(usernameRef,{uid:state.user.uid,username,updatedAt:Date.now()});
                const updated = {displayName,username,bio,photoURL,usernameChangedAt:changing?Date.now():changedAt,updatedAt:Date.now(),createdAt:state.userProfile?.createdAt||Date.now()};
                await setDoc(doc(db,'users',state.user.uid),updated,{merge:true});
                if (oldUsername && oldUsername!==username) {
                    const oldRef=doc(db,'usernames',oldUsername), oldSnap=await getDoc(oldRef);
                    if (oldSnap.exists() && oldSnap.data().uid===state.user.uid) await deleteDoc(oldRef);
                }
                try { await updateProfile(state.user,{displayName,photoURL:photoURL||null}); } catch(e) { console.warn('Auth profile sync:',e); }
                state.userProfile={...(state.userProfile||{}),...updated}; document.getElementById('profileAvatarFile').value='';
                const removeAvatarButton = document.getElementById('btnRemoveAvatar'); if (removeAvatarButton) removeAvatarButton.dataset.remove = 'false';
                applyProfileToUI(); renderSocialProfile(); profileModal.classList.add('hidden');
            } catch(err) { console.error('Profile save failed:',err); alert(err.code==='permission-denied'?'Firestore запретил сохранение. Проверь опубликованные Rules.':'Не удалось сохранить профиль.'); }
        });

        async function performSignOut() {
            if (state.isSearching || state.isConnected) pauseSearch();
            if (state.peer) { if (state.myPeerId && state.user) deleteDoc(doc(db, 'peerSessions', state.myPeerId)).catch(() => {}); state.peer.destroy(); state.peer = null; state.myPeerId = null; }
            if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
            profileModal.classList.add('hidden');
            await signOut(auth);
        }
        document.getElementById('btnSignOut')?.addEventListener('click', performSignOut);
        document.getElementById('socialSignOut')?.addEventListener('click', performSignOut);

        // Step 1: Selection
        document.querySelectorAll('.btn-age').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ageGroup = btn.getAttribute('data-age');
                if (!state.user) { document.getElementById('authOverlay')?.classList.remove('hidden'); return; }
                state.selectedAge = ageGroup;
                selectedCategoryBadge.textContent = ageGroup;

                const success = await initAudioStream();
                if (success) {
                    screenAgeSelect.classList.add('hidden');
                    screenChat.classList.remove('hidden');
                    btnExitMenu.classList.remove('hidden');
                    initPeerJS();
                }
            });
        });

        async function initAudioStream() {
            const errorAlert = document.getElementById('errorAlert');
            const errorAlertText = document.getElementById('errorAlertText');
            if (errorAlert) errorAlert.classList.add('hidden');

            try {
                if (state.audioContext && state.audioContext.state === 'suspended') {
                    await state.audioContext.resume();
                }

                if (state.localStream) return true;

                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error("Ваш браузер или соединение (не HTTPS) блокирует доступ к микрофону!");
                }

                try {
                    state.localStream = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                        video: false
                    });
                } catch (fallbackErr) {
                    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                }

                setupMicVisualizer(state.localStream);
                return true;
            } catch (err) {
                console.error("Mic access error:", err);
                if (errorAlert && errorAlertText) {
                    const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.code === 'permission-denied';
                    errorAlertText.textContent = denied
                        ? 'Доступ к микрофону не разрешён. Нажми «Повторить запрос». Если браузер уже заблокировал доступ, открой настройки сайта рядом с адресной строкой и разреши микрофон.'
                        : (err?.name === 'NotFoundError' ? 'Микрофон не найден. Подключи устройство и нажми «Повторить запрос».' : err?.name === 'NotReadableError' ? 'Микрофон занят другим приложением. Закрой его и попробуй снова.' : (err.message || 'Не удалось включить микрофон.'));
                    errorAlert.classList.remove('hidden');
                    let retry = document.getElementById('retryMicPermission');
                    if (!retry) {
                        retry = document.createElement('button'); retry.id = 'retryMicPermission'; retry.type = 'button';
                        retry.className = 'mt-3 rounded-xl bg-rose-500/20 px-4 py-2 font-semibold text-rose-100 ring-1 ring-rose-300/30 hover:bg-rose-500/30';
                        retry.textContent = 'Повторить запрос'; errorAlert.appendChild(retry);
                        retry.addEventListener('click', async () => { retry.disabled = true; retry.textContent = 'Запрашиваем доступ…'; const ok = await initAudioStream(); retry.disabled = false; retry.textContent = 'Повторить запрос'; if (ok) { errorAlert.classList.add('hidden'); screenAgeSelect.classList.add('hidden'); screenChat.classList.remove('hidden'); btnExitMenu.classList.remove('hidden'); initPeerJS(); } });
                    }
                }
                return false;
            }
        }

        function setupMicVisualizer(stream) {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioContext();
                const source = state.audioContext.createMediaStreamSource(stream);
                state.analyser = state.audioContext.createAnalyser();
                state.analyser.fftSize = 64;
                source.connect(state.analyser);

                const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

                const updateMeter = () => {
                    if (!state.analyser || state.isMicMuted) {
                        micLevelBar.style.width = '0%';
                    } else {
                        state.analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        let avg = sum / dataArray.length;
                        let pct = Math.min(100, Math.round((avg / 128) * 100));
                        micLevelBar.style.width = pct + '%';
                    }
                    requestAnimationFrame(updateMeter);
                };
                updateMeter();
            } catch (e) {}
        }

        // Initialize WebRTC Peer
        function initPeerJS() {
            // Do not leave an older Peer instance alive if the user re-enters roulette.
            if (state.peer) {
                try { state.peer.destroy(); } catch (_) {}
                state.peer = null;
                state.myPeerId = null;
            }
            setPeerStatus('connecting', 'Сеть...');
            const safeAgeTag = state.selectedAge.replace('+', 'plus');
            const randomID = 'vr-' + safeAgeTag + '-' + Math.floor(100000 + Math.random() * 900000);

            state.peer = new Peer(randomID, {
                debug: 1,
                pingInterval: 5000,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ],
                    iceCandidatePoolSize: 4
                }
            });

            state.peer.on('open', (id) => {
                state.myPeerId = id;
                if (state.user) setDoc(doc(db, 'peerSessions', id), { peerId:id, ownerUid:state.user.uid, updatedAt:Date.now() }).catch(e => console.warn('Peer session registration failed:', e));
                setPeerStatus('ready', 'Готов к поиску');
            });

            state.peer.on('call', (call) => {
                if (state.isConnected || state.isPaused || !state.localStream) {
                    call.close();
                    return;
                }
                // Register media handlers BEFORE answering or awaiting Firestore. A fast
                // connection can emit `stream` while an async UID lookup is still running.
                state.currentCall = call;
                state.connectingTo = call.peer;
                call.on('stream', (remoteStream) => {
                    state.connectingTo = null;
                    state.currentCall = call;
                    handleConnectedStream(remoteStream);
                });
                call.on('close', handleDisconnect);
                call.on('error', (err) => {
                    console.error('Incoming call failed:', err);
                    handleDisconnect();
                });
                call.answer(state.localStream);
                removeFromMatchmakingQueue();

                // Resolve the account UID in parallel with media negotiation.
                (async () => {
                    try {
                        const sessionSnap = await getDoc(doc(db, 'peerSessions', call.peer));
                        if (sessionSnap.exists()) state.currentMatchUid = sessionSnap.data().ownerUid || null;
                        const qName = state.selectedAge ? `queue_${state.selectedAge.replace('+', 'plus')}` : '';
                        if (!state.currentMatchUid && qName) {
                            const qSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', qName));
                            qSnap.forEach((d) => { const item=d.data(); if (item.peerId === call.peer) state.currentMatchUid = item.ownerUid || null; });
                        }
                    } catch (e) { console.warn('Could not resolve matched user UID:', e); }
                })();
            });

            state.peer.on('disconnected', () => {
                setPeerStatus('error', 'Восстанавливаем соединение…');
                if (state.peerReconnectTimer) clearTimeout(state.peerReconnectTimer);
                state.peerReconnectTimer = setTimeout(() => {
                    if (state.peer && !state.peer.destroyed && state.peer.disconnected) {
                        try { state.peer.reconnect(); } catch (e) { console.warn('Peer reconnect failed:', e); }
                    }
                }, 1200);
            });
            state.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                setPeerStatus('error', err?.type === 'network' ? 'Проблема сети' : 'Ошибка P2P');
                if (['network','socket-error','socket-closed'].includes(err?.type) && state.peer && !state.peer.destroyed) {
                    if (state.peerReconnectTimer) clearTimeout(state.peerReconnectTimer);
                    state.peerReconnectTimer = setTimeout(() => { try { state.peer?.reconnect(); } catch (_) {} }, 1800);
                }
            });
        }

        function setPeerStatus(type, text) {
            peerStatusText.textContent = text;
            if (type === 'ready') peerStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
            else if (type === 'connecting') peerStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
            else peerStatusDot.className = 'w-2 h-2 rounded-full bg-red-500';
        }

        // --- Realtime Firebase Matchmaker ---
        async function startSearch() {
            if (!state.peer || !state.myPeerId || state.isConnected || state.isSearching || state.searchStarting) return;
            state.searchStarting = true;
            if (btnStartSearch) { btnStartSearch.disabled = true; btnStartSearch.setAttribute('aria-busy','true'); }

            try {
                if (!state.user) await authReady;
                if (!state.user) throw new Error('Не удалось войти в Firebase. Обновите страницу.');

                state.isSearching = true;
                state.isPaused = false;
                state.connectingTo = null;
                state.currentMatchUid = null;
                updateUI();

                setAvatarState('searching');
                chatStatusTitle.textContent = 'Поиск собеседника...';
                chatStatusDesc.textContent = `Ищем пользователей в группе ${state.selectedAge}`;

                const queueName = `queue_${state.selectedAge.replace('+', 'plus')}`;
                const queueColPath = collection(db, 'artifacts', appId, 'public', 'data', queueName);
                const myQueueDoc = doc(queueColPath, state.myPeerId);

                await setDoc(myQueueDoc, {
                    peerId: state.myPeerId,
                    ownerUid: state.user.uid,
                    timestamp: Date.now()
                });

                if (state.queueUnsub) state.queueUnsub();
                state.queueUnsub = onSnapshot(queueColPath, (snapshot) => {
                    if (!state.isSearching || state.isConnected || state.connectingTo) return;

                    const now = Date.now();
                    const candidates = [];
                    snapshot.forEach((docSnap) => {
                        const data = docSnap.data();
                        if (data.peerId === state.myPeerId) return;
                        if (!data.peerId || typeof data.timestamp !== 'number') return;
                        // Ignore abandoned queue entries.
                        if (now - data.timestamp > 60000) return;
                        candidates.push({ peerId: data.peerId, ownerUid: data.ownerUid || null });
                    });

                    candidates.sort((a, b) => a.peerId.localeCompare(b.peerId));
                    // Only one side initiates the call to avoid duplicate calls.
                    const target = candidates.find((item) => state.myPeerId < item.peerId);
                    if (target) { state.currentMatchUid = target.ownerUid; connectToPeer(target.peerId); }
                }, (err) => {
                    console.error('Firestore matchmaking listener failed:', err);
                    state.isSearching = false;
                    updateUI();
                    setAvatarState('idle');
                    chatStatusTitle.textContent = 'Не удалось начать поиск';
                    chatStatusDesc.textContent = err.code === 'permission-denied'
                        ? 'Firebase Firestore запрещает доступ к очереди. Проверьте правила безопасности.'
                        : 'Ошибка подключения к очереди. Откройте консоль браузера для подробностей.';
                });
            } catch (err) {
                console.error('Start search failed:', err);
                state.isSearching = false;
                updateUI();
                setAvatarState('idle');
                chatStatusTitle.textContent = 'Ошибка поиска';
                chatStatusDesc.textContent = err.code === 'permission-denied'
                    ? 'Firestore запрещает доступ. Проверьте правила Firestore.'
                    : (err.message || 'Не удалось подключиться к поиску. Проверьте интернет и Firebase.');
            } finally {
                state.searchStarting = false;
                if (btnStartSearch) { btnStartSearch.disabled = false; btnStartSearch.removeAttribute('aria-busy'); }
            }
        }

        function connectToPeer(targetPeerId) {
            if (!state.peer || !state.localStream || state.connectingTo || state.isConnected) return;
            state.connectingTo = targetPeerId;

            const call = state.peer.call(targetPeerId, state.localStream);
            if (!call) {
                state.connectingTo = null;
                return;
            }
            state.currentCall = call;
            let connected = false;

            call.on('stream', (remoteStream) => {
                connected = true;
                state.connectingTo = null;
                state.currentCall = call;
                removeFromMatchmakingQueue();
                handleConnectedStream(remoteStream);
            });

            call.on('close', () => {
                if (!connected) state.connectingTo = null;
                handleDisconnect();
            });
            call.on('error', (err) => {
                console.error('Outgoing call failed:', err);
                if (!connected) state.connectingTo = null;
                handleDisconnect();
            });

            // Give WebRTC time to negotiate on slower mobile connections.
            setTimeout(() => {
                if (!connected && state.connectingTo === targetPeerId) {
                    state.connectingTo = null;
                    try { call.close(); } catch (e) {}
                }
            }, 15000);
        }

        async function removeFromMatchmakingQueue() {
            state.isSearching = false;
            if (state.queueUnsub) {
                state.queueUnsub();
                state.queueUnsub = null;
            }
            if (state.myPeerId && state.selectedAge && state.user) {
                try {
                    const queueName = `queue_${state.selectedAge.replace('+', 'plus')}`;
                    const myQueueDoc = doc(db, 'artifacts', appId, 'public', 'data', queueName, state.myPeerId);
                    await deleteDoc(myQueueDoc);
                } catch (e) {
                    console.warn('Could not remove queue entry:', e);
                }
            }
        }

        function handleConnectedStream(remoteStream) {
            state.isConnected = true;
            state.isSearching = false;
            updateUI();

            remoteAudio.autoplay = true;
            remoteAudio.playsInline = true;
            remoteAudio.muted = false;
            remoteAudio.srcObject = remoteStream;
            // iOS Safari may block autoplay until the user taps the page.
            const tryPlayRemoteAudio = () => remoteAudio.play().then(() => {
                const unlock = document.getElementById('vvAudioUnlock');
                if (unlock) unlock.remove();
            }).catch(err => {
                console.warn('Remote audio playback requires a user gesture:', err);
                let unlock = document.getElementById('vvAudioUnlock');
                if (!unlock) {
                    unlock = document.createElement('button');
                    unlock.id = 'vvAudioUnlock';
                    unlock.type = 'button';
                    unlock.textContent = '🔊 Включить звук собеседника';
                    unlock.className = 'fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-violet-300/30 bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-xl';
                    unlock.addEventListener('click', () => {
                        remoteAudio.muted = false;
                        tryPlayRemoteAudio();
                    });
                    document.body.appendChild(unlock);
                }
            });
            remoteStream.getAudioTracks().forEach(track => {
                track.enabled = true;
                track.onunmute = tryPlayRemoteAudio;
            });
            tryPlayRemoteAudio();

            setAvatarState('connected');
            chatStatusTitle.textContent = "Собеседник подключен!";
            chatStatusDesc.textContent = "Вы в эфире. Говорите в микрофон.";
        }

        function handleDisconnect() {
            if (state.isHandlingDisconnect) return;
            state.isHandlingDisconnect = true;
            const oldCall = state.currentCall;
            state.currentCall = null;
            state.connectingTo = null;
            if (oldCall) {
                try { oldCall.close(); } catch (e) {}
            }
            remoteAudio.srcObject = null;
            state.isConnected = false;

            if (!state.isPaused && !state.isSearching) {
                setAvatarState('idle');
                chatStatusTitle.textContent = "Разговор завершён";
                chatStatusDesc.textContent = "Собеседник вышел. Нажмите 'Искать' для следующего.";
            }
            updateUI();
            state.isHandlingDisconnect = false;
        }

        // Actions
        async function skipPeer() {
            await removeFromMatchmakingQueue();
            handleDisconnect();
            state.isPaused = false;
            await startSearch();
        }

        function pauseSearch() {
            removeFromMatchmakingQueue();
            if (state.currentCall) {
                state.currentCall.close();
                state.currentCall = null;
            }
            state.isConnected = false;
            state.isSearching = false;
            state.isPaused = true;

            setAvatarState('paused');
            chatStatusTitle.textContent = "На паузе";
            chatStatusDesc.textContent = "Поиск остановлен.";
            updateUI();
        }

        function toggleMicrophone() {
            if (!state.localStream) return;
            const audioTrack = state.localStream.getAudioTracks()[0];
            if (audioTrack) {
                state.isMicMuted = !state.isMicMuted;
                audioTrack.enabled = !state.isMicMuted;

                if (state.isMicMuted) {
                    micBtnIcon.className = "fa-solid fa-microphone-slash text-red-500";
                    micBtnText.textContent = "Микрофон выкл";
                    btnToggleMic.classList.add('border-red-500/40', 'bg-red-500/10');
                } else {
                    micBtnIcon.className = "fa-solid fa-microphone text-emerald-400";
                    micBtnText.textContent = "Микрофон вкл";
                    btnToggleMic.classList.remove('border-red-500/40', 'bg-red-500/10');
                }
            }
        }

        function exitToMenu() {
            pauseSearch();

            if (state.peer) {
                if (state.myPeerId && state.user) deleteDoc(doc(db, 'peerSessions', state.myPeerId)).catch(() => {});
                state.peer.destroy();
                state.peer = null;
            }

            if (state.localStream) {
                state.localStream.getTracks().forEach(t => t.stop());
                state.localStream = null;
            }

            state.selectedAge = null;
            state.isPaused = false;

            screenChat.classList.add('hidden');
            btnExitMenu.classList.add('hidden');
            screenAgeSelect.classList.remove('hidden');
        }

        function setAvatarState(mode) {
            avatarCircle.className = "w-36 h-36 rounded-full bg-slate-900 border-2 border-slate-800 flex items-center justify-center text-4xl text-slate-600 transition-all duration-500";
            avatarIcon.className = "fa-solid fa-user-large";

            if (mode === 'searching') {
                avatarCircle.className = "w-36 h-36 rounded-full bg-brand-600/20 border-2 border-brand-500 text-brand-400 flex items-center justify-center text-4xl pulse-ring transition-all duration-500";
                avatarIcon.className = "fa-solid fa-spinner animate-spin text-brand-400";
            } else if (mode === 'connected') {
                avatarCircle.className = "w-36 h-36 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center text-5xl shadow-2xl shadow-emerald-500/30 transition-all duration-500";
                avatarIcon.className = "fa-solid fa-volume-high animate-bounce";
            } else if (mode === 'paused') {
                avatarCircle.className = "w-36 h-36 rounded-full bg-amber-500/10 border-2 border-amber-500/40 text-amber-400 flex items-center justify-center text-4xl transition-all duration-500";
                avatarIcon.className = "fa-solid fa-pause";
            }
        }

        function updateUI() {
            btnStartSearch.disabled = state.isSearching || state.isConnected;
            btnSkip.disabled = !state.isSearching && !state.isConnected;
            btnPause.disabled = !state.isSearching && !state.isConnected;

            if (state.isSearching || state.isConnected) {
                btnStartSearch.classList.add('opacity-40');
            } else {
                btnStartSearch.classList.remove('opacity-40');
            }
        }

        // --- Social network: unique nicknames, friends, chats, and Snake challenges ---
        const socialScreen = document.getElementById('socialScreen');
        const socialProfilePanel = document.getElementById('socialProfilePanel');
        const socialChatsPanel = document.getElementById('socialChatsPanel');
        const socialSearchPanel = document.getElementById('socialSearchPanel');
        let currentTab = 'roulette';
        let activeFriend = null;
        let activeConversationId = null;
        let friendRequestsCache = [];
        let friendsCache = [];
        let groupsCache = [];
        let activeGroupId = null;
        // Roles are read from a protected Firestore collection, never from editable user profiles.
        const roleCache = new Map();
        let premiumExpiryTimer = null;
        async function loadRole(uid) {
            uid = String(uid || '');
            if (!uid) return 'user';
            if (uid === DEVELOPER_UID) { roleCache.set(uid, 'developer'); return 'developer'; }
            if (roleCache.has(uid)) return roleCache.get(uid);
            let role = 'user';
            try {
                const snap = await getDoc(doc(db, 'roles', uid));
                const value = snap.exists() ? snap.data().role : '';
                if (value === 'developer' || value === 'admin') role = value;
            } catch (error) {
                console.warn('Role lookup failed:', error);
            }
            roleCache.set(uid, role);
            return role;
        }
        function roleBadgeMarkup(uid) {
            const role = roleCache.get(String(uid || '')) || 'user';
            if (role !== 'developer' && role !== 'admin') return '';
            const color = role === 'developer' ? '#fbbf24' : '#60a5fa';
            const label = role === 'developer' ? 'Разработчик' : 'Администратор';
            // Inline SVG, deliberately not an emoji.
            return `<svg class="vv-role-star" viewBox="0 0 24 24" width="15" height="15" aria-label="${label}" title="${label}" role="img" style="color:${color};filter:drop-shadow(0 0 3px ${color}55)"><path fill="currentColor" d="M12 1.8l2.95 6 6.62.96-4.79 4.67 1.13 6.59L12 16.91l-5.91 3.11 1.13-6.59-4.79-4.67 6.62-.96L12 1.8z"/></svg>`;
        }
        async function preloadRoles(items, key = 'uid') {
            await Promise.all((items || []).map(item => loadRole(item?.[key] || item?.uid || item?.id || item?.fromUid)));
        }

        async function compressAvatar(file) {
            const bitmap = await createImageBitmap(file);
            const maxSide = 512;
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const ctx = canvas.getContext('2d', { alpha:false });
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
            return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось обработать изображение')), 'image/jpeg', 0.82));
        }

        // Cloudinary unsigned upload: never put an API secret in browser code.
        const CLOUDINARY_CLOUD_NAME = 'yvoqyrj8';
        const CLOUDINARY_UPLOAD_PRESET = 'voicevibe_upload';
        async function uploadAvatarToCloudinary(blob) {
            const formData = new FormData();
            formData.append('file', blob, 'voicevibe-avatar.jpg');
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.secure_url) {
                console.error('Cloudinary upload failed:', result);
                throw new Error(result.error?.message || `Cloudinary upload failed (${response.status})`);
            }
            return result.secure_url;
        }

        // All user image assets are stored in Cloudinary; Firebase Storage is not used.
        async function uploadImageToCloudinary(file, folder) {
            if (!file || !file.type?.startsWith('image/')) throw new Error('Выбери файл изображения.');
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
            formData.append('folder', `voicevibe/${folder}`);
            const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.secure_url) {
                console.error('Cloudinary image upload failed:', result);
                throw new Error(result.error?.message || `Cloudinary upload failed (${response.status})`);
            }
            return result.secure_url;
        }

        function normalizeUsername(value) { return value.trim().toLowerCase(); }
        function escapeHTML(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function avatarMarkup(profile, size='h-10 w-10') {
            const label = escapeHTML((profile?.displayName || profile?.username || '?').slice(0,1).toUpperCase());
            const src = profile?.photoURL;
            const uid = profile?.uid || profile?.fromUid || profile?.id || '';
            const inner = src ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" class="${size} rounded-full object-cover">` : `<span class="${size} flex items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 font-bold text-white">${label}</span>`;
            if (!uid) return inner;
            const storyState = getStoryRingState(uid);
            return `<span class="vv-avatar-story-wrap ${storyState ? `has-story ${storyState}` : ''}" data-story-avatar="${escapeHTML(uid)}" role="button" tabindex="0" aria-label="${storyState ? 'Открыть историю' : 'Аватар'}">${inner}</span>`;
        }
        function renderSocialProfile() {
            if (!state.user) return;
            const rolePanel = document.getElementById('roleManagementPanel');
            const roleToggle = document.getElementById('roleManagementToggle');
            const isDeveloper = state.user.uid === DEVELOPER_UID;
            if (roleToggle) roleToggle.classList.toggle('hidden', !isDeveloper);
            if (rolePanel && !isDeveloper) rolePanel.classList.add('hidden');
            const p = state.userProfile || {};
            document.getElementById('socialAvatar').innerHTML = avatarMarkup({ ...p, uid: state.user.uid }, 'h-20 w-20');
            const socialName = document.getElementById('socialName');
            const ownUid = state.user.uid;
            const ownPremium = Number(p.premiumUntil || 0) > Date.now(); socialName.classList.toggle('vv-premium-name', ownPremium); socialName.innerHTML = `${escapeHTML(p.displayName || 'Настрой профиль')}${ownPremium ? ' 👑' : ''} ${roleBadgeMarkup(ownUid)}`;
            if (premiumExpiryTimer) clearTimeout(premiumExpiryTimer); if (Number(p.premiumUntil || 0) > Date.now()) premiumExpiryTimer = setTimeout(() => renderSocialProfile(), Math.min(2147483000, Number(p.premiumUntil) - Date.now() + 1000));
            if (!roleCache.has(ownUid)) loadRole(ownUid).then(() => {
                if (state.user?.uid === ownUid) renderSocialProfile();
            });
            document.getElementById('socialHandle').textContent = p.username ? '@' + p.username : 'Выбери уникальный никнейм';
            document.getElementById('socialBio').textContent = p.bio || 'Добавь короткое описание о себе.';
            const count = friendsCache.length;
            const countText = count === 1 ? '1 друг' : (count >= 2 && count <= 4 ? `${count} друга` : `${count} друзей`);
            const countEl = document.getElementById('socialFriendCount'); if (countEl) countEl.textContent = countText;
            const balanceEl = document.getElementById('vibecoinBalance'); if (balanceEl) balanceEl.textContent = String(Math.max(0, Number(p.vibecoinBalance || 0)));
            const premiumBadge = document.getElementById('premiumStatusBadge'); const premium = Number(p.premiumUntil || 0) > Date.now(); if (premiumBadge) premiumBadge.classList.toggle('hidden', !premium);
            // Hide Premium-only controls from non-Premium accounts; keep the purchase button visible.
            ['profileBannerFile','uploadProfileBannerBtn'].forEach(id => { const el=document.getElementById(id); if (!el) return; const wrapper=el.closest('[data-premium-only]') || el; if (wrapper && id !== 'buyPremiumBtn') wrapper.classList.toggle('hidden', !premium); });
            document.querySelectorAll('[data-premium-only]').forEach(el => el.classList.toggle('hidden', !premium));
            const banner = document.getElementById('socialProfileBanner'); if (banner) { banner.style.backgroundImage = p.bannerURL ? `linear-gradient(90deg,rgba(15,23,42,.08),rgba(15,23,42,.1)),url("${String(p.bannerURL).replace(/["\\]/g,'')}")` : ''; banner.classList.toggle('hidden', !p.bannerURL); }
        }
        function showTab(tab) {
            currentTab = tab;
            if (tab === 'chats' && activeFriend) {
                localStorage.setItem(unreadStorageKey(activeFriend), String(Date.now()));
                state.unreadCounts.set(activeFriend, 0); updateUnreadBadge(); renderChatFriends();
            }
            const roulette = tab === 'roulette';
            const chatsTab = tab === 'chats';
            screenAgeSelect.classList.toggle('hidden', !roulette || !!state.selectedAge);
            screenChat.classList.toggle('hidden', !roulette || !state.selectedAge);
            socialScreen.classList.toggle('hidden', roulette);
            socialScreen.classList.toggle('chat-tab-active', chatsTab);
            socialProfilePanel.classList.toggle('hidden', tab !== 'profile');
            socialChatsPanel.classList.toggle('hidden', !chatsTab);
            socialSearchPanel?.classList.toggle('hidden', tab !== 'search');
            if (tab !== 'chats') { socialChatsPanel.classList.remove('chat-open'); }
            document.querySelectorAll('.nav-tab').forEach(b => {
                const selected = b.dataset.tab === tab;
                b.classList.toggle('text-violet-300', selected);
                b.classList.toggle('text-slate-400', !selected);
                b.classList.toggle('bg-violet-500/10', selected);
            });
            if (tab === 'profile') renderSocialProfile();
            if (chatsTab) renderChatFriends();
        }
        document.querySelectorAll('.nav-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

        // Stories: 24-hour photo/video stories, optional audio, reactions, views and replies.
        const storiesModal = document.getElementById('storiesModal');
        const storiesList = document.getElementById('storiesList');
        const storyCreateForm = document.getElementById('storyCreateForm');
        const storyTextInput = document.getElementById('storyText');
        const storyImageInput = document.getElementById('storyImage');
        const storyVideoInput = document.getElementById('storyVideo');
        const storyMusicInput = document.getElementById('storyMusic');
        const storyStatus = document.getElementById('storyCreateStatus');
        const storyPublishBtn = document.getElementById('storyPublishBtn');
        let activeStoryItems = [];
        let activeStoryIndex = 0;
        function getStoryRingState(uid) {
            const items = activeStoryItems.filter(st => st.uid === uid && Number(st.expiresAt) > Date.now());
            if (!items.length) return '';
            const viewed = items.every(st => (st.views || []).some(v => (typeof v === 'string' ? v : v?.uid) === state.user?.uid));
            return viewed ? 'story-viewed' : 'story-unviewed';
        }
        function setCurrentStoryAvatar(uid='') { document.querySelectorAll('[data-story-avatar]').forEach(el => el.classList.toggle('story-currently-open', !!uid && el.dataset.storyAvatar === uid)); }
        function refreshAvatarStoryRings() {
            document.querySelectorAll('[data-story-avatar]').forEach(el => {
                const uid = el.dataset.storyAvatar;
                const ring = getStoryRingState(uid);
                el.classList.toggle('has-story', !!ring);
                el.classList.toggle('story-unviewed', ring === 'story-unviewed');
                el.classList.toggle('story-viewed', ring === 'story-viewed');
            });
        }
        function storyEscape(value) { return escapeHTML(String(value || '')); }
        function storyAvatar(st, ringState = 'story-unviewed') {
            const inner = st.photoURL ? `<img src="${storyEscape(st.photoURL)}" alt="" class="h-full w-full rounded-full object-cover"/>` : `<span>${storyEscape((st.displayName || 'П')[0])}</span>`;
            return `<span class="story-avatar-ring ${ringState}">${inner}</span>`;
        }
        // Stories use the same existing unsigned Cloudinary preset as other uploads.
        const CLOUDINARY_STORIES_UPLOAD_PRESET = CLOUDINARY_UPLOAD_PRESET;
        async function uploadStoryMedia(file, kind) {
            if (!file) return '';
            const max = kind === 'video' ? 25 * 1024 * 1024 : 12 * 1024 * 1024;
            const sizeLabel = kind === 'video' ? 'Видео' : kind === 'audio' ? 'Аудио' : 'Фото';
            if (file.size > max) throw new Error(`${sizeLabel} должно быть не больше ${kind === 'video' ? '25' : '12'} МБ.`);
            const resourceType = kind === 'image' ? 'image' : 'video'; // Cloudinary stores audio under video resource type.
            const formData = new FormData();
            formData.append('file', file, String(file.name || `voicevibe-story.${kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'mp3'}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100));
            formData.append('upload_preset', CLOUDINARY_STORIES_UPLOAD_PRESET);
            formData.append('folder', `voicevibe/stories/${state.user.uid}`);
            const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.secure_url) {
                console.error('Cloudinary story upload failed:', result);
                throw new Error(result.error?.message || `Не удалось загрузить ${kind === 'image' ? 'фото' : kind === 'video' ? 'видео' : 'музыку'} в Cloudinary (${response.status}). Проверь unsigned preset voicevibe_upload и разрешённые типы файлов.`);
            }
            return result.secure_url;
        }
        let storyAdvanceTimer = null;
        function stopStoryMedia() {
            const viewer = document.getElementById('storyViewer');
            viewer?.querySelectorAll('audio, video').forEach(media => {
                try { media.pause(); media.currentTime = 0; media.removeAttribute('src'); media.load(); } catch (_) {}
            });
        }
        function closeStoryViewer() {
            clearTimeout(storyAdvanceTimer);
            stopStoryMedia();
            document.getElementById('storyViewer')?.classList.add('hidden');
            setCurrentStoryAvatar('');
        }
        function renderStoryViewer() {
            clearTimeout(storyAdvanceTimer);
            stopStoryMedia();
            const st = activeStoryItems[activeStoryIndex];
            const viewer = document.getElementById('storyViewer');
            if (!st || !viewer) return;
            const media = st.mediaType === 'video' && st.mediaURL
                ? `<video src="${storyEscape(st.mediaURL)}" class="absolute inset-0 h-full w-full object-contain bg-transparent" autoplay playsinline controls preload="metadata"></video>`
                : st.mediaURL ? `<img src="${storyEscape(st.mediaURL)}" alt="История" decoding="async" fetchpriority="high" class="absolute inset-0 h-full w-full object-contain"/>` : '';
            const liked = Array.isArray(st.likes) && st.likes.includes(state.user.uid);
            const views = Array.isArray(st.views) ? st.views : [];
            const isOwnStory = st.uid === state.user?.uid;
            setCurrentStoryAvatar(st.uid);
            const viewNames = views.map(v => typeof v === 'string' ? v : (v.displayName || v.username || 'Пользователь'));
            const music = st.musicURL ? `<audio src="${storyEscape(st.musicURL)}" autoplay loop playsinline class="hidden" aria-hidden="true"></audio>` : '';
            const ownerStats = isOwnStory ? `<button id="storyViewersBtn" class="rounded-full bg-white/15 px-3 py-2 text-xs"><i class="fa-regular fa-eye mr-1"></i>${views.length} просмотров</button>` : '';
            const likeCount = isOwnStory ? `<span class="text-sm">${Array.isArray(st.likes)?st.likes.length:0}</span>` : '';
            const viewersList = isOwnStory ? `<div id="storyViewersList" class="hidden mt-2 max-h-24 overflow-y-auto rounded-xl bg-black/50 p-2 text-xs">${viewNames.map(storyEscape).join('<br>') || 'Пока никто не посмотрел.'}</div>` : '';
            viewer.innerHTML = `<div class="relative flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-gradient-to-br from-rose-100 via-violet-100 to-sky-100 text-slate-800">
                ${media}<div class="story-top-gradient absolute inset-x-0 top-0 z-20 p-4 sm:p-6"><div class="mb-3 h-1 overflow-hidden rounded-full bg-slate-800/10"><div class="h-full w-full bg-violet-500"></div></div><div class="flex items-center gap-2">${storyAvatar(st)}<div class="min-w-0 flex-1"><button type="button" id="storyOwnerProfile" class="block max-w-full truncate text-left text-sm font-bold hover:text-violet-200">${storyEscape(st.displayName || 'Пользователь')}</button><small class="text-slate-500">${Math.max(1,Math.ceil((Number(st.expiresAt)-Date.now())/3600000))} ч. осталось</small></div><button id="storyViewerClose" class="rounded-full border border-white/80 bg-white/80 px-3 py-2 text-slate-700 shadow-lg backdrop-blur-xl" aria-label="Закрыть">✕</button></div></div>
                <button id="storyPrev" class="absolute inset-y-24 left-0 z-10 w-1/5" aria-label="Предыдущая история"></button><button id="storyNext" class="absolute inset-y-24 right-0 z-10 w-1/5" aria-label="Следующая история"></button>
                ${st.text ? `<div class="story-centered-text absolute inset-0 z-10 flex items-center justify-center px-6 py-24 sm:px-12 pointer-events-none"><div class="story-text-card mx-auto max-w-2xl whitespace-pre-wrap break-words text-center"><span class="story-text-card-label"><i class="fa-solid fa-sparkles mr-1"></i>История</span><p>${storyEscape(st.text)}</p></div></div>` : ''}
                <div class="story-bottom-gradient absolute inset-x-0 bottom-0 z-20 p-4 sm:p-6">${music}<div class="mt-3 flex items-center justify-between gap-3">${ownerStats}<button id="storyLikeBtn" class="rounded-full bg-white/15 px-4 py-2 text-lg ${liked?'text-rose-400':''}" aria-label="Нравится"><i class="fa-${liked?'solid':'regular'} fa-heart"></i> ${likeCount}</button></div><form id="storyReplyForm" class="mt-3 flex gap-2"><input id="storyReplyInput" maxlength="300" placeholder="Написать что-то пользователю…" class="min-w-0 flex-1 rounded-full border border-white/30 bg-white/15 px-4 py-3 text-sm text-white placeholder:text-white/65 outline-none backdrop-blur-md"/><button class="rounded-full bg-white/20 px-4" aria-label="Отправить ответ"><i class="fa-solid fa-paper-plane"></i></button></form>${viewersList}</div></div>`;
            viewer.classList.remove('hidden');
            const advanceStory = () => { if (activeStoryIndex < activeStoryItems.length - 1) { activeStoryIndex++; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); } else { closeStoryViewer(); } };
            if (st.mediaType === 'video') { const video = viewer.querySelector('video'); video?.addEventListener('ended', advanceStory, { once:true }); video?.addEventListener('error', () => { chatStatusDesc.textContent = 'Не удалось загрузить видеоисторию.'; }, { once:true }); }
            else storyAdvanceTimer = setTimeout(advanceStory, 10000);
            document.getElementById('storyOwnerProfile')?.addEventListener('click', () => { const owner=st.uid; closeStoryViewer(); storiesModal?.classList.add('hidden'); openAnyUserProfile(owner); });
            document.getElementById('storyViewerClose')?.addEventListener('click', closeStoryViewer);
            let storyTouchStart = null;
            viewer.ontouchstart = (ev) => { if (ev.target.closest('button, form, input, textarea, audio, video, a')) return; const t=ev.changedTouches?.[0]; if(t) storyTouchStart={x:t.clientX,y:t.clientY}; };
            viewer.ontouchend = (ev) => { if(!storyTouchStart) return; const t=ev.changedTouches?.[0]; const start=storyTouchStart; storyTouchStart=null; if(!t) return; const dx=t.clientX-start.x, dy=t.clientY-start.y; if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.2){ clearTimeout(storyAdvanceTimer); if(dx<0 && activeStoryIndex<activeStoryItems.length-1){activeStoryIndex++;renderStoryViewer();markStoryViewed(activeStoryItems[activeStoryIndex]);} else if(dx>0 && activeStoryIndex>0){activeStoryIndex--;renderStoryViewer();markStoryViewed(activeStoryItems[activeStoryIndex]);} } };
            viewer.onclick = (ev) => {
                if (ev.target.closest('button, form, input, textarea, audio, video, a')) return;
                const rect = viewer.getBoundingClientRect(); const x = ev.clientX - rect.left;
                if (x < rect.width * 0.35 && activeStoryIndex > 0) { clearTimeout(storyAdvanceTimer); activeStoryIndex--; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); }
                else if (x > rect.width * 0.65 && activeStoryIndex < activeStoryItems.length - 1) { clearTimeout(storyAdvanceTimer); activeStoryIndex++; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); }
            };
            document.getElementById('storyPrev')?.addEventListener('click', () => { if (activeStoryIndex > 0) { activeStoryIndex--; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); } });
            document.getElementById('storyNext')?.addEventListener('click', () => { if (activeStoryIndex < activeStoryItems.length - 1) { activeStoryIndex++; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); } });
            document.getElementById('storyLikeBtn')?.addEventListener('click', async () => { try { const likedNow = (activeStoryItems[activeStoryIndex].likes || []).includes(state.user.uid); await updateDoc(doc(db,'stories',st.id), { likes: likedNow ? arrayRemove(state.user.uid) : arrayUnion(state.user.uid) }); st.likes = likedNow ? (st.likes||[]).filter(x=>x!==state.user.uid) : [...(st.likes||[]),state.user.uid]; renderStoryViewer(); } catch(e) { console.error(e); alert('Не удалось поставить лайк. Проверь Firestore Rules.'); } });
            document.getElementById('storyViewersBtn')?.addEventListener('click', () => document.getElementById('storyViewersList')?.classList.toggle('hidden'));
            document.getElementById('storyReplyForm')?.addEventListener('submit', async ev => { ev.preventDefault(); const input=document.getElementById('storyReplyInput'); const reply=(input?.value||'').trim(); if(!reply) return; try { await updateDoc(doc(db,'stories',st.id), { replies: arrayUnion({uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',text:reply.slice(0,300),createdAt:Date.now()}) }); if(st.uid!==state.user.uid) await addDoc(collection(db,'users',st.uid,'storyReplies'), {fromUid:state.user.uid,fromName:state.userProfile?.displayName||state.user.displayName||'Пользователь',storyId:st.id,text:reply.slice(0,300),createdAt:Date.now()}); input.value=''; input.placeholder='Ответ отправлен'; } catch(e) { console.error(e); alert('Не удалось отправить ответ. Проверь Firestore Rules.'); } });
        }
        async function markStoryViewed(st) {
            if (!st || (st.views || []).some(v => (typeof v === 'string' ? v : v.uid) === state.user?.uid)) return;
            const viewer = {uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',username:state.userProfile?.username||''};
            try { await updateDoc(doc(db,'stories',st.id), { views: arrayUnion(viewer) }); st.views = [...(st.views||[]),viewer]; refreshAvatarStoryRings(); } catch(e) { console.warn('Could not record story view:',e); }
        }
        async function refreshStories() {
            if (!storiesList) return;
            if (!state.user) { storiesList.innerHTML = '<p class="text-sm text-slate-400">Войди в аккаунт, чтобы смотреть истории.</p>'; return; }
            storiesList.innerHTML = '<div class="vv-loading-state rounded-2xl border border-slate-800 p-4 text-sm text-slate-300"><span class="vv-spinner" aria-hidden="true"></span> Загружаем истории…</div>'; 
            try {
                const snap = await getDocs(collection(db, 'stories'));
                const now = Date.now();
                activeStoryItems = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(st => Number(st.expiresAt) > now).sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
                refreshAvatarStoryRings();
                if (!activeStoryItems.length) { storiesList.innerHTML = '<p class="rounded-2xl border border-slate-800 p-4 text-sm text-slate-400">Пока нет историй. Нажми «+» и опубликуй первую.</p>'; return; }
                const groups = new Map(); activeStoryItems.forEach(st => { if(!groups.has(st.uid)) groups.set(st.uid,[]); groups.get(st.uid).push(st); });
                const storyUserGroups=[...groups.entries()].map(([uid,items])=>({uid,items,seen:items.every(item=>(item.views||[]).some(v=>(typeof v==='string'?v:v?.uid)===state.user.uid))})); const unseenUsers=storyUserGroups.filter(g=>!g.seen); const seenUsers=storyUserGroups.filter(g=>g.seen); const renderStoryUsers=list=>list.map(({uid,items,seen})=>{const st=items[0];return `<button data-open-story-user="${storyEscape(uid)}" class="flex w-16 shrink-0 flex-col items-center gap-1 text-center text-xs">${storyAvatar(st,seen?'story-viewed':'story-unviewed')}<span class="w-16 truncate">${uid===state.user.uid?'Ваша история':storyEscape(st.displayName||'Пользователь')}</span></button>`;}).join(''); storiesList.innerHTML = `${unseenUsers.length?`<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Новые истории</div><div class="mb-4 flex gap-4 overflow-x-auto pb-3">${renderStoryUsers(unseenUsers)}</div>`:''}${seenUsers.length?`<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Просмотренные</div><div class="mb-3 flex gap-4 overflow-x-auto pb-3">${renderStoryUsers(seenUsers)}</div>`:''}<div class="mt-4 space-y-2">${activeStoryItems.filter(st=>st.uid===state.user.uid).map(st=>`<div class="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"><span>Моя история · ${Math.max(1,Math.ceil((Number(st.expiresAt)-now)/3600000))} ч. осталось</span><button data-delete-story="${storyEscape(st.id)}" class="rounded-lg px-3 py-2 text-rose-300 hover:bg-rose-500/10">Удалить</button></div>`).join('')}</div>`;
                storiesList.querySelectorAll('[data-open-story-user]').forEach(btn=>btn.addEventListener('click',()=>openStoryByUser(btn.dataset.openStoryUser)));
                storiesList.querySelectorAll('[data-open-story]').forEach(btn=>btn.addEventListener('click',()=>openStory(btn.dataset.openStory)));
                storiesList.querySelectorAll('[data-delete-story]').forEach(btn=>btn.addEventListener('click',async()=>{try{await deleteDoc(doc(db,'stories',btn.dataset.deleteStory));await refreshStories();}catch(e){console.error(e);alert('Не удалось удалить историю.');}}));
            } catch (err) { console.error('Load stories failed:', err); storiesList.innerHTML = '<p class="rounded-2xl border border-rose-500/30 p-4 text-sm text-rose-200">Не удалось загрузить истории. Проверь Firestore Rules.</p>'; }
        }
        function openStory(id) { activeStoryIndex=activeStoryItems.findIndex(s=>s.id===id); if(activeStoryIndex<0)return; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); }
        function openStoryByUser(uid) { const idx=activeStoryItems.findIndex(s=>s.uid===uid); if(idx>=0) openStory(activeStoryItems[idx].id); }
        document.getElementById('storiesNavBtn')?.addEventListener('click', async () => { if (!state.user) return; storiesModal?.classList.remove('hidden'); storyCreateForm?.classList.add('hidden'); closeStoryViewer(); await refreshStories(); });
        document.addEventListener('click', async event => { const avatar=event.target.closest('[data-story-avatar]'); if(!avatar || !state.user || event.target.closest('#friendProfileModal')) return; const uid=avatar.dataset.storyAvatar; const hasStory=activeStoryItems.some(st=>st.uid===uid && Number(st.expiresAt)>Date.now()); if(hasStory){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();storiesModal?.classList.remove('hidden');storyCreateForm?.classList.add('hidden');storiesList?.classList.remove('hidden');openStoryByUser(uid);} else { event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.(); if(uid===state.user.uid) document.getElementById('profileBtn')?.click(); else openAnyUserProfile(uid); } }, true);
        document.addEventListener('keydown', event => { if((event.key==='Enter'||event.key===' ') && event.target.matches('[data-story-avatar]')) { event.preventDefault(); event.target.click(); } });
        document.getElementById('storiesClose')?.addEventListener('click', () => { closeStoryViewer(); storiesModal?.classList.add('hidden'); });
        storiesModal?.addEventListener('click', event => { if (event.target === storiesModal) { closeStoryViewer(); storiesModal.classList.add('hidden'); } });
        document.getElementById('storyCreateToggle')?.addEventListener('click', () => { const opening=storyCreateForm?.classList.contains('hidden'); storyCreateForm?.classList.toggle('hidden'); storyStatus?.classList.add('hidden'); if (storiesList) storiesList.classList.toggle('hidden', !!opening); const btn=document.getElementById('storyCreateToggle'); if(btn) btn.innerHTML=opening ? '<i class="fa-solid fa-arrow-left"></i> Назад к историям' : '<i class="fa-solid fa-plus"></i> Добавить фото или видео'; if (opening) { storiesList?.classList.add('hidden'); storyTextInput?.focus({preventScroll:true}); } });
        const musicStartInput=document.getElementById('storyMusicStart');
        const musicLengthInput=document.getElementById('storyMusicLength');
        let storyMusicPreviewURL = null;
        function drawMusicWave() {
            const wave=document.getElementById('storyMusicWave'); if(!wave)return;
            wave.innerHTML=Array.from({length:56},(_,i)=>`<span style="height:${8+Math.abs(Math.sin(i*1.71)*Math.cos(i*.37))*31}px"></span>`).join('');
        }
        let sourceMusicDuration = 30;
        function updateMusicTrimLabel() {
            const maxStart = Math.max(0, Math.floor(sourceMusicDuration - 3));
            if (musicStartInput) { musicStartInput.max = String(maxStart); if (Number(musicStartInput.value) > maxStart) musicStartInput.value = String(maxStart); }
            const start=Math.max(0,Number(musicStartInput?.value)||0);
            const maxLength=Math.max(3,Math.min(10,Math.floor(sourceMusicDuration-start)));
            if(musicLengthInput){musicLengthInput.max=String(maxLength);if(Number(musicLengthInput.value)>maxLength)musicLengthInput.value=String(maxLength);}
            const length=Math.max(3,Math.min(maxLength,Number(musicLengthInput?.value)||10));
            const label=document.getElementById('storyMusicTrimLabel'); if(label) label.textContent=`Обрезка: ${start}–${start+length} сек. · в историю попадёт только этот фрагмент`;
        }
        function audioBufferToWavFile(samples, sampleRate, filename='voicevibe-trimmed.wav') {
            const total=samples.length, buffer=new ArrayBuffer(44+total*2), view=new DataView(buffer);
            const write=(o,str)=>{for(let i=0;i<str.length;i++)view.setUint8(o+i,str.charCodeAt(i));};
            write(0,'RIFF');view.setUint32(4,36+total*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,total*2,true);
            for(let i=0;i<total;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*32767,true);
            return new File([buffer],filename,{type:'audio/wav'});
        }
        async function decodeAudioFile(file) {
            const Ctx=window.AudioContext||window.webkitAudioContext;
            if(!Ctx) throw new Error('Этот браузер не поддерживает обработку аудио. Попробуй Chrome или Edge.');
            const ctx=new Ctx();
            try { const buffer=await ctx.decodeAudioData(await file.arrayBuffer()); return {buffer,ctx}; }
            catch(e){await ctx.close().catch(()=>{});throw new Error('Не удалось прочитать аудио. Попробуй MP3, WAV, M4A или OGG.');}
        }
        async function trimMusicFile(file,start,length) {
            const {buffer,ctx}=await decodeAudioFile(file);
            try {
                const actualStart=Math.min(Math.max(0,start),Math.max(0,buffer.duration-0.1));
                const actualLength=Math.max(0.1,Math.min(length,buffer.duration-actualStart));
                const rate=buffer.sampleRate, count=Math.max(1,Math.floor(actualLength*rate)), mono=new Float32Array(count);
                for(let ch=0;ch<buffer.numberOfChannels;ch++){
                    const channel=buffer.getChannelData(ch);
                    for(let i=0;i<count;i++) mono[i]+=(channel[Math.floor(actualStart*rate)+i]||0)/buffer.numberOfChannels;
                }
                // Fade edges to prevent clicks; this is a real audio cut, not just playback metadata.
                const fade=Math.min(Math.floor(rate*0.025),Math.floor(count/2));
                for(let i=0;i<fade;i++){const gain=i/Math.max(1,fade);mono[i]*=gain;mono[count-1-i]*=gain;}
                return audioBufferToWavFile(mono,rate,`voicevibe-cut-${Math.round(actualStart)}-${Math.round(actualStart+actualLength)}.wav`);
            } finally { await ctx.close().catch(()=>{}); }
        }
        function setMusicPreviewFile(file) {
            const preview=document.getElementById('storyMusicPreview'); if(!preview)return;
            if(storyMusicPreviewURL) URL.revokeObjectURL(storyMusicPreviewURL);
            storyMusicPreviewURL=file?URL.createObjectURL(file):null; preview.pause(); preview.src=storyMusicPreviewURL||''; preview.load();
            sourceMusicDuration=30;
            if(file){
                preview.onloadedmetadata=()=>{if(Number.isFinite(preview.duration)&&preview.duration>0){sourceMusicDuration=preview.duration;updateMusicTrimLabel();}};
                preview.onerror=()=>{storyStatus.textContent='Этот аудиофайл не удалось предварительно прослушать. Попробуй другой формат.';storyStatus.classList.remove('hidden');};
            }
            updateMusicTrimLabel();
        }
        drawMusicWave(); updateMusicTrimLabel();
        musicStartInput?.addEventListener('input', updateMusicTrimLabel);
        musicLengthInput?.addEventListener('input', updateMusicTrimLabel);
        storyMusicInput?.addEventListener('change', () => {
            const file=storyMusicInput.files?.[0];
            if(file) { setMusicPreviewFile(file); }
            const name=document.getElementById('storyMusicName');if(name)name.textContent=file?.name||'Файл не выбран';
        });
        document.getElementById('storyMusicPreviewPlay')?.addEventListener('click', async () => {
            const source=storyMusicInput?.files?.[0];
            if(!source){storyStatus.textContent='Сначала выбери аудиофайл на устройстве.';storyStatus.classList.remove('hidden');return;}
            const btn=document.getElementById('storyMusicPreviewPlay');
            try {
                btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin mr-1"></i>Готовим фрагмент…';
                const start=Math.max(0,Number(musicStartInput?.value)||0), length=Math.max(3,Math.min(10,Number(musicLengthInput?.value)||10));
                const cut=await trimMusicFile(source,start,length); const url=URL.createObjectURL(cut); const player=new Audio(url); player.volume=0.9;
                await player.play();
                player.onended=()=>URL.revokeObjectURL(url);
                setTimeout(()=>{player.pause();player.src='';URL.revokeObjectURL(url);},Math.min(10000,length*1000));
                storyStatus.textContent=`Прослушивается обрезанный фрагмент ${start}–${start+length} сек.`;storyStatus.classList.remove('hidden');
            } catch(err){console.error('Preview trim failed:',err);storyStatus.textContent=err?.message||'Не удалось воспроизвести фрагмент.';storyStatus.classList.remove('hidden');}
            finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-play mr-1"></i>Прослушать фрагмент';}
        });
        // Replace the browser's grey native file controls with consistent bright device-picker buttons.
        document.querySelectorAll('input[type="file"]').forEach(input=>{
            if(!input.classList.contains('vv-native-file')) input.classList.add('vv-native-file');
            input.addEventListener('change',()=>{
                const name=document.getElementById(input.id+'Name');
                if(name)name.textContent=input.files?.[0]?.name||'Файл не выбран';
            });
        });
        storyCreateForm?.addEventListener('submit', async event => {
            event.preventDefault(); if (!state.user) return;
            const text=(storyTextInput?.value||'').trim(); const image=storyImageInput?.files?.[0]||null; const video=storyVideoInput?.files?.[0]||null; const music=storyMusicInput?.files?.[0] || null;
            if(image&&video){storyStatus.textContent='Выбери фото или видео, не оба сразу.';storyStatus.classList.remove('hidden');return;}
            if(!text&&!image&&!video){storyStatus.textContent='Добавь текст, фото или видео.';storyStatus.classList.remove('hidden');return;}
            if(video&&!video.type.startsWith('video/')){storyStatus.textContent='Выбери видеофайл.';storyStatus.classList.remove('hidden');return;}
            if(music&&!music.type.startsWith('audio/')){storyStatus.textContent='Музыка должна быть аудиофайлом.';storyStatus.classList.remove('hidden');return;}
            if (state.storyUploading) return;
            state.storyUploading = true;
            storyPublishBtn.disabled=true; storyPublishBtn.setAttribute('aria-busy','true'); storyPublishBtn.textContent='Загружаем историю…'; storyStatus.classList.remove('hidden'); storyStatus.textContent='Подготавливаем файлы и загружаем. Не закрывай это окно.'; storyPublishBtn.classList.add('vv-loading-button');
            try {
                let mediaURL='', musicURL='', mediaType='text';
                if(image){ mediaURL=await uploadStoryMedia(image,'image'); mediaType='image'; }
                if(video){ mediaURL=await uploadStoryMedia(video,'video'); mediaType='video'; }
                if(music) { storyStatus.textContent='Обрезаем выбранный фрагмент музыки…'; const start=Math.max(0,Number(musicStartInput?.value)||0); const length=Math.max(3,Math.min(10,Number(musicLengthInput?.value)||10)); const trimmedMusic=await trimMusicFile(music,start,length); storyStatus.textContent='Загружаем готовый аудиофрагмент…'; musicURL=await uploadStoryMedia(trimmedMusic,'audio'); }
                const now=Date.now();
                await addDoc(collection(db,'stories'),{uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',username:state.userProfile?.username||'',photoURL:state.userProfile?.photoURL||state.user.photoURL||'',text:text.slice(0,500),mediaURL,mediaType,musicURL,likes:[],views:[],replies:[],createdAt:now,expiresAt:now+24*60*60*1000});
                storyTextInput.value='';storyImageInput.value='';storyVideoInput.value='';storyMusicInput.value='';['storyImageName','storyVideoName','storyMusicName'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='Файл не выбран';});if(musicStartInput)musicStartInput.value='0';if(musicLengthInput)musicLengthInput.value='10';setMusicPreviewFile(null);updateMusicTrimLabel();storyCreateForm.classList.add('hidden');storiesList?.classList.remove('hidden');const createBtn=document.getElementById('storyCreateToggle');if(createBtn)createBtn.innerHTML='<i class="fa-solid fa-plus"></i> Добавить фото или видео';await refreshStories();
            } catch(err){console.error('Publish story failed:',err);storyStatus.textContent=err?.message||'Не удалось опубликовать. Проверь настройки Cloudinary и Firestore Rules.';storyStatus.classList.remove('hidden');}
            finally{state.storyUploading=false;storyPublishBtn.disabled=false;storyPublishBtn.removeAttribute('aria-busy');storyPublishBtn.classList.remove('vv-loading-button');storyPublishBtn.textContent='Опубликовать';}
        });

        // Vibecoin / referrals / Premium: rewards and purchases are handled by the trusted Cloudflare Worker.
        const referralPanel = document.getElementById('referralPanel');
        async function showReferralPanel() {
            referralPanel?.classList.remove('hidden');
            const status = document.getElementById('referralStatus'); if(status) status.textContent='Загружаем реферальную ссылку…';
            try { const res=await ensureReferralAccount(); const d=res.data||{}; state.userProfile={...(state.userProfile||{}),...d}; renderSocialProfile(); const codeEl=document.getElementById('myReferralCode'); const linkEl=document.getElementById('myReferralLink'); if(codeEl) codeEl.value=d.referralCode||''; if(linkEl) linkEl.value=`${location.origin}${location.pathname}?ref=${encodeURIComponent(d.referralCode||'')}`; if(status) status.textContent=`Баланс: ${Number(d.vibecoinBalance||0)} Vibecoin. За каждого приглашённого оба получают по 10 монет.`; }
            catch(e){ if(status) status.textContent='Не удалось загрузить рефералы. Проверь адрес Cloudflare Worker и его секрет FIREBASE_SERVICE_ACCOUNT.'; console.warn(e); }
        }
        document.getElementById('openReferralPanel')?.addEventListener('click', showReferralPanel);
        document.getElementById('profileReferralShortcut')?.addEventListener('click', showReferralPanel);
        document.getElementById('closeReferralPanel')?.addEventListener('click',()=>referralPanel?.classList.add('hidden'));
        async function copyField(id){const el=document.getElementById(id);if(!el?.value)return;try{await navigator.clipboard.writeText(el.value);const s=document.getElementById('referralStatus');if(s)s.textContent='Скопировано! Отправь ссылку другу.';}catch(_){el.select();document.execCommand('copy');}}
        document.getElementById('copyReferralCode')?.addEventListener('click',()=>copyField('myReferralCode'));
        document.getElementById('copyReferralLink')?.addEventListener('click',()=>copyField('myReferralLink'));
        document.getElementById('shareReferralLink')?.addEventListener('click', async () => {
            const link = document.getElementById('myReferralLink')?.value;
            if (!link) { const status=document.getElementById('referralStatus'); if(status) status.textContent='Сначала дождись загрузки реферальной ссылки.'; return; }
            const shareText = `🎁 VoiceVibe — получи 10 VibeCoins!\n\nПрисоединяйся к VoiceVibe! Общайся, знакомься и находи новых друзей. По моей ссылке мы оба получим по 10 VibeCoins!\n\n🔗 ${link}`;
            const shareData = { title: '🎁 VoiceVibe — получи 10 VibeCoins!', text: shareText };
            const status=document.getElementById('referralStatus');
            try {
                if (navigator.share) { await navigator.share(shareData); if(status) status.textContent='Ссылка готова к отправке другу!'; }
                else { await navigator.clipboard.writeText(shareText); if(status) status.textContent='Приглашение скопировано — отправь его другу!'; }
            } catch (err) {
                if (err?.name === 'AbortError') return;
                try { const field=document.getElementById('myReferralLink'); field?.select(); document.execCommand('copy'); if(status) status.textContent='Ссылка скопирована — отправь её другу!'; }
                catch (_) { if(status) status.textContent='Не удалось поделиться автоматически. Скопируй ссылку вручную.'; }
            }
        });
        document.getElementById('claimReferralBtn')?.addEventListener('click',async()=>{const code=(document.getElementById('claimReferralCode')?.value||'').trim();const status=document.getElementById('referralStatus');if(!code)return;if(status)status.textContent='Проверяем код…';try{const res=await claimReferralCall({code});if(status)status.textContent=res.data?.message||'Код применён!';const wallet=await ensureReferralAccount();state.userProfile={...(state.userProfile||{}),...(wallet.data||{})};renderSocialProfile();}catch(e){if(status)status.textContent=e?.message||'Не удалось применить код.';}});
        document.getElementById('buyPremiumBtn')?.addEventListener('click',async()=>{const b=document.getElementById('buyPremiumBtn');b.disabled=true;try{if(!state.user)throw new Error('Сначала войди в аккаунт.');const result=(await workerPost('/buy-premium')).data;state.userProfile={...(state.userProfile||{}),vibecoinBalance:result.vibecoinBalance,premiumUntil:result.premiumUntil};renderSocialProfile();alert(result.message||'Premium активирован на 30 дней!');}catch(e){console.error('Premium purchase:',e);alert(e?.message||'Не удалось купить Premium.');}finally{b.disabled=false;}});
        document.getElementById('watchAdCoinsBtn')?.addEventListener('click',async()=>{try{const res=await claimAdCoinsCall();alert(res.data?.message||'Попробуйте позже — реклама пока не подключена.');}catch(e){alert(e?.message||'Попробуйте позже — реклама пока не подключена.');}});
        document.getElementById('profileBannerFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];const n=document.getElementById('profileBannerFileName');if(n)n.textContent=f?.name||'Файл не выбран';});
        document.getElementById('uploadProfileBannerBtn')?.addEventListener('click',async()=>{const f=document.getElementById('profileBannerFile')?.files?.[0];if(!f)return alert('Сначала выбери изображение.');if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Банер профиля доступен только Premium.');if(f.size>5*1024*1024)return alert('Изображение должно быть меньше 5 МБ.');const b=document.getElementById('uploadProfileBannerBtn');b.disabled=true;try{const url=await uploadImageToCloudinary(f,'profile-banners');await updateDoc(doc(db,'users',state.user.uid),{bannerURL:url,updatedAt:Date.now()});state.userProfile.bannerURL=url;renderSocialProfile();alert('Банер установлен!');}catch(e){console.error(e);alert(`Не удалось загрузить банер в Cloudinary: ${e?.message||'ошибка загрузки'}`);}finally{b.disabled=false;}});

        // Groups are available only for people already in the user's friend list.
        const groupModal=document.getElementById('createGroupModal');
        document.getElementById('createGroupBtn')?.addEventListener('click',()=>{const host=document.getElementById('groupFriendsChoices');if(!friendsCache.length){host.innerHTML='<p class="text-sm text-slate-400">Сначала добавь друзей.</p>';}else host.innerHTML=friendsCache.map(f=>`<label class="flex items-center gap-3 rounded-xl border border-slate-700 p-3"><input type="checkbox" class="group-friend-check accent-violet-500" value="${escapeHTML(f.uid||f.id)}"><span class="min-w-0"><b class="block text-sm">${escapeHTML(f.displayName||'Друг')}</b><span class="text-xs text-slate-500">@${escapeHTML(f.username||'')}</span></span></label>`).join('');document.getElementById('createGroupStatus').textContent='';groupModal?.classList.remove('hidden');});
        document.getElementById('closeCreateGroup')?.addEventListener('click',()=>groupModal?.classList.add('hidden'));
        document.getElementById('confirmCreateGroup')?.addEventListener('click',async()=>{const name=(document.getElementById('groupNameInput')?.value||'').trim().slice(0,40);const members=[...document.querySelectorAll('.group-friend-check:checked')].map(e=>e.value);const status=document.getElementById('createGroupStatus');if(!name){status.textContent='Введи название группы.';return;}if(!members.length){status.textContent='Выбери хотя бы одного друга.';return;}const btn=document.getElementById('confirmCreateGroup');btn.disabled=true;try{const res=await createGroupCall({name,members});const groupId=res.data.id;groupModal.classList.add('hidden');document.getElementById('groupNameInput').value='';const snap=await getDoc(doc(db,'groups',groupId));if(snap.exists())groupsCache=[{id:groupId,...snap.data()},...groupsCache.filter(g=>g.id!==groupId)];renderChatFriends();openGroupConversation(groupId);}catch(e){console.error(e);status.textContent='Не удалось создать группу. Проверь Firestore Rules.';}finally{btn.disabled=false;}});
        async function openGroupConversation(groupId){if(!state.user)return;const group=groupsCache.find(g=>g.id===groupId);if(!group||!(group.members||[]).includes(state.user.uid))return;activeGroupId=groupId;activeFriend=null;activeConversationId=null;if(state.messageUnsub){state.messageUnsub();state.messageUnsub=null;}const pane=document.getElementById('conversationPane');pane?.classList.remove('hidden','conversation-empty');socialChatsPanel.classList.add('chat-open');const header=document.getElementById('conversationHeader');if(header)header.innerHTML=`<button id="conversationBack" class="mr-2 rounded-lg px-2 py-1" aria-label="Назад">‹</button><i class="fa-solid fa-users mr-2 text-violet-300"></i>${escapeHTML(group.name||'Группа')} <span class="ml-2 text-xs text-slate-500">${(group.members||[]).length} участников</span>`;document.getElementById('conversationBack')?.addEventListener('click',()=>socialChatsPanel.classList.remove('chat-open'));const host=document.getElementById('messagesList');host.style.backgroundImage=group.wallpaperURL?`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${group.wallpaperURL}")`:'';host.style.backgroundSize='cover';host.innerHTML='<p class="text-sm text-slate-400">Открываем группу…</p>';document.getElementById('messageInput').disabled=false;document.getElementById('sendMessageBtn').disabled=false;document.getElementById('snakeChallengeBtn').disabled=true;state.messageUnsub=onSnapshot(query(collection(db,'groups',groupId,'messages'),orderBy('createdAt','asc'),limit(200)),snap=>{if(activeGroupId!==groupId)return;host.innerHTML=snap.empty?'<p class="text-sm text-slate-500">Группа создана. Напишите первое сообщение 👋</p>':snap.docs.map(d=>{const m=d.data();const mine=m.senderUid===state.user.uid;const senderProfile=mine?state.userProfile:friendsCache.find(f=>(f.uid||f.id)===m.senderUid);const sender=mine?(state.userProfile?.displayName||'Вы'):(senderProfile?.displayName||'Участник');const senderPremium=Number(senderProfile?.premiumUntil||0)>Date.now();if(m.type==='sticker')return `<div class="flex ${mine?'justify-end':'justify-start'}"><img src="${escapeHTML(m.text||'')}" alt="Стикер" class="max-h-36 max-w-36 rounded-xl object-contain"></div>`;return `<div class="flex ${mine?'justify-end':'justify-start'}"><div class="max-w-[88%] rounded-2xl ${mine?'bg-violet-600 text-white':'bg-slate-800 text-slate-100'} px-3 py-2 text-sm"><p class="mb-1 text-[10px] font-bold opacity-75 ${senderPremium?'vv-premium-name':''}">${escapeHTML(sender)}${senderPremium?' 👑':''}</p><p class="whitespace-pre-wrap break-words">${escapeHTML(m.text||'')}</p><p class="mt-1 text-right text-[10px] opacity-60">${m.createdAt?new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</p></div></div>`;}).join('');host.scrollTop=host.scrollHeight;},err=>{console.error(err);host.innerHTML='<p class="text-sm text-rose-300">Не удалось загрузить сообщения группы. Проверь Firestore Rules.</p>';});showTab('chats');renderChatFriends();}

        // Premium custom sticker library. Existing stickers remain visible after Premium expires.
        document.getElementById('uploadStickerBtn')?.addEventListener('click',()=>{if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Загрузка собственных стикеров доступна только Premium. Сами сохранённые стикеры останутся видны.');document.getElementById('stickerFileInput')?.click();});
        document.getElementById('stickerFileInput')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Выбери изображение.');if(f.size>2*1024*1024)return alert('Стикер должен быть меньше 2 МБ.');try{const url=await uploadImageToCloudinary(f,'stickers');const stickerRef=doc(collection(db,'users',state.user.uid,'stickers'));await setDoc(stickerRef,{url,name:f.name.slice(0,80),createdAt:Date.now()});e.target.value='';alert('Стикер добавлен в твою коллекцию!');}catch(err){console.error(err);alert(`Не удалось загрузить стикер: ${err?.message||'ошибка Cloudinary/Firestore'}`);}});
        document.getElementById('openStickersBtn')?.addEventListener('click',async()=>{const panel=document.getElementById('stickersPanel');panel.classList.toggle('hidden');if(panel.classList.contains('hidden'))return;const grid=document.getElementById('stickersGrid');const hint=document.getElementById('stickersPanelHint');grid.innerHTML='<span class="text-xs text-slate-400">Загружаем стикеры…</span>';try{const owners=[state.user.uid,...(activeGroupId?[]:(activeFriend?[activeFriend]:[]))];const all=[];for(const owner of owners){const snap=await getDocs(query(collection(db,'users',owner,'stickers'),orderBy('createdAt','desc'),limit(50)));snap.docs.forEach(d=>all.push({id:d.id,owner,...d.data()}));}grid.innerHTML=all.length?all.map(st=>`<button data-send-sticker="${escapeHTML(st.url)}" data-sticker-owner="${escapeHTML(st.owner)}" class="rounded-xl border border-slate-700 p-1"><img src="${escapeHTML(st.url)}" alt="Стикер" class="h-14 w-14 rounded-lg object-contain"></button>`).join(''):'<span class="text-xs text-slate-400">Пока нет стикеров. Premium позволяет загрузить свои.</span>';hint.textContent=Number(state.userProfile?.premiumUntil||0)>Date.now()?'Нажми на стикер, чтобы отправить его.':'Ты можешь просматривать стикеры, но отправка доступна только Premium.';grid.querySelectorAll('[data-send-sticker]').forEach(b=>b.addEventListener('click',async()=>{if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Отправка стикеров доступна только Premium.');try{const url=b.dataset.sendSticker;const payload={senderUid:state.user.uid,text:url,type:'sticker',createdAt:Date.now()};if(activeGroupId){await addDoc(collection(db,'groups',activeGroupId,'messages'),payload);await updateDoc(doc(db,'groups',activeGroupId),{updatedAt:Date.now(),lastMessage:'✨ Стикер'});}else if(activeConversationId){await addDoc(collection(db,'conversations',activeConversationId,'messages'),payload);}else return;panel.classList.add('hidden');}catch(err){console.error(err);alert('Не удалось отправить стикер. Проверь Rules.');}}));}catch(err){console.error(err);grid.innerHTML='<span class="text-xs text-rose-300">Не удалось загрузить стикеры. Проверь Firestore Rules.</span>';}});
        document.getElementById('recommendedWallpaperBtn')?.addEventListener('click', async () => {
            if(Number(state.userProfile?.premiumUntil||0)<=Date.now()) return alert('Рекомендуемые обои доступны с Premium.');
            if(!activeConversationId && !activeGroupId) return alert('Сначала открой чат.');
            const choices = [
              {name:'Фиолетовая ночь',url:'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200'},
              {name:'Звёздное небо',url:'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200'},
              {name:'Горы',url:'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200'}
            ];
            const choice=prompt(choices.map((c,i)=>`${i+1}. ${c.name}`).join('\n')+'\nВыбери номер (1–3):','1');
            if(choice===null)return;
            const selected=choices[Number(choice)-1]; if(!selected)return alert('Выбери номер от 1 до 3.');
            try {
              if(activeGroupId) await updateDoc(doc(db,'groups',activeGroupId),{wallpaperURL:selected.url,updatedAt:Date.now()});
              else await updateDoc(doc(db,'conversations',activeConversationId),{wallpaperURL:selected.url});
              const host=document.getElementById('messagesList'); host.style.backgroundImage=`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${selected.url}")`; host.style.backgroundSize='cover';
            }catch(err){console.error(err);alert('Не удалось установить обои. Проверь доступ к чату.');}
        });
        document.getElementById('chatWallpaperFile')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Обои в чате доступны только Premium.');if(!activeConversationId&&!activeGroupId)return alert('Сначала открой чат.');if(f.size>5*1024*1024)return alert('Изображение должно быть меньше 5 МБ.');try{const url=await uploadImageToCloudinary(f,'chat-wallpapers');if(activeGroupId)await updateDoc(doc(db,'groups',activeGroupId),{wallpaperURL:url,updatedAt:Date.now()});else await updateDoc(doc(db,'conversations',activeConversationId),{wallpaperURL:url});document.getElementById('messagesList').style.backgroundImage=`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${url}")`;document.getElementById('messagesList').style.backgroundSize='cover';alert('Обои установлены!');}catch(err){console.error(err);alert(`Не удалось установить обои: ${err?.message||'ошибка Cloudinary/Firestore'}`);}finally{e.target.value='';}});

        document.getElementById('socialEditProfile')?.addEventListener('click', () => document.getElementById('profileBtn')?.click());

        function stopSocialListeners() {
            state.socialUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.socialUnsubs = [];
            state.unreadUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.unreadUnsubs = [];
            state.unreadCounts.clear(); updateUnreadBadge();
            state.presenceUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.presenceUnsubs = [];
            if (state.presenceHeartbeat) { clearInterval(state.presenceHeartbeat); state.presenceHeartbeat = null; }
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }
            if (state.groupUnsub) { state.groupUnsub(); state.groupUnsub = null; }
            groupsCache = []; activeGroupId = null;
        }
        function startSocialListeners() {
            stopSocialListeners();
            if (!state.user) return;
            const uid = state.user.uid;
            state.groupUnsub = onSnapshot(query(collection(db,'groups'), where('members','array-contains',uid)), snap => { groupsCache = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)); renderChatFriends(); }, err => { console.warn('Groups listener:',err); if(err.code==='permission-denied') console.warn('Проверь опубликованные Firestore Rules: запрос уже использует array-contains для members.'); });
            refreshStories().catch(err => console.warn('Initial stories refresh:', err));
            state.socialUnsubs.push(onSnapshot(doc(db,'users',uid), snap => { if(snap.exists()){ state.userProfile={...(state.userProfile||{}),...snap.data()}; renderSocialProfile(); } }, err => console.warn('Own profile listener:',err)));
            const presenceRef = doc(db, 'presence', uid);
            const publishPresence = () => setDoc(presenceRef, { uid, online: !document.hidden, lastSeen: Date.now() }, { merge:true }).catch(err => console.warn('Presence update:', err));
            publishPresence();
            state.presenceHeartbeat = setInterval(publishPresence, 30000);
            document.addEventListener('visibilitychange', publishPresence);
            window.addEventListener('pagehide', () => setDoc(presenceRef, { uid, online:false, lastSeen:Date.now() }, { merge:true }).catch(()=>{}), { once:true });
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friendRequests'), snap => {
                friendRequestsCache = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(r => r.status === 'pending');
                renderFriendRequests();
            }, err => console.warn('Friend request listener:', err)));
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friends'), async snap => {
                friendsCache = snap.docs.map(d => ({ id:d.id, ...d.data(), uid:d.data().uid || d.id }));
                refreshUnreadListeners();
                renderFriends(); renderChatFriends(); renderSocialProfile();
                state.presenceUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
                state.presenceUnsubs = [];
                for (const friend of friendsCache) {
                    try {
                        const ps = await getDoc(doc(db,'users',friend.uid));
                        if (ps.exists()) Object.assign(friend, ps.data());
                    } catch (err) { console.warn('Friend profile:', err); }
                    const unsub = onSnapshot(doc(db,'presence',friend.uid), presenceSnap => {
                        state.presenceCache.set(friend.uid, presenceSnap.exists() ? presenceSnap.data() : { online:false });
                        renderFriends(); renderChatFriends();
                        if (activeFriend === friend.uid) updateConversationPresence(friend.uid);
                    }, () => {});
                    state.presenceUnsubs.push(unsub);
                }
                renderFriends(); renderChatFriends();
            }, err => console.warn('Friends listener:', err)));
        }
        async function renderFriendRequests() {
            const host = document.getElementById('friendRequestsList');
            document.getElementById('requestCount').textContent = String(friendRequestsCache.length);
            if (!friendRequestsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет заявок.</p>'; return; }
            await preloadRoles(friendRequestsCache, 'fromUid');
            host.innerHTML = friendRequestsCache.map(r => `<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-slate-950/80 p-3">${avatarMarkup(r,'h-11 w-11')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(r.displayName || 'Пользователь')} ${roleBadgeMarkup(r.fromUid)} <span class="ml-1 text-xs font-normal text-violet-300">хочет добавить вас</span></p><p class="text-xs text-slate-400">@${escapeHTML(r.username || 'user')}</p></div><button data-accept="${escapeHTML(r.fromUid)}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold">Принять</button><button data-reject="${escapeHTML(r.fromUid)}" class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Отклонить</button></div>`).join('');
            host.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => acceptFriend(b.dataset.accept)));
            host.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => rejectFriend(b.dataset.reject)));
        }
        function friendOnline(uid) {
            const p = state.presenceCache.get(uid);
            return !!(p && p.online && Date.now() - Number(p.lastSeen || 0) < 90000);
        }
        function presenceLabel(uid) {
            return friendOnline(uid) ? '<span class="inline-flex items-center gap-1 text-xs text-emerald-400"><i class="h-2 w-2 rounded-full bg-emerald-400"></i>В сети</span>' : '<span class="text-xs text-slate-500">Не в сети</span>';
        }
        function updateConversationPresence(uid) {
            const f = friendsCache.find(x => x.uid === uid) || {};
            const header = document.getElementById('conversationHeader');
            if (header) header.innerHTML = `<div class="flex items-center gap-3"><button id="conversationBack" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800" aria-label="Назад к друзьям"><i class="fa-solid fa-arrow-left"></i></button>${avatarMarkup(f,'h-10 w-10')}<button type="button" id="conversationFriendProfile" class="min-w-0 text-left"><div class="font-semibold text-slate-100">${escapeHTML(f.displayName || 'Друг')} ${roleBadgeMarkup(uid)}</div><div class="text-xs text-violet-300">@${escapeHTML(f.username || 'user')}</div>${presenceLabel(uid)}</button></div>`;
            document.getElementById('conversationBack')?.addEventListener('click', closeConversation);
            document.getElementById('conversationFriendProfile')?.addEventListener('click', () => openFriendProfile(uid));
        }
        function closeConversation() {
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }
            activeFriend = null; activeConversationId = null;
            socialChatsPanel.classList.remove('chat-open');
            const pane = document.getElementById('conversationPane');
            pane?.classList.add('hidden');
            const list = document.getElementById('messagesList'); if (list) list.innerHTML = '';
            const input = document.getElementById('messageInput'); if (input) { input.value = ''; input.disabled = true; }
            const send = document.getElementById('sendMessageBtn'); if (send) send.disabled = true;
            const game = document.getElementById('snakeChallengeBtn'); if (game) game.disabled = true;
            renderChatFriends();
        }
        async function openAnyUserProfile(uid) {
            if (!uid || !state.user) return;
            if (uid === state.user.uid) { document.getElementById('profileBtn')?.click(); return; }
            let profile=friendsCache.find(x=>String(x.uid||x.id)===String(uid));
            try { const snap=await getDoc(doc(db,'users',uid)); if(snap.exists()) profile={...(profile||{}),...snap.data(),uid}; }
            catch(err){console.warn('Could not load public profile:',err);}
            if(!profile){ alert('Не удалось загрузить профиль пользователя.'); return; }
            await loadRole(uid);
            let modal=document.getElementById('friendProfileModal');
            if(!modal){modal=document.createElement('div');modal.id='friendProfileModal';modal.className='fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/90 p-5 backdrop-blur';modal.innerHTML='<div class="relative w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl"><button id="friendProfileClose" class="absolute right-3 top-3 rounded-xl p-2 text-slate-400" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button><div id="friendProfileContent" class="flex flex-col items-center gap-3"></div></div>';document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});modal.querySelector('#friendProfileClose').addEventListener('click',()=>modal.remove());}
            const content=modal.querySelector('#friendProfileContent');
            content.innerHTML=`${profile.bannerURL?`<div class="h-24 w-full rounded-2xl bg-cover bg-center" style="background-image:url('${escapeHTML(profile.bannerURL)}')"></div>`:''}${avatarMarkup(profile,'h-24 w-24')}<h2 class="text-xl font-bold ${Number(profile.premiumUntil||0)>Date.now()?'vv-premium-name':''}">${escapeHTML(profile.displayName||'Пользователь')}${Number(profile.premiumUntil||0)>Date.now()?' 👑':''} ${roleBadgeMarkup(uid)}</h2><p class="text-violet-300">@${escapeHTML(profile.username||'user')}</p><p class="max-w-full whitespace-pre-wrap break-words text-sm text-slate-400">${escapeHTML(profile.bio||'')}</p><div class="flex w-full gap-2 pt-2"><button id="profileViewStories" class="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-sm">Истории</button>${friendsCache.some(f=>String(f.uid||f.id)===String(uid))?`<button id="profileMessageUser" class="flex-1 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold">Написать</button>`:`<button id="profileAddUser" class="flex-1 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold">Добавить в друзья</button>`}</div>`;
            content.querySelector('#profileViewStories')?.addEventListener('click',()=>{const has=activeStoryItems.some(st=>st.uid===uid&&Number(st.expiresAt)>Date.now());if(has){modal.remove();storiesModal?.classList.remove('hidden');openStoryByUser(uid);}else{storiesModal?.classList.remove('hidden');refreshStories();}});
            content.querySelector('#profileMessageUser')?.addEventListener('click',()=>{modal.remove();openConversation(uid);});
            content.querySelector('#profileAddUser')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Отправляем…';try{await sendFriendRequest(uid);b.textContent='Заявка отправлена';}catch(err){b.disabled=false;b.textContent='Повторить';alert(err.message||'Не удалось отправить заявку.');}});
        }
        async function openFriendProfile(uid) {
            const f = friendsCache.find(x => String(x.uid || x.id) === String(uid)); if (!f) return;
            await loadRole(uid);
            const name = escapeHTML(f.displayName || 'Друг'); const nick = escapeHTML(f.username || 'user');
            const photo = f.photoURL ? `<img src="${escapeHTML(f.photoURL)}" alt="Аватар ${name}" class="h-28 w-28 rounded-full object-cover">` : avatarMarkup(f,'h-28 w-28');
            let modal = document.getElementById('friendProfileModal');
            if (!modal) { modal=document.createElement('div'); modal.id='friendProfileModal'; modal.className='fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-5 backdrop-blur'; modal.innerHTML='<div class="relative w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl"><button id="friendProfileClose" class="absolute right-3 top-3 rounded-xl p-2 text-slate-400" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button><div id="friendProfileContent" class="flex flex-col items-center gap-3"></div></div>'; document.body.appendChild(modal); modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();}); modal.querySelector('#friendProfileClose').addEventListener('click',()=>modal.remove()); }
            modal.querySelector('#friendProfileContent').innerHTML = `${photo}<h2 class="text-xl font-bold">${name} ${roleBadgeMarkup(uid)}</h2><p class="text-violet-300">@${nick}</p><p class="text-sm text-slate-400">${escapeHTML(f.bio || '')}</p>`;
        }
        async function renderFriends() {
            const host = document.getElementById('friendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет друзей. Добавить можно во время разговора в рулетке.</p>'; return; }
            await preloadRoles(friendsCache);
            host.innerHTML = friendsCache.map(f => {
                const uid=f.uid || f.id;
                return `<div class="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">${avatarMarkup(f,'h-11 w-11')}<div class="min-w-0 flex-1"><button type="button" data-view-profile="${escapeHTML(uid)}" class="block max-w-full truncate text-left text-sm font-semibold hover:text-violet-300">${escapeHTML(f.displayName || 'Друг')} ${roleBadgeMarkup(uid)}</button><button type="button" data-view-profile="${escapeHTML(uid)}" class="block text-left text-xs text-slate-500 hover:text-violet-300">@${escapeHTML(f.username || 'user')}</button>${presenceLabel(uid)}</div><button data-chatfriend="${escapeHTML(uid)}" class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold">Написать</button></div>`;
            }).join('');
            host.querySelectorAll('[data-chatfriend]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.chatfriend)));
            host.querySelectorAll('[data-view-profile]').forEach(b => b.addEventListener('click', () => openAnyUserProfile(b.dataset.viewProfile)));
        }
        function unreadStorageKey(friendUid) { return `vv_read_${state.user?.uid || 'guest'}_${friendUid}`; }
        function getLastReadAt(friendUid) { return Number(localStorage.getItem(unreadStorageKey(friendUid)) || 0); }
        function updateUnreadBadge() {
            const total = [...state.unreadCounts.values()].reduce((sum, n) => sum + n, 0);
            const nav = document.querySelector('[data-tab="chats"]');
            if (nav) {
                let badge = document.getElementById('chatsUnreadBadge');
                if (!badge) { badge = document.createElement('span'); badge.id='chatsUnreadBadge'; badge.className='absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow-lg shadow-fuchsia-900/40'; nav.classList.add('relative'); nav.appendChild(badge); }
                badge.textContent = total > 99 ? '99+' : String(total); badge.classList.toggle('hidden', total === 0);
            }
        }
        function refreshUnreadListeners() {
            state.unreadUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} }); state.unreadUnsubs = [];
            state.unreadCounts.clear(); updateUnreadBadge();
            if (!state.user) return;
            for (const f of friendsCache) {
                const uid = String(f.uid || f.id || ''); if (!uid || uid === state.user.uid) continue;
                const chatId = [state.user.uid, uid].sort().join('_');
                const messagesRef = collection(db, 'conversations', chatId, 'messages');
                const unsub = onSnapshot(query(messagesRef, orderBy('createdAt','desc'), limit(200)), snap => {
                    const lastRead = getLastReadAt(uid);
                    let count = 0;
                    if (activeFriend !== uid || currentTab !== 'chats') {
                        count = snap.docs.filter(d => { const m=d.data(); return m.senderUid !== state.user.uid && Number(m.createdAt || m.createdAtMs || 0) > lastRead; }).length;
                    } else {
                        localStorage.setItem(unreadStorageKey(uid), String(Date.now()));
                    }
                    state.unreadCounts.set(uid, count); updateUnreadBadge(); renderChatFriends();
                }, err => { if (err?.code !== 'permission-denied') console.warn('Unread count listener:', err); });
                state.unreadUnsubs.push(unsub);
            }
        }

        async function renderChatFriends() {
            const host = document.getElementById('chatFriendsList');
            if (!friendsCache.length && !groupsCache.length) { host.innerHTML = '<p class="p-2 text-sm text-slate-500">Добавь друга или создай группу, чтобы начать переписку.</p>'; return; }
            await preloadRoles(friendsCache);
            const friendsHtml = friendsCache.map(f => {
                const uid=f.uid || f.id; const unread=Number(state.unreadCounts.get(uid)||0);
                const isPremium = Number(f.premiumUntil || 0) > Date.now();
                return `<button data-openchat="${escapeHTML(uid)}" class="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-800 ${activeFriend === uid && !activeGroupId ? 'bg-slate-800' : ''}">${avatarMarkup(f,'h-10 w-10')}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold ${isPremium?'vv-premium-name':''}">${escapeHTML(f.displayName || 'Друг')}${isPremium?' 👑':''} ${roleBadgeMarkup(uid)}</span>${presenceLabel(uid)}</span>${unread ? `<span class="min-w-6 h-6 px-1 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-extrabold inline-flex items-center justify-center">${unread>99?'99+':unread}</span>` : ''}<span class="text-xs text-slate-500">›</span></button>`;
            }).join('');
            const groupsHtml = groupsCache.map(g => `<button data-opengroup="${escapeHTML(g.id)}" class="flex w-full items-center gap-3 rounded-xl border border-violet-400/10 p-3 text-left transition hover:bg-violet-500/10 ${activeGroupId===g.id?'bg-violet-500/10':''}"><span class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><i class="fa-solid fa-users"></i></span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${escapeHTML(g.name||'Группа')}</span><span class="block text-xs text-slate-500">${(g.members||[]).length} участников</span></span><span class="text-xs text-violet-300">Группа</span></button>`).join('');
            host.innerHTML = `${groupsCache.length?'<p class="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-violet-300">Группы</p>':''}${groupsHtml}${friendsCache.length?'<p class="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Друзья</p>':''}${friendsHtml}`;
            host.querySelectorAll('[data-openchat]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.openchat)));
            host.querySelectorAll('[data-opengroup]').forEach(b => b.addEventListener('click', () => openGroupConversation(b.dataset.opengroup)));
        }
        let friendSearchTimer = null;
        let searchGeneration = 0;
        const socialSearchInput = document.getElementById('socialSearchInput');
        const socialSearchResults = document.getElementById('socialSearchResults');

        async function renderSearchUsers(users, host, generation = null) {
            if (!users.length) {
                host.innerHTML = '<p class="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">Пользователь с таким @nickname не найден.</p>';
                return;
            }
            await preloadRoles(users);
            if (generation !== null && generation !== searchGeneration) return;
            host.innerHTML = users.map(u => {
                const uid = String(u.uid || u.id);
                const isFriend = friendsCache.some(f => String(f.uid || f.id) === uid);
                const pending = !!u.requestPending;
                return `<div class="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div class="shrink-0">${avatarMarkup(u,'h-12 w-12')}</div>
                    <div class="min-w-0 flex-1"><button type="button" data-view-profile="${escapeHTML(uid)}" class="block max-w-full truncate text-left text-sm font-semibold text-white hover:text-violet-300">${escapeHTML(u.displayName || 'Пользователь')} ${roleBadgeMarkup(uid)}</button><button type="button" data-view-profile="${escapeHTML(uid)}" class="block text-xs text-violet-300 hover:underline">@${escapeHTML(u.username || '')}</button></div>
                    ${isFriend ? '<span class="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">Друг</span>' :
                    pending ? '<span class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Заявка отправлена</span>' :
                    `<button type="button" data-addfriend="${escapeHTML(uid)}" class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">Добавить</button>`}
                </div>`;
            }).join('');
            host.querySelectorAll('[data-view-profile]').forEach(button => button.addEventListener('click', () => openAnyUserProfile(button.dataset.viewProfile)));
            host.querySelectorAll('[data-addfriend]').forEach(button => button.addEventListener('click', async () => {
                button.disabled = true; button.textContent = 'Отправляем…';
                try {
                    await sendFriendRequest(button.dataset.addfriend);
                    button.outerHTML = '<span class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Заявка отправлена</span>';
                } catch (error) {
                    console.error('Friend request failed:', error);
                    button.disabled = false; button.textContent = 'Повторить';
                    const msg = error.code === 'permission-denied'
                        ? 'Firebase запретил отправку заявки. Проверь правила Firestore.'
                        : (error.message || 'Не удалось отправить заявку.');
                    host.insertAdjacentHTML('afterbegin', `<p class="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">${escapeHTML(msg)}</p>`);
                }
            }));
        }

        async function findUsersByUsername(raw) {
            const value = normalizeUsername(String(raw || '').trim().replace(/^@/, ''));
            if (value.length < 2) return [];
            const found = new Map();
            // The username reservation document is the most reliable exact lookup.
            try {
                const reservation = await getDoc(doc(db, 'usernames', value));
                if (reservation.exists()) {
                    const ownerUid = reservation.data().uid;
                    if (ownerUid && ownerUid !== state.user?.uid) {
                        const profile = await getDoc(doc(db, 'users', ownerUid));
                        if (profile.exists()) found.set(ownerUid, { uid: ownerUid, ...profile.data() });
                    }
                }
            } catch (error) { console.warn('Exact username lookup:', error); }
            // Prefix query also supports users created before username reservations were added.
            try {
                const q = query(collection(db, 'users'),
                    where('username', '>=', value),
                    where('username', '<=', value + '\uf8ff'),
                    limit(12));
                const snap = await getDocs(q);
                snap.docs.forEach(d => {
                    if (d.id !== state.user?.uid) found.set(d.id, { uid: d.id, ...d.data() });
                });
            } catch (error) {
                if (!found.size) throw error;
                console.warn('Username prefix lookup:', error);
            }
            const users = [...found.values()].filter(u =>
                normalizeUsername(u.username || '').startsWith(value));
            for (const user of users) {
                const uid = user.uid;
                if (!friendsCache.some(f => String(f.uid || f.id) === uid)) {
                    try {
                        const pending = await getDoc(doc(db, 'users', uid, 'friendRequests', state.user.uid));
                        user.requestPending = pending.exists() && pending.data().status === 'pending';
                    } catch (_) { user.requestPending = false; }
                }
            }
            return users.slice(0, 12);
        }

        // Developer-only role management panel. Server-side Firestore Rules enforce ownership.
        const roleUserSearch = document.getElementById('roleUserSearch');
        const roleUserSearchBtn = document.getElementById('roleUserSearchBtn');
        const roleUserSearchResults = document.getElementById('roleUserSearchResults');
        const roleManagementStatus = document.getElementById('roleManagementStatus');
        let roleSearchTimer = null;
        let roleSearchGeneration = 0;
        function setRoleManagementStatus(message, isError = false) {
            if (!roleManagementStatus) return;
            roleManagementStatus.textContent = message;
            roleManagementStatus.classList.remove('hidden', 'bg-rose-500/10', 'text-rose-200', 'bg-emerald-500/10', 'text-emerald-200');
            roleManagementStatus.classList.add(isError ? 'bg-rose-500/10' : 'bg-emerald-500/10', isError ? 'text-rose-200' : 'text-emerald-200');
        }
        async function searchRoleUsers() {
            if (!state.user || state.user.uid !== DEVELOPER_UID) return;
            const value = roleUserSearch?.value?.trim() || '';
            if (value.replace(/^@/, '').length < 2) {
                roleUserSearchResults.innerHTML = '<p class="text-sm text-slate-500">Введи минимум 2 символа ника.</p>';
                return;
            }
            const generation = ++roleSearchGeneration;
            roleUserSearchResults.innerHTML = '<p class="text-sm text-slate-400">Ищем пользователей…</p>';
            try {
                const users = await findUsersByUsername(value);
                if (generation !== roleSearchGeneration) return;
                if (!users.length) {
                    roleUserSearchResults.innerHTML = '<p class="text-sm text-slate-500">Пользователи не найдены. Проверь @ник.</p>';
                    return;
                }
                await Promise.all(users.map(u => loadRole(u.uid)));
                roleUserSearchResults.innerHTML = users.map(u => {
                    const role = roleCache.get(u.uid) || 'user';
                    const status = role === 'admin' ? '<span class="text-xs font-semibold text-sky-300">Синяя звезда · администратор</span>' : '<span class="text-xs text-slate-500">Без звезды</span>';
                    const action = role === 'admin'
                        ? `<button type="button" data-role-remove="${escapeHTML(u.uid)}" class="rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200">Снять звезду</button>`
                        : `<button type="button" data-role-admin="${escapeHTML(u.uid)}" class="rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-slate-950">Назначить админом</button>`;
                    return `<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3"><div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-700 font-bold">${avatarMarkup(u,'h-10 w-10')}</div><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-white">${escapeHTML(u.displayName || 'Пользователь')} ${roleBadgeMarkup(u.uid)}</p><p class="truncate text-xs text-violet-300">@${escapeHTML(u.username || '')}</p><div class="mt-1">${status}</div></div>${action}</div>`;
                }).join('');
                roleUserSearchResults.querySelectorAll('[data-role-admin]').forEach(btn => btn.addEventListener('click', () => changeUserRole(btn.dataset.roleAdmin, 'admin')));
                roleUserSearchResults.querySelectorAll('[data-role-remove]').forEach(btn => btn.addEventListener('click', () => changeUserRole(btn.dataset.roleRemove, 'user')));
            } catch (error) {
                console.error('Role search failed:', error);
                roleUserSearchResults.innerHTML = '<p class="text-sm text-rose-200">Не удалось найти пользователей. Проверь Firestore Rules и индекс/поле username.</p>';
            }
        }
        async function changeUserRole(uid, role) {
            if (!state.user || state.user.uid !== DEVELOPER_UID) {
                setRoleManagementStatus('Нет доступа к панели управления.', true);
                return;
            }
            try {
                if (role === 'admin') await setDoc(doc(db, 'roles', uid), { role: 'admin' });
                else await deleteDoc(doc(db, 'roles', uid));
                roleCache.delete(uid);
                await loadRole(uid);
                setRoleManagementStatus(role === 'admin' ? 'Синяя звезда администратора назначена.' : 'Звезда снята.');
                await searchRoleUsers();
            } catch (error) {
                console.error('Role update failed:', error);
                setRoleManagementStatus(error?.code === 'permission-denied'
                    ? 'Firebase запретил изменение роли. Проверь, что UID разработчика одинаковый в app.js и firestore.rules, затем опубликуй Rules.'
                    : (error.message || 'Не удалось изменить роль.'), true);
            }
        }
        document.getElementById('roleManagementToggle')?.addEventListener('click', () => {
            if (state.user?.uid !== DEVELOPER_UID) return;
            const panel = document.getElementById('roleManagementPanel');
            if (!panel) return;
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        roleUserSearchBtn?.addEventListener('click', searchRoleUsers);
        roleUserSearch?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchRoleUsers(); } });
        roleUserSearch?.addEventListener('input', () => {
            clearTimeout(roleSearchTimer);
            roleSearchTimer = setTimeout(searchRoleUsers, 350);
        });

        socialSearchInput?.addEventListener('input', event => {
            clearTimeout(friendSearchTimer);
            const value = event.target.value.trim();
            const generation = ++searchGeneration;
            if (!value || value === '@') {
                socialSearchResults.innerHTML = '<p class="text-sm text-slate-500">Введи ник пользователя, например tania.</p>';
                return;
            }
            const normalized = normalizeUsername(value.replace(/^@/, ''));
            if (normalized.length < 2) {
                socialSearchResults.innerHTML = '<p class="text-sm text-slate-500">Введи минимум 2 символа ника.</p>';
                return;
            }
            socialSearchResults.innerHTML = '<p class="text-sm text-slate-400">Ищем пользователей…</p>';
            friendSearchTimer = setTimeout(async () => {
                try {
                    const users = await findUsersByUsername(value);
                    if (generation !== searchGeneration) return;
                    renderSearchUsers(users, socialSearchResults, generation);
                } catch (error) {
                    if (generation !== searchGeneration) return;
                    console.error('User search failed:', error);
                    const detail = error.code === 'permission-denied'
                        ? 'Нет доступа к профилям. Проверь Firestore Rules: чтение users и usernames для авторизованных пользователей.'
                        : 'Не удалось выполнить поиск. Проверь подключение и Firestore.';
                    socialSearchResults.innerHTML = `<p class="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">${detail}</p>`;
                }
            }, 250);
        });

        async function sendFriendRequest(targetUid) {
            if (!state.user || !targetUid || targetUid === state.user.uid) return;
            const existing = await getDoc(doc(db,'users',state.user.uid,'friends',targetUid));
            if (existing.exists()) { alert('Вы уже друзья.'); return; }
            const me = state.userProfile || {};
            const requestRef = doc(db,'users',targetUid,'friendRequests',state.user.uid);
            await setDoc(requestRef, { fromUid:state.user.uid, toUid:targetUid, displayName:me.displayName || 'Пользователь', username:me.username || '', photoURL:me.photoURL || '', status:'pending', createdAt:Date.now() });
            alert('Заявка отправлена!');
        }
        async function acceptFriend(fromUid) {
            if (!state.user || !fromUid) return;
            const requestRef = doc(db,'users',state.user.uid,'friendRequests',fromUid);
            const requestSnap = await getDoc(requestRef);
            if (!requestSnap.exists()) return;
            const req = requestSnap.data();
            const me = state.userProfile || {};
            const otherSnap = await getDoc(doc(db,'users',fromUid));
            const other = otherSnap.exists() ? otherSnap.data() : req;
            const batchFriend = { uid:fromUid, displayName:other.displayName || req.displayName || 'Друг', username:other.username || req.username || '', photoURL:other.photoURL || req.photoURL || '', addedAt:Date.now() };
            await setDoc(doc(db,'users',state.user.uid,'friends',fromUid), batchFriend);
            await setDoc(doc(db,'users',fromUid,'friends',state.user.uid), { uid:state.user.uid, displayName:me.displayName || 'Пользователь', username:me.username || '', photoURL:me.photoURL || '', addedAt:Date.now() });
            await deleteDoc(requestRef);
        }
        async function rejectFriend(fromUid) {
            if (!state.user) return;
            await deleteDoc(doc(db,'users',state.user.uid,'friendRequests',fromUid));
        }
        async function openConversation(friendUid) {
            if (!state.user || !friendUid || friendUid === state.user.uid) return;
            const uid = String(friendUid);
            const friendDoc = friendsCache.find(f => String(f.uid || f.id) === uid);
            if (!friendDoc) {
                console.warn('Friend is not in local cache; attempting direct lookup', uid);
            }
            activeFriend = uid;
            activeGroupId = null;
            const convHeader = document.getElementById('conversationHeader'); if (convHeader) convHeader.innerHTML = `<button id="conversationBack" class="mr-2 rounded-lg px-2 py-1" aria-label="Назад">‹</button>${escapeHTML(friendDoc?.displayName || 'Чат')} <span class="text-xs text-slate-500">Личный чат</span>`;
            setTimeout(()=>document.getElementById('conversationBack')?.addEventListener('click',()=>socialChatsPanel.classList.remove('chat-open')),0);
            localStorage.setItem(unreadStorageKey(uid), String(Date.now()));
            state.unreadCounts.set(uid, 0); updateUnreadBadge();
            const pair = [state.user.uid, uid].sort();
            activeConversationId = pair.join('_');
            const host = document.getElementById('messagesList');
            const input = document.getElementById('messageInput');
            const send = document.getElementById('sendMessageBtn');
            const game = document.getElementById('snakeChallengeBtn');
            const pane = document.getElementById('conversationPane');
            if (pane) pane.classList.remove('hidden', 'conversation-empty');
            socialChatsPanel.classList.add('chat-open');
            if (host) host.innerHTML = '<p class="text-sm text-slate-400">Открываем переписку…</p>';
            if (input) input.disabled = true;
            if (send) send.disabled = true;
            if (game) game.disabled = true;
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }

            try {
                // Read the canonical friend document before attempting to create a conversation.
                const friendRef = doc(db, 'users', state.user.uid, 'friends', uid);
                const friendSnap = await getDoc(friendRef);
                if (!friendSnap.exists()) {
                    throw new Error('FRIEND_DOC_MISSING: Этот пользователь отсутствует в списке друзей текущего аккаунта.');
                }
                const friendData = { uid, ...friendSnap.data() };
                updateConversationPresence(uid);
                const conversationRef = doc(db, 'conversations', activeConversationId);
                const conversationSnap = await getDoc(conversationRef);
                if (!conversationSnap.exists()) {
                    await setDoc(conversationRef, {
                        participants: pair,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                } else {
                    const participants = conversationSnap.data().participants || [];
                    if (participants.length !== 2 || !participants.includes(state.user.uid) || !participants.includes(uid)) {
                        throw new Error('CHAT_PARTICIPANTS_MISMATCH: Документ переписки содержит другие UID.');
                    }
                }

                const freshConversation = await getDoc(conversationRef); const wallpaperURL = freshConversation.exists() ? freshConversation.data().wallpaperURL : ''; const messageArea = document.getElementById('messagesList'); if(messageArea){messageArea.style.backgroundImage=wallpaperURL?`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${wallpaperURL}")`:'';messageArea.style.backgroundSize='cover';}
                const messagesCol = collection(db, 'conversations', activeConversationId, 'messages');
                state.messageUnsub = onSnapshot(
                    query(messagesCol, orderBy('createdAt', 'asc'), limit(100)),
                    snap => {
                        if (activeConversationId !== pair.join('_')) return;
                        if (!host) return;
                        if (snap.empty) host.innerHTML = '<p class="text-sm text-slate-500">Пока нет сообщений. Напиши первым 👋</p>';
                        else host.innerHTML = snap.docs.map(d => {
                            const m = d.data();
                            const mine = m.senderUid === state.user.uid;
                            if (m.type === 'snake-challenge') return `<div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"><b>🎮 Вызов в Змейку</b><p class="mt-1 text-xs text-slate-300">${escapeHTML(m.text || 'Сыграем?')}</p><button data-playchallenge="${escapeHTML(d.id)}" class="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold">Играть</button></div>`;
                            if (m.type === 'snake-result') return `<div class="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm">🐍 ${escapeHTML(m.text || '')}</div>`;
                            if(m.type==='sticker') return `<div class="flex ${mine?'justify-end':'justify-start'}"><div class="max-w-[85%] rounded-2xl p-2"><img src="${escapeHTML(m.text||'')}" alt="Стикер" class="max-h-36 max-w-36 rounded-xl object-contain"><p class="mt-1 text-right text-[10px] text-slate-400">${m.createdAt?new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</p></div></div>`; const senderName=mine?(state.userProfile?.displayName||'Вы'):(friendDoc?.displayName||'Друг');const senderPremium=mine?Number(state.userProfile?.premiumUntil||0)>Date.now():Number(friendDoc?.premiumUntil||0)>Date.now();return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}"><div class="max-w-[85%] rounded-2xl ${mine ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-100'} px-3 py-2 text-sm"><p class="mb-1 text-[10px] font-bold ${senderPremium?'vv-premium-name':''}">${escapeHTML(senderName)}${senderPremium?' 👑':''}</p><p class="whitespace-pre-wrap break-words">${escapeHTML(m.text || '')}</p><p class="mt-1 text-right text-[10px] opacity-60">${m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</p></div></div>`;
                        }).join('');
                        host.querySelectorAll('[data-playchallenge]').forEach(b => b.addEventListener('click', () => startSnake(b.dataset.playchallenge)));
                        host.scrollTop = host.scrollHeight;
                        localStorage.setItem(unreadStorageKey(uid), String(Date.now()));
                        state.unreadCounts.set(uid, 0); updateUnreadBadge(); renderChatFriends();
                    },
                    err => {
                        console.error('Chat messages listener failed:', err);
                        if (host) host.innerHTML = `<div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">Не удалось загрузить сообщения (${escapeHTML(err.code || 'unknown')}). Проверь Firestore Rules и доступ к документу conversations/${escapeHTML(activeConversationId)}.</div>`;
                    }
                );
                if (input) input.disabled = false;
                if (send) send.disabled = false;
                if (game) game.disabled = false;
                renderChatFriends();
                showTab('chats');
            } catch (e) {
                console.error('Conversation open failed:', e);
                if (host) host.innerHTML = `<div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"><b>Не удалось открыть чат</b><p class="mt-1">${escapeHTML(e.message || e.code || 'Неизвестная ошибка')}</p><p class="mt-2 text-xs text-rose-300">Проверь, что оба аккаунта добавлены друг к другу в друзья и опубликованы актуальные Firestore Rules.</p></div>`;
                if (input) input.disabled = true;
                if (send) send.disabled = true;
                if (game) game.disabled = true;
            }
        }
        document.getElementById('messageForm')?.addEventListener('submit', async e => {
            e.preventDefault();
            const text = document.getElementById('messageInput').value.trim();
            if (!text || !state.user) return;
            if (activeGroupId) {
                const sendBtn = document.getElementById('sendMessageBtn'); if (sendBtn.disabled) return; sendBtn.disabled = true;
                try { const groupId=activeGroupId; await addDoc(collection(db,'groups',groupId,'messages'), {senderUid:state.user.uid,text:text.slice(0,1000),type:'text',createdAt:Date.now()}); await updateDoc(doc(db,'groups',groupId),{updatedAt:Date.now(),lastMessage:text.slice(0,100)}); document.getElementById('messageInput').value=''; } catch(err) { console.error('Group message failed',err); alert('Не удалось отправить сообщение в группу. Проверь Firestore Rules.'); } finally {sendBtn.disabled=false;} return;
            }
            if (!activeConversationId || !activeFriend) return;
            const sendBtn = document.getElementById('sendMessageBtn'); if (sendBtn.disabled) return; sendBtn.disabled = true;
            const payload = { senderUid:state.user.uid, text:text.slice(0,1000), type:'text', createdAt:Date.now(), clientMessageId: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) };
            try {
                const conversationRef = doc(db,'conversations',activeConversationId);
                await setDoc(conversationRef, { participants:[state.user.uid,activeFriend].sort(), updatedAt:Date.now(), lastMessage:text.slice(0,100) }, {merge:true});
                await addDoc(collection(db,'conversations',activeConversationId,'messages'), payload);
                document.getElementById('messageInput').value='';
            } catch (err) { console.error('Message send failed',err); alert('Сообщение не отправлено. Проверь Firestore Rules.'); } finally { sendBtn.disabled = false; }
        });
        document.getElementById('snakeChallengeBtn')?.addEventListener('click', () => {
            if (!activeConversationId || !activeFriend || !state.user) return;
            document.getElementById('gamesModal').classList.remove('hidden');
        });
        document.getElementById('gamesClose')?.addEventListener('click', () => document.getElementById('gamesModal').classList.add('hidden'));
        document.getElementById('gameSnakeChoice')?.addEventListener('click', async () => {
            if (!activeConversationId || !activeFriend || !state.user) return;
            const choice = document.getElementById('gameSnakeChoice');
            if (state.challengeSending) return;
            state.challengeSending = true; if (choice) choice.disabled = true;
            try {
                await setDoc(doc(db,'conversations',activeConversationId), { participants:[state.user.uid,activeFriend].sort(), updatedAt:Date.now(), lastMessage:'🎮 Вызов в Змейку' }, {merge:true});
                const challengeRef = await addDoc(collection(db,'conversations',activeConversationId,'messages'), { senderUid:state.user.uid, text:'Вызов в Змейку! Сыграй и побей мой результат.', type:'snake-challenge', createdAt:Date.now() });
                document.getElementById('gamesModal').classList.add('hidden');
                startSnake(challengeRef.id);
            } catch (err) { console.error(err); alert('Не удалось отправить вызов.'); }
            finally { state.challengeSending = false; if (choice) choice.disabled = false; }
        });

        const snakeCanvas = document.getElementById('snakeCanvas');
        const snakeCtx = snakeCanvas.getContext('2d');
        const gridN = 20, cell = snakeCanvas.width / gridN;
        let snakeLastTick = 0, snakeAccumulator = 0, snakeFrame = 0, snakeTouchStart = null;
        function drawSnake() {
            const g=snakeCtx, st=state.snakeState; if(!st)return;
            g.clearRect(0,0,snakeCanvas.width,snakeCanvas.height);
            const bg=g.createLinearGradient(0,0, snakeCanvas.width,snakeCanvas.height); bg.addColorStop(0,'#071426'); bg.addColorStop(1,'#10102b');
            g.fillStyle=bg; g.fillRect(0,0,snakeCanvas.width,snakeCanvas.height);
            g.strokeStyle='rgba(148,163,184,.055)'; g.lineWidth=1;
            for(let i=1;i<gridN;i++){g.beginPath();g.moveTo(i*cell,0);g.lineTo(i*cell,snakeCanvas.height);g.stroke();g.beginPath();g.moveTo(0,i*cell);g.lineTo(snakeCanvas.width,i*cell);g.stroke();}
            const fx=(st.food.x+.5)*cell, fy=(st.food.y+.5)*cell;
            g.shadowColor='#fb7185';g.shadowBlur=16;g.fillStyle='#fb7185';g.beginPath();g.arc(fx,fy,cell*.30,0,Math.PI*2);g.fill();g.shadowBlur=0;
            st.body.forEach((pt,i)=>{const inset=i===0?1.2:2.2;g.fillStyle=i===0?'#c4b5fd':`rgba(139,92,246,${Math.max(.38, .88-i*.018)})`;g.shadowColor=i===0?'#a78bfa':'transparent';g.shadowBlur=i===0?10:0;g.beginPath();g.roundRect(pt.x*cell+inset,pt.y*cell+inset,cell-inset*2,cell-inset*2,cell*.25);g.fill();});g.shadowBlur=0;
            // Eyes show the current heading.
            const h=st.body[0], d=st.dir; const ex=h.x*cell+cell/2+d.x*cell*.19, ey=h.y*cell+cell/2+d.y*cell*.19;
            g.fillStyle='#17112e'; for(const side of [-1,1]){g.beginPath();g.arc(ex+(d.y?side*cell*.16:0),ey+(d.x?-side*cell*.16:0),cell*.055,0,Math.PI*2);g.fill();}
        }
        function startSnake(challengeId) {
            if(state.snakeTimer) cancelAnimationFrame(state.snakeTimer);
            state.snakeChallengeId=challengeId || null;
            document.getElementById('snakeModal').classList.remove('hidden');
            document.getElementById('snakeHint').textContent = challengeId ? 'Сыграй один раунд и отправь другу результат.' : 'Собирай еду, не врезайся в стены и собственный хвост.';
            document.getElementById('snakeScore').textContent='0';
            document.getElementById('snakeBest').textContent='Рекорд: '+Number(localStorage.getItem('voicevibeSnakeBest')||0);
            document.getElementById('snakeStart').textContent='Начать игру';
            resetSnake();
        }
        function resetSnake() {
            if(state.snakeTimer) cancelAnimationFrame(state.snakeTimer);
            state.snakeState={body:[{x:9,y:10},{x:8,y:10},{x:7,y:10}],dir:{x:1,y:0},nextDir:{x:1,y:0},food:{x:14,y:10},score:0,over:true,resultSent:false};
            placeFood(); drawSnake();
        }
        function placeFood(){const st=state.snakeState;let p;do{p={x:Math.floor(Math.random()*gridN),y:Math.floor(Math.random()*gridN)}}while(st.body.some(b=>b.x===p.x&&b.y===p.y));st.food=p;}
        function snakeStep(){
            const st=state.snakeState;if(!st||st.over)return false;
            const h=st.body[0],d=st.nextDir;st.dir=d;const nh={x:h.x+d.x,y:h.y+d.y};
            const eating=nh.x===st.food.x&&nh.y===st.food.y;
            if(nh.x<0||nh.y<0||nh.x>=gridN||nh.y>=gridN||st.body.some((b,i)=>i>(eating? -1:0)&&i<st.body.length- (eating?0:1)&&b.x===nh.x&&b.y===nh.y)){endSnake();return false;}
            st.body.unshift(nh);
            if(eating){st.score+=10;placeFood();document.getElementById('snakeScore').textContent=String(st.score);}else st.body.pop();
            drawSnake(); return true;
        }
        function snakeLoop(now){
            const st=state.snakeState;if(!st||st.over)return;
            if(!snakeLastTick)snakeLastTick=now;
            snakeAccumulator+=Math.min(50,now-snakeLastTick);snakeLastTick=now;
            const interval=Math.max(135,225-Math.floor(st.score/30)*8);
            while(snakeAccumulator>=interval){snakeAccumulator-=interval;if(!snakeStep())return;}
            state.snakeTimer=requestAnimationFrame(snakeLoop);
        }
        function runSnake(){let st=state.snakeState;if(!st)return;if(!st.over)return;resetSnake();st=state.snakeState;st.over=false;snakeLastTick=0;snakeAccumulator=0;if(state.snakeTimer)cancelAnimationFrame(state.snakeTimer);state.snakeTimer=requestAnimationFrame(snakeLoop);document.getElementById('snakeStart').textContent='Игра идёт…';}
        async function endSnake(){
            const st=state.snakeState;if(!st||st.over)return;st.over=true;if(state.snakeTimer)cancelAnimationFrame(state.snakeTimer);state.snakeTimer=null;
            const previous=Number(localStorage.getItem('voicevibeSnakeBest')||0),best=Math.max(st.score,previous);localStorage.setItem('voicevibeSnakeBest',String(best));
            document.getElementById('snakeBest').textContent='Твой рекорд: '+best;document.getElementById('snakeHint').textContent=`Игра окончена · ${st.score} очков`;
            document.getElementById('snakeStart').textContent='Играть ещё';
            const challengeId=state.snakeChallengeId;
            if(challengeId&&state.user&&activeConversationId&&activeFriend&&!st.resultSent){
                const sentKey='voicevibeSnakeSent:'+challengeId;
                if(!localStorage.getItem(sentKey)){
                    st.resultSent=true;localStorage.setItem(sentKey,'pending');
                    try{await addDoc(collection(db,'conversations',activeConversationId,'messages'),{senderUid:state.user.uid,text:`Результат: ${st.score} очков · рекорд: ${best}`,type:'snake-result',score:st.score,best,challengeId,createdAt:Date.now()});localStorage.setItem(sentKey,'sent');}
                    catch(e){localStorage.removeItem(sentKey);console.warn('Could not post snake score',e);}
                }
                state.snakeChallengeId=null;
            }
        }
        document.getElementById('snakeStart')?.addEventListener('click',runSnake);
        document.getElementById('snakeClose')?.addEventListener('click',()=>{if(state.snakeTimer)cancelAnimationFrame(state.snakeTimer);state.snakeTimer=null;state.snakeChallengeId=null;document.getElementById('snakeModal').classList.add('hidden');});
        document.querySelectorAll('.snake-dir').forEach(b=>b.addEventListener('click',()=>setSnakeDirection(b.dataset.dir)));
        function setSnakeDirection(dir){const st=state.snakeState;if(!st||st.over)return;const d={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}[dir];if(d&&!(d.x===-st.dir.x&&d.y===-st.dir.y))st.nextDir=d;}
        document.addEventListener('keydown',e=>{if(document.getElementById('snakeModal').classList.contains('hidden'))return;const map={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'};if(map[e.key]){e.preventDefault();setSnakeDirection(map[e.key]);}});
        snakeCanvas?.addEventListener('touchstart',e=>{const t=e.changedTouches[0];snakeTouchStart={x:t.clientX,y:t.clientY};},{passive:true});
        snakeCanvas?.addEventListener('touchend',e=>{if(!snakeTouchStart)return;const t=e.changedTouches[0],dx=t.clientX-snakeTouchStart.x,dy=t.clientY-snakeTouchStart.y;snakeTouchStart=null;if(Math.max(Math.abs(dx),Math.abs(dy))<18)return;setSnakeDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));},{passive:true});

        // Friend button is shown after a real roulette connection; the matched UID is taken from the queue document.
        const addFriendButton = document.createElement('button');
        addFriendButton.id='addRouletteFriend'; addFriendButton.className='hidden mt-3 rounded-full border border-violet-300/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-950/30 transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0'; addFriendButton.innerHTML='<i class="fa-solid fa-user-plus mr-2"></i>Добавить в друзья';
        chatStatusDesc?.parentElement?.appendChild(addFriendButton);
        addFriendButton.addEventListener('click',async()=>{try{if(!state.currentMatchUid){alert('Не удалось определить аккаунт собеседника. Попробуйте ещё раз или познакомьтесь через чат.');return;}await sendFriendRequest(state.currentMatchUid); }catch(e){console.error(e);alert('Не удалось отправить заявку. Проверь Firestore Rules.');}});
        const oldHandleConnectedStream = handleConnectedStream;
        // Wrap only the UI update; keep existing WebRTC connection logic intact.
        const connectedObserver = new MutationObserver(()=>{addFriendButton.classList.toggle('hidden',!state.isConnected||!state.currentMatchUid);});
        if(chatStatusTitle) connectedObserver.observe(chatStatusTitle,{childList:true,subtree:true,characterData:true});

        // Listeners
        btnStartSearch.addEventListener('click', startSearch);
        btnSkip.addEventListener('click', skipPeer);
        btnPause.addEventListener('click', pauseSearch);
        btnToggleMic.addEventListener('click', toggleMicrophone);
        btnExitMenu.addEventListener('click', exitToMenu);
        btnExitMenuBottom.addEventListener('click', exitToMenu);
