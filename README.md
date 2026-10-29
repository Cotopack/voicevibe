# Voice Roulette — Firebase Hosting project

## Project files
- `index.html`, `styles.css`, `app.js`, `tailwind-config.js` — editable source files.
- `public/` — the exact static files Firebase Hosting publishes. Copy any changes to the matching files in `public/` before deploying.
- `firebase.json` — Firebase Hosting configuration.
- `.firebaserc.example` — example only; Firebase CLI creates the real `.firebaserc` when you select your project.

## 1. Configure Firebase app
1. In Firebase Console, register a Web app (`</>`) if you haven't already.
2. In `app.js` AND `public/app.js`, replace the demo `firebaseConfig` values with the config shown for your Firebase Web app.
3. Enable **Authentication → Sign-in method → Email/Password** and **Phone**. Add your live site domain under **Authentication → Settings → Authorized domains**. Phone sign-in requires the reCAPTCHA verifier and may require billing/SMS quota depending on your Firebase plan and region.
4. Create **Cloud Firestore** and configure secure Firestore rules before going public. Do not use open test rules for a public app.

## 2. Install Firebase CLI (Windows)
Install Node.js LTS from https://nodejs.org/ and restart VS Code/Terminal.
Then run:

```powershell
npm install -g firebase-tools
firebase login
```

## 3. Link this folder to your Firebase project
Open this project folder in VS Code. Open Terminal → New Terminal and run:

```powershell
firebase use --add
```

Choose your Firebase project and set the alias to `default`.

## 4. Deploy Hosting
From this folder (the folder containing `firebase.json`), run:

```powershell
firebase deploy --only hosting
```

When deployment finishes, the CLI prints the live URL, normally `https://YOUR_PROJECT_ID.web.app` (also `https://YOUR_PROJECT_ID.firebaseapp.com`). Firebase Hosting serves the site over HTTPS, which is needed for browser microphone access.

## Updating the app
Edit the source files in the project root, copy the updated `index.html`, `app.js`, `styles.css`, and `tailwind-config.js` into `public/`, then run `firebase deploy --only hosting` again.

## Important limitations
- Hosting publishes the static front end; it does not itself configure Firestore, Authentication, or the PeerJS signaling service.
- The demo Firebase config in the app must be replaced. Firebase config is intended to identify the client project, but Firestore Security Rules and Authentication must still be configured safely.
- PeerJS currently uses a public signaling service. For a reliable public launch, consider a managed/self-hosted signaling setup, TURN servers, abuse prevention, reporting/blocking, and moderation.
- Age selection is self-reported and does not verify a user's age. Do not present the app as a verified age-restricted service without appropriate controls.


## Firebase configuration
The project is configured for Firebase project `voicevibe-1b8c0`. Before deploying, confirm that **Email/Password** and **Phone** providers are enabled and that Cloud Firestore security rules permit only the intended authenticated operations. Anonymous sign-in is not used by this build. Do not deploy open test-mode Firestore rules to production.


## Matchmaking troubleshooting update
- The matchmaking code now waits for Firebase anonymous authentication, records the authenticated owner UID, ignores stale queue entries, and makes only one peer initiate a call to prevent simultaneous duplicate calls.
- `firestore.rules` contains rules for this queue path. Review them and publish them in Firebase Console → Firestore Database → Rules. These rules allow authenticated users to read queue IDs because that is required for matching; do not store personal data in queue documents.
- If using GitHub Pages, update the root `app.js`. If using Firebase Hosting, update `public/app.js` and run `firebase deploy --only hosting`. Keep both copies in sync.
- The app currently uses STUN servers but no TURN relay. Some mobile/Wi-Fi networks cannot establish direct WebRTC audio with STUN alone; for reliable public use, configure a reputable TURN service and add its credentials to the PeerJS `iceServers` list.


## Sign-in, social profile, friends, chat, and Snake
- Login methods in this build: email/password and phone/SMS. Enable Email/Password and Phone in Firebase Authentication → Sign-in method.
- The profile has a unique nickname, bio, and avatar upload. Avatar uploads use Firebase Storage; create/enable the default Storage bucket and publish `storage.rules` in Firebase Console → Storage → Rules.
- Publish `firestore.rules` in Firebase Console → Firestore Database → Rules. It covers user profiles, unique nickname reservations, friend requests/friends, the roulette queue, and private friend conversations.
- Friends can be added while matched in roulette if the match UID is available. Friend requests can be accepted or declined; declined requests may be sent again.
- The chat has text messages and an asynchronous Snake challenge: each friend can play and send their score in the conversation.
- If using GitHub Pages, upload `public/index.html`, `public/app.js`, `public/styles.css`, and `public/tailwind-config.js` to the repository's published folder (for a project site this is normally the repository root if configured that way).
- For local testing, add `localhost` to Authentication → Settings → Authorized domains and serve over localhost (not by opening the HTML file directly).
- Keep root source files and `public/` copies in sync. Firebase Storage must be enabled for gallery avatar uploads.
