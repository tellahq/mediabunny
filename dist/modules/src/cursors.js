/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { PCM_AUDIO_CODECS } from './codec.js';
import { InputAudioTrack, InputTrack, InputVideoTrack } from './input-track.js';
import { AudioDecoderWrapper, PcmAudioDecoderWrapper, VideoDecoderWrapper, } from './media-sink.js';
import { assert, AsyncMutex, ForgivingCallSerializer, defer, isFirefox, last, polyfillSymbolDispose, promiseWithResolvers, ResultValue, AsyncGate, } from './misc.js';
import { PacketReader, validatePacketRetrievalOptions, validateTimestamp, } from './packet.js';
import { clampCropRectangle, validateCropRectangle } from './sample.js';
polyfillSymbolDispose();
/**
 * Cursor for sequentially reading encoded packets from an input track.
 * @public
 */
export class PacketCursor {
    constructor(track, options = {}) {
        this.current = null;
        this._nextIsFirst = true;
        this._callSerializer = new ForgivingCallSerializer();
        if (!(track instanceof InputTrack)) {
            throw new TypeError('track must be an InputTrack.');
        }
        validatePacketRetrievalOptions(options);
        this.track = track;
        this._reader = new PacketReader(track);
        this._options = options;
    }
    _seekToFirstDirect() {
        const result = this._reader.getFirst(this._options);
        const onPacket = (packet) => {
            this._nextIsFirst = false;
            return this.current = packet;
        };
        if (result instanceof Promise) {
            return result.then(onPacket);
        }
        else {
            return onPacket(result);
        }
    }
    seekToFirst() {
        return this._callSerializer.call(() => this._seekToFirstDirect());
    }
    seekTo(timestamp) {
        validateTimestamp(timestamp);
        return this._callSerializer.call(() => {
            const result = this._reader.getAt(timestamp, this._options);
            const onPacket = (packet) => {
                this._nextIsFirst = !packet;
                return this.current = packet;
            };
            if (result instanceof Promise) {
                return result.then(onPacket);
            }
            else {
                return onPacket(result);
            }
        });
    }
    seekToKey(timestamp) {
        validateTimestamp(timestamp);
        return this._callSerializer.call(() => {
            const result = this._reader.getKeyAt(timestamp, this._options);
            const onPacket = (packet) => {
                this._nextIsFirst = !packet;
                return this.current = packet;
            };
            if (result instanceof Promise) {
                return result.then(onPacket);
            }
            else {
                return onPacket(result);
            }
        });
    }
    next() {
        return this._callSerializer.call(() => {
            if (this._nextIsFirst) {
                return this._seekToFirstDirect();
            }
            if (!this.current) {
                return null;
            }
            const result = this._reader.getNext(this.current, this._options);
            const onPacket = (packet) => {
                return this.current = packet;
            };
            if (result instanceof Promise) {
                return result.then(onPacket);
            }
            else {
                return onPacket(result);
            }
        });
    }
    nextKey() {
        return this._callSerializer.call(() => {
            if (this._nextIsFirst) {
                return this._seekToFirstDirect();
            }
            if (!this.current) {
                return null;
            }
            const result = this._reader.getNextKey(this.current, this._options);
            const onPacket = (packet) => {
                return this.current = packet;
            };
            if (result instanceof Promise) {
                return result.then(onPacket);
            }
            else {
                return onPacket(result);
            }
        });
    }
    async iterate(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function.');
        }
        const donePromise = this._callSerializer.waitUntilIdle();
        if (donePromise)
            await donePromise;
        while (true) {
            if (this.current) {
                let result = callback(this.current);
                if (result instanceof Promise)
                    result = await result;
                if (result === false) {
                    break;
                }
            }
            const result = this.next();
            if (result instanceof Promise)
                await result;
            if (!this.current) {
                break;
            }
        }
    }
    // eslint-disable-next-line @stylistic/generator-star-spacing
    async *[Symbol.asyncIterator]() {
        const donePromise = this._callSerializer.waitUntilIdle();
        if (donePromise)
            await donePromise;
        while (true) {
            if (this.current) {
                yield this.current;
            }
            const result = this.next();
            if (result instanceof Promise)
                await result;
            if (!this.current) {
                break;
            }
        }
    }
    waitUntilIdle() {
        return this._callSerializer.waitUntilIdle();
    }
    isIdle() {
        return this._callSerializer.isIdle();
    }
}
const validateSampleCursorOptions = (options) => {
    if (!options || typeof options !== 'object') {
        throw new TypeError('options must an object.');
    }
    if (options.autoClose !== undefined && typeof options.autoClose !== 'boolean') {
        throw new TypeError('options.autoClose, when provided, must be a boolean.');
    }
    if (options.transform !== undefined && typeof options.transform !== 'function') {
        throw new TypeError('options.transform, when provided, must be a function.');
    }
    if (options.maxBufferSize !== undefined
        && (!Number.isInteger(options.maxBufferSize) || options.maxBufferSize < 1)) {
        throw new TypeError('options.maxBufferSize, when provided, must be a positive integer.');
    }
};
/**
 * Base cursor for decoding samples from an input track.
 * @public
 */
