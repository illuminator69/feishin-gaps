import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ArtistReleaseTypeItem, useAppStore } from '/@/renderer/store';
import { useArtistReleaseTypeItems } from '/@/renderer/store/settings.store';
import { titleCase } from '/@/renderer/utils';
import { SEPARATOR_STRING } from '/@/shared/api/utils';
import { Album } from '/@/shared/types/domain-types';
import { LbBotRelease } from '/@/shared/types/lbbot-types';

const collator = new Intl.Collator();

export type GroupingType = 'all' | 'primary';

const PRIMARY_RELEASE_TYPES = ['album', 'broadcast', 'ep', 'other', 'single'];

const getNormalizedReleaseTypes = (album: Album): string[] => {
    const rawReleaseTypes = [...(album.releaseTypes || []), album.releaseType || ''];
    const normalizedReleaseTypes = rawReleaseTypes
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean);

    return [...new Set(normalizedReleaseTypes)];
};

/**
 * The bucket one set of release types belongs in.
 *
 * Pulled out of the album grouping below so lb-bot's missing releases can be
 * filed by the same rule as the albums the library holds — the whole point of
 * showing them together is that an unowned album lands in "Album", next to the
 * owned ones, rather than in a separate pile of everything that's absent.
 */
const releaseTypeKeyFor = (
    normalizedTypes: string[],
    isCompilation: boolean,
    groupingType: GroupingType,
): string => {
    if (groupingType === 'all') {
        if (isCompilation) return 'compilation';
        if (normalizedTypes.length === 0) return 'album';
        // Primaries first, then secondaries, each alphabetical — so the same set
        // of types always produces the same key.
        const primaryTypes = normalizedTypes
            .filter((type) => PRIMARY_RELEASE_TYPES.includes(type))
            .sort();
        const secondaryTypes = normalizedTypes
            .filter((type) => !PRIMARY_RELEASE_TYPES.includes(type))
            .sort();
        return [...primaryTypes, ...secondaryTypes].join('/');
    }

    for (const type of ['album', 'single', 'ep', 'broadcast', 'other']) {
        if (normalizedTypes.includes(type)) return type;
    }
    return normalizedTypes[0] ?? 'album';
};

/** lb-bot release rows, bucketed by the same key the owned albums use. */
export const groupMissingByReleaseType = (
    releases: LbBotRelease[],
    groupingType: GroupingType,
): Record<string, LbBotRelease[]> => {
    return releases.reduce(
        (acc, release) => {
            const normalized = [
                ...new Set(
                    [release.primaryType, ...(release.secondaryTypes || [])]
                        .map((type) => (type || '').trim().toLowerCase())
                        .filter(Boolean),
                ),
            ];
            const key = releaseTypeKeyFor(
                normalized,
                (release.secondaryTypes || []).includes('compilation'),
                groupingType,
            );
            (acc[key] ||= []).push(release);
            return acc;
        },
        {} as Record<string, LbBotRelease[]>,
    );
};

export const groupAlbumsByReleaseType = (
    albums: Album[],
    routeId: string,
    groupingType: GroupingType = 'primary',
): Record<string, Album[]> => {
    return albums.reduce(
        (acc, album) => {
            // "Appears on" wins over everything: the artist isn't credited as an
            // album artist here, so the release's own type says nothing useful.
            const isAlbumArtist = album.albumArtists?.some((artist) => artist.id === routeId);
            const key = isAlbumArtist
                ? releaseTypeKeyFor(
                      getNormalizedReleaseTypes(album),
                      Boolean(album.isCompilation),
                      groupingType,
                  )
                : 'appears-on';
            (acc[key] ||= []).push(album);
            return acc;
        },
        {} as Record<string, Album[]>,
    );
};

