import { Demuxer } from '../demuxer';
import { Input } from '../input';
import { InputTrack } from '../input-track';
import { MetadataTags } from '../metadata';
import { DashRepresentationInfo, DashSegmentedInput } from './dash-segmented-input';

// Minimal XML parser for MPD manifests (no DOMParser in Web Workers)

type XmlNode = {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
};

const parseXml = (xml: string): XmlNode | null => {
	let pos = 0;

	const skipWhitespace = () => {
		while (pos < xml.length && /\s/.test(xml[pos]!)) {
			pos++;
		}
	};

	const parseAttrs = (): Record<string, string> => {
		const attrs: Record<string, string> = {};

		while (pos < xml.length) {
			skipWhitespace();
			if (pos >= xml.length || xml[pos] === '>' || xml[pos] === '/' || xml[pos] === '?') {
				break;
			}

			// Read attribute name
			let name = '';
			while (pos < xml.length && xml[pos] !== '=' && xml[pos] !== '>' && !/\s/.test(xml[pos]!)) {
				name += xml[pos++];
			}

			if (xml[pos] !== '=') {
				continue;
			}
			pos++; // skip =

			// Read attribute value
			const quote = xml[pos]!;
			if (quote !== '"' && quote !== "'") {
				continue;
			}
			pos++; // skip opening quote

			let value = '';
			while (pos < xml.length && xml[pos] !== quote) {
				value += xml[pos++];
			}
			pos++; // skip closing quote

			attrs[name] = value;
		}

		return attrs;
	};

	const parseNode = (): XmlNode | null => {
		skipWhitespace();

		if (pos >= xml.length || xml[pos] !== '<') {
			return null;
		}

		// Skip XML declaration, comments, processing instructions
		if (xml.startsWith('<?', pos)) {
			pos = xml.indexOf('?>', pos) + 2;
			return parseNode();
		}
		if (xml.startsWith('<!--', pos)) {
			pos = xml.indexOf('-->', pos) + 3;
			return parseNode();
		}
		if (xml.startsWith('<![', pos)) {
			pos = xml.indexOf(']]>', pos) + 3;
			return parseNode();
		}

		// Closing tag — stop
		if (xml[pos + 1] === '/') {
			return null;
		}

		pos++; // skip <

		// Read tag name
		let tag = '';
		while (pos < xml.length && xml[pos] !== '>' && xml[pos] !== '/' && !/\s/.test(xml[pos]!)) {
			tag += xml[pos++];
		}

		// Strip namespace prefix
		const colonIdx = tag.indexOf(':');
		if (colonIdx !== -1) {
			tag = tag.slice(colonIdx + 1);
		}

		const attrs = parseAttrs();
		skipWhitespace();

		// Self-closing tag
		if (xml[pos] === '/') {
			pos += 2; // skip />
			return { tag, attrs, children: [], text: '' };
		}

		pos++; // skip >

		// Read children and text content
		const children: XmlNode[] = [];
		let text = '';

		while (pos < xml.length) {
			skipWhitespace();

			if (xml.startsWith('</', pos)) {
				// Skip closing tag
				pos = xml.indexOf('>', pos) + 1;
				break;
			}

			if (xml[pos] === '<') {
				const child = parseNode();
				if (child) {
					children.push(child);
				}
			} else {
				// Text content
				while (pos < xml.length && xml[pos] !== '<') {
					text += xml[pos++];
				}
			}
		}

		return { tag, attrs, children, text: text.trim() };
	};

	return parseNode();
};

const findChildren = (node: XmlNode, tag: string): XmlNode[] => {
	return node.children.filter(c => c.tag === tag);
};

const findFirst = (node: XmlNode, tag: string): XmlNode | null => {
	return node.children.find(c => c.tag === tag) ?? null;
};

const getAttr = (node: XmlNode, name: string): string | null => {
	return node.attrs[name] ?? null;
};

const getNumAttr = (node: XmlNode, name: string): number | null => {
	const val = node.attrs[name];
	if (val === undefined) {
		return null;
	}

	const num = Number(val);
	return Number.isFinite(num) ? num : null;
};

type ParsedRepresentation = {
	contentType: 'video' | 'audio';
	bandwidth: number | null;
	id: string | null;
	info: DashRepresentationInfo;
};

const parseSegmentTemplate = (
	adaptationSet: XmlNode,
	representation: XmlNode,
): { initTemplate: string | null; mediaTemplate: string | null; timescale: number; startNumber: number; timeline: { t?: number; d: number; r?: number }[] } | null => {
	const segTemplate = findFirst(representation, 'SegmentTemplate')
		?? findFirst(adaptationSet, 'SegmentTemplate');

	if (!segTemplate) {
		return null;
	}

	const timescale = getNumAttr(segTemplate, 'timescale') ?? 1;
	const startNumber = getNumAttr(segTemplate, 'startNumber') ?? 0;
	const initTemplate = getAttr(segTemplate, 'initialization');
	const mediaTemplate = getAttr(segTemplate, 'media');

	const timeline: { t?: number; d: number; r?: number }[] = [];
	const timelineEl = findFirst(segTemplate, 'SegmentTimeline');

	if (timelineEl) {
		for (const entry of findChildren(timelineEl, 'S')) {
			const d = getNumAttr(entry, 'd');
			if (d === null) {
				continue;
			}

			const t = getNumAttr(entry, 't') ?? undefined;
			const r = getNumAttr(entry, 'r') ?? undefined;

			timeline.push({ t, d, r });
		}
	}

	return { initTemplate, mediaTemplate, timescale, startNumber, timeline };
};

