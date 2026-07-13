export function advanceCaptionChunkId(current, value) {
	const chunkId = Number.parseInt(value, 10)
	return Number.isNaN(chunkId) ? current : Math.max(current, chunkId)
}

export function captionStreamStartChunkId(lastChunkId, { tts, hasCurrentCaption }) {
	return tts && hasCurrentCaption && lastChunkId > 0 ? lastChunkId - 1 : lastChunkId
}

export function buildCaptionStreamUrl(streamUrl, { language, tts, lastChunkId }) {
	const params = new URLSearchParams({ lang: language })
	if (tts) params.set('tts', '1')
	if (lastChunkId > 0) params.set('last_chunk_id', String(lastChunkId))
	return `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}${params}`
}
