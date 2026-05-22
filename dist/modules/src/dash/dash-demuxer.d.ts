/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { Demuxer } from '../demuxer.js';
import { Input } from '../input.js';
import { InputTrackBacking } from '../input-track.js';
import { MetadataTags } from '../metadata.js';
import { DashSegmentedInput } from './dash-segmented-input.js';
type XmlNode = {
    tag: string;
    attrs: Record<string, string>;
    children: XmlNode[];
    text: string;
};
export declare class DashDemuxer extends Demuxer {
    trackBackingsPromise: Promise<InputTrackBacking[]> | null;
    segmentedInputs: DashSegmentedInput[];
    constructor(input: Input);
    getMetadataTags(): Promise<MetadataTags>;
    getMimeType(): Promise<string>;
    getTrackBackings(): Promise<InputTrackBacking[]>;
    _parseMpd(): Promise<InputTrackBacking[]>;
    _getContentType(adaptationSet: XmlNode): string | null;
    _readMpdText(): Promise<string>;
    dispose(): void;
}
export {};
//# sourceMappingURL=dash-demuxer.d.ts.map