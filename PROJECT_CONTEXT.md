# Project Context - hayase-russian-subs

Последнее обновление: 2026-08-31

## 1. Текущее состояние

- Проект: subtitle extension для Hayase, автоматически находящий русские ASS-субтитры Anime365 по AniList ID, названию и номеру эпизода.
- Рабочая версия: `0.2.7`.
- Release commit: `fe466f7c15f9cf0806fc7b3efe427806aecc8d84`.
- GitHub: `https://github.com/konstantin-fokhtberger/hayase-russian-subs`.
- Ветка: `main`.
- Локальный репозиторий: `/Users/konstantinfokhtberger/Hayase project/outputs/hayase-russian-subs`.
- Пользователь подтвердил успешную end-to-end работу версии 0.2.7 в Hayase: русские дорожки появились и различаются по авторам.
- Проверенный сценарий: AniList `177699`, `Koukaku Kidoutai: THE GHOST IN THE SHELL` (2026), episode 2.
- Автоматические тесты: 8 тестов parser/matcher/ranking/proxy/filename, все проходят командой `npm run check`.

Immutable manifest версии 0.2.7:

```text
https://raw.githubusercontent.com/konstantin-fokhtberger/hayase-russian-subs/fe466f7c15f9cf0806fc7b3efe427806aecc8d84/manifest.json
```

## 2. Архитектура

```text
Hayase player
  -> hayase-russian-subs extension
  -> Cloudflare Worker /api
  -> Anime365 JSON API: /series, /episodes, /translations
  -> Cloudflare Worker /subtitle
  -> Anime365 /translations/ass/{id}?download=1
  -> ASS track in Hayase
```

Компоненты:

- `src/extension.js` - matcher, Anime365 API flow, ranking, создание URL и имен дорожек.
- `manifest.json` - Hayase manifest.
- `scripts/build.mjs` - standalone build без внешних npm dependencies.
- `dist/` - стабильный bundle, versioned bundles и собранный manifest.
- `worker/src/index.js` - stateless CORS proxy.
- `worker/wrangler.toml` - конфигурация Cloudflare Worker.
- `test/extension.test.js` - unit tests.
- `docs/fallback-adapter.md` - необязательный внешний adapter contract.

Собственный backend, БД, Docker и постоянное хранилище не используются.

## 3. Публичный Worker

- Worker name: `hayase-russian-subs-proxy`.
- Base URL: `https://hayase-russian-subs-proxy.arecvien.workers.dev`.
- ASS endpoint: `https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle`.
- API endpoint: `https://hayase-russian-subs-proxy.arecvien.workers.dev/api`.
- Worker URL встроен в код расширения как fallback. Сохраненное значение `subtitleProxyUrl` не требуется.

Worker намеренно ограничен:

- `/api` допускает только `/series`, `/episodes`, `/translations`;
- `/subtitle` допускает только HTTPS URL Anime365 вида `/translations/ass/<numeric-id>`;
- произвольный forward proxy отсутствует;
- методы кроме `GET` и CORS `OPTIONS` не поддерживаются;
- ответы содержат `Access-Control-Allow-Origin: *`.

Секреты, OAuth-токены и Cloudflare credentials в репозитории отсутствуют. Wrangler использует локальную авторизованную сессию пользователя.

Развертывание Worker:

```sh
cd '/Users/konstantinfokhtberger/Hayase project/outputs/hayase-russian-subs/worker'
npx wrangler whoami
npx wrangler deploy
```

Минимальная проверка:

```sh
curl -i -X OPTIONS 'https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle'
curl -i 'https://hayase-russian-subs-proxy.arecvien.workers.dev/api?path=%2Fseries&query=THE%20GHOST%20IN%20THE%20SHELL&limit=10'
```

Ожидается `204` для OPTIONS и `200` JSON для API, оба ответа с `Access-Control-Allow-Origin: *`.

## 4. Anime365 mapping и проверенные данные

Для Ghost in the Shell 2026, episode 2 подтверждено:

- AniList ID: `177699`;
- Anime365 series ID: `36662`;
- Anime365 episode ID: `382087`;
- translation IDs: `5859785`, `5864298`, `5864299`;
- авторы: `DEEP`, `DEEP [Без цензуры]`, `Katsura`.

Алгоритм:

1. Искать `/series` максимум по трем вариантам названия Hayase.
2. Предпочитать точное совпадение `anilistId` в найденных объектах.
3. Если mapping отсутствует, применять консервативный title matcher.
4. Получить активный episode с точным `episodeInt`.
5. Получить активные `type=subRu` translations.
6. Отсортировать известные команды по `PREFERRED_AUTHORS`, затем по Anime365 `priority`.
7. Вернуть максимум `maxResults` дорожек, по умолчанию 5.
8. Имя каждой дорожки: `RU - <authorsSummary>.ass`.

HTML scraping не используется. Anime365 API неофициальный и может измениться.

