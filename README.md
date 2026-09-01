# hayase-russian-subs

`subtitle`-расширение для Hayase: подбирает русские субтитры из Anime365 и OpenSubtitles по `AniList ID`, названию, году и номеру эпизода.

Полный контекст для продолжения разработки и восстановления окружения: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

## Статус MVP

Проверено 31 августа 2026 г. на публичном зеркале `https://smotret-anime.app`:

1. `GET /api/series?query=<title>` находит серии по одному из названий Hayase.
2. Результат выбирается по `AniList ID` локально: параметр `anilistId` у Anime365 ненадёжен и может вернуть стартовую страницу каталога вместо фильтра.
3. `GET /api/episodes?seriesId=<id>&episodeInt=<n>&isActive=1` возвращает нужный эпизод.
4. `GET /api/translations?episodeId=<id>&type=subRu&isActive=1` возвращает активные русские субтитры.
5. `GET /translations/ass/<id>?download=1` возвращает ASS с `Content-Type: application/octet-stream`.

Следовательно, MVP не парсит HTML и не требует собственной БД, Docker или backend. В штатном пути используются только публичные JSON endpoints и прямой URL ASS.

OpenSubtitles подключён как дополнительный источник через Cloudflare Worker. API-ключ хранится только в Cloudflare Secret `OPENSUBTITLES_API_KEY` и не включается в manifest, bundle или GitHub. Расширение возвращает максимум одну OpenSubtitles-дорожку на эпизод, чтобы не расходовать дневную квоту несколькими автоматическими загрузками.

## Логика совпадения

Основной путь - поиск по максимум трём вариантам названия Hayase, точный локальный отбор по `AniList ID`, затем точное числовое совпадение эпизода. Это устраняет основную часть ложных совпадений при ненадёжном `anilistId` фильтре Anime365.

Если у Anime365 нет записи с AniList ID, расширение использует консервативный title fallback. Названия нормализуются (Unicode, пунктуация, диакритика и маркеры сезонов), а результат принимается только при достаточном и однозначном token-Jaccard score. При сомнении возвращается пустой результат, а не неверные субтитры.

Активные `subRu`-переводы возвращаются в порядке: известные переводчики (`SovetRomantica`, `Crunchyroll`, `AniLibria`, `AniBreeze`, `Kazoku Project`), затем server-side `priority`. Это только порядок выдачи, а не утверждение о качестве перевода.

OpenSubtitles ищется независимо: сначала точный сериал определяется через `/features` по максимум трём названиям и году из Anime365, затем `/subtitles` вызывается с `parent_feature_id` и номером эпизода. Если feature lookup ничего не дал, применяется консервативный text fallback. Локальный matcher повторно проверяет название и номер эпизода, предпочитает trusted и ручные переводы и отбрасывает слабые совпадения. Дорожка подписывается как `RU - OpenSubtitles - <uploader>.srt`.

## Сборка и тесты

Требуется Node.js 20+; внешние npm-зависимости отсутствуют.

```sh
npm run check
```

Build создаёт `dist/hayase-russian-subs.js`, versioned release bundle `dist/hayase-russian-subs-<version>.js` и `dist/manifest.json`. Старые versioned bundles сохраняются для уже установленных версий.

## Локальная установка в Hayase

Открытие локального файла напрямую не поддерживается. На Hayase macOS 6.4.86 / Interface 6.4.570 importer принимает только HTTPS (`--fetch-schemes=https`); `http://127.0.0.1` и `http://localhost` всегда завершаются `Invalid extension URI`, даже если manifest и CORS headers корректны.

Для установки нужен один из двух вариантов:

1. Локальный HTTPS-сервер с сертификатом, которому доверяет macOS/Chromium, например сертификатом `mkcert` для `localhost`; либо
2. Статический HTTPS-хостинг (GitHub Pages, Cloudflare Pages и т. п.).

Перед импортом в обоих случаях замените `update` и `code` в `manifest.json` на конечные HTTPS URL и выполните `npm run build`. Затем импортируйте HTTPS URL `manifest.json` в **Settings -> Extensions**.

## Установка из GitHub

Опубликованный repository manifest:

```text
https://raw.githubusercontent.com/konstantin-fokhtberger/hayase-russian-subs/main/manifest.json
```

В Hayase откройте **Settings -> Extensions**, вставьте этот URL и нажмите **Import Extensions**. Для последующих обновлений Hayase будет читать `update` из manifest.

Для каждого найденного перевода расширение возвращает отдельную дорожку: `RU - <автор>.ass` для Anime365 и `RU - OpenSubtitles - <uploader>.srt` для OpenSubtitles.

## CORS и subtitle proxy

Ни JSON API Anime365, ни endpoint `/translations/ass/{id}` не отдают `Access-Control-Allow-Origin`. Поэтому и extension worker, и Hayase player не могут обращаться к ним напрямую. Для работы нужен CORS proxy.

В проекте есть ограниченный stateless Cloudflare Worker в [worker](worker): он обслуживает разрешённые маршруты Anime365 и OpenSubtitles, не имеет БД, не принимает произвольные upstream URL и добавляет CORS. Основной Worker развёрнут по адресу `https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle` и встроен в код расширения как fallback. Настройка `subtitleProxyUrl` необязательна и нужна только для переопределения Worker.

Перед deployment OpenSubtitles API key добавляется интерактивно:

```sh
cd worker
npx wrangler secret put OPENSUBTITLES_API_KEY
npx wrangler deploy
```

Публичный endpoint `/opensubtitles/subtitle` расходует квоту владельца API key. Для персонального Worker риск ограничен дневным лимитом OpenSubtitles, но URL нельзя считать полноценной границей авторизации. При подозрении на злоупотребление следует удалить или заменить secret и временно отключить маршрут.

```sh
cd worker
npx wrangler deploy
```

Для первого deployment потребуется войти в Cloudflare. `adapterUrl` остаётся альтернативной архитектурой для собственного source/matcher; контракт - в [docs/fallback-adapter.md](docs/fallback-adapter.md).

## Ограничения

- Версия 0.2.7 прошла end-to-end проверку в Hayase на `Koukaku Kidoutai: THE GHOST IN THE SHELL` (2026), episode 2: русские ASS-дорожки загружаются и различаются по авторам.
- В версии 0.3.0 Worker прошёл live-проверку feature lookup, поиска и SRT-загрузки OpenSubtitles. Feature `3009302` точно соответствует `Koukaku Kidoutai: THE GHOST IN THE SHELL` (2026), но содержит `subtitles_count: 0`; для episode 5 OpenSubtitles ничего не добавляет, а Anime365 возвращает `DEEP` и `Katsura`.
- AniList mapping может отсутствовать, а title fallback намеренно консервативен.
- Сайт и неофициальный API могут измениться. `test()` проверяет доступность и форму ответа API, но не гарантирует наличие субтитров для каждого эпизода.
