# Results: F1, bottom bar and transfer pill

Plan: `PLAN-feishin-bottom-bar-2026-10-20.md` (kept outside the repo). Written 2026-10-20 at the end of the branch.

## Gates

| Check | Baseline (master) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint / stylelint, `--max-warnings=0`, every changed file | - | clean |
| `device-rows.harness.ts` | 21 pass | 21 pass |
| `device-arrivals.harness.ts` (new) | - | 16 pass |
| `device-control-state.harness.ts` (new) | - | 7 pass |
| `more-menu-items.harness.ts` (new) | - | 5 pass |

Harnesses are run by hand (`node --test <file>`); CI does not run them.

## Watched running

`electron-vite dev` under Xvfb, driven over CDP. There was no music server, and the real hub was not available, so a fake
hub stood in for it (a small WebSocket server speaking the `hello` / `welcome` / `devices` / `session` / `act` / `ack`
frames as `use-hub.tsx` reads them). The "Switch to" state needs a local song, so one was put into the player store
directly.

Measured (play-button centre minus bar centre, right cluster rows, elements past the bar's right edge, bar height):

| State | 800 | 1280 | 2560 |
|---|---|---|---|
| No hub | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 |
| Hub, icon only | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 |
| Transfer here | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 |
| Casting (Chromecast active) | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 | 0 px, 1 row, 0, 89 |
| Switch to Pixel 8 | 0 px, 1 row, 0, 89 (also at 1440) | not measured | not measured |

Also measured at 1100 and 1440 (no hub): 0 px. The right cluster's left edge did not move between states at any width.

Seen working:

- **Transfer here:** with Pixel playing, the pill reads "Transfer here" and the left block shows "Playing on Pixel 8" in the
  accent below the album. Clicking it sent `act transfer` with this computer's id as `target`.
- **Switch to:** Pixel offline for 16 s, then back: "Switch to Pixel 8" appeared. A volume-only `devices` rebroadcast did
  not remove it. Clicking it sent `act transfer {target: "pixel"}`. A fresh arrival was gone about 30 s later (polled with
  1-2 s of overhead per check, so to the second, not exactly). With Pixel hidden, the same arrival proposed nothing. With
  no local song, an arrival shows only the icon (the rule in `device-control-state.ts`).
- **Casting:** a Chromecast active: "Casting to Living room speaker with a very long name..." truncates, the device icon
  is in the accent.
- **The box:** opens upward from the pill, right edge over the device icon. First focus is the first device you can pick.
  Escape closes it and returns focus to the icon, also when focus has fallen to the page body. An outside click closes it.
  Each row's hide button is a real button named "Hide <device>" and draws its eye icon (it drew nothing before: a filled
  glyph with no fill).
- **More:** rows Sleep timer, Equalizer, Lyrics, Cast to a TV (DLNA), Playback options, Auto DJ, then Stop playback after
  a divider. Every panel opens, Back returns, Escape goes back to the list first and then closes. A sleep timer preset
  closes the panel and the row then shows "5:00" in the accent. Opening the DLNA panel starts discovery.
- **Narrow:** under 900 px the pill keeps only its icon. At 1180 px and under the volume slider folds into its icon: the
  first click opens the slider in a popover, later clicks mute and unmute.
- **Truncation:** a 120-character title and a 59-character device name truncate with an ellipsis; nothing wraps.
- **playerbarOpenDrawer on:** an empty spot of the bar opens the full-screen player (the control case); the device icon,
  a device row, More, a More row, Back, queue, heart and volume icon do not.
- **Reduced motion:** the box's and the label's transitions compute to 0 s.
- **Tab order** in the right cluster: device icon, queue, volume icon, volume slider, More.

## Reasoned from code only (NOT VERIFIED)

- **Radio mode:** no station was available. The radio cluster keeps RadioStop in the centre (same component as before);
  More's Stop calls `useRadioControls().stop` when a radio is active.
- **A hub reconnect proposes nothing:** the tracker resets on `connected = false` and treats the next snapshot as a
  baseline. Covered by the harness, not watched.
- **Hotkeys** (favourite, rating, queue, volume) after the move: the components that register them stay mounted (heart in
  the left block, rating and volume in the volume group, queue in the right cluster). Not pressed.
- **DLNA with real devices** and discovery with More closed: `useDlnaCast` is mounted by More whether or not it is open.
  Discovery was watched starting; no DLNA device was on the network.
- **A real Chromecast, the real hub, a transfer that completes a load** (the fake tracks cannot load), the Windows and
  macOS title-bar variants, 1920 x 1080.
- The rating above the volume: no Navidrome/Subsonic song was playing, so the stars never rendered.

## Calls made beyond the plan

1. **Shuffle all stays in the transport** (the owner asked during the work). Stop still moves to More. So that play stays
   centred with Shuffle all unpaired on the right, the transport is its own three-column grid (left buttons | play | right
   buttons).
2. **The volume slider keeps the existing "Volume width" setting** (default 70 px) as its fixed, non-shrinking width,
   instead of the board's 96 px, so that setting does not go dead. Say if 96 px should win.
3. **The narrow-width volume popover holds a horizontal slider:** Mantine's slider has no vertical mode.
4. **Small structure changes:** `toggleLyrics` is in `player/utils/toggle-lyrics.ts` and `RatingButton` / `VolumeButton`
   live in `volume-group.tsx`, to avoid import cycles with `right-controls.tsx`. `sleep-timer-button.tsx` became
   `sleep-timer-panel.tsx` (its `SleepTimerHook` moved with it); the panel ticks while mounted instead of taking an
   `opened` prop. `DeviceRowsList` takes no props (the old menu never closed on a row click either).
5. Equaliser reuses the existing `setting.equalizer` key ("Equalizer"); Auto DJ reuses `setting.autoDJ`.
6. The tracker gained `expiresAt(id)` so the hook schedules its one re-render at the exact expiry.
7. A device seen offline in the first snapshot and online soon after is not proposed (its real absence is unknown).
