import { expect, test } from 'vitest';
import { Input } from '../../src/input.js';
import { DASH, MP4 } from '../../src/input-format.js';
import { DashSegmentedInput, type DashRepresentationInfo } from '../../src/dash/dash-segmented-input.js';
import { BufferSource, CustomPathedSource, FilePathSource } from '../../src/source.js';

const asSegments = (input: DashSegmentedInput) => {
	return input.createSegments() as unknown as {
		timestamp: number;
		duration: number;
		location: { path: string };
	}[];
};

test('DASH SegmentTemplate defaults startNumber to one and resolves relative BaseURL', async () => {
	const mpd = new TextEncoder().encode(`
		<MPD mediaPresentationDuration="PT1S">
			<Period>
				<AdaptationSet contentType="video">
					<BaseURL>../</BaseURL>
					<Representation id="v" bandwidth="1" mimeType="video/mp4">
						<SegmentTemplate media="video-$Number$.mp4" duration="1" timescale="1" />
					</Representation>
				</AdaptationSet>
			</Period>
		</MPD>
	`);
	const requestedPaths: string[] = [];

	using input = new Input({
		source: new CustomPathedSource('test/public/dash/manifest.mpd', (request) => {
			requestedPaths.push(request.path);

			if (request.isRoot) {
				return new BufferSource(mpd);
			}

			expect(request.path).toBe('test/public/video-1.mp4');
			return new FilePathSource('test/public/video.mp4');
		}),
		formats: [DASH, MP4],
	});

	expect(await input.getFormat()).toBe(DASH);
	expect(await input.getTracks()).not.toHaveLength(0);
	expect(requestedPaths).toContain('test/public/video-1.mp4');
});

test('DASH open-ended SegmentTimeline repeats until next segment or duration', () => {
	const info: DashRepresentationInfo = {
		id: 'v',
		bandwidth: 1,
		initializationTemplate: null,
		mediaTemplate: 'segment-$Number$.m4s',
		timescale: 1,
		startNumber: 1,
		timeline: [
			{ t: 0, d: 2, r: -1 },
			{ t: 8, d: 4 },
		],
		baseUrl: 'https://example.com/video/',
		duration: 12,
	};

	const input = new DashSegmentedInput({} as Input, 'https://example.com/manifest.mpd', info);
	const segments = asSegments(input);

	expect(segments.map(x => x.timestamp)).toEqual([0, 2, 4, 6, 8]);
	expect(segments.map(x => x.location.path)).toEqual([
		'https://example.com/video/segment-1.m4s',
		'https://example.com/video/segment-2.m4s',
		'https://example.com/video/segment-3.m4s',
		'https://example.com/video/segment-4.m4s',
		'https://example.com/video/segment-5.m4s',
	]);
});

