import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, RecaptchaVerifier, signInWithPhoneNumber, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, 
            collection, 
            doc, 
            setDoc, 
            getDoc,
            deleteDoc, 
            onSnapshot 
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
            isHandlingDisconnect: false
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

        // Authentication is explicit: Google or phone number. No anonymous account is created.
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
                        createdAt: Date.now()
                    };
                    if (!profileSnap.exists()) await setDoc(doc(db, 'users', user.uid), state.userProfile);
                    applyProfileToUI();
                    document.getElementById('authOverlay')?.classList.add('hidden');
                    document.getElementById('profileBtn')?.classList.remove('hidden');
                } catch (err) {
                    console.error('Profile load failed:', err);
                    showAuthMessage('Вход выполнен, но не удалось загрузить профиль. Проверьте Rules Firestore.');
                }
            } else {
                state.userProfile = null;
                document.getElementById('authOverlay')?.classList.remove('hidden');
                document.getElementById('profileBtn')?.classList.add('hidden');
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

        const googleBtn = document.getElementById('btnGoogleLogin');
        googleBtn?.addEventListener('click', async () => {
            try {
                showAuthMessage('');
                await signInWithPopup(auth, new GoogleAuthProvider());
            } catch (err) {
                console.error('Google sign-in failed:', err);
                showAuthMessage(authErrorMessage(err));
            }
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
            const photoURL = document.getElementById('profilePhotoInput').value.trim();
            if (displayName.length < 2 || displayName.length > 30) { alert('Имя должно содержать от 2 до 30 символов.'); return; }
            if (photoURL && !/^https:\/\//i.test(photoURL)) { alert('Ссылка на аватар должна начинаться с https://'); return; }
            try {
                await updateProfile(state.user, { displayName, photoURL: photoURL || null });
                const updated = { displayName, bio, photoURL, updatedAt: Date.now(), createdAt: state.userProfile?.createdAt || Date.now() };
                await setDoc(doc(db, 'users', state.user.uid), updated, { merge: true });
                state.userProfile = updated;
                applyProfileToUI();
                profileModal.classList.add('hidden');
            } catch (err) {
                console.error('Profile save failed:', err);
                alert('Не удалось сохранить профиль. Проверь Rules Firestore и попробуй ещё раз.');
            }
        });
        document.getElementById('btnSignOut')?.addEventListener('click', async () => {
            if (state.isSearching || state.isConnected) pauseSearch();
            if (state.peer) { state.peer.destroy(); state.peer = null; state.myPeerId = null; }
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
                setPeerStatus('ready', 'Готов к поиску');
            });

            state.peer.on('call', (call) => {
                if (state.isConnected || state.isPaused || !state.localStream) {
                    call.close();
                    return;
                }

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
                        candidates.push(data.peerId);
                    });

                    candidates.sort();
                    // Only one side initiates the call. This prevents both browsers
                    // from calling each other simultaneously and creating two calls.
                    const targetPeerId = candidates.find((id) => state.myPeerId < id);
                    if (targetPeerId) connectToPeer(targetPeerId);
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

        // Listeners
        btnStartSearch.addEventListener('click', startSearch);
        btnSkip.addEventListener('click', skipPeer);
        btnPause.addEventListener('click', pauseSearch);
        btnToggleMic.addEventListener('click', toggleMicrophone);
        btnExitMenu.addEventListener('click', exitToMenu);
        btnExitMenuBottom.addEventListener('click', exitToMenu);
