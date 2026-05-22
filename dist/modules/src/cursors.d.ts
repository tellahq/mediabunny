/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { InputAudioTrack, InputTrack, InputVideoTrack } from './input-track.js';
import { type PacketRetrievalOptions } from './media-sink.js';
import { MaybePromise, Rotation } from './misc.js';
import { EncodedPacket } from './packet.js';
import { AudioSample, CropRectangle, VideoSample } from './sample.js';
/**
 * Cursor for sequentially reading encoded packets from an input track.
 * @public
 */
export declare class PacketCursor<T extends InputTrack = InputTrack> {
    track: T;
    current: EncodedPacket | null;
    private _reader;
    private _options;
    private _nextIsFirst;
    private _callSerializer;
    constructor(track: T, options?: PacketRetrievalOptions);
    private _seekToFirstDirect;
    seekToFirst(): MaybePromise<EncodedPacket | null>;
    seekTo(timestamp: number): MaybePromise<EncodedPacket | null>;
    seekToKey(timestamp: number): MaybePromise<EncodedPacket | null>;
    next(): MaybePromise<EncodedPacket | null>;
    nextKey(): MaybePromise<EncodedPacket | null>;
    iterate(callback: (packet: EncodedPacket) => MaybePromise<void | boolean>): Promise<void>;
    [Symbol.asyncIterator](): AsyncGenerator<EncodedPacket, void, unknown>;
    waitUntilIdle(): Promise<void> | null;
    isIdle(): boolean;
}
/**
 * Transforms decoded samples returned by a sample cursor.
 * @public
 */
export type SampleTransformer<Sample, TransformedSample> = (sample: Sample) => TransformedSample;
/**
 * Options for decoded sample cursors.
 * @public
 */
export type SampleCursorOptions<Sample, TransformedSample> = {
    autoClose?: boolean;
    transform?: SampleTransformer<Sample, TransformedSample>;
    maxBufferSize?: number;
};
/**
 * Base cursor for decoding samples from an input track.
 * @public
 */
export declare abstract class SampleCursor<Sample extends VideoSample | AudioSample, TransformedSample = Sample> implements AsyncDisposable {
    track: InputTrack;
    current: TransformedSample | null;
    private _transform;
    private _autoClose;
    private _maxBufferSize;
    private _mutex;
    private _packetReader;
    private _packetCursor;
    private _currentSample;
    /** Updated when _currentSample is updated, but reset when a new pump is started. */
    private _currentSampleTimestamp;
    /** The queue of samples that have been decoded and are now waiting. */
    private _sampleQueue;
    private _pendingRequests;
    private _lastPendingRequest;
    /** Whether the next sample is the first sample. */
    private _nextIsFirst;
    private _queuedResets;
    /** Used to pause and resume the pump. */
    private _pumpGate;
    private _pumpStopQueued;
    private _pumpStopped;
    /** The minimum target packet until which the pump should decode. */
    private _pumpTarget;
    private _lastTarget;
    private _decoderFlushPromise;
    /**
     * When this value is above 0, the pump is instructed to be lazy: that is, only decode packets until the target and
     * not further to increase decoder efficiency.
     */
    private _lazyPump;
    private _closed;
    private _closePromise;
    private _error;
    private _errorSet;
    get closed(): boolean;
    get errored(): boolean;
    get bufferState(): {
        queueLength: number;
        decodeQueueSize: number;
        pumpRunning: boolean;
        pendingRequests: number;
    };
    protected constructor(track: InputTrack, options: SampleCursorOptions<Sample, TransformedSample>);
    private _getSample;
    seekToFirst(): MaybePromise<TransformedSample | null>;
    seekTo(timestamp: number): MaybePromise<TransformedSample | null>;
    seekToKey(timestamp: number): MaybePromise<TransformedSample | null>;
    next(): MaybePromise<TransformedSample | null>;
    nextKey(): MaybePromise<TransformedSample | null>;
    hasNext(): MaybePromise<boolean>;
    iterate(callback: (sample: TransformedSample) => MaybePromise<void | boolean>): Promise<void>;
    [Symbol.asyncIterator](): AsyncGenerator<Awaited<NonNullable<TransformedSample>>, void, unknown>;
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
    reset(): Promise<void>;
    /**
     * Returns a Promise that resolves when currently pending operations (at the time of calling this method)
     * are settled, or `null` if there are none.
     */
    waitUntilIdle(): Promise<void> | null;
    isIdle(): boolean;
    protected _onDecoderSample(sample: Sample): void;
    protected _onDecoderError(error: unknown): void;
    protected _onDecoderDequeue(): void;
    private _setCurrentRaw;
    private _transformSample;
    private _seekToPacket;
    private _nextInternal;
    private _nextKeyInternal;
    private _hasNextInternal;
    /**
     * Starts the "pump process", which handles pushing packets into the decoder. It throttles itself if it is far
     * enough ahead and must be woken up again by the outside. It also stops itself when the outside tells it to.
     */
    private _runPump;
    private _stopPump;
    private _closeInternal;
    private _closeWithError;
    private _closeWithErrorAndThrow;
    /** Ensures that the cursor is not currently closed. */
    private _ensureNotClosed;
    /** Ensures that the cursor is either open or will be open again at some point, even if it currently closed. */
    private _ensureWillBeOpen;
}
/**
 * Cursor for decoding video samples from an input video track.
 * @public
 */
