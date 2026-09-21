import { describe, expect, test } from 'bun:test'
import type { NewFinding, Pass } from '../ipc'
import { buildPrompt, extractArray, paragraphs, parseFindings } from './parse'

/** One well-formed finding, as a model would write it. */
const good = {
	quote: 'the quick brown fox',
	prefix: 'once upon a time ',
	suffix: ' jumped over',
	category: 'cliche',
	severity: 'medium',
	note: 'A stock phrase.',
}

/** A reply carrying `items` as a bare JSON array. */
const reply = (...items: unknown[]) => JSON.stringify(items)

const pass: Pass = {
	slug: 'cliches',
	name: 'Cliches',
	category: 'style',
	scope: 'document',
	provider: null,
	enabled: true,
	prompt: '  Find stock phrases.  ',
	path: '/passes/cliches.md',
}

describe('extractArray', () => {
	test('returns a bare array unchanged', () => {
		expect(extractArray('[1, 2, 3]')).toBe('[1, 2, 3]')
	})

	test('reads an array out of a json fence', () => {
		expect(extractArray('```json\n[{"a": 1}]\n```')).toBe('[{"a": 1}]')
	})

	test('reads an array out of a plain fence', () => {
		expect(extractArray('```\n[{"a": 1}]\n```')).toBe('[{"a": 1}]')
	})

	test('drops a preamble before the array and chatter after it', () => {
		const text = 'Sure! Here is what I found:\n[{"a": 1}]\nLet me know if you want more.'
		expect(extractArray(text)).toBe('[{"a": 1}]')
	})

	test('falls back to the whole text when a fence is never closed', () => {
		expect(extractArray('```json\n[1]')).toBe('[1]')
	})

	test('balances arrays nested inside objects inside the array', () => {
		const json = '[{"a": [1, [2, 3]], "b": {"c": [4]}}]'
		expect(extractArray(`here:\n${json}\ndone`)).toBe(json)
	})

	test('a closing bracket inside a string does not end the array', () => {
		const json = '[{"quote": "an array like [1] ends here]"}]'
		expect(extractArray(json)).toBe(json)
	})

	test('an escaped quote does not leave the string', () => {
		// The `]` sits inside the string; only an unescaped quote would end it.
		const json = '[{"quote": "she said \\"stop]\\" loudly"}]'
		expect(extractArray(json)).toBe(json)
	})

	test('an escaped backslash before a quote lets the quote close the string', () => {
		// The string value is `foo\` — the quote after it is a real terminator,
		// so the bracket that follows ends the array.
		const json = '[{"quote": "foo\\\\"}]'
		expect(extractArray(`${json} trailing]]] text`)).toBe(json)
	})

	test('returns an empty array', () => {
		expect(extractArray('nothing found: []')).toBe('[]')
	})

	test('returns null when there is no array at all', () => {
		expect(extractArray('I could not find any problems.')).toBeNull()
	})

	test('returns null for an unterminated array', () => {
		expect(extractArray('[{"a": 1}, {"b": 2}')).toBeNull()
	})

	test('returns null for a top level object with no array in it', () => {
		expect(extractArray('{"findings": 3}')).toBeNull()
	})

	test('stops at the first array and ignores a second one', () => {
		expect(extractArray('[1] and then [2]')).toBe('[1]')
	})

	test('skips a decoy array and takes the findings out of a wrapper object', () => {
		const text = '{"meta": {"tags": ["draft", "v2"]}, "findings": [{"quote": "ok"}]}'
		expect(extractArray(text)).toBe('[{"quote": "ok"}]')
	})

	test('reads the array after a fence that quotes the draft', () => {
		const text = 'The passage:\n```\nthe [sic] quick fox\n```\nFindings:\n[{"quote": "ok"}]'
		expect(extractArray(text)).toBe('[{"quote": "ok"}]')
	})

	test('prefers a json fence over an earlier plain fence', () => {
		const text = '```\n["draft"]\n```\n```json\n[{"quote": "ok"}]\n```'
		expect(extractArray(text)).toBe('[{"quote": "ok"}]')
	})

	test('takes a later array of objects over an earlier empty one', () => {
		// Pinned: a model may write "nothing here" and then the real array. An
		// empty array that comes first must not be read as the answer.
		expect(extractArray('nothing in this paragraph: [] ... [{"quote": "ok"}]')).toBe(
			'[{"quote": "ok"}]',
		)
	})

	test('a lone empty array is still the answer', () => {
		expect(extractArray('I found nothing: []')).toBe('[]')
	})

	test('returns null for a truncated array with a nested one inside it', () => {
		// Returning the nested `[1]` here would look like a clean empty pass.
		expect(extractArray('[{"a": [1]}')).toBeNull()
	})

	test('falls back to an array of strings when no array of objects exists', () => {
		expect(extractArray('{"findings": ["a", "b"]}')).toBe('["a", "b"]')
	})

	test('returns null when no candidate holds a balanced array', () => {
		expect(extractArray('```\nno array here\n```\nnor out here')).toBeNull()
	})
})

