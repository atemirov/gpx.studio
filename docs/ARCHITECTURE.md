# Архитектура кодовой базы

Документ описывает состояние кода на 2026-07-17, после Фазы 2 (тайлы/роутинг/высоты/POI —
independence от gpx.studio). Каждое утверждение подкреплено путём к файлу (и, где уместно,
строкой/именем экспорта на момент написания — при рефакторинге номера строк могут съехать,
ищите по имени).

Не изменяет код. Не переводит документацию.

---

## 1. Карта модулей `website/src/lib/`

```
website/src/
├── lib/
│   ├── db.ts                — схема Dexie (см. §2)
│   ├── i18n.svelte.ts       — класс Locale, загрузка переводов (см. §4)
│   ├── languages.ts         — белый список языков, реально включённых в UI (12 из 33 заготовленных)
│   ├── units.ts              — конвертация единиц (метрика/империал, температура, скорость/темп)
│   ├── utils.ts              — общие утилиты: getURLForLanguage, loadSVGIcon, getElevation, isMac/isSafari
│   ├── components/
│   │   ├── Menu.svelte        — верхнее меню; здесь же глобальные шорткаты и drag&drop (см. §3)
│   │   ├── GPXStatistics.svelte, Nav.svelte, Footer.svelte, Logo.svelte, Help.svelte,
│   │   │   LanguageSelect.svelte, ModeSwitch.svelte, Resizer.svelte, Tooltip*.svelte — UI-обвязка
│   │   ├── map/                — вся логика карты MapLibre (см. §3)
│   │   │   ├── Map.svelte, map.ts (класс MapLibreGLMap), style.ts (StyleManager)
│   │   │   ├── gpx-layer/       — отрисовка треков/waypoint'ов (GPXLayer, GPXLayerCollection)
│   │   │   ├── layer-control/   — UI меню слоёв + overpass-layer.ts (POI, см. §5)
│   │   │   ├── custom-control/, street-view-control/
│   │   ├── elevation-profile/  — ElevationProfile.svelte + elevation-profile.ts (Chart.js, см. §3)
│   │   ├── file-list/          — дерево файлов (FileList.svelte, file-list.ts — модель ListItem/…)
│   │   ├── toolbar/             — панель инструментов, tools.ts (enum Tool), tools/routing/ (см. §5)
│   │   ├── export/              — экспорт файлов
│   │   ├── embedding/           — iframe-встраивание (embedding.ts, EmbeddingPlayground.svelte)
│   │   ├── collapsible-tree/    — generic-дерево со сворачиванием (использует меню слоёв)
│   │   ├── docs/                — обвязка MDX-документации (docs.ts — список гайдов)
│   │   └── ui/                  — shadcn-svelte примитивы (button, select, dialog, sonner, …)
│   ├── logic/                  — вся бизнес-логика состояния (см. §2)
│   │   ├── file-state.ts, file-action-manager.ts, file-actions.ts, selection.ts,
│   │   │   settings.ts, statistics.ts, bounds.ts, hidden.ts, map-cursor.ts
│   ├── assets/
│   │   ├── layers.ts (45 КБ)   — basemaps/overlays/terrain/POI-запросы (см. §5)
│   │   ├── colors.ts, symbols.ts, example.ts (встроенное демо), custom/*.json (кастомные стили)
│   ├── docs/                   — MDX-документация на 33 языках (be, ca, cs, …, zh-HK)
│   ├── scripts/                — pwa-manifest.ts, sitemap.ts (build-time генераторы, не рантайм)
│   └── locales/                — 33 JSON-словаря переводов (см. §4)
└── routes/
    └── [[language]]/           — optional-параметр языка в роутинге (см. §4)
        ├── app/                — сам редактор (+page.svelte — главный layout приложения)
        ├── embed/, help/       — embed-виджет и справка
```

Библиотека `gpx/` (модель GPX 1.1, парсинг, сериализация) — отдельный пакет вне `website/`,
подключается как обычная npm-зависимость (`import ... from 'gpx'`). Почти не трогаем (см. `CLAUDE.md`).

---

