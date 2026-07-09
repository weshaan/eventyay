import api from 'lib/api'

export function apiErrorDetail(data) {
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

export function interpretationRouting(store) {
	const world = store.state.world
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
}

export function interpretationApiUrl(store, roomId, suffix = 'config/') {
	const { organizer, event } = interpretationRouting(store)
	return `/api/v1/organizers/${organizer}/events/${event}/rooms/${roomId}/interpretation/${suffix}`
}

export function interpretationAuthHeaders(json = false) {
	const authHeader = api._config.token
		? `Bearer ${api._config.token}`
		: api._config.clientId
			? `Client ${api._config.clientId}`
			: null
	const headers = { Accept: 'application/json' }
	if (json) headers['Content-Type'] = 'application/json'
	if (authHeader) headers.Authorization = authHeader
	if (json) {
		const match = document.cookie.match(/eventyay_csrftoken=([^;]+)/)
		if (match) headers['X-CSRFToken'] = match[1]
	}
	return headers
}

export function buildCaptionsUrl(store, roomId) {
	const { organizer, event } = interpretationRouting(store)
	return `/common/event/${organizer}/${event}/interpretation/rooms/${roomId}/captions/`
}

export function applyRunningInterpretation(module, { languages, captionsUrl }) {
	if (!module.config) module.config = {}
	const current = module.config.interpretation || {}
	module.config.interpretation = {
		room_enabled: true,
		enabled: true,
		languages: languages?.length ? languages : (current.languages || []),
		url: captionsUrl,
	}
}

export function applyStoppedInterpretation(module) {
	if (!module?.config?.interpretation) return
	module.config.interpretation.enabled = false
	module.config.interpretation.url = ''
}

export async function startInterpretationSession(store, roomId, streamUrl) {
	const response = await fetch(interpretationApiUrl(store, roomId, 'start/'), {
		method: 'POST',
		headers: interpretationAuthHeaders(true),
		credentials: 'include',
		body: JSON.stringify({ stream_url: streamUrl }),
	})
	const data = await response.json().catch(() => ({}))
	if (!response.ok) {
		throw new Error(apiErrorDetail(data) || 'Could not start session')
	}
	return data
}

export async function stopInterpretationSession(store, roomId) {
	const response = await fetch(interpretationApiUrl(store, roomId, 'stop/'), {
		method: 'POST',
		headers: interpretationAuthHeaders(true),
		credentials: 'include',
		body: '{}',
	})
	const data = await response.json().catch(() => ({}))
	if (!response.ok) {
		throw new Error(apiErrorDetail(data) || 'Could not stop session')
	}
	return data
}

export function streamUrlFromStreamModule(module) {
	if (!module?.config) return ''
	if (module.type === 'livestream.native') {
		return (module.config.hls_url || '').trim()
	}
	if (module.type === 'livestream.youtube') {
		const ytid = (module.config.ytid || '').trim()
		if (!ytid) return ''
		if (ytid.includes('://')) return ytid
		return `https://www.youtube.com/watch?v=${ytid}`
	}
	if (module.type === 'livestream.iframe') {
		return (module.config.url || '').trim()
	}
	return ''
}
