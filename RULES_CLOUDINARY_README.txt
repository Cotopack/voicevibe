VoiceVibe — Firestore Rules + Cloudinary notes

1. Firestore Rules now block changing the profile banner URL unless the account's existing premiumUntil timestamp is still in the future.
2. Firebase Storage rules were removed from this package because this project uploads media to Cloudinary.
3. Important limitation: Firestore Rules do NOT secure Cloudinary uploads. The current client uses unsigned Cloudinary upload presets. Anyone who knows an unsigned preset may upload directly to Cloudinary. To truly enforce Premium for banner uploads, use a server-side signed upload flow (Firebase Function + Cloudinary API secret stored in Firebase Secret Manager), and keep the API secret out of app.js.
4. Deploy Firestore rules from the project root using Firebase CLI or Firebase Console. Do not publish the API secret in chat or in client code.
