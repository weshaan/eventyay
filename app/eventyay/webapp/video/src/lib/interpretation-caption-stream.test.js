import assert from 'assert'
import {
	advanceCaptionChunkId,
	buildCaptionStreamUrl,
	captionReadDurationMs,
	captionStreamStartChunkId,
	enqueueCaption,
	normalizeCaptionText,
	shouldAcceptCaptionChunk,
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
	buildCaptionStreamUrl('/captions/?token=x', {
		language: 'de',
		tts: true,
		voice: 'F3',
		lastChunkId: 9,
	}),
	'/captions/?token=x&lang=de&tts=1&voice=F3&last_chunk_id=9'
)

assert.strictEqual(normalizeCaptionText('hello...'), 'hello')
assert.strictEqual(normalizeCaptionText('hello world'), 'hello world')
assert.ok(captionReadDurationMs('short') >= 800)
assert.ok(captionReadDurationMs('x'.repeat(80)) <= 4500)
assert.ok(captionReadDurationMs('hello world', { backlog: 2 }) < captionReadDurationMs('hello world'))

const seen = new Set([3])
assert.strictEqual(shouldAcceptCaptionChunk(3, seen), false)
assert.strictEqual(shouldAcceptCaptionChunk(4, seen), true)

let queue = enqueueCaption([], { chunkId: 1, text: 'first' })
queue = enqueueCaption(queue, { chunkId: 1, text: 'first final' })
assert.strictEqual(queue.length, 1)
assert.strictEqual(queue[0].text, 'first final')
queue = enqueueCaption(queue, { chunkId: 2, text: 'second' })
queue = enqueueCaption(queue, { chunkId: 3, text: 'third' })
assert.deepStrictEqual(queue.map((entry) => entry.chunkId), [1, 2, 3])

console.log('interpretation-caption-stream ok')
