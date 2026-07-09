import assert from 'assert'
import { languageLabel, languageOptionsFromCodes, normalizeCaptionLanguageCodes } from './interpretation-languages.js'

assert.strictEqual(normalizeCaptionLanguageCodes(['de', 'en', 'de', '']).join(','), 'de,en')
assert.strictEqual(languageOptionsFromCodes(['de'])[0].id, 'de')
assert.ok(languageLabel('de').includes('(de)'))
assert.ok(languageLabel('de', { includeCode: false }).includes('German'))
assert.ok(!languageLabel('de', { includeCode: false }).includes('(de)'))
console.log('interpretation-languages ok')