export class SampleCursor {
    get closed() {
        return this._closed;
    }
    get errored() {
        return this._errorSet;
    }
    get bufferState() {
        return {
            queueLength: this._sampleQueue.length,
            decodeQueueSize: this._decoder?.getDecodeQueueSize() ?? 0,
            pumpRunning: this._pumpRunning,
            pendingRequests: this._pendingRequests.length,
        };
    }
    constructor(track, options) {
        this.current = null;
        this._mutex = new AsyncMutex();
        /** @internal */
        this._decoder = null;
        this._currentSample = null;
        /** Updated when _currentSample is updated, but reset when a new pump is started. */
        this._currentSampleTimestamp = null;
        /** The queue of samples that have been decoded and are now waiting. */
        this._sampleQueue = [];
        this._pendingRequests = [];
        this._lastPendingRequest = null;
        /** Whether the next sample is the first sample. */
        this._nextIsFirst = true;
        this._queuedResets = 0;
        /** @internal */
        this._pumpRunning = false;
        /** Used to pause and resume the pump. */
        this._pumpGate = new AsyncGate();
        this._pumpStopQueued = false;
        this._pumpStopped = new AsyncGate();
        /** The minimum target packet until which the pump should decode. */
        this._pumpTarget = null;
        this._lastTarget = null;
        this._decoderFlushPromise = null;
        /**
         * When this value is above 0, the pump is instructed to be lazy: that is, only decode packets until the target and
         * not further to increase decoder efficiency.
         */
        this._lazyPump = 0;
        this._closed = false;
        this._closePromise = null;
        this._error = null;
        this._errorSet = false;
        /**
         * A bunch of utilities for simulating certain behaviors for testing.
         * @internal
         */
        this._debug = {
            enabled: false,
            pumpsStarted: 0,
            seekPackets: [],
            decodedPackets: [],
            throwInDecoderInit: false,
            throwInPump: false,
            throwDecoderError: false,
            unthrottledPump: false,
            pumpEnded: new AsyncGate(),
        };
        this.track = track;
        this._packetReader = new PacketReader(track);
        this._packetCursor = new PacketCursor(track);
        this._autoClose = options.autoClose ?? true;
        this._transform = options.transform ?? (sample => sample);
        this._maxBufferSize = options.maxBufferSize ?? 4;
        track.input._openSampleCursors.add(this);
        const lock = this._mutex.lock();
        assert(!lock.pending);
        void this._initDecoder()
            .then(decoder => this._decoder = decoder)
            .catch(error => this._closeWithError(error, false))
            .finally(() => lock.release());
    }
    _getSample(callback) {
        this._ensureWillBeOpen();
        try {
            const result = new ResultValue();
            const promise = callback(result);
            if (result.pending) {
                return promise
                    .then(() => result.value)
                    .catch(this._closeWithErrorAndThrow.bind(this));
            }
            else {
                return result.value;
            }
        }
        catch (error) {
            this._closeWithErrorAndThrow(error);
        }
    }
    seekToFirst() {
        return this._getSample(result => this._seekToPacket(result, this._packetReader.getFirst()));
    }
    seekTo(timestamp) {
        validateTimestamp(timestamp);
        return this._getSample(result => this._seekToPacket(result, this._packetReader.getAt(timestamp)));
    }
    seekToKey(timestamp) {
        validateTimestamp(timestamp);
        return this._getSample(result => this._seekToPacket(result, this._packetReader.getKeyAt(timestamp)));
    }
    next() {
        return this._getSample(result => this._nextInternal(result));
    }
    nextKey() {
        return this._getSample(result => this._nextKeyInternal(result));
    }
    hasNext() {
        this._ensureWillBeOpen();
        try {
            const result = new ResultValue();
            const promise = this._hasNextInternal(result);
            if (result.pending) {
                return promise
                    .then(() => result.value)
                    .catch(this._closeWithErrorAndThrow.bind(this));
            }
            else {
                return result.value;
            }
        }
        catch (error) {
            this._closeWithErrorAndThrow(error);
        }
    }
    async iterate(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function.');
        }
        this._ensureWillBeOpen();
        const waitPromise = this.waitUntilIdle();
        if (waitPromise)
            await waitPromise;
        this._ensureNotClosed();
        while (true) {
            if (this.current) {
                let result = callback(this.current);
                if (result instanceof Promise)
                    result = await result;
                if (result === false) {
                    break;
                }
            }
            const result = this.next();
            if (result instanceof Promise)
                await result;
            if (!this.current) {
                break;
            }
        }
    }
    // eslint-disable-next-line @stylistic/generator-star-spacing
    async *[Symbol.asyncIterator]() {
        this._ensureWillBeOpen();
        const waitPromise = this.waitUntilIdle();
        if (waitPromise)
            await waitPromise;
        this._ensureNotClosed();
        while (true) {
            if (this.current) {
                yield this.current;
            }
            const result = this.next();
            if (result instanceof Promise)
                await result;
            if (!this.current) {
                break;
            }
        }
    }
    close() {
        return this._closePromise ??= this._closed
            ? Promise.resolve()
            : this._closeInternal();
    }
    [Symbol.asyncDispose]() {
        return this.close();
    }
    async reset() {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            this._lazyPump++;
            this._queuedResets++;
            const _ = __addDisposableResource(env_1, defer(() => this._queuedResets--), false);
            const lock = __addDisposableResource(env_1, this._mutex.lock(), false);
            if (lock.pending)
                await lock.ready;
            if (!this._closed) {
                await this._closeInternal(false);
            }
            // All of this should automatically be true after a close
            assert(!this._pumpRunning);
            assert(!this._pumpStopQueued);
            assert(!this._currentSample);
            assert(!this.current);
            assert(this._sampleQueue.length === 0);
            assert(this._pendingRequests.length === 0);
            assert(this._lastPendingRequest === null);
            assert(this._pumpTarget === null);
            assert(!this._decoder || this._decoder.closed);
            this._closed = false;
            this._closePromise = null;
            this._error = null;
            this._errorSet = false;
            this._nextIsFirst = true;
            this._lazyPump = 0;
            this.track.input._openSampleCursors.add(this);
            try {
                const newDecoder = await this._initDecoder();
                this._decoder = newDecoder;
            }
            catch (error) {
                this._closeWithErrorAndThrow(error, false);
            }
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    /**
     * Returns a Promise that resolves when currently pending operations (at the time of calling this method)
     * are settled, or `null` if there are none.
     */
    waitUntilIdle() {
        const lock = this._mutex.lock();
        if (!lock.pending && this._pendingRequests.length === 0) {
            lock.release();
            return null;
        }
        const getLastPendingPromise = () => {
            lock.release();
            if (this._pendingRequests.length === 0) {
                return;
            }
            let lastRequest = last(this._pendingRequests);
            while (lastRequest.successor) {
                lastRequest = lastRequest.successor;
            }
            return lastRequest.promise
                .catch(() => { })
                .then(() => { });
        };
        if (lock.pending) {
            assert(lock.ready);
            return lock.ready.then(getLastPendingPromise);
        }
        else {
            return getLastPendingPromise() ?? null;
        }
    }
    isIdle() {
        return this._pendingRequests.length === 0 && !this._mutex.locked;
    }
    _onDecoderSample(sample) {
        try {
            if (this._debug.enabled && this._debug.throwDecoderError) {
                sample.close();
                if (!this._closed) {
                    // Let's fake a decoder error this way
                    return this._onDecoderError(new Error('Fake decoder error!'));
                }
                else {
                    return;
                }
            }
            if (this._pendingRequests.length === 0) {
                if (this._pumpStopQueued || !this._pumpRunning) {
                    // Don't care about it anymore
                    sample.close();
                }
                else {
                    // Let's save it for later
                    this._sampleQueue.push(sample);
                }
            }
            else {
                let given = false;
                let nextInsertionIndex = 0;
                // Let's hand the sample to all matching requests
                for (let i = 0; i < this._pendingRequests.length; i++) {
                    const request = this._pendingRequests[i];
                    if (request.timestamp > sample.timestamp) {
                        break;
                    }
                    this._setCurrentRaw(sample);
                    request.resolve(this._transformSample());
                    this._pendingRequests.splice(i--, 1);
                    given = true;
                    if (request.successor) {
                        // If the request has a successor request, "unlock" that successor and add it to the
                        // start of the queue
                        this._pendingRequests.splice(nextInsertionIndex, 0, request.successor);
                        i++;
                        nextInsertionIndex++;
                    }
                }
                if (!given) {
                    sample.close();
                }
            }
            this._pumpGate.open();
        }
        catch (error) {
            void this._closeWithError(error);
        }
    }
    _onDecoderError(error) {
        void this._closeWithError(error);
    }
    _onDecoderDequeue() {
        this._pumpGate.open();
    }
    _setCurrentRaw(newCurrentRaw) {
        if (this._currentSample === newCurrentRaw) {
            return;
        }
        this._currentSample?.close();
        this._currentSample = newCurrentRaw;
        this._currentSampleTimestamp = newCurrentRaw?.timestamp ?? null;
        this.current = null;
    }
    _transformSample() {
        assert(this._currentSample && !this._currentSample.closed);
        if (this._autoClose) {
            // Here, the transformation is memoized: repeated calls will not transform the same sample twice.
            return this.current ??= this._transform(this._currentSample);
        }
        else {
            // Here, the transformation happens every time since the sample is also cloned every time
            const clone = this._currentSample.clone();
            const transformed = this._transform(clone);
            return this.current = transformed;
        }
    }
    async _seekToPacket(res, targetPacketPromise, lock) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            this._lazyPump++;
            if (!lock) {
                lock = this._mutex.lock();
                if (lock.pending)
                    await lock.ready;
            }
            const deferred = __addDisposableResource(env_2, defer(() => {
                lock?.release();
                this._lazyPump--;
            }), false);
            this._ensureNotClosed();
            // First, let's wait for the packet to be retrieved
            const targetPacket = targetPacketPromise instanceof Promise
                ? await targetPacketPromise
                : targetPacketPromise;
            if (this._debug.enabled) {
                this._debug.seekPackets.push(targetPacket);
            }
            // A null packet means we're before the first packet
            this._nextIsFirst = !targetPacket;
            if (!targetPacket) {
                this._lastTarget = null;
                this._setCurrentRaw(null);
                return res.set(null);
            }
            if (this._currentSample?.timestamp === targetPacket.timestamp && !this._currentSample.closed) {
                // We can reuse the current sample, the timestamp is the same
                return res.set(this._transformSample());
            }
            let needsNewPump;
            let lastRequest = last(this._pendingRequests) ?? null;
            while (lastRequest?.successor) {
                lastRequest = lastRequest.successor;
            }
            if (lastRequest?.timestamp === -Infinity) {
                // next() requests are queued, so in order to know if we need to start a new pump or not, we'll need to wait
                await lastRequest.promise
                    .then(() => { })
                    .catch(() => { });
                this._ensureNotClosed();
            }
            const lastTimestamp = Math.max(this._lastTarget?.timestamp ?? -Infinity, this._currentSampleTimestamp ?? -Infinity);
            if (lastTimestamp !== -Infinity && lastTimestamp <= targetPacket.timestamp) {
                // First, let's see if an already-decoded sample can satisfy the request
                while (this._sampleQueue.length > 0) {
                    const nextSample = this._sampleQueue.shift();
                    this._pumpGate.open();
                    if (targetPacket.timestamp <= nextSample.timestamp) {
                        this._setCurrentRaw(nextSample);
                        return res.set(this._transformSample());
                    }
                    else {
                        nextSample.close();
                    }
                }
                if (targetPacket.timestamp - lastTimestamp < 0.1) {
                    // The difference is too small for it to be worth to set up a new pump (especially relevant for
                    // audio tracks)
                    needsNewPump = false;
                }
                else {
                    if (this._packetCursor.current) {
                        // We need to see if the target packet is ahead of the decoder, GOP-wise
                        const nextKey = await this._packetReader.getNextKey(this._packetCursor.current, { verifyKeyPackets: true });
                        needsNewPump = !!nextKey && targetPacket.sequenceNumber >= nextKey.sequenceNumber;
                    }
                    else {
                        needsNewPump = true;
                    }
                }
            }
            else {
                // This is the first packet or we went backwards, create a new pump
                needsNewPump = true;
            }
            if (needsNewPump && this._pumpRunning) {
                await this._stopPump();
            }
            if (!this._pumpTarget || targetPacket.sequenceNumber > this._pumpTarget.sequenceNumber) {
                this._pumpTarget = targetPacket;
            }
            this._lastTarget = targetPacket;
            if (needsNewPump) {
                // Set the cursor to the right spot
                const result = this._packetCursor.seekToKey(targetPacket.timestamp);
                if (result instanceof Promise)
                    await result;
                // Start the new pump
                void this._runPump();
            }
            this._ensureNotClosed();
            // Add the request to the queue
            const request = promiseWithResolvers();
            const pendingRequest = {
                timestamp: targetPacket.timestamp,
                promise: request.promise,
                resolve: request.resolve,
                reject: request.reject,
                successor: null,
            };
            this._pendingRequests.push(pendingRequest);
            this._lastPendingRequest = pendingRequest;
            this._pumpGate.open();
            deferred.execute(); // Waiting for the return would be too long
            return res.set(await request.promise);
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    async _nextInternal(res) {
        const env_3 = { stack: [], error: void 0, hasError: false };
        try {
            const lock = __addDisposableResource(env_3, this._mutex.lock(), false);
            if (lock.pending)
                await lock.ready;
            this._ensureNotClosed();
            if (this._nextIsFirst) {
                // Easy, just seek to the first sample
                // await is important so that the lock doesn't release too early
                return await this._seekToPacket(res, this._packetReader.getFirst(), lock);
            }
            // See if the request can be satisfied using already-decoded samples
            if (this._sampleQueue.length > 0) {
                const nextSample = this._sampleQueue.shift();
                this._pumpGate.open();
                this._setCurrentRaw(nextSample);
                return res.set(this._transformSample());
            }
            if (!this._pumpRunning) {
                // No pump is running (but the cursor isn't closed), the pump must've reached the end
                this._setCurrentRaw(null);
                return res.set(null);
            }
            assert(this._lastPendingRequest);
            this._ensureNotClosed();
            // Instead of figuring out what the next presentation timestamp is (no easy way to do that), we simply add a
            // new request that can be fulfilled by *any* timestamp. This way, whatever the decoder produces next (and the
            // decoder is required to output samples in presentation order) is what we'll return.
            const request = promiseWithResolvers();
            const pendingRequest = {
                timestamp: -Infinity,
                promise: request.promise,
                resolve: request.resolve,
                reject: request.reject,
                successor: null,
            };
            if (this._pendingRequests.length === 0) {
                this._pendingRequests.push(pendingRequest);
            }
            else {
                // The request will only get "unlocked" when the previous request is fulfilled
                this._lastPendingRequest.successor = pendingRequest;
            }
            this._lastPendingRequest = pendingRequest;
            this._pumpGate.open();
            lock.release(); // Waiting for the return would be too long
            return res.set(await request.promise);
        }
        catch (e_3) {
            env_3.error = e_3;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
        }
    }
    async _nextKeyInternal(res) {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            const lock = __addDisposableResource(env_4, this._mutex.lock(), false);
            if (lock.pending)
                await lock.ready;
            this._ensureNotClosed();
            if (this._nextIsFirst) {
                // await is important so that the lock doesn't release too early
                return await this._seekToPacket(res, this._packetReader.getFirst(), lock);
            }
            let timestampToCheck;
            const lastPendingRequest = last(this._pendingRequests);
            if (lastPendingRequest && !lastPendingRequest.successor) {
                timestampToCheck = lastPendingRequest.timestamp;
            }
            else {
                if (lastPendingRequest?.successor) {
                    let last = lastPendingRequest.successor;
                    while (last.successor) {
                        last = last.successor;
                    }
                    await last.promise
                        .then(() => { })
                        .catch(() => { });
                    this._ensureNotClosed();
                }
                if (this._currentSampleTimestamp !== null) {
                    timestampToCheck = this._currentSampleTimestamp;
                }
                else {
                    // We're at the end
                    return res.set(null);
                }
            }
            // The reason we don't just call readNextKey directly is as follows: readNextKey retrieves the next key in
            // *decode* order, however we want the next key in *presentation* order. We know that at least the key frames
            // are ascending in timestamp, so we first get the current key (based on a presentation-order search), then
            // get the next key after that, which will be the answer we're looking for.
            const key = await this._packetReader.getKeyAt(timestampToCheck, { verifyKeyPackets: true });
            assert(key); // Must be
            const nextKey = await this._packetReader.getNextKey(key, { verifyKeyPackets: true });
            if (!nextKey) {
                this._setCurrentRaw(null);
                return res.set(null);
            }
            return await this._seekToPacket(res, nextKey, lock);
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    }
    async _hasNextInternal(res) {
        const env_5 = { stack: [], error: void 0, hasError: false };
        try {
            const lock = __addDisposableResource(env_5, this._mutex.lock(), false);
            if (lock.pending)
                await lock.ready;
            this._ensureNotClosed();
            if (this._nextIsFirst) {
                const first = await this._packetReader.getFirst();
                return res.set(!!first);
            }
            if (!this._pumpRunning) {
                return res.set(false);
            }
            if (this._decoderFlushPromise) {
                await this._decoderFlushPromise;
            }
            return res.set(this._sampleQueue.length > 0 || this._pumpRunning);
        }
        catch (e_5) {
            env_5.error = e_5;
            env_5.hasError = true;
        }
        finally {
            __disposeResources(env_5);
        }
    }
    /**
     * Starts the "pump process", which handles pushing packets into the decoder. It throttles itself if it is far
     * enough ahead and must be woken up again by the outside. It also stops itself when the outside tells it to.
     */
    async _runPump() {
        assert(this._packetCursor.current);
        assert(this._pumpTarget);
        assert(this._decoder);
        // Close whatever's left from the previous pump run (only relevant if the previous pump ended naturally, i.e.
        // it wasn't stopped)
        for (const sample of this._sampleQueue) {
            sample.close();
        }
        this._sampleQueue.length = 0;
        try {
            this._pumpRunning = true;
            this._currentSampleTimestamp = null;
            if (this._debug.enabled) {
                this._debug.pumpsStarted++;
            }
            // Main loop
            while (this._packetCursor.current) {
                if (this._debug.enabled && this._debug.throwInPump) {
                    throw new Error('Fake pump error!');
                }
                const isAheadOfTarget = this._packetCursor.current.sequenceNumber > this._pumpTarget.sequenceNumber;
                const nextRequestExists = this._pendingRequests.some(x => x.successor || x.timestamp === -Infinity);
                if (isAheadOfTarget && !nextRequestExists) {
                    if (this._pumpStopQueued) {
                        break;
                    }
                    if (this._lazyPump > 0) {
                        await this._pumpGate.wait();
                        continue;
                    }
                    else {
                        // We're eager! That means even if we're past the target, we'll keep decoding samples to
                        // prefill the sample queue to have samples ready. This is the common case when not batching
                        // commands.
                    }
                }
                const decodeQueueSize = this._decoder.getDecodeQueueSize();
                if (this._sampleQueue.length + decodeQueueSize >= this._maxBufferSize
                    && !this._pumpStopQueued
                    && !(this._debug.enabled && this._debug.unthrottledPump)) {
                    await this._pumpGate.wait();
                    continue;
                }
                // Send the packet to the decoder
                this._decoder.decode(this._packetCursor.current);
                if (this._debug.enabled) {
                    this._debug.decodedPackets.push(this._packetCursor.current);
                }
                // Advance the cursor
                const maybePromise = this._packetCursor.next();
                if (maybePromise instanceof Promise)
                    await maybePromise;
            }
            if (!this._closed || this._pendingRequests.length > 0) {
                const { promise, resolve } = promiseWithResolvers();
                this._decoderFlushPromise = promise;
                try {
                    await this._decoder.flush();
                }
                finally {
                    resolve();
                    this._decoderFlushPromise = null;
                }
            }
            else {
                // We're closed with no pending requests, don't bother flushing what's left
            }
            // Resolve whatever requests remain with null. The reason this is correct: assume there are still pending
            // requests. Then the above flush() call ensured that all possible samples that we can get from the decoder
            // we have received. If some of the pending requests are still unsatisfied after seeing all samples we
            // decoded, then there is no other way for them to be solved but with null.
            const resolveWithNull = (request) => {
                this._setCurrentRaw(null); // Note that this only runs if there exists at least one pending request
                request.resolve(null);
                if (request.successor) {
                    resolveWithNull(request.successor);
                }
            };
            this._pendingRequests.forEach(resolveWithNull);
        }
        catch (error) {
            if (!this._decoder.closed && this._pendingRequests.length > 0) {
                // The pump errored but the decoder is still fine, let's first flush the decoder before continuing
                await this._decoder.flush();
            }
            this._pumpRunning = false; // So that close() doesn't attempt to stop the pump
            void this._closeWithError(error);
        }
        finally {
            this._pendingRequests.length = 0;
            this._lastPendingRequest = null;
            this._pumpRunning = false;
            this._pumpTarget = null;
            this._pumpStopQueued = false;
            this._lastTarget = null;
            this._pumpStopped.open();
            if (this._debug.enabled) {
                this._debug.pumpEnded.open();
            }
        }
    }
    async _stopPump() {
        assert(this._pumpRunning);
        this._pumpStopQueued = true;
        this._pumpGate.open();
        for (const sample of this._sampleQueue) {
            sample.close();
        }
        this._sampleQueue.length = 0;
        await this._pumpStopped.wait();
    }
    async _closeInternal(doLock = true) {
        const env_6 = { stack: [], error: void 0, hasError: false };
        try {
            this._lazyPump++;
            this.track.input._openSampleCursors.delete(this);
            let lock = null;
            if (doLock) {
                lock = this._mutex.lock();
                if (lock.pending)
                    await lock.ready;
            }
            const _ = __addDisposableResource(env_6, defer(() => lock?.release()), false);
            this._closed = true;
            if (this._pumpRunning) {
                await this._stopPump();
            }
            for (const sample of this._sampleQueue) {
                sample.close();
            }
            this._sampleQueue.length = 0;
            this._setCurrentRaw(null);
            this._decoder?.close();
            this._decoder = null;
        }
        catch (e_6) {
            env_6.error = e_6;
            env_6.hasError = true;
        }
        finally {
            __disposeResources(env_6);
        }
    }
    _closeWithError(error, doLock) {
        if (this._closed) {
            return;
        }
        this._closed = true;
        this._error = error;
        this._errorSet = true;
        const rejectWithError = (request) => {
            request.reject(error);
            if (request.successor) {
                rejectWithError(request.successor);
            }
        };
        this._pendingRequests.forEach(rejectWithError);
        return this._closeInternal(doLock);
    }
    _closeWithErrorAndThrow(error, doLock) {
        void this._closeWithError(error, doLock);
        throw error;
    }
    /** Ensures that the cursor is not currently closed. */
    _ensureNotClosed() {
        if (this.closed) {
            if (this._errorSet) {
                throw this._error;
            }
            else {
                throw new Error('This cursor has been closed and can no longer be used.');
            }
        }
    }
    /** Ensures that the cursor is either open or will be open again at some point, even if it currently closed. */
    _ensureWillBeOpen() {
        if (this._queuedResets > 0) {
            return;
        }
        this._ensureNotClosed();
    }
}
/**
 * Cursor for decoding video samples from an input video track.
 * @public
 */
