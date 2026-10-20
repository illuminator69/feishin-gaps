import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './sleep-timer-panel.module.css';

import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import {
    sleepActMinutes,
    sleepRemainingMs,
    sleepTimerSetElsewhere,
} from '/@/renderer/features/hub/utils/sleep-timer';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    useHubConnected,
    useHubFeature,
    useHubMyDeviceId,
    useHubSleepTimer,
    useHubStore,
} from '/@/renderer/store/hub.store';
import {
    usePlayerShuffle,
    usePlayerStatus,
    usePlayerStoreBase,
} from '/@/renderer/store/player.store';
import { useHubSettings } from '/@/renderer/store/settings.store';
import {
    useSleepTimerActions,
    useSleepTimerActive,
    useSleepTimerMode,
    useSleepTimerRemaining,
    useSleepTimerStore,
} from '/@/renderer/store/sleep-timer.store';
import { Button } from '/@/shared/components/button/button';
import { Grid } from '/@/shared/components/grid/grid';
import { Group } from '/@/shared/components/group/group';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Paper } from '/@/shared/components/paper/paper';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

const PRESET_OPTIONS = [
    { minutes: 0, mode: 'endOfSong' as const },
    { minutes: 0, mode: 'endOfAlbum' as const },
    { minutes: 5, mode: 'timed' as const },
    { minutes: 10, mode: 'timed' as const },
    { minutes: 15, mode: 'timed' as const },
    { minutes: 30, mode: 'timed' as const },
    { minutes: 45, mode: 'timed' as const },
    { minutes: 60, mode: 'timed' as const },
    { minutes: 120, mode: 'timed' as const },
    { minutes: 180, mode: 'timed' as const },
    { minutes: 240, mode: 'timed' as const },
];

function formatRemaining(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

const useSleepTimer = () => {
    const active = useSleepTimerActive();
    const mode = useSleepTimerMode();
    const { cancelTimer, setRemaining, setTargetAlbumId } = useSleepTimerActions();
    const { mediaPause } = usePlayer();

    const mediaPauseRef = useRef(mediaPause);
    mediaPauseRef.current = mediaPause;

    // End of album mode. Set the pauseOnNextSongEnd flag whenever the current track
    // is the last one of the target album.
    const evaluateEndOfAlbum = useCallback(() => {
        const { currentSong, nextSong } = usePlayerStoreBase.getState().getPlayerData();

        if (!currentSong) {
            return;
        }

        let target = useSleepTimerStore.getState().targetAlbumId;

        if (target === null) {
            target = currentSong.albumId;
            setTargetAlbumId(target);
        }

        if (currentSong.albumId !== target) {
            usePlayerStoreBase.getState().setPauseOnNextSongEnd(false);
            cancelTimer();
            return;
        }

        const isLastOfAlbum = !nextSong || nextSong.albumId !== currentSong.albumId;
        usePlayerStoreBase.getState().setPauseOnNextSongEnd(isLastOfAlbum);
    }, [cancelTimer, setTargetAlbumId]);

    const handleOnCurrentSongChange = useCallback(() => {
        if (!active) {
            return;
        }

        // Cancel and pause on song change in end-of-song mode
        if (mode === 'endOfSong') {
            cancelTimer();
            mediaPauseRef.current();
            return;
        }

        // Cancel and pause song change in end-of-album mode
        if (mode === 'endOfAlbum') {
            evaluateEndOfAlbum();
        }
    }, [active, mode, cancelTimer, evaluateEndOfAlbum, mediaPauseRef]);

    const status = usePlayerStatus();

    useEffect(() => {
        if (!active || mode !== 'timed' || status !== PlayerStatus.PLAYING) {
            return undefined;
        }

        let lastTick = Date.now();
        const interval = window.setInterval(() => {
            const now = Date.now();
            const elapsedSeconds = Math.floor((now - lastTick) / 1000);

            if (elapsedSeconds < 1) {
                return;
            }

            lastTick += elapsedSeconds * 1000;
            const remaining = useSleepTimerStore.getState().remaining;

            if (remaining <= elapsedSeconds) {
                cancelTimer();
                mediaPauseRef.current();
            } else {
                setRemaining(remaining - elapsedSeconds);
            }
        }, 1000);

        return () => window.clearInterval(interval);
    }, [active, cancelTimer, mode, setRemaining, status]);

    usePlayerEvents(
        {
            onCurrentSongChange: handleOnCurrentSongChange,
        },
        [handleOnCurrentSongChange],
    );

    // End-of-song mode: set the pauseOnNextSongEnd flag so that
    // mediaAutoNext returns PAUSED status when the current song ends.
    // This is a generic player mechanism - the web player handles it
    // without needing to know about the sleep timer.
    // End-of-album mode: set the same flag conditionally, here we run
    // the intial evaluation in case the timer was started while already
    // on the last track of the album
    useEffect(() => {
        if (!active) {
            return;
        }

        if (mode === 'endOfSong') {
            usePlayerStoreBase.getState().setPauseOnNextSongEnd(true);

            return () => {
                usePlayerStoreBase.getState().setPauseOnNextSongEnd(false);
            };
        }

        if (mode === 'endOfAlbum') {
            evaluateEndOfAlbum();

            return () => {
                usePlayerStoreBase.getState().setPauseOnNextSongEnd(false);
            };
        }

        return undefined;
    }, [active, mode, evaluateEndOfAlbum]);
};

export const SleepTimerHookInner = () => {
    useSleepTimer();
    return null;
};

export const SleepTimerHook = () => {
    const active = useSleepTimerActive();

    if (!active) {
        return null;
    }

    return React.createElement(SleepTimerHookInner);
};

/** `welcome.features`: the hub holds the session's sleep timer (PROTOCOL, `act:sleepTimer`). */
const HUB_SLEEP_TIMER = 'sleepTimer';

/** Date.now(), read on mount and ticked every 500 ms while `ticking`. */
const useNow = (ticking: boolean) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!ticking) return undefined;
        setNow(Date.now());
        const interval = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(interval);
    }, [ticking]);
    return now;
};

