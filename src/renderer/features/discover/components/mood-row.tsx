import { DiscoverRow } from './discover-row';

import { openClapSearchModal } from '/@/renderer/features/sonic/components/clap-search-modal';
import { Button } from '/@/shared/components/button/button';

/**
 * CLAP mood search, as an inline entry point rather than a modal you have to
 * already know about.
 *
 * Today the only way in is a command-palette entry, which means it is reachable
 * exclusively by people who know it exists. The feature is text→sound search
 * over the user's own library and it is genuinely the most unusual thing in this
 * app; hiding it behind a keyboard shortcut is the problem.
 *
 * The chips are prompts, not results — this row's job is to show what kind of
 * question can be asked. They open the existing modal carrying the prompt, so
 * nothing about the search itself is duplicated here. They are also the one row
 * that is not a carousel: there is nothing to page through and nothing to
 * illustrate, so they wrap instead.
 */
const PROMPTS = [
    'rainy sunday morning',
    'driving at night',
    'slow and heavy',
    'bright and jangly',
    'something to cook to',
    'melancholy but warm',
];

export const MoodRow = ({ title }: { title: string }) => (
    <DiscoverRow
        because="Describe a mood and search your own library by how it sounds"
        isEmpty={false}
        title={title}
    >
        {PROMPTS.map((prompt) => (
            <Button
                key={prompt}
                onClick={() => openClapSearchModal(prompt)}
                radius="xl"
                size="compact-md"
                variant="default"
            >
                {prompt}
            </Button>
        ))}
    </DiscoverRow>
);
