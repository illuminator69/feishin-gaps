# Results: F4, the side queue

Plan: `PLAN-feishin-side-queue-2026-10-21.md` with its addendum (kept outside the repo, in the F4 context package). Branch `redesign/side-queue`, cut
from `origin/feat/redesign` at `a2094cf` (contains F1's `ae8e15f3`, F2's `c58c0b50` and F3's `6f048a23`). The harness checked out `redesign/shell`,
which lacks F3's merge commit, so the work is on a new branch cut from `origin/feat/redesign`. Written 2026-10-21 at the end of the branch.

One session ran the plan inline (`executing-plans`), Tasks 1 to 7 in order, one commit per task (Task 5 has two), plus one fix commit from the Task 7
sweep (reduced motion). One fresh whole-branch review follows; its findings, the fixes, the rulings and the deferred minors are appended at the end.

## Gates

| Check | Baseline (`a2094cf`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (25) | - | clean |
| stylelint `--max-warnings=0`, every changed CSS file (5) | - | clean |
| The 44 existing harnesses | 741 pass, 0 fail | 747 pass, 0 fail (`station-chips` 33 -> 39, the six toggle cases) |
| `queue-grouping.harness.ts` (new, Task 1) | - | 18 pass |
| `playing-from.harness.ts` (new, Task 2) | - | 13 pass |
| `group-row-index.harness.ts` (new, Task 5) | - | 5 pass |

47 harness files, 783 pass, 0 fail, run by hand (`node --test --test-reporter=tap <file>`, Node 22.22); CI does not run them. Every new harness was
seen to fail first (`ERR_MODULE_NOT_FOUND` for the three new modules; `does not provide an export named 'autoplayIsOn'` for the toggle cases).

**Install.** As F3 recorded: `pnpm install --frozen-lockfile` gets a 403 from the egress proxy on `codeload.github.com`. `node-mpv` and
`@electron/node-gyp` were cloned at their pinned commits and installed through a temporary, uncommitted `file:` override; `package.json`,
`pnpm-lock.yaml` and `pnpm-workspace.yaml` were restored byte for byte (`cmp` clean). A `pnpm exec ...` without the flag in the wrong place re-ran the
install, failed on the same 403 and removed `node-mpv` once; the workaround was repeated and the app was then started with
`./node_modules/.bin/electron-vite dev` directly. Commits ran `pnpm --config.verify-deps-before-run=false lint:staged`.

## Watched running

`electron-vite dev` under Xvfb (2600 x 1500 screen), driven over CDP with the package's `cdp.mjs`, `measure-queue.js` and `measure-layout.js`,
against the package's stand-in cover server behind a scratch front (`getUser.view`, empty Subsonic lists, `[]` for Navidrome's `/api/*`, a 404 for
`/api/song/<id>`: an empty answer there was merged into the playing song and blanked its id, name and duration). No hub, no station engine, no audio
(every play attempt errors and pauses). States were set through the stores via the dev handle (`window.__f2`, extended with the hub, station,
saved-queue and app stores), the station state re-asserted every 250 ms against the probe (addendum 24). Songs are generated (`Song N`, covers
`fixture:*`). Measurements at 1280 x 800 unless said.

### The header (Task 4)

| What | Seen |
|---|---|
| Rows at 360 px (album state) | Playing from block 54, status line 18, characters 34, Up next / Related 34, count line 36; header 236 px tall with its padding |
| `stickingOut` / `scrollsSideways` | none / false at panel 250, 300, 520 (1280 x 800), 360 (800 x 600, 1280 x 800, 2560 x 1440), 960 (2560 x 1440); no header row clipped |
| Count line | "49 songs, 2h 59m" at 360 and wider; "49 songs" at 250 and 300 (the length drops below a 280 px header content width) |
| Album, station bound | "Playing from / Lantern Season / Album · autoplay continues after it, Blend"; status "Hollow Orchard radio · Blend"; switch on; Blend selected |
| Mood mix, no station | "Relax - Folk / Mood mix · autoplay continues after it, <preferred>"; status "When this queue runs out, it carries on as a radio from its last tracks." |
| Stopped station (radio record, seed name "Hollow Orchard") | "Hollow Orchard radio / Station · stopped" (the hub's name wins over the seed's); switch off; characters at opacity .4; status "... · Autoplay is off. This queue stops at its end." |
| Another device | "Wren Songs / Playing on Pixel 8 · Blend"; count "31 songs, 1h 51m" from `remoteQueue` |
| Nothing playing | no Playing from block; switch off; characters dimmed; "0 songs, 0 min" |
| Fallback (no engine) | "Lantern Season / Album · Auto DJ"; status "Auto DJ"; no character row; the switch alone |
| Taps (state hold stopped first) | Discover: `bound.character` explore and the preference explore at once, status follows; switch off: `autoDJ` false, `bound.stopped` true; tap dimmed Familiar: autoplay on, bound close; switch off then on: restarts in the bound station's character |
| Dimming | samples every 25 ms: 1, .93, .65, .55, .44, .42, .4; reduced motion: .4 from the first sample |
| `...` menu | Play (shuffled), Go to current item, Create Playlist from queue, Table settings (save and restore hidden: the stand-in reports no server play queue); Table settings opens the `listConfigSettings` modal |
| Clear | opens the app's existing "Discard the current queue?"; Confirm empties it |
| Search | "Song 1" leaves Song 1 and 10 to 19; cleared, all rows return |
| Other surfaces | the Now Playing page keeps the old toolbar and the Off / Auto DJ chips |
| F3's shell | `measure-layout.js` after Tasks 4 and 7: cards 82 to 702, gaps 8 / 8 / 8 / 8 / 8, radius 10, no document scroll, no horizontal overflow, at every size above |

### The groups and the table (Task 5)

| What | Seen |
|---|---|
| Scratch proof before the queue used groups (groups of 5, reverted) | jump to Song 60 of 100: scrollTop 4590 and Song 60 at the centre; the same with the three table files stashed: 3732 (858 px = 13 rows short), a caption at the centre |
| Album 30, playing 3, rows 6 to 29 flagged | EARLIER, NOW PLAYING, QUEUED BY YOU 2, AUTOPLAY BLEND; the playing row centred on mount |
| Two skips | the NOW PLAYING caption stays at the same screen place with the song, playing row offset 0 each time; Queued by you 2 -> 1 -> gone |
| Regroup, row under fixed points (top + 100 and centre) | start Song 20 / Song 22 at scrollTop 1500; after a character tap (caption BLEND -> FAMILIAR), the switch off (-> OFF), a top-up of 5 flagged rows at the end, a reorder of row 36 to the end: Song 20 / Song 22 at 1500 every time |
| Go to current | hotkey ctrl+l from scrollTop 0: 3206, Song 50 centred (offset 0); the header's menu: the same |
| Arrow keys | ArrowDown from Song 49 to 55 across the NOW PLAYING, QUEUED BY YOU and AUTOPLAY captions and ArrowUp back: every step a song, fully in view |
| Selection | ctrl+a: 44 cells selected (11 rows x 4 columns), no caption; ctrl-click Song 49 and 51 across the Now playing caption, Delete: 80 -> 78, exactly those two gone |
| Search | captions still there at 100 ms (the 200 ms debounce), gone at 600 ms, back when cleared |
| Edge shapes | one song: NOW PLAYING; a stopped station with one kept row ahead: NOW PLAYING, QUEUED BY YOU 4, AUTOPLAY OFF, QUEUED BY YOU 6; empty: none; no station: EARLIER, NOW PLAYING, UP NEXT 7 |
| Remote 30, playing 2, served 5 to 29 | EARLIER, NOW PLAYING, QUEUED BY YOU 2, AUTOPLAY BLEND, Remote 2 centred; `remoteQueueIndex` 3: Queued by you 1, Remote 3 centred; back to local: the local groups |
| Captions' width | 0 to 360 of a 360 panel, the count's right edge at 346 (the board's 14 px); the same with duration moved to the first column |
| 5,000 songs, 120 scroll steps of 400 px (software rendering) | grouped: median 68 ms, p95 121, max 143; grouping off (a scratch flag, reverted): median 60, p95 123, max 139; jump to current: Song 2500 at offset 0 both ways |
| setQueue to paint, 5,000 songs | flagged tail: 403 ms grouped, 536 off; interleaved (about 2,500 runs after the playing row): 2370 grouped, 2768 off, so that cost is not the grouping's |

### The playing row and the captions (Task 6)

- Songs 48 px, captions 32 px (`rowHeights` [48], captions 32 each), the cover 40 x 40 in the playing row, no clipped cell content.
- The playing row: the accent container across all its cells, inset 4 px with radius 8; the equaliser glyph in its number cell. Glyph: paused no
  animation (bars at .55, 1, .75); the player status set to playing in the store: one animation per bar, moving; paused again: still; reduced motion:
  no animation while playing.
- A skip with follow-current off: scrollTop 400 kept, the row under the upper point (Song 9) kept; the Now playing caption moves 48 px down per skip.

**Contrast on rendered pixels**: text colour through a canvas, background from the screenshot inside each element's box, over `fixture:black`,
`fixture:grey25` and `fixture:split`, hues 40, 120 and 250 (`__coverWash.set({ hue, k: 1, meanL: 0.3 }, light)`), dark and light, autoplay on and off:
36 runs.

| Pair | Dark, lowest | Light, lowest |
|---|---|---|
| "Playing from" caption (on2) | 7.32 (grey25, h120) | 5.78 (black, h250) |
| Title (on) | 8.83 (grey25, h120) | 9.67 (black, h250) |
| Status line (on2) | 7.64 (grey25, h120) | 5.80 (black, h120) |
| Count line (on2) | 6.53 (split, h120) | 5.88 (black, h250) |
| Clear (on) | 7.78 (split, h120) | 9.82 (black, h40) |
| "Autoplay" label (on2) | 7.23 (grey25, h120) | 5.81 (black, h120) |
| Selected segment (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Unselected character | 6.26 (split, h120) | 7.82 (black, h40) |
| Unselected Up next / Related | 5.79 (split, h120) | 7.84 (black, h40) |
| Group captions (on2), lowest of the four | 6.81 (Earlier, split, h120) | 5.83 (Now playing, black, h250) |
| Caption trailing text (count, character) | 9.52 (black, h120) | 5.87 (black, h250) |
| Playing row title, artist, duration (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Glyph (non-text) | 6.17 | 8.01 |
| Switch thumb on its track (non-text), on / off | 6.17 / 5.18 | 8.01 / 4.68 |
| **Dimmed characters** (opacity .4 composited over the card) | **2.45** (split, h120) | **2.09** (black, h40) |
| **Switch track against the card** (non-text) | **1.29** (grey25, h120) | **1.00** (black, h120) |

Every text pair is 4.5 or more. The dimmed characters (expected, reported, not chased) and the switch's track against the card (the board's own
roles: `surf2` off, `accc` on) are under; the thumb against its track carries the state at 4.68 or more. **With `Cover colours` off** (default dark
theme): muted texts 6.77, the selected segment white on the primary 5.00, the switch track against the card 4.00; the playing row's title in the
primary on the tint measured 3.27 (3.64 on the plain row before F4), so the row's text now takes the foreground colour: 13.74.

### The sweep (Task 7)

- The board's four states, nothing playing and the fallback at 360 px (screenshots taken; compared with `QueueStates.jpg`). Differences: a muted
  status line under the title (kept from the chip row, addendum 9) that the board does not draw; the sentence is one line with an ellipsis where the
  board wraps it; no mood chips; hearts show only on hover or for favourites (the existing column) where the board draws one on every row; Autoplay
  off shows "Up next 2" where the board draws "Queued by you 2" (the plan's rule, addendum 21).
- Widths and windows: see the header table; 800 x 600 leaves about two and a half rows under the 236 px header.
- Beside F3's rail: hiding the panel shows the rail with "49 Up next"; showing it again restores the header and groups, **but the Up next / Related tab
  resets to Up next** (the tab state lives in the component that unmounts, as before F4).
- With the lyrics panel under it: header unchanged (236 px, nothing sticking out), 6 rows in view, "No lyrics found" in its own sub-panel.
- The vertical side-queue layout: the panel is 1024 x 320; nothing sticks out; **one song row in view** under the header.
- Keyboard: Tab from the header's start reaches the switch, the characters (one stop), Up next / Related (one stop), the search's text input, the
  search icon, `...`, Clear, then the table. Space toggles the switch both ways; ArrowRight inside the characters moves Blend -> Discover and taps it.
- Reduced motion: the dimming and the glyph stop (above). The sweep found Mantine's switch thumb slide (150 ms) and segment label colour fade (250 ms)
  running regardless; after the fix commit both are `transition: none` under reduced motion and the thumb has no in-between position. The search
  field's 0.3 s width transition is the existing `SearchInput` and still runs.

## Reasoned from code only (NOT VERIFIED)

- **The station engine's reply** to a character tap or the switch: rows swapped, the playing song uninterrupted, the hub's `stationEdits`. Watched
  only as far as the optimistic binding, the stored preference and the status line; the tap plan itself is the pure, tested `planChipTap`.
- **A real remote session**: the hub's `queueChanged`, a station driven by the phone (whose served ids are not this client's, so in reality its rows
  get no Autoplay group here, addendum 6.4); the remote groups above came from setting `served` by hand.
- **A real mouse drag** across a group header: not driven; reorders were made through the player store's `moveSelectedTo`.
- **The drawer and popover queues**: not opened (the player bar button tried was Play random); they still render the untouched
  `PlayQueueListControls` and `QueueSheetTabs`, which now take the `...` menu from the shared `QueueActionsMenu` with the same sections per tier.
- **Save to server / restore** in the new menu: hidden here (the stand-in has no server play queue); the items are the old ones, moved.
- The owner's own queues, saved-queue names and covers; audio; a real GPU (frame times above are software rendering); `prefers-color-scheme` changing
  while the app runs; light themes other than through the wash.

## Calls made beyond the plan

1. The dev handle also exposes `useAppStore` (panel width without a reload), beside the three stores addendum 25 names.
2. `servedIdsOf` in `station-store.ts`, shared by `readSnapshot` and `useQueueRows` (the plan asked for one helper).
3. A table prop `markActiveRow` (side queue only) carries `data-queue-active` and `data-queue-edge` onto the active row's cells.
4. The header turns off Mantine's switch and segment transitions under reduced motion (separate fix commit).
5. `QueueActionsMenu` comes with a `useQueueActions` hook and `queueTableConfig`, so the old toolbar's inline icons, its `...` menu and the new header
   share one set of handlers and one table-settings form.

## Rulings I made

See the appended section after the review: the ledger's `Ruling:` lines, in order, each with its cost if wrong.

## Open for the owner

1. **Mood chips and "All"** (F5 and the hub's mood catalogue): not built; the header has no gap for them.
2. **The collapsed "Lyrics and waveform" bar**: not built; the existing sub-panels stay, and they still paint `--theme-colors-background-alternate`
   on top of the card (two translucent layers with the wash on).
3. **"Earlier"** (not on the board), **"Queued by you" only beside an autoplay group**, and **Autoplay off showing "Up next"** where the board draws
   "Queued by you".
4. **Two toolbars now**: the side panel has search as the expanding icon, Clear, and everything else (with Table settings) behind `...`; the drawer,
   popover and Now Playing page keep the old toolbar.
5. **Off moved from the chip row to the switch** in the side panel only; the other three queue surfaces still show Off as a chip.
6. **The hub's labels** still say Close, Balanced, Explore (both clients map them).
7. **Looks to overrule**: the playing row with `Cover colours` off (primary tint, foreground text); the dimmed characters at 2.09 to 2.45; the
   switch's track against the card at 1.00 to 1.29 (the board's roles); the status line under the title, which the board does not draw; the header's
   height (236 px) leaving about two rows at 800 x 600 and **one row in the vertical layout**; the Up next / Related tab resetting when the panel is
   hidden and shown; the `SearchInput` width animation under reduced motion.
8. **Not verifiable here**: a real hub's station edits, a real mouse drag, a real remote session.

## Try this

- Panel 360 px, an album queue with a bound station: the four captions, the accent row; tap Discover, then the switch off and on.
- Panel 250 px: the count line drops the length; nothing sticks out.
- Scroll into the Autoplay group, tap a character: the list does not move.
- Skip a few songs with follow-current on: Now playing stays centred.
- Type in the queue's search: the captions go, and come back when cleared.
- Turn `Cover colours` off: the playing row becomes a primary tint with plain text.
- The vertical side-queue layout and an 800 x 600 window: how much queue is left under the header.
