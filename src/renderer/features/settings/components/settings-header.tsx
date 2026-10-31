import { useTranslation } from 'react-i18next';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { SearchInput } from '/@/renderer/features/shared/components/search-input';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';

export const SettingsHeader = () => {
    const { t } = useTranslation();
    const { search, setSearch } = useSettingSearchStore();

    return (
        <PageHeader>
            <LibraryHeaderBar>
                <Flex align="center" justify="space-between" w="100%">
                    <LibraryHeaderBar.Title>
                        {t('common.setting', { count: 2 })}
                    </LibraryHeaderBar.Title>
                    <Group pr="2rem">
                        <SearchInput
                            defaultValue={search}
                            onChange={(event) => setSearch(event.target.value.toLocaleLowerCase())}
                        />
                    </Group>
                </Flex>
            </LibraryHeaderBar>
        </PageHeader>
    );
};
