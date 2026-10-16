import type {
    StationAnswer,
    StationCatalog,
    StationNextBody,
    StationResult,
    StationSignalAnswer,
    StationSignalBody,
    StationStartBody,
} from '/@/shared/types/station-types';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the hub's station routes (PROTOCOL §18). The main process makes
 * the HTTP calls with the hub's base and bearer; these only carry bodies and results.
 */

const characters = (): Promise<StationResult<StationCatalog>> =>
    ipcRenderer.invoke('station-characters');

const start = (body: StationStartBody): Promise<StationResult<StationAnswer>> =>
    ipcRenderer.invoke('station-start', body);

const next = (body: StationNextBody): Promise<StationResult<StationAnswer>> =>
    ipcRenderer.invoke('station-next', body);

const signal = (body: StationSignalBody): Promise<StationResult<StationSignalAnswer>> =>
    ipcRenderer.invoke('station-signal', body);

export const station = {
    characters,
    next,
    signal,
    start,
};
