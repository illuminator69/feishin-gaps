import { useEffect, useMemo, useRef } from 'react';

import styles from './visualizer.module.css';

import { TrackMood } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { useWebAudio } from '/@/renderer/features/player/hooks/use-webaudio';
import { getVisualizerAudioNodes } from '/@/renderer/features/player/utils/get-visualizer-audio-nodes';
import { openVisualizerSettingsModal } from '/@/renderer/features/player/utils/open-visualizer-settings-modal';
import { ComponentErrorBoundary } from '/@/renderer/features/shared/components/component-error-boundary';
import { useTrackMood } from '/@/renderer/features/visualizer/hooks/use-track-mood';
import { usePlaybackType, usePlayerSong } from '/@/renderer/store';
import {
    useFullScreenPlayerStore,
    useFullScreenPlayerStoreActions,
} from '/@/renderer/store/full-screen-player.store';
import { usePlayerStatus } from '/@/renderer/store/player.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';
import { PlayerStatus } from '/@/shared/types/types';

const FFT_SIZE = 1024;
const FIELD_MAX_SIZE = 288;
const FIELD_MIN_SIZE = 150;
const CONTOUR_POINTS = 120;
const FRAME_INTERVAL_MS = 1000 / 30;
const PAUSED_FRAME_INTERVAL_MS = 1000 / 4;
const VISUALIZER_DEBUG_MODE = 'off' as 'bloom' | 'field' | 'off';

// Step 1 target: bounded glowing object on black.
// Step 2 target: remove the Siri-like center stroke and replace it with broad
// internal lava folds blended into the metaball material.
// Step 3 target: make the outer silhouette less like a smooth oval and more like
// a living blob with soft protrusions, haze, and tendril-like edge motion.
// Step 4 target: add internal depth so the material feels like colored gel.
// Step 5 target: replace fixed two-panel color territories with smaller mood-based
// color islands that drift through the material.
// Step 6 target: remove paneling entirely by using metaballs mostly as the shape
// field and coloring the material with turbulent mood-based marble instead of
// large spatial territories.
// Step 7 target: fix tonemapping/saturation so the blob is less pastel and less
// pillow-like, with a smaller bright core and more preserved neon chroma.
// Step 8 target: stop bloom/pass compositing from washing colors to white by
// darkening the source material, capping luminance, and drawing the final body
// with source-over instead of stacking every pass with screen.
// Step 9 target: clean up muddy/swamp-like color mixing and remove the remaining
// faint horizontal/vertical internal bands.
// Step 10 target: make the silhouette more kinetic and audio-responsive with
// independent soft lobes, while keeping edges blurry rather than spiky.
// Step 11 target: slightly reduce saturation while preserving the current motion,
// silhouette, and anti-white tonemapping.
// Step 12 target: localize bloom to bright/high-energy parts of the blob instead
// of blurring the whole field uniformly.
// Step 13 target: keep mood-based colors but force role separation, so the blob
// always contains multiple color families instead of collapsing into one hue.
// Step 14 target: replace near-black internal valleys with saturated translucent
// colored shadows, so depth feels like gel instead of a cavern.
// Step 15 target: remove remaining dark internal voids by adding a soft structural
// gel-fill field through the center of the blob.
// Step 16 target: keep the Yandex-like warm/pink/purple/green color scaffold intact
// while letting song mood bias the roles, so cold songs cannot collapse the blob
// into one blue/cyan family.
// Step 17 target: add a compact warm emissive core and a smaller rose fold
// inside the existing material pass, restoring the reference-like hot region
// without changing geometry or washing the full body to white.
// Step 18 target: make the turbulent marble roles win locally instead of
// averaging every hue everywhere, so the blob has liquid color islands without
// returning to large two-panel territories.
// Step 19 target: add a soft edge-fuzz/tendril emission layer driven by the
// existing field and bloom pipeline, without drawing sharp lines or changing
// the geometry.
// Step 20 target: give bloom its own dedicated emission source from hot core,
// rose fold, chromatic material pockets, and edge fuzz instead of deriving
// bloom only from the already-tonemapped body canvas.
// Step 21 target: strengthen internal material advection so the color islands
// feel kneaded under the surface while the silhouette/geometry remains stable.
// Step 22 target: slightly intensify that material-only kneading/flow while
// still leaving the metaball field, silhouette, and track-switch geometry stable.
// Step 23 target: tune the final silhouette proportions after material/bloom work:
// make the object a little more compact and less horizontally pillow-like while
// keeping the same stable metaball renderer and audio behavior.
// Step 24 target: strengthen the warm internal emissive structure so the blob is
// lit by a clearer yellow/orange core and a smaller pink-red companion fold,
// closer to the reference's hot interior without washing to white.
// Step 25 target: add translucent warm light wrapping around that hot core so
// nearby red/pink material feels lit from inside rather than painted on top,
// while keeping shadows colored and the final body pass source-over.
// Step 26 target: break up broad internal color boundaries with turbulent
// erosion and smoky transition fields so the blob keeps separated hues without
// reading as large soft painted panels.
// Step 27 target: strengthen the soft edge fuzz and outward haze so the
// silhouette feels more frayed, vaporous, and bloom-driven, closer to the
// reference, while still avoiding sharp spikes or stroked lines.
// Step 28 target: fix the rectangular notch by using true transparent pixels
// for off-object field/emission areas, then add broad soft internal luminous
// folds as material-field masks, not stroked lines.
// Step 29 target: complete the notch fix by making the offscreen field/bloom
// canvases alpha-aware. v8.28 wrote transparent pixels, but alpha:false contexts
// flattened them back onto black before scaling/compositing.
// Step 30 target: isolate the visualizer layout from the theme overlay CSS.
// Use a root/stage split so the canvas is a dedicated black render layer rather
// than sharing the same .container class/pseudo-element as the outer controls.
// Step 31 target: remove the remaining left-side hard bite by allowing edge
// haze/tendril pixels to survive outside the dense object envelope, adding a
// small field-level continuity fill on the left boundary, and drawing a soft
// body underpaint behind the main object.
// Step 32 target: replace ad-hoc artifact handling with a general soft alpha
// continuity pass on the low-res body/emission buffers, filling tiny boundary
// gaps from neighboring pixels instead of predicting where a notch may appear.
// Step 33 target: strengthen the central yellow emission core so the blob reads
// first as a hot light source, with pink/orange material wrapped around it.

type AudioLevels = {
    adaptiveGain: number;
    bass: number;
    hat: number;
    highs: number;
    kick: number;
    mids: number;
    previousBass: number;
    previousTreble: number;
    treble: number;
};

type BlobPalette = {
    accent: number;
    core: number;
    edge: number;
    glow: number;
    mid: number;
};

type BlobRole = 'orange' | 'yellow' | keyof BlobPalette;

type LavaBlob = {
    angle: number;
    angularVelocity: number;
    baseRadius: number;
    colorRole: BlobRole;
    homeRadius: number;
    phase: number;
    satellite: boolean;
    strength: number;
    stretch: number;
    vx: number;
    vy: number;
    x: number;
    y: number;
};

type RenderBlob = LavaBlob & {
    radius: number;
    rgb: [number, number, number];
    rotation: number;
};

type RenderBuffers = {
    body: ImageData;
    emission: ImageData;
};

const BASE_PALETTE: BlobPalette = {
    accent: 54,
    core: 318,
    edge: 146,
    glow: 286,
    mid: 18,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = clamp((x - edge0) / Math.max(0.000_01, edge1 - edge0), 0, 1);

    return t * t * (3 - 2 * t);
};

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360;

