# Results: R1, the cover colours off the tree

Plan: `PLAN-feishin-colour-ease-2026-10-27.md` (outside the repo, beside `AUDIT-feishin-f1-f7-2026-10-27.md`, whose A-01 and R1 it
implements). Branch `fix/colour-ease-2026-10-27`, local only, not pushed, not merged. Written 2026-10-28 on the workstation.

**Base.** `redesign/artist-and-album` at `2f807c48` (the F7 tip the owner runs). The branch was made with `git worktree add` in
`.worktrees/colour-ease/feishin`, not by switching the owner's checkout. Nothing here touches F2 to F7's other files: the commits
touch the cover wash only, so they can be cherry-picked onto `feat/redesign` later.

**Where it was measured.** This workstation's GPU (AMD iGPU, ANGLE over OpenGL, native Wayland, device scale 2, 60 Hz), production
builds (`electron-vite build`, Electron on `out/`) of the base and of the tip, each on its own scratch profile, window 1440 x 900 kept
on screen. Data: the VM's stand-in Navidrome through an ssh tunnel, behind a local proxy that answers `getCoverArt` with a solid
300 x 300 PNG whose colour is picked from the id by a hash out of eight (near-white `#f1eee6` and near-black `#16161a` among them),
and a 30-song stand-in playlist ordered so that the colour changes on every step and light/dark flips occur. Nothing was sent to the
real hub, the real lb-bot or the real Navidrome.

| Commit | Task |
|---|---|
| `969243a3` | 1. The colour change's numbers and layer rule as a pure core (`colour-change.ts`) |
| `a4c21d2b` | 2. The wash store carries the backdrop at once; the page's roles switch once |
| `0821e97e` | 3. The backdrop cross-fades on two pairs of layers; the `:root` colour transition is deleted (A-01, B-201) |
| `9879371c` | The switch moved from 150 ms to 60 ms, where the backdrop is half-way along its curve (Calls, 1) |
| (this) | 4. This note |

## Gates

| Check | Base (`2f807c48`) | Tip |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) / `tsconfig.node.json` | clean / clean | clean / clean |
| eslint and stylelint `--max-warnings=0`, every changed file (11) | - | clean |
| `vite build --config web.vite.config.ts` / `remote.vite.config.ts` | - | exit 0 / exit 0 |
| `electron-vite build` | exit 0 | exit 0 |
| Every harness under `src/` | 67 files, 935 pass, 0 fail | 69 files, 945 pass, 0 fail |
| `colour-change.harness.ts` (new) | - | 8 pass |
| `no-root-colour-transition.harness.ts` (new, a source guard) | - | 2 pass |
| `cover-roles.harness.ts` | 15 pass | 15 pass (the light veil percentages now read from `toneVars`) |
| Em dash on added lines | - | nothing |

Each new harness was seen failing first: `colour-change` on `ERR_MODULE_NOT_FOUND`; the guard on the base's `global.css` (both
cases); `rolesSwitchWhenTheBackdropIsHalfWay` at 150 ms (progress 0.922).

## The budget (production, this GPU)

