import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence, RecaptchaVerifier, signInWithPhoneNumber, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, 
            collection, 
            doc, 
            setDoc, 
            getDoc,
            deleteDoc, 
            onSnapshot, query, where, orderBy, limit, getDocs, addDoc, updateDoc, serverTimestamp, runTransaction
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        
        const appId = 'voicevibe-1b8c0';

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
            confirmationResult: null,
            recaptchaVerifier: null,
            queueUnsub: null,
            connectingTo: null,
            isHandlingDisconnect: false,
            currentMatchUid: null,
            currentFriendUid: null,
            messageUnsub: null,
            socialUnsubs: [],
            presenceUnsubs: [],
            presenceCache: new Map(),
            presenceHeartbeat: null,
            friendProfiles: new Map(),
            challengeSending: false,
            snakeTimer: null,
            snakeState: null,
            snakeChallengeId: null
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

        document.getElementById('btnSendCode')?.addEventListener('click', async () => {
            const phone = document.getElementById('phoneNumber').value.trim();
            if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                showAuthMessage('Введи номер в международном формате, например +380XXXXXXXXX.'); return;
            }
            try {
                showAuthMessage('');
                if (!state.recaptchaVerifier) {
                    state.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'normal' });
                }
                const appVerifier = state.recaptchaVerifier;
                state.confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
                document.getElementById('phoneCodeArea').classList.remove('hidden');
                showAuthMessage('SMS-код отправлен. Проверь телефон.');
            } catch (err) {
                console.error('Phone sign-in failed:', err);
                showAuthMessage(authErrorMessage(err));
                try { await state.recaptchaVerifier?.render(); } catch (_) {}
            }
        });
        document.getElementById('btnVerifyCode')?.addEventListener('click', async () => {
            const code = document.getElementById('phoneCode').value.trim();
            if (!state.confirmationResult || !code) { showAuthMessage('Сначала запроси SMS-код.'); return; }
            try { await state.confirmationResult.confirm(code); }
            catch (err) { console.error('SMS verification failed:', err); showAuthMessage(authErrorMessage(err)); }
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
            document.getElementById('profilePhotoInput').value = p.photoURL || state.user?.photoURL || '';
            document.getElementById('profileEmailText').textContent = state.user?.email || state.user?.phoneNumber || 'Аккаунт VoiceVibe';
            const changedAt = Number(p.usernameChangedAt || 0);
            const remaining = Math.max(0, 14*24*60*60*1000 - (Date.now()-changedAt));
            const hint = document.getElementById('usernameChangeHint');
            if (hint) hint.textContent = remaining ? `Следующая смена @nickname через ${Math.ceil(remaining/86400000)} дн.` : 'Можно менять @nickname. Следующая смена будет доступна через 14 дней.';
            profileModal.classList.remove('hidden');
        });
        document.getElementById('btnCloseProfile')?.addEventListener('click', () => profileModal.classList.add('hidden'));
        document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
            if (!state.user) return;
            const displayName = document.getElementById('profileNameInput').value.trim().slice(0,30);
            const bio = document.getElementById('profileBioInput').value.trim().slice(0,160);
            const file = document.getElementById('profileAvatarFile')?.files?.[0];
            let photoURL = document.getElementById('profilePhotoInput').value.trim();
            const username = normalizeUsername(document.getElementById('profileUsernameInput').value.replace(/^@/,''));
            if (displayName.length < 1) { alert('Укажи отображаемое имя.'); return; }
            if (!/^[a-z0-9_]{3,24}$/.test(username)) { alert('@nickname: 3–24 символа, латинские буквы, цифры и _.'); return; }
            if (photoURL && !/^https:\/\//i.test(photoURL)) { alert('Ссылка на аватар должна начинаться с https://'); return; }
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
                await setDoc(usernameRef,{uid:state.user.uid,username,updatedAt:Date.now()});
                const updated = {displayName,username,bio,photoURL,usernameChangedAt:changing?Date.now():changedAt,updatedAt:Date.now(),createdAt:state.userProfile?.createdAt||Date.now()};
                await setDoc(doc(db,'users',state.user.uid),updated,{merge:true});
                if (oldUsername && oldUsername!==username) {
                    const oldRef=doc(db,'usernames',oldUsername), oldSnap=await getDoc(oldRef);
                    if (oldSnap.exists() && oldSnap.data().uid===state.user.uid) await deleteDoc(oldRef);
                }
                try { await updateProfile(state.user,{displayName,photoURL:photoURL||null}); } catch(e) { console.warn('Auth profile sync:',e); }
                state.userProfile=updated; document.getElementById('profileAvatarFile').value='';
                applyProfileToUI(); renderSocialProfile(); profileModal.classList.add('hidden');
            } catch(err) { console.error('Profile save failed:',err); alert(err.code==='permission-denied'?'Firestore запретил сохранение. Проверь опубликованные Rules.':'Не удалось сохранить профиль.'); }
        });

        document.getElementById('btnSignOut')?.addEventListener('click', async () => {
            if (state.isSearching || state.isConnected) pauseSearch();
            if (state.peer) { if (state.myPeerId && state.user) deleteDoc(doc(db, 'peerSessions', state.myPeerId)).catch(() => {}); state.peer.destroy(); state.peer = null; state.myPeerId = null; }
            if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
            profileModal.classList.add('hidden');
            await signOut(auth);
        });

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
                    errorAlertText.textContent = err.message || "Микрофон не найден!";
                    errorAlert.classList.remove('hidden');
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
            setPeerStatus('connecting', 'Сеть...');
            const safeAgeTag = state.selectedAge.replace('+', 'plus');
            const randomID = 'vr-' + safeAgeTag + '-' + Math.floor(100000 + Math.random() * 900000);

            state.peer = new Peer(randomID, {
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });

            state.peer.on('open', (id) => {
                state.myPeerId = id;
                if (state.user) setDoc(doc(db, 'peerSessions', id), { peerId:id, ownerUid:state.user.uid, updatedAt:Date.now() }).catch(e => console.warn('Peer session registration failed:', e));
                setPeerStatus('ready', 'Готов к поиску');
            });

            state.peer.on('call', async (call) => {
                if (state.isConnected || state.isPaused || !state.localStream) {
                    call.close();
                    return;
                }
                // Answer immediately: waiting for Firestore here can exceed mobile WebRTC timeouts.
                state.currentCall = call;
                state.connectingTo = call.peer;
                call.answer(state.localStream);
                removeFromMatchmakingQueue();
                // Resolve the account UID in parallel with media negotiation.
                try {
                    const sessionSnap = await getDoc(doc(db, 'peerSessions', call.peer));
                    if (sessionSnap.exists()) state.currentMatchUid = sessionSnap.data().ownerUid || null;
                    const qName = state.selectedAge ? `queue_${state.selectedAge.replace('+', 'plus')}` : '';
                    if (!state.currentMatchUid && qName) {
                        const qSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', qName));
                        qSnap.forEach((d) => { const item=d.data(); if (item.peerId === call.peer) state.currentMatchUid = item.ownerUid || null; });
                    }
                } catch (e) { console.warn('Could not resolve matched user UID:', e); }

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
            });

            state.peer.on('disconnected', () => setPeerStatus('error', 'Сигнализация отключена'));
            state.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                setPeerStatus('error', 'Ошибка P2P');
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
            if (!state.peer || !state.myPeerId || state.isConnected || state.isSearching) return;

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

        function normalizeUsername(value) { return value.trim().toLowerCase(); }
        function escapeHTML(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function avatarMarkup(profile, size='h-10 w-10') {
            const label = escapeHTML((profile?.displayName || profile?.username || '?').slice(0,1).toUpperCase());
            const src = profile?.photoURL;
            return src ? `<img src="${escapeHTML(src)}" alt="" loading="lazy" class="${size} rounded-full object-cover">` : `<span class="${size} flex items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 font-bold text-white">${label}</span>`;
        }
        function renderSocialProfile() {
            if (!state.user) return;
            const p = state.userProfile || {};
            document.getElementById('socialAvatar').innerHTML = avatarMarkup(p, 'h-20 w-20');
            document.getElementById('socialName').textContent = p.displayName || 'Настрой профиль';
            document.getElementById('socialHandle').textContent = p.username ? '@' + p.username : 'Выбери уникальный никнейм';
            document.getElementById('socialBio').textContent = p.bio || 'Добавь короткое описание о себе.';
        }
        function showTab(tab) {
            currentTab = tab;
            const roulette = tab === 'roulette';
            const chatsTab = tab === 'chats';
            screenAgeSelect.classList.toggle('hidden', !roulette || !!state.selectedAge);
            screenChat.classList.toggle('hidden', !roulette || !state.selectedAge);
            socialScreen.classList.toggle('hidden', roulette);
            socialProfilePanel.classList.toggle('hidden', tab !== 'profile');
            socialChatsPanel.classList.toggle('hidden', !chatsTab);
            socialSearchPanel?.classList.toggle('hidden', tab !== 'search');
            if (tab !== 'chats') { socialChatsPanel.classList.remove('chat-open'); }
            if (tab === 'search') { setTimeout(() => document.getElementById('socialSearchInput')?.focus(), 100); }
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
        document.getElementById('socialEditProfile')?.addEventListener('click', () => document.getElementById('profileBtn')?.click());

        function stopSocialListeners() {
            state.socialUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.socialUnsubs = [];
            state.presenceUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.presenceUnsubs = [];
            if (state.presenceHeartbeat) { clearInterval(state.presenceHeartbeat); state.presenceHeartbeat = null; }
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }
        }
        function startSocialListeners() {
            stopSocialListeners();
            if (!state.user) return;
            const uid = state.user.uid;
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
                renderFriends(); renderChatFriends();
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
        function renderFriendRequests() {
            const host = document.getElementById('friendRequestsList');
            document.getElementById('requestCount').textContent = String(friendRequestsCache.length);
            if (!friendRequestsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет заявок.</p>'; return; }
            host.innerHTML = friendRequestsCache.map(r => `<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-slate-950/80 p-3">${avatarMarkup(r,'h-11 w-11')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(r.displayName || 'Пользователь')} <span class="ml-1 text-xs font-normal text-violet-300">хочет добавить вас</span></p><p class="text-xs text-slate-400">@${escapeHTML(r.username || 'user')}</p></div><button data-accept="${escapeHTML(r.fromUid)}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold">Принять</button><button data-reject="${escapeHTML(r.fromUid)}" class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Отклонить</button></div>`).join('');
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
            if (header) header.innerHTML = `<div class="flex items-center gap-3"><button id="conversationBack" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800" aria-label="Назад к друзьям"><i class="fa-solid fa-arrow-left"></i></button>${avatarMarkup(f,'h-10 w-10')}<button type="button" id="conversationFriendProfile" class="min-w-0 text-left"><div class="font-semibold text-slate-100">${escapeHTML(f.displayName || 'Друг')}</div><div class="text-xs text-violet-300">@${escapeHTML(f.username || 'user')}</div>${presenceLabel(uid)}</button></div>`;
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
        function openFriendProfile(uid) {
            const f = friendsCache.find(x => String(x.uid || x.id) === String(uid)); if (!f) return;
            const name = escapeHTML(f.displayName || 'Друг'); const nick = escapeHTML(f.username || 'user');
            const photo = f.photoURL ? `<img src="${escapeHTML(f.photoURL)}" alt="Аватар ${name}" class="h-28 w-28 rounded-full object-cover">` : avatarMarkup(f,'h-28 w-28');
            let modal = document.getElementById('friendProfileModal');
            if (!modal) { modal=document.createElement('div'); modal.id='friendProfileModal'; modal.className='fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-5 backdrop-blur'; modal.innerHTML='<div class="relative w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl"><button id="friendProfileClose" class="absolute right-3 top-3 rounded-xl p-2 text-slate-400" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button><div id="friendProfileContent" class="flex flex-col items-center gap-3"></div></div>'; document.body.appendChild(modal); modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();}); modal.querySelector('#friendProfileClose').addEventListener('click',()=>modal.remove()); }
            modal.querySelector('#friendProfileContent').innerHTML = `${photo}<h2 class="text-xl font-bold">${name}</h2><p class="text-violet-300">@${nick}</p><p class="text-sm text-slate-400">${escapeHTML(f.bio || '')}</p>`;
        }
        function renderFriends() {
            const host = document.getElementById('friendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет друзей. Добавить можно во время разговора в рулетке.</p>'; return; }
            host.innerHTML = friendsCache.map(f => {
                const uid=f.uid || f.id;
                return `<div class="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">${avatarMarkup(f,'h-11 w-11')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(f.displayName || 'Друг')}</p><p class="text-xs text-slate-500">@${escapeHTML(f.username || 'user')}</p>${presenceLabel(uid)}</div><button data-chatfriend="${escapeHTML(uid)}" class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold">Написать</button></div>`;
            }).join('');
            host.querySelectorAll('[data-chatfriend]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.chatfriend)));
        }
        function renderChatFriends() {
            const host = document.getElementById('chatFriendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="p-2 text-sm text-slate-500">У тебя пока нет друзей.</p>'; return; }
            host.innerHTML = friendsCache.map(f => {
                const uid=f.uid || f.id;
                return `<button data-openchat="${escapeHTML(uid)}" class="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-800 ${activeFriend === uid ? 'bg-slate-800' : ''}">${avatarMarkup(f,'h-10 w-10')}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${escapeHTML(f.displayName || 'Друг')}</span>${presenceLabel(uid)}</span><span class="text-xs text-slate-500">›</span></button>`;
            }).join('');
            host.querySelectorAll('[data-openchat]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.openchat)));
        }
        let friendSearchTimer = null;
        let searchGeneration = 0;
        const socialSearchInput = document.getElementById('socialSearchInput');
        const socialSearchResults = document.getElementById('socialSearchResults');

        function renderSearchUsers(users, host) {
            if (!users.length) {
                host.innerHTML = '<p class="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">Пользователь с таким @nickname не найден.</p>';
                return;
            }
            host.innerHTML = users.map(u => {
                const uid = String(u.uid || u.id);
                const isFriend = friendsCache.some(f => String(f.uid || f.id) === uid);
                const pending = !!u.requestPending;
                return `<div class="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div class="shrink-0">${avatarMarkup(u,'h-12 w-12')}</div>
                    <div class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-white">${escapeHTML(u.displayName || 'Пользователь')}</span><span class="text-xs text-violet-300">@${escapeHTML(u.username || '')}</span></div>
                    ${isFriend ? '<span class="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">Друг</span>' :
                    pending ? '<span class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Заявка отправлена</span>' :
                    `<button type="button" data-addfriend="${escapeHTML(uid)}" class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">Добавить</button>`}
                </div>`;
            }).join('');
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
                    renderSearchUsers(users, socialSearchResults);
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
                            return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}"><div class="max-w-[85%] rounded-2xl ${mine ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-100'} px-3 py-2 text-sm"><p class="whitespace-pre-wrap break-words">${escapeHTML(m.text || '')}</p><p class="mt-1 text-right text-[10px] opacity-60">${m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</p></div></div>`;
                        }).join('');
                        host.querySelectorAll('[data-playchallenge]').forEach(b => b.addEventListener('click', () => startSnake(b.dataset.playchallenge)));
                        host.scrollTop = host.scrollHeight;
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
            if (!text || !state.user || !activeConversationId || !activeFriend) return;
            const sendBtn = document.getElementById('sendMessageBtn'); if (sendBtn.disabled) return; sendBtn.disabled = true;
            const payload = { senderUid:state.user.uid, text:text.slice(0,1000), type:'text', createdAt:Date.now() };
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
