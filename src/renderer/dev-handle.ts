// Dev-only (loaded from app.tsx behind `import.meta.env.DEV`, so a production build drops it): lets a
// headless check over CDP add a server, set the playing song, read cover seeds and set a cover seed
// directly, without a real library.
import { api } from '/@/renderer/api';
import { useStationStore } from '/@/renderer/features/player/station/station-store';
import { queryClient } from '/@/renderer/lib/react-query';
import {
    useAppStore,
    useAuthStore,
    useHubStore,
    usePlayerStore,
    useSettingsStore,
} from '/@/renderer/store';
import { useMixesStore } from '/@/renderer/store/mixes.store';
import { useSavedQueuesStore } from '/@/renderer/store/saved-queues.store';
import { applyWashVars, washVars } from '/@/renderer/themes/cover/apply-wash-vars';
import { type CoverSeed, rolesFor } from '/@/renderer/themes/cover/cover-roles';
import * as coverSeeds from '/@/renderer/themes/cover/cover-seed-store';
import { useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';

Object.assign(window, {
    __coverWash: {
        /** Wear `seed` in the given mode until the playing cover next changes. */
        set: (seed: CoverSeed, light: boolean) => {
            const roles = rolesFor(seed, light);
            applyWashVars(washVars(roles));
            useCoverWashStore.setState({ light, roles, seed });
        },
    },
    // F4 adds the app, hub, station and saved-queue stores, to set the side queue's states and
    // the panel's width with no hub; F5 the query client and the mixes store, to seed Home's rows.
    __f2: {
        api,
        coverSeeds,
        queryClient,
        useAppStore,
        useAuthStore,
        useHubStore,
        useMixesStore,
        usePlayerStore,
        useSavedQueuesStore,
        useSettingsStore,
        useStationStore,
    },
});
