declare module 'castv2-client' {
    export interface CastSession {
        appId?: string;
        displayName?: string;
        sessionId?: string;
        statusText?: string;
        transportId?: string;
    }

    export class Client {
        close(): void;
        connect(host: string | { host: string; port?: number }, callback: () => void): void;
        getSessions(callback: (err: Error | null, sessions: CastSession[]) => void): void;
        join(
            session: CastSession,
            app: unknown,
            callback: (err: Error | null, player: CastPlayer) => void,
        ): void;
        launch(
            app: unknown,
            callback: (err: Error | null, player: CastPlayer) => void,
        ): void;
        on(event: 'error', listener: (err: Error) => void): void;
        setVolume(
            volume: { level?: number; muted?: boolean },
            callback?: (err: Error | null) => void,
        ): void;
    }

    export interface CastMediaStatus {
        currentTime?: number;
        idleReason?: string;
        media?: { contentId?: string; duration?: number };
        playerState?: string;
    }

    export interface CastPlayer {
        getStatus(callback: (err: Error | null, status: CastMediaStatus | null) => void): void;
        load(
            media: unknown,
            options: { autoplay?: boolean; currentTime?: number },
            callback: (err: Error | null, status?: CastMediaStatus) => void,
        ): void;
        on(event: 'status', listener: (status: CastMediaStatus) => void): void;
        pause(callback?: (err: Error | null) => void): void;
        play(callback?: (err: Error | null) => void): void;
        seek(currentTime: number, callback?: (err: Error | null) => void): void;
        stop(callback?: (err: Error | null) => void): void;
    }

    export const DefaultMediaReceiver: unknown;
}
