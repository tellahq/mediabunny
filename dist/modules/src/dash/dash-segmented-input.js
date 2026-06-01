/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { Input } from '../input.js';
import { SegmentedInput, } from '../segmented-input.js';
import { arrayArgmin, assert, binarySearchLessOrEqual, joinPaths, } from '../misc.js';
import { CustomPathedSource } from '../source.js';
import { DashInputFormat } from '../input-format.js';
export class DashSegmentedInput extends SegmentedInput {
    constructor(input, mpdPath, info) {
        super(input, mpdPath, null);
        this.representationInfo = info;
        this.segmentsPromise = Promise.resolve(this.createSegments());
    }
    createSegments() {
        const segments = [];
        const info = this.representationInfo;
        let initSegment = null;
        if (info.initializationTemplate) {
            const initPath = this.resolveTemplate(info.initializationTemplate, 0, 0);
            const fullPath = this.resolvePath(initPath);
            const location = {
                path: fullPath,
                offset: 0,
                length: null,
            };
            initSegment = {
                timestamp: 0,
                relativeToUnixEpoch: false,
                firstSegment: null,
                duration: 0,
                location,
                initSegment: null,
            };
        }
        let currentTime = 0;
        let segmentNumber = info.startNumber;
        let firstSegment = null;
        for (let i = 0; i < info.timeline.length; i++) {
            const entry = info.timeline[i];
            if (entry.t !== undefined) {
                currentTime = entry.t;
            }
            let repeatCount;
            if (entry.r === undefined) {
                repeatCount = 1;
            }
            else {
                if (entry.r >= 0) {
                    repeatCount = entry.r + 1;
                }
                else {
                    const nextEntry = info.timeline[i + 1];
                    if (nextEntry?.t !== undefined) {
                        repeatCount = Math.ceil((nextEntry.t - currentTime) / entry.d);
                    }
                    else if (info.duration !== null) {
                        repeatCount = Math.ceil((info.duration * info.timescale - currentTime) / entry.d);
                    }
                    else {
                        repeatCount = 1;
                    }
                    repeatCount = Math.max(0, repeatCount);
                }
            }
            for (let r = 0; r < repeatCount; r++) {
                const durationSec = entry.d / info.timescale;
                const timestampSec = currentTime / info.timescale;
                if (info.mediaTemplate) {
                    const mediaPath = this.resolveTemplate(info.mediaTemplate, segmentNumber, currentTime);
                    const fullPath = this.resolvePath(mediaPath);
                    const location = {
                        path: fullPath,
                        offset: 0,
                        length: null,
                    };
                    const segment = {
                        timestamp: timestampSec,
                        relativeToUnixEpoch: false,
                        firstSegment,
                        duration: durationSec,
                        location,
                        initSegment,
                    };
                    segments.push(segment);
                    firstSegment ??= segment;
                }
                currentTime += entry.d;
                segmentNumber++;
            }
        }
        return segments;
    }
    resolveTemplate(template, number, time) {
        const info = this.representationInfo;
        let result = template;
        result = result.replace(/\$Number(?:%0(\d+)d)?\$/g, (_, width) => {
            return width ? String(number).padStart(Number(width), '0') : String(number);
        });
        result = result.replace(/\$Time(?:%0(\d+)d)?\$/g, (_, width) => {
            return width ? String(time).padStart(Number(width), '0') : String(time);
        });
        if (info.id !== null) {
            result = result.replace(/\$RepresentationID\$/g, info.id);
        }
        if (info.bandwidth !== null) {
            result = result.replace(/\$Bandwidth\$/g, String(info.bandwidth));
        }
        return result;
    }
    resolvePath(path) {
        if (this.representationInfo.baseUrl) {
            return joinPaths(this.representationInfo.baseUrl, path);
        }
        return joinPaths(this.path, path);
    }
    async getFirstSegment() {
        const segments = await this.segmentsPromise;
        return segments[0] ?? null;
    }
    async getSegmentAt(timestamp, _options) {
        const segments = await this.segmentsPromise;
        const index = binarySearchLessOrEqual(segments, timestamp, x => x.timestamp);
        return index === -1 ? null : segments[index];
    }
    async getNextSegment(segment, _options) {
        const segments = await this.segmentsPromise;
        const index = segments.indexOf(segment);
        assert(index !== -1);
        return segments[index + 1] ?? null;
    }
    async getPreviousSegment(segment, _options) {
        const segments = await this.segmentsPromise;
        const index = segments.indexOf(segment);
        assert(index !== -1);
        return segments[index - 1] ?? null;
    }
    getInputForSegment(segment) {
        const dashSegment = segment;
        const cacheEntry = this.inputCache.find(x => x.segment === dashSegment);
        if (cacheEntry) {
            cacheEntry.age = this.nextInputCacheAge++;
            return cacheEntry.input;
        }
        let initInput = null;
        if (dashSegment.initSegment || dashSegment.firstSegment) {
            initInput = this.getInputForSegment((dashSegment.initSegment ?? dashSegment.firstSegment));
        }
        const input = new Input({
            source: new CustomPathedSource(dashSegment.location.path, async (request) => {
                assert(request.isRoot);
                const proxiedRequest = {
                    ...request,
                    isRoot: false,
                };
                let ref = await this.input._getSourceCached(proxiedRequest);
                const needsSlice = dashSegment.location.offset > 0 || dashSegment.location.length !== null;
                if (needsSlice) {
                    const slice = ref.source.slice(dashSegment.location.offset, dashSegment.location.length ?? undefined);
                    const sliceRef = slice.ref();
                    ref.free();
                    ref = sliceRef;
                }
                return ref;
            }),
            formats: this.input._formats.filter(x => !(x instanceof DashInputFormat)),
            initInput: initInput ?? undefined,
            formatOptions: this.input._formatOptions,
        });
        this.inputCache.push({
            segment: dashSegment,
            input,
            age: this.nextInputCacheAge++,
        });
        if (this.inputCache.length > this.input._segmentInputCacheSize) {
            const minAgeIndex = arrayArgmin(this.inputCache, x => x.age);
            assert(minAgeIndex !== -1);
            this.inputCache.splice(minAgeIndex, 1);
        }
        return input;
    }
    async getLiveRefreshInterval() {
        return null;
    }
}
