import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { 
            getFirestore, 
            collection, 
            doc, 
            setDoc, 
            deleteDoc, 
            onSnapshot 
        } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'voice-roulette-app';
        
        let firebaseConfig = {
            apiKey: "AIzaSyDemoKeyForPublicMatchmakerOnly",
            authDomain: "voice-roulette.firebaseapp.com",
            projectId: "voice-roulette-demo",
            storageBucket: "voice-roulette.appspot.com",
            messagingSenderId: "123456789",
            appId: "1:123456789:web:abcdef"
        };

        if (typeof __firebase_config !== 'undefined' && __firebase_config) {
            try { firebaseConfig = JSON.parse(__firebase_config); } catch (e) {}
        }

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
            queueUnsub: null
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

        // Authenticate anonymously first
        signInAnonymously(auth).then((cred) => {
            state.user = cred.user;
        }).catch((err) => {
            console.warn("Auth fallback", err);
        });

        // Step 1: Selection
        document.querySelectorAll('.btn-age').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ageGroup = btn.getAttribute('data-age');
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
                if (state.isConnected || state.isPaused) {
                    call.close();
                    return;
                }

                removeFromMatchmakingQueue();
                state.currentCall = call;
                call.answer(state.localStream);

                call.on('stream', (remoteStream) => {
                    handleConnectedStream(remoteStream);
                });

                call.on('close', handleDisconnect);
                call.on('error', handleDisconnect);
            });

            state.peer.on('disconnected', () => setPeerStatus('error', 'Отключено'));
            state.peer.on('error', (err) => setPeerStatus('error', 'Ошибка P2P'));
        }

        function setPeerStatus(type, text) {
            peerStatusText.textContent = text;
            if (type === 'ready') peerStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
            else if (type === 'connecting') peerStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
            else peerStatusDot.className = 'w-2 h-2 rounded-full bg-red-500';
        }

        // --- Realtime Firebase Matchmaker ---
        async function startSearch() {
            if (!state.peer || !state.myPeerId || state.isConnected) return;

            state.isSearching = true;
            state.isPaused = false;
            updateUI();

            setAvatarState('searching');
            chatStatusTitle.textContent = "Поиск собеседника...";
            chatStatusDesc.textContent = `Ищем свободных пользователей в группе ${state.selectedAge}`;

            const queueColPath = collection(db, 'artifacts', appId, 'public', 'data', `queue_${state.selectedAge.replace('+', 'plus')}`);

            // 1. Add current user to real-time queue
            const myQueueDoc = doc(queueColPath, state.myPeerId);
            await setDoc(myQueueDoc, {
                peerId: state.myPeerId,
                timestamp: Date.now()
            });

            // 2. Listen to active queue snapshot
            if (state.queueUnsub) state.queueUnsub();

            state.queueUnsub = onSnapshot(queueColPath, (snapshot) => {
                if (!state.isSearching || state.isConnected) return;

                const candidates = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data.peerId !== state.myPeerId) {
                        candidates.push(data.peerId);
                    }
                });

                // Match with first waiting stranger
                if (candidates.length > 0) {
                    const targetPeerId = candidates[0];
                    connectToPeer(targetPeerId);
                }
            }, (err) => {
                console.warn("Snapshot notice:", err);
            });
        }

        function connectToPeer(targetPeerId) {
            const call = state.peer.call(targetPeerId, state.localStream);
            if (!call) return;

            let connected = false;
            call.on('stream', (remoteStream) => {
                connected = true;
                removeFromMatchmakingQueue();
                state.currentCall = call;
                handleConnectedStream(remoteStream);
            });

            setTimeout(() => {
                if (!connected && state.isSearching) {
                    call.close();
                }
            }, 3500);
        }

        async function removeFromMatchmakingQueue() {
            state.isSearching = false;
            if (state.queueUnsub) {
                state.queueUnsub();
                state.queueUnsub = null;
            }
            if (state.myPeerId && state.selectedAge) {
                try {
                    const myQueueDoc = doc(db, 'artifacts', appId, 'public', 'data', `queue_${state.selectedAge.replace('+', 'plus')}`, state.myPeerId);
                    await deleteDoc(myQueueDoc);
                } catch (e) {}
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
            if (state.currentCall) {
                state.currentCall.close();
                state.currentCall = null;
            }
            remoteAudio.srcObject = null;
            state.isConnected = false;

            if (!state.isPaused && !state.isSearching) {
                setAvatarState('idle');
                chatStatusTitle.textContent = "Разговор завершён";
                chatStatusDesc.textContent = "Собеседник вышел. Нажмите 'Искать' для следующего.";
            }
            updateUI();
        }

        // Actions
        function skipPeer() {
            removeFromMatchmakingQueue();
            handleDisconnect();
            startSearch();
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
