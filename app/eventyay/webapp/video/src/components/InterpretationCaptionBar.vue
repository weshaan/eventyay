<template lang="pug">
.c-interpretation-bar(v-if="visible")
	.caption-text(:class="{'is-placeholder': !captionText}") {{ captionText || $t('InterpretationBar:placeholder:text') }}
	.bar-controls
		.lang-control
			bunt-icon-button.lang-icon(aria-hidden="true", tabindex="-1") translate
			select.lang-select(
				:aria-label="$t('InterpretationBar:subtitles-label:text')",
				:value="interpretationLang || ''",
				@change="onLangSelect"
			)
				option(value="") {{ $t('InterpretationBar:subtitles-off:text') }}
				option(v-for="lang of languages", :key="lang", :value="lang") {{ lang }}
		bunt-icon-button.tts-btn(
			@click="toggleTts",
			:class="{active: ttsEnabled}",
			:aria-label="ttsEnabled ? $t('InterpretationBar:tts-disable:text') : $t('InterpretationBar:tts-enable:text')",
			:disabled="!interpretationLang"
		) account-voice
	audio(ref="ttsAudio", style="display:none")
</template>
<script>
import { markRaw } from 'vue'

const CAPTION_CLEAR_MS = 15000

export default {
	name: 'InterpretationCaptionBar',
	props: {
		module: {
			type: Object,
			required: true
		}
	},
	data() {
		return {
			interpretationLang: null,
			captionText: '',
			captionClearTimer: null,
			captionStream: null,
			ttsEnabled: false,
			ttsStream: null,
			ttsQueue: [],
			ttsPlaying: false
		}
	},
	computed: {
		config() {
			return this.module?.config?.interpretation || null
		},
		visible() {
			return !!(this.config && this.config.enabled)
		},
		languages() {
			return Array.isArray(this.config?.languages) ? this.config.languages : []
		},
		captionUrl() {
			return this.config?.url || null
		},
		ttsUrl() {
			return this.config?.tts_url || this.config?.url || null
		}
	},
	watch: {
		languages: {
			handler(langs) {
				if (langs?.length && !this.interpretationLang && !this.captionStream) {
					this.setLanguage(langs[0])
				}
			},
			immediate: true
		},
		visible(isVisible) {
			if (!isVisible) this.teardown()
		}
	},
	beforeUnmount() {
		this.teardown()
	},
	methods: {
		onLangSelect(event) {
			const lang = event.target.value || null
			this.setLanguage(lang)
		},
		setLanguage(lang) {
			if (lang === this.interpretationLang) return
			this.stopCaptionStream()
			this.interpretationLang = lang
			this.captionText = ''
			if (lang) {
				this.startCaptionStream(lang)
				if (this.ttsEnabled) {
					this.stopTtsStream()
					this.startTtsStream()
				}
			} else if (this.ttsEnabled) {
				this.toggleTts()
			}
		},
		toggleTts() {
			if (this.ttsEnabled) {
				this.stopTtsStream()
				this.ttsEnabled = false
			} else {
				if (!this.ttsUrl || !this.interpretationLang) return
				this.ttsEnabled = true
				this.startTtsStream()
			}
		},
		startCaptionStream(lang) {
			if (!this.captionUrl) return
			const sep = this.captionUrl.includes('?') ? '&' : '?'
			const url = `${this.captionUrl}${sep}lang=${encodeURIComponent(lang)}`
			const source = markRaw(new EventSource(url, { withCredentials: true }))
			source.onmessage = (event) => {
				let data
				try {
					data = JSON.parse(event.data)
				} catch (e) {
					return
				}
				if (!data || data.status === 'connected') return
				this.applyCaption(data.translation || data.transcript || '')
			}
			source.onerror = () => { /* EventSource reconnects */ }
			this.captionStream = source
		},
		applyCaption(text) {
			if (!text) return
			this.captionText = text
			if (this.captionClearTimer) clearTimeout(this.captionClearTimer)
			this.captionClearTimer = setTimeout(() => {
				this.captionText = ''
			}, CAPTION_CLEAR_MS)
		},
		stopCaptionStream() {
			if (this.captionStream) {
				this.captionStream.close()
				this.captionStream = null
			}
			if (this.captionClearTimer) {
				clearTimeout(this.captionClearTimer)
				this.captionClearTimer = null
			}
			this.captionText = ''
		},
		startTtsStream() {
			const lang = this.interpretationLang
			if (!lang || !this.ttsUrl) return
			const sep = this.ttsUrl.includes('?') ? '&' : '?'
			const url = `${this.ttsUrl}${sep}tts=1&lang=${encodeURIComponent(lang)}`
			const source = markRaw(new EventSource(url, { withCredentials: true }))
			source.onmessage = (event) => {
				let data
				try {
					data = JSON.parse(event.data)
				} catch (e) {
					return
				}
				if (!data || data.status === 'connected') return
				if (data.audio_b64) {
					this.ttsQueue.push(data.audio_b64)
					if (!this.ttsPlaying) this.playNextTtsChunk()
				}
			}
			this.ttsStream = source
		},
		playNextTtsChunk() {
			if (!this.ttsQueue.length) {
				this.ttsPlaying = false
				return
			}
			this.ttsPlaying = true
			const b64 = this.ttsQueue.shift()
			const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
			const blob = new Blob([bytes], { type: 'audio/wav' })
			const objectUrl = URL.createObjectURL(blob)
			const audio = this.$refs.ttsAudio
			audio.src = objectUrl
			audio.onended = () => {
				URL.revokeObjectURL(objectUrl)
				this.playNextTtsChunk()
			}
			audio.onerror = () => {
				URL.revokeObjectURL(objectUrl)
				this.playNextTtsChunk()
			}
			audio.play().catch(() => { this.playNextTtsChunk() })
		},
		stopTtsStream() {
			if (this.ttsStream) {
				this.ttsStream.close()
				this.ttsStream = null
			}
			const audio = this.$refs.ttsAudio
			if (audio) {
				audio.pause()
				audio.src = ''
			}
			this.ttsQueue = []
			this.ttsPlaying = false
		},
		teardown() {
			this.stopCaptionStream()
			this.stopTtsStream()
			this.ttsEnabled = false
			this.interpretationLang = null
		}
	}
}
</script>
<style lang="stylus" scoped>
.c-interpretation-bar
	box-sizing: border-box
	display: flex
	align-items: center
	gap: 12px
	flex: 1 1 auto
	min-width: 0
	height: 100%
	padding: 0 16px
	background-color: #0a0a0a

