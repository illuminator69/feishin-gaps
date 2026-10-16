import type { StationCharacterId } from '/@/shared/types/station-types';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { signalStation } from '/@/renderer/features/player/station/station-client';
import {
    characterLabel,
    charactersOf,
    effectiveOrigin,
    StationBinding,
} from '/@/renderer/features/player/station/station-logic';
import {
    useStationBinding,
    useStationCatalog,
    useStationInFlight,
    useStationMode,
    useStationStore,
} from '/@/renderer/features/player/station/station-store';
import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store/settings.store';

/**
 * Everything a surface says about autoplay and the station (I-040), in one place so the popover,
 * Settings and the queue chip cannot come to disagree. Every sentence is built from what the hub
 * answered (the station's name, character, engine, exhaustion) or from the catalogue it served;
 * the bundled copy of that catalogue stands in only when the hub has given none.
 */
export const useStationWords = () => {
    const { t } = useTranslation();
    const mode = useStationMode();
    const bound = useStationBinding();
    const catalog = useStationCatalog();
    const inFlight = useStationInFlight();
    const lastPartial = useStationStore((s) => s.lastPartial);
    const autoplay = useSettingsStore((s) => s.autoDJ.enabled);
    const preferred = useSettingsStore((s) => s.station?.character ?? 'balanced');
    const { setSettings } = useSettingsStoreActions();

    const characters = useMemo(() => charactersOf(catalog), [catalog]);
    /** The character in effect: the bound station's own, else the one a new station starts with. */
    const character: StationCharacterId = bound?.character ?? preferred;

    const labelOf = useCallback((id: StationCharacterId) => characterLabel(catalog, id), [catalog]);

    const stationName = useCallback(
        (b: StationBinding): string => {
            if (b.name) return b.name;
            if (b.seed?.kind === 'yourMix') return t('naviConnect.station.yourMix');
            if (b.seed?.name) return t('naviConnect.station.radioOf', { name: b.seed.name });
            return t('naviConnect.station.radio');
        },
        [t],
    );

    const setAutoplay = useCallback(
        (enabled: boolean) => setSettings({ autoDJ: { enabled } }),
        [setSettings],
    );

    /**
     * Persist the character; a bound station is steered to it from its next batch. The control
     * moves at once. "Nothing left that fits" is lifted only once the hub has taken the change
     * (it clears exhaustion when a signal moves `rev`), so the next request is asked of the new
     * character, not raced against it.
     */
    const setCharacter = useCallback(
        (value: StationCharacterId) => {
            setSettings({ station: { character: value } });
            const current = useStationStore.getState().bound;
            if (!current || current.character === value) return;
            useStationStore.getState().actions.adopt({ ...current, character: value });
            void signalStation('character', { value }).then((answer) => {
                const now = useStationStore.getState().bound;
                if (!answer?.applied || now?.stationId !== current.stationId) return;
                useStationStore.getState().actions.adopt({
                    ...now,
                    character: value,
                    exhausted: false,
                    rev: Math.max(now.rev, answer.rev),
                });
            });
        },
        [setSettings],
    );

    /** One line naming what is playing, or null when nothing is. */
    const line = useMemo((): null | string => {
        if (mode !== 'stations' || !bound) return null;
        const parts = [stationName(bound), labelOf(bound.character)];
        if (bound.engine === 'tier1') parts.push(t('naviConnect.station.viaNavidrome'));
        return parts.join(' · ');
    }, [bound, labelOf, mode, stationName, t]);

    /**
     * What happens next, for the line under it. With Autoplay Off a radio still keeps going, and
     * any other queue (an album, or a continuation autoplay started) stops at its end.
     */
    const status = useMemo((): null | string => {
        if (mode !== 'stations') return null;
        const radio = bound !== null && effectiveOrigin(bound) === 'radio';
        if (!autoplay && !radio) return t('naviConnect.station.offStops');
        if (bound?.exhausted) return t('naviConnect.station.exhausted');
        if (inFlight) return t('naviConnect.station.finding');
        if (lastPartial) return t('naviConnect.station.partial');
        if (!autoplay) return t('naviConnect.station.offRadioContinues');
        if (!bound) return t('naviConnect.station.continues');
        return null;
    }, [autoplay, bound, inFlight, lastPartial, mode, t]);

    return {
        autoplay,
        bound,
        /** Offer "Explore" on an exhausted station that is not exploring already. */
        canExplore: Boolean(bound?.exhausted) && bound?.character !== 'explore',
        catalog,
        character,
        characterLabel: labelOf,
        characters,
        inFlight,
        line,
        mode,
        setAutoplay,
        setCharacter,
        stationName,
        status,
    };
};
