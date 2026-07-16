# Деплой

## Что генерирует `npm run build`

`website/` собирается через `@sveltejs/adapter-static` (см. `website/svelte.config.js`) в
полностью статический сайт — без Node.js-сервера на проде. Команда:

```bash
cd gpx && npm install && npm run build   # библиотеку — первой
cd ../website && npm install && npm run build
```

Результат — директория `website/build/` (не коммитится, см. `website/.gitignore`), внутри:

- `*.html` — по одной пререндеренной странице на каждую локаль (`de.html`, `ru.html`, `fr.html`, …) плюс `app.html`, `404.html`, `embed/`, `help/`;
- `_app/` — статические JS/CSS-бандлы (`_app/immutable/…`) и `_app/env.js` — сюда попадают значения всех `PUBLIC_*` переменных из `website/.env` на момент сборки (см. ниже);
- `*.manifest.webmanifest` — по одному на локаль (PWA-манифесты);
- `robots.txt`, `sitemap.xml` — генерируется postbuild-скриптом `src/lib/scripts/sitemap.ts`;
- иконки (`apple-touch-icon.png` и т.п.).

Постбилд-шаг `npm run postbuild` (`npx tsx src/lib/scripts/sitemap.ts`) запускается автоматически после `build` — отдельно вызывать не нужно.

Т.к. `prerender.crawl: true`, все достижимые по ссылкам страницы уже пререндерены в HTML — сервер отдаёт статику как есть, SSR в runtime не требуется.

### PUBLIC_-переменные окружения запекаются в сборку

SvelteKit инлайнит все `PUBLIC_*` переменные из `.env` в клиентский бандл (`_app/env.js`) на этапе сборки — это ожидаемое поведение для публичных значений (ключ MapTiler и так виден в сетевых запросах браузера). Секреты (не начинающиеся на `PUBLIC_`) сюда не попадают. Если ключ/URL меняется — нужен пересбор, runtime-подмена не сработает.

### base path

`svelte.config.js`: `paths.base = process.env.BASE_PATH` в production-сборке (в dev — пустая строка). Если сайт раздаётся не с корня домена, а из под-пути — выставить `BASE_PATH` перед `npm run build`.

## Как раздавать nginx'ом

Пример минимального серверного блока (детали — при настройке `infra/deploy/`):

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    root /var/www/gpx-editor/build;
    index app.html;

    # gzip/brotli — статика текстовая (html/js/css/svg/json/xml), сжимать обязательно
    gzip on;
    gzip_types text/html application/javascript text/css application/json image/svg+xml application/xml;

    # иммутабельные бандлы — кэш навсегда, у файлов в имени хэш
    location /_app/immutable/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # HTML и манифесты — не кэшировать долго, чтобы обновления сайта доезжали быстро
    location ~ \.(html|webmanifest)$ {
        add_header Cache-Control "public, max-age=0, must-revalidate";
    }

    # локализованные пути (/ru/, /de/, ...) — сматченный adapter-static кладёт
    # <locale>.html в корень, а не <locale>/index.html, поэтому нужен try_files
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    error_page 404 /404.html;

    # реверс на BRouter и другие self-hosted сервисы — добавляется в Фазе 2/5
    # location /routing/ { proxy_pass http://127.0.0.1:PORT/; }
}
```

Обновление на проде = замена содержимого `build/` (rsync) + `nginx -s reload` при необходимости (при статике обычно не требуется). План CI/CD — Фаза 5.

## Версия Node.js

Зафиксирована в `.nvmrc` (корень репозитория). Использовать `nvm use` перед `npm install`.