/** What the timer is set to, for the More menu's row ("12:04", "End of song"), or null. */
export const useSleepTimerValue = (): null | string => {
    const { t } = useTranslation();
    const active = useSleepTimerActive();
    const mode = useSleepTimerMode();
    const remaining = useSleepTimerRemaining();
    const sessionTimer = useHubSleepTimer();
    const now = useNow(Boolean(sessionTimer));
    if (sessionTimer) {
        return formatRemaining(Math.ceil(sleepRemainingMs(sessionTimer, now) / 1000));
    }
    if (!active) return null;
    if (mode === 'endOfSong') return t('player.sleepTimer_endOfSong');
    if (mode === 'endOfAlbum') return t('player.sleepTimer_endOfAlbum');
    return formatRemaining(remaining);
};

/** The sleep timer's controls, drawn inside the player bar's More menu (F1). */
export const SleepTimerPanel = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation();
    const active = useSleepTimerActive();
    const mode = useSleepTimerMode();
    const remaining = useSleepTimerRemaining();
    const { cancelTimer, startEndOfAlbumTimer, startEndOfSongTimer, startTimedTimer } =
        useSleepTimerActions();
    // navi-connect (I-034): against a hub that holds the session's sleep timer, a TIMED timer
    // is the session's. It is set and cancelled there, runs whichever device is playing, and
    // every device's control shows it; nothing is armed in this app's own store. The two
    // modes that end at a track boundary stay with this player, as does everything when there
    // is no such hub (none configured, an older one, the link down).
    const hubEnabled = useHubSettings().enabled;
    const hubConnected = useHubConnected();
    const hubHoldsTimer = useHubFeature(HUB_SLEEP_TIMER);
    const viaHub = hubEnabled && hubConnected && hubHoldsTimer;
    const sessionTimer = useHubSleepTimer();
    const myDeviceId = useHubMyDeviceId();
    const sessionTimerSetOn = useHubStore((s) =>
        s.sleepTimer && sleepTimerSetElsewhere(s.sleepTimer, s.myDeviceId)
            ? (s.devices.find((d) => d.id === s.sleepTimer?.setBy)?.name ?? null)
            : null,
    );
    const shuffle = usePlayerShuffle();
    // Track level shuffle scatters and album across a play queue making 'end-of-album'
    // meaningless. Album shuffle keeps each album intact, so keep 'end-of-'album
    // enabled there
    const isTrackShuffle = shuffle === PlayerShuffle.TRACK;

    const [showCustom, setShowCustom] = useState(false);
    const [customHours, setCustomHours] = useState<number>(0);
    const [customMinutes, setCustomMinutes] = useState<number>(20);
    const [customSeconds, setCustomSeconds] = useState<number>(0);
    // The session's timer counts down from the end the last frame gave, on this clock: the
    // hub sends nothing while it runs. The panel is mounted only while it is on screen, so
    // `now` is read on mount and ticked while it shows.
    const now = useNow(Boolean(sessionTimer));

    const handlePreset = useCallback(
        (option: (typeof PRESET_OPTIONS)[number]) => {
            if (option.mode === 'endOfSong') {
                startEndOfSongTimer();
            } else if (option.mode === 'endOfAlbum') {
                startEndOfAlbumTimer();
            } else if (viaHub) {
                sendHubAct('sleepTimer', { minutes: option.minutes });
            } else {
                startTimedTimer(option.minutes * 60);
            }
            setShowCustom(false);
            onClose();
        },
        [onClose, startEndOfAlbumTimer, startEndOfSongTimer, startTimedTimer, viaHub],
    );

    const handleCustomStart = useCallback(() => {
        if (viaHub) {
            // The hub counts whole minutes, so the seconds field is not offered (below).
            const minutes = sleepActMinutes(customHours * 3600 + customMinutes * 60);
            if (minutes === null) return;
            sendHubAct('sleepTimer', { minutes });
            setShowCustom(false);
            onClose();
            return;
        }
        const totalSeconds = customHours * 3600 + customMinutes * 60 + customSeconds;
        if (totalSeconds > 0) {
            startTimedTimer(totalSeconds);
            setShowCustom(false);
            onClose();
        }
    }, [customHours, customMinutes, customSeconds, onClose, startTimedTimer, viaHub]);

    // Cancels everything the control shows: the session's timer, at the hub, and this app's
    // own. With the link down the session's can only be dropped here, which is also what
    // stands this device's guard on it down (use-hub).
    const handleCancel = useCallback(() => {
        if (sessionTimer) {
            if (viaHub) sendHubAct('sleepTimer', { minutes: 0 });
            else useHubStore.getState().actions.setStore({ sleepTimer: null });
        }
        if (active) cancelTimer();
        setShowCustom(false);
    }, [active, cancelTimer, sessionTimer, viaHub]);

    const getPresetLabel = (option: (typeof PRESET_OPTIONS)[number]) => {
        if (option.mode === 'endOfSong') {
            return t('player.sleepTimer_endOfSong');
        }
        if (option.mode === 'endOfAlbum') {
            return t('player.sleepTimer_endOfAlbum');
        }

        return `${option.minutes}`;
    };

    return (
        <Stack gap="sm">
            <Paper className={styles.activeStatus} p="md" radius="md">
                <Text fw={600} size="sm" ta="center">
                    {t('player.sleepTimer')}
                </Text>

                {sessionTimer && (
                    <>
                        <TextTitle c="primary" order={3}>
                            {formatRemaining(Math.ceil(sleepRemainingMs(sessionTimer, now) / 1000))}
                        </TextTitle>
                        {sleepTimerSetElsewhere(sessionTimer, myDeviceId) && (
                            <Text isMuted size="xs">
                                {sessionTimerSetOn
                                    ? t('player.sleepTimer_setOnDevice', {
                                          device: sessionTimerSetOn,
                                      })
                                    : t('player.sleepTimer_setElsewhere')}
                            </Text>
                        )}
                    </>
                )}
                {active &&
                    (mode === 'endOfSong' ? (
                        <Text c="primary" size="xl">
                            {t('player.sleepTimer_endOfSong')}
                        </Text>
                    ) : mode === 'endOfAlbum' ? (
                        <Text c="primary" size="xl">
                            {t('player.sleepTimer_endOfAlbum')}
                        </Text>
                    ) : (
                        <TextTitle c="primary" order={3}>
                            {formatRemaining(remaining)}
                        </TextTitle>
                    ))}
                {(active || sessionTimer) && (
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCancel();
                        }}
                        size="compact-xs"
                        variant="subtle"
                    >
                        {t('player.sleepTimer_cancel')}
                    </Button>
                )}
            </Paper>

            <Paper p="md" radius="md">
                <Stack gap="xs">
                    {PRESET_OPTIONS.filter(
                        (option) => option.mode === 'endOfSong' || option.mode === 'endOfAlbum',
                    ).map((option) => {
                        const disabled = option.mode === 'endOfAlbum' && isTrackShuffle;

                        return (
                            <Button
                                disabled={disabled}
                                fullWidth
                                justify="center"
                                key={option.mode}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handlePreset(option);
                                }}
                                variant="outline"
                            >
                                {getPresetLabel(option)}
                            </Button>
                        );
                    })}
                </Stack>
            </Paper>

            <Paper p="md" radius="md">
                <Grid gap="xs">
                    {PRESET_OPTIONS.filter((option) => option.mode === 'timed').map(
                        (option, index) => (
                            <Grid.Col key={index} span={4}>
                                <Button
                                    fullWidth
                                    justify="center"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handlePreset(option);
                                    }}
                                    size="md"
                                    variant="outline"
                                >
                                    {getPresetLabel(option)}
                                </Button>
                            </Grid.Col>
                        ),
                    )}
                </Grid>
            </Paper>

            <Paper p="md" radius="md">
                {!showCustom ? (
                    <Button
                        fullWidth
                        justify="center"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowCustom(true);
                        }}
                        size="xs"
                        ta="center"
                    >
                        {t('player.sleepTimer_custom')}
                    </Button>
                ) : (
                    <Stack gap="sm">
                        <Group gap={4} wrap="nowrap">
                            <NumberInput
                                max={23}
                                min={0}
                                onChange={(val) => setCustomHours(Number(val) || 0)}
                                rightSection={
                                    <Text pr="md" size="xs">
                                        hr
                                    </Text>
                                }
                                size="sm"
                                value={customHours}
                                variant="filled"
                            />
                            <Text>:</Text>
                            <NumberInput
                                max={59}
                                min={0}
                                onChange={(val) => setCustomMinutes(Number(val) || 0)}
                                rightSection={
                                    <Text pr="md" size="xs">
                                        min
                                    </Text>
                                }
                                size="sm"
                                value={customMinutes}
                                variant="filled"
                            />
                            <Text>:</Text>
                            <NumberInput
                                disabled={viaHub}
                                max={59}
                                min={0}
                                onChange={(val) => setCustomSeconds(Number(val) || 0)}
                                rightSection={
                                    <Text pr="md" size="xs">
                                        sec
                                    </Text>
                                }
                                size="sm"
                                value={customSeconds}
                                variant="filled"
                            />
                        </Group>
                        <Group gap="xs" grow>
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCustomStart();
                                }}
                                size="xs"
                                variant="filled"
                            >
                                {t('player.sleepTimer_setCustom')}
                            </Button>
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowCustom(false);
                                }}
                                size="xs"
                                variant="default"
                            >
                                {t('common.cancel')}
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Paper>
        </Stack>
    );
};