## 2. State: stores, undo/redo, Dexie

### Два слоя реактивности
- **Svelte 5 runes** (`$state`/`$derived`) — точечно, в `lib/i18n.svelte.ts` и в файлах с суффиксом
  `*.svelte.ts` (например `components/export/utils.svelte.ts`,
  `components/toolbar/tools/reduce/utils.svelte.ts`) плюс локальный `$state` внутри компонентов.
- **Классические Svelte-stores** (`writable`/`derived` из `svelte/store`) — основной механизм для
  бизнес-логики в `lib/logic/`. Практически везде — класс с ручной реализацией `subscribe()`
  (кастомный store-контракт), оборачивающий внутренний `Writable`.

### Undo/redo — `lib/logic/file-action-manager.ts`
Реализован через **immer-патчи, персистентные в Dexie** (не in-memory стек):
- `enableMapSet()`/`enablePatches()` — вызываются в `lib/db.ts` (строки 5-6).
- Класс `FileActionManager`:
  - `_files: Map<string, GPXFile>` — внутренний snapshot, синхронизируется через
    `GPXFileStateCollectionObserver` (строки 33-59).
  - `_patchIndex`/`_patchMinIndex`/`_patchMaxIndex` — три `Writable<number>`, обновляются через
    `liveQuery` по таблице `db.patches` (61-81).
  - `canUndo`/`canRedo` — `derived`-stores от индексов (83-94).
  - `undo()` (105-115) — `db.patches.get(patchIndex)` → `applyPatches` с `inversePatch` →
    декремент `patchIndex` в `db.settings`.
  - `redo()` (117-127) — симметрично, с `patch` вместо `inversePatch`.
  - Мутации идут через immer `produceWithPatches` в `applyGlobal()` (167-173),
    `applyToFiles()`/`applyToFile()` (175-195), `applyEachToFilesAndGlobal()` (197-219) — каждый
    вызов генерирует пару `[patch, inversePatch]`.
  - `storePatches()` (221-241) — при новом действии после undo удаляет «будущие» патчи
    (`db.patches.where(':id').above(patchIndex).delete()`), обрезает историю по
    `MAX_PATCHES = 100` (строка 16), пишет новую запись и обновляет `patchIndex` — **одной
    Dexie-транзакцией**.
  - `commitFileStateChange()` (134-165) — вычисляет изменённые/удалённые fileId
    (`getChangedFileIds()`, 245-251), обновляет `selection`, затем пишет файлы в Dexie
    (`db.fileids`/`db.files`, `bulkPut`/`bulkDelete`) — отдельной транзакцией.
  - Синглтон: `export const fileActionManager = new FileActionManager(db);` (253).
- UI-триггеры: `lib/components/Menu.svelte` — пункты меню (~206, 211) и шорткат Ctrl/Cmd+Z /
  Shift+Z (~614-620).
- Связь с `file-state.ts`: `FileActionManager` подписывается на `fileStateCollection` через
  `GPXFileStateCollectionObserver`; сам `file-state.ts` про undo/redo не знает — он просто
  зеркалит содержимое Dexie-таблицы `files` в реактивные объекты через `liveQuery`.

### `lib/logic/file-state.ts`
- `GPXFileState` — наблюдает одну запись `db.files` через `liveQuery`, при изменении создаёт
  `new GPXFile(value)`, вызывает `updateAnchorPoints()` (routing/simplify), пересчитывает
  `GPXStatisticsTree`.
- `GPXFileStateCollection` — наблюдает `db.fileids` через `liveQuery`, поддерживает
  `Map<string, GPXFileState>`. Есть режим без БД — `setEmbeddedFiles()` для embed-виджета.
- Синглтон `fileStateCollection`; `GPXFileStateCollectionObserver` — общий паттерн подписки,
  используется и в `FileActionManager`, и в `GPXLayerCollection` (карта), и в статистике.

### Dexie — `lib/db.ts`
`class Database extends Dexie` (8-35), синглтон `export const db = new Database()` (37).
Таблицы (`version(1).stores(...)`, 26-33):