const lerpHue = (from: number, to: number, amount: number) => {
    const delta = ((((to - from) % 360) + 540) % 360) - 180;

    return wrapHue(from + delta * amount);
};

const hueDelta = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

const smoothLevel = (current: number, target: number, attack: number, release: number) =>
    current + (target - current) * (target > current ? attack : release);

const averageRange = (data: Uint8Array, start: number, end: number) => {
    let sum = 0;
    const safeEnd = Math.min(end, data.length);

    for (let i = start; i < safeEnd; i += 1) {
        sum += data[i];
    }

    return sum / Math.max(1, safeEnd - start) / 255;
};

const peakRange = (data: Uint8Array, start: number, end: number) => {
    let peak = 0;
    const safeEnd = Math.min(end, data.length);

    for (let i = start; i < safeEnd; i += 1) {
        peak = Math.max(peak, data[i]);
    }

    return peak / 255;
};

// Genre/mood keyword + BPM → palette. Shared by the metadata heuristic and the
// AudioMuse top_genre fallback so the buckets aren't duplicated.
const paletteFromKeywords = (words: string, bpm: number, loved: boolean): BlobPalette => {
    if (
        words.match(/ambient|classical|piano|sleep|drone|chill|lofi|lo-fi|downtempo|meditation/) ||
        (bpm > 0 && bpm < 88)
    ) {
        return { accent: 190, core: 218, edge: 166, glow: 258, mid: 292 };
    }

    if (words.match(/metal|industrial|punk|hardcore|noise|goth|doom|dark|rock/) || bpm >= 155) {
        return { accent: 34, core: 350, edge: 286, glow: 318, mid: 14 };
    }

    if (words.match(/jazz|soul|r&b|rnb|funk|folk|acoustic|country|blues|singer/)) {
        return { accent: 42, core: 22, edge: 326, glow: 286, mid: 352 };
    }

    if (words.match(/electronic|dance|house|techno|trance|edm|club|disco|synth/) || bpm >= 122) {
        return { accent: 58, core: 304, edge: 172, glow: 214, mid: 324 };
    }

    if (loved || words.match(/pop|happy|summer|dream|love|party/)) {
        return { accent: 54, core: 324, edge: 188, glow: 286, mid: 22 };
    }

    return BASE_PALETTE;
};

