VoiceVibe — SEO + Online, 1 ноября 2026

ЗАМЕНИТЬ на GitHub в том же каталоге, где лежит index.html:
index.html
app.html
app.js
styles.css
favicon-32.png
icon-192.png
voicevibe-preview.png

FIRESTORE RULES: файл firestore.rules — НЕ достаточно просто загрузить на GitHub.
Открой Firebase Console -> Firestore -> Rules, скопируй содержимое и нажми Publish.
Не перезаписывай Rules, если после прошлой версии ты менял их вручную: объедини изменения.

Worker.js не меняется.

Счётчик считается по активным heartbeat за последние 90 секунд; если Firebase отклоняет чтение/запись, выводится прочерк.
Он отображается в нижней навигации приложения после входа. При отсутствии входа показатель скрыт.
После публикации проверь иконку и Search Console -> Проверка URL -> Запросить индексирование.
Google может оставить название GitHub Pages documentation до повторного обхода сайта; выдача не гарантируется.
