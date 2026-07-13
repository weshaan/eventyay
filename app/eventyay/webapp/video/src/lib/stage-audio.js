/** Mute/unmute the global stage player while interpretation TTS is active. */

const YOUTUBE_MUTE = '{"event":"command","func":"mute","args":""}'
const YOUTUBE_UNMUTE = '{"event":"command","func":"unMute","args":""}'
const YOUTUBE_VOLUME_ZERO = '{"event":"command","func":"setVolume","args":[0]}'

function stageVideos() {
	return document.querySelectorAll('.c-media-source video, .c-livestream video')
}

function stageIframes() {
	return document.querySelectorAll(
		'#media-source-iframes iframe, iframe.iframe-media-source'
	)
}

function postYouTubeCommand(iframe, command) {
	try {
		iframe.contentWindow?.postMessage(command, '*')
	} catch (_) {
		// cross-origin or not ready
	}
}

export function muteStageAudio() {
	for (const video of stageVideos()) {
		video.muted = true
		video.volume = 0
	}
	for (const iframe of stageIframes()) {
		postYouTubeCommand(iframe, YOUTUBE_MUTE)
		postYouTubeCommand(iframe, YOUTUBE_VOLUME_ZERO)
	}
}

export function unmuteStageAudio(saved) {
	for (const video of stageVideos()) {
		if (saved?.video) {
			video.muted = saved.video.muted
			video.volume = saved.video.volume
		} else {
			video.muted = false
			video.volume = 1
		}
	}
	for (const iframe of stageIframes()) {
		postYouTubeCommand(iframe, YOUTUBE_UNMUTE)
	}
}

export function captureStageAudioState() {
	const video = stageVideos()[0]
	if (!video) return null
	return {
		video: { muted: video.muted, volume: video.volume },
	}
}