export const releaseTypeToEnumMap: Record<string, ArtistReleaseTypeItem> = {
    album: ArtistReleaseTypeItem.RELEASE_TYPE_ALBUM,
    'appears-on': ArtistReleaseTypeItem.APPEARS_ON,
    audiobook: ArtistReleaseTypeItem.RELEASE_TYPE_AUDIOBOOK,
    'audio drama': ArtistReleaseTypeItem.RELEASE_TYPE_AUDIO_DRAMA,
    broadcast: ArtistReleaseTypeItem.RELEASE_TYPE_BROADCAST,
    compilation: ArtistReleaseTypeItem.RELEASE_TYPE_COMPILATION,
    demo: ArtistReleaseTypeItem.RELEASE_TYPE_DEMO,
    'dj-mix': ArtistReleaseTypeItem.RELEASE_TYPE_DJ_MIX,
    ep: ArtistReleaseTypeItem.RELEASE_TYPE_EP,
    'field recording': ArtistReleaseTypeItem.RELEASE_TYPE_FIELD_RECORDING,
    interview: ArtistReleaseTypeItem.RELEASE_TYPE_INTERVIEW,
    live: ArtistReleaseTypeItem.RELEASE_TYPE_LIVE,
    'mixtape/street': ArtistReleaseTypeItem.RELEASE_TYPE_MIXTAPE_STREET,
    other: ArtistReleaseTypeItem.RELEASE_TYPE_OTHER,
    remix: ArtistReleaseTypeItem.RELEASE_TYPE_REMIX,
    single: ArtistReleaseTypeItem.RELEASE_TYPE_SINGLE,
    soundtrack: ArtistReleaseTypeItem.RELEASE_TYPE_SOUNDTRACK,
    spokenword: ArtistReleaseTypeItem.RELEASE_TYPE_SPOKENWORD,
};

