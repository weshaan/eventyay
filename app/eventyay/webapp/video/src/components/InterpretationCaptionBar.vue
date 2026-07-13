<template lang="pug">
.c-interpretation-stage(v-if="visible")
	.c-interpretation-captions(v-if="showCaptionsPanel")
		.caption-text(:class="captionTextClass") {{ captionDisplayText }}
	.c-interpretation-toolbar
		.toolbar-error(v-if="sessionError && !showCaptionsPanel") {{ sessionError }}
		.toolbar-controls
			.lang-control
				bunt-icon-button.lang-icon(aria-hidden="true", tabindex="-1") closed-caption-outline
				select.lang-select(
					:aria-label="$t('InterpretationBar:subtitles-label:text')",
					:value="interpretationLang || ''",
					:disabled="sessionLoading",
					@change="onLangSelect"
				)
					option(value="") {{ $t('InterpretationBar:subtitles-off:text') }}
					option(v-for="option of languageOptions", :key="option.id", :value="option.id") {{ option.label }}
			bunt-icon-button.tts-btn(
				@click="toggleTts",
				:class="{active: ttsEnabled}",
				:aria-label="ttsEnabled ? $t('InterpretationBar:tts-disable:text') : $t('InterpretationBar:tts-enable:text')",
				:disabled="!interpretationLang || sessionLoading"
			) account-voice
		.toolbar-trailing
			slot(name="trailing")
</template>
<script>
import { markRaw } from 'vue'
import { languageOptionsFromCodes } from 'lib/interpretation-languages'
import {
	applyRunningInterpretation,
	applyStoppedInterpretation,
	buildCaptionsUrl,
	startInterpretationSession,
	stopInterpretationSession,
	streamUrlFromStreamModule,
} from 'lib/interpretation-api'
import {
	captureStageAudioState,
	muteStageAudio,
	unmuteStageAudio,
} from 'lib/stage-audio'

const CAPTION_CLEAR_MS = 15000

