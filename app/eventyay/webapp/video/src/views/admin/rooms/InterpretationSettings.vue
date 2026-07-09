<template lang="pug">
.c-interpretation-settings
	h2 Live Interpretation
	.error(v-if="error") {{ error }}
	.loading(v-if="loading")
		bunt-progress-circular(size="large")
	p.notice(v-else-if="!pluginActive") {{ inactiveMessage }}
	.setup-notice(v-else-if="setupNotice")
		p {{ setupNotice.message }}
		a.dashboard-link(v-if="dashboardUrl", :href="dashboardUrl", target="_blank", rel="noopener noreferrer") Open interpretation dashboard
	template(v-else-if="showInterpreterReady")
		bunt-switch(
			name="enable-room-interpretation",
			:model-value="roomEnabled",
			@update:model-value="setRoomEnabled",
			label="Enable live interpretation for this room",
			:disabled="roomToggleLoading"
		)
		p.hint(v-if="!roomEnabled") Turn on to show the caption bar in the stage room and configure providers below.
		template(v-if="roomEnabled")
			p.hint Choose transcription and translation providers, caption languages for attendees, then save and start a session when you go live.
			bunt-select(
				name="transcription_provider",
				v-model="form.transcription_provider",
				:options="transcriptionProviderOptions",
				label="Transcription provider"
			)
			bunt-select(
				name="translation_provider",
				v-model="form.translation_provider",
				:options="translationProviderOptions",
				label="Translation provider"
			)
			.caption-languages
				label.field-label Caption languages
				.caption-language-row(v-for="(code, index) in captionLanguages", :key="`caption-lang-${index}`")
					.caption-language-field
						bunt-select(
							:name="`caption_language_${index}`",
							v-model="captionLanguages[index]",
							:options="languageOptions",
							label="Language"
						)
					.caption-language-action
						bunt-icon-button.remove-caption-language(@click="removeCaptionLanguage(index)", aria-label="Remove caption language") delete-outline
				bunt-button.add-language-btn(@click="addCaptionLanguage") + Add caption language
			.actions
				bunt-button.btn-save(@click="save", :loading="saving", :error-message="saveError") Save interpretation settings
			.session-row
				span.status-label Session:
				span.status-badge(:class="statusClass") {{ statusLabel }}
				bunt-button.session-btn(v-if="sessionStatus === 'running'", @click="stopSession", :loading="sessionLoading") Stop session
				bunt-button.session-btn(v-else, @click="startSession", :loading="sessionLoading", :disabled="!canStartSession") Start session
			p.session-notice(v-if="form && !form.interpretation_ready") Enable live interpretation on the interpretation dashboard before starting a session.
			p.session-notice(v-else-if="form && !effectiveStreamUrl") Add a stream URL in the Stream section above and save the room before starting a session.
			p.session-error(v-if="sessionError") {{ sessionError }}
</template>
<script>
import api from 'lib/api'
import ISO6391 from 'iso-639-1'

const STATUS_LABELS = {
	running: 'Running',
	idle: 'Idle',
}

const PROVIDER_DEFAULT = { id: '', label: 'Default' }
const TRANSCRIPTION_PROVIDER_OPTIONS = [
	PROVIDER_DEFAULT,
	{ id: 'whisper_local', label: 'Whisper (local)' },
]
const TRANSLATION_PROVIDER_OPTIONS = [
	PROVIDER_DEFAULT,
	{ id: 'nllb_local', label: 'NLLB (local)' },
]

function languageLabel(code) {
	const english = ISO6391.getName(code) || code
	const native = ISO6391.getNativeName(code) || english
	const names = native === english ? english : `${english} - ${native}`
	return `${names} (${code})`
}

function buildLanguageOptions() {
	return ISO6391.getAllCodes().map((code) => ({
		id: code,
		label: languageLabel(code),
	}))
}

function withCurrentOption(options, value) {
	if (!value || options.some((option) => option.id === value)) {
		return options
	}
	return [...options, { id: value, label: value }]
}

function normalizeCaptionLanguages(codes) {
	const result = []
	const seen = new Set()
	for (const code of codes || []) {
		const normalized = (code || '').trim()
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized)
			result.push(normalized)
		}
	}
	return result
}

function streamUrlFromModules(modules) {
	if (!modules) return ''
	const hlsUrl = modules['livestream.native']?.config?.hls_url
	if (hlsUrl?.trim()) return hlsUrl.trim()
	const ytid = modules['livestream.youtube']?.config?.ytid
	if (ytid?.trim()) {
		const value = ytid.trim()
		if (value.includes('://')) return value
		return `https://www.youtube.com/watch?v=${value}`
	}
	const iframeUrl = modules['livestream.iframe']?.config?.url
	if (iframeUrl?.trim()) return iframeUrl.trim()
	return ''
}

