# Настройка Cloudinary для VoiceVibe

Firebase Storage в этом проекте не используется. Все пользовательские медиафайлы отправляются напрямую в Cloudinary, а в Firestore сохраняются только URL.

## 1. Cloudinary cloud name

В `app.js` уже указан cloud name: `yvoqyrj8`.

Если ваш Cloudinary аккаунт другой, замените значение `CLOUDINARY_CLOUD_NAME` в `app.js` и синхронно в `public/app.js`.

## 2. Upload presets

В Cloudinary Console откройте **Settings → Upload → Upload presets** и создайте один preset:

| Preset | Signing mode | Для чего |
|---|---|---|
| `voicevibe_upload` | Unsigned | Аватары, баннеры, стикеры, обои чатов, фото/видео/аудио историй |

В `voicevibe_upload` разрешите изображения и видео; для аудио также должен быть разрешён video resource type. Если preset ограничен только изображениями, видео и аудио историй загружаться не будут.

## 3. Важная безопасность

- Не добавляйте Cloudinary API Secret в `app.js`, HTML или публичный репозиторий.
- Используется unsigned upload preset, поэтому настройте ограничения форматов и размера непосредственно в Cloudinary.
- Для более строгой защиты от злоупотреблений переведите загрузки на серверную подпись через Firebase Cloud Functions.
- Firebase Console → Storage настраивать не нужно.
- Публикуйте Firestore Rules из файла `firestore.rules`.

## 4. После настройки

Проверьте загрузку под двумя тестовыми аккаунтами: аватар, историю с фото, историю с видео, баннер Premium, стикер Premium и обои Premium. Убедитесь, что ссылки `https://res.cloudinary.com/...` появляются в соответствующих документах Firestore.
