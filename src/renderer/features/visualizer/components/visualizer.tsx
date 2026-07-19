import { useEffect, useMemo, useRef } from 'react';

import styles from './visualizer.module.css';

import { useWebAudio } from '/@/renderer/features/player/hooks/use-webaudio';
import { getVisualizerAudioNodes } from '/@/renderer/features/player/utils/get-visualizer-audio-nodes';
import { openVisualizerSettingsModal } from '/@/renderer/features/player/utils/open-visualizer-settings-modal';
import { ComponentErrorBoundary } from '/@/renderer/features/shared/components/component-error-boundary';
import { usePlaybackType, usePlayerSong } from '/@/renderer/store';
import {
    useFullScreenPlayerStore,
    useFullScreenPlayerStoreActions,
} from '/@/renderer/store/full-screen-player.store';
import { usePlayerStatus } from '/@/renderer/store/player.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';
import { PlayerStatus } from '/@/shared/types/types';

const POINT_COUNT = 72;
const FRAME_INTERVAL_MS = 1000 / 30;
const RENDER_SCALE = 0.85;

type BlobPalette = {
    accent: number;
    core: number;
    edge: number;
    glow: number;
    mid: number;
};

type BlobPoint = {
    angle: number;
    offset: number;
    velocity: number;
};

type CanvasPoint = {
    x: number;
    y: number;
};

function averageRange(data: Uint8Array, start: number, end: number) {
    let sum = 0;
    const safeEnd = Math.min(end, data.length);

    for (let i = start; i < safeEnd; i += 1) {
        sum += data[i];
    }

    return sum / Math.max(1, safeEnd - start) / 255;
}

function peakRange(data: Uint8Array, start: number, end: number) {
    let peak = 0;
    const safeEnd = Math.min(end, data.length);

    for (let i = start; i < safeEnd; i += 1) {
        peak = Math.max(peak, data[i]);
    }

    return peak / 255;
}

const smoothLevel = (current: number, target: number, attack: number, release: number) =>
    current + (target - current) * (target > current ? attack : release);

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360;

const lerpHue = (from: number, to: number, amount: number) => {
    const delta = ((((to - from) % 360) + 540) % 360) - 180;
    return wrapHue(from + delta * amount);
};

const edgeFlow = (angle: number, time: number, phase = 0) =>
    Math.sin(angle * 2.15 + time * 0.000_54 + phase) * 0.48 +
    Math.sin(angle * 3.4 - time * 0.000_42 + phase * 1.7) * 0.32 +
    Math.sin(angle * 5.35 + time * 0.000_28 - phase * 0.8) * 0.2;

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

    if (
        words.match(/ambient|classical|piano|sleep|drone|chill|lofi|lo-fi|downtempo|meditation/) ||
        (bpm > 0 && bpm < 88)
    ) {
        return { accent: 160, core: 214, edge: 262, glow: 196, mid: 235 };
    }

    if (words.match(/metal|industrial|punk|hardcore|noise|goth|doom|dark|rock/) || bpm >= 155) {
        return { accent: 18, core: 344, edge: 270, glow: 316, mid: 292 };
    }

    if (words.match(/jazz|soul|r&b|rnb|funk|folk|acoustic|country|blues|singer/)) {
        return { accent: 34, core: 18, edge: 320, glow: 46, mid: 354 };
    }

    if (words.match(/electronic|dance|house|techno|trance|edm|club|disco|synth/) || bpm >= 122) {
        return { accent: 176, core: 300, edge: 96, glow: 196, mid: 326 };
    }

    if (loved || words.match(/pop|happy|summer|dream|love|party/)) {
        return { accent: 44, core: 326, edge: 190, glow: 24, mid: 286 };
    }

    return { accent: 32, core: 312, edge: 148, glow: 286, mid: 18 };
};