.caption-text
	flex: 1
	min-width: 0
	text-align: left
	color: #fff
	font-size: 16px
	line-height: 1.35
	font-weight: 500
	white-space: nowrap
	overflow: hidden
	text-overflow: ellipsis
	&.is-placeholder
		color: rgba(255, 255, 255, 0.42)
		font-weight: 400
		font-style: italic

.bar-controls
	display: flex
	align-items: center
	gap: 4px
	flex-shrink: 0

.lang-control
	display: flex
	align-items: center
	gap: 2px
	padding: 2px 4px 2px 0
	border-radius: 6px
	background: rgba(255, 255, 255, 0.06)

.lang-icon
	pointer-events: none
	color: rgba(255, 255, 255, 0.85)
	width: 36px
	height: 36px
	:deep(.bunt-icon)
		font-size: 22px

.lang-select
	appearance: none
	border: none
	background: transparent
	color: #fff
	font-size: 14px
	font-weight: 500
	padding: 8px 28px 8px 4px
	cursor: pointer
	min-width: 88px
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' fill-opacity='0.7' d='M1.41 0L6 4.58 10.59 0 12 1.41l-6 6-6-6z'/%3E%3C/svg%3E")
	background-repeat: no-repeat
	background-position: right 8px center
	&:focus
		outline: 2px solid rgba(255, 255, 255, 0.35)
		outline-offset: 2px
	option
		color: #111
		background: #fff

.tts-btn
	color: rgba(255, 255, 255, 0.85)
	width: 40px
	height: 40px
	border-radius: 6px
	:deep(.bunt-icon)
		font-size: 24px
	&.active
		color: #fff
		background: rgba(255, 255, 255, 0.14)
	&:disabled
		opacity: 0.35
		pointer-events: none
</style>
