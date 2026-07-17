import { SphericalMercator } from '@mapbox/sphericalmercator';
import { get, writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import { settings } from '$lib/logic/settings';
import { db } from '$lib/db';
import type { GeoJSONSource } from 'maplibre-gl';
import { ANCHOR_LAYER_KEY } from '$lib/components/map/style';
import { fetchTrackpoints } from './api';

const { osmTracesEnabled, osmTracesReference, osmTracesColor, osmTracesWidth, osmTracesOpacity } =
    settings;

const mercator = new SphericalMercator({ size: 256 });

let data = writable<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });

liveQuery(() => db.osmtracedata.toArray()).subscribe((traces) => {
    data.set({ type: 'FeatureCollection', features: traces.map((t) => t.trace) });
});

const SOURCE_ID = 'osm-traces';
const LAYER_ID = 'osm-traces';
const DEBOUNCE_MS = 500;
// Тайлы на зуме 13 ~0.044° по стороне — надёжно укладывается в лимит bbox ≤ 0.25° кв. OSM API.
const QUERY_ZOOM = 13;
const MIN_ZOOM = 13;
const EXPIRATION_TIME = 7 * 24 * 3600 * 1000;

export class OSMTracesLayer {
    map: maplibregl.Map;
    unsubscribes: (() => void)[] = [];
    currentTiles: Set<string> = new Set();
    abortControllers: Map<string, AbortController> = new Map();
    debounceTimer: ReturnType<typeof setTimeout> | undefined;

    queryIfNeededBinded = this.queryIfNeeded.bind(this);
    updateBinded = this.update.bind(this);

    constructor(map: maplibregl.Map) {
        this.map = map;
    }

    add() {
        this.map.on('moveend', this.debouncedQueryIfNeeded);
        this.map.on('style.load', this.updateBinded);
        this.unsubscribes.push(data.subscribe(this.updateBinded));
        this.unsubscribes.push(
            osmTracesEnabled.subscribe(() => {
                this.updateBinded();
                this.queryIfNeededBinded();
            })
        );
        this.unsubscribes.push(
            osmTracesColor.subscribe(() => this.updatePaint()),
            osmTracesWidth.subscribe(() => this.updatePaint()),
            osmTracesOpacity.subscribe(() => this.updatePaint())
        );

        this.update();
    }

    remove() {
        this.map.off('moveend', this.debouncedQueryIfNeeded);
        this.map.off('style.load', this.updateBinded);
        this.unsubscribes.forEach((unsubscribe) => unsubscribe());
        this.unsubscribes = [];
        clearTimeout(this.debounceTimer);
        this.abortControllers.forEach((controller) => controller.abort());
        this.abortControllers.clear();

        try {
            if (this.map.getLayer(LAYER_ID)) {
                this.map.removeLayer(LAYER_ID);
            }
            if (this.map.getSource(SOURCE_ID)) {
                this.map.removeSource(SOURCE_ID);
            }
        } catch {
            // Карта могла быть уже уничтожена
        }
    }

    debouncedQueryIfNeeded = () => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(this.queryIfNeededBinded, DEBOUNCE_MS);
    };

    update() {
        if (!get(osmTracesEnabled)) {
            try {
                if (this.map.getLayer(LAYER_ID)) {
                    this.map.removeLayer(LAYER_ID);
                }
            } catch {
                // no-op
            }
            return;
        }

        try {
            const source = this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
            if (source) {
                source.setData(get(data));
            } else {
                this.map.addSource(SOURCE_ID, {
                    type: 'geojson',
                    data: get(data),
                });
            }

            if (!this.map.getLayer(LAYER_ID)) {
                this.map.addLayer(
                    {
                        id: LAYER_ID,
                        type: 'line',
                        source: SOURCE_ID,
                        layout: {
                            'line-cap': 'round',
                            'line-join': 'round',
                        },
                        paint: {
                            'line-color': get(osmTracesColor),
                            'line-width': get(osmTracesWidth),
                            'line-opacity': get(osmTracesOpacity),
                        },
                    },
                    ANCHOR_LAYER_KEY.overlays
                );
            }
        } catch {
            // Карта ещё не готова принимать источники/слои
        }
    }

    updatePaint() {
        try {
            if (this.map.getLayer(LAYER_ID)) {
                this.map.setPaintProperty(LAYER_ID, 'line-color', get(osmTracesColor));
                this.map.setPaintProperty(LAYER_ID, 'line-width', get(osmTracesWidth));
                this.map.setPaintProperty(LAYER_ID, 'line-opacity', get(osmTracesOpacity));
            }
        } catch {
            // no-op
        }
    }

    queryIfNeeded() {
        if (!get(osmTracesEnabled) || get(osmTracesReference)) {
            // "Использовать как референс" — фиксирует текущие треки, новые не подгружаем.
            return;
        }
        if (this.map.getZoom() < MIN_ZOOM) {
            return;
        }
        const bounds = this.map.getBounds()?.toArray();
        if (!bounds) return;

        const tileLimits = mercator.xyz(
            [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
            QUERY_ZOOM
        );
        const time = Date.now();

        for (let x = tileLimits.minX; x <= tileLimits.maxX; x++) {
            for (let y = tileLimits.minY; y <= tileLimits.maxY; y++) {
                const key = `${x},${y}`;
                if (this.currentTiles.has(key)) continue;

                db.osmtracetiles
                    .where('[x+y]')
                    .equals([x, y])
                    .first()
                    .then((tile) => {
                        if (!tile || time - tile.time >= EXPIRATION_TIME) {
                            this.queryTile(x, y);
                        }
                    });
            }
        }
    }

    queryTile(x: number, y: number) {
        if (this.currentTiles.size > 5) {
            return; // не более 5 параллельных запросов одновременно
        }
        const key = `${x},${y}`;
        this.currentTiles.add(key);

        const bbox = mercator.bbox(x, y, QUERY_ZOOM);
        const controller = new AbortController();
        this.abortControllers.set(key, controller);

        fetchTrackpoints(bbox, controller.signal)
            .then((features) => this.storeTraces(x, y, features))
            .catch(() => {
                // AbortError или сетевая ошибка — тайл просто останется неопрошенным,
                // повторная попытка произойдёт при следующем queryIfNeeded().
            })
            .finally(() => {
                this.currentTiles.delete(key);
                this.abortControllers.delete(key);
            });
    }

    storeTraces(x: number, y: number, features: GeoJSON.Feature[]) {
        const time = Date.now();
        const traces = features.map((trace, index) => ({
            x,
            y,
            id: `${x}-${y}-${index}`,
            trace,
        }));

        db.transaction('rw', db.osmtracetiles, db.osmtracedata, async () => {
            await db.osmtracetiles.put({ x, y, time });
            // Прежний набор фич этого тайла мог отличаться по длине — чистим перед перезаписью.
            await db.osmtracedata.where('[x+y]').equals([x, y]).delete();
            await db.osmtracedata.bulkPut(traces);
        });
    }
}
