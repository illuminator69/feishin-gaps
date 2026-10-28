import { useTranslation } from 'react-i18next';

import styles from './album-request-box.module.css';

import scanStyles from '/@/renderer/features/discography/components/scan.module.css';
import { SourceCards } from '/@/renderer/features/lbbot/components/source-cards';
import { type AlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import { Button } from '/@/shared/components/button/button';
import { Select } from '/@/shared/components/select/select';
import { LB_BOT_QUALITY_OPTIONS } from '/@/shared/types/lbbot-types';

const QUALITY_DATA = [
    { label: "lb-bot's default", value: '' },
    ...LB_BOT_QUALITY_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
];

const elapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The missing album's box while it is about sources (R11, B-222, after Navic's request box): a
 * stated wait, never a skeleton (the answer comes whole after 30 to 90 seconds), then lb-bot's
 * ranked folders as radio cards with Download right under the chosen one, and Search again and
 * Pick the best source for me as quiet buttons under the cards. The request turns the same box
 * into the steps (`AlbumRequestBox`).
 */
export const FindSourcesSection = ({ request }: { request: AlbumRequest }) => {
    const { t } = useTranslation();
    const { sources } = request;

    if (sources.state === 'waiting') {
        return (
            <div className={styles.sources} data-find-sources-section="waiting">
                <div className={styles.waitHead}>
                    <span aria-hidden="true" className={scanStyles.spin} />
                    {t('naviConnect.albumPage.searching')}
                    <span className={styles.elapsed} data-sources-elapsed="">
                        {elapsed(sources.elapsedMs)}
                    </span>
                </div>
                <p className={styles.line}>{t('naviConnect.albumPage.searchTakes')}</p>
                <div
                    aria-label={t('naviConnect.albumPage.searchBarLabel')}
                    className={scanStyles.bar}
                    role="progressbar"
                >
                    <i className={scanStyles.barFill} />
                </div>
                <p className={styles.line}>{t('naviConnect.albumPage.nothingPartial')}</p>
                <div className={styles.buttons}>
                    <Button
                        data-sources-stop=""
                        onClick={sources.stop}
                        size="compact-sm"
                        variant="default"
                    >
                        {t('naviConnect.albumPage.stopWaiting')}
                    </Button>
                </div>
                <p className={styles.line}>{t('naviConnect.albumPage.stopWaitingNote')}</p>
            </div>
        );
    }

    if (sources.state === 'failed' || sources.state === 'empty') {
        return (
            <div className={styles.sources} data-find-sources-section={sources.state}>
                {sources.state === 'failed' ? (
                    <p className={styles.reason} data-sources-failed="" role="alert">
                        {sources.error}
                    </p>
                ) : (
                    <p className={styles.headline} data-sources-empty="">
                        {t('naviConnect.albumPage.noSource')}
                    </p>
                )}
                <div className={styles.buttons}>
                    <Button onClick={sources.again} size="compact-sm" variant="default">
                        {t('naviConnect.albumPage.searchAgain')}
                    </Button>
                </div>
            </div>
        );
    }

    if (sources.state !== 'ready') return null;

    return (
        <div className={styles.sources} data-find-sources-section="ready">
            <h2 className={styles.label}>
                {t('naviConnect.albumPage.sourcesBestFirst', { count: sources.rows.length })}
            </h2>
            {sources.searchedOther && (
                <p className={styles.line} data-sources-other-edition="">
                    {t('naviConnect.albumPage.resultsFor', { edition: sources.searchedLabel })}
                </p>
            )}
            {!request.selected && (
                <p className={styles.line} data-sources-choose="">
                    {t('naviConnect.albumPage.chooseSource')}
                </p>
            )}
            <SourceCards
                disabled={request.busy}
                files={sources.filesFor}
                onDownloadAll={(source) => {
                    request.select(source);
                    void request.download({ allFiles: true, source });
                }}
                onSelect={request.select}
                renderUnderSelected={(source) => (
                    <div className={styles.underCard}>
                        <Button
                            data-download=""
                            disabled={request.busy}
                            loading={request.starting}
                            onClick={() => void request.download({ source })}
                            variant="filled"
                        >
                            {t('naviConnect.albumPage.downloadFromHere')}
                        </Button>
                        <p className={styles.line}>{t('naviConnect.albumPage.fallback')}</p>
                    </div>
                )}
                selected={request.selected?.id ?? null}
                sources={sources.rows}
            />
            <div className={styles.under}>
                <Select
                    aria-label={t('naviConnect.albumPage.quality')}
                    data={QUALITY_DATA}
                    disabled={request.busy}
                    onChange={(value) => request.setQuality(value ?? '')}
                    size="xs"
                    value={request.preferredQuality}
                    width={200}
                />
                <Button
                    data-sources-again=""
                    disabled={request.busy}
                    onClick={sources.again}
                    size="compact-sm"
                    variant="subtle"
                >
                    {t('naviConnect.albumPage.searchAgain')}
                </Button>
                <Button
                    data-sources-auto=""
                    disabled={request.busy}
                    onClick={() => void request.download({ auto: true })}
                    size="compact-sm"
                    variant="subtle"
                >
                    {t('naviConnect.albumPage.autoPick')}
                </Button>
            </div>
        </div>
    );
};