export default {
	name: 'InterpretationCaptionBar',
	props: {
		module: {
			type: Object,
			required: true
		},
		roomId: {
			type: [String, Number],
			required: true,
		},
	},
	data() {
		return {
			interpretationLang: null,
			captionText: '',
			captionClearTimer: null,
			captionStream: null,
			ttsEnabled: false,
			ttsQueue: [],
			ttsPlaying: false,
			lastTtsChunkId: 0,
			currentTtsChunkId: null,
			currentTtsAudio: null,
			stageAudioSaved: null,
			stageMuteRetryTimer: null,
			sessionLoading: false,
			sessionError: null,
		}
	},
	computed: {
		config() {
			return this.module?.config?.interpretation || null
		},
		visible() {
			return !!(this.config && this.config.room_enabled)
		},
		liveCaptions() {
			return !!(this.config?.enabled && this.captionUrl)
		},
		languages() {
			return Array.isArray(this.config?.languages) ? this.config.languages : []
		},
		languageOptions() {
			return languageOptionsFromCodes(this.languages, { includeCode: false })
		},
		captionUrl() {
			return this.config?.url || null
		},
		ttsUrl() {
			return this.config?.tts_url || this.config?.url || null
		},
		captionTextClass() {
			return {
				'is-placeholder': !this.captionText && !this.sessionError && !this.sessionLoading,
				'is-error': !!this.sessionError,
			}
		},
		captionDisplayText() {
			if (this.sessionError) return this.sessionError
			if (this.sessionLoading) return this.$t('InterpretationBar:session-starting:text')
			return this.captionText || this.$t('InterpretationBar:placeholder:text')
		},
		showCaptionsPanel() {
			return !!(this.interpretationLang || this.sessionLoading)
		},
	},
	watch: {
		languages: {
			handler(langs) {
				const codes = Array.isArray(langs) ? langs : []
				if (this.interpretationLang && !codes.includes(this.interpretationLang)) {
					this.applyLanguageSelection(null, { localOnly: true })
				}
			},
			immediate: true
		},
		liveCaptions(isLive) {
			if (!isLive) {
				this.stopCaptionStream()
				if (this.ttsEnabled) {
					this.ttsEnabled = false
					this.setInterpretationTtsActive(false)
					this.stopTtsPlayback()
				}
				if (!this.sessionLoading) {
					this.interpretationLang = null
				}
			} else if (this.interpretationLang && !this.captionStream) {
				this.startCaptionStream(this.interpretationLang)
			}
		},
		visible(isVisible) {
			if (!isVisible) this.teardown()
		},
	},
	beforeUnmount() {
		this.teardown()
	},
	methods: {
		onLangSelect(event) {
			const lang = event.target.value || null
			this.setLanguage(lang)
		},
		async setLanguage(lang) {
			const normalizedLang = lang || null
			if (normalizedLang === this.interpretationLang && !this.sessionLoading) {
				if (!normalizedLang && this.liveCaptions) {
					// Off while session still running — stop below.
				} else {
					return
				}
			}

			this.sessionError = null
			this.sessionLoading = true
			try {
				if (!normalizedLang) {
					if (this.liveCaptions) {
						try {
							await stopInterpretationSession(this.$store, this.roomId)
						} catch (err) {
							if (!String(err.message || '').toLowerCase().includes('no running')) {
								throw err
							}
						}
					}
					applyStoppedInterpretation(this.module)
					this.applyLanguageSelection(null, { localOnly: true })
					return
				}

				if (!this.liveCaptions) {
					const streamUrl = streamUrlFromStreamModule(this.module)
					if (!streamUrl) {
						throw new Error('Add a stream URL in room settings and save the room first.')
					}
					const data = await startInterpretationSession(this.$store, this.roomId, streamUrl)
					applyRunningInterpretation(this.module, {
						languages: data.target_languages || this.languages,
						captionsUrl: buildCaptionsUrl(this.$store, this.roomId),
					})
				}
				this.applyLanguageSelection(normalizedLang, { localOnly: true })
			} catch (err) {
				this.sessionError = err.message || 'Could not update caption session'
			} finally {
				this.sessionLoading = false
			}
		},
		applyLanguageSelection(lang, { localOnly = false } = {}) {
			if (lang === this.interpretationLang && localOnly) {
				if (lang && this.liveCaptions) this.startCaptionStream(lang)
				return
			}
			this.stopCaptionStream()
			this.interpretationLang = lang
			this.captionText = ''
			this.sessionError = null
			if (lang && this.liveCaptions) {
				this.startCaptionStream(lang)
			} else if (this.ttsEnabled) {
				this.ttsEnabled = false
				this.setInterpretationTtsActive(false)
				this.stopTtsPlayback()
			}
		},
		toggleTts() {
			if (this.ttsEnabled) {
				this.ttsEnabled = false
				this.setInterpretationTtsActive(false)
				this.stopTtsPlayback()
			} else {
				if (!this.captionUrl || !this.interpretationLang || !this.liveCaptions) return
				this.ttsEnabled = true
				this.setInterpretationTtsActive(true)
			}
			if (this.interpretationLang && this.liveCaptions) {
				this.startCaptionStream(this.interpretationLang)
			}
		},
		setInterpretationTtsActive(active) {
			this.$store.commit('setInterpretationTtsActive', active)
			if (active) {
				if (!this.stageAudioSaved) {
					this.stageAudioSaved = captureStageAudioState()
				}
				muteStageAudio()
				this.scheduleStageMuteRetries()
			} else {
				this.clearStageMuteRetries()
				if (this.stageAudioSaved) {
					unmuteStageAudio(this.stageAudioSaved)
					this.stageAudioSaved = null
				}
			}
		},
		scheduleStageMuteRetries() {
			this.clearStageMuteRetries()
			let attempts = 0
			this.stageMuteRetryTimer = setInterval(() => {
				if (!this.ttsEnabled || attempts >= 10) {
					this.clearStageMuteRetries()
					return
				}
				attempts += 1
				muteStageAudio()
			}, 400)
		},
		clearStageMuteRetries() {
			if (this.stageMuteRetryTimer) {
				clearInterval(this.stageMuteRetryTimer)
				this.stageMuteRetryTimer = null
			}
		},
		startCaptionStream(lang) {
			const streamUrl = this.ttsEnabled ? (this.ttsUrl || this.captionUrl) : this.captionUrl
			if (!streamUrl) return
			this.stopCaptionStream()
			const sep = streamUrl.includes('?') ? '&' : '?'
			let url = `${streamUrl}${sep}lang=${encodeURIComponent(lang)}`
			if (this.ttsEnabled) {
				url += '&tts=1'
				if (this.lastTtsChunkId > 0) {
					url += `&last_chunk_id=${this.lastTtsChunkId}`
				}
			}
			const source = markRaw(new EventSource(url, { withCredentials: true }))
			source.onmessage = (event) => {
				let data
				try {
					data = JSON.parse(event.data)
				} catch (e) {
					return
				}
				if (!data || data.status === 'connected') return
				if (data.translation || data.transcript) {
					this.applyCaption(data.translation || data.transcript || '')
				}
				if (this.ttsEnabled) {
					const chunkInt = parseInt(data.chunk_id, 10)
					if (!Number.isNaN(chunkInt) && chunkInt > this.lastTtsChunkId) {
						this.lastTtsChunkId = chunkInt
					}
					this.enqueueTtsAudio(data)
				}
			}
			source.onerror = () => { /* EventSource reconnects */ }
			this.captionStream = source
		},
		applyCaption(text) {
			if (!text) return
			this.sessionError = null
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
		enqueueTtsAudio(data) {
			if (!data?.audio_b64) return
			const chunkId = data.chunk_id
			const audioUrl = `data:audio/wav;base64,${data.audio_b64}`
			this.ttsQueue = this.ttsQueue.filter((item) => item.id !== chunkId)
			if (this.ttsPlaying && this.currentTtsChunkId === chunkId) {
				this.stopCurrentTtsAudio()
			}
			this.ttsQueue.push({ id: chunkId, url: audioUrl })
			if (!this.ttsPlaying) this.playNextTtsChunk()
		},
		playNextTtsChunk() {
			if (!this.ttsQueue.length) {
				this.ttsPlaying = false
				this.currentTtsChunkId = null
				return
			}
			this.ttsPlaying = true
			const next = this.ttsQueue.shift()
			this.currentTtsChunkId = next.id
			const audio = new Audio(next.url)
			this.currentTtsAudio = audio
			audio.onended = () => {
				this.currentTtsAudio = null
				this.playNextTtsChunk()
			}
			audio.onerror = () => {
				this.currentTtsAudio = null
				this.playNextTtsChunk()
			}
			audio.play().catch(() => {
				this.currentTtsAudio = null
				this.playNextTtsChunk()
			})
		},
		stopCurrentTtsAudio() {
			if (this.currentTtsAudio) {
				this.currentTtsAudio.pause()
				this.currentTtsAudio.src = ''
				this.currentTtsAudio = null
			}
			this.ttsPlaying = false
			this.currentTtsChunkId = null
		},
		stopTtsPlayback({ preserveChunkId = false } = {}) {
			this.stopCurrentTtsAudio()
			this.ttsQueue = []
			if (!preserveChunkId) this.lastTtsChunkId = 0
		},
		teardown() {
			this.stopCaptionStream()
			this.stopTtsPlayback()
			this.ttsEnabled = false
			this.setInterpretationTtsActive(false)
			this.interpretationLang = null
			this.sessionError = null
		}
	}
}
</script>
<style lang="stylus" scoped>
.c-interpretation-stage
	flex: none
	display: flex
	flex-direction: column
	width: 100%
	min-width: 0

.c-interpretation-captions
	box-sizing: border-box
	display: flex
	align-items: center
	width: 100%
	min-height: 48px
	padding: 10px 16px
	background-color: #0a0a0a

.caption-text
	width: 100%
	min-width: 0
	text-align: center
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
	&.is-error
		color: #ff8a80
		font-weight: 400
		font-style: normal
		white-space: normal

.c-interpretation-toolbar
	box-sizing: border-box
	display: flex
	align-items: center
	justify-content: space-between
	gap: 12px
	width: 100%
	height: 48px
	padding: 0 12px
	background-color: $clr-white
	border-top: border-separator()

.toolbar-error
	flex: 1
	min-width: 0
	font-size: 12px
	color: #c62828
	white-space: nowrap
	overflow: hidden
	text-overflow: ellipsis
	margin-right: 8px

.toolbar-controls
	display: flex
	align-items: center
	gap: 4px
	flex: none

.toolbar-trailing
	display: flex
	align-items: center
	justify-content: flex-end
	gap: 8px
	flex: none
	margin-left: auto

.lang-control
	display: flex
	align-items: center
	gap: 2px
	padding: 2px 4px 2px 0
	border-radius: 6px
	background: rgba(0, 0, 0, 0.04)

.lang-icon
	pointer-events: none
	color: rgba(0, 0, 0, 0.7)
	width: 32px
	height: 32px
	:deep(.bunt-icon)
		font-size: 20px

.lang-select
	appearance: none
	border: none
	background: transparent
	color: $clr-primary-text
	font-size: 14px
	font-weight: 500
	padding: 4px 28px 4px 4px
	cursor: pointer
	min-width: 88px
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23333333' fill-opacity='0.7' d='M1.41 0L6 4.58 10.59 0 12 1.41l-6 6-6-6z'/%3E%3C/svg%3E")
	background-repeat: no-repeat
	background-position: right 8px center
	&:disabled
		opacity: 0.6
		cursor: wait
	&:focus
		outline: 2px solid var(--clr-primary, $clr-primary)
		outline-offset: 2px
	option
		color: #111
		background: #fff

.tts-btn
	color: rgba(0, 0, 0, 0.7)
	width: 36px
	height: 36px
	border-radius: 6px
	:deep(.bunt-icon)
		font-size: 22px
	&.active
		color: var(--clr-primary, $clr-primary)
		background: rgba(0, 0, 0, 0.06)
	&:disabled
		opacity: 0.35
		pointer-events: none
</style>