const paletteFromSong = (song: ReturnType<typeof usePlayerSong> | undefined): BlobPalette => {
    const words = [
        song?.name,
        song?.album,
        song?.artistName,
        ...(song?.genres?.map((genre) => genre.name) ?? []),
        ...Object.values(song?.tags ?? {}).flat(),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const bpm = song?.bpm ?? 0;
    const loved = Boolean(song?.userFavorite) || (song?.userRating ?? 0) >= 4;

    return paletteFromKeywords(words, bpm, loved);
};

// Mood-label → hue anchors (matched by substring against AudioMuse mood-vector keys,
// which vary by taxonomy). Used for the weighted circular mean below.
const MOOD_HUE: Array<[RegExp, number]> = [
    [/happy|joy|uplift|cheer|bright|fun/, 52],
    [/energetic|energy|power|epic|driving|intense/, 32],
    [/aggress|angry|tense|fierce|heavy/, 8],
    [/sad|melanchol|depress|sorrow|lonely/, 222],
    [/calm|peace|relax|ambient|chill|mellow|soft/, 196],
    [/dark|gloom|ominous|brooding|mysterious/, 276],
    [/roman|love|tender|sensual|warm/, 330],
    [/party|dance|club|groov|disco|funky/, 300],
    [/dream|ethereal|atmospher|spacey/, 258],
    [/acoustic|folk|organic|earthy/, 36],
];

const moodHue = (label: string): number | undefined => {
    const l = label.toLowerCase();
    for (const [re, hue] of MOOD_HUE) {
        if (re.test(l)) return hue;
    }
    return undefined;
};

// Real AudioMuse sonic mood → palette. Weighted circular mean of recognized mood
// labels gives a dominant hue (avoids the 350°/10° averaging bug); the 5 slots are
// spread from it so deriveSeparatedRoleHues keeps its role hierarchy. Falls back to
// top_genre via the keyword buckets, or null when nothing is usable.
const paletteFromMood = (mood: TrackMood): BlobPalette | null => {
    const vec = mood.moodVector;
    let dominant: number | undefined;

    if (vec && !Array.isArray(vec) && typeof vec === 'object') {
        let sumX = 0;
        let sumY = 0;
        for (const [label, weight] of Object.entries(vec)) {
            const w = Number(weight);
            const hue = moodHue(label);
            if (hue === undefined || !Number.isFinite(w) || w <= 0) continue;
            const rad = (hue * Math.PI) / 180;
            sumX += Math.cos(rad) * w;
            sumY += Math.sin(rad) * w;
        }
        if (sumX !== 0 || sumY !== 0) {
            dominant = wrapHue((Math.atan2(sumY, sumX) * 180) / Math.PI);
        }
    }

    if (dominant === undefined) {
        return mood.topGenre ? paletteFromKeywords(mood.topGenre.toLowerCase(), 0, false) : null;
    }

    // Step 35: mood-driven core color. `core` carries the song's actual dominant hue, so
    // the renderer's primary color (and the bright core light derived from it) follows the
    // mood — it can be warm-white for a warm track or fully green for a green one. The
    // other slots are kept tinted toward the dominant for the blob tint / fallback paths;
    // the 2-color renderer derives its real second color from `core` + a forced gap.
    const tint = (anchor: number, amount: number) => lerpHue(anchor, dominant, amount);

    return {
        accent: tint(BASE_PALETTE.accent, 0.3),
        core: dominant,
        edge: tint(BASE_PALETTE.edge, 0.2),
        glow: tint(BASE_PALETTE.glow, 0.34),
        mid: tint(BASE_PALETTE.mid, 0.28),
    };
};

const hslToRgb = (hue: number, saturation: number, lightness: number): [number, number, number] => {
    const h = wrapHue(hue) / 360;
    const s = clamp(saturation, 0, 1);
    const l = clamp(lightness, 0, 1);

    if (s === 0) return [l, l, l];

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const channel = (offset: number) => {
        let t = h + offset;

        if (t < 0) t += 1;
        if (t > 1) t -= 1;

        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;

        return p;
    };

    return [channel(1 / 3), channel(0), channel(-1 / 3)];
};

const createBlob = (index: number, count: number, satellite = false): LavaBlob => {
    const angle = (Math.PI * 2 * index) / count;
    const bodyRoles: BlobRole[] = [
        'yellow',
        'core',
        'orange',
        'glow',
        'edge',
        'core',
        'mid',
        'accent',
        'orange',
    ];
    const satelliteRoles: BlobRole[] = [
        'edge',
        'glow',
        'yellow',
        'core',
        'orange',
        'accent',
        'edge',
    ];

    return {
        angle,
        angularVelocity: (satellite ? 0.000_08 : 0.000_055) * (index % 2 === 0 ? 1 : -1),
        // Step 41: larger + clustered near centre so the blobs FUSE into one coherent mass
        // (which the turbulent warp then folds), instead of orbiting out as separate drops.
        baseRadius: satellite ? 0.22 + (index % 3) * 0.018 : 0.3 + (index % 4) * 0.022,
        colorRole: satellite
            ? satelliteRoles[index % satelliteRoles.length]
            : bodyRoles[index % bodyRoles.length],
        homeRadius: satellite ? 0.16 + (index % 3) * 0.025 : 0.04 + (index % 4) * 0.022,
        phase: index * 1.713 + (satellite ? 4.2 : 0),
        satellite,
        strength: satellite ? 0.72 : 1,
        stretch: satellite ? 1.08 + (index % 3) * 0.06 : 1.02 + (index % 4) * 0.04,
        vx: 0,
        vy: 0,
        x: 0.5,
        y: 0.5,
    };
};

const updateBlobPhysics = (
    blobs: LavaBlob[],
    frequencyData: Uint8Array,
    time: number,
    dt: number,
    bass: number,
    mids: number,
    highs: number,
    kick: number,
) => {
    blobs.forEach((blob, index) => {
        const bandIndex = Math.floor((index / blobs.length) * frequencyData.length);
        const localEnergy = Math.pow(frequencyData[bandIndex] / 255, 0.72);
        const satelliteBoost = blob.satellite ? 1.55 : 1;
        const orbitAudio =
            mids * 0.052 + bass * 0.038 + kick * 0.035 + localEnergy * 0.022 * satelliteBoost;

        blob.angle += blob.angularVelocity * dt * (1 + mids * 0.4 + highs * 0.2 + kick * 0.35);

        // Step 41: tighter orbit drift — the blobs stay clustered as one mass (the warp does
        // the deforming), so they fuse instead of orbiting out as separate drops.
        const orbit =
            blob.homeRadius +
            Math.sin(time * 0.000_22 + blob.phase) * 0.03 +
            Math.sin(time * 0.000_13 + blob.phase * 1.7) * 0.018 +
            orbitAudio * 0.6;

        const targetX =
            0.5 +
            Math.cos(blob.angle + Math.sin(time * 0.000_18 + blob.phase) * 0.55) *
                orbit *
                (0.72 + Math.sin(time * 0.000_11 + blob.phase) * 0.07) +
            Math.sin(time * 0.000_16 + blob.phase * 2.4) * (0.045 + mids * 0.03);

        const targetY =
            0.5 +
            Math.sin(blob.angle * 0.92 + Math.cos(time * 0.000_15 + blob.phase) * 0.5) *
                orbit *
                (0.68 + Math.cos(time * 0.000_1 + blob.phase) * 0.075) +
            Math.cos(time * 0.000_14 + blob.phase * 1.3) * (0.04 + bass * 0.03);

        const cohesion = blob.satellite ? 0.025 : 0.018;

        blob.vx += (targetX - blob.x) * cohesion;
        blob.vy += (targetY - blob.y) * cohesion;

        // Step 39: gentle slow convection (halved + de-beated) so it drifts like heavy
        // fluid instead of jerking on every transient.
        blob.vx +=
            Math.sin(time * 0.000_36 + blob.phase) *
            (0.000_2 + bass * 0.000_3 + kick * 0.000_26) *
            dt;
        blob.vy +=
            Math.cos(time * 0.000_33 + blob.phase * 1.65) *
            (0.000_18 + mids * 0.000_26 + kick * 0.000_2) *
            dt;

        // Beat impulse: a soft nudge along the orbit, not a snap.
        blob.vx += Math.cos(blob.angle) * kick * 0.0026 * satelliteBoost;
        blob.vy += Math.sin(blob.angle) * kick * 0.002 * satelliteBoost;

        blob.vx *= 0.88;
        blob.vy *= 0.88;

        blob.x = clamp(blob.x + blob.vx * dt, 0.08, 0.92);
        blob.y = clamp(blob.y + blob.vy * dt, 0.1, 0.9);

        if (!Number.isFinite(blob.x) || !Number.isFinite(blob.y)) {
            blob.x = 0.5;
            blob.y = 0.5;
            blob.vx = 0;
            blob.vy = 0;
        }
    });
};

// Step 45: audio-reactive spring-membrane contour. The perimeter is a ring of control points
// (radial offsets r[i] with velocities v[i]). Each point is driven OUTWARD by the audio in its
// own frequency band (so different sectors react independently) and a global kick burst, then a
// spring pulls it back with low damping → it overshoots and recoils (springy, elastic). Weak
// neighbor tension makes deformations travel around the ring like a membrane wave, while still
// allowing sharp local spikes. Quiet → everything settles back to a compact mass.
type ContourState = { r: Float32Array; v: Float32Array };

const createContour = (): ContourState => ({
    r: new Float32Array(CONTOUR_POINTS),
    v: new Float32Array(CONTOUR_POINTS),
});

const updateContour = (
    state: ContourState,
    frequencyData: Uint8Array,
    time: number,
    dt: number,
    bass: number,
    mids: number,
    highs: number,
    treble: number,
    kick: number,
    playing: boolean,
) => {
    const n = CONTOUR_POINTS;
    const { r, v } = state;
    const dtn = clamp(dt / 16.67, 0.5, 2.5);

    if (!playing) {
        // decay back to a compact mass when paused
        for (let i = 0; i < n; i += 1) {
            v[i] *= 0.78;
            r[i] *= 0.88;
        }
        return;
    }

    // Step 46: springier, more reactive membrane. Stronger spring + lower damping → fast
    // outward acceleration, visible overshoot and snap-back recoil. Low neighbor tension so
    // adjacent points stay fairly INDEPENDENT (many narrow spikes, not a few broad bulges).
    // Step 48: explosive elastic membrane. Strong spring + low damping → fast outward punch,
    // overshoot, snap-back recoil. TWO LAYERS: large rotating primary lobes (mids) that bend
    // the whole membrane in AND out, plus sharp transient spikes (highs/band) riding on top.
    // The audio→sector mapping ROAMS (rotates over time) so protrusions are never locked to one
    // side — they emerge anywhere, stretch, recoil and vanish.
    const stiffness = 0.2;
    const damp = 0.74;
    const tension = 0.04;
    const bins = frequencyData.length;
    const rot = time * 0.000_1; // roving: rotates the audio→sector mapping
    const lobeRot = time * 0.000_16; // large lobes slowly rotate around the ring
    const breath = bass * 0.08;

    for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2;
        // roving spectral sample so the loud sectors drift around (no fixed snout)
        const swept = (i / n + rot) % 1;
        const bin = clamp(Math.floor(swept * bins * 0.55) + 2, 0, bins - 1);
        const band = Math.pow((frequencyData[bin] || 0) / 255, 1.05);
        // LARGE primary lobes — few, rotating, push the membrane OUT and pull it IN
        const largeLobe =
            (mids * 0.5 + bass * 0.18) * Math.sin(angle * 3 - lobeRot * 3) +
            mids * 0.32 * Math.sin(angle * 5 + lobeRot * 2 + 1.0);
        // SHARP transient spikes — thin, roving, high-frequency
        const spikePush =
            band * (0.8 + treble * 1.1 + highs * 0.6) +
            kick * 0.7 * Math.pow(0.5 + 0.5 * Math.sin(angle * 9 - rot * 40 + bass * 6), 2);
        const target = breath + largeLobe + spikePush;
        const left = r[(i - 1 + n) % n];
        const right = r[(i + 1) % n];
        const lap = left + right - 2 * r[i];
        v[i] += ((target - r[i]) * stiffness + lap * tension) * dtn;
        v[i] *= Math.pow(damp, dtn);
        r[i] += v[i] * dtn;
        if (r[i] < -0.3) {
            r[i] = -0.3; // sectors can collapse inward (star/flower silhouette)
            v[i] *= -0.3;
        } else if (r[i] > 1.15) {
            r[i] = 1.15;
            v[i] *= -0.3;
        }
    }
};

