import { Input } from '../input';
import {
	Segment,
	SegmentedInput,
	SegmentRetrievalOptions,
} from '../segmented-input';
import {
	arrayArgmin,
	assert,
	binarySearchLessOrEqual,
	joinPaths,
} from '../misc';
import { CustomPathedSource, SourceRef, SourceRequest } from '../source';
import { DashInputFormat } from '../input-format';

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

export class DashSegmentedInput extends SegmentedInput {
	representationInfo: DashRepresentationInfo;
	segmentsPromise: Promise<DashSegment[]>;

	constructor(input: Input, mpdPath: string, info: DashRepresentationInfo) {
		super(input, mpdPath, null);
		this.representationInfo = info;
		this.segmentsPromise = Promise.resolve(this.createSegments());
	}

	createSegments() {
		const segments: DashSegment[] = [];
		const info = this.representationInfo;

		let initSegment: DashSegment | null = null;
		if (info.initializationTemplate) {
			const initPath = this.resolveTemplate(info.initializationTemplate, 0, 0);
			const fullPath = this.resolvePath(initPath);
			const location: DashSegmentLocation = {
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
		let firstSegment: DashSegment | null = null;

		for (const entry of info.timeline) {
			if (entry.t !== undefined) {
				currentTime = entry.t;
			}

			const repeatCount = (entry.r ?? 0) + 1;

			for (let r = 0; r < repeatCount; r++) {
				const durationSec = entry.d / info.timescale;
				const timestampSec = currentTime / info.timescale;

				if (info.mediaTemplate) {
					const mediaPath = this.resolveTemplate(
						info.mediaTemplate,
						segmentNumber,
						currentTime,
					);
					const fullPath = this.resolvePath(mediaPath);
					const location: DashSegmentLocation = {
						path: fullPath,
						offset: 0,
						length: null,
					};

					const segment: DashSegment = {
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

	resolveTemplate(template: string, number: number, time: number) {
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

	resolvePath(path: string) {
		if (this.representationInfo.baseUrl) {
			return joinPaths(this.representationInfo.baseUrl, path);
		}

		return joinPaths(this.path, path);
	}

	async getFirstSegment() {
		const segments = await this.segmentsPromise;
		return segments[0] ?? null;
	}

	async getSegmentAt(timestamp: number, _options: SegmentRetrievalOptions) {
		const segments = await this.segmentsPromise;
		const index = binarySearchLessOrEqual(segments, timestamp, x => x.timestamp);

		return index === -1 ? null : segments[index]!;
	}

	async getNextSegment(segment: Segment, _options: SegmentRetrievalOptions) {
		const segments = await this.segmentsPromise;
		const index = segments.indexOf(segment as DashSegment);
		assert(index !== -1);

		return segments[index + 1] ?? null;
	}

	async getPreviousSegment(segment: Segment, _options: SegmentRetrievalOptions) {
		const segments = await this.segmentsPromise;
		const index = segments.indexOf(segment as DashSegment);
		assert(index !== -1);

		return segments[index - 1] ?? null;
	}

	getInputForSegment(segment: Segment) {
		const dashSegment = segment as DashSegment;

		const cacheEntry = this.inputCache.find(x => x.segment === dashSegment);
		if (cacheEntry) {
			cacheEntry.age = this.nextInputCacheAge++;
			return cacheEntry.input;
		}

		let initInput: Input | null = null;
		if (dashSegment.initSegment || dashSegment.firstSegment) {
			initInput = this.getInputForSegment((dashSegment.initSegment ?? dashSegment.firstSegment)!);
		}

		const input = new Input({
			source: new CustomPathedSource(
				dashSegment.location.path,
				async (request) => {
					assert(request.isRoot);

					const proxiedRequest: SourceRequest = {
						...request,
						isRoot: false,
					};

					let ref: SourceRef = await this.input._getSourceCached(proxiedRequest);
					const needsSlice = dashSegment.location.offset > 0 || dashSegment.location.length !== null;

					if (needsSlice) {
						const slice = ref.source.slice(
							dashSegment.location.offset,
							dashSegment.location.length ?? undefined,
						);
						const sliceRef = slice.ref();
						ref.free();
						ref = sliceRef;
					}

					return ref;
				},
			),
			formats: this.input._formats.filter(x => !(x instanceof DashInputFormat)),
			initInput: initInput ?? undefined,
			formatOptions: this.input._formatOptions,
		});

		this.inputCache.push({
			segment: dashSegment,
			input,
			age: this.nextInputCacheAge++,
		});

		const MAX_INPUT_CACHE_SIZE = 4;
		if (this.inputCache.length > MAX_INPUT_CACHE_SIZE) {
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
