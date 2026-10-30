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


## Cloudinary uploads (avatars and stories)
Profile photos and story media are uploaded directly from the browser to Cloudinary. Configured Cloudinary cloud name: `yvoqyrj8`.

- Avatars use the existing unsigned preset `voicevibe_upload` and are compressed to JPEG.
- Stories use a separate unsigned preset named `voicevibe_stories` so photos, videos and audio can be accepted without changing avatar restrictions.

Before publishing stories, open Cloudinary Console → Settings → Upload → Upload presets and create `voicevibe_stories` with **Signing Mode: Unsigned**. Allow image and video uploads; audio is uploaded using Cloudinary's `video` resource type. Do not limit this preset to image-only formats. If available, set a suitable maximum file size (the app checks 12 MB for photos/audio and 25 MB for videos). The app stores Cloudinary `secure_url` links in Firestore. **Never add your Cloudinary API Secret to `app.js`.** Firebase Storage is not used for story uploads.

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
- The profile has a unique nickname, bio, and avatar upload. Avatar and story media uploads use Cloudinary; Firebase Storage is not required for these features.
- Publish `firestore.rules` in Firebase Console → Firestore Database → Rules. It covers user profiles, unique nickname reservations, friend requests/friends, the roulette queue, and private friend conversations.
- Friends can be added while matched in roulette if the match UID is available. Friend requests can be accepted or declined; declined requests may be sent again.
- The chat has text messages and an asynchronous Snake challenge: each friend can play and send their score in the conversation.
- If using GitHub Pages, upload `public/index.html`, `public/app.js`, `public/styles.css`, and `public/tailwind-config.js` to the repository's published folder (for a project site this is normally the repository root if configured that way).
- For local testing, add `localhost` to Authentication → Settings → Authorized domains and serve over localhost (not by opening the HTML file directly).
- Keep root source files and `public/` copies in sync. Confirm Cloudinary unsigned presets `voicevibe_upload` (avatars) and `voicevibe_stories` (stories) are configured.


## VoiceVibe polish update
This build includes friend presence documents in `/presence/{uid}`. Publish the updated
`firestore.rules` before testing online indicators. Presence is refreshed every 30 seconds
and marked offline when the page is hidden or closed; abrupt browser/network loss can take
up to about 90 seconds to age out. The chat conversation panel stays hidden until a friend
is selected. Snake movement is slower and a challenge result is sent once per started
challenge, not after every casual practice game.


## Google sign-in and using the same account on iPhone
- Google sign-in has been restored. Enable **Google** in Firebase Console → Authentication → Sign-in method.
- Add `cotopack.github.io` to Authentication → Settings → Authorized domains.
- On iPhone, open the exact same GitHub Pages URL in Safari and sign in with the same Google account used in Telegram's browser. Telegram and Safari keep separate browser sessions; friends appear only when both sessions authenticate as the same Firebase UID.
- If the user originally created a separate account using email/phone, sign in with that original method first. Do not create a second account and expect friend lists to merge automatically. Account linking/migration must be done explicitly.
- For iOS Safari redirect restrictions, if Google popup/redirect does not complete, configure Firebase Auth with a custom auth domain on the same site domain or use Firebase's recommended auth-domain proxy setup.

## Snake update
- Snake now uses animation-frame timing, touch swipe, gradually increasing speed, a clearer board and a one-result-per-challenge guard.


## Chat / iOS audio review hotfix

This revision changes chat initialization to validate the signed-in user's friend document,
checks an existing conversation's participant UIDs before subscribing, and displays the
actual Firestore error code when opening or reading a chat fails. It also answers incoming
PeerJS calls immediately rather than waiting for Firestore lookups, and adds an explicit
"Enable sound" button when iOS Safari blocks remote audio autoplay.

After deploying, publish the updated `firestore.rules` in Firebase Console as well as the
site files. Existing friend documents must exist under `users/{yourUid}/friends/{friendUid}`
for each account; this patch does not migrate or merge duplicate Firebase accounts.
On iPhone, tap "Enable sound" if Safari blocks autoplay. Test with two distinct accounts
while both pages are open.

JavaScript syntax was checked with Node.js. A live Firebase / iPhone WebRTC test cannot be
performed from this archive, so use the displayed error code and browser console if any
issue remains.