Per real cover change (the bar's Next, a real mouse press), 6 per page, 700 ms measured after each; the budget is the plan's:
no frame over 33 ms, at most 1 dropped frame, style recalculation at most 60 ms, no custom-property transition.

| Page | | Dropped (median / max) | Worst frame | p95 | Style ms (median / max) | Script ms (median) |
|---|---|---|---|---|---|---|
| Home | base | 6.5 / 8 | 66.7 | 33.3 | 245 / 260 | 50 |
| | **tip** | **0 / 1** | **33.4** | 16.7 | **33 / 39** | 44 |
| Tracks | base | 7 / 8 | 33.4 | 33.4 | 261 / 274 | 50 |
| | **tip** | **1 / 1** | **33.4** | 16.7 | **39 / 40** | 55 |
| *The Long Players* | base | 10.5 / 13 | 50.1 | 33.4 | 270 / 278 | 54 |
| | **tip** | **1 / 1** | **33.4** | 16.8 | **47 / 50** | 52 |

Four of the six changes on each page flipped light and dark. **The tip meets the budget on every page.** The worst frame, 33.4 ms, is
two vsyncs: the one dropped frame the budget allows (frame intervals are quantised to 16.7 ms; nothing over 33.4 was seen).

A skip burst (five Nexts 120 ms apart, 1.5 s measured):

| Page | Base: dropped / style ms | Tip: dropped / style ms |
|---|---|---|
| Home | 27 / 744 | 0 / 127 |
| Tracks | 28 / 746 | 3 / 154 |
| *The Long Players* | 45 / 881 | 5 / 182 |

**The census** (`document.getAnimations()`, every animation that started in the 700 ms after one change):

| Page | `:root` custom-property transitions | Wash layer animations | Components' own `color` / `background-color` transitions |
|---|---|---|---|
| Home | base 22, tip **0** | tip 4 (opacity) | base 348, tip 47 |
| Tracks | base 19, tip **0** | tip 4 | base 223, tip 48 |
| *The Long Players* | base 22, tip **0** | tip 4 | base 463, tip 83 |

The tip's wash runs four opacity animations (tone and veil, front and back) plus the art's existing opacity transitions. The third
column is not the wash: Mantine buttons, item cards and titles carry their own `transition: color 200ms`, which fires once when their
colour switches. The plan's census line said "only opacity"; those component transitions are counted in the numbers above, which meet
the budget, so they stay (Calls, 4).

**Dev builds** (reported, not gated; same scenario): dropped median 15 / 23.5 / 24.5 (base) against 3.5 / 1 / 2 (tip) on Home /
Tracks / the artist page; style median 185 / 192 / 211 against 38 / 38 / 48 ms. The dev tip still shows long frames (up to 200 ms)
from React's development script work, as the audit found before the redesign.

## Watched running

- **The timing, production.** Frame by frame in the page (8 changes): the backdrop's front layer flips with the song, 24 to 32 ms
  after the press; the page's roles land 82 to 95 ms after that (the 60 ms timer plus the frame it lands in). Reduced motion
  (emulated `prefers-reduced-motion: reduce`, 4 changes): backdrop and roles in the same frame, zero wash animations.
- **Dev handle and real changes, dev build** (Task 2): backdrop in the first frame; roles 150 to 163 ms later at the time (150 ms
  then); `data-cover-wash-ease` never set. A cold reload: the roles and `data-cover-wash` are on `<html>` (2.9 s) before `main`
  first paints (5.1 s).
- **Nothing changes at rest.** Base and tip, the same five covers, on Home: the bar band, the page card, the top band and the sidebar
  sampled at the same points are **identical, channel for channel** (max difference 0). The bar's colour drawn in the veil matches
  the bar drawn on its own.
- **The light/dark flip's contrast, on rendered pixels** (the animations and the role timer frozen at T ms after the press, then a
  screenshot; WCAG ratio of the text against what is behind it):

  | T after Next | 30 | 60 | 75 | 90 | 120 | 180 | 300 |
  |---|---|---|---|---|---|---|---|
  | Artist title, dark to light | 9.73 | 8.42 | 5.72 | 5.73 | 5.85 | 6.02 | 7.38 |
  | Artist title, light to dark | 6.55 | 5.63 | 8.82 | 8.44 | 8.82 | 9.26 | 9.54 |
  | Bar song title, dark to light | 6.95 | **4.13** | 9.98 | 11.43 | 11.38 | 14.44 | 15.77 |
  | Bar song title, light to dark | 8.31 | 5.45 | 6.73 | 11.19 | 11.08 | 14.91 | 16.90 |

  The page title sits on the page card, which switches with the text, so it never dips below 5.6. The bar's text sits on the bar
  band, which fades with the backdrop: its one low frame is just before the switch (4.13 at 60 ms, dark to light). At the plan's
  150 ms the band was near-white under still-light text for about 90 ms (seen on the dev build before the change of Calls, 1).
