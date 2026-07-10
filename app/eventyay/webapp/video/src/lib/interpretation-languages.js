import ISO6391 from 'iso-639-1'

export function languageLabel(code) {
	const normalized = (code || '').trim()
	if (!normalized) return ''
	const english = ISO6391.getName(normalized) || normalized
	const native = ISO6391.getNativeName(normalized) || english
	const names = native === english ? english : `${english} - ${native}`
	return `${names} (${normalized})`
}

export function normalizeCaptionLanguageCodes(codes) {
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

export function languageOptionsFromCodes(codes) {
	return normalizeCaptionLanguageCodes(codes).map((code) => ({
		id: code,
		label: languageLabel(code),
	}))
}