function apiErrorDetail(data) {
	const detail = data?.detail
	if (typeof detail === 'string') return detail
	if (Array.isArray(detail)) return detail.map((item) => String(item)).join(', ')
	if (detail && typeof detail === 'object') {
		return Object.entries(detail)
			.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
			.join('; ')
	}
	return ''
}

export default {
	name: 'InterpretationSettings',
	props: {
		roomId: {
			type: [String, Number],
			required: true,
		},
		modules: {
			type: Object,
			default: null,
		},
	},
	data() {
		return {
			pluginActive: false,
			inactiveMessage: '',
			loading: true,
			error: null,
			form: null,
			captionLanguages: [],
			languageOptions: buildLanguageOptions(),
			transcriptionProviderOptions: TRANSCRIPTION_PROVIDER_OPTIONS,
			translationProviderOptions: TRANSLATION_PROVIDER_OPTIONS,
			saving: false,
			saveError: null,
			sessionLoading: false,
			sessionError: null,
			dashboardUrl: '',
			roomToggleLoading: false,
		}
	},
	computed: {
		showInterpreterReady() {
			return !!(this.form?.interpretation_enabled && this.form?.susi_connected)
		},
		roomEnabled() {
			return !!this.form?.room_enabled
		},
		setupNotice() {
			if (!this.form || this.showInterpreterReady) return null
			return {
				message: 'Interpretation plugin is active. Please choose an interpreter on the interpretation dashboard.',
			}
		},
		effectiveStreamUrl() {
			return (
				streamUrlFromModules(this.modules)
				|| this.form?.detected_stream_url
				|| this.form?.stream_url
				|| ''
			)
		},
		canStartSession() {
			return !!(this.form?.room_enabled && this.form?.interpretation_ready && this.effectiveStreamUrl)
		},
		sessionStatus() {
			return this.form?.status === 'running' ? 'running' : 'idle'
		},
		statusLabel() {
			return STATUS_LABELS[this.sessionStatus]
		},
		statusClass() {
			return `is-${this.sessionStatus}`
		},
	},
	async created() {
		await this.loadConfig()
	},
	methods: {
		async setRoomEnabled(value) {
			if (!this.form || this.roomToggleLoading) return
			this.roomToggleLoading = true
			this.sessionError = null
			try {
				const response = await fetch(this.apiUrl('config/'), {
					method: 'PATCH',
					headers: this.authHeaders(true),
					credentials: 'include',
					body: JSON.stringify({ room_enabled: value }),
				})
				const data = await response.json().catch(() => ({}))
				if (!response.ok) {
					throw new Error(apiErrorDetail(data) || 'Could not update interpretation')
				}
				this.applyConfig(data)
			} catch (err) {
				this.sessionError = err.message || 'Could not update interpretation'
			} finally {
				this.roomToggleLoading = false
			}
		},
		routing() {
			const world = this.$store.state.world
			let organizer = world?.organizer_slug
			let event = world?.slug || world?.id
			if (!organizer || organizer === 'default') {
				const pathParts = window.location.pathname.split('/').filter(Boolean)
				if (pathParts.length >= 2) {
					organizer = pathParts[0]
					event = pathParts[1]
				}
			}
			return { organizer, event }
		},
		apiUrl(suffix = 'config/') {
			const { organizer, event } = this.routing()
			return `/api/v1/organizers/${organizer}/events/${event}/rooms/${this.roomId}/interpretation/${suffix}`
		},
		authHeaders(json = false) {
			const authHeader = api._config.token
				? `Bearer ${api._config.token}`
				: api._config.clientId
					? `Client ${api._config.clientId}`
					: null
			const headers = { Accept: 'application/json' }
			if (json) headers['Content-Type'] = 'application/json'
			if (authHeader) headers.Authorization = authHeader
			if (json) {
				const csrfToken = this.getCsrfToken()
				if (csrfToken) headers['X-CSRFToken'] = csrfToken
			}
			return headers
		},
		getCsrfToken() {
			const match = document.cookie.match(/eventyay_csrftoken=([^;]+)/)
			return match ? match[1] : null
		},
		applyConfig(data) {
			this.form = { ...data }
			this.dashboardUrl = data.dashboard_url || ''
			this.captionLanguages = [...(data.target_languages || [])]
			this.transcriptionProviderOptions = withCurrentOption(
				TRANSCRIPTION_PROVIDER_OPTIONS,
				data.transcription_provider,
			)
			this.translationProviderOptions = withCurrentOption(
				TRANSLATION_PROVIDER_OPTIONS,
				data.translation_provider,
			)
			for (const code of data.target_languages || []) {
				if (code && !this.languageOptions.some((option) => option.id === code)) {
					this.languageOptions = [
						...this.languageOptions,
						{ id: code, label: languageLabel(code) },
					]
				}
			}
		},
		addCaptionLanguage() {
			this.captionLanguages.push('')
		},
		removeCaptionLanguage(index) {
			this.captionLanguages.splice(index, 1)
		},
		async loadConfig() {
			this.loading = true
			this.error = null
			this.pluginActive = false
			this.inactiveMessage = ''
			try {
				const response = await fetch(this.apiUrl('config/'), {
					headers: this.authHeaders(),
					credentials: 'include',
				})
				if (response.status === 404) {
					this.inactiveMessage = 'Enable Interpretation plugin for this event in eventyay to access the feature.'
					return
				}
				if (response.status === 403) {
					this.inactiveMessage = 'Interpretation is not enabled for this event. Enable the plugin in commons event settings.'
					return
				}
				if (!response.ok) {
					throw new Error(`Failed to load interpretation settings (${response.status})`)
				}
				this.pluginActive = true
				this.applyConfig(await response.json())
			} catch (err) {
				this.error = err.message || 'Failed to load interpretation settings'
			} finally {
				this.loading = false
			}
		},
		payloadFromForm() {
			return {
				target_languages: normalizeCaptionLanguages(this.captionLanguages),
				transcription_provider: this.form.transcription_provider || '',
				translation_provider: this.form.translation_provider || '',
				room_enabled: !!this.form.room_enabled,
			}
		},
		async save({ quiet = false } = {}) {
			if (!quiet) this.saveError = null
			this.saving = true
			try {
				const response = await fetch(this.apiUrl('config/'), {
					method: 'PATCH',
					headers: this.authHeaders(true),
					credentials: 'include',
					body: JSON.stringify(this.payloadFromForm()),
				})
				const data = await response.json().catch(() => ({}))
				if (!response.ok) {
					throw new Error(apiErrorDetail(data) || response.statusText || 'Save failed')
				}
				this.applyConfig(data)
				return true
			} catch (err) {
				const message = err.message || 'Save failed'
				if (quiet) throw new Error(message)
				this.saveError = message
				return false
			} finally {
				this.saving = false
			}
		},
		async startSession() {
			this.sessionError = null
			this.sessionLoading = true
			try {
				await this.save({ quiet: true })
				const response = await fetch(this.apiUrl('start/'), {
					method: 'POST',
					headers: this.authHeaders(true),
					credentials: 'include',
					body: JSON.stringify({ stream_url: this.effectiveStreamUrl }),
				})
				const data = await response.json().catch(() => ({}))
				if (!response.ok) {
					throw new Error(apiErrorDetail(data) || 'Could not start session')
				}
				this.applyConfig(data)
			} catch (err) {
				this.sessionError = err.message || 'Could not start session'
			} finally {
				this.sessionLoading = false
			}
		},
		async stopSession() {
			this.sessionError = null
			this.sessionLoading = true
			try {
				const response = await fetch(this.apiUrl('stop/'), {
					method: 'POST',
					headers: this.authHeaders(true),
					credentials: 'include',
					body: '{}',
				})
				const data = await response.json().catch(() => ({}))
				if (!response.ok) {
					throw new Error(apiErrorDetail(data) || 'Could not stop session')
				}
				this.applyConfig(data)
			} catch (err) {
				this.sessionError = err.message || 'Could not stop session'
			} finally {
				this.sessionLoading = false
			}
		},
	},
}
</script>
<style lang="stylus">
.c-interpretation-settings
	border-top: 1px solid rgba(0, 0, 0, 0.08)
	margin-top: 8px
	h2
		font-size: 24px
		margin: 16px 0 4px 0
	.hint, .notice, .field-hint
		font-size: 13px
		color: #666
		margin: 0 0 12px 0
	.setup-notice
		margin: 8px 0 16px 0
		p
			font-size: 13px
			color: #666
			margin: 0 0 8px 0
		.dashboard-link
			font-size: 13px
	.field-label
		display: block
		font-size: 14px
		font-weight: 500
		margin: 0 0 4px 0
	.caption-languages
		margin-bottom: 16px
	.caption-language-row
		position: relative
		margin-bottom: 8px
		padding-right: 44px
		.caption-language-field
			min-width: 0
		.caption-language-action
			position: absolute
			right: 0
			top: 18px
			width: 36px
			height: 36px
			display: flex
			align-items: center
			justify-content: center
			.remove-caption-language
				icon-button-style(style: clear)
	.add-language-btn
		margin-top: 4px
	.session-row
		display: flex
		align-items: center
		flex-wrap: wrap
		gap: 8px
		margin: 24px 0 8px 0
	.session-notice, .session-error
		font-size: 13px
		margin: 0 0 12px 0
	.session-notice
		color: #666
	.session-error
		color: #c62828
	.status-badge
		font-size: 12px
		padding: 2px 8px
		border-radius: 4px
		background: #eee
		&.is-running
			background: #e8f5e9
			color: #2e7d32
	.actions
		display: flex
		align-items: center
		flex-wrap: wrap
		gap: 12px
		margin-top: 8px
</style>
