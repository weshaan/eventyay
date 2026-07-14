export const CAPTION_MIN_READ_MS = 800
export const CAPTION_MAX_READ_MS = 4500
export const CAPTION_MS_PER_CHAR = 38
export const CAPTION_CATCHUP_MIN_MS = 500

export function normalizeCaptionText(text) {
	if (!text) return ''
	return text.replace(/\.{2,}$/u, '').replace(/…$/u, '').trim()
}

export function captionReadDurationMs(text, { backlog = 0 } = {}) {
	const normalized = normalizeCaptionText(text)
	if (!normalized) return CAPTION_MIN_READ_MS
	let duration = Math.min(
		CAPTION_MAX_READ_MS,
		Math.max(CAPTION_MIN_READ_MS, normalized.length * CAPTION_MS_PER_CHAR),
	)
	if (backlog > 0) {
		const compressed = Math.round(duration / (1 + backlog * 0.5))
		duration = Math.max(CAPTION_CATCHUP_MIN_MS, compressed)
	}
	return duration
}

export function shouldAcceptCaptionChunk(chunkId, seenChunkIds) {
	if (Number.isNaN(chunkId)) return true
	return !seenChunkIds.has(chunkId)
}

export function enqueueCaption(queue, item) {
	if (!item?.text) return queue
	const chunkId = item.chunkId
	if (!Number.isNaN(chunkId)) {
		const existing = queue.findIndex((entry) => entry.chunkId === chunkId)
		if (existing !== -1) {
			const next = [...queue]
			next[existing] = item
			return next
		}
	}
	return [...queue, item].sort((left, right) => {
		if (Number.isNaN(left.chunkId)) return 1
		if (Number.isNaN(right.chunkId)) return -1
		return left.chunkId - right.chunkId
	})
}

export function advanceCaptionChunkId(current, value) {
	const chunkId = Number.parseInt(value, 10)
	return Number.isNaN(chunkId) ? current : Math.max(current, chunkId)
}

export function captionStreamStartChunkId(lastChunkId, { tts, hasCurrentCaption }) {
	return tts && hasCurrentCaption && lastChunkId > 0 ? lastChunkId - 1 : lastChunkId
}

export function buildCaptionStreamUrl(streamUrl, { language, tts, voice, lastChunkId }) {
	const params = new URLSearchParams({ lang: language })
	if (tts) params.set('tts', '1')
	if (tts && voice) params.set('voice', voice)
	if (lastChunkId > 0) params.set('last_chunk_id', String(lastChunkId))
	return `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}${params}`
}
