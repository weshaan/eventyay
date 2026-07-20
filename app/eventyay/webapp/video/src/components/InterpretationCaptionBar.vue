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
			.tts-split(:class="{active: ttsEnabled, 'has-voices': ttsVoices.length > 1}")
				bunt-icon-button.tts-btn.tts-split-main(
					@click="toggleTts",
					:class="{active: ttsEnabled}",
					:aria-label="ttsEnabled ? $t('InterpretationBar:tts-disable:text') : $t('InterpretationBar:tts-enable:text')",
					:disabled="!interpretationLang || sessionLoading"
				) account-voice
				menu-dropdown.tts-voice-menu(
					v-if="ttsVoices.length > 1",
					v-model="ttsVoiceMenuOpen",
					:blockBackground="false",
					placement="bottom-start",
					:offset="[0, 4]"
				)
					template(#button="{toggle}")
						bunt-icon-button.tts-split-toggle(
							@click="toggle",
							:disabled="!interpretationLang || sessionLoading",
							:aria-label="$t('InterpretationBar:tts-voice:text')",
						) chevron-down
					template(#menu)
						button.tts-voice-option(
							v-for="voice of ttsVoices",
							:key="voice.id",
							type="button",
							:class="{selected: voice.id === ttsVoice}",
							@click="selectTtsVoice(voice.id)"
						) {{ voice.label }}
		.toolbar-trailing
			slot(name="trailing")
</template>
<script>
import { markRaw } from 'vue'
import {
	advanceCaptionChunkId,
	buildCaptionStreamUrl,
	captionReadDurationMs,
	captionStreamStartChunkId,
	enqueueCaption,
	normalizeCaptionText,
	shouldAcceptCaptionChunk,
} from 'lib/interpretation-caption-stream'
import { languageOptionsFromCodes } from 'lib/interpretation-languages'
import {
	applyRunningInterpretation,
	applyStoppedInterpretation,
	buildCaptionsUrl,
	startInterpretationSession,
	stopInterpretationSession,
	streamUrlFromStreamModule,
} from 'lib/interpretation-api'
import MenuDropdown from 'components/MenuDropdown'
import { mapState } from 'vuex'

const CAPTION_IDLE_CLEAR_MS = 15000

export default {
	name: 'InterpretationCaptionBar',
	components: { MenuDropdown },
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
			captionQueue: [],
			seenCaptionChunkIds: new Set(),
			captionHoldUntil: 0,
			captionHoldTimer: null,
			captionIdleTimer: null,
			captionStream: null,
			ttsEnabled: false,
			ttsVoice: 'auto',
			ttsVoices: [],
			ttsVoiceMenuOpen: false,
			ttsQueue: [],
			ttsAudioChunkIds: new Set(),
			ttsPlaying: false,
			lastCaptionChunkId: 0,
			lastCaptionDisplayChunkId: null,
			currentTtsChunkId: null,
			currentTtsAudio: null,
			sessionLoading: false,
			sessionError: null,
		}
	},
	computed: {
		...mapState(['interpretationTtsVolume', 'interpretationTtsMuted']),
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
		effectiveTtsVolume() {
			if (this.interpretationTtsMuted) return 0
			return this.interpretationTtsVolume
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
				this.lastCaptionChunkId = 0
			} else if (this.interpretationLang && !this.captionStream) {
				this.startCaptionStream(this.interpretationLang)
			}
		},
		visible(isVisible) {
			if (!isVisible) this.teardown()
		},
		effectiveTtsVolume(volume) {
			if (this.currentTtsAudio) this.currentTtsAudio.volume = volume
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
					this.lastCaptionChunkId = 0
					return
				}

				if (!this.liveCaptions) {
					this.lastCaptionChunkId = 0
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
			const languageChanged = lang !== this.interpretationLang
			this.stopCaptionStream()
			if (languageChanged && this.ttsEnabled) this.stopTtsPlayback()
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
		},
		selectTtsVoice(voice) {
			if (voice === this.ttsVoice || !this.ttsVoices.some((option) => option.id === voice)) {
				this.ttsVoiceMenuOpen = false
				return
			}
			this.ttsVoice = voice
			this.ttsVoiceMenuOpen = false
			if (this.ttsEnabled && this.interpretationLang && this.liveCaptions) {
				this.stopTtsPlayback()
				this.startCaptionStream(this.interpretationLang)
			}
		},
		applyTtsVoices(data) {
			if (!Array.isArray(data?.tts_voices)) return
			const voices = data.tts_voices.filter((voice) => (
				voice
				&& typeof voice.id === 'string'
				&& voice.id
				&& typeof voice.label === 'string'
				&& voice.label
			))
			if (!voices.length) return
			this.ttsVoices = voices
			if (!voices.some((voice) => voice.id === this.ttsVoice)) {
				const defaultVoice = data.tts_default_voice
				&& voices.some((voice) => voice.id === data.tts_default_voice)
				? data.tts_default_voice
				: voices[0].id
				this.ttsVoice = defaultVoice
			}
		},
		startCaptionStream(lang) {
			const streamUrl = this.ttsEnabled ? (this.ttsUrl || this.captionUrl) : this.captionUrl
			if (!streamUrl) return
			const ttsForStream = this.ttsEnabled
			const streamStartChunkId = captionStreamStartChunkId(this.lastCaptionChunkId, {
				tts: ttsForStream,
				hasCurrentCaption: !!this.captionText,
			})
			this.stopCaptionStream({ clearCaption: false })
			this.seenCaptionChunkIds = new Set()
			this.captionQueue = []
			const url = buildCaptionStreamUrl(streamUrl, {
				language: lang,
				tts: ttsForStream,
				voice: ttsForStream ? this.ttsVoice : '',
				lastChunkId: streamStartChunkId,
			})
			const source = markRaw(new EventSource(url, { withCredentials: true }))
			source.onmessage = (event) => {
				if (this.captionStream !== source) return
				let data
				try {
					data = JSON.parse(event.data)
				} catch (e) {
					return
				}
				if (!data) return
				if (data.status === 'connected') {
					this.applyTtsVoices(data)
					return
				}
				const chunkId = Number.parseInt(data.chunk_id, 10)
				if (!Number.isNaN(chunkId) && chunkId <= streamStartChunkId) return
				this.lastCaptionChunkId = advanceCaptionChunkId(this.lastCaptionChunkId, data.chunk_id)
				const text = normalizeCaptionText(data.translation || data.transcript || '')
				if (shouldAcceptCaptionChunk(chunkId, this.seenCaptionChunkIds)) {
					this.enqueueStreamCaption({ chunkId, text })
				}
				if (ttsForStream) this.enqueueTtsAudio(data)
			}
			source.onerror = () => { /* EventSource reconnects */ }
			this.captionStream = source
		},
		enqueueStreamCaption({ chunkId, text }) {
			if (!text) return
			this.captionQueue = enqueueCaption(this.captionQueue, { chunkId, text })
			this.pumpCaptionQueue()
		},
		clearCaptionScheduler() {
			if (this.captionHoldTimer) {
				clearTimeout(this.captionHoldTimer)
				this.captionHoldTimer = null
			}
		},
		resetCaptionQueue({ clearCaption = true } = {}) {
			this.clearCaptionScheduler()
			if (this.captionIdleTimer) {
				clearTimeout(this.captionIdleTimer)
				this.captionIdleTimer = null
			}
			this.captionQueue = []
			this.seenCaptionChunkIds = new Set()
			this.captionHoldUntil = 0
			if (clearCaption) {
				this.captionText = ''
				this.lastCaptionDisplayChunkId = null
			}
		},
		pumpCaptionQueue() {
			this.clearCaptionScheduler()
			const now = Date.now()
			if (this.captionText && now < this.captionHoldUntil) {
				this.captionHoldTimer = setTimeout(
					() => this.pumpCaptionQueue(),
					this.captionHoldUntil - now,
				)
				return
			}
			if (!this.captionQueue.length) return
			const next = this.captionQueue.shift()
			const backlog = this.captionQueue.length
			const holdMs = captionReadDurationMs(next.text, { backlog })
			if (!Number.isNaN(next.chunkId)) {
				this.seenCaptionChunkIds.add(next.chunkId)
				this.lastCaptionDisplayChunkId = next.chunkId
			}
			this.sessionError = null
			this.captionText = next.text
			this.captionHoldUntil = Date.now() + holdMs
			if (this.captionIdleTimer) clearTimeout(this.captionIdleTimer)
			this.captionIdleTimer = setTimeout(() => {
				if (!this.captionQueue.length) this.captionText = ''
			}, CAPTION_IDLE_CLEAR_MS)
			if (this.captionQueue.length) {
				this.captionHoldTimer = setTimeout(() => this.pumpCaptionQueue(), holdMs)
			}
		},
		stopCaptionStream({ clearCaption = true } = {}) {
			if (this.captionStream) {
				const source = this.captionStream
				this.captionStream = null
				source.onmessage = null
				source.onerror = null
				source.close()
			}
			if (clearCaption) {
				this.resetCaptionQueue({ clearCaption: true })
			}
		},
		enqueueTtsAudio(data) {
			if (!data?.audio_b64) return
			const chunkId = data.chunk_id
			const chunkKey = chunkId == null ? null : String(chunkId)
			if (chunkKey && this.ttsAudioChunkIds.has(chunkKey)) return
			if (chunkKey) this.ttsAudioChunkIds.add(chunkKey)
			const audioUrl = `data:audio/wav;base64,${data.audio_b64}`
			this.ttsQueue = this.ttsQueue.filter((item) => item.id !== chunkId)
			if (this.ttsPlaying && this.currentTtsChunkId === chunkId) {
				this.stopCurrentTtsAudio()
			}
			this.ttsQueue.push({ id: chunkId, url: audioUrl })
			if (!this.ttsPlaying) this.playNextTtsChunk()
		},
		playNextTtsChunk() {
			if (!this.ttsEnabled || !this.ttsQueue.length) {
				this.ttsPlaying = false
				this.currentTtsChunkId = null
				return
			}
			this.ttsPlaying = true
			const next = this.ttsQueue.shift()
			this.currentTtsChunkId = next.id
			const audio = new Audio(next.url)
			audio.volume = this.effectiveTtsVolume
			this.currentTtsAudio = audio
			const finish = () => {
				if (this.currentTtsAudio !== audio) return
				this.currentTtsAudio = null
				this.playNextTtsChunk()
			}
			audio.onended = finish
			audio.onerror = finish
			audio.play().catch(finish)
		},
		stopCurrentTtsAudio() {
			if (this.currentTtsAudio) {
				const audio = this.currentTtsAudio
				this.currentTtsAudio = null
				audio.onended = null
				audio.onerror = null
				audio.pause()
				audio.src = ''
			}
			this.ttsPlaying = false
			this.currentTtsChunkId = null
		},
		stopTtsPlayback() {
			this.ttsQueue = []
			this.ttsAudioChunkIds.clear()
			this.stopCurrentTtsAudio()
		},
		teardown() {
			this.stopCaptionStream()
			this.ttsEnabled = false
			this.stopTtsPlayback()
			this.setInterpretationTtsActive(false)
			this.interpretationLang = null
			this.lastCaptionChunkId = 0
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

.tts-split
	display: inline-flex
	align-items: stretch
	border-radius: 6px
	background: rgba(0, 0, 0, 0.04)
	&.active
		background: rgba(0, 0, 0, 0.06)
	&:not(.has-voices) .tts-split-main
		border-radius: 6px

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

.tts-split .tts-split-main
	border-radius: 0
	background: transparent
	&.active
		background: transparent

.tts-split-toggle
	width: 28px
	height: 36px
	border-radius: 0
	border-left: 1px solid rgba(0, 0, 0, 0.08)
	background: transparent
	color: rgba(0, 0, 0, 0.7)
	:deep(.bunt-icon)
		font-size: 18px
	&:disabled
		opacity: 0.35
		pointer-events: none

.tts-voice-menu :deep(.menu)
	min-width: 160px

.tts-voice-option
	display: block
	width: 100%
	height: 32px
	padding: 0 16px
	border: none
	background: transparent
	color: inherit
	font: inherit
	line-height: 32px
	text-align: left
	cursor: pointer
	&.selected
		font-weight: 600
		color: var(--clr-primary, $clr-primary)
	&:hover
		background-color: var(--clr-input-primary-bg)
		color: var(--clr-input-primary-fg)
</style>