function drawSmoothBlob(ctx: CanvasRenderingContext2D, points: CanvasPoint[]) {
    if (points.length < 3) return;

    ctx.beginPath();

    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];

        const midX = (current.x + next.x) / 2;
        const midY = (current.y + next.y) / 2;

        if (i === 0) {
            ctx.moveTo(midX, midY);
        } else {
            ctx.quadraticCurveTo(current.x, current.y, midX, midY);
        }
    }

    ctx.closePath();
}

const drawFogBlob = (
    ctx: CanvasRenderingContext2D,
    points: CanvasPoint[],
    fillStyle: CanvasGradient | string,
    blur: number,
    alpha: number,
) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    drawSmoothBlob(ctx, points);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
};

const drawSoftBlob = (
    ctx: CanvasRenderingContext2D,
    points: CanvasPoint[],
    fillStyle: CanvasGradient | string,
    blur: number,
    alpha: number,
) => {
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    drawSmoothBlob(ctx, points);
    ctx.fillStyle = fillStyle;
    ctx.fill();
};

const offsetPoints = (
    points: CanvasPoint[],
    cx: number,
    cy: number,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number,
) =>
    points.map((point) => ({
        x: cx + (point.x - cx) * scaleX + offsetX,
        y: cy + (point.y - cy) * scaleY + offsetY,
    }));

const flowPoints = (
    points: CanvasPoint[],
    cx: number,
    cy: number,
    minSide: number,
    time: number,
    baseOffset: number,
    radialScale: number,
    tangentScale: number,
    phase: number,
) =>
    points.map((point) => {
        const dx = point.x - cx;
        const dy = point.y - cy;
        const magnitude = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / magnitude;
        const ny = dy / magnitude;
        const angle = Math.atan2(dy, dx);
        const flow = edgeFlow(angle, time, phase);
        const radial = minSide * (baseOffset + Math.max(-0.3, flow) * radialScale);
        const tangent = Math.sin(angle * 2.7 - time * 0.000_36 + phase) * minSide * tangentScale;

        return {
            x: point.x + nx * radial - ny * tangent,
            y: point.y + ny * radial + nx * tangent,
        };
    });

const buildFoldShape = (
    points: CanvasPoint[],
    cx: number,
    cy: number,
    minSide: number,
    time: number,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number,
    phase: number,
) =>
    flowPoints(
        offsetPoints(points, cx, cy, scaleX, scaleY, offsetX, offsetY),
        cx,
        cy,
        minSide,
        time,
        -0.018,
        0.046,
        0.032,
        phase,
    );

