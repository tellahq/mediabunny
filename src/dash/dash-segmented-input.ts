import { Segment, SegmentLocation } from '../segment';
import { SegmentedInput } from '../segmented-input';
import { joinPaths } from '../misc';
import { Input } from '../input';

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

export class DashSegmentedInput extends SegmentedInput {
	representationInfo: DashRepresentationInfo;
	segmentsPromise: Promise<Segment[]>;

	constructor(input: Input, mpdPath: string, info: DashRepresentationInfo) {
		super(input, mpdPath);
		this.representationInfo = info;

		this.segmentsPromise = (async () => {
			const segments: Segment[] = [];
			const info = this.representationInfo;

			let initSegment: Segment | null = null;
			if (info.initializationTemplate) {
				const initPath = this.resolveTemplate(info.initializationTemplate, 0, 0);
				const fullPath = this.resolvePath(initPath);
				const location: SegmentLocation = {
					path: fullPath,
					offset: 0,
					length: null,
				};

				initSegment = new Segment(
					this,
					location,
					0,
					false,
					0,
					null,
					null,
					null,
					null,
				);
			}

			let currentTime = 0;
			let segmentNumber = info.startNumber;
			let firstSegment: Segment | null = null;

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
						const location: SegmentLocation = {
							path: fullPath,
							offset: 0,
							length: null,
						};

						const segment = new Segment(
							this,
							location,
							timestampSec,
							false,
							durationSec,
							null,
							null,
							firstSegment,
							initSegment,
						);

						segments.push(segment);
						firstSegment ??= segment;
					}

					currentTime += entry.d;
					segmentNumber++;
				}
			}

			return segments;
		})();
	}

	resolveTemplate(template: string, number: number, time: number): string {
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

	resolvePath(path: string): string {
		if (this.representationInfo.baseUrl) {
			return joinPaths(this.representationInfo.baseUrl, path);
		}

		return joinPaths(this.path, path);
	}

	async getSegments() {
		return this.segmentsPromise;
	}
}
