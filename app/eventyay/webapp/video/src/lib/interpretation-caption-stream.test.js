import assert from 'assert'
import {
	advanceCaptionChunkId,
	buildCaptionStreamUrl,
	captionStreamStartChunkId,
} from './interpretation-caption-stream.js'

assert.strictEqual(advanceCaptionChunkId(7, '9'), 9)
assert.strictEqual(advanceCaptionChunkId(9, '7'), 9)
assert.strictEqual(advanceCaptionChunkId(9, 'invalid'), 9)
assert.strictEqual(captionStreamStartChunkId(9, { tts: false, hasCurrentCaption: true }), 9)
assert.strictEqual(captionStreamStartChunkId(9, { tts: true, hasCurrentCaption: false }), 9)
assert.strictEqual(captionStreamStartChunkId(9, { tts: true, hasCurrentCaption: true }), 8)

assert.strictEqual(
	buildCaptionStreamUrl('/captions/', { language: 'de', tts: false, lastChunkId: 9 }),
	'/captions/?lang=de&last_chunk_id=9'
)
assert.strictEqual(
	buildCaptionStreamUrl('/captions/?token=x', { language: 'de', tts: true, lastChunkId: 9 }),
	'/captions/?token=x&lang=de&tts=1&last_chunk_id=9'
)

console.log('interpretation-caption-stream ok')