export class VideoSampleCursor extends SampleCursor {
    constructor(track, options = {}) {
        if (!(track instanceof InputVideoTrack)) {
            throw new TypeError('track must be an InputVideoTrack.');
        }
        validateSampleCursorOptions(options);
        super(track, options);
    }
    /** @internal */
    async _initDecoder() {
        const track = this.track;
        if (!(await track.canDecode())) {
            throw new Error('This video track cannot be decoded by this browser. Make sure to check decodability before using'
                + ' a track.');
        }
        if (this._debug.enabled && this._debug.throwInDecoderInit) {
            throw new Error('Fake decoder init error!');
        }
        const decoderConfig = await track.getDecoderConfig();
        const codec = await track.getCodec();
        const rotation = await track.getRotation();
        const timeResolution = await track.getTimeResolution();
        assert(decoderConfig);
        assert(codec);
        const decoder = new VideoDecoderWrapper(sample => this._onDecoderSample(sample), error => this._onDecoderError(error), codec, decoderConfig, rotation, timeResolution);
        decoder.onDequeue = () => this._onDecoderDequeue();
        return decoder;
    }
}
/**
 * Cursor for decoding audio samples from an input audio track.
 * @public
 */
export class AudioSampleCursor extends SampleCursor {
    constructor(track, options = {}) {
        if (!(track instanceof InputAudioTrack)) {
            throw new TypeError('track must be an InputAudioTrack.');
        }
        validateSampleCursorOptions(options);
        super(track, options);
    }
    /** @internal */
    async _initDecoder() {
        const track = this.track;
        if (!(await track.canDecode())) {
            throw new Error('This audio track cannot be decoded by this browser. Make sure to check decodability before using'
                + ' a track.');
        }
        if (this._debug.enabled && this._debug.throwInDecoderInit) {
            throw new Error('Fake decoder init error!');
        }
        const codec = await track.getCodec();
        const decoderConfig = await track.getDecoderConfig();
        assert(codec && decoderConfig);
        let decoder;
        if (PCM_AUDIO_CODECS.includes(decoderConfig.codec)) {
            decoder = new PcmAudioDecoderWrapper(sample => this._onDecoderSample(sample), error => this._onDecoderError(error), decoderConfig);
        }
        else {
            decoder = new AudioDecoderWrapper(sample => this._onDecoderSample(sample), error => this._onDecoderError(error), codec, decoderConfig);
        }
        decoder.onDequeue = () => this._onDecoderDequeue();
        return decoder;
    }
}
/**
 * A canvas with additional timing information (timestamp & duration).
 * @public
 */