| Таблица | Ключ | Назначение |
|---|---|---|
| `fileids` | `,&fileid` | множество id загруженных файлов |
| `files` | `''` (implicit PK) | сами `GPXFile` |
| `patches` | `,patch` | история immer-патчей undo/redo |
| `settings` | `''` | произвольные key-value настройки приложения |
| `overpasstiles`/`overpassdata` | составные индексы | кэш ответов Overpass API |

**Когда персистится**: не на каждое изменение стора и не debounced — **синхронно с каждым
логическим действием пользователя**, прямой транзакционной записью сразу после
`produceWithPatches` (внутри `commitFileStateChange`/`storePatches`). Настройки — аналогично,
`Setting.set()` (`lib/logic/settings.ts:~66`) пишет в `db.settings.put()` сразу при изменении
(с проверкой на идентичность значения, чтобы не писать повторно).

### `lib/logic/settings.ts`
`Setting<V>`/`SettingInitOnFirstRead<V>` — обёртки над одной записью `db.settings`, кастомный
store-контракт, синхронизация через `liveQuery`. Объект `settings` (216-348) перечисляет все
persisted настройки: единицы измерения, `elevationProfile`, слои карты (`currentBasemap`,
`currentOverlays`, `customLayers`), размеры панелей и т.д. Жизненный цикл —
`settings.connectToDatabase(db)`/`disconnectFromDatabase()` вызывается из
`routes/[[language]]/app/+page.svelte` (`onMount`/`onDestroy`).

---

## 3. Жизненный цикл GPX-файла

1. **Drag&drop** — `lib/components/Menu.svelte`, `<svelte:window on:dragover on:drop>` (~692-698):
   `if (e.dataTransfer?.files.length > 0) loadFiles(e.dataTransfer.files)`.
2. **File-input** — `lib/logic/file-actions.ts`, `triggerFileInput()` (76-88): скрытый
   `<input type="file" accept=".gpx" multiple>`, на `onchange` → `loadFiles(input.files)`.
3. **По URL** (интеграции типа Google Drive) — `routes/[[language]]/app/+page.svelte`, `onMount`
   (38-60): `page.url.searchParams.get('files'/'ids')` → `fetch(url).then(blob)` → `new File(...)`
   → `loadFiles(...)`.
4. **`loadFiles(list)`** (`file-actions.ts:90-102`) — на каждый файл `loadFile(file)`, затем
   `fileActions.addMultiple(files)` и `boundsManager.fitBoundsOnLoad(ids)` (авто-зум карты).
5. **`loadFile(file)`** (`file-actions.ts:104-125`) — `FileReader.readAsText()`, в `onload` →
   **`parseGPX(data)`** из библиотеки `gpx` (`import { parseGPX } from 'gpx'`).
6. **Парсинг** — `gpx/src/io.ts`, `export function parseGPX(gpxData: string): GPXFile` (~40):
   `fast-xml-parser` `XMLParser` с кастомными опциями (`isArray` для `trk/trkseg/trkpt/wpt/rte/
   rtept`, `tagValueProcessor` для чисел/дат/HR/cadence/power, `transformTagName` для namespace-
   префиксов типа `gpxtpx:hr`) → `parser.parse(gpxData).gpx` → `new GPXFile(parsed)`. Обратная
   операция — `buildGPX()` (114-180) с `XMLBuilder`, используется при экспорте.
7. **Модель** создаётся в `loadFile()`, дозаполняется `metadata.name` из имени файла (если не
   задано), передаётся в `fileActions.add()`/`addMultiple()` — генерирует id (`getFileIds`,
   37-46), коммитится через `fileActionManager` → в конечном счёте `db.files`/`db.fileids`.
8. **Наблюдение** — как только id появляется в `db.fileids`, `GPXFileStateCollection` создаёт
   `GPXFileState`, который через `liveQuery` тянет `GPXFile` из `db.files`.
