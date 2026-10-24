import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './not-owned-album.module.css';

import { AlbumTracklist } from '/@/renderer/features/lbbot/components/album-tracklist';
import { FindSourcesSection } from '/@/renderer/features/lbbot/components/find-sources-section';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import { type AlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import { Fold } from '/@/renderer/features/motion/fold';
import { LbBotMeta } from '/@/shared/types/lbbot-types';

/**
 * The body of the page for an album the library does not have (board AlbumUnowned, B-169): Find
 * sources folds in under the hero when pressed (the hero and its button stay where they are), the
 * request box sits above the columns, then About (read this first) beside the MusicBrainz tracklist.
 */
export const NotOwnedAlbum = ({
    artist,
    meta,
    request,
    requestBox,
    rgid,
}: {
    artist: string;
    meta: LbBotMeta | null | undefined;
    request: AlbumRequest;
    /** The request box (Task 7), when a request exists. */
    requestBox?: ReactNode;
    rgid: string;
}) => {
    const { t } = useTranslation();
    const hasAbout = !!meta && (meta.paragraphs.length > 0 || !!meta.summary);
    return (
        <div className={styles.body} data-not-owned-album="">
            <Fold name="find-sources" open={request.sources.state !== 'idle'} tall>
                <FindSourcesSection request={request} />
            </Fold>
            {requestBox}
            <div className={styles.columns}>
                <section data-album-about="">
                    <h2 className={styles.label}>
                        {t('naviConnect.albumPage.about')}{' '}
                        <small>{t('naviConnect.albumPage.aboutFirst')}</small>
                    </h2>
                    {hasAbout ? (
                        <MetaAbout maxHeight={360} meta={meta!} />
                    ) : (
                        // No About from lb-bot (none written, or an lb-bot too old to say): said once,
                        // never as an error.
                        <p className={styles.muted}>{t('naviConnect.albumPage.noAbout')}</p>
                    )}
                </section>
                <AlbumTracklist artist={artist} request={request} rgid={rgid} />
            </div>
            <p className={styles.muted}>{t('naviConnect.albumPage.noPlay')}</p>
        </div>
    );
};
