import type { ReactNode } from 'react';

import { useRef } from 'react';

import styles from './fork-detail-page.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryBackgroundOverlay } from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeader } from '/@/renderer/features/shared/components/library-header';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { useCoverHeaderWash } from '/@/renderer/themes/cover/use-cover-header-wash';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * A fork page about one album or artist the library does not have, built the way upstream
 * builds its album and artist pages: the large header with the art and the title (and the
 * page's colour taken from that art), the title in the bar that slides in on scroll, and the
 * sections under it at the detail pages' spacing. These pages used to be a list page's frame
 * with a 96px cover, or no header at all.
 */
export const ForkDetailPage = ({
    children,
    headerChildren,
    imageUrl,
    itemType,
    route,
    title,
}: {
    children: ReactNode;
    headerChildren?: ReactNode;
    imageUrl?: null | string;
    itemType: LibraryItem.ALBUM | LibraryItem.ALBUM_ARTIST;
    route: string;
    title: string;
}) => {
    const headerRef = useRef<HTMLDivElement>(null);
    // A fork page's art is a public Cover Art Archive URL (no credential, no per-request token), so
    // the URL itself is the cover's identity here.
    const { background } = useCoverHeaderWash({
        id: imageUrl || title,
        serverId: 'external',
        src: imageUrl,
    });

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: background || undefined,
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>{title}</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                    target: headerRef,
                }}
            >
                <LibraryBackgroundOverlay background={background} headerRef={headerRef} />
                <LibraryContainer>
                    <LibraryHeader
                        imageUrl={imageUrl}
                        item={{ imageUrl, route, type: itemType }}
                        ref={headerRef}
                        title={title}
                    >
                        {headerChildren}
                    </LibraryHeader>
                    <div className={styles.contentContainer}>
                        <div className={styles.detailContainer}>{children}</div>
                    </div>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};
