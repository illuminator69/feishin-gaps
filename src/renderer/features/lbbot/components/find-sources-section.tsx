import { useTranslation } from 'react-i18next';

import styles from './not-owned-album.module.css';

import scanStyles from '/@/renderer/features/discography/components/scan.module.css';
import { SourceList } from '/@/renderer/features/lbbot/components/source-list';
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
 * Find sources (boards Sources and Requests): a stated wait, never a skeleton (the answer comes
 * whole after 30 to 90 seconds), then lb-bot's ranked folders, the pick and Download.
 */
export const FindSourcesSection = ({ request }: { request: AlbumRequest }) => {
    const { t } = useTranslation();
    const { sources } = request;
    const waiting = sources.state === 'waiting';
    return (
        <section className={styles.sources} data-find-sources-section={sources.state}>
            {waiting && (
                <div className={styles.wait} data-sources-wait="">
                    <h2 className={styles.label}>{t('naviConnect.albumPage.whileSearching')}</h2>
                    <div className={styles.waitHead}>
                        <span aria-hidden="true" className={scanStyles.spin} />
                        {t('naviConnect.albumPage.searching')}
                        <span className={styles.elapsed} data-sources-elapsed="">
                            {elapsed(sources.elapsedMs)}
                        </span>
                    </div>
                    <p className={styles.muted}>{t('naviConnect.albumPage.nothingPartial')}</p>
                    <div
                        aria-label={t('naviConnect.albumPage.searchBarLabel')}
                        className={scanStyles.bar}
                        role="progressbar"
                    >
                        <i className={scanStyles.barFill} />
                    </div>
                    <div>
                        <Button
                            data-sources-stop=""
                            onClick={sources.stop}
                            size="compact-sm"
                            variant="default"
                        >
                            {t('naviConnect.albumPage.stopWaiting')}
                        </Button>
                    </div>
                    <p className={styles.muted}>{t('naviConnect.albumPage.stopWaitingNote')}</p>
                </div>
            )}
            {waiting && (
                <div>
                    <h2 className={styles.label}>{t('naviConnect.albumPage.results')}</h2>
                    <p className={styles.muted}>{t('naviConnect.albumPage.resultsLater')}</p>
                </div>
            )}
            {!waiting && (
                <div>
                    <h2 className={styles.label}>{t('naviConnect.albumPage.results')}</h2>
                    {sources.searchedOther && (
                        <p className={styles.muted} data-sources-other-edition="">
                            {t('naviConnect.albumPage.resultsFor', {
                                edition: sources.searchedLabel,
                            })}
                        </p>
                    )}
                    {sources.state === 'failed' && (
                        <div data-sources-failed="">
                            <p className={styles.muted} role="alert">
                                {sources.error}
                            </p>
                            <Button
                                mt={8}
                                onClick={sources.start}
                                size="compact-sm"
                                variant="default"
                            >
                                {t('naviConnect.albumPage.tryAgain')}
                            </Button>
                        </div>
                    )}
                    {sources.state === 'empty' && (
                        <div data-sources-empty="">
                            <p className={styles.muted}>{t('naviConnect.albumPage.noSource')}</p>
                            <Button
                                mt={8}
                                onClick={sources.start}
                                size="compact-sm"
                                variant="default"
                            >
                                {t('naviConnect.albumPage.tryAgain')}
                            </Button>
                        </div>
                    )}
                    {sources.state === 'ready' && (
                        <>
                            <SourceList
                                downloadDisabled={request.busy}
                                filesFor={sources.filesFor}
                                onDownloadAll={(source) => {
                                    request.select(source);
                                    void request.download({ allFiles: true, source });
                                }}
                                onSelect={request.select}
                                onToggleFiles={sources.toggleFiles}
                                selectedId={request.selected?.id ?? null}
                                sources={sources.rows}
                            />
                            <div className={styles.resultFooter}>
                                {request.selected && (
                                    <p className={styles.muted}>
                                        {t('naviConnect.albumPage.fallback')}
                                    </p>
                                )}
                                <Select
                                    aria-label={t('naviConnect.albumPage.quality')}
                                    data={QUALITY_DATA}
                                    disabled={request.busy}
                                    onChange={(value) => request.setQuality(value ?? '')}
                                    value={request.preferredQuality}
                                    width={220}
                                />
                                <Button
                                    data-download=""
                                    disabled={request.busy || !request.selected}
                                    loading={request.starting}
                                    onClick={() => void request.download()}
                                    variant="filled"
                                >
                                    {t('naviConnect.albumPage.download')}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </section>
    );
};
