import { parseGPX } from 'gpx';
import { PUBLIC_OSM_API_URL } from '$env/static/public';

// OSM API 0.6 /trackpoints — формат подтверждён сверкой с документацией (не по памяти,
// см. CLAUDE.md правило 4): https://wiki.openstreetmap.org/wiki/API_v0.6#GPS_Trackpoints:_GET_/api/0.6/trackpoints
// Ответ — GPX 1.0 XML (не JSON), максимум 5000 точек на страницу, bbox ≤ 0.25 кв. градуса.
const OSM_API_BASE = PUBLIC_OSM_API_URL || 'https://api.openstreetmap.org';
const MAX_POINTS_PER_PAGE = 5000;
const MAX_BACKOFF_MS = 60_000;

function countTrackpoints(gpxText: string): number {
    // Дешёвая оценка без полного парсинга — считаем открывающие теги <trkpt
    return (gpxText.match(/<trkpt\b/g) ?? []).length;
}

async function fetchPage(
    bbox: [number, number, number, number],
    page: number,
    signal?: AbortSignal
): Promise<{ text: string; ok: true } | { ok: false; retryable: boolean }> {
    const url = `${OSM_API_BASE}/api/0.6/trackpoints?bbox=${bbox.join(',')}&page=${page}`;
    let response: Response;
    try {
        response = await fetch(url, { signal });
    } catch {
        return { ok: false, retryable: true };
    }

    if (response.status === 509 || response.status === 429) {
        // Bandwidth/rate limit exceeded — экспоненциальный backoff на стороне вызывающего кода.
        return { ok: false, retryable: true };
    }
    if (!response.ok) {
        // 400 (bbox слишком большой) и прочие ошибки — не повторяем, это не транзиентная проблема.
        return { ok: false, retryable: false };
    }

    return { text: await response.text(), ok: true };
}

/**
 * Загружает все GPS-треки OSM для bbox (≤ 0.25° по каждой стороне — обеспечивается
 * тайловой сеткой в osm-traces-layer.ts), с пагинацией до исчерпания и экспоненциальным
 * backoff при 429/509. Возвращает GeoJSON-фичи (LineString на трек-сегмент), полученные
 * через существующий GPXFile.toGeoJSON() — тот же конвертер, что и для пользовательских файлов.
 */
export async function fetchTrackpoints(
    bbox: [number, number, number, number],
    signal?: AbortSignal
): Promise<GeoJSON.Feature[]> {
    const features: GeoJSON.Feature[] = [];
    let page = 0;
    let backoff = 1000;

    while (true) {
        const result = await fetchPage(bbox, page, signal);

        if (!result.ok) {
            if (!result.retryable || backoff > MAX_BACKOFF_MS) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            backoff *= 2;
            continue; // повторяем ту же страницу
        }

        backoff = 1000;
        const pointCount = countTrackpoints(result.text);
        if (pointCount === 0) {
            break;
        }

        try {
            const gpxFile = parseGPX(result.text);
            features.push(...gpxFile.toGeoJSON().features);
        } catch {
            // Повреждённый/неожиданный ответ — пропускаем страницу, не роняем весь запрос.
        }

        if (pointCount < MAX_POINTS_PER_PAGE) {
            break; // последняя страница
        }
        page++;
    }

    return features;
}
