# Results: R2, the short artist page

Plan: `PLAN-feishin-short-artist-page-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/short-artist-page-2026-10-28`, local only, never pushed. Written 2026-10-28 on the workstation. This note has two halves.
The first half (this commit) is the gates. The second half, "Watched running on the VM", is Task 6 and is empty.

**Base.** Cut from `fix/colour-ease-2026-10-27` at `2302d69a` (R1, what the owner runs). The branch has six commits on top.

| Commit | What |
|---|---|
| `64ad3a60` | The shelves core: `popularReleases`, `kindLines`, `ownedPlayIds`, pure, in `features/discography/artist-shelves.ts` |
| `21139c0c` | `LibraryHeader` gets an opt-in `hero` size (image, roundness, title size as CSS variables) |
| `5f4daec2` | Fix round for it: title tracking, kicker weight, square 8 px corner |
| `277a5ce9` | The discography on its own page, under a compact hero header |
| `4a6c4fd8` | One play model for both routes; fixes B-212 |
| `f097fde5` | The short artist page: Popular releases, a line per kind, the board's header and action row |

## What changed

- The owned artist page no longer mounts the whole discography. It shows one line of Popular releases and one line per release
  kind. Each line has a link to the full discography. Popular releases follow Navic's rule: most played first, then newest, then
  syncing, then missing albums.
- The full discography (filters, ownership, sort, Rescan, scan bar, MusicBrainz menu) moved, unchanged, to its own route
  `.../discography`, under a compact header whose title links back to the artist. The Rescan and MusicBrainz menu now live only there.
- The artist header follows the design board: a round 168 px image, a 54 px title, a kicker, a meta line, and a labelled action row
  (Play, Shuffle, Artist radio, View all tracks, then rating, favourite and more). The row is a shared `HeroActions` component, so the
  album page (R3) can reuse it.
- Play and Shuffle on the artist page queue all owned albums, newest first. On the discography page they queue the filtered view.
- B-212 is fixed in code: the "this artist's songs only" filter compares against the route id, so `/library/artists/:artistId` no
  longer filters every song out. It is read, not run yet.
- `kindSettings` is one mapping shared by the artist page's lines and the discography's sections. `getItemsPerRow` and
  `TILE_BREAKPOINTS` are exported from `discography.tsx` with no behaviour change.

## Gates

Run on the finished branch at `f097fde5` (before this note's commit).

| Gate | Command | Result |
|---|---|---|
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| tsc, renderer | `tsc --noEmit -p tsconfig.web.json --composite false`, TS6307 filtered | no output |
| tsc, main | `tsc --noEmit -p tsconfig.node.json --composite false`, TS6307 filtered | no output |
| eslint | `--max-warnings=0` over the 17 changed ts/tsx files | exit 0 |
| stylelint | `--max-warnings=0` over the 4 changed CSS files | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 72 files, 963 pass, 0 fail |
| Em dash | added lines in `2302d69a..HEAD` | 0 |

| Harness count | Files | Pass | Fail |
|---|---|---|---|
| Base `2302d69a` | 70 | 951 | 0 |
| Final | 72 | 963 | 0 |

The 12 new cases: 7 in `artist-shelves.harness.ts` (Task 1), 3 in `library-header-hero.harness.ts` (Task 2), 2 in
`discography-model.harness.ts` (Task 4: `viewPlayIds`, `kindSettings`).

## Rulings

- Task 2: the hero title size lives in a pure module `hero-title-size.ts` (the harness cannot import through `/@/`).
- Task 2: a square hero image takes the board's 8 px radius. The board's Bricolage display font is not loaded; the font stays the
  user's setting.
- Task 3: `usePlayArtistReleases` has no `items` argument; the prefetch moved to `lbbot-discography-prefetch.tsx`; `titleTo` is an
  opt-in on `LibraryHeader`; the play and shuffle buttons are `PlayTextButton` and `WideShuffleButton`.
- Task 4: `HeroActions` is shared (an amendment to the plan, so R3 does not write a second copy).
- Task 4: `getItemsPerRow` exported rather than copied; `TILE_BREAKPOINTS` exported with it.
- Task 4: the server id is a local `serverId` in the hook, because eslint's React Compiler rule forbids `server?.id` in deps.
- Task 4: B-212 is fixed in the hook, not left for later.
- Task 4: `HeroAction.icon` is typed `AppIconSelection`; the hook lost its unused `albumArtistId`.
- Bookkeeping: the branch is recorded as S-072, not the plan's S-071.

## Deferred minors

- Harness lacks cases for the null-year tie-break, missing/syncing ordering with two or more items, and `ownedPlayIds` skipping a
  null `albumId`.
- `noHeroWithoutProp` guards only the class call sites, not the gated style variables. No narrow-width rule for the hero row (R6).
- The discography page has no background-image branch (artist background setting). Scroll restore after the filter's replace writes
  is unchecked.
- `HeroActions` More button has no aria-label. `buildItems` runs twice (header and shelves). `sectionsOf` ranks with `indexOf`.
  Nothing renders before `cq.isCalculated`.

## Review Focus: where each item is answered

| # | Item | Answered |
|---|---|---|
| 1 | Artist lb-bot never scanned, or lb-bot absent | The model half: harness case `fromLibraryOnlyHasNoMissing` (passes). The look (no empty headings, no "Owned" pill on every tile) waits for the VM walk. |
| 2 | One or two releases | The model half: `seeAllOnlyWhenMore` (passes). "See discography" stays when there is nothing to show (Task 4 report, choice 6). The look waits for the VM walk. |
| 3 | Play and Shuffle play all owned, newest first | The model half: `playIdsDefaultView` (passes), `viewPlayIds` for the discography page. Actual queueing on both routes waits for the VM walk. |
| 4 | Back restores the artist page's scroll; filters stay in the URL | Waits for the VM walk (Task 6). |
| 5 | Narrow window: two tiles per line, headings do not wrap, buttons wrap | Waits for the VM walk at 1100 x 700 with the queue open and at 800 x 600 (Task 6). |

Not verified by this half: nothing here was seen rendering. The B-212 fix, the 54 px title and 168 px circle as computed, the meta
line wording with real data and the first tile's top against the base are all for the walk.

## Before: the base on the VM (production build, 1440 x 900 emulated, dpr 1)

Frame numbers from that run are invalid (the VM session was locked, so the window ran at about 2 fps). Only the frame-independent
numbers are quoted. Source: `.superpowers/sdd/PLAN-feishin-short-artist-page-2026-10-28/vm-baseline.md`.

| Metric (album to artist push, median) | Before (`2302d69a`) | After |
|---|---|---|
| TaskDuration ms | 933 (run.mjs 1143) | (Task 6) |
| First tile ready, polled, ms | 657 | (Task 6) |
| DOM nodes in main | 5304 | (Task 6) |
| Release tiles in main | 320 | (Task 6) |
| First tile top, px | 721.7 | (Task 6) |
| Header image, px | 225, radius 5 | (Task 6) |
| Artist name h1, px | 33.96 | (Task 6) |

## Watched running on the VM

(Task 6)
