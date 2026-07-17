# BRouter (self-hosted)

Self-hosted замена `brouter.de`/`graphhopper.gpx.studio` для роутинга. Источники сверены с
официальным репозиторием [abrensch/brouter](https://github.com/abrensch/brouter) (не по памяти,
см. правило 4 в `CLAUDE.md`). Все 8 профилей роутинга приложения (bike/racing_bike/gravel_bike/
mountain_bike/foot/motorcycle/water/railway) идут через этот инстанс — GraphHopper из кода
полностью убран (см. `PLAN.md`, Задача 2.2).

## Что тут

- `docker-compose.yml` — сервис `ghcr.io/abrensch/brouter:nightly` (официальный образ, MIT).
  Порт 17777 публикуется только на `127.0.0.1` — наружу отдаётся через reverse-proxy основного
  nginx сайта (`infra/deploy/nginx.conf`, `location /routing/`), там же rate-limit.
- `update-segments.sh` — скачивает/обновляет `.rd5`-сегменты рельефа для ЦФО (6 тайлов
  5×5°, ~130 МБ суммарно). Идемпотентен (`curl -z`, качает заново только при обновлении на
  сервере) — можно повесить на cron.
- `setup-profiles.sh` — извлекает штатные профили из образа + докачивает наши кастомные в
  `profiles2/` (см. граблю 2 ниже — обязательно один каталог, `CUSTOMPROFILESPATH` не работает).
  Перезапускать при обновлении версии образа BRouter.
- `segments4/`, `profiles2/` — создаются скриптами, не коммитятся (см. `.gitignore`) — в первом
  случае просто большие файлы, во втором — чужие файлы образа со своими лицензиями, коммитить
  их в наш репозиторий не нужно и не хочется.

## Развёртывание

```bash
cd infra/brouter
./update-segments.sh        # первая закачка сегментов ЦФО (~130 МБ)
./setup-profiles.sh         # штатные профили образа + кастомные (см. "Профили" ниже)
docker compose up -d
```

Оба скрипта воспроизводимы — перезапускать при обновлении образа BRouter или добавлении нового
кастомного профиля (в `setup-profiles.sh`).

## Обновление сегментов по расписанию

Сегменты на brouter.de пересобираются еженедельно. Пример cron (раз в неделю, по ночам):

```
0 3 * * 1  cd /opt/gpx-editor/infra/brouter && ./update-segments.sh >> update-segments.log 2>&1
```

## Проверка HTTP API

Маршрут Тверь → Торжок (профиль `trekking`, есть в штатных профилях образа):

```bash
curl "http://127.0.0.1:17777/brouter?lonlats=36.9848,56.8587|34.9581,57.0416&profile=trekking&format=geojson&alternativeidx=0"
```
Проверено 2026-07-16: возвращает валидный GeoJSON, `track-length: 191150` (м).

**Грабля 1:** `ghcr.io/abrensch/brouter:latest` на момент проверки не совместим по версии
`lookups.dat` с актуальными `.rd5`-сегментами на brouter.de (`lookup version mismatch (old rd5?)
lookups.dat=10 E35_N55.rd5=11`, HTTP 400 на любой запрос). Рабочий тег — `:nightly`.
Перепроверять при апдейте образа.

**Грабля 2 (важно, стоила нескольких часов разбора 2026-07-17):** `CUSTOMPROFILESPATH`
(том `/customprofiles`, переменная окружения образа) **в этой сборке не работает вообще** —
`ServerHandler`/`RouteServer` игнорирует его при резолвинге `profile=<имя>`, независимо от того,
используется ли префикс `custom_` (константа `ProfileUploadHandler.CUSTOM_PREFIX` в исходниках
apstream) или передаётся полный абсолютный путь. Запрос с любым из этих вариантов даёт HTTP 500
`java.lang.IllegalArgumentException: profile <имя>.brf does not exist`, даже когда файл реально
лежит в `/customprofiles` с правильными правами (проверено через `docker exec ... ls`).
**Рабочее решение**: кастомные профили класть прямо в `/profiles2` (переопределённый volume —
копия штатных профилей образа + наши добавленные), не в `/customprofiles`. Подтверждено вживую:
`profile=gravel-m11n` через переопределённый `/profiles2` вернул корректный маршрут.
Не разбирались, баг ли это конкретно в сборке `:nightly` на момент проверки, недоделанная фича,
или расхождение между `master`-веткой на GitHub (там код с `custom_`-префиксом есть) и тем, что
реально скомпилировано в образ — не тратили время дальше, раз рабочее решение найдено.

## Профили

Штатные профили образа (`/profiles2`, из `misc/profiles2` апстрима): `trekking`, `fastbike`,
`gravel`, `mtb`, `hiking-mountain`, `car-vario`, `moped`, `shortest`, `river`, `rail`, `all`,
`skating`, `softaccess`, `dummy` и др.

Кастомные профили (добавлены 2026-07-17, лежат в `profiles2/` вместе со штатными — см. граблю 2
выше, **не** в `customprofiles/`):
- `gravel-m11n.brf` — с [bikerouter.de](https://bikerouter.de/profiles/m11n-gravel-pre.brf),
  автор Ess Bee, на базе `fastbike-lowtraffic`, приоритет gravel/fine-gravel поверхностей
  (tracktype=grade2), избегает мелких треков.
- `ffm-long-distance.brf` — с
  [github.com/FFMbyBicycle/brouter-cycling-profiles](https://github.com/FFMbyBicycle/brouter-cycling-profiles)
  (GPLv3), велопрофиль для дальних дистанций: избегает машин/поворотов/светофоров/плохих
  покрытий по умолчанию.

Оба скачаны, положены в `profiles2/`, проверены через прямой HTTP-запрос к BRouter — **не
подключены** в UI приложения (нет ключа в `website/src/lib/components/toolbar/tools/routing/
routing.ts` → `routingProfiles`, нет пункта в меню роутинга) — это отдельный шаг, не сделан.

«Эндуро»-профиль (задача 2.2, изначально планировался) — по факту не написан отдельно;
`gravel-m11n`/`mtb`/`gravel` уже покрывают похожий сценарий (грунтовки), можно переиспользовать
один из них под ярлыком «эндуро» в UI вместо написания нового `.brf` с нуля.