## 5. Критичные особенности Hayase

Эти пункты были подтверждены фактическими сбоями и исходным кодом Hayase:

1. Importer принимает только HTTPS. `file://`, `http://localhost` и `http://127.0.0.1` приводят к `Invalid extension URI`.
2. Hayase может кэшировать extension code по пути и фактически игнорировать query cache-buster. Каждый релиз должен публиковать новый физический файл `dist/hayase-russian-subs-<version>.js`.
3. `raw.githubusercontent.com/.../main/manifest.json` тоже может временно возвращать старый manifest. Для ручной установки надежнее immutable URL по commit SHA.
4. Значения `default` в manifest options отображаются как placeholder, но могут не передаваться в `single()`. Поэтому публичный Worker URL обязательно должен оставаться встроенным fallback в `src/extension.js`.
5. Hayase использует поле результата `language` как имя загружаемого файла и отбрасывает файл без поддерживаемого расширения. Значение обязано заканчиваться на `.ass`.
6. API Hayase не имеет отдельного поля display label. Для различения переводов имя файла формируется как `RU - <автор>.ass`.
7. После переустановки расширения желательно полностью перезапустить Hayase, чтобы исключить уже созданный экземпляр старого source class.

Не возвращать старую ошибку `Configure subtitleProxyUrl in the extension settings`: отсутствие option теперь является штатным сценарием и должно использовать встроенный Worker.

## 6. Сборка и тесты

Требуется Node.js 20+. Внешних npm dependencies нет.

```sh
cd '/Users/konstantinfokhtberger/Hayase project/outputs/hayase-russian-subs'
npm run check
```

`npm run check` выполняет build и tests. Build создает:

- `dist/hayase-russian-subs.js` - stable development bundle;
- `dist/hayase-russian-subs-<version>.js` - release bundle с уникальным путем;
- `dist/manifest.json`.

Build не удаляет старые versioned bundles: они нужны уже установленным manifest.

## 7. Release checklist

1. Изменить `version` в `package.json` и `manifest.json`.
2. Изменить `manifest.json -> code` на новый физический путь `dist/hayase-russian-subs-<version>.js` без query-параметра.
3. Выполнить `npm run check`.
4. Убедиться, что новый versioned bundle создан и старые versioned bundles не удалены.
5. Выполнить `git diff --check` и проверить `git status`.
6. Закоммитить source, tests, manifest, stable bundle, versioned bundle и `dist/manifest.json`.
7. Выполнить `git push origin main`.
8. Проверить опубликованный immutable manifest по полному commit SHA.
9. Проверить, что URL `code` из manifest возвращает новый bundle и содержит ожидаемые изменения.
10. В Hayase удалить только предыдущую версию `hayase-russian-subs`, импортировать immutable manifest и перезапустить приложение.
11. Не изменять другие extensions и repositories Hayase.

Пример проверок после push:

```sh
git rev-parse HEAD
curl -fsSL "https://raw.githubusercontent.com/konstantin-fokhtberger/hayase-russian-subs/<commit-sha>/manifest.json"
curl -fsSL "https://raw.githubusercontent.com/konstantin-fokhtberger/hayase-russian-subs/main/dist/hayase-russian-subs-<version>.js"
```

## 8. Диагностика

### Ошибка про обязательный `subtitleProxyUrl`

Hayase исполняет старый bundle. В текущем коде такой ошибки нет. Проверить versioned `code` URL в установленном manifest и устанавливать manifest по immutable commit URL.

### Русские дорожки не появляются без ошибки

Проверить по порядку:

1. Worker `/api` и `/subtitle`.
2. Ответы Anime365 для series -> episode -> translations.
3. Наличие `.ass` в значении `language` каждого результата.
4. AniList ID и title variants, переданные Hayase.
5. Полный перезапуск Hayase после обновления.

### Появилось несколько русских дорожек

Это штатно: Anime365 может иметь несколько переводов. Они возвращаются в ranking order и подписываются по `authorsSummary`. Число ограничивается option `maxResults`.

## 9. Ограничения и риски

- Anime365 API неофициальный; изменение схемы или маршрутов потребует адаптации.
- AniList mapping может отсутствовать; title fallback намеренно предпочитает пустой результат ложному совпадению.
- Публичный Worker является общей эксплуатационной зависимостью. При его отключении потребуется redeploy или `subtitleProxyUrl` override.
- Ranking команд - эвристика порядка, а не объективная оценка качества перевода.
- Hayase API связывает имя файла и поле `language`, поэтому отдельные display label и ISO language code задать невозможно без изменения Hayase.

## 10. Правило восстановления контекста

При продолжении работы сначала прочитать этот файл, затем проверить:

```sh
git status --short
git log -5 --oneline
npm run check
```

После этого проверять live GitHub/Worker, потому что публикация, кэш и внешнее Anime365 API являются изменяемым состоянием.