const drawMorphMasses = (
    ctx: CanvasRenderingContext2D,
    dpr: number,
    cx: number,
    cy: number,
    baseRadius: number,
    minSide: number,
    time: number,
    palette: BlobPalette,
    shimmer: number,
    bass: number,
    mids: number,
    highs: number,
    treble: number,
    hat: number,
) => {
    const masses = [
        {
            alpha: 0.64 + mids * 0.14,
            hue: palette.core - 8,
            phase: 0.25,
            rx: 0.5 + bass * 0.1,
            ry: 0.34 + mids * 0.08,
            x: -0.42,
            y: -0.04,
        },
        {
            alpha: 0.6 + highs * 0.14,
            hue: palette.accent + shimmer,
            phase: 1.35,
            rx: 0.42 + treble * 0.12,
            ry: 0.5 + hat * 0.08,
            x: 0.18,
            y: -0.34,
        },
        {
            alpha: 0.58 + bass * 0.16,
            hue: palette.edge - 10,
            phase: 2.45,
            rx: 0.54 + bass * 0.14,
            ry: 0.3 + mids * 0.06,
            x: -0.18,
            y: 0.36,
        },
        {
            alpha: 0.46 + hat * 0.2,
            hue: palette.glow + 12,
            phase: 3.9,
            rx: 0.38 + highs * 0.1,
            ry: 0.28 + treble * 0.1,
            x: 0.44,
            y: 0.16,
        },
        {
            alpha: 0.4 + treble * 0.16,
            hue: palette.mid + 18,
            phase: 5.05,
            rx: 0.3 + hat * 0.12,
            ry: 0.38 + highs * 0.1,
            x: 0.08,
            y: 0.26,
        },
    ];

    const drawMass = (
        context: CanvasRenderingContext2D,
        mass: (typeof masses)[number],
        index: number,
        alphaScale: number,
        blur: number,
    ) => {
        const phase = mass.phase;
        const slow = time * (0.000_24 + index * 0.000_021) + phase;
        const shear = Math.sin(time * 0.000_41 + phase) * 0.22 + hat * 0.08;
        const travelX =
            Math.sin(slow) * baseRadius * 0.18 +
            Math.sin(time * 0.000_13 + phase * 2.6) * baseRadius * 0.1;
        const travelY =
            Math.sin(time * (0.000_17 + index * 0.000_019) + phase * 1.4) * baseRadius * 0.16 +
            Math.sin(time * 0.000_11 + phase * 0.7) * baseRadius * 0.1;
        const mergePulse = Math.max(0, Math.sin(time * 0.000_34 + phase * 1.9));
        const rx =
            baseRadius * (mass.rx + mergePulse * 0.16 + Math.sin(time * 0.000_37 + phase) * 0.06);
        const ry =
            baseRadius *
            (mass.ry + (1 - mergePulse) * 0.1 + Math.cos(time * 0.000_29 + phase) * 0.06);
        const x = cx + baseRadius * mass.x + travelX;
        const y = cy + baseRadius * mass.y + travelY;
        const radius = Math.max(rx, ry);
        const gradient = context.createRadialGradient(x, y, radius * 0.16, x, y, radius * 0.98);

        gradient.addColorStop(
            0,
            `hsla(${wrapHue(mass.hue)}, 100%, 62%, ${mass.alpha * alphaScale})`,
        );
        gradient.addColorStop(
            0.5,
            `hsla(${wrapHue(mass.hue + 8)}, 96%, 54%, ${mass.alpha * alphaScale * 0.64})`,
        );
        gradient.addColorStop(0.86, `hsla(${wrapHue(mass.hue + 20)}, 96%, 48%, 0)`);

        context.save();
        context.filter = blur > 0 ? `blur(${blur * dpr}px)` : 'none';
        context.translate(x, y);
        context.rotate(Math.sin(time * 0.000_23 + phase) * 0.38);
        context.transform(1, shear, shear * 0.45, 1, 0, 0);
        context.beginPath();
        for (let i = 0; i < 18; i += 1) {
            const angle = (Math.PI * 2 * i) / 18;
            const wobble =
                1 +
                Math.sin(angle * 2 + time * 0.000_65 + phase) * 0.16 +
                Math.sin(angle * 3.7 - time * 0.000_52 + phase * 1.4) * 0.11 +
                Math.sin(angle * 7 + time * 0.001_8 + index) * hat * 0.06;
            const px = Math.cos(angle) * rx * wobble;
            const py = Math.sin(angle) * ry * wobble;

            if (i === 0) {
                context.moveTo(px, py);
            } else {
                context.lineTo(px, py);
            }
        }

        context.closePath();
        context.fillStyle = gradient;
        context.fill();
        context.restore();
    };

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    masses.forEach((mass, index) => {
        drawMass(ctx, mass, index, 0.45, Math.max(1.5, minSide * 0.006));
    });
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    masses.forEach((mass, index) => {
        drawMass(ctx, mass, index, index % 2 === 0 ? 0.54 + hat * 0.08 : 0.28 + treble * 0.08, 0);
    });
    ctx.restore();
};

