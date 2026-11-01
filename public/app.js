import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, getCountFromServer, 
            collection, 
            doc, 
            setDoc, 
            getDoc,
            deleteDoc, arrayUnion, arrayRemove, 
            onSnapshot, query, where, orderBy, limit, limitToLast, writeBatch, getDocs, addDoc, updateDoc, serverTimestamp, runTransaction
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
            if (user) initializeFriendCalls(user.uid); else cleanupFriendCalls();
            if (user) {
                // Hide the sign-in screen immediately; profile loading happens behind the app.
                document.getElementById('authOverlay')?.classList.add('hidden');
                try {
                    const profileSnap = await getDoc(doc(db, 'users', user.uid));
                    if (state.user?.uid !== user.uid) return;
                    state.userProfile = profileSnap.exists() ? profileSnap.data() : {
                        displayName: (user.displayName || 'Пользователь').slice(0,30),
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
                    if (state.user?.uid !== user.uid) return;
                    applyProfileToUI();
                    document.getElementById('authOverlay')?.classList.add('hidden');
                    document.getElementById('profileBtn')?.classList.remove('hidden');
                    document.getElementById('bottomNav')?.classList.remove('hidden');
                    startSocialListeners();
                    renderSocialProfile();
                } catch (err) {
                    console.error('Profile load failed:', err);
                    document.getElementById('authOverlay')?.classList.remove('hidden');
                    showAuthMessage('Вход выполнен, но не удалось загрузить профиль. Проверьте Rules Firestore.');
                }
            } else {
                state.userProfile = null;
                friendsCache = []; groupsCache = []; friendRequestsCache = []; recentChatTimes.clear();
                state.presenceCache.clear(); state.friendProfiles.clear();
                closeConversation(); closeStoryViewer(); activeStoryItems = []; activeStoryIndex = 0;
                document.getElementById('storiesList')?.replaceChildren();
                document.getElementById('vvStoryMentionInbox')?.replaceChildren();
                renderFriends(); renderChatFriends();
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
                if (state.user?.uid) { avatarEl.dataset.storyAvatar = state.user.uid; avatarEl.setAttribute('role','button'); avatarEl.tabIndex=0; }
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
            if (preview) preview.innerHTML = avatarMarkup({...p,uid:state.user?.uid}, 'h-14 w-14');
            const removeAvatarButton = document.getElementById('btnRemoveAvatar');
            if (removeAvatarButton) { removeAvatarButton.dataset.remove = 'false'; removeAvatarButton.innerHTML = '<i class="fa-regular fa-trash-can mr-1"></i> Удалить аватар'; removeAvatarButton.classList.remove('border-rose-500/50','text-rose-200'); }
            document.getElementById('profileEmailText').textContent = state.user?.email || 'Аккаунт VoiceVibe';
            const changedAt = Number(p.usernameChangedAt || 0);
            const remaining = Math.max(0, 14*24*60*60*1000 - (Date.now()-changedAt));
            const hint = document.getElementById('usernameChangeHint');
            if (hint) hint.textContent = remaining ? `Следующая смена @nickname через ${Math.ceil(remaining/86400000)} дн.` : 'Можно менять @nickname. Следующая смена будет доступна через 14 дней.';
            // Premium-only banner controls live exclusively in the profile editor.
            const bannerSection = document.getElementById('profileBannerPremiumSection');
            const premiumActive = Number(p.premiumUntil || 0) > Date.now();
            if (bannerSection) bannerSection.classList.toggle('hidden', !premiumActive);
            const bannerInput = document.getElementById('profileBannerFile');
            if (bannerInput) bannerInput.value = '';
            const bannerFilename = document.getElementById('profileBannerFileName');
            if (bannerFilename) bannerFilename.textContent = 'Файл не загружен';
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
                preview.innerHTML = avatarMarkup({...state.userProfile,uid:state.user?.uid}, 'h-14 w-14');
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
            const randomID = 'vr-' + safeAgeTag + '-' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 18) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

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
                if (state.searchConnectTimeout) clearTimeout(state.searchConnectTimeout);
                if (state.peerReconnectTimer) { clearTimeout(state.peerReconnectTimer); state.peerReconnectTimer = null; }
                if (state.pendingRouletteSearch) { state.pendingRouletteSearch = false; setTimeout(() => startSearch(), 0); }
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
                        try { state.peer.reconnect(); } catch (e) { console.warn('Peer reconnect failed:', e); initPeerJS(); }
                    }
                }, 1200);
            });
            state.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                setPeerStatus('error', err?.type === 'network' ? 'Проблема сети — повтор подключения' : 'Ошибка P2P — повторите поиск');
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
            if (state.isConnected || state.isSearching || state.searchStarting) return;
            if (!state.peer || !state.myPeerId || state.peer.disconnected || state.peer.destroyed) {
                state.pendingRouletteSearch = true;
                setPeerStatus('connecting', 'Подключаем поиск…');
                chatStatusTitle.textContent = 'Подключаемся к сети';
                chatStatusDesc.textContent = 'Поиск начнётся автоматически после подключения.';
                if (!state.peer || state.peer.destroyed) initPeerJS();
                else if (state.peer.disconnected) { try { state.peer.reconnect(); } catch (_) { initPeerJS(); } }
                clearTimeout(state.searchConnectTimeout);
                state.searchConnectTimeout = setTimeout(() => {
                    if (!state.pendingRouletteSearch || state.isSearching || state.isConnected) return;
                    state.pendingRouletteSearch = false;
                    chatStatusTitle.textContent = 'Сервер голосовой связи недоступен';
                    chatStatusDesc.textContent = 'Проверьте интернет и нажмите «Искать» ещё раз.';
                    setPeerStatus('error', 'Нет подключения к голосовому серверу');
                    try { state.peer?.destroy(); } catch (_) {}
                    state.peer = null; state.myPeerId = null;
                }, 12000);
                return;
            }
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
                clearInterval(state.queueHeartbeat);
                state.queueHeartbeat = setInterval(() => {
                    if (!state.isSearching || !state.myPeerId || state.isConnected) { clearInterval(state.queueHeartbeat); return; }
                    setDoc(doc(db, 'artifacts', appId, 'public', 'data', queueName, state.myPeerId),
                        {peerId:state.myPeerId, ownerUid:state.user.uid, timestamp:Date.now()})
                      .catch(err => console.warn('Queue heartbeat failed:', err));
                }, 20000);
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
                    clearInterval(state.queueHeartbeat);
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
                clearInterval(state.queueHeartbeat);
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
                    if (state.isSearching && !state.isConnected) {
                        chatStatusTitle.textContent = 'Ищем доступного собеседника…';
                        chatStatusDesc.textContent = 'Предыдущий пользователь не ответил, поиск продолжается.';
                    }
                }
            }, 15000);
        }

        async function removeFromMatchmakingQueue() {
            state.isSearching = false;
            clearInterval(state.queueHeartbeat);
            clearTimeout(state.searchConnectTimeout);
            state.pendingRouletteSearch = false;
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
        // Direct friend-to-friend voice calls use a separate PeerJS connection.
        // The roulette peer and its matchmaking state are not affected.
        let vvFriendPeer = null, vvFriendCall = null, vvFriendStream = null;
        let vvFriendCallUid = null, vvFriendCallPending = null;
        let vvFriendPeerUid = null;
        const vvCallUI = () => ({
            panel:document.getElementById('vvFriendCallOverlay'),
            name:document.getElementById('vvFriendCallName'),
            status:document.getElementById('vvFriendCallStatus'),
            accept:document.getElementById('vvFriendCallAccept'),
            mute:document.getElementById('vvFriendCallMute'),
            audio:document.getElementById('vvFriendCallAudio')
        });
        // Original soft two-tone call sound, synthesized locally (no copyrighted audio).
        let vvRingContext=null, vvRingTimer=null, vvRingIncoming=false;
        let vvCallVolumeMode='loud';
        function vvSetCallVolume(mode){
            vvCallVolumeMode=mode==='quiet'?'quiet':'loud';
            const audio=vvCallUI().audio;
            if(audio){audio.muted=false;audio.volume=vvCallVolumeMode==='quiet'?0.28:1;}
            document.querySelectorAll('[data-vv-call-volume]').forEach(button=>{
                const selected=button.dataset.vvCallVolume===vvCallVolumeMode;
                button.setAttribute('aria-pressed',String(selected));
                button.classList.toggle('bg-violet-600',selected);
                button.classList.toggle('border-violet-400',selected);
            });
        }
        document.querySelectorAll('[data-vv-call-volume]').forEach(button=>button.addEventListener('click',()=>{
            vvSetCallVolume(button.dataset.vvCallVolume);
            vvUnlockCallAudio();
        }));
        vvSetCallVolume('loud');
        // Original ringtone: gentle ascending chimes for incoming calls,
        // lower repeating pulses for outgoing calls. No external sound files.
        function vvRingBeep(){
            if(!vvRingContext || vvRingContext.state!=='running')return;
            const now=vvRingContext.currentTime;
            const notes=vvRingIncoming
                ? [[0,587.33],[0.20,739.99],[0.42,880],[0.68,739.99]]
                : [[0,440],[0.25,554.37]];
            for(const [offset,freq] of notes){
                const osc=vvRingContext.createOscillator(), gain=vvRingContext.createGain();
                osc.type='sine';osc.frequency.setValueAtTime(freq,now+offset);
                gain.gain.setValueAtTime(0.0001,now+offset);
                gain.gain.exponentialRampToValueAtTime(0.075,now+offset+0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.19);
                osc.connect(gain);gain.connect(vvRingContext.destination);
                osc.start(now+offset);osc.stop(now+offset+0.20);
            }
        }
        function vvRingStop(){
            if(vvRingTimer!==null){clearInterval(vvRingTimer);vvRingTimer=null;}
            vvRingIncoming=false;
        }
        function vvRingStart(incoming=false){
            vvRingStop();vvRingIncoming=incoming;
            try{
                vvRingContext ||= new (window.AudioContext||window.webkitAudioContext)();
                vvRingContext.resume().then(()=>{if(vvRingIncoming===incoming && vvFriendCallUid)vvRingBeep()}).catch(()=>{});
                vvRingTimer=setInterval(vvRingBeep,2600);
            }catch(e){console.warn('Call ringtone unavailable:',e)}
        }
        function vvUnlockCallAudio(){
            try{vvRingContext?.resume().catch(()=>{});}catch(_){}
            const audio=vvCallUI().audio;
            if(audio?.srcObject){audio.muted=false;audio.volume=vvCallVolumeMode==='quiet'?0.28:1;audio.play().catch(()=>{});}
        }
        document.addEventListener('pointerdown',()=>{
            if(vvFriendCallUid)vvUnlockCallAudio();
        },{passive:true});
        function vvCallShow(name,status,incoming=false){
            const u=vvCallUI();u.panel?.classList.remove('hidden');
            if(u.name)u.name.textContent=name;
            if(u.status)u.status.textContent=status;
            u.accept?.classList.toggle('hidden',!incoming);
            u.mute?.classList.add('hidden');
        }
        function vvCallStatus(status,connected=false){
            const u=vvCallUI();if(u.status)u.status.textContent=status;
            u.accept?.classList.add('hidden');u.mute?.classList.toggle('hidden',!connected);
        }
        function vvCallEnd(){
            vvRingStop();
            const call=vvFriendCall;vvFriendCall=null;vvFriendCallPending=null;vvFriendCallUid=null;
            try{call?.close()}catch(_){}
            if(vvFriendStream){vvFriendStream.getTracks().forEach(t=>t.stop());vvFriendStream=null;}
            const u=vvCallUI();if(u.audio){u.audio.pause();u.audio.srcObject=null;}
            u.panel?.classList.add('hidden');u.accept?.classList.add('hidden');u.mute?.classList.add('hidden');
        }
        function cleanupFriendCalls(){vvCallEnd();try{vvFriendPeer?.destroy()}catch(_){}vvFriendPeer=null;vvFriendPeerUid=null;}
        function vvCallBind(call){
            vvFriendCall=call;
            call.on('stream',stream=>{
                if(vvFriendCall!==call)return;
                vvRingStop();
                const u=vvCallUI();if(u.audio){u.audio.autoplay=true;u.audio.playsInline=true;u.audio.muted=false;u.audio.volume=vvCallVolumeMode==='quiet'?0.28:1;u.audio.srcObject=stream;u.audio.play().catch(err=>{console.warn('Audio playback needs user action:',err);const btn=document.getElementById('vvFriendCallListen');btn?.classList.add('vv-audio-attention');});}
                vvCallStatus('Разговор идёт',true);
            });
            call.on('close',()=>{if(vvFriendCall===call)vvCallEnd()});
            call.on('error',()=>{if(vvFriendCall===call){alert('Ошибка голосового соединения.');vvCallEnd();}});
        }
        function initializeFriendCalls(uid){
            if(vvFriendPeerUid===uid && vvFriendPeer && !vvFriendPeer.destroyed)return;
            cleanupFriendCalls();vvFriendPeerUid=uid;
            if(typeof Peer==='undefined'){console.warn('PeerJS не загружен: звонки недоступны');return;}
            // A deterministic peer ID makes it possible to call a friend without a new database collection.
            const peer=new Peer('vv-friend-'+uid,{debug:0});vvFriendPeer=peer;
            peer.on('call',async call=>{
                const fromUid=String(call.peer||'').replace(/^vv-friend-/,'');
                // Validate friendship against Firestore, not just a cached UI list.
                if(!state.user || !fromUid || fromUid===uid || vvFriendCall || vvFriendCallPending){call.close();return;}
                try{
                    const friendship=await getDoc(doc(db,'users',uid,'friends',fromUid));
                    if(!friendship.exists() || state.user?.uid!==uid || vvFriendCall || vvFriendCallPending){call.close();return;}
                }catch(e){console.warn('Friend call authorization:',e);call.close();return;}
                vvFriendCallPending=call;vvFriendCallUid=fromUid;
                const friend=friendsCache.find(f=>(f.uid||f.id)===fromUid);
                vvCallShow(friend?.displayName||'Друг','Входящий голосовой звонок',true);vvRingStart(true);
                call.on('close',()=>{if(vvFriendCallPending===call)vvCallEnd()});
            });
            peer.on('error',err=>{console.warn('Friend call peer:',err?.type||err);if(vvFriendCallUid && !vvFriendCallPending){vvCallStatus('Друг недоступен или занят');setTimeout(()=>{if(vvFriendCallUid)vvCallEnd()},2200);}});
            peer.on('disconnected',()=>{try{if(!peer.destroyed)peer.reconnect()}catch(_){}});
        }
        async function startFriendCall(friendUid){
            if(!state.user || !friendsCache.some(f=>(f.uid||f.id)===friendUid)){alert('Звонить можно только друзьям.');return;}
            if(vvFriendCall || vvFriendCallPending || vvFriendCallUid){alert('Сначала заверши текущий звонок.');return;}
            if(!vvFriendPeer || !vvFriendPeer.open){alert('Подключение звонков ещё не готово. Попробуй через пару секунд.');return;}
            const friend=friendsCache.find(f=>(f.uid||f.id)===friendUid);
            vvFriendCallUid=friendUid;vvCallShow(friend?.displayName||'Друг','Запрашиваем микрофон…');
            try{
                vvFriendStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
                if(vvFriendCallUid!==friendUid){vvFriendStream.getTracks().forEach(t=>t.stop());vvFriendStream=null;return;}
                const call=vvFriendPeer.call('vv-friend-'+friendUid,vvFriendStream);
                if(!call)throw new Error('Не удалось начать звонок');
                vvCallBind(call);vvCallStatus('Звоним другу…');vvRingStart(false);
                setTimeout(()=>{if(vvFriendCall===call && !vvCallUI().audio?.srcObject){vvCallStatus('Нет ответа. Друг должен быть онлайн.');setTimeout(()=>{if(vvFriendCall===call && !vvCallUI().audio?.srcObject)vvCallEnd()},3000);}},30000);
            }catch(e){console.warn('Friend call start:',e);alert('Не удалось начать звонок. Проверь доступ к микрофону.');vvCallEnd();}
        }
        document.getElementById('vvFriendCallAccept')?.addEventListener('click',async()=>{
            const call=vvFriendCallPending;if(!call)return;
            vvRingStop();vvUnlockCallAudio();vvCallStatus('Подключаем микрофон…');
            try{
                const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
                if(vvFriendCallPending!==call){stream.getTracks().forEach(t=>t.stop());return;}
                vvFriendStream=stream;vvFriendCallPending=null;vvCallBind(call);call.answer(stream);vvCallStatus('Соединяем…');
            }catch(e){alert('Нет доступа к микрофону.');vvCallEnd();}
        });
        document.getElementById('vvFriendCallHangup')?.addEventListener('click',vvCallEnd);
        document.getElementById('vvFriendCallMute')?.addEventListener('click',()=>{
            if(!vvFriendStream)return;
            const tracks=vvFriendStream.getAudioTracks();if(!tracks.length)return;
            const enabled=!tracks[0].enabled;tracks.forEach(t=>t.enabled=enabled);
            document.getElementById('vvFriendCallMute').innerHTML=enabled?'<i class="fa-solid fa-microphone mr-2"></i>Микрофон':'<i class="fa-solid fa-microphone-slash mr-2"></i>Включить';
        });

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
        document.getElementById('vvProfileEditAction')?.addEventListener('click',()=>document.getElementById('socialEditProfile')?.click());
        // Chat avatars are decorative: do not intercept chat navigation to open a story/profile.
        // Everywhere outside chats, avatarMarkup still retains its original click behavior.
        function chatAvatarMarkup(profile, size='h-10 w-10') {
            return avatarMarkup(profile, size)
                .replace(/data-story-avatar=/g, 'data-chat-avatar=')
                .replace(/role="button"/g, 'role="img"')
                .replace(/tabindex="0"/g, 'tabindex="-1"');
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
            const balanceEl = document.getElementById('vibecoinBalance'); if (balanceEl) balanceEl.textContent = String(Math.max(0, Number(p.vibecoinBalance || 0))); const topCoins=document.getElementById('vvTopCoinBalance'); if(topCoins) topCoins.textContent=String(Math.max(0,Number(p.vibecoinBalance||0)));
            const premiumBadge = document.getElementById('premiumStatusBadge'); const premium = Number(p.premiumUntil || 0) > Date.now(); if (premiumBadge) premiumBadge.classList.toggle('hidden', !premium);
            // Hide Premium-only controls from non-Premium accounts; keep the purchase button visible.
            ['profileBannerFile','uploadProfileBannerBtn'].forEach(id => { const el=document.getElementById(id); if (!el) return; const wrapper=el.closest('[data-premium-only]') || el; if (wrapper && id !== 'buyPremiumBtn') wrapper.classList.toggle('hidden', !premium); });
            document.querySelectorAll('[data-premium-only]').forEach(el => el.classList.toggle('hidden', !premium));
            const banner = document.getElementById('socialProfileBanner'); if (banner) { const bannerUrl = premium ? (p.bannerURL||p.bannerUrl||p.coverURL||'') : ''; const safeBannerUrl = String(bannerUrl || '').replace(/["\\]/g,''); banner.style.setProperty('--vv-cover-image', safeBannerUrl ? `url("${safeBannerUrl}")` : 'none'); banner.style.backgroundImage = safeBannerUrl ? `linear-gradient(90deg,rgba(15,23,42,.08),rgba(15,23,42,.1)),url("${safeBannerUrl}")` : ''; banner.classList.toggle('hidden', !safeBannerUrl); }
        }
        function showTab(tab) {
            currentTab = tab;
            if (tab === 'chats' && activeFriend) {
                localStorage.setItem(unreadStorageKey(activeFriend), String(Date.now()));
                state.unreadCounts.set(activeFriend, 0); updateUnreadBadge(); renderChatFriends();
            }
            if (tab === 'chats') { refreshGroupsOnce(); refreshGroupsFromServer(); }
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
        const storyGalleryInput = document.getElementById('storyGallery');
        const storyImageInput = null;
        const storyVideoInput = null;
        const storyMusicInput = null;
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
            document.getElementById('storyMusicPreview')?.pause();
            clearTimeout(storyAdvanceTimer);
            clearInterval(vvStoryMusicTimer);
            stopStoryMedia();
            const viewer = document.getElementById('storyViewer');
            if (viewer) {
                viewer.classList.add('hidden');
                viewer.innerHTML = '';
            }
            setCurrentStoryAvatar('');
        }
        function renderStoryViewer() {
            clearTimeout(storyAdvanceTimer);
            clearInterval(vvStoryMusicTimer);
            stopStoryMedia();
            const st = activeStoryItems[activeStoryIndex];
            const viewer = document.getElementById('storyViewer');
            if (!st || !viewer) return;
            if (Number(st.expiresAt) <= Date.now()) { expireStories(); closeStoryViewer(); return; }
            const storyMediaFilter={none:'none',warm:'sepia(.25) saturate(1.35) contrast(1.05)',cool:'hue-rotate(18deg) saturate(1.15)',mono:'grayscale(1)',vivid:'saturate(1.8) contrast(1.12)',retro:'sepia(.55) contrast(.95)'}[st.storyFilter]||'none';
            const media = st.mediaType === 'video' && st.mediaURL
                ? `<video src="${storyEscape(st.mediaURL)}" style="filter:${storyMediaFilter}" class="absolute inset-0 h-full w-full object-contain bg-transparent pointer-events-none select-none" autoplay playsinline webkit-playsinline preload="metadata" controlslist="nodownload nofullscreen noplaybackrate" disablepictureinpicture tabindex="-1"></video>`
                : st.mediaURL ? `<img src="${storyEscape(st.mediaURL)}" alt="История" style="filter:${storyMediaFilter}" decoding="async" fetchpriority="high" class="absolute inset-0 h-full w-full object-contain select-none"/>` : '';
            const liked = Array.isArray(st.likes) && st.likes.includes(state.user.uid);
            const views = Array.isArray(st.views) ? st.views : [];
            const isOwnStory = st.uid === state.user?.uid;
            setCurrentStoryAvatar(st.uid);
            const viewNames = views.map(v => typeof v === 'string' ? v : (v.displayName || v.username || 'Пользователь'));
            const music = st.musicURL ? `<audio src="${storyEscape(st.musicURL)}" autoplay loop playsinline class="hidden" aria-hidden="true"></audio>` : '';
            const repostBadge=st.repostOf?`<div class="vv-repost-credit"><button id="vvOriginalProfile">↗ @${storyEscape(st.repostUsername||'user')}</button></div>`:'';
            const storyContent=st.repostOf?`<div class="vv-repost-stage">${media}${!st.textLayers?.length?`<div class="vv-repost-source-text">${storyEscape(st.repostText||'')}</div>`:''}</div>`:media;
            const ownerStats = isOwnStory ? `<button id="storyViewersBtn" class="rounded-full bg-white/15 px-3 py-2 text-xs"><i class="fa-regular fa-eye mr-1"></i>${views.length} просмотров</button>` : '';
            const likeCount = isOwnStory ? `<span class="text-sm">${Array.isArray(st.likes)?st.likes.length:0}</span>` : '';
            const viewersList = isOwnStory ? `<div id="storyViewersList" class="hidden mt-2 max-h-24 overflow-y-auto rounded-xl bg-black/50 p-2 text-xs">${viewNames.map(storyEscape).join('<br>') || 'Пока никто не посмотрел.'}</div>` : '';
            viewer.innerHTML = `<div class="vv-story-view ${st.repostOf?'vv-repost-view':''} relative flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden text-slate-800">
                ${storyContent}${repostBadge}<div class="story-top-gradient absolute inset-x-0 top-0 z-20 p-4 sm:p-6"><div class="mb-3 h-1 overflow-hidden rounded-full bg-slate-800/10"><div class="h-full w-full bg-violet-500"></div></div><div class="flex items-center gap-2">${storyAvatar(st)}<div class="min-w-0 flex-1"><button type="button" id="storyOwnerProfile" class="block max-w-full truncate text-left text-sm font-bold hover:text-violet-200">${storyEscape(st.displayName || 'Пользователь')}</button><small class="text-slate-500">${Math.max(1,Math.ceil((Number(st.expiresAt)-Date.now())/3600000))} ч. осталось</small></div><button id="storyViewerClose" class="rounded-full border border-white/80 bg-white/80 px-3 py-2 text-slate-700 shadow-lg backdrop-blur-xl" aria-label="Закрыть">✕</button></div></div>
                <button id="storyPrev" class="absolute inset-y-24 left-0 z-10 w-1/5" aria-label="Предыдущая история"></button><button id="storyNext" class="absolute inset-y-24 right-0 z-10 w-1/5" aria-label="Следующая история"></button>
                ${st.text ? `<div class="story-centered-text absolute inset-0 z-10 flex items-center justify-center px-6 py-24 sm:px-12 pointer-events-none"><div class="story-text-card mx-auto max-w-2xl whitespace-pre-wrap break-words text-center"><span class="story-text-card-label"><i class="fa-solid fa-sparkles mr-1"></i>История</span><p>${storyEscape(st.text).replace(/@([a-zA-Z0-9_.]{2,24})/g,'<button type="button" class="vv-story-profile-mention" data-mention-name="$1">@$1</button>')}</p></div></div>` : ''}
                <div class="story-bottom-gradient absolute inset-x-0 bottom-0 z-20 p-4 sm:p-6">${music}<div class="mt-3 flex items-center justify-between gap-3">${ownerStats}<button id="storyLikeBtn" class="rounded-full bg-white/15 px-4 py-2 text-lg ${liked?'text-rose-400':''}" aria-label="Нравится"><i class="fa-${liked?'solid':'regular'} fa-heart"></i> <span class="vv-story-like-count">${isOwnStory ? (Array.isArray(st.likes)?st.likes.length:0) : ''}</span></button></div><form id="storyReplyForm" class="mt-3 flex gap-2"><input id="storyReplyInput" maxlength="300" placeholder="Написать что-то пользователю…" class="min-w-0 flex-1 rounded-full border border-white/30 bg-white/15 px-4 py-3 text-sm text-white placeholder:text-white/65 outline-none backdrop-blur-md"/><button class="rounded-full bg-white/20 px-4" aria-label="Отправить ответ"><i class="fa-solid fa-paper-plane"></i></button></form>${viewersList}</div></div>`;
            if(Array.isArray(st.textLayers) && st.textLayers.length){
                viewer.querySelector('.story-centered-text')?.remove();
                for(const l of st.textLayers.slice(0,10)){
                    if(typeof l.text!=='string')continue;
                    const el=document.createElement('div');el.className='vv-published-text vv-published-layer';
                    el.textContent=l.text;el.style.left=vvLimit(Number(l.x)||0,0,90)+'%';
                    el.style.top=vvLimit(Number(l.y)||0,0,90)+'%';
                    el.style.fontSize=vvLimit(Number(l.size)||28,14,140)+'px';
                    el.style.color=/^#[a-f0-9]{6}$/i.test(l.color)?l.color:'#ffffff';
                    el.style.fontWeight=l.bold?'700':'400';el.style.textAlign=l.align||'center';
                    decorateStoryText(el,l.font,l.background,el.style.color);(viewer.querySelector('.vv-repost-stage')||viewer.firstElementChild).append(el);
                }
            }
            const textCard = viewer.querySelector('.story-centered-text');
            if (textCard && st.textPosition?.version === 2) {
                const cfg = st.textPosition;
                textCard.className = 'vv-published-text';
                textCard.style.left = Math.max(0,Math.min(85,Number(cfg.x)||0))+'%';
                textCard.style.top = Math.max(0,Math.min(85,Number(cfg.y)||0))+'%';
                textCard.textContent = st.text || '';
                textCard.style.fontSize = Math.max(16,Math.min(120,Number(cfg.size)||28))+'px';
                textCard.style.color = /^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : '#ffffff';
                textCard.style.fontWeight = cfg.bold ? '700' : '400';
                textCard.style.textAlign = ['left','center','right'].includes(cfg.align) ? cfg.align : 'center';
                decorateStoryText(textCard,cfg.font,cfg.background,textCard.style.color);
            }
            viewer.classList.remove('hidden');
            const storyVideo = viewer.querySelector('video');
            if (storyVideo) {
                storyVideo.controls = false;
                storyVideo.disablePictureInPicture = true;
                storyVideo.setAttribute('playsinline', '');
                storyVideo.setAttribute('webkit-playsinline', '');
                storyVideo.setAttribute('controlslist', 'nodownload nofullscreen noplaybackrate');
                storyVideo.muted = false;
            }
            const storyAudio=viewer.querySelector('audio');
            if(storyAudio&&st.musicURL){
                const start=Math.max(0,Number(st.musicStart)||0);
                const length=Math.max(1,Number(st.musicLength)||10);
                const startPlayback=()=>{try{storyAudio.currentTime=start;}catch(_){}storyAudio.volume=st.musicFade?0:0.9;storyAudio.play().catch(()=>{});const begun=Date.now();clearInterval(vvStoryMusicTimer);vvStoryMusicTimer=setInterval(()=>{if(!storyAudio.isConnected){clearInterval(vvStoryMusicTimer);return;}const elapsed=(Date.now()-begun)/1000;if(elapsed>=length){clearInterval(vvStoryMusicTimer);storyAudio.pause();return;}storyAudio.volume=st.musicFade?Math.min(.9,Math.max(0,Math.min(elapsed/.5,(length-elapsed)/.5))*.9):.9;},100);};
                if(storyAudio.readyState>=1)startPlayback();else storyAudio.addEventListener('loadedmetadata',startPlayback,{once:true});
            }
            const advanceStory = () => { if (activeStoryIndex < activeStoryItems.length - 1) { activeStoryIndex++; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); } else { closeStoryViewer(); } };
            if (st.mediaType === 'video') { const video = viewer.querySelector('video'); video?.addEventListener('ended', advanceStory, { once:true }); video?.addEventListener('error', () => { chatStatusDesc.textContent = 'Не удалось загрузить видеоисторию.'; }, { once:true }); }
            else storyAdvanceTimer = setTimeout(advanceStory, 10000);
            document.getElementById('vvOriginalProfile')?.addEventListener('click',()=>{closeStoryViewer();storiesModal?.classList.add('hidden');openAnyUserProfile(st.repostAuthorUid);});
            document.getElementById('storyOwnerProfile')?.addEventListener('click', () => { const owner=st.uid; closeStoryViewer(); storiesModal?.classList.add('hidden'); openAnyUserProfile(owner); });
            viewer.querySelectorAll('[data-mention-name]').forEach(button=>button.addEventListener('click',async()=>{try{const name=button.dataset.mentionName.toLowerCase();const snap=await getDocs(query(collection(db,'users'),where('username','==',name),limit(1)));if(snap.empty)return;closeStoryViewer();storiesModal?.classList.add('hidden');openAnyUserProfile(snap.docs[0].id);}catch(e){console.warn('Mention profile:',e);}}));
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
            document.getElementById('storyLikeBtn')?.addEventListener('click', async () => {
                const button = document.getElementById('storyLikeBtn');
                if (!button || button.disabled || !state.user) return;
                const uid = state.user.uid;
                const wasLiked = (st.likes || []).includes(uid);
                button.disabled = true;
                try {
                    await updateDoc(doc(db,'stories',st.id), { likes:wasLiked ? arrayRemove(uid) : arrayUnion(uid) });
                    st.likes = wasLiked ? (st.likes || []).filter(x=>x!==uid) : [...(st.likes || []),uid];
                    // Update the heart in place: do NOT recreate/restart the video or music.
                    if (button.isConnected) {
                        button.classList.toggle('text-rose-400',!wasLiked);
                        const heart = button.querySelector('i');
                        if (heart) heart.className = `fa-${wasLiked?'regular':'solid'} fa-heart`;
                        const counter = button.querySelector('.vv-story-like-count');
                        if (counter) counter.textContent = String(st.likes.length);
                    }
                } catch(err) { console.error('Story like:',err); alert('Не удалось поставить лайк. Проверь Firestore Rules.'); }
                finally { if (button.isConnected) button.disabled = false; }
            });
            document.getElementById('storyViewersBtn')?.addEventListener('click', () => document.getElementById('storyViewersList')?.classList.toggle('hidden'));
            document.getElementById('storyReplyForm')?.addEventListener('submit', async ev => { ev.preventDefault(); const input=document.getElementById('storyReplyInput'); const reply=(input?.value||'').trim(); if(!reply) return; try { await updateDoc(doc(db,'stories',st.id), { replies: arrayUnion({uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',text:reply.slice(0,300),createdAt:Date.now()}) }); if(st.uid!==state.user.uid) await addDoc(collection(db,'users',st.uid,'storyReplies'), {fromUid:state.user.uid,fromName:state.userProfile?.displayName||state.user.displayName||'Пользователь',storyId:st.id,text:reply.slice(0,300),createdAt:Date.now()}); input.value=''; input.placeholder='Ответ отправлен'; } catch(e) { console.error(e); alert('Не удалось отправить ответ. Проверь Firestore Rules.'); } });
        }
        async function markStoryViewed(st) {
            if (!st || (st.views || []).some(v => (typeof v === 'string' ? v : v.uid) === state.user?.uid)) return;
            const viewer = {uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',username:state.userProfile?.username||''};
            try { await updateDoc(doc(db,'stories',st.id), { views: arrayUnion(viewer) }); st.views = [...(st.views||[]),viewer]; refreshAvatarStoryRings(); } catch(e) { console.warn('Could not record story view:',e); }
        }
        function renderActiveStoryList() {
            const now = Date.now();
            if (!state.user) return;
                refreshAvatarStoryRings();
                if (!activeStoryItems.length) { storiesList.innerHTML = '<p class="rounded-2xl border border-slate-800 p-4 text-sm text-slate-400">Пока нет историй. Нажми «+» и опубликуй первую.</p>'; return; }
                const groups = new Map(); activeStoryItems.forEach(st => { if(!groups.has(st.uid)) groups.set(st.uid,[]); groups.get(st.uid).push(st); });
                const storyUserGroups=[...groups.entries()].map(([uid,items])=>({uid,items,seen:items.every(item=>(item.views||[]).some(v=>(typeof v==='string'?v:v?.uid)===state.user.uid))})); const unseenUsers=storyUserGroups.filter(g=>!g.seen); const seenUsers=storyUserGroups.filter(g=>g.seen); const renderStoryUsers=list=>list.map(({uid,items,seen})=>{const st=items[0];return `<button data-open-story-user="${storyEscape(uid)}" class="flex w-16 shrink-0 flex-col items-center gap-1 text-center text-xs">${storyAvatar(st,seen?'story-viewed':'story-unviewed')}<span class="w-16 truncate">${uid===state.user.uid?'Ваша история':storyEscape(st.displayName||'Пользователь')}</span></button>`;}).join(''); storiesList.innerHTML = `${unseenUsers.length?`<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Новые истории</div><div class="mb-4 flex gap-4 overflow-x-auto pb-3">${renderStoryUsers(unseenUsers)}</div>`:''}${seenUsers.length?`<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Просмотренные</div><div class="mb-3 flex gap-4 overflow-x-auto pb-3">${renderStoryUsers(seenUsers)}</div>`:''}<div class="mt-4 space-y-2">${activeStoryItems.filter(st=>st.uid===state.user.uid).map(st=>`<div class="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"><span>Моя история · ${Math.max(1,Math.ceil((Number(st.expiresAt)-now)/3600000))} ч. осталось</span><button data-delete-story="${storyEscape(st.id)}" class="rounded-lg px-3 py-2 text-rose-300 hover:bg-rose-500/10">Удалить</button></div>`).join('')}</div>`;
                storiesList.querySelectorAll('[data-open-story-user]').forEach(btn=>btn.addEventListener('click',()=>openStoryByUser(btn.dataset.openStoryUser)));
                storiesList.querySelectorAll('[data-open-story]').forEach(btn=>btn.addEventListener('click',()=>openStory(btn.dataset.openStory)));
                storiesList.querySelectorAll('[data-delete-story]').forEach(btn=>btn.addEventListener('click',async()=>{try{await deleteDoc(doc(db,'stories',btn.dataset.deleteStory));await refreshStories();}catch(e){console.error(e);alert('Не удалось удалить историю.');}}));
        }
        function expireStories() {
            const current = activeStoryItems[activeStoryIndex];
            const live = activeStoryItems.filter(st => Number(st.expiresAt) > Date.now());
            if (live.length === activeStoryItems.length) return;
            activeStoryItems = live;
            if (current && !live.some(st => st.id === current.id)) closeStoryViewer();
            else if (current) activeStoryIndex = live.findIndex(st => st.id === current.id);
            renderActiveStoryList();
        }
        setInterval(expireStories, 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) expireStories(); });
        async function refreshStories() {
            if (!storiesList) return;
            if (!state.user) { storiesList.innerHTML = '<p class="text-sm text-slate-400">Войди в аккаунт, чтобы смотреть истории.</p>'; return; }
            storiesList.innerHTML = '<div class="vv-loading-state rounded-2xl border border-slate-800 p-4 text-sm text-slate-300"><span class="vv-spinner" aria-hidden="true"></span> Загружаем истории…</div>'; 
            try {
                const snap = await getDocs(collection(db, 'stories'));
                const visibleStoryUids = new Set([state.user.uid, ...friendsCache.map(f => String(f.uid || f.id || ''))]);
                const now = Date.now();
                activeStoryItems = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(st => Number(st.expiresAt) > now && visibleStoryUids.has(String(st.uid))).sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
                renderActiveStoryList();
            } catch (err) { console.error('Load stories failed:', err); storiesList.innerHTML = '<p class="rounded-2xl border border-rose-500/30 p-4 text-sm text-rose-200">Не удалось загрузить истории. Проверь Firestore Rules.</p>'; }
        }
        function openStory(id) { activeStoryIndex=activeStoryItems.findIndex(s=>s.id===id); if(activeStoryIndex<0)return; renderStoryViewer(); markStoryViewed(activeStoryItems[activeStoryIndex]); }
        function openStoryByUser(uid) { const idx=activeStoryItems.findIndex(s=>s.uid===uid); if(idx>=0) openStory(activeStoryItems[idx].id); }
        document.getElementById('storiesNavBtn')?.addEventListener('click', async () => { if (!state.user) return; storiesModal?.classList.remove('hidden'); storyCreateForm?.classList.add('hidden'); closeStoryViewer(); await refreshStories(); });
        document.addEventListener('click', async event => { const avatar=event.target.closest('[data-story-avatar]'); if(!avatar || !state.user) return; const uid=avatar.dataset.storyAvatar; const hasStory=activeStoryItems.some(st=>st.uid===uid && Number(st.expiresAt)>Date.now()); if(hasStory){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();document.getElementById('friendProfileModal')?.remove();storiesModal?.classList.remove('hidden');storyCreateForm?.classList.add('hidden');storiesList?.classList.remove('hidden');openStoryByUser(uid);} else { event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.(); if(uid===state.user.uid) document.getElementById('profileBtn')?.click(); else openAnyUserProfile(uid); } }, true);
        document.addEventListener('keydown', event => { if((event.key==='Enter'||event.key===' ') && event.target.matches('[data-story-avatar]')) { event.preventDefault(); event.target.click(); } });
        document.getElementById('storiesClose')?.addEventListener('click', () => { closeStoryViewer(); document.getElementById('storyMusicPreview')?.pause(); vvResetStoryDraftText(); storiesModal?.classList.add('hidden'); });
        storiesModal?.addEventListener('click', event => { if (event.target === storiesModal) { closeStoryViewer(); storiesModal.classList.add('hidden'); } });
        // Mobile-first story flow: chooser -> native gallery -> editor.
        const vvStoryChoose = document.getElementById('vvStoryChoose');
        const vvStoryFilterBox = document.getElementById('vvStoryFilterBox');
        let vvStoryFilter = 'none';
        const vvFilterCss = {none:'none',warm:'sepia(.25) saturate(1.35) contrast(1.05)',cool:'hue-rotate(18deg) saturate(1.15)',mono:'grayscale(1)',vivid:'saturate(1.8) contrast(1.12)',retro:'sepia(.55) contrast(.95)'};
        function vvStoryScreen(screen){
            if(screen!=='edit')document.getElementById('storyMusicPreview')?.pause();
            vvStoryChoose?.classList.toggle('hidden',screen!=='choose');
            storyCreateForm?.classList.toggle('hidden',screen!=='edit');
            storiesList?.classList.toggle('hidden',screen!=='list');
            const b=document.getElementById('storyCreateToggle');
            if(b){b.classList.toggle('hidden',screen!=='list');b.innerHTML='<i class="fa-solid fa-plus"></i> Добавить историю';}
        }
        function vvApplyStoryFilter(){
            const media=document.querySelector('#storyGalleryPreview img,#storyGalleryPreview video');
            if(media)media.style.filter=vvFilterCss[vvStoryFilter]||'none';
            document.querySelectorAll('[data-vv-filter]').forEach(b=>b.classList.toggle('active',b.dataset.vvFilter===vvStoryFilter));
        }
        const vvEditor=document.getElementById('storyCreateForm');
        const vvCanvasText=document.getElementById('vvStoryCanvasText');
        // VoiceVibe story build: 20261101-reaction-avatars-7.
        // Each finished text becomes an independent, editable layer.
        const vvTextLayers=[];
        let vvEditingLayer=-1;
        const vvLayerHolder=document.createElement('div');
        vvLayerHolder.id='vvStoryTextLayers';
        vvEditor?.append(vvLayerHolder);
        const vvLimit=(n,a,b)=>Math.max(a,Math.min(b,n));
        function vvLayerSnapshot(node,layerIndex){
            const rect=node.getBoundingClientRect(),base=vvEditor.getBoundingClientRect();
            const cfg=layerIndex>=0?vvTextLayers[layerIndex]:vvTextSettings();
            return {text:node.innerText.trim().slice(0,500),x:vvLimit(100*(rect.left-base.left)/base.width,0,90),
              y:vvLimit(100*(rect.top-base.top)/base.height,0,90),size:vvLimit(Number(cfg.size)||28,14,140),
              color:cfg.color||'#ffffff',bold:!!cfg.bold,align:cfg.align||'center',
              font:cfg.font||'classic',background:!!cfg.background};
        }
        function vvRenderLayers(){
            vvLayerHolder.replaceChildren();
            vvTextLayers.forEach((layer,i)=>{
                const node=document.createElement('div');node.className='vv-story-layer';
                node.textContent=layer.text;node.dataset.layer=String(i);
                node.style.left=layer.x+'%';node.style.top=layer.y+'%';
                node.style.fontSize=layer.size+'px';node.style.color=layer.color;
                node.style.fontWeight=layer.bold?'700':'400';node.style.textAlign=layer.align;
                decorateStoryText(node,layer.font,layer.background,layer.color);
                vvLayerHolder.append(node);
                let gesture=null;
                const coord=ts=>Array.from(ts).slice(0,2).map(t=>({x:t.clientX,y:t.clientY}));
                const midpoint=pts=>({x:pts.reduce((sum,p)=>sum+p.x,0)/pts.length,y:pts.reduce((sum,p)=>sum+p.y,0)/pts.length});
                const begin=e=>{const points=coord(e.touches);if(!points.length)return;
                    const rect=node.getBoundingClientRect(),base=vvEditor.getBoundingClientRect(),center=midpoint(points);
                    gesture={points:points.length,c:center,x:100*(rect.left-base.left)/base.width,
                      y:100*(rect.top-base.top)/base.height,size:layer.size,
                      dist:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):1,moved:false};
                    e.preventDefault();};
                node.addEventListener('touchstart',begin,{passive:false});
                node.addEventListener('touchmove',e=>{if(!gesture)return;const points=coord(e.touches);
                    if(points.length!==gesture.points){begin(e);return;}const c=midpoint(points),b=vvEditor.getBoundingClientRect();
                    const dx=c.x-gesture.c.x,dy=c.y-gesture.c.y;
                    const size=points.length===2?vvLimit(gesture.size*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/gesture.dist,14,140):layer.size;
                    layer.size=Math.round(size);node.style.fontSize=layer.size+'px';
                    const safeTop=100*vvSafeTextTop(vvEditor)/b.height;
                    const safeBottom=100*(vvSafeTextBottom(vvEditor)-node.offsetHeight)/b.height;
                    layer.x=vvLimit(gesture.x+100*dx/b.width,0,Math.max(0,100-100*node.offsetWidth/b.width));
                    layer.y=vvLimit(gesture.y+100*dy/b.height,safeTop,Math.max(safeTop,safeBottom));
                    node.style.left=layer.x+'%';node.style.top=layer.y+'%';gesture.moved=true;e.preventDefault();
                },{passive:false});
                node.addEventListener('touchend',e=>{if(e.touches.length)begin(e);else gesture=null;},{passive:false});
                node.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.button!==0)return;
                    const startX=e.clientX,startY=e.clientY,b=vvEditor.getBoundingClientRect(),x=layer.x,y=layer.y;
                    node.setPointerCapture(e.pointerId);const move=ev=>{layer.x=vvLimit(x+100*(ev.clientX-startX)/b.width,0,90);
                      layer.y=vvLimit(y+100*(ev.clientY-startY)/b.height,10,80);node.style.left=layer.x+'%';node.style.top=layer.y+'%';};
                    node.addEventListener('pointermove',move);node.addEventListener('pointerup',()=>{node.removeEventListener('pointermove',move);},{once:true});
                });
                node.addEventListener('dblclick',()=>vvEditLayer(i));
            });
        }
        function vvEditLayer(i){
            const layer=vvTextLayers[i];if(!layer)return;
            if(!vvCommitCurrentText())return;
            i=vvTextLayers.indexOf(layer);if(i<0)return;
            vvTextLayers.splice(i,1);
            vvRenderLayers();vvEditingLayer=i;
            vvCanvasText.textContent=layer.text;
            vvCanvasText.style.transform='none';vvCanvasText.style.left=layer.x+'%';vvCanvasText.style.top=layer.y+'%';
            document.getElementById('vvTextSize').value=String(layer.size);
            document.getElementById('vvTextColor').value=layer.color;
            document.getElementById('vvTextBold').checked=layer.bold;
            document.getElementById('vvTextAlign').value=layer.align;
            vvTextFont=layer.font;vvTextBackground=layer.background;
            vvCanvasText.setAttribute('contenteditable','true');vvStoryPanel('text');applyTextSettings();
        }
        function vvCommitCurrentText(){
            const text=(vvCanvasText?.innerText||vvCanvasText?.textContent||'').trim();
            if(text && vvTextLayers.length>=10){
                storyStatus.textContent='Можно добавить до 10 надписей. Удали одну или отредактируй существующую.';storyStatus.classList.remove('hidden');
                return false;
            }
            if(text){vvCanvasText.blur();const layer=vvLayerSnapshot(vvCanvasText,-1);
                if(vvEditingLayer>=0)vvTextLayers.splice(Math.min(vvEditingLayer,vvTextLayers.length),0,layer);
                else vvTextLayers.push(layer);
            }
            vvEditingLayer=-1;vvCanvasText.textContent='';vvCanvasText.classList.add('hidden');
            vvCanvasText.setAttribute('contenteditable','false');
            vvCanvasText.style.removeProperty('left');vvCanvasText.style.removeProperty('top');
            vvCanvasText.style.removeProperty('transform');
            storyTextInput.value='';vvMentionSeq++;vvMentionResults?.classList.add('hidden');
            vvRenderLayers();vvStoryPanel('');
            return true;
        }
        function vvAllStoryText(){return vvTextLayers.map(l=>l.text).concat((vvCanvasText?.innerText||vvCanvasText?.textContent||'').trim()).filter(Boolean).join('\n').slice(0,500);}
        const vvDeleteText=document.getElementById('vvStoryTextDelete');
        const vvDragText=document.getElementById('vvStoryTextDrag');
        const vvMusicPlayer=document.getElementById('storyMusicPreview');
        let vvMusicApplied=false;
        function vvPlayAppliedMusic(){
            if(!vvMusicApplied || !vvSelectedTrack?.url || !vvMusicPlayer)return;
            if(vvMusicPlayer.src!==vvSelectedTrack.url)vvMusicPlayer.src=vvSelectedTrack.url;
            vvMusicPlayer.currentTime=Math.max(0,Number(document.getElementById('storyMusicStart')?.value)||0);
            vvMusicPlayer.play().catch(()=>{});
        }
        function vvStoryPanel(panel){
            ['text','filters','music','trim','publish'].forEach(n=>vvEditor?.classList.toggle('vv-panel-'+n,n===panel));
            document.getElementById('vvStoryTapDismiss')?.classList.toggle('hidden',!['filters','music','trim'].includes(panel));
            if(panel==='text'){
                vvCanvasText?.classList.remove('hidden');
                vvCanvasText?.focus({preventScroll:true});
                vvDeleteText?.classList.remove('hidden');vvDragText?.classList.remove('hidden');
            }
        }
        document.getElementById('vvStoryTextTool')?.addEventListener('click',()=>{if(!vvCommitCurrentText())return;if(vvTextLayers.length>=10){storyStatus.textContent='Можно добавить до 10 надписей.';storyStatus.classList.remove('hidden');return;}vvEditingLayer=-1;vvCanvasText.textContent='';vvCanvasText.style.removeProperty('left');vvCanvasText.style.removeProperty('top');vvCanvasText.style.removeProperty('transform');vvCanvasText?.setAttribute('contenteditable','true');vvStoryPanel('text');vvCanvasText?.focus({preventScroll:true});});
        document.getElementById('vvStoryFilterTool')?.addEventListener('click',()=>vvStoryPanel(vvEditor.classList.contains('vv-panel-filters')?'':'filters'));
        document.getElementById('vvStoryMusicTool')?.addEventListener('click',()=>vvStoryPanel(vvEditor.classList.contains('vv-panel-trim')?'':'trim'));
        document.getElementById('vvStorySongChip')?.addEventListener('click',()=>vvStoryPanel('music'));
        
        vvMusicPlayer?.addEventListener('timeupdate',()=>{
            if(!vvMusicApplied||!vvSelectedTrack)return;
            const start=Number(document.getElementById('storyMusicStart')?.value)||0;
            const length=Math.min(10,Number(document.getElementById('storyMusicLength')?.value)||10);
            if(vvMusicPlayer.currentTime>=start+length-.08)vvMusicPlayer.currentTime=start;
        });
        document.addEventListener('visibilitychange',()=>{if(document.hidden)vvMusicPlayer?.pause();});
        document.addEventListener('click',e=>{if(e.target.closest('#storiesClose,#vvStoryEditorBack,#vvStoryChooseClose,#chatsNavBtn,#chatNavBtn'))vvMusicPlayer?.pause();});
        const vvStoryVisibilityObserver=new MutationObserver(()=>{if(storiesModal?.classList.contains('hidden'))vvMusicPlayer?.pause();});
        if(storiesModal)vvStoryVisibilityObserver.observe(storiesModal,{attributes:true,attributeFilter:['class']});
        document.getElementById('vvStoryChangeMedia')?.addEventListener('click',()=>storyGalleryInput?.click());
        document.getElementById('vvStoryTapDismiss')?.addEventListener('click',()=>vvStoryPanel(''));
        function vvSyncCanvasText(){
            if(!vvCanvasText)return;
            storyTextInput.value=vvCanvasText.innerText.slice(0,500);
            vvDeleteText?.classList.toggle('hidden',!storyTextInput.value.trim());
            vvDragText?.classList.toggle('hidden',!storyTextInput.value.trim());
            storyTextInput.dispatchEvent(new Event('input',{bubbles:true}));
        }
        vvCanvasText?.addEventListener('input',vvSyncCanvasText);
        vvCanvasText?.addEventListener('click',e=>{if(vvSuppressTextClick){e.preventDefault();e.stopPropagation();}});
        vvCanvasText?.addEventListener('blur',()=>{if(!vvCanvasText?.innerText.trim()){vvCanvasText.classList.add('hidden');vvDeleteText?.classList.add('hidden');vvDragText?.classList.add('hidden');}});
        vvDeleteText?.addEventListener('click',()=>{
            vvEditingLayer=-1;vvCanvasText.textContent='';storyTextInput.value='';vvCanvasText.classList.add('hidden');vvDeleteText.classList.add('hidden');vvDragText.classList.add('hidden');vvMentionResults?.classList.add('hidden');vvStoryPanel('');
        });
        function vvTextSettings() {
            const parent = vvCanvasText.offsetParent;
            return { version:2, x:100*vvCanvasText.offsetLeft/(parent?.clientWidth||1), y:100*vvCanvasText.offsetTop/(parent?.clientHeight||1), size:Number(document.getElementById('vvTextSize').value), color:document.getElementById('vvTextColor').value, bold:document.getElementById('vvTextBold').checked, align:document.getElementById('vvTextAlign').value, font:vvTextFont, background:vvTextBackground };
        }
        let vvTextFont='classic', vvTextBackground=false;
        function decorateStoryText(el,font,background,color) {
            el.style.fontFamily=font==='elegance'?'Georgia, serif':font==='retro'?'monospace':'Arial, sans-serif';
            el.style.fontStyle=font==='retro'?'italic':'normal';
            el.style.background=background?color:'transparent';
            if(background)el.style.setProperty('color', ['#ffffff','#fde047','#fb923c','rgb(255, 255, 255)'].includes(color)?'#111111':'#ffffff','important');
            el.style.borderRadius='8px';el.style.padding='8px 12px';
            el.style.textShadow=font==='neon'?'0 0 5px '+color+',0 0 18px '+color:background?'none':'0 2px 6px #000';
        }
        document.querySelectorAll('[data-text-font]').forEach(b=>b.addEventListener('click',()=>{vvTextFont=b.dataset.textFont;applyTextSettings();}));
        document.querySelectorAll('[data-text-color]').forEach(b=>b.addEventListener('click',()=>{document.getElementById('vvTextColor').value=b.dataset.textColor;applyTextSettings();}));
        document.getElementById('vvFontsTab')?.addEventListener('click',()=>{document.getElementById('vvFontChoices').hidden=false;document.getElementById('vvColorChoices').hidden=true;});
        document.getElementById('vvColorsTab')?.addEventListener('click',()=>{document.getElementById('vvFontChoices').hidden=true;document.getElementById('vvColorChoices').hidden=false;});
        document.getElementById('vvAlignCycle')?.addEventListener('click',()=>{const el=document.getElementById('vvTextAlign'),values=['center','left','right'];el.value=values[(values.indexOf(el.value)+1)%3];applyTextSettings();});
        document.getElementById('vvTextBackground')?.addEventListener('click',()=>{vvTextBackground=!vvTextBackground;applyTextSettings();});
        document.getElementById('vvTextDone')?.addEventListener('click',vvCommitCurrentText);
        document.querySelector('.vv-text-settings')?.addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault();});
        function vvKeyboardPosition(){const v=window.visualViewport;document.documentElement.style.setProperty('--vv-keyboard',v?Math.max(0,window.innerHeight-v.height-v.offsetTop)+'px':'0px');}
        window.visualViewport?.addEventListener('resize',vvKeyboardPosition);
        window.visualViewport?.addEventListener('scroll',vvKeyboardPosition);
        function applyTextSettings() {
            vvCanvasText.style.setProperty('font-size',document.getElementById('vvTextSize').value+'px','important');
            vvCanvasText.style.setProperty('color',document.getElementById('vvTextColor').value,'important');
            vvCanvasText.style.setProperty('font-weight',document.getElementById('vvTextBold').checked?'700':'400','important');
            vvCanvasText.style.setProperty('text-align',document.getElementById('vvTextAlign').value,'important');
            decorateStoryText(vvCanvasText,vvTextFont,vvTextBackground,document.getElementById('vvTextColor').value);
        }
        ['vvTextSize','vvTextColor','vvTextBold','vvTextAlign'].forEach(id=>document.getElementById(id)?.addEventListener('input',applyTextSettings));
        let vvSuppressTextClick=false, vvGesture=null;
        const vvTextPointers=new Map();
        function vvGestureStart() {
            const pts=[...vvTextPointers.values()],parent=vvCanvasText.offsetParent;
            if(!pts.length||!parent){vvGesture=null;return;}
            const box=vvCanvasText.getBoundingClientRect(),bounds=parent.getBoundingClientRect();
            const center=pts.length>1?{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}:pts[0];
            vvGesture={parent,x:center.x,y:center.y,left:box.left-bounds.left-parent.clientLeft+parent.scrollLeft,top:box.top-bounds.top-parent.clientTop+parent.scrollTop,width:box.width,height:box.height,size:Number(document.getElementById('vvTextSize').value)||28,distance:pts.length>1?Math.max(1,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)):0};
        }
        vvCanvasText?.addEventListener('pointerdown',e=>{
            if(e.pointerType==='touch'||e.button!==0||vvTextPointers.size>=2||vvCanvasText.getAttribute('contenteditable')==='true')return;
            if(!vvTextPointers.size)vvSuppressTextClick=false;
            vvTextPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});vvCanvasText.setPointerCapture(e.pointerId);vvGestureStart();e.preventDefault();
        });
        vvCanvasText?.addEventListener('pointermove',e=>{
            if(!vvTextPointers.has(e.pointerId)||!vvGesture)return;
            vvTextPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
            const pts=[...vvTextPointers.values()],g=vvGesture;
            const c=pts.length>1?{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}:pts[0];
            const dx=c.x-g.x,dy=c.y-g.y;
            if(pts.length===1&&!vvSuppressTextClick&&Math.hypot(dx,dy)<5)return;
            vvSuppressTextClick=true;vvCanvasText.blur();vvCanvasText.classList.add('vv-text-dragging');window.getSelection()?.removeAllRanges();
            let scale=1;
            if(pts.length>1&&g.distance){const distance=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);const size=Math.max(16,Math.min(120,g.size*distance/g.distance));document.getElementById('vvTextSize').value=String(size);scale=size/g.size;applyTextSettings();}
            const left=g.left+dx-(scale-1)*g.width/2,top=g.top+dy-(scale-1)*g.height/2;
            vvCanvasText.style.left=Math.max(0,Math.min(Math.max(0,g.parent.clientWidth-vvCanvasText.offsetWidth),left))+'px';
            vvCanvasText.style.top=vvClampTextY(g.parent,top)+'px';vvCanvasText.style.transform='none';e.preventDefault();
        });
        function vvEndTextDrag(e){
            if(!vvTextPointers.has(e.pointerId))return;
            vvTextPointers.delete(e.pointerId);
            if(vvCanvasText.hasPointerCapture(e.pointerId))vvCanvasText.releasePointerCapture(e.pointerId);
            if(vvTextPointers.size){vvGestureStart();return;}
            vvGesture=null;vvCanvasText.classList.remove('vv-text-dragging');
            if(!vvSuppressTextClick&&e.type==='pointerup'&&vvCanvasText.getAttribute('contenteditable')==='true'){vvCanvasText.focus({preventScroll:true});}
        }
        ['pointerup','pointercancel','lostpointercapture'].forEach(n=>vvCanvasText?.addEventListener(n,vvEndTextDrag));

        // Keep the draggable text below the top music selector and above publish controls.
        function vvSafeTextTop(parent){
            const chip=document.getElementById('vvStorySongChip');
            const title=document.querySelector('#storyCreateForm .vv-story-editor-title');
            const bounds=parent.getBoundingClientRect();
            const bar=(title||chip)?.getBoundingClientRect();
            return Math.max(72,bar?Math.ceil(bar.bottom-bounds.top+14):72);
        }
        function vvSafeTextBottom(parent){
            const bar=document.querySelector('#storyCreateForm .vv-story-bottom-actions');
            const bounds=parent.getBoundingClientRect();
            const r=bar?.getBoundingClientRect();
            return Math.max(vvSafeTextTop(parent)+40,r?Math.floor(r.top-bounds.top-14):parent.clientHeight-84);
        }
        function vvClampTextY(parent,proposed){
            const min=vvSafeTextTop(parent);
            const max=Math.max(min,vvSafeTextBottom(parent)-vvCanvasText.offsetHeight);
            return Math.max(min,Math.min(max,proposed));
        }
        function vvKeepTextInSafeArea(){
            if(!vvCanvasText||vvCanvasText.classList.contains('hidden'))return;
            const parent=vvCanvasText.offsetParent;if(!parent)return;
            const rect=vvCanvasText.getBoundingClientRect(),b=parent.getBoundingClientRect();
            const y=rect.top-b.top+parent.scrollTop-parent.clientTop;
            const safe=vvClampTextY(parent,y);
            if(Math.abs(y-safe)>1){
                vvCanvasText.style.transform='none';
                vvCanvasText.style.left=Math.max(0,rect.left-b.left+parent.scrollLeft-parent.clientLeft)+'px';
                vvCanvasText.style.top=safe+'px';
            }
        }
        document.getElementById('vvStorySongChip')?.addEventListener('click',vvKeepTextInSafeArea);
        window.addEventListener('resize',vvKeepTextInSafeArea);
        // Unified story-text gestures: Touch Events on iOS/Android, pointer for mouse/pen.
        // Touch tracking is attached to the editor so a second finger can land off-text.
        let storyTouch=null;
        const storyPoint=t=>({x:t.clientX,y:t.clientY});
        const storyMid=pts=>pts.length===1?pts[0]:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
        function storyBeginTouches(e){
            if(!vvCanvasText || vvCanvasText.classList.contains('hidden') || vvCanvasText.isContentEditable)return;
            if(e.target.closest('button,input,textarea,select,a') && !storyTouch)return;
            const pts=Array.from(e.touches,storyPoint).slice(0,2);
            if(!pts.length)return;
            const rect=vvCanvasText.getBoundingClientRect(), parent=vvCanvasText.offsetParent;
            if(!parent)return;
            const center=storyMid(pts);
            if(!storyTouch && pts.length===1 && (center.x<rect.left-24||center.x>rect.right+24||center.y<rect.top-24||center.y>rect.bottom+24))return;
            const bounds=parent.getBoundingClientRect();
            // Freeze translated layout at its actual on-screen coordinates.
            const left=rect.left-bounds.left+parent.scrollLeft-parent.clientLeft;
            const top=rect.top-bounds.top+parent.scrollTop-parent.clientTop;
            vvCanvasText.style.transform='none';vvCanvasText.style.left=left+'px';vvCanvasText.style.top=vvClampTextY(parent,top)+'px';
            storyTouch={count:pts.length,center,left,top,size:Number(document.getElementById('vvTextSize').value)||28,
                distance:pts.length===2?Math.max(1,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)):0,parent};
            e.preventDefault();
        }
        function storyMoveTouches(e){
            if(!storyTouch)return;
            const pts=Array.from(e.touches,storyPoint).slice(0,2);
            if(!pts.length)return;
            if(pts.length!==storyTouch.count){storyBeginTouches(e);return;}
            const g=storyTouch,center=storyMid(pts);
            if(pts.length===2){
                const d=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
                document.getElementById('vvTextSize').value=String(Math.round(Math.max(14,Math.min(140,g.size*d/g.distance))));
                applyTextSettings();
            }
            const x=g.left+center.x-g.center.x,y=g.top+center.y-g.center.y;
            vvCanvasText.style.left=Math.max(0,Math.min(Math.max(0,g.parent.clientWidth-vvCanvasText.offsetWidth),x))+'px';
            vvCanvasText.style.top=vvClampTextY(g.parent,y)+'px';
            e.preventDefault();
        }
        vvEditor?.addEventListener('touchstart',storyBeginTouches,{passive:false,capture:true});
        vvEditor?.addEventListener('touchmove',storyMoveTouches,{passive:false,capture:true});
        vvEditor?.addEventListener('touchend',e=>{if(!e.touches.length)storyTouch=null;else if(storyTouch)storyBeginTouches(e);},{passive:false,capture:true});
        vvEditor?.addEventListener('touchcancel',()=>{storyTouch=null;},{passive:false,capture:true});
        document.getElementById('vvTextDone')?.addEventListener('click',()=>{storyTouch=null;vvTextPointers.clear();vvGesture=null;});
        // Each story is a fresh draft: never reuse text from the previous story.
        function vvResetStoryMusic(){
            vvMusicApplied=false;vvSelectedTrack=null;clearInterval(vvPreviewTimer);
            vvMusicPlayer?.pause();if(vvMusicPlayer)vvMusicPlayer.onloadedmetadata=null;
            setMusicPreviewFile(null);
            vvEditor?.classList.remove('vv-music-active');
            document.getElementById('vvStorySongChip').textContent='♫ Музыка';
            vvMusicSelected?.classList.add('hidden');vvMusicClear?.classList.add('hidden');
            if(musicStartInput)musicStartInput.value='0';
            if(musicLengthInput)musicLengthInput.value='10';
            if(vvMusicFade)vvMusicFade.checked=false;
            vvRenderCatalog();updateMusicTrimLabel();
        }
        function vvResetStoryDraftText(){
            vvMentionSeq++;vvTextFont='classic';vvTextBackground=false;
            vvTextLayers.length=0;vvLayerHolder.replaceChildren();vvEditingLayer=-1;
            vvEditor?.classList.remove('vv-panel-text');
            if(storyTextInput)storyTextInput.value='';
            if(vvCanvasText){
                vvCanvasText.textContent='';
                vvCanvasText.classList.add('hidden');
                vvCanvasText.setAttribute('contenteditable','false');
                vvCanvasText.style.removeProperty('left');
                vvCanvasText.style.removeProperty('top');
                vvCanvasText.style.removeProperty('transform');
                vvCanvasText.style.removeProperty('touch-action');
            }
            vvDeleteText?.classList.add('hidden');
            vvDragText?.classList.add('hidden');
            document.getElementById('vvStoryMentionResults')?.classList.add('hidden');
            const size=document.getElementById('vvTextSize');
            if(size)size.value='28';
            const color=document.getElementById('vvTextColor');
            if(color)color.value='#ffffff';
            const bold=document.getElementById('vvTextBold');
            if(bold)bold.checked=false;
            const align=document.getElementById('vvTextAlign');
            if(align)align.value='center';
            vvTextPointers.clear();
            vvGesture=null;
            storyTouch=null;applyTextSettings();
        }
        document.getElementById('storyCreateToggle')?.addEventListener('click',()=>{vvResetStoryDraftText();vvResetStoryMusic();vvStoryFilter='none';storyGalleryInput.value='';vvStoryScreen('choose');});
        document.getElementById('vvStoryChooseClose')?.addEventListener('click',()=>{vvResetStoryDraftText();vvStoryScreen('list');});
        document.getElementById('vvStoryEditorBack')?.addEventListener('click',()=>{vvResetStoryDraftText();vvStoryPanel('');vvStoryScreen('choose');});
        document.getElementById('vvStoryTextOnly')?.addEventListener('click',()=>{vvResetStoryDraftText();vvResetStoryMusic();vvStoryFilter='none';storyGalleryInput.value='';document.getElementById('storyGalleryPreview')?.classList.add('hidden');vvStoryFilterBox?.classList.add('hidden');vvStoryScreen('edit');vvCanvasText?.setAttribute('contenteditable','true');vvStoryPanel('text');});
        document.querySelectorAll('[data-vv-filter]').forEach(b=>b.addEventListener('click',()=>{vvStoryFilter=b.dataset.vvFilter;vvApplyStoryFilter();}));
        // Mention autocomplete; prefix search starts after two characters.
        let vvMentionSeq=0;
        const vvMentionResults=document.getElementById('vvStoryMentionResults');
        storyTextInput?.addEventListener('input',async()=>{
            const cursor=storyTextInput.value.length;
            const before=storyTextInput.value.slice(0,cursor);
            const match=before.match(/(?:^|\s)@([a-zA-Z0-9_.]{2,24})$/);
            const seq=++vvMentionSeq;
            if(!match){vvMentionResults?.classList.add('hidden');return;}
            try{
                const prefix=match[1].toLowerCase();
                const q=query(collection(db,'users'),where('username','>=',prefix),where('username','<=',prefix+'\uf8ff'),limit(8));
                const snap=await getDocs(q);
                if(seq!==vvMentionSeq)return;
                vvMentionResults.replaceChildren();
                snap.docs.filter(d=>d.id!==state.user?.uid).forEach(d=>{
                    const u=d.data(), name=String(u.username||'');if(!name)return;
                    const button=document.createElement('button');button.type='button';button.className='vv-story-mention';button.textContent='@'+name+' · '+String(u.displayName||'Пользователь');
                    button.addEventListener('click',()=>{const current=storyTextInput.value;const start=cursor-match[1].length-1;storyTextInput.value=current.slice(0,start)+'@'+name+' '+current.slice(cursor);const pos=start+name.length+2;vvCanvasText.textContent=storyTextInput.value;vvCanvasText.classList.remove('hidden');vvCanvasText.focus();const selection=window.getSelection();selection?.selectAllChildren(vvCanvasText);selection?.collapseToEnd();vvMentionResults.classList.add('hidden');});
                    vvMentionResults.appendChild(button);
                });
                vvMentionResults.classList.toggle('hidden',!vvMentionResults.childElementCount);
            }catch(e){console.warn('Story mention search:',e);vvMentionResults?.classList.add('hidden');}
        });
        // Story mentions inbox: independent of friendship, securely scoped to recipient.
        async function vvResolveMentionUids(text){
            const names=[...new Set((text.match(/@[a-zA-Z0-9_.]{2,24}/g)||[]).map(x=>x.slice(1).toLowerCase()))].slice(0,15);
            const users=[];
            for(const name of names){
                const found=await getDocs(query(collection(db,'users'),where('username','==',name),limit(1)));
                if(!found.empty && found.docs[0].id!==state.user.uid)users.push({uid:found.docs[0].id,username:name});
            }
            return users;
        }
        let vvMentionUnsub=null;
        let vvChatMentions=[];
        let vvDirectDocs=[];
        function vvMentionPeers(){
            const peers=new Map();
            for(const m of vvChatMentions)if(!peers.has(m.fromUid))peers.set(m.fromUid,{uid:m.fromUid,displayName:m.fromUsername?'@'+m.fromUsername:'Пользователь',username:m.fromUsername||'',mentionOnly:true});
            return [...peers.values()];
        }
        function vvMentionUnread(uid){return vvChatMentions.filter(m=>m.fromUid===uid&&Number(m.createdAt)>getLastReadAt(uid)).length;}
        function vvWatchMentionInbox(){
            vvMentionUnsub?.();if(!state.user)return;
            const owner=state.user.uid;
            const oldHost=document.getElementById('vvStoryMentionInbox');if(oldHost){oldHost.innerHTML='';oldHost.classList.add('hidden');}
            vvMentionUnsub=onSnapshot(collection(db,'users',owner,'storyMentions'),snap=>{
                if(state.user?.uid!==owner)return;
                vvChatMentions=snap.docs.map(d=>({id:d.id,...d.data()}));
                for(const m of vvChatMentions)recentChatTimes.set(m.fromUid,Math.max(recentChatTimes.get(m.fromUid)||0,Number(m.createdAt)||0));
                if(activeFriend&&!activeGroupId){vvRenderDirectMessages(activeFriend);if(currentTab==='chats')localStorage.setItem(unreadStorageKey(activeFriend),String(Date.now()));}
                renderChatFriends();updateUnreadBadge();
            },e=>console.warn('Mention inbox:',e));
        }
        async function vvOpenMentionStory(id){
            const snap=await getDoc(doc(db,'stories',id));if(!snap.exists()||snap.data().expiresAt<=Date.now())return alert('История уже недоступна.');
            const st={id:snap.id,...snap.data()};activeStoryItems=[st];activeStoryIndex=0;storiesModal?.classList.remove('hidden');renderStoryViewer();
        }
        async function vvRepostMention(id){
            if(!state.user)return;
            const [source,mention]=await Promise.all([getDoc(doc(db,'stories',id)),getDoc(doc(db,'users',state.user.uid,'storyMentions',id))]);
            if(!source.exists()||!mention.exists()||source.data().expiresAt<=Date.now())return alert('История недоступна.');
            const st=source.data(),now=Date.now();
            if(!confirm('Выставить историю @'+(st.username||'user')+' у себя?'))return;
            try{
                const storyRef=await addDoc(collection(db,'stories'),{uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',username:state.userProfile?.username||'',photoURL:state.userProfile?.photoURL||'',text:'',mediaURL:st.mediaURL||'',mediaType:st.mediaType||'text',musicURL:st.musicURL||'',musicStart:Number(st.musicStart)||0,musicLength:Math.min(10,Number(st.musicLength)||10),musicFade:!!st.musicFade,storyFilter:st.storyFilter||'none',textPosition:{x:0,y:0},mentions:[],mentionedUids:[],repostOf:id,repostAuthorUid:st.uid,repostUsername:st.username||'',repostText:st.text||'',textLayers:Array.isArray(st.textLayers)?st.textLayers.slice(0,10):[],likes:[],views:[],replies:[],createdAt:now,expiresAt:Math.min(now+86400000,Number(st.expiresAt))});
                alert('Репост опубликован!');storiesModal?.classList.remove('hidden');await refreshStories();
            }catch(e){console.error(e);alert('Не удалось сделать репост. Проверь Firestore Rules.');}
        }
        onAuthStateChanged(auth,user=>{if(!user){vvMentionUnsub?.();vvChatMentions=[];vvDirectDocs=[];vvReactionProfiles.clear();return;}setTimeout(vvWatchMentionInbox,1500);setTimeout(()=>{refreshGroupsOnce(user.uid);refreshGroupsFromServer(user.uid,true);},1200);});
        // Cloudinary catalog: music URLs are stored directly, no re-upload required.
        let vvCatalogTracks = [];
        let vvSelectedTrack = null;
        let vvPreviewTimer = null;
        let vvStoryMusicTimer = null;
        const vvMusicSearch = document.getElementById('vvMusicSearch');
        const vvMusicGenre = document.getElementById('vvMusicGenre');
        const vvMusicTracks = document.getElementById('vvMusicTracks');
        const vvMusicSelected = document.getElementById('vvMusicSelected');
        const vvMusicClear = document.getElementById('vvMusicClear');
        const vvMusicFade = document.getElementById('vvMusicFade');
        // Favorites are private to this browser and Firebase user.
        const vvFavoriteKey = () => `voicevibe:music:favorites:${state.user?.uid || 'guest'}`;
        const vvGetFavorites = () => { try { return new Set(JSON.parse(localStorage.getItem(vvFavoriteKey()) || '[]')); } catch { return new Set(); } };
        const vvSetFavorites = fav => { try { localStorage.setItem(vvFavoriteKey(), JSON.stringify([...fav])); } catch(e) { console.warn('Не удалось сохранить избранное',e); } };
        const vvMusicDuration = value => Number.isFinite(Number(value)) && Number(value) > 0 ? `${Math.floor(Number(value)/60)}:${String(Math.floor(Number(value)%60)).padStart(2,'0')}` : '—';
        function vvRenderCatalog() {
            if(!vvMusicTracks)return;
            const search=(vvMusicSearch?.value||'').trim().toLowerCase();
            const genre=vvMusicGenre?.value||'';
            const favorites=vvGetFavorites();
            const found=vvCatalogTracks.filter(t=>(genre!=='__favorites__'||favorites.has(t.id))&&(genre==='__favorites__'||!genre||t.category===genre)&&(!search||`${t.title} ${t.artist}`.toLowerCase().includes(search)));
            vvMusicTracks.innerHTML=found.length ? found.slice(0,500).map(t=>`<div class="vv-catalog-track ${vvSelectedTrack?.id===t.id?'selected':''}" data-music-id="${storyEscape(t.id)}" role="button" tabindex="0" aria-label="Выбрать ${storyEscape(t.title)}"><i class="fa-solid fa-${vvSelectedTrack?.id===t.id?'check':'music'}"></i><span>${storyEscape(t.title)}<small style="display:block">${storyEscape(t.artist||'Исполнитель не указан')}</small></span><small>${vvMusicDuration(t.duration)}</small><button type="button" class="vv-favorite-btn ${favorites.has(t.id)?'is-favorite':''}" data-favorite-id="${storyEscape(t.id)}" aria-label="${favorites.has(t.id)?'Удалить из избранного':'Добавить в избранное'}" title="${favorites.has(t.id)?'Удалить из избранного':'Добавить в избранное'}"><i class="fa-${favorites.has(t.id)?'solid':'regular'} fa-heart"></i></button></div>`).join('') : (vvCatalogTracks.length ? '<p style="padding:12px">Ничего не найдено.</p>' : '<p style="padding:12px">Каталог пока пуст. Добавьте треки в настройки Worker.</p>');
        }
        async function vvLoadCatalog() {
            if(!vvMusicTracks)return;
            try {
                const res=await fetch(`${WORKER_BASE_URL}/api/music`);
                const data=await res.json();
                if(!res.ok||!data.ok||!Array.isArray(data.tracks))throw new Error(data.error||'Ошибка каталога');
                vvCatalogTracks=data.tracks.filter(t=>t.url&&t.id).map(t=>({...t,category:(t.category&&t.category!=='Разное'&&t.category!=='Unknown' ? t.category : (/lo.?fi|chill|warm|sleep|dream/i.test(`${t.title} ${t.publicId||''}`)?'Lo-Fi / Chill':'Без жанра'))}));
                document.getElementById('vvMusicCount').textContent=`${vvCatalogTracks.length} треков`;
                const genres=[...new Set(vvCatalogTracks.map(t=>t.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
                if(vvMusicGenre)vvMusicGenre.innerHTML='<option value="">Все жанры</option><option value="__favorites__">♥ Избранное</option>'+genres.map(g=>`<option value="${storyEscape(g)}">${storyEscape(g)}</option>`).join('');
                vvRenderCatalog();
            } catch(e) {
                console.error('Music catalog:',e);
                document.getElementById('vvMusicCount').textContent='Ошибка';
                vvMusicTracks.textContent='Не удалось загрузить каталог. Проверь /api/music и настройки Cloudflare.';
            }
        }
        vvMusicSearch?.addEventListener('input',vvRenderCatalog);
        vvMusicGenre?.addEventListener('change',vvRenderCatalog);
        vvMusicTracks?.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ') && e.target.matches('[data-music-id]')){e.preventDefault();e.target.click();}});
        vvMusicTracks?.addEventListener('click',e=>{
            const favoriteButton=e.target.closest('[data-favorite-id]');
            if(favoriteButton){
                e.stopPropagation();
                const favorites=vvGetFavorites();const id=favoriteButton.dataset.favoriteId;
                if(favorites.has(id))favorites.delete(id);else favorites.add(id);
                vvSetFavorites(favorites);vvRenderCatalog();return;
            }
            const btn=e.target.closest('[data-music-id]');if(!btn)return;
            vvSelectedTrack=vvCatalogTracks.find(t=>t.id===btn.dataset.musicId)||null;
            if(!vvSelectedTrack)return;
            setMusicPreviewFile(null);
            
            sourceMusicDuration=Number(vvSelectedTrack.duration)||30;
            if(musicStartInput)musicStartInput.value='0';
            updateMusicTrimLabel();
            vvMusicSelected.textContent=`Выбрано: ${vvSelectedTrack.title}`;
            vvMusicSelected.classList.remove('hidden');vvMusicClear.classList.remove('hidden');
            vvMusicApplied=true;vvEditor?.classList.add('vv-music-active');
            document.getElementById('vvStorySongChip').textContent='♫ '+vvSelectedTrack.title;
            vvRenderCatalog();vvPlayAppliedMusic();
        });
        vvMusicClear?.addEventListener('click',()=>{
            vvMusicApplied=false;vvEditor?.classList.remove('vv-music-active');vvMusicPlayer?.pause();document.getElementById('vvStorySongChip').textContent='♫ Музыка';vvSelectedTrack=null;vvMusicSelected.classList.add('hidden');vvMusicClear.classList.add('hidden');vvRenderCatalog();
        });
        vvLoadCatalog();
        const musicStartInput=document.getElementById('storyMusicStart');
        const musicLengthInput=document.getElementById('storyMusicLength');
        let storyMusicPreviewURL = null;
        function drawMusicWave() {
            const bars=document.getElementById('storyMusicWaveBars');
            if(!bars)return;
            bars.innerHTML=Array.from({length:84},(_,i)=>`<span style="height:${12+Math.abs(Math.sin(i*1.71)*Math.cos(i*.37))*72}%"></span>`).join('');
        }
        function updateWaveSelection() {
            const selection=document.getElementById('storyMusicWaveSelection');
            const wave=document.getElementById('storyMusicWave');
            const time=document.getElementById('storyMusicWaveTime');
            if(!selection||!wave)return;
            const duration=Math.max(3,sourceMusicDuration);
            const start=Math.max(0,Number(musicStartInput?.value)||0);
            const length=Math.max(3,Number(musicLengthInput?.value)||10);
            selection.style.left=`${start/duration*100}%`;
            selection.style.width=`${Math.min(100-start/duration*100,length/duration*100)}%`;
            wave.setAttribute('aria-valuemax',String(Math.max(0,duration-length)));
            wave.setAttribute('aria-valuenow',String(start));
            if(time)time.textContent=`${Math.floor(start/60)}:${String(Math.floor(start%60)).padStart(2,'0')} — ${Math.floor((start+length)/60)}:${String(Math.floor((start+length)%60)).padStart(2,'0')}`;
        }
        const waveEditor=document.getElementById('storyMusicWave');
        let waveDrag=null;
        const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
        function setWaveDrag(event) {
            if(!waveEditor||!waveDrag)return;
            const rect=waveEditor.getBoundingClientRect();
            const delta=(event.clientX-waveDrag.x)/rect.width*Math.max(3,sourceMusicDuration);
            let start=waveDrag.start, length=waveDrag.length;
            if(waveDrag.mode==='move')start=clamp(waveDrag.start+delta,0,Math.max(0,sourceMusicDuration-length));
            if(waveDrag.mode==='left'){
                const end=waveDrag.start+waveDrag.length;
                start=clamp(waveDrag.start+delta,0,end-3);
                length=end-start;
            }
            if(waveDrag.mode==='right')length=clamp(waveDrag.length+delta,3,Math.min(10,sourceMusicDuration-start));
            musicStartInput.value=String(Math.round(start*10)/10);
            musicLengthInput.value=String(Math.round(length*10)/10);
            updateMusicTrimLabel();
        }
        waveEditor?.addEventListener('pointerdown',event=>{
            if(!vvSelectedTrack||!musicStartInput||!musicLengthInput)return;
            const rect=waveEditor.getBoundingClientRect();
            const duration=Math.max(3,sourceMusicDuration);
            const start=Number(musicStartInput.value)||0;
            const length=Number(musicLengthInput.value)||10;
            const x=(event.clientX-rect.left)/rect.width*duration;
            const threshold=Math.max(1,14/rect.width*duration);
            const mode=Math.abs(x-start)<threshold?'left':Math.abs(x-(start+length))<threshold?'right':'move';
            waveDrag={x:event.clientX,start,length,mode};
            if(x<start-threshold||x>start+length+threshold){
                waveDrag.start=clamp(x-length/2,0,Math.max(0,duration-length));
                musicStartInput.value=String(Math.round(waveDrag.start*10)/10);
                updateMusicTrimLabel();if(vvMusicApplied)vvPlayAppliedMusic();
            }
            waveEditor.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        waveEditor?.addEventListener('pointermove',event=>{if(waveDrag)setWaveDrag(event);});
        waveEditor?.addEventListener('pointerup',()=>{waveDrag=null;if(vvMusicApplied)vvPlayAppliedMusic();});
        waveEditor?.addEventListener('pointercancel',()=>{waveDrag=null;});
        waveEditor?.addEventListener('keydown',event=>{
            if(!vvSelectedTrack||!['ArrowLeft','ArrowRight'].includes(event.key))return;
            event.preventDefault();
            const length=Number(musicLengthInput.value)||10;
            musicStartInput.value=String(clamp((Number(musicStartInput.value)||0)+(event.key==='ArrowRight'?1:-1),0,Math.max(0,sourceMusicDuration-length)));
            updateMusicTrimLabel();
        });
        let sourceMusicDuration = 30;
        function updateMusicTrimLabel() {
            const maxStart = Math.max(0, sourceMusicDuration - 3);
            if (musicStartInput) { musicStartInput.max = String(maxStart); if (Number(musicStartInput.value) > maxStart) musicStartInput.value = String(maxStart); }
            const start=Math.max(0,Number(musicStartInput?.value)||0);
            const maxLength=Math.max(3,Math.min(10,sourceMusicDuration-start));
            if(musicLengthInput){musicLengthInput.max=String(maxLength);if(Number(musicLengthInput.value)>maxLength)musicLengthInput.value=String(maxLength);}
            const length=Math.max(3,Math.min(maxLength,Number(musicLengthInput?.value)||10));
            const label=document.getElementById('storyMusicTrimLabel'); if(label) label.textContent=`Обрезка: ${start}–${start+length} сек. · в историю попадёт только этот фрагмент`; updateWaveSelection();
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
        storyGalleryInput?.addEventListener('click',()=>{
            // Preserve the draft if the device picker is cancelled.
        });
        storyGalleryInput?.addEventListener('change',()=>{
            const file=storyGalleryInput.files?.[0];
            if(!file)return;
            if(!file.type.startsWith('image/')&&!file.type.startsWith('video/')){storyGalleryInput.value='';storyStatus.textContent='Выбери фото или видео.';storyStatus.classList.remove('hidden');return;}
            const label=document.getElementById('storyGalleryName');
            const preview=document.getElementById('storyGalleryPreview');
            if(label)label.textContent=file?'Файл загружен':'Файл не загружен';
            if(preview){
                if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);
                preview.replaceChildren();preview.classList.toggle('hidden',!file);
                if(file){vvResetStoryDraftText();vvResetStoryMusic();vvStoryFilter='none';vvMusicApplied=false;vvEditor?.classList.remove('vv-music-active');vvMusicPlayer?.pause();document.getElementById('vvStorySongChip').textContent='♫ Музыка';vvStoryScreen('edit');vvStoryPanel('');vvStoryFilterBox?.classList.remove('hidden');const url=URL.createObjectURL(file);preview.dataset.objectUrl=url;const media=document.createElement(file.type.startsWith('video/')?'video':'img');media.src=url;if(media.tagName==='VIDEO'){media.controls=false;media.muted=true;media.loop=true;media.autoplay=true;media.playsInline=true;}preview.appendChild(media);vvApplyStoryFilter();}
            }
        });
        document.getElementById('storyMusicPreviewPlay')?.addEventListener('click', async () => {
            const source=null;
            if(vvSelectedTrack&&!source){
                const player=document.getElementById('storyMusicPreview');
                clearInterval(vvPreviewTimer);player.pause();player.src=vvSelectedTrack.url;
                const start=Math.max(0,Number(musicStartInput?.value)||0),length=Math.max(3,Number(musicLengthInput?.value)||10);
                const begin=()=>{player.currentTime=start;player.volume=vvMusicFade?.checked?0:0.9;player.play().catch(()=>{});const started=Date.now();vvPreviewTimer=setInterval(()=>{const elapsed=(Date.now()-started)/1000;if(elapsed>=length){clearInterval(vvPreviewTimer);player.pause();return;}player.volume=vvMusicFade?.checked?0.9*Math.max(0,Math.min(1,elapsed/.5,(length-elapsed)/.5)):0.9;},80);};
                if(player.readyState>=1)begin();else player.onloadedmetadata=begin;
                return;
            }
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
                if(name)name.textContent=input.files?.length?'Файл загружен':'Файл не загружен';
            });
        });
        storyCreateForm?.addEventListener('submit', async event => {
            event.preventDefault(); if (!state.user) return;
            if(state.storyUploading)return;
            if(!vvCommitCurrentText())return;
            const text=vvAllStoryText(); const gallery=storyGalleryInput?.files?.[0]||null; const image=gallery?.type.startsWith('image/')?gallery:null; const video=gallery?.type.startsWith('video/')?gallery:null; const music=null;
            if(gallery&&!image&&!video){storyStatus.textContent='Выбери фото или видео из галереи.';storyStatus.classList.remove('hidden');return;}
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
                if(vvMusicApplied&&vvSelectedTrack&&!music){musicURL=vvSelectedTrack.url;}
                if(music) { storyStatus.textContent='Обрезаем выбранный фрагмент музыки…'; const start=Math.max(0,Number(musicStartInput?.value)||0); const length=Math.max(3,Math.min(10,Number(musicLengthInput?.value)||10)); const trimmedMusic=await trimMusicFile(music,start,length); storyStatus.textContent='Загружаем готовый аудиофрагмент…'; musicURL=await uploadStoryMedia(trimmedMusic,'audio'); }
                const now=Date.now();
                const mentionTargets=await vvResolveMentionUids(text);
                const storyRef = await addDoc(collection(db,'stories'),{uid:state.user.uid,displayName:state.userProfile?.displayName||state.user.displayName||'Пользователь',username:state.userProfile?.username||'',photoURL:state.userProfile?.photoURL||state.user.photoURL||'',text:text.slice(0,500),mediaURL,mediaType,musicURL,musicStart:vvSelectedTrack&&!music?Math.max(0,Number(musicStartInput?.value)||0):0,musicLength:vvSelectedTrack&&!music?Math.max(3,Number(musicLengthInput?.value)||10):10,musicFade:!!vvMusicFade?.checked,storyFilter:vvStoryFilter,textPosition:{x:0,y:0},textLayers:vvTextLayers.slice(0,10),mentions:mentionTargets.map(x=>x.username),mentionedUids:mentionTargets.map(x=>x.uid),likes:[],views:[],replies:[],createdAt:now,expiresAt:now+24*60*60*1000});
                for(const target of mentionTargets){
                    try{await setDoc(doc(db,'users',target.uid,'storyMentions',storyRef.id),{storyId:storyRef.id,fromUid:state.user.uid,fromUsername:state.userProfile?.username||'',recipientUid:target.uid,createdAt:now,expiresAt:now+86400000});}
                    catch(e){console.warn('Could not notify tagged user',target.uid,e);}
                }
                vvResetStoryDraftText();storyGalleryInput.value='';document.getElementById('storyGalleryName').textContent='Файл не загружен';const galleryPreview=document.getElementById('storyGalleryPreview');if(galleryPreview){if(galleryPreview.dataset.objectUrl)URL.revokeObjectURL(galleryPreview.dataset.objectUrl);galleryPreview.replaceChildren();galleryPreview.classList.add('hidden');}if(musicStartInput)musicStartInput.value='0';if(musicLengthInput)musicLengthInput.value='10';setMusicPreviewFile(null);vvSelectedTrack=null;vvMusicApplied=false;vvMusicPlayer?.pause();vvCanvasText.textContent='';vvCanvasText.classList.add('hidden');vvDeleteText?.classList.add('hidden');vvDragText?.classList.add('hidden');document.getElementById('vvStorySongChip').textContent='♫ Музыка';vvMusicSelected?.classList.add('hidden');vvMusicClear?.classList.add('hidden');vvRenderCatalog();updateMusicTrimLabel();vvStoryScreen('list');vvStoryFilter='none';vvStoryFilterBox?.classList.add('hidden');const createBtn=document.getElementById('storyCreateToggle');if(createBtn)createBtn.innerHTML='<i class="fa-solid fa-plus"></i> Добавить фото или видео';await refreshStories();
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
        document.getElementById('profileBannerFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];const n=document.getElementById('profileBannerFileName');if(n)n.textContent=f?'Файл загружен':'Файл не загружен';});
        document.getElementById('uploadProfileBannerBtn')?.addEventListener('click',async()=>{const f=document.getElementById('profileBannerFile')?.files?.[0];if(!f)return alert('Сначала выбери изображение.');if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Банер профиля доступен только Premium.');if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024)return alert('Выбери JPG, PNG или WebP размером до 5 МБ.');const b=document.getElementById('uploadProfileBannerBtn');b.disabled=true;try{const url=await uploadImageToCloudinary(f,'profile-banners');await updateDoc(doc(db,'users',state.user.uid),{bannerURL:url,updatedAt:Date.now()});state.userProfile.bannerURL=url;renderSocialProfile();alert('Банер установлен!');}catch(e){console.error(e);alert(`Не удалось загрузить банер в Cloudinary: ${e?.message||'ошибка загрузки'}`);}finally{b.disabled=false;}});

        // Groups are available only for people already in the user's friend list.
        const groupModal=document.getElementById('createGroupModal');
        setInterval(() => { if (state.user && currentTab === 'chats') refreshGroupsFromServer(); }, 20000);
        document.getElementById('createGroupBtn')?.addEventListener('click',()=>{const host=document.getElementById('groupFriendsChoices');if(!friendsCache.length){host.innerHTML='<p class="text-sm text-slate-400">Сначала добавь друзей.</p>';}else host.innerHTML=friendsCache.map(f=>`<label class="flex items-center gap-3 rounded-xl border border-slate-700 p-3"><input type="checkbox" class="group-friend-check accent-violet-500" value="${escapeHTML(f.uid||f.id)}"><span class="min-w-0"><b class="block text-sm">${escapeHTML(f.displayName||'Друг')}</b><span class="text-xs text-slate-500">@${escapeHTML(f.username||'')}</span></span></label>`).join('');document.getElementById('createGroupStatus').textContent='';groupModal?.classList.remove('hidden');});
        document.getElementById('closeCreateGroup')?.addEventListener('click',()=>groupModal?.classList.add('hidden'));
        document.getElementById('confirmCreateGroup')?.addEventListener('click',async()=>{const name=(document.getElementById('groupNameInput')?.value||'').trim().slice(0,40);const members=[...document.querySelectorAll('.group-friend-check:checked')].map(e=>e.value);const status=document.getElementById('createGroupStatus');if(!name){status.textContent='Введи название группы.';return;}if(!members.length){status.textContent='Выбери хотя бы одного друга.';return;}const btn=document.getElementById('confirmCreateGroup');btn.disabled=true;try{const res=await createGroupCall({name,members});const groupId=res.data.id;groupModal.classList.add('hidden');document.getElementById('groupNameInput').value='';await refreshGroupsFromServer(state.user.uid,true);const snap=await getDoc(doc(db,'groups',groupId));if(snap.exists())groupsCache=[{id:groupId,...snap.data()},...groupsCache.filter(g=>g.id!==groupId)];renderChatFriends();openGroupConversation(groupId);}catch(e){console.error(e);status.textContent=e?.message||'Не удалось создать группу. Проверь Firestore Rules.';}finally{btn.disabled=false;}});
        async function openGroupConversation(groupId){if(!state.user)return;const group=groupsCache.find(g=>g.id===groupId);if(!group||!(group.members||[]).includes(state.user.uid))return;activeGroupId=groupId;bumpRecentChat('group:'+groupId);activeFriend=null;activeConversationId=null;if(state.messageUnsub){state.messageUnsub();state.messageUnsub=null;}const pane=document.getElementById('conversationPane');pane?.classList.remove('hidden','conversation-empty');socialChatsPanel.classList.add('chat-open');const header=document.getElementById('conversationHeader');if(header)header.innerHTML=`<button id="conversationBack" class="mr-2 rounded-lg px-2 py-1" aria-label="Назад">‹</button><i class="fa-solid fa-users mr-2 text-violet-300"></i>${escapeHTML(group.name||'Группа')} <span class="ml-2 text-xs text-slate-500">${(group.members||[]).length} участников</span><button id="vvGroupSettingsBtn" class="ml-auto rounded-xl border border-violet-400/40 px-3 py-2">⚙ Участники</button>`;document.getElementById('vvGroupSettingsBtn')?.addEventListener('click',()=>showGroupSettings(groupId));document.getElementById('conversationBack')?.addEventListener('click',()=>socialChatsPanel.classList.remove('chat-open'));const host=document.getElementById('messagesList');host.style.backgroundImage=group.wallpaperURL?`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${group.wallpaperURL}")`:'';host.style.backgroundSize='cover';host.innerHTML='<p class="text-sm text-slate-400">Открываем группу…</p>';document.getElementById('messageInput').disabled=false;document.getElementById('sendMessageBtn').disabled=false;document.getElementById('snakeChallengeBtn').disabled=true;state.messageUnsub=onSnapshot(query(collection(db,'groups',groupId,'messages'),orderBy('createdAt','asc'),limitToLast(200)),snap=>{if(activeGroupId!==groupId)return;const stickToBottom=host.scrollHeight-host.scrollTop-host.clientHeight<96||host.dataset.loadedChat!=='group:'+groupId;const previousScroll=host.scrollTop;host.dataset.loadedChat='group:'+groupId;host.innerHTML=snap.empty?'<p class="text-sm text-slate-500">Группа создана. Напишите первое сообщение 👋</p>':snap.docs.map(d=>vvRenderChatMessage({id:d.id,...d.data()},'groups',groupId)).join('');vvBindMessageActions(host);host.scrollTop=stickToBottom?host.scrollHeight:previousScroll;},err=>{console.error(err);host.innerHTML='<p class="text-sm text-rose-300">Не удалось загрузить сообщения группы. Проверь Firestore Rules.</p>';});showTab('chats');renderChatFriends();}

        // Premium custom sticker library. Existing stickers remain visible after Premium expires.
        document.getElementById('uploadStickerBtn')?.addEventListener('click',()=>{if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Загрузка собственных стикеров доступна только Premium. Сами сохранённые стикеры останутся видны.');document.getElementById('stickerFileInput')?.click();});
        document.getElementById('stickerFileInput')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Выбери изображение.');if(f.size>2*1024*1024)return alert('Стикер должен быть меньше 2 МБ.');try{const url=await uploadImageToCloudinary(f,'stickers');const stickerRef=doc(collection(db,'users',state.user.uid,'stickers'));await setDoc(stickerRef,{url,name:f.name.slice(0,80),createdAt:Date.now()});e.target.value='';alert('Стикер добавлен в твою коллекцию!');}catch(err){console.error(err);alert(`Не удалось загрузить стикер: ${err?.message||'ошибка Cloudinary/Firestore'}`);}});
        document.getElementById('openStickersBtn')?.addEventListener('click',async()=>{const panel=document.getElementById('stickersPanel');panel.classList.toggle('hidden');if(panel.classList.contains('hidden'))return;const grid=document.getElementById('stickersGrid');const hint=document.getElementById('stickersPanelHint');grid.innerHTML='<span class="text-xs text-slate-400">Загружаем стикеры…</span>';try{const owners=[state.user.uid];const all=[];for(const owner of owners){const snap=await getDocs(query(collection(db,'users',owner,'stickers'),orderBy('createdAt','desc'),limit(50)));snap.docs.forEach(d=>all.push({id:d.id,owner,...d.data()}));}grid.innerHTML=all.length?all.map(st=>`<button data-send-sticker="${escapeHTML(st.url)}" data-sticker-owner="${escapeHTML(st.owner)}" class="rounded-xl border border-slate-700 p-1"><img src="${escapeHTML(st.url)}" alt="Стикер" class="h-14 w-14 rounded-lg object-contain"></button>`).join(''):'<span class="text-xs text-slate-400">Пока нет стикеров. Premium позволяет загрузить свои.</span>';hint.textContent=Number(state.userProfile?.premiumUntil||0)>Date.now()?'Нажми на стикер, чтобы отправить его.':'Ты можешь просматривать стикеры, но отправка доступна только Premium.';grid.querySelectorAll('[data-send-sticker]').forEach(b=>b.addEventListener('click',async()=>{if(Number(state.userProfile?.premiumUntil||0)<=Date.now())return alert('Отправка стикеров доступна только Premium.');try{const url=b.dataset.sendSticker;const payload={senderUid:state.user.uid,text:url,type:'sticker',createdAt:Date.now()};if(activeGroupId){await addDoc(collection(db,'groups',activeGroupId,'messages'),payload);await updateDoc(doc(db,'groups',activeGroupId),{updatedAt:Date.now(),lastMessage:'✨ Стикер'});}else if(activeConversationId){await addDoc(collection(db,'conversations',activeConversationId,'messages'),payload);await updateDoc(doc(db,'conversations',activeConversationId),{updatedAt:Date.now(),lastMessage:'✨ Стикер'});bumpRecentChat(activeFriend);}else return;panel.classList.add('hidden');}catch(err){console.error(err);alert('Не удалось отправить стикер. Проверь Rules.');}}));}catch(err){console.error(err);grid.innerHTML='<span class="text-xs text-rose-300">Не удалось загрузить стикеры. Проверь Firestore Rules.</span>';}});
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

        let socialGeneration = 0, friendGeneration = 0;
        function stopSocialListeners() {
            socialGeneration++; friendGeneration++;
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
            /* Keep cached groups visible during temporary reconnects. */
        }
        // Merge group sources instead of allowing a late cached/empty snapshot to erase a valid server response.
        function vvMergeGroups(incoming, uid = state.user?.uid) {
            if (!uid || !Array.isArray(incoming) || state.user?.uid !== uid) return;
            const merged = new Map(groupsCache.filter(g => Array.isArray(g.members) && g.members.includes(uid)).map(g => [g.id, g]));
            for (const g of incoming) {
                if (!g?.id || !Array.isArray(g.members) || !g.members.includes(uid)) continue;
                merged.set(g.id, {...(merged.get(g.id) || {}), ...g});
            }
            groupsCache = [...merged.values()].sort((a,b) => Number(b.updatedAt?.toMillis?.() || b.updatedAt || 0) - Number(a.updatedAt?.toMillis?.() || a.updatedAt || 0));
            renderChatFriends();
        }
        function vvGroupLoadStatus(message = '', error = false) {
            const node = document.getElementById('vvGroupLoadStatus');
            if (!node) return;
            node.textContent = message;
            node.classList.toggle('hidden', !message);
            node.style.color = error ? '#fda4af' : '#c4b5fd';
        }
        let groupsServerRefreshAt = 0;
        let groupsServerRefreshPromise = null;
        async function refreshGroupsFromServer(uid = state.user?.uid, force = false) {
            if (!uid || state.user?.uid !== uid) return;
            if (groupsServerRefreshPromise) return groupsServerRefreshPromise;
            if (!force && Date.now() - groupsServerRefreshAt < 12000) return;
            groupsServerRefreshAt = Date.now();
            if (!groupsCache.length) vvGroupLoadStatus('Проверяем доступные группы…');
            groupsServerRefreshPromise = (async () => {
                try {
                    const res = await workerPost('/my-groups');
                    if (state.user?.uid !== uid || !Array.isArray(res?.data?.groups)) return;
                    const serverGroups = res.data.groups.filter(g => Array.isArray(g.members) && g.members.includes(uid));
                    // The server uses verified Firebase credentials and can recover groups
                    // even if the local Firestore query is denied by older published rules.
                    vvMergeGroups(serverGroups, uid);
                    vvGroupLoadStatus(serverGroups.length ? '' : 'Сервер не нашёл групп, в которых твой аккаунт указан участником. Если тебя добавляли раньше, попроси создателя проверить список участников.', !serverGroups.length);
                } catch(err) {
                    console.warn('Server groups refresh (deploy updated worker.js):',err);
                    vvGroupLoadStatus('Ошибка загрузки групп: '+(err?.message||'проверь Cloudflare Worker и Firestore'), true);
                }
            })();
            try { await groupsServerRefreshPromise; } finally { groupsServerRefreshPromise = null; }
        }
        async function refreshGroupsOnce(uid = state.user?.uid) {
            if (!uid) return;
            try {
                const snap = await getDocs(query(collection(db,'groups'), where('members','array-contains',uid)));
                vvMergeGroups(snap.docs.map(d => ({ id:d.id, ...d.data() })), uid);
            } catch (err) {
                console.warn('Groups refresh:', err);
                await refreshGroupsFromServer(uid);
            }
        }
        function startSocialListeners() {
            stopSocialListeners();
            if (!state.user) return;
            const uid = state.user.uid;
            const generation = socialGeneration;
            try { for (const [key,time] of JSON.parse(localStorage.getItem('vv_recent_'+uid)||'[]')) if (typeof key==='string' && Number.isFinite(time)) recentChatTimes.set(key,time); } catch (_) {}
            state.groupUnsub = onSnapshot(query(collection(db,'groups'), where('members','array-contains',uid)), snap => { vvMergeGroups(snap.docs.map(d=>({id:d.id,...d.data()})),uid); }, err => { console.warn('Groups listener:',err); if(err.code==='permission-denied') console.warn('Проверь опубликованные Firestore Rules: запрос уже использует array-contains для members.'); refreshGroupsOnce(uid); });
            refreshGroupsOnce(uid);
            refreshGroupsFromServer(uid, true);
            // Real-time conversation order: newest message (sent or received) appears first.
            state.socialUnsubs.push(onSnapshot(query(collection(db,'conversations'), where('participants','array-contains',uid)), snap => {
                // Preserve optimistic ordering until Firestore confirms the newest update.
                snap.docs.forEach(d => {
                    const data=d.data();
                    (data.participants||[]).filter(id=>id!==uid).forEach(id=>recentChatTimes.set(id, Math.max(recentChatTimes.get(id)||0, Number(data.updatedAt?.toMillis?.() || data.updatedAt || 0))));
                });
                renderChatFriends();
            }, err => { console.warn('Conversation order listener:',err); renderChatFriends(); }));
            refreshStories().catch(err => console.warn('Initial stories refresh:', err));
            state.socialUnsubs.push(onSnapshot(doc(db,'users',uid), snap => { if(snap.exists()){ state.userProfile={...(state.userProfile||{}),...snap.data()}; renderSocialProfile(); } }, err => console.warn('Own profile listener:',err)));
            // Approximate online users, measured by a heartbeat no older than 90 seconds.
            const publicPresenceRef = doc(db, 'onlinePublic', uid);
            const onlineCounterNode = document.getElementById('vvOnlineCountNumber');
            const onlineCounterRefresh = async () => {
                try {
                    const cutoff = Date.now() - 90000;
                    const snapshot = await getCountFromServer(query(collection(db, 'onlinePublic'), where('lastSeen', '>=', cutoff)));
                    if (onlineCounterNode) onlineCounterNode.textContent = String(snapshot.data().count);
                } catch (error) {
                    console.warn('Online counter unavailable:', error);
                    if (onlineCounterNode) onlineCounterNode.textContent = '—';
                }
            };
            const publishPublicPresence = async () => {
                try { await setDoc(publicPresenceRef, { uid, lastSeen: document.hidden ? 0 : Date.now() }); }
                catch (error) { console.warn('Online heartbeat:', error); }
                await onlineCounterRefresh();
            };
            publishPublicPresence();
            const publicPresenceTimer = setInterval(publishPublicPresence, 30000);
            const publicPresenceVisibility = () => publishPublicPresence();
            document.addEventListener('visibilitychange', publicPresenceVisibility);
            state.socialUnsubs.push(() => {
                clearInterval(publicPresenceTimer);
                document.removeEventListener('visibilitychange', publicPresenceVisibility);
                setDoc(publicPresenceRef, { uid, lastSeen: 0 }).catch(() => {});
                if (onlineCounterNode) onlineCounterNode.textContent = '—';
            });
            const presenceRef = doc(db, 'presence', uid);
            const publishPresence = () => setDoc(presenceRef, { uid, online: !document.hidden, lastSeen: Date.now() }, { merge:true }).catch(err => console.warn('Presence update:', err));
            publishPresence();
            state.presenceHeartbeat = setInterval(publishPresence, 30000);
            document.addEventListener('visibilitychange', publishPresence);
            state.socialUnsubs.push(() => document.removeEventListener('visibilitychange', publishPresence));
            const publishOffline = () => setDoc(presenceRef, { uid, online:false, lastSeen:Date.now() }, { merge:true }).catch(()=>{});
            window.addEventListener('pagehide', publishOffline);
            state.socialUnsubs.push(() => window.removeEventListener('pagehide', publishOffline));
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friendRequests'), snap => {
                friendRequestsCache = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(r => r.status === 'pending');
                document.getElementById('vvRequestDot')?.classList.toggle('hidden', !friendRequestsCache.length);
                renderFriendRequests();
            }, err => console.warn('Friend request listener:', err)));
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friends'), async snap => {
                const friendsVersion = ++friendGeneration;
                friendsCache = snap.docs.map(d => ({ id:d.id, ...d.data(), uid:d.id }));
                refreshUnreadListeners();
                renderFriends(); renderChatFriends(); renderSocialProfile();
                state.presenceUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
                state.presenceUnsubs = [];
                for (const friend of friendsCache) {
                    try {
                        const ps = await getDoc(doc(db,'users',friend.uid));
                        if (ps.exists()) Object.assign(friend, ps.data());
                    } catch (err) { console.warn('Friend profile:', err); }
                    if (generation !== socialGeneration || friendsVersion !== friendGeneration || state.user?.uid !== uid) return;
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
            host.innerHTML = friendRequestsCache.map(r => `<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-slate-950/80 p-3">${avatarMarkup({...r, uid:r.fromUid},'h-11 w-11')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(r.displayName || 'Пользователь')} ${roleBadgeMarkup(r.fromUid)} <span class="ml-1 text-xs font-normal text-violet-300">хочет добавить вас</span></p><p class="text-xs text-slate-400">@${escapeHTML(r.username || 'user')}</p></div><button data-accept="${escapeHTML(r.fromUid)}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold">Принять</button><button data-reject="${escapeHTML(r.fromUid)}" class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Отклонить</button></div>`).join('');
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
            if (header) header.innerHTML = `<div class="flex items-center gap-3"><button id="conversationBack" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800" aria-label="Назад к друзьям"><i class="fa-solid fa-arrow-left"></i></button>${chatAvatarMarkup(f,'h-10 w-10')}<button type="button" id="conversationFriendProfile" class="min-w-0 text-left"><div class="font-semibold text-slate-100"><span class="${Number(f.premiumUntil||0)>Date.now()?'vv-premium-name':''}">${escapeHTML(f.displayName || 'Друг')}${Number(f.premiumUntil||0)>Date.now()?' 👑':''}</span> ${roleBadgeMarkup(uid)}</div><div class="text-xs text-violet-300">@${escapeHTML(f.username || 'user')}</div>${presenceLabel(uid)}</button><button type="button" id="vvChatCallButton" class="vv-friend-call-button ml-auto" aria-label="Позвонить другу" title="Позвонить другу"><i class="fa-solid fa-phone"></i><span class="hidden sm:inline">Позвонить</span></button></div>`;
            document.getElementById('conversationBack')?.addEventListener('click', closeConversation);
            document.getElementById('conversationFriendProfile')?.addEventListener('click', () => openFriendProfile(uid)); document.getElementById('vvChatCallButton')?.addEventListener('click',()=>startFriendCall(uid));
        }
        function closeConversation() {
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }
            activeFriend = null; activeConversationId = null; activeGroupId = null;
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
            if(modal) modal.remove();
            modal=document.createElement('div');
            modal.id='friendProfileModal';
            modal.className='fixed inset-0 flex justify-center bg-slate-950/90 backdrop-blur';
            modal.innerHTML='<div class="vv-visitor-card"><button id="friendProfileClose" class="vv-visitor-close" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button><div id="friendProfileContent"></div></div>';
            document.body.appendChild(modal);
            modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
            modal.querySelector('#friendProfileClose').addEventListener('click',()=>modal.remove());
            const content=modal.querySelector('#friendProfileContent');
            // A profile banner is visible only while the profile owner's Premium is active.
            const visitorPremium = Number(profile.premiumUntil || 0) > Date.now();
            const coverUrl = visitorPremium ? String(profile.bannerURL || '').replace(/["\\]/g,'') : '';
            const cover = coverUrl ? `url("${coverUrl}")` : '';
            content.innerHTML=`${cover ? `<div class="vv-visitor-cover" style="--vv-cover-image:${escapeHTML(cover)};background-image:${escapeHTML(cover)}"></div>` : ''}<div class="vv-visitor-info"><div class="vv-visitor-identity"><div>${avatarMarkup(profile,'h-24 w-24')}</div><div class="min-w-0 flex-1 pb-2"><h2 class="text-xl font-bold break-words ${Number(profile.premiumUntil||0)>Date.now()?'vv-premium-name':''}">${escapeHTML(profile.displayName||'Пользователь')}${Number(profile.premiumUntil||0)>Date.now()?' 👑':''} ${roleBadgeMarkup(uid)}</h2><p class="text-violet-300">@${escapeHTML(profile.username||'user')}</p></div></div><p class="mt-3 whitespace-pre-wrap break-words text-sm text-slate-300">${escapeHTML(profile.bio||'')}</p><div class="vv-visitor-actions"><button id="profileViewStories" class="rounded-xl border border-slate-700 px-3 py-3 text-sm">Истории</button>${friendsCache.some(f=>String(f.uid||f.id)===String(uid))?`<button id="profileMessageUser" class="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold">Написать</button>`:`<button id="profileAddUser" class="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold">Добавить в друзья</button>`}</div></div>`;
            content.querySelector('#profileViewStories')?.addEventListener('click',()=>{const has=activeStoryItems.some(st=>st.uid===uid&&Number(st.expiresAt)>Date.now());if(has){modal.remove();storiesModal?.classList.remove('hidden');openStoryByUser(uid);}else{storiesModal?.classList.remove('hidden');refreshStories();}});
            content.querySelector('#profileMessageUser')?.addEventListener('click',()=>{modal.remove();openConversation(uid);});
            content.querySelector('#profileAddUser')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Отправляем…';try{await sendFriendRequest(uid);b.textContent='Заявка отправлена';}catch(err){b.disabled=false;b.textContent='Повторить';alert(err.message||'Не удалось отправить заявку.');}});
        }
        async function openFriendProfile(uid) {
            // Always open the same cover-first profile used in search and friends.
            return openAnyUserProfile(uid);
        }
        async function renderFriends() {
            const host = document.getElementById('friendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет друзей. Добавить можно во время разговора в рулетке.</p>'; return; }
            await preloadRoles(friendsCache);
            host.innerHTML = friendsCache.map(f => {
                const uid=f.uid || f.id;
                return `<div class="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">${avatarMarkup(f,'h-11 w-11')}<div class="min-w-0 flex-1"><button type="button" data-view-profile="${escapeHTML(uid)}" class="block max-w-full truncate text-left text-sm font-semibold hover:text-violet-300"><span class="${Number(f.premiumUntil||0)>Date.now()?'vv-premium-name':''}">${escapeHTML(f.displayName || 'Друг')}${Number(f.premiumUntil||0)>Date.now()?' 👑':''}</span> ${roleBadgeMarkup(uid)}</button><button type="button" data-view-profile="${escapeHTML(uid)}" class="block text-left text-xs text-slate-500 hover:text-violet-300">@${escapeHTML(f.username || 'user')}</button>${presenceLabel(uid)}</div><button data-callfriend="${escapeHTML(uid)}" class="vv-friend-call-button" title="Позвонить" aria-label="Позвонить другу"><i class="fa-solid fa-phone"></i></button><button data-chatfriend="${escapeHTML(uid)}" class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold">Написать</button></div>`;
            }).join('');
            host.querySelectorAll('[data-callfriend]').forEach(b => b.addEventListener('click', () => startFriendCall(b.dataset.callfriend)));
            host.querySelectorAll('[data-chatfriend]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.chatfriend)));
            host.querySelectorAll('[data-view-profile]').forEach(b => b.addEventListener('click', () => openAnyUserProfile(b.dataset.viewProfile)));
        }
        function unreadStorageKey(friendUid) { return `vv_read_${state.user?.uid || 'guest'}_${friendUid}`; }
        function getLastReadAt(friendUid) { return Number(localStorage.getItem(unreadStorageKey(friendUid)) || 0); }
        function updateUnreadBadge() {
            const total = [...state.unreadCounts.values()].reduce((sum, n) => sum + n, 0)+vvMentionPeers().reduce((n,p)=>n+vvMentionUnread(p.uid),0);
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

        const recentChatTimes = new Map();
        let chatRenderSequence = 0;
        function bumpRecentChat(uid, time = Date.now()) { if (!uid) return; recentChatTimes.set(uid, Math.max(recentChatTimes.get(uid)||0, time)); try { localStorage.setItem('vv_recent_'+state.user.uid,JSON.stringify([...recentChatTimes])); } catch (_) {} renderChatFriends(); }
        async function renderChatFriends() {
            const sequence = ++chatRenderSequence;
            const host = document.getElementById('chatFriendsList');
            if (!friendsCache.length && !groupsCache.length && !vvChatMentions.length) { host.innerHTML = '<p class="p-2 text-sm text-slate-500">Добавь друга или создай группу, чтобы начать переписку.</p>'; return; }
            await preloadRoles(friendsCache);
            if (sequence !== chatRenderSequence) return;
            const sortedFriends = [...friendsCache,...vvMentionPeers().filter(p=>!friendsCache.some(f=>(f.uid||f.id)===p.uid))].sort((a,b) => (recentChatTimes.get(b.uid||b.id)||0) - (recentChatTimes.get(a.uid||a.id)||0));
            const friendsHtml = sortedFriends.map(f => {
                const uid=f.uid || f.id; const unread=Number(state.unreadCounts.get(uid)||0)+vvMentionUnread(uid);
                const isPremium = Number(f.premiumUntil || 0) > Date.now();
                return `<button data-unread="${unread}" data-openchat="${escapeHTML(uid)}" class="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-800 ${activeFriend === uid && !activeGroupId ? 'bg-slate-800' : ''}">${chatAvatarMarkup(f,'h-10 w-10')}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold ${isPremium?'vv-premium-name':''}">${escapeHTML(f.displayName || 'Друг')}${isPremium?' 👑':''} ${roleBadgeMarkup(uid)}</span>${f.mentionOnly?'<span class="block text-xs text-violet-300">Отметка в истории</span>':presenceLabel(uid)}</span><span ${f.mentionOnly?'hidden':''} data-callfriend="${escapeHTML(uid)}" role="button" tabindex="0" aria-label="Позвонить другу" title="Позвонить" class="vv-friend-call-button"><i class="fa-solid fa-phone"></i></span>${unread ? `<span class="min-w-6 h-6 px-1 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-extrabold inline-flex items-center justify-center">${unread>99?'99+':unread}</span>` : ''}<span class="text-xs text-slate-500">›</span></button>`;
            }).join('<!--vv-chat-split-->');
            const groupsHtml = groupsCache.map(g => `<button data-opengroup="${escapeHTML(g.id)}" class="flex w-full items-center gap-3 rounded-xl border border-violet-400/10 p-3 text-left transition hover:bg-violet-500/10 ${activeGroupId===g.id?'bg-violet-500/10':''}"><span class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><i class="fa-solid fa-users"></i></span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${escapeHTML(g.name||'Группа')}</span><span class="block text-xs text-slate-500">${(g.members||[]).length} участников</span></span><span class="text-xs text-violet-300">Группа</span></button>`).join('<!--vv-chat-split-->');
            // One chronological list: groups must not remain pinned above recent private chats.
            const combined = [
                ...sortedFriends.map((f, i) => ({ html: friendsHtml.split('<!--vv-chat-split-->')[i], time: recentChatTimes.get(f.uid||f.id)||0 })),
                ...groupsCache.map((g, i) => ({ html: groupsHtml.split('<!--vv-chat-split-->')[i], time: Math.max(recentChatTimes.get('group:'+g.id)||0,Number(g.updatedAt?.toMillis?.() || g.updatedAt || 0)) }))
            ].sort((a,b) => b.time-a.time);
            host.innerHTML = combined.map(x=>x.html).join('');
            applyVvChatFilter();
            host.querySelectorAll('[data-callfriend]').forEach(b => { b.addEventListener('click', e => { e.stopPropagation(); startFriendCall(b.dataset.callfriend); }); b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();startFriendCall(b.dataset.callfriend);}}); });
            host.querySelectorAll('[data-openchat]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.openchat)));
            host.querySelectorAll('[data-opengroup]').forEach(b => b.addEventListener('click', () => openGroupConversation(b.dataset.opengroup)));
        }
        // Local search/filter does not change Firestore permissions or chat listeners.
        let vvChatFilter = 'all';
        function applyVvChatFilter() {
            const host = document.getElementById('chatFriendsList');
            if (!host) return;
            const q = (document.getElementById('vvChatSearch')?.value || '').trim().toLocaleLowerCase();
            let shown = 0;
            host.querySelectorAll('[data-openchat], [data-opengroup]').forEach(el => {
                const group = el.hasAttribute('data-opengroup');
                const unread = Number(el.dataset.unread || 0);
                const matchesType = vvChatFilter === 'all' || (vvChatFilter === 'private' && !group) || (vvChatFilter === 'groups' && group) || (vvChatFilter === 'unread' && unread > 0);
                const matchesText = !q || el.textContent.toLocaleLowerCase().includes(q);
                el.style.display = matchesType && matchesText ? '' : 'none';
                if (matchesType && matchesText) shown++;
            });
            const totalUnread = [...host.querySelectorAll('[data-unread]')].reduce((n,el)=>n+(Number(el.dataset.unread)>0?1:0),0);
            const count = document.getElementById('vvUnreadFilterCount');
            if (count) { count.textContent = totalUnread; count.classList.toggle('hidden',totalUnread===0); }
            let empty = document.getElementById('vvChatFilterEmpty');
            if (!empty) { empty=document.createElement('p'); empty.id='vvChatFilterEmpty';empty.className='vv-chat-empty hidden';host.after(empty); }
            empty.textContent = q ? 'По вашему запросу чаты не найдены' : 'В этой категории пока нет чатов';
            empty.classList.toggle('hidden', shown > 0 || !host.querySelector('[data-openchat], [data-opengroup]'));
        }
        document.getElementById('vvChatSearch')?.addEventListener('input',applyVvChatFilter);
        document.querySelectorAll('[data-chat-filter]').forEach(btn => btn.addEventListener('click',()=>{
            vvChatFilter=btn.dataset.chatFilter;
            document.querySelectorAll('[data-chat-filter]').forEach(b=>b.classList.toggle('active',b===btn));
            applyVvChatFilter();
        }));
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

        const vvMenu=document.getElementById('vvProfileMenu');
        function setVVMenuOpen(open){if(!vvMenu)return;vvMenu.classList.toggle('hidden',!open);document.getElementById('vvMenuToggle')?.setAttribute('aria-expanded',String(open));document.body.classList.toggle('vv-menu-open',open);if(open)document.getElementById('vvMenuClose')?.focus();else document.getElementById('vvMenuToggle')?.focus();}
        document.getElementById('vvMenuToggle')?.addEventListener('click',()=>setVVMenuOpen(true));
        document.getElementById('vvMenuClose')?.addEventListener('click',()=>setVVMenuOpen(false));
        vvMenu?.addEventListener('click',e=>{if(e.target===vvMenu)setVVMenuOpen(false)});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!vvMenu?.classList.contains('hidden'))setVVMenuOpen(false)});
        async function developerGrant(type) {
          const status=document.getElementById('devGrantStatus');
          const username=document.getElementById('devGrantUsername').value.trim();
          const amount=Number(document.getElementById('devGrantCoins').value);
          if (!username || (type==='coins' && (!Number.isSafeInteger(amount)||amount<1||amount>100000))) {status.textContent='Укажи @ник и корректное количество.';return;}
          if (!confirm(`Выдать ${type==='coins'?amount+' VibeCoins':'30 дней Premium'} пользователю ${username}?`))return;
          try { const data=await workerPost('/developer/grant',{username,type,amount:type==='coins'?amount:undefined});status.textContent=data.data?.message||'Выдано успешно'; }
          catch(e){status.textContent=e.message||'Ошибка выдачи';}
        }
        document.getElementById('devGrantCoinsBtn')?.addEventListener('click',()=>developerGrant('coins'));
        document.getElementById('devGrantPremiumBtn')?.addEventListener('click',()=>developerGrant('premium'));
        let settingsGroupId=null;
        async function showGroupSettings(groupId) {
          const g=groupsCache.find(x=>x.id===groupId);if(!g)return;
          settingsGroupId=groupId;
          const owner=g.createdBy===state.user?.uid;
          document.getElementById('vvGroupOwnerControls').classList.toggle('hidden',!owner);
          document.getElementById('vvGroupLeave').classList.toggle('hidden',owner);
          document.getElementById('vvGroupNewName').value=g.name||'';
          const inviteChoices=document.getElementById('vvGroupInviteChoices');
          if(inviteChoices) inviteChoices.innerHTML=owner ? friendsCache.filter(f=>!g.members.includes(f.uid||f.id)).map(f=>`<label class="flex items-center gap-2 p-2 rounded-lg border border-slate-700"><input type="checkbox" class="vv-group-invite-check" value="${escapeHTML(f.uid||f.id)}"><span>${escapeHTML(f.displayName||f.username||'Друг')}</span></label>`).join('') || '<p class="text-xs text-slate-400">Все друзья уже в группе</p>' : '';

          document.getElementById('vvGroupStatus').textContent='';
          document.getElementById('vvGroupSettings').classList.remove('hidden');
          const host=document.getElementById('vvGroupMembers');host.textContent='Загрузка участников…';
          const members=await Promise.all((g.members||[]).map(async uid=>{try{const d=await getDoc(doc(db,'users',uid));return d.exists()?d.data():{displayName:'Участник'};}catch{return {displayName:'Участник'};}}));
          host.innerHTML='<b>Участники ('+members.length+')</b>'+members.map((u,i)=>`<div class="mt-2 rounded-lg bg-slate-800 p-2">${escapeHTML(u.displayName||'Участник')} · @${escapeHTML(u.username||'—')}${g.members[i]===g.createdBy?' 👑 Администратор':''}</div>`).join('');
        }
        document.getElementById('vvGroupClose')?.addEventListener('click',()=>document.getElementById('vvGroupSettings').classList.add('hidden'));
        async function groupAction(action){const status=document.getElementById('vvGroupStatus');const name=document.getElementById('vvGroupNewName').value.trim();if(action==='delete'&&!confirm('Удалить группу для всех участников?'))return;if(action==='leave'&&!confirm('Выйти из группы?'))return;try{await workerPost('/group/manage',{groupId:settingsGroupId,action,name});status.textContent='Готово';if(action!=='rename'){document.getElementById('vvGroupSettings').classList.add('hidden');socialChatsPanel.classList.remove('chat-open');activeGroupId=null;}else{const g=groupsCache.find(x=>x.id===settingsGroupId);if(g)g.name=name;openGroupConversation(settingsGroupId);}}catch(e){status.textContent=e.message||'Ошибка';}}
        document.getElementById('vvGroupInviteBtn')?.addEventListener('click',async()=>{
          const status=document.getElementById('vvGroupStatus');
          const selected=[...document.querySelectorAll('.vv-group-invite-check:checked')].map(input=>input.value);
          if(!selected.length){status.textContent='Выбери друзей для добавления.';return;}
          const button=document.getElementById('vvGroupInviteBtn');button.disabled=true;
          try {await workerPost('/group/manage',{groupId:settingsGroupId,action:'add-members',members:selected});status.textContent='Участники добавлены. Теперь группа должна появиться у них в чатах.';await refreshGroupsFromServer(state.user.uid,true);await showGroupSettings(settingsGroupId);}
          catch(e){status.textContent='Ошибка добавления: '+(e?.message||'проверь Worker');}
          finally{button.disabled=false;}
        });
        document.getElementById('vvGroupRename')?.addEventListener('click',()=>groupAction('rename'));
        document.getElementById('vvGroupDelete')?.addEventListener('click',()=>groupAction('delete'));
        document.getElementById('vvGroupLeave')?.addEventListener('click',()=>groupAction('leave'));
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
            const batch = writeBatch(db);
            batch.set(doc(db,'users',state.user.uid,'friends',fromUid), batchFriend);
            batch.set(doc(db,'users',fromUid,'friends',state.user.uid), { uid:state.user.uid, displayName:me.displayName || 'Пользователь', username:me.username || '', photoURL:me.photoURL || '', addedAt:Date.now() });
            batch.delete(requestRef);
            await batch.commit();
        }
        async function rejectFriend(fromUid) {
            if (!state.user) return;
            await deleteDoc(doc(db,'users',state.user.uid,'friendRequests',fromUid));
        }
        async function openConversation(friendUid) {
            if (!state.user || !friendUid || friendUid === state.user.uid) return;
            const uid = String(friendUid);
            const friendDoc = friendsCache.find(f => String(f.uid || f.id) === uid)||vvMentionPeers().find(p=>p.uid===uid);
            vvDirectDocs=[];
            if (!friendDoc) {
                console.warn('Friend is not in local cache; attempting direct lookup', uid);
            }
            activeFriend = uid;
            bumpRecentChat(uid);
            activeGroupId = null;
            const convHeader = document.getElementById('conversationHeader'); if (convHeader) convHeader.innerHTML = `<button id="conversationBack" class="mr-2 rounded-lg px-2 py-1" aria-label="Назад">‹</button>${escapeHTML(friendDoc?.displayName || 'Чат')} <span class="text-xs text-slate-500">Личный чат</span>`;
            setTimeout(()=>document.getElementById('conversationBack')?.addEventListener('click',()=>socialChatsPanel.classList.remove('chat-open')),0);
            localStorage.setItem(unreadStorageKey(uid), String(Date.now()));
            state.unreadCounts.set(uid, 0); updateUnreadBadge();
            const pair = [state.user.uid, uid].sort();
            activeConversationId = pair.join('_');
            const openingId = activeConversationId;
            const openingUser = state.user.uid;
            const stillOpening = () => state.user?.uid === openingUser && activeConversationId === openingId && activeFriend === uid;
            const host = document.getElementById('messagesList');
            const input = document.getElementById('messageInput');
            const send = document.getElementById('sendMessageBtn');
            const game = document.getElementById('snakeChallengeBtn');
            const pane = document.getElementById('conversationPane');
            if (pane) pane.classList.remove('hidden', 'conversation-empty');
            socialChatsPanel.classList.add('chat-open');
            if (host) {host.style.backgroundImage='';host.innerHTML = '<p class="text-sm text-slate-400">Открываем переписку…</p>';} 
            if (input) input.disabled = true;
            if (send) send.disabled = true;
            if (game) game.disabled = true;
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }

            try {
                // Read the canonical friend document before attempting to create a conversation.
                const friendRef = doc(db, 'users', state.user.uid, 'friends', uid);
                const friendSnap = await getDoc(friendRef);
                if (!stillOpening()) return;
                if (!friendSnap.exists()) {
                    if(vvChatMentions.some(m=>m.fromUid===uid)){
                        activeConversationId=null;vvRenderDirectMessages(uid);showTab('chats');renderChatFriends();updateUnreadBadge();return;
                    }
                    throw new Error('FRIEND_DOC_MISSING: Этот пользователь отсутствует в списке друзей текущего аккаунта.');
                }
                const friendData = { ...friendSnap.data(), uid };
                updateConversationPresence(uid);
                const conversationRef = doc(db, 'conversations', openingId);
                const conversationSnap = await getDoc(conversationRef);
                if (!stillOpening()) return;
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

                const freshConversation = await getDoc(conversationRef); if (!stillOpening()) return; const wallpaperURL = freshConversation.exists() ? freshConversation.data().wallpaperURL : ''; const messageArea = document.getElementById('messagesList'); if(messageArea){messageArea.style.backgroundImage=wallpaperURL?`linear-gradient(rgba(15,23,42,.72),rgba(15,23,42,.72)),url("${wallpaperURL}")`:'';messageArea.style.backgroundSize='cover';}
                const messagesCol = collection(db, 'conversations', openingId, 'messages');
                state.messageUnsub = onSnapshot(
                    query(messagesCol, orderBy('createdAt', 'asc'), limitToLast(100)),
                    snap => {
                        if (!stillOpening()) return;
                        if (!host) return;
                        const stickToBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 96 || !host.dataset.loadedChat || host.dataset.loadedChat !== openingId;
                        const previousScroll = host.scrollTop;
                        host.dataset.loadedChat = openingId;
                        vvDirectDocs=snap.docs.map(d=>({id:d.id,...d.data()}));
                        vvRenderDirectMessages(uid);
                        host.scrollTop = stickToBottom ? host.scrollHeight : previousScroll;
                        localStorage.setItem(unreadStorageKey(uid), String(Date.now()));
                        state.unreadCounts.set(uid, 0); updateUnreadBadge(); renderChatFriends();
                    },
                    err => {
                        if (!stillOpening()) return;
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
                if (!stillOpening()) return;
                console.error('Conversation open failed:', e);
                if (host) host.innerHTML = `<div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"><b>Не удалось открыть чат</b><p class="mt-1">${escapeHTML(e.message || e.code || 'Неизвестная ошибка')}</p><p class="mt-2 text-xs text-rose-300">Проверь, что оба аккаунта добавлены друг к другу в друзья и опубликованы актуальные Firestore Rules.</p></div>`;
                if (input) input.disabled = true;
                if (send) send.disabled = true;
                if (game) game.disabled = true;
            }
        }
        const vvReactionEmojis=['❤️','👍','😂','🔥','😮','😢'];
        const vvReactionBusy=new Set();
        function vvReactionCounts(reactions){
            const counts=new Map();
            for(const emoji of Object.values(reactions||{}))if(vvReactionEmojis.includes(emoji))counts.set(emoji,(counts.get(emoji)||0)+1);
            return [...counts];
        }
        const vvReactionProfiles=new Map();
        const vvReactionProfileLoads=new Map();
        function vvKnownReactionProfile(uid){
            if(uid===state.user?.uid)return state.userProfile||state.user;
            return vvReactionProfiles.get(uid)||friendsCache.find(f=>(f.uid||f.id)===uid)||null;
        }
        function vvReactionAvatarContent(profile){
            const name=profile?.displayName||profile?.username||'Пользователь';
            const url=String(profile?.photoURL||'');
            const initial=Array.from(name.trim())[0]||'?';
            return /^https?:\/\//i.test(url)
                ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(name)}" loading="lazy" referrerpolicy="no-referrer"><span class="vv-reaction-initial" aria-hidden="true">${escapeHTML(initial.toUpperCase())}</span>`
                : `<span class="vv-reaction-initial">${escapeHTML(initial.toUpperCase())}</span>`;
        }
        function vvReactionAvatarMarkup(uid){
            const profile=vvKnownReactionProfile(uid);
            const name=profile?.displayName||profile?.username||'Пользователь';
            return `<span class="vv-reaction-avatar" data-reaction-user="${escapeHTML(uid)}" title="${escapeHTML(name)}" aria-label="${escapeHTML(name)}">${vvReactionAvatarContent(profile)}</span>`;
        }
        async function vvLoadReactionProfile(uid){
            const cached=vvReactionProfiles.get(uid);
            if(cached)return cached;
            if(!vvReactionProfileLoads.has(uid)){
                const load=getDoc(doc(db,'users',uid)).then(snap=>{
                    const profile=snap.exists()?snap.data():{displayName:'Пользователь'};
                    vvReactionProfiles.set(uid,profile);return profile;
                }).finally(()=>vvReactionProfileLoads.delete(uid));
                vvReactionProfileLoads.set(uid,load);
            }
            return vvReactionProfileLoads.get(uid);
        }
        async function vvHydrateReactionAvatars(host){
            const owner=state.user?.uid;if(!owner)return;
            const nodes=[...host.querySelectorAll('[data-reaction-user]')];
            const byUser=new Map();
            for(const node of nodes){const uid=node.dataset.reactionUser;if(!byUser.has(uid))byUser.set(uid,[]);byUser.get(uid).push(node);}
            const queue=[...byUser.keys()];
            const decorate=node=>node.querySelector('img')?.addEventListener('error',e=>e.currentTarget.remove(),{once:true});
            nodes.forEach(decorate);
            async function worker(){
                while(queue.length&&state.user?.uid===owner){
                    const uid=queue.shift();
                    try{
                        const profile=uid===owner?vvKnownReactionProfile(uid):await vvLoadReactionProfile(uid);
                        if(state.user?.uid!==owner)return;
                        for(const node of byUser.get(uid)){
                            if(!node.isConnected)continue;
                            const name=profile?.displayName||profile?.username||'Пользователь';
                            node.innerHTML=vvReactionAvatarContent(profile);node.title=name;node.setAttribute('aria-label',name);decorate(node);
                        }
                    }catch(e){console.warn('Reaction avatar unavailable:',e?.code||'network');}
                }
            }
            await Promise.all(Array.from({length:Math.min(4,queue.length)},()=>worker()));
        }
        function vvRenderChatMessage(m,scope,chatId){
            const mine=m.senderUid===state.user.uid;
            const sender=mine?state.userProfile:friendsCache.find(f=>(f.uid||f.id)===m.senderUid);
            const name=sender?.displayName||(mine?'Вы':'Участник');
            const reactions=m.reactions||{};
            let body=m.type==='sticker'?`<img src="${escapeHTML(m.text||'')}" alt="Стикер" class="max-h-36 max-w-36 rounded-xl object-contain">`:`<p class="whitespace-pre-wrap break-words">${escapeHTML(m.text||'')}</p>`;
            if(m.type==='snake-challenge')body+=`<button data-playchallenge="${escapeHTML(m.id)}" class="mt-2 rounded-lg bg-emerald-600 px-3 py-2">🎮 Играть</button>`;
            return `<div class="vv-message-row ${mine?'vv-message-mine':''}"><div class="vv-message-bubble" data-message-id="${escapeHTML(m.id)}" data-message-scope="${scope}" data-message-chat="${escapeHTML(chatId)}"><div class="vv-message-author ${Number(sender?.premiumUntil||0)>Date.now()?'vv-premium-name':''}">${escapeHTML(name)} ${roleBadgeMarkup(m.senderUid)}</div>${body}<div class="vv-message-footer"><time>${m.createdAt?new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</time><button type="button" class="vv-reaction-open" aria-label="Выбрать реакцию" title="Реакция">☺</button></div><div class="vv-reaction-counts">${vvReactionCounts(reactions).map(([e,n])=>`<button type="button" data-reaction="${e}" class="${reactions[state.user.uid]===e?'selected':''}"><span>${e}</span><span class="vv-reaction-avatars">${Object.entries(reactions).filter(([,emoji])=>emoji===e).map(([uid])=>vvReactionAvatarMarkup(uid)).join('')}</span>${n>1?`<span class="vv-reaction-total">${n}</span>`:''}</button>`).join('')}</div><div class="vv-reaction-picker" hidden>${vvReactionEmojis.map(e=>`<button type="button" data-reaction="${e}" aria-label="Реакция ${e}">${e}</button>`).join('')}</div></div></div>`;
        }
        function vvRenderMention(m){
            const expired=Number(m.expiresAt)<=Date.now();
            return `<div class="vv-chat-mention"><b>📸 Вас отметили в истории</b><p>@${escapeHTML(m.fromUsername||'user')} отметил(а) вас</p><div class="vv-mention-actions">${expired?'<span>История уже недоступна</span>':`<button data-chat-story="${escapeHTML(m.storyId)}">Посмотреть</button><button data-chat-repost="${escapeHTML(m.storyId)}">В свою историю</button>`}</div><small>${new Date(m.createdAt).toLocaleString()}</small></div>`;
        }
        function vvRenderDirectMessages(uid){
            if(activeFriend!==uid||activeGroupId)return;
            const host=document.getElementById('messagesList');if(!host)return;
            const atBottom=host.scrollHeight-host.scrollTop-host.clientHeight<96;
            const oldScroll=host.scrollTop;
            const mentions=vvChatMentions.filter(m=>m.fromUid===uid).map(m=>({...m,notice:true}));
            const items=[...vvDirectDocs,...mentions].sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0)||String(a.id).localeCompare(String(b.id)));
            host.innerHTML=items.length?items.map(m=>m.notice?vvRenderMention(m):vvRenderChatMessage(m,'conversations',activeConversationId)).join(''):'<p class="text-sm text-slate-500">Пока нет сообщений. Напиши первым 👋</p>';
            if(!activeConversationId)host.innerHTML+='<p class="vv-mention-hint">Добавьте автора в друзья, чтобы переписываться.</p>';
            vvBindMessageActions(host);
            host.scrollTop=atBottom?host.scrollHeight:oldScroll;
        }
        async function vvSetMessageReaction(node,emoji,toggle=true){
            if(!state.user||!vvReactionEmojis.includes(emoji))return;
            const scope=node.dataset.messageScope,chat=node.dataset.messageChat,id=node.dataset.messageId;
            if(!['conversations','groups'].includes(scope)||!chat||!id)return;
            const uid=state.user.uid,key=scope+'/'+chat+'/'+id;
            if(vvReactionBusy.has(key))return;vvReactionBusy.add(key);
            try{
                const ref=doc(db,scope,chat,'messages',id);
                await runTransaction(db,async tx=>{
                    const snap=await tx.get(ref);if(!snap.exists())return;
                    const reactions={...(snap.data().reactions||{})};
                    if(toggle&&reactions[uid]===emoji)delete reactions[uid];else reactions[uid]=emoji;
                    tx.update(ref,{reactions});
                });
            }catch(e){console.error('Message reaction:',e);alert('Реакция не сохранена. Опубликуй обновлённые Firestore Rules и попробуй снова.');}
            finally{vvReactionBusy.delete(key);}
        }
        function vvBindMessageActions(host){
            void vvHydrateReactionAvatars(host);
            host.querySelectorAll('[data-chat-story]').forEach(b=>b.addEventListener('click',()=>vvOpenMentionStory(b.dataset.chatStory)));
            host.querySelectorAll('[data-chat-repost]').forEach(b=>b.addEventListener('click',()=>vvRepostMention(b.dataset.chatRepost)));
            host.querySelectorAll('[data-playchallenge]').forEach(b=>b.addEventListener('click',()=>startSnake(b.dataset.playchallenge)));
            host.querySelectorAll('[data-message-id]').forEach(node=>{
                let lastTap=0,touchStart=null,lastHeart=0;
                const heart=()=>{const now=Date.now();if(now-lastHeart<600)return;lastHeart=now;vvSetMessageReaction(node,'❤️',true);};
                node.addEventListener('dblclick',e=>{if(e.target.closest('button,a,input'))return;e.preventDefault();heart();});
                node.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||e.target.closest('button,a,input'))return;touchStart={x:e.clientX,y:e.clientY,time:Date.now()};});
                node.addEventListener('pointercancel',()=>{touchStart=null;lastTap=0;});
                node.addEventListener('pointerup',e=>{
                    if(e.pointerType!=='touch'||!touchStart)return;
                    const start=touchStart;touchStart=null;const now=Date.now();
                    if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>12||now-start.time>350){lastTap=0;return;}
                    if(lastTap&&now-lastTap<320){lastTap=0;heart();}else lastTap=now;
                });
                node.querySelector('.vv-reaction-open')?.addEventListener('click',()=>{const p=node.querySelector('.vv-reaction-picker');p.hidden=!p.hidden;});
                node.querySelectorAll('[data-reaction]').forEach(b=>b.addEventListener('click',()=>{
                    // A single tap on an existing reaction never removes it.
                    // The picker can select/change an emoji, but only a double tap
                    // on the message itself toggles the heart off.
                    if(!b.closest('.vv-reaction-picker'))return;
                    node.querySelector('.vv-reaction-picker').hidden=true;
                    vvSetMessageReaction(node,b.dataset.reaction,false);
                }));
            });
        }
        document.getElementById('messageForm')?.addEventListener('submit', async e => {
            e.preventDefault();
            const messageField = document.getElementById('messageInput');
            const sendingConversation = activeConversationId, sendingGroup = activeGroupId;
            const originalValue = messageField.value;
            const clearSentInput = () => { if (activeConversationId === sendingConversation && activeGroupId === sendingGroup && messageField.value === originalValue) messageField.value = ''; };
            const text = originalValue.trim();
            if (!text || !state.user) return;
            if (activeGroupId) {
                const sendBtn = document.getElementById('sendMessageBtn'); if (sendBtn.disabled) return; sendBtn.disabled = true;
                try { const groupId=activeGroupId; const batch=writeBatch(db); batch.set(doc(collection(db,'groups',groupId,'messages')), {senderUid:state.user.uid,text:text.slice(0,1000),type:'text',createdAt:Date.now()}); batch.update(doc(db,'groups',groupId),{updatedAt:Date.now(),lastMessage:text.slice(0,100)}); await batch.commit(); clearSentInput(); } catch(err) { console.error('Group message failed',err); alert('Не удалось отправить сообщение в группу. Проверь Firestore Rules.'); } finally {sendBtn.disabled=false;} return;
            }
            if (!activeConversationId || !activeFriend) return;
            const sendBtn = document.getElementById('sendMessageBtn'); if (sendBtn.disabled) return; sendBtn.disabled = true;
            const payload = { senderUid:state.user.uid, text:text.slice(0,1000), type:'text', createdAt:Date.now(), clientMessageId: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) };
            try {
                const conversationRef = doc(db,'conversations',activeConversationId);
                const sendingFriend = activeFriend;
                const batch = writeBatch(db);
                batch.set(conversationRef, { participants:[state.user.uid,sendingFriend].sort(), updatedAt:payload.createdAt, lastMessage:text.slice(0,100) }, {merge:true});
                batch.set(doc(collection(conversationRef,'messages')), payload);
                await batch.commit();
                bumpRecentChat(sendingFriend);
                clearSentInput();
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

// Mobile viewport: reserve the actual bottom navigation height for chats.
(function vvSyncMobileNavHeight(){
  const nav=document.getElementById('bottomNav');
  if(!nav)return;
  const sync=()=>{
    const h=nav.classList.contains('hidden')?82:Math.ceil(nav.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--vv-nav-height',Math.max(60,h)+'px');
  };
  sync();
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(sync).observe(nav);
  window.addEventListener('resize',sync,{passive:true});
  window.visualViewport?.addEventListener('resize',sync,{passive:true});
})();

// Friends overlay (preserves existing Firestore listeners and actions).
document.getElementById('vvFriendsOpen')?.addEventListener('click',()=>document.getElementById('vvFriendsDrawer')?.classList.remove('hidden'));
document.getElementById('vvFriendsClose')?.addEventListener('click',()=>document.getElementById('vvFriendsDrawer')?.classList.add('hidden'));
