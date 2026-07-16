# BRouter (self-hosted)

Self-hosted замена `brouter.de`/`graphhopper.gpx.studio` для роутинга. Источники сверены с
официальным репозиторием [abrensch/brouter](https://github.com/abrensch/brouter) (не по памяти,
см. правило 4 в `CLAUDE.md`).

## Что тут

- `docker-compose.yml` — сервис `ghcr.io/abrensch/brouter:latest` (официальный образ, MIT).
  Порт 17777 публикуется только на `127.0.0.1` — наружу отдаётся через reverse-proxy основного
  nginx сайта (`infra/deploy/nginx.conf`, `location /routing/`), там же rate-limit.
- `update-segments.sh` — скачивает/обновляет `.rd5`-сегменты рельефа для ЦФО (6 тайлов
  5×5°, ~130 МБ суммарно). Идемпотентен (`curl -z`, качает заново только при обновлении на
  сервере) — можно повесить на cron.
- `segments4/`, `customprofiles/` — создаются при первом запуске, не коммитятся (см. `.gitignore`).

## Развёртывание

```bash
cd infra/brouter
./update-segments.sh        # первая закачка сегментов ЦФО (~130 МБ)
docker compose up -d
```

## Обновление сегментов по расписанию

Сегменты на brouter.de пересобираются еженедельно. Пример cron (раз в неделю, по ночам):

```
0 3 * * 1  cd /opt/gpx-brouter && ./update-segments.sh >> update-segments.log 2>&1
```

## Проверка HTTP API

Маршрут Тверь → Торжок (профиль `trekking`, есть в штатных профилях образа):

```bash
curl "http://127.0.0.1:17777/brouter?lonlats=36.9848,56.8587|34.9581,57.0416&profile=trekking&format=geojson&alternativeidx=0"
```
Проверено 2026-07-16: возвращает валидный GeoJSON, `track-length: 191150` (м).

**Грабля:** `ghcr.io/abrensch/brouter:latest` на момент проверки не совместим по версии
`lookups.dat` с актуальными `.rd5`-сегментами на brouter.de (`lookup version mismatch (old rd5?)
lookups.dat=10 E35_N55.rd5=11`, HTTP 400 на любой запрос). Рабочий тег — `:nightly`.
Перепроверять при апдейте образа.

## Профили

Штатные профили образа (`/profiles2` внутри контейнера, из `misc/profiles2` апстрима):
`trekking`, `fastbike`, `gravel`, `mtb`, `hiking-mountain`, `car-vario`, `moped`, `shortest`,
`river`, `rail` и др. Текущий код (`website/src/lib/components/toolbar/tools/routing/routing.ts`)
уже использует `river`/`rail` через BRouter (сейчас — публичный `brouter.de`, после переключения
URL в `.env` — наш инстанс). Профили авто/вело/пешком/эндуро сейчас идут через GraphHopper
(`graphhopper.gpx.studio`) — перевод их на self-hosted BRouter это отдельная задача (адаптер API +
маппинг профилей, см. PLAN.md, задача 2.2, "frontend-агент").

"Эндуро"-профиль (задача 2.2) — кастомный `.brf` на базе `mtb.brf`/`gravel.brf` с разрешёнными
грунтовками, кладётся в `customprofiles/`, не трогая штатные профили образа.
