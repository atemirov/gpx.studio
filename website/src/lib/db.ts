import Dexie from 'dexie';
import type { GPXFile } from 'gpx';
import { enableMapSet, enablePatches, type Patch } from 'immer';

enableMapSet();
enablePatches();

export class Database extends Dexie {
    fileids!: Dexie.Table<string, string>;
    files!: Dexie.Table<GPXFile, string>;
    patches!: Dexie.Table<{ patch: Patch[]; inversePatch: Patch[]; index: number }, number>;
    settings!: Dexie.Table<any, string>;
    overpasstiles!: Dexie.Table<
        { query: string; x: number; y: number; time: number },
        [string, number, number]
    >;
    overpassdata!: Dexie.Table<
        { query: string; id: number; poi: GeoJSON.Feature },
        [string, number]
    >;
    osmtracetiles!: Dexie.Table<{ x: number; y: number; time: number }, [number, number]>;
    osmtracedata!: Dexie.Table<{ x: number; y: number; id: string; trace: GeoJSON.Feature }, string>;

    constructor() {
        super('Database', {
            cache: 'immutable',
        });
        this.version(1).stores({
            fileids: ',&fileid',
            files: '',
            patches: ',patch',
            settings: '',
            overpasstiles: '[query+x+y],[x+y]',
            overpassdata: '[query+id]',
        });
        this.version(2).stores({
            osmtracetiles: '[x+y]',
            osmtracedata: '&id,[x+y]',
        });
    }
}

export const db = new Database();