const VisualizerInner = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { webAudio } = useWebAudio();
    const playbackType = usePlaybackType();
    const currentSong = usePlayerSong();
    const playerStatus = usePlayerStatus();
    const isPlaying = playerStatus === PlayerStatus.PLAYING;
    const targetPalette = useMemo(() => paletteFromSong(currentSong), [currentSong]);

    const frameRef = useRef<null | number>(null);
    const lastRenderTimeRef = useRef(0);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const connectedNodesRef = useRef<AudioNode[]>([]);
    const audioLevelsRef = useRef({
        bass: 0,
        hat: 0,
        highs: 0,
        mids: 0,
        previousTreble: 0,
        treble: 0,
    });
    const paletteRef = useRef<BlobPalette>(targetPalette);
    const targetPaletteRef = useRef<BlobPalette>(targetPalette);
    const pointsRef = useRef<BlobPoint[]>(
        Array.from({ length: POINT_COUNT }, (_, index) => ({
            angle: (Math.PI * 2 * index) / POINT_COUNT,
            offset: 0,
            velocity: 0,
        })),
    );

    useEffect(() => {
        targetPaletteRef.current = targetPalette;
    }, [targetPalette]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = webAudio?.context;
        const inputNodes = getVisualizerAudioNodes(webAudio, playbackType);

        if (!canvas || !context || inputNodes.length === 0) return;

        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -88;
        analyser.maxDecibels = -18;
        analyser.smoothingTimeConstant = 0.62;

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
        const dpr = Math.min(window.devicePixelRatio || 1, 1);

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.max(1, Math.floor(rect.width * dpr * RENDER_SCALE));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr * RENDER_SCALE));
        };

        resize();

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);

        const render = (time: number) => {
            if (time - lastRenderTimeRef.current < FRAME_INTERVAL_MS) {
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            lastRenderTimeRef.current = time;

            const ctx = canvas.getContext('2d');
            const analyserNode = analyserRef.current;

            if (!ctx || !analyserNode) return;

            analyserNode.getByteFrequencyData(frequencyData);

            const width = canvas.width;
            const height = canvas.height;
            const minSide = Math.min(width, height);

            const levels = audioLevelsRef.current;
            const rawBass = averageRange(frequencyData, 0, 14);
            const rawMids = averageRange(frequencyData, 14, 92);
            const rawHighs =
                averageRange(frequencyData, 92, 176) * 0.58 +
                averageRange(frequencyData, 176, 256) * 0.42;
            const rawTreble = Math.min(
                1,
                rawHighs * 0.72 + peakRange(frequencyData, 126, 256) * 0.42,
            );
            const hatHit = Math.max(0, rawTreble - levels.previousTreble) * 4.6;

            levels.previousTreble = rawTreble;
            levels.bass = smoothLevel(levels.bass, rawBass, 0.28, 0.08);
            levels.mids = smoothLevel(levels.mids, rawMids, 0.24, 0.1);
            levels.highs = smoothLevel(levels.highs, rawHighs, 0.42, 0.16);
            levels.treble = smoothLevel(levels.treble, rawTreble, 0.48, 0.18);
            levels.hat = Math.max(levels.hat * 0.72, Math.min(1, hatHit));

            const bass = isPlaying ? levels.bass : 0.04;
            const mids = isPlaying ? levels.mids : 0.04;
            const highs = isPlaying ? levels.highs : 0.04;
            const treble = isPlaying ? levels.treble : 0.03;
            const hat = isPlaying ? levels.hat : 0;
            const energy = isPlaying ? bass * 0.55 + mids * 0.28 + highs * 0.12 + hat * 0.05 : 0.05;

            ctx.clearRect(0, 0, width, height);

            const cx = width / 2;
            const cy = height / 2;
            const baseRadius = minSide * (0.22 + energy * 0.065);

            const points = pointsRef.current.map((point, index) => {
                const bandIndex = Math.floor((index / POINT_COUNT) * frequencyData.length);
                const bandEnergy = frequencyData[bandIndex] / 255;

                const noise =
                    Math.sin(point.angle * 3 + time * 0.0014) * 0.45 +
                    Math.sin(point.angle * 7 - time * 0.0011) * 0.28 +
                    Math.sin(point.angle * 11 + time * 0.0007) * 0.18;
                const flow = edgeFlow(point.angle, time);
                const crest = Math.max(0, flow);
                const highRipple =
                    Math.sin(point.angle * 13 + time * 0.006) *
                    Math.sin(point.angle * 5.5 - time * 0.002_4) *
                    hat;
                const edgeLift =
                    (flow * 0.72 +
                        crest * (bandEnergy * 0.5 + highs * 0.38 + treble * 0.26) +
                        highRipple * 0.42) *
                    minSide *
                    (isPlaying ? 0.058 : 0.018);

                const target =
                    noise * minSide * 0.038 +
                    bandEnergy * minSide * (0.02 + treble * 0.018) +
                    bass * minSide * 0.014 +
                    edgeLift;

                // Spring physics.
                const force = (target - point.offset) * (0.046 + hat * 0.025);
                point.velocity = (point.velocity + force) * (0.86 - hat * 0.08);
                point.offset += point.velocity;

                const radius = baseRadius + point.offset;
                return {
                    x: cx + Math.cos(point.angle) * radius,
                    y: cy + Math.sin(point.angle) * radius,
                };
            });

            const palette = paletteRef.current;
            const nextPalette = targetPaletteRef.current;
            palette.core = lerpHue(palette.core, nextPalette.core, 0.025);
            palette.mid = lerpHue(palette.mid, nextPalette.mid, 0.025);
            palette.edge = lerpHue(palette.edge, nextPalette.edge, 0.025);
            palette.accent = lerpHue(palette.accent, nextPalette.accent, 0.025);
            palette.glow = lerpHue(palette.glow, nextPalette.glow, 0.025);

            const shimmer = Math.sin(time * 0.0006) * 4 + energy * 8;

            const topLobe = offsetPoints(
                points,
                cx,
                cy,
                0.72,
                0.56,
                -baseRadius * 0.22,
                -baseRadius * 0.46,
            );
            const rightLobe = offsetPoints(
                points,
                cx,
                cy,
                0.58,
                0.5,
                baseRadius * 0.66,
                -baseRadius * 0.08,
            );
            const bottomLobe = offsetPoints(
                points,
                cx,
                cy,
                0.68,
                0.48,
                baseRadius * 0.08,
                baseRadius * 0.58,
            );
            const leftLobe = offsetPoints(
                points,
                cx,
                cy,
                0.66,
                0.46,
                -baseRadius * 0.68,
                baseRadius * 0.16,
            );
            const edgeVeilA = flowPoints(points, cx, cy, minSide, time, 0.018, 0.08, 0.018, 0.4);
            const edgeVeilB = flowPoints(points, cx, cy, minSide, time, 0.006, 0.06, 0.026, 2.1);
            const edgeVeilC = flowPoints(points, cx, cy, minSide, time, 0.028, 0.045, 0.014, 4.4);
            const foldA = buildFoldShape(
                points,
                cx,
                cy,
                minSide,
                time,
                0.86 + Math.sin(time * 0.000_42) * 0.08,
                0.5 + Math.sin(time * 0.000_31) * 0.06,
                -baseRadius * (0.28 + Math.sin(time * 0.000_36) * 0.18),
                -baseRadius * (0.18 + Math.cos(time * 0.000_44) * 0.12),
                1.1,
            );
            const foldB = buildFoldShape(
                points,
                cx,
                cy,
                minSide,
                time,
                0.72 + Math.cos(time * 0.000_35) * 0.08,
                0.56 + Math.sin(time * 0.000_4) * 0.06,
                baseRadius * (0.26 + Math.cos(time * 0.000_29) * 0.18),
                baseRadius * (0.02 + Math.sin(time * 0.000_38) * 0.2),
                3.3,
            );
            const foldC = buildFoldShape(
                points,
                cx,
                cy,
                minSide,
                time,
                0.62 + Math.sin(time * 0.000_33) * 0.06,
                0.72 + Math.cos(time * 0.000_37) * 0.08,
                -baseRadius * (0.02 + Math.cos(time * 0.000_27) * 0.14),
                baseRadius * (0.35 + Math.sin(time * 0.000_32) * 0.14),
                5.2,
            );

            const outerGradient = ctx.createRadialGradient(
                cx,
                cy,
                minSide * 0.04,
                cx,
                cy,
                baseRadius * 2.35,
            );
            outerGradient.addColorStop(0, `hsl(${wrapHue(palette.accent + shimmer)}, 92%, 64%)`);
            outerGradient.addColorStop(0.32, `hsl(${wrapHue(palette.core - shimmer)}, 88%, 58%)`);
            outerGradient.addColorStop(
                0.72,
                `hsl(${wrapHue(palette.edge + shimmer * 0.5)}, 84%, 48%)`,
            );
            outerGradient.addColorStop(1, `hsl(${wrapHue(palette.glow)}, 80%, 42%)`);

            const innerGradient = ctx.createRadialGradient(
                cx - baseRadius * 0.28,
                cy - baseRadius * 0.2,
                minSide * 0.02,
                cx + baseRadius * 0.06,
                cy + baseRadius * 0.08,
                baseRadius * 1.35,
            );

            innerGradient.addColorStop(0, `hsl(${wrapHue(palette.accent + 8)}, 88%, 70%)`);
            innerGradient.addColorStop(
                0.42,
                `hsla(${wrapHue(palette.core + shimmer * 0.3)}, 86%, 60%, 0.62)`,
            );
            innerGradient.addColorStop(
                1,
                `hsla(${wrapHue(palette.mid - shimmer * 0.4)}, 82%, 50%, 0.18)`,
            );

            const bodyGradient = ctx.createLinearGradient(
                cx - baseRadius * 1.18,
                cy - baseRadius * 0.58,
                cx + baseRadius * 1.08,
                cy + baseRadius * 0.72,
            );
            bodyGradient.addColorStop(0, `hsl(${wrapHue(palette.edge - shimmer)}, 92%, 48%)`);
            bodyGradient.addColorStop(0.26, `hsl(${wrapHue(palette.core)}, 96%, 52%)`);
            bodyGradient.addColorStop(0.56, `hsl(${wrapHue(palette.accent + shimmer)}, 98%, 58%)`);
            bodyGradient.addColorStop(0.78, `hsl(${wrapHue(palette.mid)}, 92%, 52%)`);
            bodyGradient.addColorStop(1, `hsl(${wrapHue(palette.glow + shimmer)}, 90%, 46%)`);

            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            drawFogBlob(ctx, points, outerGradient, 28 * dpr, 0.13 + energy * 0.08);
            drawFogBlob(
                ctx,
                edgeVeilA,
                `hsl(${wrapHue(palette.accent + shimmer)}, 96%, 58%)`,
                9 * dpr,
                0.16 + mids * 0.08,
            );
            drawFogBlob(
                ctx,
                edgeVeilB,
                `hsl(${wrapHue(palette.edge - shimmer)}, 94%, 46%)`,
                10 * dpr,
                0.15 + bass * 0.09,
            );
            drawFogBlob(
                ctx,
                edgeVeilC,
                `hsl(${wrapHue(palette.glow + shimmer * 0.6)}, 94%, 54%)`,
                7 * dpr,
                0.12 + highs * 0.08,
            );
            drawFogBlob(
                ctx,
                leftLobe,
                `hsl(${wrapHue(palette.edge - 18)}, 92%, 45%)`,
                10 * dpr,
                0.16 + bass * 0.08,
            );
            drawFogBlob(
                ctx,
                topLobe,
                `hsl(${wrapHue(palette.glow + 20)}, 90%, 52%)`,
                9 * dpr,
                0.15 + mids * 0.08,
            );
            drawFogBlob(
                ctx,
                rightLobe,
                `hsl(${wrapHue(palette.core + 10)}, 92%, 52%)`,
                8 * dpr,
                0.14 + highs * 0.08,
            );
            drawFogBlob(
                ctx,
                bottomLobe,
                `hsl(${wrapHue(palette.edge - 8)}, 90%, 48%)`,
                9 * dpr,
                0.16 + bass * 0.08,
            );
            drawFogBlob(ctx, points, bodyGradient, 3.2 * dpr, 0.36 + energy * 0.08);
            drawFogBlob(ctx, points, innerGradient, 9 * dpr, 0.18 + energy * 0.08);
            drawFogBlob(
                ctx,
                points,
                `hsl(${wrapHue(palette.mid + shimmer)}, 90%, 60%)`,
                3.5 * dpr,
                0.1 + highs * 0.12,
            );
            ctx.restore();

            ctx.save();
            drawSmoothBlob(ctx, points);
            ctx.clip();
            ctx.globalCompositeOperation = 'source-over';

            drawMorphMasses(
                ctx,
                dpr,
                cx,
                cy,
                baseRadius,
                minSide,
                time,
                palette,
                shimmer,
                bass,
                mids,
                highs,
                treble,
                hat,
            );

            const foldGradientA = ctx.createLinearGradient(
                cx - baseRadius * 1.08,
                cy - baseRadius * 0.42,
                cx + baseRadius * 0.28,
                cy + baseRadius * 0.06,
            );
            foldGradientA.addColorStop(0, `hsla(${wrapHue(palette.core - 12)}, 96%, 48%, 0)`);
            foldGradientA.addColorStop(0.32, `hsla(${wrapHue(palette.core - 4)}, 98%, 48%, 0.48)`);
            foldGradientA.addColorStop(
                0.78,
                `hsla(${wrapHue(palette.accent + shimmer)}, 100%, 60%, 0.24)`,
            );
            foldGradientA.addColorStop(1, `hsla(${wrapHue(palette.accent)}, 96%, 58%, 0)`);

            const foldGradientB = ctx.createLinearGradient(
                cx - baseRadius * 0.16,
                cy - baseRadius * 0.28,
                cx + baseRadius * 0.98,
                cy + baseRadius * 0.4,
            );
            foldGradientB.addColorStop(0, `hsla(${wrapHue(palette.glow + 12)}, 96%, 62%, 0)`);
            foldGradientB.addColorStop(
                0.4,
                `hsla(${wrapHue(palette.glow + shimmer)}, 96%, 62%, 0.4)`,
            );
            foldGradientB.addColorStop(0.76, `hsla(${wrapHue(palette.mid)}, 96%, 52%, 0.34)`);
            foldGradientB.addColorStop(1, `hsla(${wrapHue(palette.mid)}, 94%, 48%, 0)`);

            const foldGradientC = ctx.createLinearGradient(
                cx - baseRadius * 0.54,
                cy + baseRadius * 0.68,
                cx + baseRadius * 0.46,
                cy - baseRadius * 0.1,
            );
            foldGradientC.addColorStop(0, `hsla(${wrapHue(palette.edge)}, 98%, 42%, 0)`);
            foldGradientC.addColorStop(0.42, `hsla(${wrapHue(palette.edge)}, 98%, 44%, 0.44)`);
            foldGradientC.addColorStop(0.76, `hsla(${wrapHue(palette.accent)}, 100%, 58%, 0.34)`);
            foldGradientC.addColorStop(1, `hsla(${wrapHue(palette.accent)}, 98%, 58%, 0)`);

            drawSoftBlob(ctx, foldA, foldGradientA, 5.5 * dpr, 0.72 + mids * 0.14);
            drawSoftBlob(ctx, foldB, foldGradientB, 5 * dpr, 0.6 + highs * 0.12);
            drawSoftBlob(ctx, foldC, foldGradientC, 6 * dpr, 0.54 + bass * 0.16);

            ctx.globalCompositeOperation = 'multiply';
            const foldShadow = ctx.createRadialGradient(
                cx + Math.sin(time * 0.000_43) * baseRadius * 0.22,
                cy + Math.cos(time * 0.000_39) * baseRadius * 0.16,
                baseRadius * 0.12,
                cx,
                cy + baseRadius * 0.06,
                baseRadius * 1.05,
            );
            foldShadow.addColorStop(0, `hsla(${wrapHue(palette.edge - 20)}, 70%, 24%, 0.18)`);
            foldShadow.addColorStop(0.46, `hsla(${wrapHue(palette.edge - 20)}, 70%, 24%, 0.08)`);
            foldShadow.addColorStop(1, `hsla(${wrapHue(palette.edge - 20)}, 70%, 24%, 0)`);
            drawSoftBlob(
                ctx,
                flowPoints(foldB, cx, cy, minSide, time, -0.03, 0.02, 0.018, 5.8),
                foldShadow,
                8 * dpr,
                0.62 + energy * 0.18,
            );
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            drawSmoothBlob(ctx, points);
            ctx.clip();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const transientPuffs = [
                {
                    color: palette.accent,
                    phase: 0.6,
                    points: flowPoints(foldA, cx, cy, minSide, time, -0.01, 0.034, 0.028, 0.8),
                    strength: 0.18 + hat * 0.22,
                },
                {
                    color: palette.glow,
                    phase: 2.6,
                    points: flowPoints(foldB, cx, cy, minSide, time, -0.008, 0.03, 0.032, 2.9),
                    strength: 0.14 + treble * 0.16,
                },
                {
                    color: palette.edge,
                    phase: 4.2,
                    points: flowPoints(foldC, cx, cy, minSide, time, -0.012, 0.026, 0.024, 4.6),
                    strength: 0.12 + mids * 0.12,
                },
            ];

            transientPuffs.forEach((puff) => {
                const xShift = Math.sin(time * 0.000_8 + puff.phase) * baseRadius * 0.18;
                const yShift = Math.cos(time * 0.000_64 + puff.phase) * baseRadius * 0.14;
                const puffGradient = ctx.createRadialGradient(
                    cx + xShift,
                    cy + yShift,
                    baseRadius * 0.08,
                    cx + xShift,
                    cy + yShift,
                    baseRadius * (0.72 + hat * 0.12),
                );

                puffGradient.addColorStop(
                    0,
                    `hsla(${wrapHue(puff.color + shimmer)}, 100%, 68%, 0.34)`,
                );
                puffGradient.addColorStop(0.52, `hsla(${wrapHue(puff.color)}, 96%, 58%, 0.16)`);
                puffGradient.addColorStop(1, `hsla(${wrapHue(puff.color)}, 96%, 52%, 0)`);
                drawSoftBlob(ctx, puff.points, puffGradient, 7 * dpr, puff.strength);
            });
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const edgeStroke = ctx.createLinearGradient(
                cx - baseRadius * 1.2,
                cy + baseRadius * 0.44,
                cx + baseRadius * 1.15,
                cy - baseRadius * 0.28,
            );
            edgeStroke.addColorStop(0, `hsla(${wrapHue(palette.edge)}, 100%, 58%, 0)`);
            edgeStroke.addColorStop(0.24, `hsla(${wrapHue(palette.edge)}, 100%, 58%, 0.22)`);
            edgeStroke.addColorStop(0.58, `hsla(${wrapHue(palette.accent)}, 100%, 68%, 0.24)`);
            edgeStroke.addColorStop(0.84, `hsla(${wrapHue(palette.glow)}, 100%, 62%, 0.16)`);
            edgeStroke.addColorStop(1, `hsla(${wrapHue(palette.glow)}, 100%, 62%, 0)`);

            ctx.filter = `blur(${2.4 * dpr}px)`;
            ctx.globalAlpha = 0.12 + energy * 0.06;
            ctx.lineWidth = Math.max(1, minSide * (0.02 + highs * 0.008));
            ctx.strokeStyle = edgeStroke;
            drawSmoothBlob(ctx, edgeVeilA);
            ctx.stroke();

            ctx.filter = 'none';
            ctx.globalAlpha = 0.08 + mids * 0.08;
            ctx.lineWidth = Math.max(1, minSide * (0.006 + bass * 0.006));
            drawSmoothBlob(ctx, edgeVeilB);
            ctx.stroke();
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
        };
    }, [canvasRef, isPlaying, playbackType, webAudio]);

    return (
        <div className={styles.container}>
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
        <div className={styles.container}>
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
