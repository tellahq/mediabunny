/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { Input } from '../input.js';
import { Segment, SegmentedInput, SegmentRetrievalOptions } from '../segmented-input.js';
type SegmentTimelineEntry = {
    t?: number;
    d: number;
    r?: number;
};
export type DashRepresentationInfo = {
    id: string | null;
    bandwidth: number | null;
    initializationTemplate: string | null;
    mediaTemplate: string | null;
    timescale: number;
    startNumber: number;
    timeline: SegmentTimelineEntry[];
    baseUrl: string | null;
    duration: number | null;
};
type DashSegmentLocation = {
    path: string;
    offset: number;
    length: number | null;
};
type DashSegment = Segment & {
    location: DashSegmentLocation;
    firstSegment: DashSegment | null;
    initSegment: DashSegment | null;
};
export declare class DashSegmentedInput extends SegmentedInput {
    representationInfo: DashRepresentationInfo;
    segmentsPromise: Promise<DashSegment[]>;
    constructor(input: Input, mpdPath: string, info: DashRepresentationInfo);
    createSegments(): DashSegment[];
    resolveTemplate(template: string, number: number, time: number): string;
    resolvePath(path: string): string;
    getFirstSegment(): Promise<DashSegment | null>;
    getSegmentAt(timestamp: number, _options: SegmentRetrievalOptions): Promise<DashSegment | null>;
    getNextSegment(segment: Segment, _options: SegmentRetrievalOptions): Promise<DashSegment | null>;
    getPreviousSegment(segment: Segment, _options: SegmentRetrievalOptions): Promise<DashSegment | null>;
    getInputForSegment(segment: Segment): Input;
    getLiveRefreshInterval(): Promise<null>;
}
export {};
//# sourceMappingURL=dash-segmented-input.d.ts.map