9. **Отрисовка на карте** — `lib/components/map/gpx-layer/gpx-layers.ts`,
   `GPXLayerCollection.init()` (13-38) подписан на `fileStateCollection`; на каждый файл —
   `new GPXLayer(fileId, fileState)`. Класс `GPXLayer` (`gpx-layer.ts`, класс с ~116) в
   конструкторе подписывается на `file.subscribe(this.updateBinded)` (159); `update()` (~175)
   вызывает `_map.addSource(fileId, {type: 'geojson', data: this.getGeoJSON()})` (199-203) и
   `_map.addLayer({id: fileId, type: 'line', ...}, ANCHOR_LAYER_KEY.tracks)` (206-222) при первом
   рендере, иначе `source.setData(...)`. Waypoint'ы — отдельный источник `fileId + '-waypoints'`
   (286-291, слой `type: 'symbol'`, 293-308); опционально стрелки направления —
   `fileId + '-direction'` (245-277). Компонент-обёртка `GPXLayers.svelte` вызывает
   `gpxLayers.init()` на `map.onLoad()`.
10. **Карта MapLibre** инициализируется в `Map.svelte` (`onMount`:
    `map.init(maptilerKey, language, hash, geocoder, geolocate)`); класс —
    `lib/components/map/map.ts`, `MapLibreGLMap` (21-178), синглтон `export const map` (180);
    внутри — `new maplibregl.Map(...)` (44-58), геокодер `MaplibreGeocoder` (Nominatim, 74),
    `GeolocateControl`, `ScaleControl`. Позиция карты (`#zoom/lat/lon`) синхронизируется с
    URL-хэшем через **встроенную опцию MapLibre `hash: true`** (передаётся в `map.init()`) — это
    не кастомный код, а штатная фича библиотеки. Состояние слоёв (basemap/overlays) в хэш
    **не пишется** — оно только в Dexie через `settings.ts` (см. §2); утверждение в `CLAUDE.md`
    про «состояние слоёв в URL-hash» на момент этой ревизии не подтвердилось кодом — это
    только позиция карты.
11. **Профиль высот (Chart.js)** — `ElevationProfile.svelte`, `onMount` (~48) создаёт
    `new ElevationProfile(gpxStatistics, slicedGPXStatistics, hoveredPoint, additionalDatasets,
    elevationFill, canvas, overlay)`; два `<canvas>` (overlay + основной). Логика — класс
    `ElevationProfile` в `elevation-profile.ts` (~47): динамически импортирует и регистрирует
    `chartjs-plugin-zoom` (77-78), `initialize()` (105) создаёт `new Chart(canvas, {...})` (293) —
    тип `line`, `parsing: false`, `animation: false`. Данные — из `gpxStatistics`
    (`SelectedGPXStatistics`, `lib/logic/statistics.ts`), пересчитываются в `update()` (38-77) на
    каждое изменение `selection`/`fileOrder`/подписанных файлов.
12. **Сборка**: `routes/[[language]]/app/+page.svelte` — главный layout, монтирует `Map`,
    `GPXLayers`, `ElevationProfile`, `FileList`, `GPXStatistics`, `Menu`, `Toolbar`; в `onMount`
    вызывает `settings.connectToDatabase(db)` и `fileStateCollection.connectToDatabase(db)`,
    что запускает всю цепочку выше.

---

## 4. Меню слоёв карты

Конфигурация — `lib/assets/layers.ts` (45 КБ, самый большой файл в `assets/`):

- **`basemaps: { [key]: string | StyleSpecification }`** (33-…) — базовые слои. Значение —
  либо URL стиля (vector), либо инлайновый `StyleSpecification` (raster). После Фазы 2:
  `openFreeMap: 'https://tiles.openfreemap.org/styles/liberty'` (39) — единственный vector-слой
  «мира» по умолчанию; плюс raster: `esriSatellite`, `openStreetMap`, `openTopoMap`,
  `openHikingMap`, региональные (Франция IGN, Швейцария swisstopo и т.д., подключаются как
  кастомные JSON из `lib/assets/custom/`).
- **`defaultBasemap = 'openFreeMap'`** (939).
- **`basemapTree`/`defaultBasemapTree`: `LayerTreeType`** — иерархия для UI меню (`world` →
  конкретные слои, `countries` → региональные), плюс какие включены по умолчанию
  (`defaultBasemapTree`, галочки true/false).
