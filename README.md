# hayase-russian-subs

`subtitle`-расширение для Hayase: подбирает русские ASS-субтитры из Anime365 по `AniList ID` и номеру эпизода.

## Статус MVP

Проверено 31 августа 2026 г. на публичном зеркале `https://smotret-anime.app`:

1. `GET /api/series?query=<title>` находит серии по одному из названий Hayase.
2. Результат выбирается по `AniList ID` локально: параметр `anilistId` у Anime365 ненадёжен и может вернуть стартовую страницу каталога вместо фильтра.
3. `GET /api/episodes?seriesId=<id>&episodeInt=<n>&isActive=1` возвращает нужный эпизод.
4. `GET /api/translations?episodeId=<id>&type=subRu&isActive=1` возвращает активные русские субтитры.
5. `GET /translations/ass/<id>?download=1` возвращает ASS с `Content-Type: application/octet-stream`.

Следовательно, MVP не парсит HTML и не требует собственной БД, Docker или backend. В штатном пути используются только публичные JSON endpoints и прямой URL ASS.

## Логика совпадения

Основной путь - поиск по максимум трём вариантам названия Hayase, точный локальный отбор по `AniList ID`, затем точное числовое совпадение эпизода. Это устраняет основную часть ложных совпадений при ненадёжном `anilistId` фильтре Anime365.

Если у Anime365 нет записи с AniList ID, расширение использует консервативный title fallback. Названия нормализуются (Unicode, пунктуация, диакритика и маркеры сезонов), а результат принимается только при достаточном и однозначном token-Jaccard score. При сомнении возвращается пустой результат, а не неверные субтитры.

Активные `subRu`-переводы возвращаются в порядке: известные переводчики (`SovetRomantica`, `Crunchyroll`, `AniLibria`, `AniBreeze`, `Kazoku Project`), затем server-side `priority`. Это только порядок выдачи, а не утверждение о качестве перевода.

## Сборка и тесты

Требуется Node.js 20+; внешние npm-зависимости отсутствуют.

```sh
npm run check
```

Bundle будет создан в `dist/hayase-russian-subs.js`; manifest - в `dist/manifest.json`.

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

## CORS и subtitle proxy

Ни JSON API Anime365, ни endpoint `/translations/ass/{id}` не отдают `Access-Control-Allow-Origin`. Поэтому и extension worker, и Hayase player не могут обращаться к ним напрямую. Для работы нужен CORS proxy.

В проекте есть ограниченный stateless Cloudflare Worker в [worker](worker): он принимает только URL файлов Anime365 `/translations/ass/{id}` и три нужных API-маршрута (`/series`, `/episodes`, `/translations`), не имеет БД, не принимает произвольные URL и добавляет CORS. Основной Worker развёрнут по адресу `https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle`; этот URL задан значением по умолчанию для `subtitleProxyUrl`.

```sh
cd worker
npx wrangler deploy
```

Для первого deployment потребуется войти в Cloudflare. `adapterUrl` остаётся альтернативной архитектурой для собственного source/matcher; контракт - в [docs/fallback-adapter.md](docs/fallback-adapter.md).

## Ограничения

- Результат подтверждён на уровне API и HTTP, но не прогнан внутри установленного Hayase: для этого нужен локальный экземпляр приложения.
- AniList mapping может отсутствовать, а title fallback намеренно консервативен.
- Сайт и неофициальный API могут измениться. `test()` проверяет доступность и форму ответа API, но не гарантирует наличие субтитров для каждого эпизода.
