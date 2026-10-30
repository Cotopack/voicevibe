@echo off
setlocal
cd /d "%~dp0"
echo VoiceVibe deploy: Hosting + Firestore rules
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI is not installed. Run: npm install -g firebase-tools
  pause
  exit /b 1
)
echo.
echo This deploys to Firebase project voicevibe-1b8c0.
echo Ensure this is your project and you are signed in before continuing.
choice /M "Continue"
if errorlevel 2 exit /b 1
firebase deploy --project voicevibe-1b8c0 --only hosting,firestore:rules
if errorlevel 1 (
  echo.
  echo Deployment failed. Check firebase login, project access, and Firebase console setup.
  pause
  exit /b 1
)
echo.
echo Deployment completed. Check the URL printed above.
pause