- **`overlays`/`overlayTree`/`defaultOverlays`** — оверлеи (hillshade, cadastre, waymarked trails
  и т.д.) той же структуры.
- **`overpassQueryData: Record<string, OverpassQueryData>`** (~1180) — категории точек интереса
  (bakery, water, toilets, shelter, …), каждая — иконка + OSM-теги для Overpass-запроса.
  `overpassTree` — иерархия категорий для UI.
- **`terrainSources: { [key]: RasterDEMSourceSpecification }`** — источник 3D-рельефа,
  `defaultTerrainSource = 'mapterhorn'` (1497).

**Добавление нового базового слоя**: добавить запись в `basemaps`, добавить `key: true` в
`basemapTree.basemaps.world` (и, если нужно по умолчанию, в `defaultBasemapTree`), добавить
i18n-ключ `layers.basemaps.<key>` в **все** `locales/*.json` (иначе в остальных языках
отобразится сырой ключ вместо названия — см. §5, там же прецедент с `openFreeMap`).

**Применение слоёв к карте** — `lib/components/map/style.ts`, класс `StyleManager`: подписан на
`currentBasemap`/`currentOverlays`/`opacities`/`customLayers` (`settings.ts`), на каждое
изменение вызывает `updateBasemap()`/`updateOverlays()`, которые собирают итоговый MapLibre
style и применяют через `map.setStyle()`/`map.addLayer()`. `ANCHOR_LAYER_KEY` (`style.ts`) —
именованные «якорные» слои-разделители (`overlays-end`, `tracks-end`, `waypoints-end` и др.),
определяющие порядок отрисовки: оверлеи (в т.ч. GPS-треки OSM в будущей Фазе 4) должны
добавляться **перед** `ANCHOR_LAYER_KEY.tracks`, чтобы лечь под пользовательские треки, но
поверх базовой карты — см. `CLAUDE.md`, раздел «Типичные грабли».

**UI меню** — `lib/components/map/layer-control/` (LayerTree, CustomLayers и т.д.), рендерит
дерево на основе `basemapTree`/`overlayTree`/`overpassTree`, использует
`lib/components/collapsible-tree/` как generic-примитив сворачивающегося дерева.

---

## 5. Внешние API — точки интеграции

Все источники — открытый CORS, без ключа, без лимитов (цель Фазы 2 выполнена; подробности и
история находок — в `PLAN.md`, разделы «Статус» и «Инфраструктурные находки»).

| Сервис | Файл | Строка/константа | env-переопределение |
|---|---|---|---|
| Базовая карта | `lib/assets/layers.ts` | `basemaps.openFreeMap` (39), `defaultBasemap` (939) | — (фиксированный URL) |
| 3D-рельеф (визуальный) | `lib/assets/layers.ts` | `terrainSources.mapterhorn` (~1497) | — |
| Высоты точек (сэмплинг) | `lib/utils.ts` | `ELEVATION_BASE_URL` (106), `getElevation()` (108) | `PUBLIC_ELEVATION_URL` |
| Роутинг (все 8 профилей) | `lib/components/toolbar/tools/routing/routing.ts` | `BROUTER_BASE_URL` (12), `getBRouterRoute()` (~46) | `PUBLIC_ROUTING_URL` |
| Точки интереса (Overpass) | `lib/components/map/layer-control/overpass-layer.ts` | `overpassUrl` (30), `queryTile()` (200) | — (хардкод, как и раньше) |
| MapTiler (опционально) | `lib/components/map/Map.svelte` | `maptilerKey` (7-10) | `PUBLIC_MAPTILER_KEY` (только embed-виджет, см. §1 `embedding/`) |

Все текущие внешние хосты: `tiles.openfreemap.org`, `tiles.mapterhorn.com`, self-hosted BRouter
(`infra/brouter/`, наш VPS), `maps.mail.ru` (Overpass-прокси). Ни один не требует ключа.