// Smoothly sample the contour radial offset at an arbitrary angle (Catmull-Rom-ish via cubic
// smoothstep between the two nearest control points keeps spikes crisp but not faceted).
const sampleContour = (r: Float32Array, theta: number) => {
    const n = r.length;
    const f = ((theta + Math.PI) / (Math.PI * 2)) * n;
    const i0 = ((Math.floor(f) % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const frac = f - Math.floor(f);
    const t = frac * frac * (3 - 2 * frac);
    return r[i0] + (r[i1] - r[i0]) * t;
};

const renderMetaballField = (
    ctx: CanvasRenderingContext2D,
    bloomCtx: CanvasRenderingContext2D,
    buffers: RenderBuffers,
    blobs: LavaBlob[],
    contour: Float32Array,
    palette: BlobPalette,
    frequencyData: Uint8Array,
    width: number,
    height: number,
    time: number,
    bass: number,
    mids: number,
    highs: number,
    treble: number,
    hat: number,
    kick: number,
) => {
    if (width <= 1 || height <= 1) return;

    const aspect = width / height;
    const image = buffers.body;
    const emissionImage = buffers.emission;
    const data = image.data;
    const emissionData = emissionImage.data;

    data.fill(0);
    emissionData.fill(0);
    const energy = bass * 0.42 + mids * 0.32 + highs * 0.16 + treble * 0.06 + kick * 0.12;

    // Step 34: strong transients round the silhouette toward a reference-like sun.
    const beatRound = smoothstep(0.45, 1.05, energy);

    // Step 40: analogous ramp (green→violet), rotated as a whole by the song mood. Each
    // blob draws a hue from this ramp; per pixel the overlapping blobs' light is SUMMED
    // (additive), so coloured masses stack and brighten like the reference's layered lights.
    const primaryHue = palette.core;
    const moodOffset = hueDelta(60, primaryHue);
    const RAMP_T = [0.0, 0.2, 0.4, 0.58, 0.78, 1.0];
    const RAMP_H = [100, 60, 38, 8, 332, 286];
    const RAMP_S = [0.8, 0.92, 0.96, 0.92, 0.86, 0.8];
    const RAMP_L = [0.34, 0.34, 0.33, 0.32, 0.31, 0.3];
    const sampleRamp = (tt: number): [number, number, number] => {
        const tc = clamp(tt, 0, 1);
        let s = 0;
        while (s < RAMP_T.length - 2 && tc > RAMP_T[s + 1]) s += 1;
        const f = clamp((tc - RAMP_T[s]) / Math.max(0.0001, RAMP_T[s + 1] - RAMP_T[s]), 0, 1);
        return hslToRgb(
            lerpHue(RAMP_H[s], RAMP_H[s + 1], f) + moodOffset,
            RAMP_S[s] + (RAMP_S[s + 1] - RAMP_S[s]) * f,
            RAMP_L[s] + (RAMP_L[s + 1] - RAMP_L[s]) * f,
        );
    };
    const midRampRgb = sampleRamp(0.45);

    const renderBlobs: RenderBlob[] = blobs.map((blob, index) => {
        const bandIndex = Math.floor((index / blobs.length) * frequencyData.length);
        const localEnergy = Math.pow(frequencyData[bandIndex] / 255, 0.68);
        const radius =
            blob.baseRadius *
            (1 +
                bass * 0.2 +
                mids * 0.1 +
                localEnergy * (blob.satellite ? 0.32 : 0.18) +
                kick * 0.18);

        // Step 40: each blob's hue spans the full analogous ramp (so many colours show at
        // once), ordered warm→cool by index — body blobs warm (they orbit centrally → hot
        // core), satellites cool (outer → violet edge); slow drift breathes the hues.
        const localFrac = blob.satellite ? clamp((index - 9) / 6, 0, 1) : clamp(index / 8, 0, 1);
        const tHue = clamp(
            (blob.satellite ? 0.5 + localFrac * 0.48 : localFrac * 0.5) +
                Math.sin(time * 0.000_06 + blob.phase * 1.3) * 0.1,
            0,
            1,
        );
        const rgb = sampleRamp(tHue);

        return {
            ...blob,
            radius,
            rgb,
            rotation: blob.angle * 0.42 + Math.sin(time * 0.000_19 + blob.phase) * 0.45,
            strength:
                blob.strength *
                (1 + localEnergy * 0.28 + (blob.satellite ? highs * 0.16 : mids * 0.12)),
        };
    });

    for (let y = 0; y < height; y += 1) {
        const ny = y / Math.max(1, height - 1) - 0.5;

        for (let x = 0; x < width; x += 1) {
            const nx = (x / Math.max(1, width - 1) - 0.5) * aspect;

            // Step 1: bounded object coordinates.
            // v8 rendered as a full-screen field. The Yandex reference is a central object.
            // This transforms screen coordinates into a smaller "blob space" and creates
            // a soft oval envelope so the blob has a readable silhouette and black margins.
            // Step 48: compact core with lots of margin so big spikes fit; bass only breathes.
            const objectScale = 2.75 - bass * 0.04 - beatRound * 0.02;
            const ox = nx * objectScale * 1.02;
            const oy = ny * objectScale;

            // Step 3: contour-deformed blob silhouette.
            // The Yandex reference has a soft but irregular outline with lobes/tendrils.
            // We keep the bounded object from step 1, but break the perfect oval.
            const theta = Math.atan2(oy, ox);
            // Step 48: directional squash/stretch so the CORE is not a fixed oval — it
            // squashes and stretches per-angle with bass/mids and slowly turns over time.
            const coreSquash =
                1 +
                bass * 0.18 * Math.cos(theta * 2 - time * 0.000_25) +
                mids * 0.11 * Math.sin(theta * 3 + time * 0.000_2);
            const radialBase =
                Math.sqrt(Math.pow(ox / 0.6, 2) + Math.pow(oy / 0.52, 2)) / coreSquash;

            // Step 37: more organic, asymmetric silhouette. Round 4 over-trimmed the
            // deformation (too calm/symmetric); restore it to ~75% of the marble-era
            // amplitude and speed the lobe drift so the outline morphs unpredictably while
            // staying soft (no spikes).
            const contourNoise =
                Math.sin(theta * 3.0 + time * 0.000_42) * 0.044 +
                Math.sin(theta * 5.0 - time * 0.000_31 + Math.sin(theta * 2.4)) * 0.03 +
                Math.cos(theta * 2.0 + time * 0.000_24) * 0.022;

            // Step 45: the silhouette is driven by the audio-reactive SPRING-MEMBRANE contour.
            // `spike` is the per-angle radial offset sampled from the spring ring — sharp
            // protrusions where a control point sprang outward, dents where it pulled in,
            // with spring overshoot/recoil and travelling membrane waves. The body bulges
            // moderately with it; the full reach also emits a thin glowing ray (below).
            const spike = sampleContour(contour, theta);
            const audioRipple =
                Math.sin(theta * 7.0 + time * 0.00085) *
                Math.sin(theta * 2.0 - time * 0.00031) *
                (0.008 + treble * 0.012 + hat * 0.01);

            // Step 48: the spring contour fully owns the perimeter — large rotating lobes +
            // sharp transient spikes (and inward dents where it collapses). Broad noise minimal.
            const contourOffset = contourNoise * 0.08 + spike * 0.62 + audioRipple * 0.35;

            // Step 47: TIGHT silhouette edge. A wide envelope transition blurred every spring
            // spike into a soft round bump; a narrow transition makes the contour read crisp
            // and jagged so the many small protrusions/dents/needles actually show.
            const envelopeRadius = radialBase - contourOffset;
            const objectEnvelope = 1 - smoothstep(0.93, 1.05, envelopeRadius);

            // Separate softer outer haze/tendril envelope. This is secondary and should
            // fade into black, not become hard spikes.
            const tendrilEnvelope =
                1 -
                smoothstep(0.82, 1.26, envelopeRadius - contourNoise * 0.65 - audioRipple * 1.4);

            // Step 45: thin glowing spike RAY — the outer reach of a sprung-out point emits a
            // soft radial light ray (god-ray) beyond the body edge, strongest at sharp spikes,
            // fading to the tip. Lives outside the dense body, so it's written in the guard.
            const spikeReach = Math.max(0, spike);
            // long tapered needle rays from the biggest spikes (capped for frame margin)
            const rayOuter = 1.0 + Math.min(spikeReach, 0.85) * 1.7;
            const spikeRay =
                smoothstep(0.94, 1.03, radialBase) *
                Math.pow(1 - smoothstep(1.0, rayOuter, radialBase), 1.4) * // tapered needle
                smoothstep(0.06, 0.22, spikeReach) * // only the bigger spikes emit long rays
                (0.6 + treble * 0.7 + highs * 0.5 + kick * 0.7);

            // Step 44: CURL-NOISE warp (divergence-free) — the dough-folding motion. The
            // displacement is the curl of a sum of sinusoidal potentials: per octave at
            // frequency f, (cx,cy) = (sin(f·ox+φ1)·cos(f·oy+φ2), −cos(f·ox+φ1)·sin(f·oy+φ2)),
            // which is area-preserving (∂cx/∂ox+∂cy/∂oy = 0). So it SWIRLS/SHEARS and folds
            // sheets of material over each other into winding S-curve tongues — instead of the
            // compressive sine-sum warp, which inflated/deflated regions into two pulsing
            // lobes. Three octaves of slowly-drifting vortices → continuous, never-repeating
            // folding. Slow time rates (gentle per-octave increase); only a tiny beat breath.
            const wt = time;
            const p1a = wt * 0.000_16;
            const p1b = wt * 0.000_13;
            let cx = Math.sin(ox * 3.1 + p1a) * Math.cos(oy * 3.1 + p1b);
            let cy = -Math.cos(ox * 3.1 + p1a) * Math.sin(oy * 3.1 + p1b);
            const p2a = 1.7 + wt * 0.000_24;
            const p2b = 4.2 - wt * 0.000_2;
            cx += 0.5 * Math.sin(ox * 6.3 + p2a) * Math.cos(oy * 6.3 + p2b);
            cy += -0.5 * Math.cos(ox * 6.3 + p2a) * Math.sin(oy * 6.3 + p2b);
            const p3a = 3.4 - wt * 0.000_32;
            const p3b = 0.9 + wt * 0.000_28;
            cx += 0.25 * Math.sin(ox * 11.5 + p3a) * Math.cos(oy * 11.5 + p3b);
            cy += -0.25 * Math.cos(ox * 11.5 + p3a) * Math.sin(oy * 11.5 + p3b);

            // weights 1+0.5+0.25 = 1.75; area-preserving, so a larger amplitude is safe.
            const warpScale = (0.2 + bass * 0.05 + kick * 0.02) / 1.75;
            const px = ox + cx * warpScale;
            const py = oy + cy * warpScale;

            let field = 0;
            // r/g/b accumulate ADDITIVE light from the overlapping blobs.
            let r = 0;
            let g = 0;
            let b = 0;

            for (let i = 0; i < renderBlobs.length; i += 1) {
                const blob = renderBlobs[i];
                const bx = (blob.x - 0.5) * aspect;
                const by = blob.y - 0.5;
                const dx = px - bx;
                const dy = py - by;
                const cos = Math.cos(blob.rotation);
                const sin = Math.sin(blob.rotation);
                const rx = blob.radius * blob.stretch;
                const ry = blob.radius * (blob.satellite ? 0.86 : 0.95);
                const qx = (dx * cos + dy * sin) / Math.max(0.001, rx);
                const qy = (-dx * sin + dy * cos) / Math.max(0.001, ry);
                const value = Math.exp(-(qx * qx + qy * qy) * 1.3) * blob.strength;

                // Step 40: additive colored light — each blob adds its own ramp hue. No
                // divide by field, so overlaps SUM and brighten (masses stack, warm clusters
                // → bright core, mixed overlaps → lighter wisps), like the reference.
                field += value;
                r += value * blob.rgb[0];
                g += value * blob.rgb[1];
                b += value * blob.rgb[2];
            }

            // Step 15: structural gel-fill.
            // This is not a visible hard blob; it is a soft density bridge that keeps
            // the interior from collapsing into black gaps between moving metaballs.
            // Step 41: lighter gel-fill — just enough to bridge the mass, but low enough that
            // the warp's concave inlets/folds aren't all filled back in.
            // Step 48: single CENTRED gel-fill (the old fixed off-centre lobes created a
            // persistent snout). Just a central density bridge; asymmetry comes from the
            // springs + blobs, not a baked-in offset.
            const gelFill =
                Math.exp(-((px * px) / 0.34 + (py * py) / 0.3)) *
                (0.3 + bass * 0.06 + mids * 0.03) *
                objectEnvelope;
            field += gelFill;
            r += gelFill * midRampRgb[0] * 0.5;
            g += gelFill * midRampRgb[1] * 0.5;
            b += gelFill * midRampRgb[2] * 0.5;

            // Step 45: membrane fill — fill ONLY the parts of the spring-shaped silhouette the
            // central blobs don't reach (the protrusions/spikes/edges), so they're solid
            // coloured body rather than field-starved, while the centre keeps its additive
            // folding/colour variation untouched.
            const fillNeed = objectEnvelope * (1 - smoothstep(0.05, 0.45, field));
            field += fillNeed * 0.55;
            r += fillNeed * midRampRgb[0] * 0.42;
            g += fillNeed * midRampRgb[1] * 0.42;
            b += fillNeed * midRampRgb[2] * 0.42;

            // Stronger body/silhouette separation. The softEnvelope lets field-backed
            // edge haze survive just outside the dense object core; without it, the
            // envelope guard can cut a hard bite into thin edge regions.
            // Step 47: keep the silhouette crisp — only a small soft halo just outside the
            // tight edge (the tendril term is reduced so it doesn't re-round the spikes).
            const softEnvelope = Math.max(
                objectEnvelope,
                tendrilEnvelope * smoothstep(0.006, 0.13, field) * 0.18,
            );
            const body = smoothstep(0.32, 0.76, field);
            const glow = smoothstep(0.022, 0.36, field);
            const haze = smoothstep(0.006, 0.11, field);

            // Step 46: inner folded RIBBON — a bright curved band sweeping diagonally through
            // the core, slowly rotating and bending, masked by the body so it reads as layered
            // internal structure sliding beneath the surface (coupled to mids/bass pressure).
            const ribTime = time * 0.000_3;
            const rc = Math.cos(0.6 + ribTime * 0.5);
            const rs = Math.sin(0.6 + ribTime * 0.5);
            const rpx = px * rc - py * rs;
            const rpy = px * rs + py * rc;
            const ribbonCenter =
                Math.sin(rpx * 2.6 + ribTime) * 0.16 + Math.sin(rpx * 1.3 - ribTime * 0.7) * 0.08;
            const ribbon =
                Math.exp(-((rpy - ribbonCenter) * (rpy - ribbonCenter)) / 0.011) *
                body *
                (0.5 + mids * 0.5 + bass * 0.3);
            const ribRgb = sampleRamp(0.18);
            r += ribRgb[0] * ribbon * 0.8;
            g += ribRgb[1] * ribbon * 0.8;
            b += ribRgb[2] * ribbon * 0.8;

            // Second, slower ribbon crossing the first at a different angle → layered folds.
            const rib2Time = time * 0.000_2;
            const r2c = Math.cos(-1.1 - rib2Time * 0.4);
            const r2s = Math.sin(-1.1 - rib2Time * 0.4);
            const r2px = px * r2c - py * r2s;
            const r2py = px * r2s + py * r2c;
            const ribbon2Center = Math.sin(r2px * 2.1 - rib2Time) * 0.18;
            const ribbon2 =
                Math.exp(-((r2py - ribbon2Center) * (r2py - ribbon2Center)) / 0.016) *
                body *
                (0.36 + mids * 0.34);
            const rib2Rgb = sampleRamp(0.62);
            r += rib2Rgb[0] * ribbon2 * 0.5;
            g += rib2Rgb[1] * ribbon2 * 0.5;
            b += rib2Rgb[2] * ribbon2 * 0.5;

            // Edge haze lives near the boundary and can extend slightly farther out.
            const edgeBand =
                smoothstep(0.54, 0.92, field) * (1 - smoothstep(0.88, 1.13, envelopeRadius));
            const tendrilHaze =
                smoothstep(0.01, 0.105, field) *
                (1 - smoothstep(0.76, 1.02, objectEnvelope + 0.12)) *
                tendrilEnvelope;

            const alpha = clamp(
                (body * 0.94 + glow * 0.32 + haze * 0.05) * softEnvelope +
                    edgeBand * (0.1 + mids * 0.02) +
                    tendrilHaze * (0.07 + highs * 0.04 + treble * 0.04),
                0,
                1,
            );

            const index = (y * width + x) * 4;

            if (alpha <= 0.002 || field <= 0.002) {
                // Step 45: outside the body, a sprung-out point still emits its glowing spike
                // ray into the bloom buffer (god-ray), plus a faint body so the ray has form.
                if (spikeRay > 0.004) {
                    const se = clamp(spikeRay * 1.5, 0, 1.6);
                    emissionData[index] = Math.round(clamp(midRampRgb[0] * se, 0, 0.96) * 255);
                    emissionData[index + 1] = Math.round(clamp(midRampRgb[1] * se, 0, 0.96) * 255);
                    emissionData[index + 2] = Math.round(clamp(midRampRgb[2] * se, 0, 0.96) * 255);
                    emissionData[index + 3] = Math.round(clamp(spikeRay * 0.85, 0, 1) * 255);
                    const sb = clamp(spikeRay * 0.45, 0, 0.7);
                    data[index] = Math.round(clamp(midRampRgb[0] * sb, 0, 1) * 255);
                    data[index + 1] = Math.round(clamp(midRampRgb[1] * sb, 0, 1) * 255);
                    data[index + 2] = Math.round(clamp(midRampRgb[2] * sb, 0, 1) * 255);
                    data[index + 3] = Math.round(clamp(spikeRay * 0.5, 0, 1) * 255);
                    continue;
                }
                data[index] = 0;
                data[index + 1] = 0;
                data[index + 2] = 0;
                data[index + 3] = 0;
                emissionData[index] = 0;
                emissionData[index + 1] = 0;
                emissionData[index + 2] = 0;
                emissionData[index + 3] = 0;
                continue;
            }

            // === Step 40: additive colored-light tonemap ===
            // r,g,b already hold the SUMMED light from the overlapping blob masses (+ a faint
            // gel fill). Overlaps are bright; single masses keep their hue. We tame the bright
            // overlaps with a soft shoulder, preserve chroma so they don't wash to grey, and
            // let only genuine multi-mass piles reach near-white (the hot core).
            const lightLevel = r + g + b; // additive light total (overlap density)

            // gentle saturation lift
            const avg = (r + g + b) / 3;
            r = avg + (r - avg) * 1.16;
            g = avg + (g - avg) * 1.16;
            b = avg + (b - avg) * 1.16;

            // soft shoulder — tames bright overlaps while keeping the core bright
            r = r / (1 + r * 0.5);
            g = g / (1 + g * 0.5);
            b = b / (1 + b * 0.5);

            // restore chroma after compression so masses stay vivid (less near the hot core,
            // where genuine multi-mass overlap is allowed to reach near-white)
            const luma = r * 0.299 + g * 0.587 + b * 0.114;
            const preserve = 1.32 - smoothstep(0.6, 1.4, lightLevel) * 0.5;
            r = luma + (r - luma) * preserve;
            g = luma + (g - luma) * preserve;
            b = luma + (b - luma) * preserve;

            // small colored floor so thin single-mass areas aren't muddy
            r = Math.max(r, midRampRgb[0] * body * 0.03);
            g = Math.max(g, midRampRgb[1] * body * 0.03);
            b = Math.max(b, midRampRgb[2] * body * 0.03);

            r = clamp(r, 0, 1);
            g = clamp(g, 0, 1);
            b = clamp(b, 0, 1);

            // --- bloom from the bright overlaps / hot core ---
            const bright = smoothstep(0.5, 0.95, luma);
            // Gentle beat — a subtle brightness swell on transients (not a flash).
            const emissionGain = 0.6 + energy * 0.5 + kick * 0.15;
            const emR = r * bright * 1.6 * emissionGain;
            const emG = g * bright * 1.6 * emissionGain;
            const emB = b * bright * 1.6 * emissionGain;
            const emissionAlpha = clamp(alpha + bright * 0.4, 0, 1);
            emissionData[index] = Math.round(clamp(emR, 0, 0.96) * 255);
            emissionData[index + 1] = Math.round(clamp(emG, 0, 0.96) * 255);
            emissionData[index + 2] = Math.round(clamp(emB, 0, 0.96) * 255);
            emissionData[index + 3] = Math.round(emissionAlpha * 255);

            const outputAlpha = clamp(alpha + bright * 0.05, 0, 1);
            data[index] = Math.round(r * 255);
            data[index + 1] = Math.round(g * 255);
            data[index + 2] = Math.round(b * 255);
            data[index + 3] = Math.round(outputAlpha * 255);
            continue;

        }
    }

    // Step 32: soft alpha continuity pass.
    // Fill tiny boundary gaps from neighboring pixels in the low-res buffers,
    // instead of relying on side-specific support fields. This is restricted to
    // near-transparent edge pixels so it does not change the core silhouette.
    const softenEdgeGaps = (
        targetData: Uint8ClampedArray,
        maxFillAlpha: number,
        alphaScale: number,
    ) => {
        const source = new Uint8ClampedArray(targetData);
        for (let yy = 1; yy < height - 1; yy += 1) {
            for (let xx = 1; xx < width - 1; xx += 1) {
                const idx = (yy * width + xx) * 4;
                const a = source[idx + 3];
                if (a > 20) continue;

                let weightedAlpha = 0;
                let directStrong = 0;
                let count = 0;
                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                let sumW = 0;

                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        if (dx === 0 && dy === 0) continue;
                        const nidx = ((yy + dy) * width + (xx + dx)) * 4;
                        const na = source[nidx + 3];
                        if (na <= 26) continue;
                        const w = dx === 0 || dy === 0 ? 1 : 0.72;
                        weightedAlpha += na * w;
                        sumR += source[nidx] * w;
                        sumG += source[nidx + 1] * w;
                        sumB += source[nidx + 2] * w;
                        sumW += w;
                        count += 1;
                        if ((dx === 0 || dy === 0) && na > 72) directStrong += 1;
                    }
                }

                if (sumW <= 0) continue;
                if (count < 2 && directStrong === 0) continue;

                const fillAlpha = Math.min(maxFillAlpha, (weightedAlpha / sumW) * alphaScale);
                if (fillAlpha <= a + 8) continue;

                targetData[idx] = Math.round(sumR / sumW);
                targetData[idx + 1] = Math.round(sumG / sumW);
                targetData[idx + 2] = Math.round(sumB / sumW);
                targetData[idx + 3] = Math.round(fillAlpha);
            }
        }
    };

    softenEdgeGaps(data, 124, 0.62);
    softenEdgeGaps(emissionData, 110, 0.54);

    ctx.clearRect(0, 0, width, height);
    bloomCtx.clearRect(0, 0, width, height);
    ctx.putImageData(image, 0, 0);
    bloomCtx.putImageData(emissionImage, 0, 0);
};

