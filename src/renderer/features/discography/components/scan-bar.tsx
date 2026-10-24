import { useTranslation } from 'react-i18next';

import styles from './scan.module.css';

import { type ArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { Icon } from '/@/shared/components/icon/icon';

/** The scan's one line, and while it runs the indeterminate bar (no value: the length is unknown). */
export const ScanBar = ({ scan }: { scan: ArtistScan }) => {
    const { t } = useTranslation();
    if (!scan.line) return null;
    const failed = scan.phase === 'failed';
    const running = scan.phase === 'running';
    return (
        <div className={styles.status} data-scan-status={scan.phase} data-steady={!failed}>
            {running ? (
                <div
                    aria-label={t('naviConnect.discography.scan.barLabel')}
                    className={styles.bar}
                    data-scan-bar=""
                    role="progressbar"
                >
                    <i className={styles.barFill} />
                </div>
            ) : (
                <div aria-hidden="true" className={styles.bar} data-hidden="true" />
            )}
            <p
                className={styles.line}
                data-tone={failed ? 'failed' : undefined}
                role={failed ? 'alert' : undefined}
            >
                {failed && <Icon icon="warn" />}
                {scan.line}
            </p>
        </div>
    );
};