export const getArtistAlbumsGrouped = (
    albums: Album[],
    routeId: string,
    groupingType: GroupingType,
    artistReleaseTypeItems: { disabled: boolean; id: string }[],
    t: (key: string, options?: any) => string,
    missingReleases: LbBotRelease[] = [],
) => {
    const albumsByReleaseType = groupAlbumsByReleaseType(albums, routeId, groupingType);
    const missingByReleaseType = groupMissingByReleaseType(missingReleases, groupingType);

    const enabledReleaseTypeEnums = new Set(
        artistReleaseTypeItems.filter((item) => !item.disabled).map((item) => item.id),
    );

    const priorityMap = new Map<string, number>();
    artistReleaseTypeItems
        .filter((item) => !item.disabled)
        .forEach((item, index) => {
            const releaseTypeKey = Object.keys(releaseTypeToEnumMap).find(
                (key) => releaseTypeToEnumMap[key] === item.id,
            );
            if (releaseTypeKey) {
                priorityMap.set(releaseTypeKey, index);
            }
        });

    const getDisplayNameForType = (releaseType: string): string => {
        switch (releaseType) {
            case 'album':
                return t('releaseType.primary.album');
            case 'appears-on':
                return t('page.albumArtistDetail.appearsOn');
            case 'audiobook':
                return t('releaseType.secondary.audiobook');
            case 'audio drama':
                return t('releaseType.secondary.audioDrama');
            case 'broadcast':
                return t('releaseType.primary.broadcast');
            case 'compilation':
                return t('releaseType.secondary.compilation');
            case 'demo':
                return t('releaseType.secondary.demo');
            case 'dj-mix':
                return t('releaseType.secondary.djMix');
            case 'ep':
                return t('releaseType.primary.ep', {
                    postProcess: 'upperCase',
                });
            case 'field recording':
                return t('releaseType.secondary.fieldRecording');
            case 'interview':
                return t('releaseType.secondary.interview');
            case 'live':
                return t('releaseType.secondary.live');
            case 'mixtape/street':
                return t('releaseType.secondary.mixtape');
            case 'other':
                return t('releaseType.primary.other');
            case 'remix':
                return t('releaseType.secondary.remix');
            case 'single':
                return t('releaseType.primary.single');
            case 'soundtrack':
                return t('releaseType.secondary.soundtrack');
            case 'spokenword':
                return t('releaseType.secondary.spokenWord');
            default:
                return titleCase(releaseType);
        }
    };

    const getPriority = (releaseType: string) => {
        if (releaseType.includes('/')) {
            const types = releaseType.split('/');
            // Check if there's a primary type in the joined types
            const primaryTypes = types.filter((type) => PRIMARY_RELEASE_TYPES.includes(type));

            if (primaryTypes.length > 0) {
                // Use the primary type's priority (first primary if multiple)
                const primaryPriority = priorityMap.get(primaryTypes[0]) ?? 999;
                return primaryPriority;
            } else {
                // Only secondary types - use minimum priority from settings
                const priorities = types
                    .map((type) => priorityMap.get(type) ?? 999)
                    .filter((p) => p !== 999);
                return priorities.length > 0 ? Math.min(...priorities) : 999;
            }
        }
        return priorityMap.get(releaseType) ?? 999;
    };

    const getSecondaryTypePriorityKey = (releaseType: string): string => {
        if (releaseType.includes('/')) {
            const types = releaseType.split('/');
            const secondaryTypes = types.filter((type) => !PRIMARY_RELEASE_TYPES.includes(type));

            if (secondaryTypes.length > 0) {
                const priorities = secondaryTypes
                    .map((type) => priorityMap.get(type) ?? 999)
                    .filter((p) => p !== 999)
                    .sort((a, b) => a - b);

                return priorities.map((p) => String(p).padStart(3, '0')).join(',');
            }
        }
        return '';
    };

    const isReleaseTypeEnabled = (releaseType: string): boolean => {
        if (releaseType.includes('/')) {
            const types = releaseType.split('/');
            return types.some((type) => {
                const enumValue = releaseTypeToEnumMap[type];
                return enumValue ? enabledReleaseTypeEnums.has(enumValue) : true;
            });
        }
        const enumValue = releaseTypeToEnumMap[releaseType];
        return enumValue ? enabledReleaseTypeEnums.has(enumValue) : true;
    };

    // A type the library holds nothing of still gets a section when lb-bot knows
    // of releases in it — otherwise an artist whose EPs you own none of would
    // have its missing EPs silently dropped.
    const allReleaseTypes = [
        ...new Set([...Object.keys(albumsByReleaseType), ...Object.keys(missingByReleaseType)]),
    ];

    const releaseTypeEntries = allReleaseTypes
        .filter((releaseType) => isReleaseTypeEnabled(releaseType))
        .map((releaseType) => {
            let displayName: React.ReactNode | string;

            if (releaseType.includes('/')) {
                const types = releaseType.split('/');
                const displayNames = types.map((type) => getDisplayNameForType(type));
                displayName = displayNames.join(SEPARATOR_STRING);
            } else {
                displayName = getDisplayNameForType(releaseType);
            }

            return {
                albums: albumsByReleaseType[releaseType] ?? [],
                displayName,
                missing: missingByReleaseType[releaseType] ?? [],
                releaseType,
            };
        })
        .sort((a, b) => {
            const priorityA = getPriority(a.releaseType);
            const priorityB = getPriority(b.releaseType);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            const isCombinedA = a.releaseType.includes('/');
            const isCombinedB = b.releaseType.includes('/');

            if (isCombinedA && isCombinedB) {
                const secondaryKeyA = getSecondaryTypePriorityKey(a.releaseType);
                const secondaryKeyB = getSecondaryTypePriorityKey(b.releaseType);

                if (secondaryKeyA && secondaryKeyB) {
                    return collator.compare(secondaryKeyA, secondaryKeyB);
                }
            }

            return collator.compare(a.releaseType, b.releaseType);
        });

    const flatSortedAlbums = releaseTypeEntries.flatMap((entry) => entry.albums);

    // Every individual release type this artist actually has something in,
    // **before** the enabled filter above — a type the user has switched off is
    // precisely the one whose toggle has to stay on screen, or turning
    // compilations off would remove the only control that turns them back on.
    //
    // Ordered by the user's own release-type order rather than by `getPriority`,
    // which only knows about enabled types — a toggle must not jump to the end of
    // the menu the moment it is switched off.
    const settingsOrder = new Map(
        artistReleaseTypeItems.map((item, index) => [item.id as string, index]),
    );
    const presentReleaseTypes = [
        ...new Set(allReleaseTypes.flatMap((releaseType) => releaseType.split('/'))),
    ]
        .filter((releaseType) => releaseTypeToEnumMap[releaseType])
        .sort(
            (a, b) =>
                (settingsOrder.get(releaseTypeToEnumMap[a]) ?? 999) -
                    (settingsOrder.get(releaseTypeToEnumMap[b]) ?? 999) || collator.compare(a, b),
        );

    return {
        flatSortedAlbums,
        presentReleaseTypes,
        releaseTypeDisplayName: getDisplayNameForType,
        releaseTypeEntries,
    };
};

export const useArtistAlbumsGrouped = (
    albums: Album[],
    routeId: string,
    missingReleases: LbBotRelease[] = [],
) => {
    const { t } = useTranslation();
    const artistReleaseTypeItems = useArtistReleaseTypeItems();
    const albumArtistDetailSort = useAppStore((state) => state.albumArtistDetailSort);
    const groupingType = albumArtistDetailSort.groupingType;

    return useMemo(() => {
        return getArtistAlbumsGrouped(
            albums,
            routeId,
            groupingType,
            artistReleaseTypeItems,
            t,
            missingReleases,
        );
    }, [albums, routeId, groupingType, artistReleaseTypeItems, t, missingReleases]);
};