const VisualizerInner = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const bloomCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const frameRef = useRef<null | number>(null);
    const lastRenderTimeRef = useRef(0);
    const visualTimeRef = useRef(0);
    const connectedNodesRef = useRef<AudioNode[]>([]);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const targetPaletteRef = useRef<BlobPalette>(BASE_PALETTE);
    const paletteRef = useRef<BlobPalette>(BASE_PALETTE);
    const blobsRef = useRef<LavaBlob[]>([
        ...Array.from({ length: 9 }, (_, index) => createBlob(index, 9, false)),
        ...Array.from({ length: 7 }, (_, index) => createBlob(index, 7, true)),
    ]);
    const contourRef = useRef<ContourState>(createContour());
    const audioLevelsRef = useRef<AudioLevels>({
        adaptiveGain: 3,
        bass: 0,
        hat: 0,
        highs: 0,
        kick: 0,
        mids: 0,
        previousBass: 0,
        previousTreble: 0,
        treble: 0,
    });

    const { webAudio } = useWebAudio();
    const playbackType = usePlaybackType();
    const currentSong = usePlayerSong();
    const playerStatus = usePlayerStatus();
    const isPlaying = playerStatus === PlayerStatus.PLAYING;

    // Prefer real AudioMuse sonic mood for the current track; fall back to the
    // song-metadata heuristic when unavailable (unconfigured / unanalyzed / web).
    const mood = useTrackMood();
    const targetPalette = useMemo(
        () => (mood && paletteFromMood(mood)) ?? paletteFromSong(currentSong),
        [mood, currentSong],
    );

    const isPlayingRef = useRef(isPlaying);
    // Mood energy → motion/bloom multiplier (0.5 = neutral ⇒ scale ≈ 1.0).
    const moodEnergyRef = useRef(0.5);

    useEffect(() => {
        targetPaletteRef.current = targetPalette;
    }, [targetPalette]);

    useEffect(() => {
        const energy = mood?.energy;
        moodEnergyRef.current = Number.isFinite(energy) ? clamp(energy as number, 0, 1) : 0.5;
    }, [mood]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = webAudio?.context;
        const inputNodes = getVisualizerAudioNodes(webAudio, playbackType);

        if (!canvas || !context || inputNodes.length === 0) return;

        const ctx = canvas.getContext('2d', { alpha: false });

        if (!ctx) return;

        const analyser = context.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.minDecibels = -96;
        analyser.maxDecibels = -12;
        analyser.smoothingTimeConstant = 0.54;

        inputNodes.forEach((node) => {
            try {
                node.connect(analyser);
                connectedNodesRef.current.push(node);
            } catch {
                // Some WebAudio nodes may already be in a specific routing state.
            }
        });

        analyserRef.current = analyser;

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const fieldCanvas = document.createElement('canvas');
        // Step 29 notch fix: the offscreen canvases must preserve alpha. v8.28
        // correctly wrote transparent off-object pixels, but alpha:false contexts
        // flatten those pixels onto opaque black, which can reappear as a rectangular
        // bite when the low-res canvas is scaled/blurred into the final canvas.
        const fieldCtx = fieldCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
        const bloomCanvas = document.createElement('canvas');
        const bloomCtx = bloomCanvas.getContext('2d', { alpha: true, willReadFrequently: true });

        fieldCanvasRef.current = fieldCanvas;
        bloomCanvasRef.current = bloomCanvas;

        if (!fieldCtx || !bloomCtx) return;

        let renderBuffers: null | RenderBuffers = null;

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));

            const aspect = Math.max(0.1, canvas.width / Math.max(1, canvas.height));

            if (aspect >= 1) {
                fieldCanvas.width = FIELD_MAX_SIZE;
                fieldCanvas.height = Math.max(FIELD_MIN_SIZE, Math.round(FIELD_MAX_SIZE / aspect));
                bloomCanvas.width = fieldCanvas.width;
                bloomCanvas.height = fieldCanvas.height;
            } else {
                fieldCanvas.height = FIELD_MAX_SIZE;
                fieldCanvas.width = Math.max(FIELD_MIN_SIZE, Math.round(FIELD_MAX_SIZE * aspect));
                bloomCanvas.width = fieldCanvas.width;
                bloomCanvas.height = fieldCanvas.height;
            }

            fieldCtx.clearRect(0, 0, fieldCanvas.width, fieldCanvas.height);
            bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
            renderBuffers = {
                body: fieldCtx.createImageData(fieldCanvas.width, fieldCanvas.height),
                emission: bloomCtx.createImageData(bloomCanvas.width, bloomCanvas.height),
            };
        };

        resize();

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);

        const render = (time: number) => {
            const playing = isPlayingRef.current;
            const elapsed = time - lastRenderTimeRef.current;
            const frameInterval = playing ? FRAME_INTERVAL_MS : PAUSED_FRAME_INTERVAL_MS;

            if (elapsed < frameInterval) {
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            const dt = Number.isFinite(elapsed)
                ? clamp(elapsed || frameInterval, 1, 40)
                : frameInterval;
            lastRenderTimeRef.current = time;

            const analyserNode = analyserRef.current;

            if (
                !analyserNode ||
                fieldCanvas.width <= 1 ||
                fieldCanvas.height <= 1 ||
                bloomCanvas.width <= 1 ||
                bloomCanvas.height <= 1 ||
                canvas.width <= 1 ||
                canvas.height <= 1 ||
                !renderBuffers
            ) {
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            const levels = audioLevelsRef.current;

            if (playing) {
                analyserNode.getByteFrequencyData(frequencyData);

                const measuredBass = averageRange(frequencyData, 0, 24);
                const measuredMids = averageRange(frequencyData, 24, 156);
                const measuredHighs =
                    averageRange(frequencyData, 156, 292) * 0.68 +
                    averageRange(frequencyData, 292, 512) * 0.32;
                const measuredTreble = Math.min(
                    1,
                    measuredHighs * 0.72 + peakRange(frequencyData, 190, 512) * 0.28,
                );
                const measuredEnergy =
                    measuredBass * 0.48 + measuredMids * 0.34 + measuredHighs * 0.18;
                const gainTarget = Number.isFinite(measuredEnergy)
                    ? clamp(0.46 / Math.max(0.045, measuredEnergy), 1.25, 6.2)
                    : 3;

                levels.adaptiveGain = Number.isFinite(levels.adaptiveGain)
                    ? smoothLevel(levels.adaptiveGain, gainTarget, 0.035, 0.012)
                    : 3;

                const rawBass = clamp(Math.pow(measuredBass * levels.adaptiveGain, 0.7), 0, 1);
                const rawMids = clamp(
                    Math.pow(measuredMids * levels.adaptiveGain * 1.08, 0.74),
                    0,
                    1,
                );
                const rawHighs = clamp(
                    Math.pow(measuredHighs * levels.adaptiveGain * 1.18, 0.7),
                    0,
                    1,
                );
                const rawTreble = clamp(
                    Math.pow(measuredTreble * levels.adaptiveGain * 1.22, 0.68),
                    0,
                    1,
                );

                const kickHit = Math.max(0, rawBass - levels.previousBass) * 5.8;
                const hatHit = Math.max(0, rawTreble - levels.previousTreble) * 3.4;

                levels.previousBass = rawBass;
                levels.previousTreble = rawTreble;
                levels.bass = smoothLevel(levels.bass, rawBass, 0.38, 0.08);
                levels.mids = smoothLevel(levels.mids, rawMids, 0.32, 0.1);
                levels.highs = smoothLevel(levels.highs, rawHighs, 0.36, 0.14);
                levels.treble = smoothLevel(levels.treble, rawTreble, 0.38, 0.16);
                levels.kick = Math.max(levels.kick * 0.74, Math.min(1, kickHit));
                levels.hat = Math.max(levels.hat * 0.8, Math.min(1, hatHit));
            } else {
                frequencyData.fill(0);
                levels.previousBass *= 0.72;
                levels.previousTreble *= 0.72;
                levels.bass *= 0.72;
                levels.mids *= 0.72;
                levels.highs *= 0.72;
                levels.treble *= 0.72;
                levels.kick *= 0.45;
                levels.hat *= 0.45;
            }

            const bass = levels.bass;
            const mids = levels.mids;
            const highs = levels.highs;
            const treble = levels.treble;
            const kick = playing ? levels.kick : 0;
            const hat = playing ? levels.hat : 0;
            if (playing) {
                visualTimeRef.current = time;
            }

            const fieldTime = visualTimeRef.current;

            const palette = paletteRef.current;
            const target = targetPaletteRef.current;

            palette.core = lerpHue(palette.core, target.core, 0.01);
            palette.mid = lerpHue(palette.mid, target.mid, 0.01);
            palette.edge = lerpHue(palette.edge, target.edge, 0.01);
            palette.accent = lerpHue(palette.accent, target.accent, 0.01);
            palette.glow = lerpHue(palette.glow, target.glow, 0.01);

            // Real-mood energy scales motion + bloom (0.5 energy ⇒ ~1.0, no change).
            const energyScale = 0.85 + moodEnergyRef.current * 0.3;

            if (playing) {
                updateBlobPhysics(
                    blobsRef.current,
                    frequencyData,
                    fieldTime,
                    dt,
                    bass * energyScale,
                    mids * energyScale,
                    highs * energyScale,
                    kick * energyScale,
                );
            }
            // Spring-membrane contour updates every frame (decays toward compact when paused).
            updateContour(
                contourRef.current,
                frequencyData,
                fieldTime,
                dt,
                bass * energyScale,
                mids * energyScale,
                highs * energyScale,
                treble * energyScale,
                kick * energyScale,
                playing,
            );
            fieldCtx.clearRect(0, 0, fieldCanvas.width, fieldCanvas.height);
            bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);

            renderMetaballField(
                fieldCtx,
                bloomCtx,
                renderBuffers,
                blobsRef.current,
                contourRef.current.r,
                palette,
                frequencyData,
                fieldCanvas.width,
                fieldCanvas.height,
                fieldTime,
                bass * energyScale,
                mids * energyScale,
                highs * energyScale,
                treble * energyScale,
                hat * energyScale,
                kick * energyScale,
            );
            const width = canvas.width;
            const height = canvas.height;
            const minSide = Math.min(width, height);
            const bloom = minSide * (0.05 + (bass * 0.025 + kick * 0.02) * energyScale);

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.filter = 'none';
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
            ctx.imageSmoothingEnabled = true;

            if (VISUALIZER_DEBUG_MODE === 'field') {
                ctx.filter = 'none';
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(fieldCanvas, 0, 0, width, height);
                ctx.restore();
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            if (VISUALIZER_DEBUG_MODE === 'bloom') {
                ctx.filter = 'none';
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(bloomCanvas, 0, 0, width, height);
                ctx.restore();
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            // Localized bloom passes. The bloomCanvas now comes from the dedicated
            // emission source written during field rendering, so hot core/edge fuzz
            // can glow without lifting the whole body.
            ctx.globalCompositeOperation = 'screen';

            ctx.globalAlpha = 0.38 + bass * 0.08;
            ctx.filter = `blur(${bloom * 1.25}px) saturate(1.32) brightness(0.96)`;
            ctx.drawImage(bloomCanvas, 0, 0, width, height);

            ctx.globalAlpha = 0.48 + highs * 0.06;
            ctx.filter = `blur(${Math.max(1.1, bloom * 0.34)}px) saturate(1.22) brightness(0.99)`;
            ctx.drawImage(bloomCanvas, 0, 0, width, height);

            // Step 31: soft body underpaint — a low-alpha blurred copy behind the main pass to
            // feather edges + add gel haze. Step 42: trimmed so the crisp body shows through.
            ctx.globalAlpha = 0.12 + mids * 0.025 + highs * 0.015;
            ctx.filter = `blur(${Math.max(1.6, bloom * 0.22)}px) saturate(1.14) brightness(0.84)`;
            ctx.drawImage(fieldCanvas, 0, 0, width, height);

            // Main object body. Step 42: near-sharp (tiny blur) + light contrast so the folds
            // and internal filaments read crisply against the soft outer glow.
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.filter = 'blur(0.6px) saturate(1.06) contrast(1.08) brightness(0.95)';
            ctx.drawImage(fieldCanvas, 0, 0, width, height);

            // Step 2: explicit center strokes removed. Folds are now blended into the
            // metaball material in renderMetaballField(), avoiding the Siri-like line.

            ctx.restore();

            frameRef.current = requestAnimationFrame(render);
        };

        frameRef.current = requestAnimationFrame(render);

        return () => {
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current);
            }

            resizeObserver.disconnect();

            connectedNodesRef.current.forEach((node) => {
                try {
                    node.disconnect(analyser);
                } catch {
                    // Ignore cleanup disconnect errors.
                }
            });

            connectedNodesRef.current = [];
            analyser.disconnect();
            analyserRef.current = null;
        };
    }, [playbackType, webAudio]);

    return (
        <div className={styles.stage}>
            <canvas className={styles.canvas} ref={canvasRef} />
        </div>
    );
};

export const Visualizer = () => {
    const { visualizerExpanded } = useFullScreenPlayerStore();
    const { setStore } = useFullScreenPlayerStoreActions();

    const handleToggleFullscreen = () => {
        setStore({ expanded: false, visualizerExpanded: !visualizerExpanded });
    };

    return (
        <div className={styles.root}>
            <Group
                className={styles.iconGroup}
                gap="xs"
                pos="absolute"
                right="var(--theme-spacing-sm)"
                top="var(--theme-spacing-sm)"
            >
                <ActionIcon
                    icon="expand"
                    iconProps={{ size: 'lg' }}
                    onClick={handleToggleFullscreen}
                    variant="subtle"
                />
                <ActionIcon
                    icon="settings2"
                    iconProps={{ size: 'lg' }}
                    onClick={openVisualizerSettingsModal}
                    variant="subtle"
                />
            </Group>
            <ComponentErrorBoundary>
                <VisualizerInner />
            </ComponentErrorBoundary>
        </div>
    );
};