describe('parseFindings', () => {
	test('reads a well formed reply', () => {
		const out = parseFindings(reply(good))
		expect(out).toEqual([
			{
				quote: 'the quick brown fox',
				prefix: 'once upon a time ',
				suffix: ' jumped over',
				category: 'cliche',
				severity: 'medium',
				note: 'A stock phrase.',
			} satisfies NewFinding,
		])
	})

	test('defaults prefix and suffix to empty when they are absent', () => {
		const { prefix: _p, suffix: _s, ...bare } = good
		const out = parseFindings(reply(bare))
		expect(out[0]!.prefix).toBe('')
		expect(out[0]!.suffix).toBe('')
	})

	test('drops one malformed item and keeps the good ones beside it', () => {
		const out = parseFindings(reply(good, { category: 'junk' }, good))
		expect(out.length).toBe(2)
		expect(out.every((f) => f.quote === good.quote)).toBe(true)
	})

	test('drops an item with no quote', () => {
		const { quote: _q, ...noQuote } = good
		expect(parseFindings(reply(noQuote))).toEqual([])
	})

	test('drops an item whose severity is not in the enum', () => {
		expect(parseFindings(reply({ ...good, severity: 'critical' }))).toEqual([])
	})

	test('drops an item whose quote is too short', () => {
		expect(parseFindings(reply({ ...good, quote: 'a' }))).toEqual([])
	})

	test('returns an empty array for an empty array, without throwing', () => {
		expect(parseFindings('[]')).toEqual([])
	})

	test('throws when the reply holds no array, naming who replied', () => {
		expect(() => parseFindings('No problems here.', 'gpt-5')).toThrow(/gpt-5/)
	})

	test('throws when the reply is a top level JSON object', () => {
		expect(() => parseFindings('{"findings": 3}', 'claude')).toThrow(/claude/)
	})

	test('throws when the brackets hold JSON that will not parse', () => {
		expect(() => parseFindings('[{quote: unquoted}]', 'deepseek')).toThrow(
			/deepseek.*will not parse/,
		)
	})

	test('names "the model" when no who is given', () => {
		expect(() => parseFindings('nothing')).toThrow(/the model/)
	})

	test('reads findings out of a wrapper object with a decoy array', () => {
		const text = `{"tags": ["draft"], "findings": ${reply(good)}}`
		expect(parseFindings(text).length).toBe(1)
	})

	test('an array of strings gives no findings rather than throwing', () => {
		expect(parseFindings('["draft", "v2"]')).toEqual([])
	})
})

describe('buildPrompt', () => {
	const draft = 'The first paragraph.\n\nThe second paragraph.'

	test('document scope carries the draft and no paragraph section', () => {
		const out = buildPrompt(pass, draft, null)
		expect(out).toContain('Find stock phrases.')
		expect(out).toContain('--- the draft ---')
		expect(out).toContain(draft)
		expect(out).not.toContain('examine only this paragraph')
	})

	test('paragraph scope carries both the draft and the chunk', () => {
		const out = buildPrompt(pass, draft, 'The second paragraph.')
		expect(out).toContain('--- the draft ---')
		expect(out).toContain(draft)
		expect(out).toContain('--- examine only this paragraph ---')
		expect(out).toContain('The rest of the draft is context.')
	})

	test('an empty chunk still asks for the paragraph section', () => {
		expect(buildPrompt(pass, draft, '')).toContain('examine only this paragraph')
	})

	test('carries the output note', () => {
		expect(buildPrompt(pass, draft, null)).toContain('an array of findings')
	})

	test('contains the word json, which json_object endpoints require', () => {
		// DeepSeek and other OpenAI-compatible endpoints reject a structured
		// output request whose prompt never says "json".
		expect(buildPrompt(pass, draft, null)).toMatch(/json/i)
		expect(buildPrompt(pass, draft, 'a chunk')).toMatch(/json/i)
	})

	test('trims the pass prompt', () => {
		expect(buildPrompt(pass, draft, null).startsWith('Find stock phrases.\n')).toBe(true)
	})
})

describe('paragraphs', () => {
	test('splits on a blank line', () => {
		expect(paragraphs('one\n\ntwo')).toEqual(['one', 'two'])
	})

	test('trims each paragraph', () => {
		expect(paragraphs('  one  \n\n\ttwo\t')).toEqual(['one', 'two'])
	})

	test('three or more newlines split once', () => {
		expect(paragraphs('one\n\n\n\ntwo')).toEqual(['one', 'two'])
	})

	test('keeps a single newline inside a paragraph', () => {
		expect(paragraphs('one\ntwo')).toEqual(['one\ntwo'])
	})

	test('a document with no blank line is one paragraph', () => {
		expect(paragraphs('just the one')).toEqual(['just the one'])
	})

	test('drops empty paragraphs left by trailing blank lines', () => {
		expect(paragraphs('one\n\n\ntwo\n\n')).toEqual(['one', 'two'])
	})

	test('an empty string gives no paragraphs', () => {
		expect(paragraphs('')).toEqual([])
	})

	test('a whitespace only string gives no paragraphs', () => {
		expect(paragraphs('   \n \n  ')).toEqual([])
	})
})