export class WrappedCanvas {
    constructor(canvas, timestamp, duration) {
        this.canvas = canvas;
        this.timestamp = timestamp;
        this.duration = duration;
    }
}
;
/**
 * Creates a transformer that converts video samples to canvases.
 * @public
 */
export const canvasTransformer = (options = {}) => {
    if (options && typeof options !== 'object') {
        throw new TypeError('options must be an object.');
    }
    if (options.alpha !== undefined && typeof options.alpha !== 'boolean') {
        throw new TypeError('options.alpha, when provided, must be a boolean.');
    }
    if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
        throw new TypeError('options.width, when defined, must be a positive integer.');
    }
    if (options.height !== undefined && (!Number.isInteger(options.height) || options.height <= 0)) {
        throw new TypeError('options.height, when defined, must be a positive integer.');
    }
    if (options.fit !== undefined && !['fill', 'contain', 'cover'].includes(options.fit)) {
        throw new TypeError('options.fit, when provided, must be one of "fill", "contain", or "cover".');
    }
    if (options.width !== undefined
        && options.height !== undefined
        && options.fit === undefined) {
        throw new TypeError('When both options.width and options.height are provided, options.fit must also be provided.');
    }
    if (options.rotation !== undefined && ![0, 90, 180, 270].includes(options.rotation)) {
        throw new TypeError('options.rotation, when provided, must be 0, 90, 180 or 270.');
    }
    if (options.crop !== undefined) {
        validateCropRectangle(options.crop, 'options.');
    }
    if (options.poolSize !== undefined
        && (typeof options.poolSize !== 'number' || !Number.isInteger(options.poolSize) || options.poolSize < 0)) {
        throw new TypeError('poolSize must be a non-negative integer.');
    }
    let needsSetup = true;
    let alpha;
    let width;
    let height;
    let fit;
    let rotation;
    let crop;
    let canvasPool;
    let nextCanvasIndex = 0;
    return (sample) => {
        if (needsSetup) {
            rotation = options.rotation ?? sample.rotation;
            const [rotatedWidth, rotatedHeight] = rotation % 180 === 0
                ? [sample.codedWidth, sample.codedHeight]
                : [sample.codedHeight, sample.codedWidth];
            crop = options.crop;
            if (crop) {
                clampCropRectangle(crop, rotatedWidth, rotatedHeight);
            }
            [width, height] = crop
                ? [crop.width, crop.height]
                : [rotatedWidth, rotatedHeight];
            const originalAspectRatio = width / height;
            // If width and height aren't defined together, deduce the missing value using the aspect ratio
            if (options.width !== undefined && options.height === undefined) {
                width = options.width;
                height = Math.round(width / originalAspectRatio);
            }
            else if (options.width === undefined && options.height !== undefined) {
                height = options.height;
                width = Math.round(height * originalAspectRatio);
            }
            else if (options.width !== undefined && options.height !== undefined) {
                width = options.width;
                height = options.height;
            }
            alpha = options.alpha ?? false;
            fit = options.fit ?? 'fill';
            canvasPool = Array.from({ length: options.poolSize ?? 0 }, () => null);
            needsSetup = false;
        }
        let canvas = canvasPool[nextCanvasIndex];
        let canvasIsNew = false;
        if (!canvas) {
            if (typeof document !== 'undefined') {
                // Prefer an HTMLCanvasElement
                canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
            }
            else {
                canvas = new OffscreenCanvas(width, height);
            }
            if (canvasPool.length > 0) {
                canvasPool[nextCanvasIndex] = canvas;
            }
            canvasIsNew = true;
        }
        if (canvasPool.length > 0) {
            nextCanvasIndex = (nextCanvasIndex + 1) % canvasPool.length;
        }
        const context = canvas.getContext('2d', {
            alpha: alpha || isFirefox(), // Firefox has VideoFrame glitches with opaque canvases
        });
        assert(context);
        context.resetTransform();
        if (!canvasIsNew) {
            if (!alpha && isFirefox()) {
                context.fillStyle = 'black';
                context.fillRect(0, 0, width, height);
            }
            else {
                context.clearRect(0, 0, width, height);
            }
        }
        sample.drawWithFit(context, { fit, rotation, crop });
        sample.close();
        return new WrappedCanvas(canvas, sample.timestamp, sample.duration);
    };
};
