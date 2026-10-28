import { RefObject, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './center-controls.module.css';

import {
    useRemoteAwarePlayerSong,
    useRemoteAwareRepeat,
    useRemoteAwareShuffle,
    useRemoteAwareStatus,
} from '/@/renderer/features/hub/hooks/use-remote-aware';
import { MainPlayButton, PlayerButton } from '/@/renderer/features/player/components/player-button';
import { PlayerbarSlider } from '/@/renderer/features/player/components/playerbar-slider';
import { transportSpan } from '/@/renderer/features/player/components/seek-row';
import { openShuffleAllModal } from '/@/renderer/features/player/components/shuffle-all-modal';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    useIsPlayingRadio,
    useIsRadioActive,
    useRadioControls,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import { useButtonSize, useSkipButtons } from '/@/renderer/store';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

/**
 * The seek row under the transport is as wide as its buttons, outer edge to outer edge (R6, B-211):
 * the width lands in `--transport-width` on the wrapper, which the row reads. Measured when a button
 * or the button row changes size and when the set of buttons changes, never on a plain render.
 */
const useTransportWidth = (ref: RefObject<HTMLDivElement | null>, buttonsKey: string) => {
    useLayoutEffect(() => {
        const root = ref.current;
        const row = root?.querySelector(`.${styles.buttonsContainer}`);
        if (!root || !row) return undefined;
        const buttons = [...row.querySelectorAll('button')];
        const measure = () => {
            const span = transportSpan(buttons.map((button) => button.getBoundingClientRect()));
            if (span === null) root.style.removeProperty('--transport-width');
            else root.style.setProperty('--transport-width', `${span}px`);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        for (const button of buttons) observer.observe(button);
        return () => observer.disconnect();
    }, [ref, buttonsKey]);
};

export const CenterControls = () => {
    const skip = useSkipButtons();
    const transportRef = useRef<HTMLDivElement | null>(null);
    useTransportWidth(transportRef, skip?.enabled ? 'skip' : 'plain');

    const isRadioActive = useIsRadioActive();

    // Play sits in the middle column of its own grid, so it stays centred on the bar whatever
    // stands either side of it (Stop moved to More; Shuffle all stays, on the right).
    if (isRadioActive) {
        return (
            <div className={styles.controlsContainer}>
                <div className={styles.buttonsContainer}>
                    <div className={styles.side}>
                        <RadioStopButton />
                        <ShuffleButton disabled={isRadioActive} />
                        <PreviousButton disabled={isRadioActive} />
                        {skip?.enabled && <SkipBackwardButton disabled={isRadioActive} />}
                    </div>
                    <RadioCenterPlayButton />
                    <div className={styles.side}>
                        {skip?.enabled && <SkipForwardButton disabled={isRadioActive} />}
                        <NextButton disabled={isRadioActive} />
                        <RepeatButton disabled={isRadioActive} />
                        <ShuffleAllButton disabled={isRadioActive} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.transport} ref={transportRef}>
            <div className={styles.controlsContainer}>
                <div className={styles.buttonsContainer}>
                    <div className={styles.side}>
                        <ShuffleButton />
                        <PreviousButton />
                        {skip?.enabled && <SkipBackwardButton />}
                    </div>
                    <CenterPlayButton />
                    <div className={styles.side}>
                        {skip?.enabled && <SkipForwardButton />}
                        <NextButton />
                        <RepeatButton />
                        <ShuffleAllButton />
                    </div>
                </div>
            </div>
            <PlayerbarSlider />
        </div>
    );
};

const RadioCenterPlayButton = ({ disabled }: { disabled?: boolean }) => {
    const { currentStreamUrl } = useRadioPlayer();
    const isPlayingRadio = useIsPlayingRadio();
    const { pause, play } = useRadioControls();

    const handleClick = () => {
        if (isPlayingRadio) {
            pause();
        } else if (currentStreamUrl) {
            play();
        }
    };

    return <MainPlayButton disabled={disabled} isPaused={!isPlayingRadio} onClick={handleClick} />;
};

const RadioStopButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const { stop } = useRadioControls();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaStop" size={buttonSize - 2} />}
            onClick={stop}
            tooltip={{
                label: t('player.stop'),
                openDelay: 0,
            }}
            variant="tertiary"
        />
    );
};

const ShuffleButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const shuffle = useRemoteAwareShuffle();
    const { toggleShuffle } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={
                <Icon
                    color={shuffle === PlayerShuffle.NONE ? 'default' : 'primary'}
                    icon="mediaShuffle"
                    size={buttonSize}
                />
            }
            isActive={shuffle !== PlayerShuffle.NONE}
            onClick={toggleShuffle}
            tooltip={{
                label:
                    shuffle === PlayerShuffle.NONE
                        ? t('player.shuffle', {
                              context: 'off',
                          })
                        : t('player.shuffle'),
                openDelay: 0,
            }}
            variant="tertiary"
        />
    );
};

const PreviousButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const { mediaPrevious } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaPrevious" size={buttonSize} />}
            onClick={(e) => mediaPrevious(e.altKey)}
            tooltip={{
                label: (
                    <Stack gap="xs" justify="center">
                        <Text fw={500} ta="center">
                            {t('player.previous')}
                        </Text>
                        <Text fw={500} isMuted size="xs" ta="center">
                            {t('player.previousAlbum')}
                        </Text>
                    </Stack>
                ),
                openDelay: 0,
            }}
            variant="secondary"
        />
    );
};

const SkipBackwardButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const { mediaSkipBackward } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaStepBackward" size={buttonSize} />}
            onClick={mediaSkipBackward}
            tooltip={{
                label: t('player.skip', {
                    context: 'back',
                }),
                openDelay: 0,
            }}
            variant="secondary"
        />
    );
};

const CenterPlayButton = ({ disabled }: { disabled?: boolean }) => {
    const currentSongId = useRemoteAwarePlayerSong()?.id;

    const status = useRemoteAwareStatus();
    const { mediaTogglePlayPause } = usePlayer();

    return (
        <MainPlayButton
            disabled={disabled || currentSongId === undefined}
            isPaused={status !== PlayerStatus.PLAYING}
            onClick={mediaTogglePlayPause}
        />
    );
};

const SkipForwardButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const { mediaSkipForward } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaStepForward" size={buttonSize} />}
            onClick={mediaSkipForward}
            tooltip={{
                label: t('player.skip', {
                    context: 'forward',
                }),
                openDelay: 0,
            }}
            variant="secondary"
        />
    );
};

const NextButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const { mediaNext } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaNext" size={buttonSize} />}
            onClick={(e) => mediaNext(e.altKey)}
            tooltip={{
                label: (
                    <Stack gap="xs" justify="center">
                        <Text fw={500} ta="center">
                            {t('player.next')}
                        </Text>
                        <Text fw={500} isMuted size="xs" ta="center">
                            {t('player.nextAlbum')}
                        </Text>
                    </Stack>
                ),
                openDelay: 0,
            }}
            variant="secondary"
        />
    );
};

const RepeatButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();
    const repeat = useRemoteAwareRepeat();
    const { toggleRepeat } = usePlayer();

    return (
        <PlayerButton
            disabled={disabled}
            icon={
                repeat === PlayerRepeat.ONE ? (
                    <Icon fill="primary" icon="mediaRepeatOne" size={buttonSize} />
                ) : (
                    <Icon
                        fill={repeat === PlayerRepeat.NONE ? 'default' : 'primary'}
                        icon="mediaRepeat"
                        size={buttonSize}
                    />
                )
            }
            isActive={repeat !== PlayerRepeat.NONE}
            onClick={toggleRepeat}
            tooltip={{
                label: `${
                    repeat === PlayerRepeat.NONE
                        ? t('player.repeat', {
                              context: 'off',
                          })
                        : repeat === PlayerRepeat.ALL
                          ? t('player.repeat', {
                                context: 'all',
                            })
                          : t('player.repeat', {
                                context: 'one',
                            })
                }`,
                openDelay: 0,
            }}
            variant="tertiary"
        />
    );
};

const ShuffleAllButton = ({ disabled }: { disabled?: boolean }) => {
    const { t } = useTranslation();
    const buttonSize = useButtonSize();

    return (
        <PlayerButton
            disabled={disabled}
            icon={<Icon fill="default" icon="mediaRandom" size={buttonSize} />}
            onClick={() => openShuffleAllModal()}
            tooltip={{
                label: t('form.shuffleAll.title'),
                openDelay: 0,
            }}
            variant="tertiary"
        />
    );
};
