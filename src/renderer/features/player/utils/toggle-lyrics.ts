import { useFullScreenPlayerStore } from '/@/renderer/store';

/** Open the full-screen player on its lyrics, or toggle the lyrics tab when it is open. */
export const toggleLyrics = () => {
    const { actions, activeTab, expanded } = useFullScreenPlayerStore.getState();
    if (!expanded) {
        actions.setStore({ activeTab: 'lyrics', expanded: true });
    } else {
        actions.setStore({ activeTab: activeTab === 'lyrics' ? '' : 'lyrics' });
    }
};
