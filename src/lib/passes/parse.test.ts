import { describe, expect, test } from 'bun:test'
import type { NewFinding, Pass } from '../ipc'
import { arrayShape, buildPrompt, extractArray, paragraphs, parseFindings, readFindings } from './parse'

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
		expect(extractArray('[{"a": 1}, {"b": 2}]')).toBe('[{"a": 1}, {"b": 2}]')
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
		expect(extractArray('```json\n[{"a": 1}]')).toBe('[{"a": 1}]')
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

	test('an array that holds no objects is not findings', () => {
		// Returning `[1]` here would give the caller an empty pass with no error,
		// which reads as a clean nothing-found.
		expect(extractArray('[1] and then [2]')).toBeNull()
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

	test('an array of strings in a wrapper object is not findings', () => {
		expect(extractArray('{"findings": ["a", "b"]}')).toBeNull()
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
		expect(parseFindings(reply(good, noQuote)).length).toBe(1)
	})

	test('drops an item whose severity is not in the enum', () => {
		expect(parseFindings(reply(good, { ...good, severity: 'critical' })).length).toBe(1)
	})

	test('drops an item whose quote is too short', () => {
		expect(parseFindings(reply(good, { ...good, quote: 'a' })).length).toBe(1)
	})

	test('returns an empty array for an empty array, without throwing', () => {
		expect(parseFindings('[]')).toEqual([])
	})

	test('throws when the reply holds no array, naming who replied', () => {
		expect(() => parseFindings('No problems here.', 'gpt-5')).toThrow(
			'gpt-5 returned no JSON array',
		)
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

	test('throws on a cut off reply, saying the array never closed', () => {
		expect(() => parseFindings('[{"quote": "ok"}, {"quote"', 'gpt-5')).toThrow(
			"gpt-5's reply ends with an unclosed array, so it was probably cut off",
		)
	})

	test('throws on an array of strings, saying the array held no findings', () => {
		// A different message from the no-array case, so a log line does not send
		// the reader looking for an array that was there all along.
		expect(() => parseFindings('["draft", "v2"]', 'gemini')).toThrow(
			'gemini returned an array that holds no findings',
		)
	})

	test('throws when every item fails the schema, with the count and the field', () => {
		const renamed = Array.from({ length: 7 }, () => ({ ...good, quote: undefined, text: 'x' }))
		expect(() => parseFindings(reply(...renamed), 'claude')).toThrow(
			/claude returned 7 findings, none of which fit the schema: quote/,
		)
	})

	test('keeps the one good item among several bad ones, without throwing', () => {
		const bad = { ...good, severity: 'critical' }
		const out = parseFindings(reply(bad, good, bad, bad))
		expect(out.length).toBe(1)
	})
})

describe('arrayShape', () => {
	test('reports objects when a findings array is there', () => {
		expect(arrayShape('[{"quote": "ok"}]')).toBe('objects')
	})

	test('reports objects for an empty array', () => {
		expect(arrayShape('[]')).toBe('objects')
	})

	test('reports other when the only arrays hold no objects', () => {
		expect(arrayShape('{"findings": ["a", "b"]}')).toBe('other')
	})

	test('reports none when nothing balances', () => {
		expect(arrayShape('I found nothing to report.')).toBe('none')
	})

	test('reports truncated for an array with a balanced one inside it', () => {
		// Truncation outranks `other`: the nested `[1]` balances, but the open
		// bracket explains the missing findings better than its contents do.
		expect(arrayShape('[{"a": [1]}')).toBe('truncated')
	})

	test('reports truncated for an array with nothing nested in it', () => {
		expect(arrayShape('[{"a": 1}, {"b": 2}')).toBe('truncated')
	})

	test('an unclosed bracket inside a string is not truncation', () => {
		// The scanner tracks strings, so a `[` in a quote leaves nothing open.
		expect(arrayShape('["a [ b"]')).toBe('other')
		expect(arrayShape('[{"quote": "see [1 in the draft"}]')).toBe('objects')
	})

	test('agrees with extractArray on every reply', () => {
		const replies = [
			'[{"quote": "ok"}]',
			'[]',
			'["a"]',
			'no array here',
			'[{"a": 1}',
			'["a [ b"]',
			'{"tags": ["x"], "findings": [{"quote": "ok"}]}',
		]
		for (const text of replies) {
			expect(arrayShape(text) === 'objects').toBe(extractArray(text) !== null)
		}
	})
})

describe('readFindings', () => {
	test('keeps the items that fit and counts the ones that do not', () => {
		const out = readFindings(reply(good, { ...good, severity: 'moderate' }, { ...good, quote: 'x' }))
		expect(out.found.length).toBe(1)
		expect(out.rejected).toBe(2)
		expect(out.why).toContain('severity')
	})

	test('does not throw when the only item fails', () => {
		// One bad reply among dozens must not fail a pass; the runner decides
		// over the whole pass (SPEC §8.3).
		const out = readFindings(reply({ ...good, severity: 'moderate' }))
		expect(out.found).toEqual([])
		expect(out.rejected).toBe(1)
	})

	test('still throws for a reply with no array', () => {
		expect(() => readFindings('I found nothing worth noting.')).toThrow('no JSON array')
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

	test('names the three severity values', () => {
		// Without this line DeepSeek wrote "moderate" and "minor", and the
		// schema rejected every finding in the reply.
		expect(buildPrompt(pass, draft, null)).toContain('severity is low, medium or high. No other value is allowed.')
	})

	test('contains the word json, which json_object endpoints require', () => {
		// DeepSeek and other OpenAI-compatible endpoints reject a structured
		// output request whose prompt never says "json".
		expect(buildPrompt(pass, draft, null)).toMatch(/json/i)
		expect(buildPrompt(pass, draft, 'a chunk')).toMatch(/json/i)
	})

	test('trims the pass prompt', () => {
		expect(buildPrompt(pass, draft, null)).toContain('--- the task ---\nFind stock phrases.\n')
	})

	test('starts with the draft, so every call in a run shares a cacheable prefix', () => {
		const other = { ...pass, prompt: 'Find passive voice.' }
		const prompts = [
			buildPrompt(pass, draft, null),
			buildPrompt(pass, draft, 'The first paragraph.'),
			buildPrompt(other, draft, 'The second paragraph.'),
		]
		const prefix = `--- the draft ---\n${draft}\n\n--- the task ---\n`
		for (const p of prompts) expect(p.startsWith(prefix)).toBe(true)
	})

	test('puts the paragraph after the pass prompt', () => {
		const out = buildPrompt(pass, draft, 'The second paragraph.')
		expect(out.indexOf('Find stock phrases.')).toBeLessThan(out.indexOf('--- examine only this paragraph ---'))
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