export class DashDemuxer extends Demuxer {
	tracksPromise: Promise<InputTrack[]> | null = null;
	segmentedInputs: DashSegmentedInput[] = [];

	constructor(input: Input) {
		super(input);
	}

	async getMetadataTags(): Promise<MetadataTags> {
		return {};
	}

	async getMimeType(): Promise<string> {
		return 'application/dash+xml';
	}

	async getTracks(): Promise<InputTrack[]> {
		return this.tracksPromise ??= this._parseMpd();
	}

	async _parseMpd(): Promise<InputTrack[]> {
		const mpdText = await this._readMpdText();
		const mpdEl = parseXml(mpdText);

		if (!mpdEl || mpdEl.tag !== 'MPD') {
			throw new Error('Invalid DASH manifest: root element is not MPD.');
		}

		const periods = findChildren(mpdEl, 'Period');
		if (periods.length === 0) {
			return [];
		}

		const period = periods[0]!;
		const adaptationSets = findChildren(period, 'AdaptationSet');
		const representations: ParsedRepresentation[] = [];

		for (const adaptationSet of adaptationSets) {
			const contentType = this._getContentType(adaptationSet);
			if (contentType !== 'video' && contentType !== 'audio') {
				continue;
			}

			const repElements = findChildren(adaptationSet, 'Representation');
			const adaptBaseUrl = findFirst(adaptationSet, 'BaseURL');

			for (const repEl of repElements) {
				const segInfo = parseSegmentTemplate(adaptationSet, repEl);
				if (!segInfo) {
					continue;
				}

				const repBaseUrl = findFirst(repEl, 'BaseURL');
				const baseUrl = repBaseUrl?.text ?? adaptBaseUrl?.text ?? null;

				const info: DashRepresentationInfo = {
					id: getAttr(repEl, 'id'),
					bandwidth: getNumAttr(repEl, 'bandwidth'),
					initializationTemplate: segInfo.initTemplate,
					mediaTemplate: segInfo.mediaTemplate,
					timescale: segInfo.timescale,
					startNumber: segInfo.startNumber,
					timeline: segInfo.timeline,
					baseUrl,
				};

				representations.push({
					contentType,
					bandwidth: info.bandwidth,
					id: info.id,
					info,
				});
			}
		}

		const videoReps = representations.filter(r => r.contentType === 'video');
		const audioReps = representations.filter(r => r.contentType === 'audio');

		const bestVideo = videoReps.length > 0
			? videoReps.reduce((best, r) => (r.bandwidth ?? 0) > (best.bandwidth ?? 0) ? r : best)
			: null;
		const bestAudio = audioReps.length > 0
			? audioReps[0]!
			: null;

		const allTracks: InputTrack[] = [];

		for (const rep of [bestVideo, bestAudio]) {
			if (!rep) {
				continue;
			}

			const mpdPath = this.input._entryPath!;
			const segmentedInput = new DashSegmentedInput(this.input, mpdPath, rep.info);
			this.segmentedInputs.push(segmentedInput);

			const virtualInput = segmentedInput.toInput();
			const tracks = await virtualInput.getTracks();
			allTracks.push(...tracks);
		}

		return allTracks;
	}

	_getContentType(adaptationSet: XmlNode): string | null {
		const contentType = getAttr(adaptationSet, 'contentType');
		if (contentType) {
			return contentType.toLowerCase();
		}

		const mimeType = getAttr(adaptationSet, 'mimeType');
		if (mimeType) {
			if (mimeType.startsWith('video/')) {
				return 'video';
			}
			if (mimeType.startsWith('audio/')) {
				return 'audio';
			}
		}

		for (const rep of findChildren(adaptationSet, 'Representation')) {
			const repMime = getAttr(rep, 'mimeType');
			if (repMime) {
				if (repMime.startsWith('video/')) {
					return 'video';
				}
				if (repMime.startsWith('audio/')) {
					return 'audio';
				}
			}
		}

		return null;
	}

	async _readMpdText(): Promise<string> {
		const reader = this.input._reader;

		const fileSize = reader.fileSizeNonStrict;
		const readSize = fileSize ?? 1024 * 1024;

		let slice = reader.requestSlice(0, readSize);
		if (slice instanceof Promise) {
			slice = await slice;
		}

		if (!slice) {
			return '';
		}

		const length = slice.length;
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			bytes[i] = slice.bytes[slice.bufferPos + i]!;
		}

		return new TextDecoder().decode(bytes);
	}
}