- **Cover colours turned off 30 ms into a change** (dev): the only writes to `<html>` after it are the removals (every variable, then
  `data-cover-wash`), the wash leaves the DOM, and no switch lands later. Turned on again: the colours are there in the first frame,
  with no fade.
- **Scroll** (the audit's scenario, playback paused): base and tip both 0 dropped frames on Tracks, Albums and the artist page, and
  0 on Home; removing `will-change: transform` from `.wash` cost nothing measurable.

## Reasoned from code only (NOT VERIFIED)

- **Nothing playing, then a cover.** Clearing the queue crashes the renderer on the base as well (below, Found on the way), so the
  empty-queue path could not be walked on either build. The neutral backdrop was watched through the dev handle (Task 3 screenshots);
  the art staying hidden until the new cover decodes is the base's code, unchanged.
- **A remote session's song** (the hub): not walked. `useRemoteAwarePlayerSong` feeds the same hook and nothing here touches it.
- **The owner's real covers** (real artwork rather than solid colours), Windows and macOS compositors, other GPUs. The phone is n/a.
- **The skip burst's look.** A change in the middle of a fade holds the layer that was coming in under the new one, so an older
  colour never shows; the step this makes (from a mix of the two to the newer one, then the fade) was reasoned, not filmed.

## Calls made beyond the plan

1. **The switch is at 60 ms, not 150.** The plan's reason is "when the backdrop is half-way"; on `--fold-ease`
   (`cubic-bezier(0.3, 0.7, 0.2, 1)`) the backdrop is 53 % of the way at 60 ms and 92 % at 150 ms. Pinned by a harness that reads
   the curve from `global.css`, so changing the curve or the number without the other fails.
2. **The backdrop fades with Web Animations (`el.animate`, opacity only) rather than CSS transitions.** A change during a fade must
   start the new layer from 0 and hold the one that was coming in at full strength; with transitions the slot coming back to the front
   was still at opacity 1 in its hold, so the newest colour snapped in. Both run on the compositor.
3. **No `will-change: opacity` while moving.** A running opacity animation already gets its own layer; `data-moving` stays as the
   test hook.
4. **Components' own colour transitions stay** (the census's third column): they are within the budget, and removing them is a change
   to shared components beyond R1.
5. `.wash.light` (the artwork's opacity and white lift) follows the backdrop's mode, at once, instead of the page's (now delayed) mode.
6. The branch was made as a worktree rather than by `git switch` in the owner's checkout.

## Found on the way

- **Clearing the queue crashes the renderer** ("Too many re-renders" in `<BaseImage>`, caught by the root error boundary), on the
  base `2f807c48` as well as the tip; dev build, via the player store's `clearQueue()`. Production and the queue panel's own Clear
  button not tried. Backlog.
- In this Feishin, **Next resumes playback** when paused; a measurement that presses Next keeps the queue playing afterwards (the
  stand-in's one-to-two-second tracks then change the cover every second or so). The scroll runs above were taken paused.
- A fresh production profile needs one restart before playback works ("Discrepancies were found between the settings in the
  renderer and the main process"), and the player's buttons act on pointer events, so a script must press them with real input.

## Open for the owner

1. Is the switch at the backdrop's midpoint right to the eye, or should text and accent also cross-fade (the plan's Call 1
   alternative, a whole-window View Transition)? Among what switches is the open queue panel, whose near-opaque background is
   `--wash-bar`: a large surface that changes in one frame while the backdrop beside it fades (as do the release pills and Discover's
   row backgrounds, which also read `--wash-bar`).
2. The bar's one frame at 4.13:1 before a dark-to-light switch: acceptable, or switch the bar's text at 0 ms?
