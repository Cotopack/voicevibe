import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
            friendProfiles: new Map(),
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
                'auth/unauthorized-domain': 'Домен сайта не добавлен в Firebase Authentication → Settings → Authorized domains.',
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
            document.getElementById('profileBioInput').value = p.bio || '';
            document.getElementById('profilePhotoInput').value = p.photoURL || state.user?.photoURL || '';
            document.getElementById('profileEmailText').textContent = state.user?.email || state.user?.phoneNumber || 'Аккаунт VoiceVibe';
            profileModal.classList.remove('hidden');
        });
        document.getElementById('btnCloseProfile')?.addEventListener('click', () => profileModal.classList.add('hidden'));
        document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
            if (!state.user) return;
            const displayName = document.getElementById('profileNameInput').value.trim();
            const bio = document.getElementById('profileBioInput').value.trim().slice(0, 160);
            const file = document.getElementById('profileAvatarFile')?.files?.[0];
            let photoURL = document.getElementById('profilePhotoInput').value.trim();
            const username = normalizeUsername(displayName);
            if (displayName.length < 3 || displayName.length > 24 || !/^[a-zA-Z0-9_]+$/.test(displayName)) {
                alert('Никнейм: 3–24 символа, только латинские буквы, цифры и _.'); return;
            }
            if (photoURL && !/^https:\/\//i.test(photoURL)) { alert('Ссылка на аватар должна начинаться с https://'); return; }
            if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
                alert('Выбери JPG, PNG или WebP размером не более 5 МБ.'); return;
            }
            const oldUsername = state.userProfile?.username || '';
            try {
                const usernameRef = doc(db, 'usernames', username);
                const usernameSnap = await getDoc(usernameRef);
                if (usernameSnap.exists() && usernameSnap.data().uid !== state.user.uid) {
                    alert('Этот никнейм уже занят. Выбери другой.'); return;
                }
                if (file) {
                    const compressed = await compressAvatar(file);
                    photoURL = await uploadAvatarToCloudinary(compressed);
                }
                // The username reservation is a separate document, guarded by Firestore Rules.
                await setDoc(usernameRef, { uid: state.user.uid, username, updatedAt: Date.now() });
                const updated = { displayName, username, bio, photoURL, updatedAt: Date.now(), createdAt: state.userProfile?.createdAt || Date.now() };
                await setDoc(doc(db, 'users', state.user.uid), updated, { merge: true });
                if (oldUsername && oldUsername !== username) {
                    const oldRef = doc(db, 'usernames', oldUsername);
                    const oldSnap = await getDoc(oldRef);
                    if (oldSnap.exists() && oldSnap.data().uid === state.user.uid) await deleteDoc(oldRef);
                }
                try { await updateProfile(state.user, { displayName, photoURL: photoURL || null }); } catch (e) { console.warn('Auth profile sync skipped', e); }
                state.userProfile = updated;
                document.getElementById('profileAvatarFile').value = '';
                applyProfileToUI(); renderSocialProfile();
                profileModal.classList.add('hidden');
            } catch (err) {
                console.error('Profile save failed:', err);
                alert(err.code === 'permission-denied' ? 'Firestore запретил сохранение. Проверь опубликованные Rules.' : 'Не удалось сохранить профиль. Проверь Firestore Rules и настройки Cloudinary Upload preset.');
            }
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
                // Resolve the other account UID before removing its queue entry.
                try {
                    const sessionSnap = await getDoc(doc(db, 'peerSessions', call.peer));
                    if (sessionSnap.exists()) state.currentMatchUid = sessionSnap.data().ownerUid || null;
                    const qName = state.selectedAge ? `queue_${state.selectedAge.replace('+', 'plus')}` : '';
                    if (qName) {
                        const qSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', qName));
                        qSnap.forEach((d) => { const item=d.data(); if (item.peerId === call.peer) state.currentMatchUid = item.ownerUid || null; });
                    }
                } catch (e) { console.warn('Could not resolve matched user UID:', e); }

                state.currentCall = call;
                state.connectingTo = call.peer;
                removeFromMatchmakingQueue();
                call.answer(state.localStream);

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

            remoteAudio.srcObject = remoteStream;
            remoteAudio.play().catch(e => console.warn("Autoplay block", e));

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
            screenAgeSelect.classList.toggle('hidden', !roulette || !!state.selectedAge);
            screenChat.classList.toggle('hidden', !roulette || !state.selectedAge);
            socialScreen.classList.toggle('hidden', roulette);
            socialProfilePanel.classList.toggle('hidden', tab !== 'profile');
            socialChatsPanel.classList.toggle('hidden', tab !== 'chats');
            document.querySelectorAll('.nav-tab').forEach(b => {
                const selected = b.dataset.tab === tab;
                b.classList.toggle('text-violet-300', selected);
                b.classList.toggle('text-slate-400', !selected);
                b.classList.toggle('bg-violet-500/10', selected);
            });
            if (tab === 'profile') renderSocialProfile();
            if (tab === 'chats') renderChatFriends();
        }
        document.querySelectorAll('.nav-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
        document.getElementById('socialEditProfile')?.addEventListener('click', () => document.getElementById('profileBtn')?.click());

        function stopSocialListeners() {
            state.socialUnsubs.forEach(unsub => { try { unsub(); } catch (_) {} });
            state.socialUnsubs = [];
            if (state.messageUnsub) { state.messageUnsub(); state.messageUnsub = null; }
        }
        function startSocialListeners() {
            stopSocialListeners();
            if (!state.user) return;
            const uid = state.user.uid;
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friendRequests'), snap => {
                friendRequestsCache = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(r => r.status === 'pending');
                renderFriendRequests();
            }, err => console.warn('Friend request listener:', err)));
            state.socialUnsubs.push(onSnapshot(collection(db, 'users', uid, 'friends'), async snap => {
                friendsCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
                renderFriends(); renderChatFriends();
                for (const friend of friendsCache) {
                    if (!friend.displayName && friend.uid) {
                        try { const ps = await getDoc(doc(db,'users',friend.uid)); if (ps.exists()) { friend.displayName=ps.data().displayName; friend.photoURL=ps.data().photoURL; } } catch (_) {}
                    }
                }
                renderFriends(); renderChatFriends();
            }, err => console.warn('Friends listener:', err)));
        }
        function renderFriendRequests() {
            const host = document.getElementById('friendRequestsList');
            document.getElementById('requestCount').textContent = String(friendRequestsCache.length);
            if (!friendRequestsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет заявок.</p>'; return; }
            host.innerHTML = friendRequestsCache.map(r => `<div class="flex items-center gap-3 rounded-2xl bg-slate-950/70 p-3">${avatarMarkup(r,'h-10 w-10')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(r.displayName || 'Пользователь')}</p><p class="text-xs text-slate-500">@${escapeHTML(r.username || 'user')}</p></div><button data-accept="${escapeHTML(r.fromUid)}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold">Принять</button><button data-reject="${escapeHTML(r.fromUid)}" class="rounded-lg bg-slate-800 px-3 py-2 text-xs">Отклонить</button></div>`).join('');
            host.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => acceptFriend(b.dataset.accept)));
            host.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => rejectFriend(b.dataset.reject)));
        }
        function renderFriends() {
            const host = document.getElementById('friendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="text-sm text-slate-500">Пока нет друзей. Добавить можно во время разговора в рулетке.</p>'; return; }
            host.innerHTML = friendsCache.map(f => `<div class="flex items-center gap-3 rounded-2xl bg-slate-950/70 p-3">${avatarMarkup(f,'h-10 w-10')}<div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${escapeHTML(f.displayName || 'Друг')}</p><p class="text-xs text-slate-500">@${escapeHTML(f.username || 'user')}</p></div><button data-chatfriend="${escapeHTML(f.uid || f.id)}" class="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold">Написать</button></div>`).join('');
            host.querySelectorAll('[data-chatfriend]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.chatfriend)));
        }
        function renderChatFriends() {
            const host = document.getElementById('chatFriendsList');
            if (!friendsCache.length) { host.innerHTML = '<p class="p-2 text-sm text-slate-500">Добавь друга, чтобы начать переписку.</p>'; return; }
            host.innerHTML = friendsCache.map(f => `<button data-openchat="${escapeHTML(f.uid || f.id)}" class="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-slate-800 ${activeFriend === (f.uid || f.id) ? 'bg-slate-800' : ''}">${avatarMarkup(f,'h-9 w-9')}<span class="min-w-0 flex-1 truncate text-sm">${escapeHTML(f.displayName || 'Друг')}</span></button>`).join('');
            host.querySelectorAll('[data-openchat]').forEach(b => b.addEventListener('click', () => openConversation(b.dataset.openchat)));
        }
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
            activeFriend = friendUid;
            const pair = [state.user.uid, friendUid].sort();
            activeConversationId = pair.join('_');
            const friend = friendsCache.find(f => (f.uid || f.id) === friendUid) || {};
            document.getElementById('conversationHeader').textContent = friend.displayName || 'Чат с другом';
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendMessageBtn').disabled = false;
            document.getElementById('snakeChallengeBtn').disabled = false;
            if (state.messageUnsub) state.messageUnsub();
            const conversationRef = doc(db,'conversations',activeConversationId);
            try {
                await setDoc(conversationRef, { participants:pair, updatedAt:Date.now() }, { merge:true });
            } catch (e) { console.warn('Conversation initialization failed:', e); }
            const messagesCol = collection(db,'conversations',activeConversationId,'messages');
            state.messageUnsub = onSnapshot(query(messagesCol, orderBy('createdAt','asc'), limit(100)), snap => {
                const host = document.getElementById('messagesList');
                if (snap.empty) host.innerHTML = '<p class="text-sm text-slate-500">Начни разговор 👋</p>';
                else host.innerHTML = snap.docs.map(d => {
                    const m=d.data(); const mine=m.senderUid===state.user.uid;
                    if (m.type === 'snake-challenge') return `<div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"><b>🎮 Вызов в Змейку</b><p class="mt-1 text-xs text-slate-300">${escapeHTML(m.text || 'Сыграем?')}</p><button data-playchallenge="${escapeHTML(d.id)}" class="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold">Играть</button></div>`;
                    if (m.type === 'snake-result') return `<div class="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm">🐍 ${escapeHTML(m.text || '')}</div>`;
                    return `<div class="flex ${mine?'justify-end':'justify-start'}"><div class="max-w-[85%] rounded-2xl ${mine?'bg-violet-600 text-white':'bg-slate-800 text-slate-100'} px-3 py-2 text-sm"><p class="whitespace-pre-wrap break-words">${escapeHTML(m.text || '')}</p><p class="mt-1 text-right text-[10px] opacity-60">${m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</p></div></div>`;
                }).join('');
                host.querySelectorAll('[data-playchallenge]').forEach(b => b.addEventListener('click', () => startSnake(b.dataset.playchallenge)));
                host.scrollTop = host.scrollHeight;
            }, err => { console.warn('Chat listener:', err); document.getElementById('messagesList').innerHTML='<p class="text-sm text-rose-300">Не удалось загрузить чат. Проверь Firestore Rules.</p>'; });
            renderChatFriends();
            showTab('chats');
        }
        document.getElementById('messageForm')?.addEventListener('submit', async e => {
            e.preventDefault();
            const text = document.getElementById('messageInput').value.trim();
            if (!text || !state.user || !activeConversationId || !activeFriend) return;
            const payload = { senderUid:state.user.uid, text:text.slice(0,1000), type:'text', createdAt:Date.now() };
            try {
                const conversationRef = doc(db,'conversations',activeConversationId);
                await setDoc(conversationRef, { participants:[state.user.uid,activeFriend].sort(), updatedAt:Date.now(), lastMessage:text.slice(0,100) }, {merge:true});
                await addDoc(collection(db,'conversations',activeConversationId,'messages'), payload);
                document.getElementById('messageInput').value='';
            } catch (err) { console.error('Message send failed',err); alert('Сообщение не отправлено. Проверь Firestore Rules.'); }
        });
        document.getElementById('snakeChallengeBtn')?.addEventListener('click', () => {
            if (!activeConversationId || !activeFriend || !state.user) return;
            document.getElementById('gamesModal').classList.remove('hidden');
        });
        document.getElementById('gamesClose')?.addEventListener('click', () => document.getElementById('gamesModal').classList.add('hidden'));
        document.getElementById('gameSnakeChoice')?.addEventListener('click', async () => {
            if (!activeConversationId || !activeFriend || !state.user) return;
            try {
                await setDoc(doc(db,'conversations',activeConversationId), { participants:[state.user.uid,activeFriend].sort(), updatedAt:Date.now(), lastMessage:'🎮 Вызов в Змейку' }, {merge:true});
                await addDoc(collection(db,'conversations',activeConversationId,'messages'), { senderUid:state.user.uid, text:'Я бросаю тебе вызов! Сыграй в Змейку и побей мой результат.', type:'snake-challenge', createdAt:Date.now(), challengeId:`${Date.now()}_${state.user.uid}` });
                document.getElementById('gamesModal').classList.add('hidden');
                startSnake(null);
            } catch (err) { console.error(err); alert('Не удалось отправить вызов.'); }
        });

        const snakeCanvas = document.getElementById('snakeCanvas');
        const snakeCtx = snakeCanvas.getContext('2d');
        const gridN = 16, cell = snakeCanvas.width / gridN;
        function drawSnake() {
            const g=snakeCtx; g.clearRect(0,0,snakeCanvas.width,snakeCanvas.height); g.fillStyle='#020617'; g.fillRect(0,0,snakeCanvas.width,snakeCanvas.height);
            g.strokeStyle='rgba(148,163,184,.08)'; for(let i=0;i<=gridN;i++){g.beginPath();g.moveTo(i*cell,0);g.lineTo(i*cell,snakeCanvas.height);g.stroke();g.beginPath();g.moveTo(0,i*cell);g.lineTo(snakeCanvas.width,i*cell);g.stroke();}
            const st=state.snakeState; if(!st)return;
            g.fillStyle='#f472b6'; g.beginPath(); g.arc((st.food.x+.5)*cell,(st.food.y+.5)*cell,cell*.35,0,Math.PI*2);g.fill();
            st.body.forEach((pt,i)=>{g.fillStyle=i===0?'#c4b5fd':'#7c3aed';g.beginPath();g.roundRect(pt.x*cell+1,pt.y*cell+1,cell-2,cell-2,4);g.fill();});
        }
        function startSnake(challengeId) {
            document.getElementById('snakeModal').classList.remove('hidden');
            document.getElementById('snakeHint').textContent = challengeId ? 'Побей результат в вызове друга!' : 'Набери больше очков, чем друг!';
            document.getElementById('snakeScore').textContent='0';
            document.getElementById('snakeBest').textContent='Личный рекорд: '+(Number(localStorage.getItem('voicevibeSnakeBest')||0));
            state.snakeChallengeId=challengeId;
            resetSnake();
        }
        function resetSnake() {
            if(state.snakeTimer) clearInterval(state.snakeTimer);
            state.snakeState={body:[{x:7,y:8},{x:6,y:8},{x:5,y:8}],dir:{x:1,y:0},nextDir:{x:1,y:0},food:{x:11,y:8},score:0,over:true};
            placeFood(); drawSnake();
        }
        function placeFood(){const st=state.snakeState;let p;do{p={x:Math.floor(Math.random()*gridN),y:Math.floor(Math.random()*gridN)}}while(st.body.some(b=>b.x===p.x&&b.y===p.y));st.food=p;}
        function runSnake() {
            const st=state.snakeState;if(!st)return;
            st.over=false; if(state.snakeTimer)clearInterval(state.snakeTimer);
            state.snakeTimer=setInterval(async()=>{
                const h=st.body[0], d=st.nextDir;st.dir=d;const nh={x:h.x+d.x,y:h.y+d.y};
                if(nh.x<0||nh.y<0||nh.x>=gridN||nh.y>=gridN||st.body.some((b,i)=>i>0&&b.x===nh.x&&b.y===nh.y)){endSnake();return;}
                st.body.unshift(nh);
                if(nh.x===st.food.x&&nh.y===st.food.y){st.score+=10;placeFood();document.getElementById('snakeScore').textContent=String(st.score);}else st.body.pop();
                drawSnake();
            },125);
        }
        async function endSnake(){const st=state.snakeState;if(!st||st.over)return;st.over=true;if(state.snakeTimer)clearInterval(state.snakeTimer);state.snakeTimer=null;
            const best=Math.max(st.score,Number(localStorage.getItem('voicevibeSnakeBest')||0));localStorage.setItem('voicevibeSnakeBest',String(best));document.getElementById('snakeBest').textContent='Личный рекорд: '+best;document.getElementById('snakeStart').textContent='Играть ещё';
            if(state.user&&activeConversationId&&activeFriend){try{await addDoc(collection(db,'conversations',activeConversationId,'messages'),{senderUid:state.user.uid,text:`Мой результат в Змейке: ${st.score} очков. Сможешь побить?`,type:'snake-result',score:st.score,createdAt:Date.now()});}catch(e){console.warn('Could not post snake score',e);}}
        }
        document.getElementById('snakeStart')?.addEventListener('click',runSnake);
        document.getElementById('snakeClose')?.addEventListener('click',()=>{if(state.snakeTimer)clearInterval(state.snakeTimer);state.snakeTimer=null;document.getElementById('snakeModal').classList.add('hidden');});
        document.querySelectorAll('.snake-dir').forEach(b=>b.addEventListener('click',()=>setSnakeDirection(b.dataset.dir)));
        function setSnakeDirection(dir){const st=state.snakeState;if(!st||st.over)return;const d={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}[dir];if(d&&!(d.x===-st.dir.x&&d.y===-st.dir.y))st.nextDir=d;}
        document.addEventListener('keydown',e=>{if(document.getElementById('snakeModal').classList.contains('hidden'))return;const map={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'};if(map[e.key]){e.preventDefault();setSnakeDirection(map[e.key]);}});

        // Friend button is shown after a real roulette connection; the matched UID is taken from the queue document.
        const addFriendButton = document.createElement('button');
        addFriendButton.id='addRouletteFriend'; addFriendButton.className='hidden mt-3 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200'; addFriendButton.innerHTML='<i class="fa-solid fa-user-plus mr-2"></i>Добавить в друзья';
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