export declare class VideoSampleCursor<TransformedSample = VideoSample> extends SampleCursor<VideoSample, TransformedSample> {
    constructor(track: InputVideoTrack, options?: SampleCursorOptions<VideoSample, TransformedSample>);
}
/**
 * Cursor for decoding audio samples from an input audio track.
 * @public
 */
export declare class AudioSampleCursor<TransformedSample = AudioSample> extends SampleCursor<AudioSample, TransformedSample> {
    constructor(track: InputAudioTrack, options?: SampleCursorOptions<AudioSample, TransformedSample>);
}
/**
 * A canvas with additional timing information (timestamp & duration).
 * @public
 */
export declare class WrappedCanvas {
    /** A canvas element or offscreen canvas. */
    canvas: HTMLCanvasElement | OffscreenCanvas;
    /** The timestamp of the corresponding video sample, in seconds. */
    timestamp: number;
    /** The duration of the corresponding video sample, in seconds. */
    duration: number;
    constructor(canvas: HTMLCanvasElement | OffscreenCanvas, timestamp: number, duration: number);
}
/**
 * Options for constructing a canvas transformer to be used with {@link VideoSampleCursor}.
 * @public
 */
export type CanvasTransformerOptions = {
    /**
     * Whether the output canvases should have transparency instead of a black background. Defaults to `false`. Set
     * this to `true` when reading transparent videos.
     */
    alpha?: boolean;
    /**
     * The width of the output canvas in pixels, defaulting to the display width of the video track. If height is not
     * set, it will be deduced automatically based on aspect ratio.
     */
    width?: number;
    /**
     * The height of the output canvas in pixels, defaulting to the display height of the video track. If width is not
     * set, it will be deduced automatically based on aspect ratio.
     */
    height?: number;
    /**
     * The fitting algorithm in case both width and height are set.
     *
     * - `'fill'` will stretch the image to fill the entire box, potentially altering aspect ratio.
     * - `'contain'` will contain the entire image within the box while preserving aspect ratio. This may lead to
     * letterboxing.
     * - `'cover'` will scale the image until the entire box is filled, while preserving aspect ratio.
     */
    fit?: 'fill' | 'contain' | 'cover';
    /**
     * The clockwise rotation by which to rotate the raw video frame. Defaults to the rotation set in the file metadata.
     * Rotation is applied before resizing.
     */
    rotation?: Rotation;
    /**
     * Specifies the rectangular region of the input video to crop to. The crop region will automatically be clamped to
     * the dimensions of the input video track. Cropping is performed after rotation but before resizing.
     */
    crop?: CropRectangle;
    /**
     * When set, specifies the number of canvases in the pool. These canvases will be reused in a ring buffer /
     * round-robin type fashion. This keeps the amount of allocated VRAM constant and relieves the browser from
     * constantly allocating/deallocating canvases. A pool size of 0 or `undefined` disables the pool and means a new
     * canvas is created each time.
     */
    poolSize?: number;
};
/**
 * Creates a transformer that converts video samples to canvases.
 * @public
 */
export declare const canvasTransformer: (options?: CanvasTransformerOptions) => SampleTransformer<VideoSample, WrappedCanvas>;
//# sourceMappingURL=cursors.d.ts.map