`routingProfiles` (`routing.ts`, ~19-28) — маппинг профилей UI → BRouter-профилей
(`trekking`/`fastbike`/`gravel`/`mtb`/`hiking-mountain`/`moped`/`river`/`rail`); GraphHopper
(`graphhopper.gpx.studio`) полностью удалён из кода (не просто выключен — код `getGraphHopperRoute`
физически отсутствует, был мёртвым после перехода последнего профиля на BRouter).

---

## 6. i18n

- **Словари**: `website/src/locales/*.json` — 33 файла. `lib/languages.ts` —
  `languages: Record<string, string>`, белый список из **12** языков, реально включённых в
  UI/роутинг (ca, cs, en, es, eu, de, fr, it, nl, pt-BR, tr, zh) — **меньше**, чем количество
  файлов в `locales/`/`lib/docs/` (33) — там подготовлено больше, чем выставлено наружу.
  `ru.json` в `locales/` **есть**, но в `languages.ts` `ru` **отсутствует** — русский перевод
  подготовлен, но не включён в белый список; это прямо релевантно Фазе 3 («сделать ru языком по
  умолчанию» невозможно без правки `languages.ts`).
- **Класс `Locale`** — `lib/i18n.svelte.ts` (72 строки, Svelte 5 runes):
  - `_lang = $state('')`, `dictionary: Dictionary = $state({})`.
  - `_t = $derived((key, fallback?) => ...)` (17-30) — поиск по вложенным ключам через
    `key.split('.')`; при отсутствии — `fallback || key` (сырой ключ виден в UI, см. прецедент
    в §4). Публичный геттер `get _()`, вызывается в компонентах как `i18n._('some.key')`.
  - **`set lang(lang)`** (33-49) — при непустом значении: динамический
    `import(\`../locales/${lang}.json\`)` → `this.dictionary = module.default`. Код-сплиттинг по
    языку, не единый бандл всех 33 словарей.
  - Синглтон `export const i18n = new Locale();`.
- **Роутинг `[[language]]`**: optional-параметр — `en` доступен без префикса (`/app`), остальные
  — с префиксом (`/fr/app`). `routes/[[language]]/+page.server.ts` — `params.language ?? 'en'`,
  MDX-гайды помощи грузятся напрямую по пути `lib/docs/<lang>/<guide>.mdx` (отдельная от
  `i18n.svelte.ts` система локализации документации). `EntryGenerator`
  (`routes/[[language]]/+page.svelte`) для prerender: `lang == 'en' ? '' : lang` — `en` без
  префикса в статической генерации.
- **Связь роутинга с `Locale`**: `routes/+layout.svelte`, `$effect` (38-55) — если роут содержит
  `[[language]]` и `params.language` задан, сравнивает с `i18n.lang`; если язык есть в
  `languages` (whitelist) — `i18n.lang = lang` (триггерит загрузку JSON); если языка нет —
  `goto('/404')`. Без параметра — дефолт `i18n.lang = 'en'`.
- **SSR**: `hooks.server.js`, `handle` — независимо от клиентского кода, на сервере тоже
  `params.language ?? 'en'` и свой `import(\`./locales/${language}.json\`)` — только для
  `<title>`/meta-тегов до гидратации, тот же паттерн загрузки, но отдельный код path.
- **Переключение в UI**: `LanguageSelect.svelte` — `<Select.Root value={i18n.lang}>`, переход
  через `goto(getURLForLanguage(lang, path))` (`lib/utils.ts:230-256`).
- **Не найдено**: детект языка браузера (`navigator.language`/`Accept-Language`) — язык
  определяется исключительно по URL, никакого авто-детекта на клиенте не обнаружено в
  `i18n.svelte.ts`/`+layout.svelte`/`hooks.server.js`.

---

## Сверка с CLAUDE.md

Уточнения к разделу «Типичные грабли» в `CLAUDE.md` по итогам этой разведки:
- «Состояние карты (позиция, слои) сериализуется в URL-hash» — подтвердилась только **позиция**
  (штатный `hash: true` MapLibre). Слои сериализуются в **Dexie** (`settings.ts`), не в hash.
