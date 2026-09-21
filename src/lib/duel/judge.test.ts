import { describe, expect, test } from 'bun:test'
import {
	extractObject,
	judgePrompt,
	originalWon,
	parseVerdict,
	shuffle,
	tally,
	type Choice,
} from './judge'

/** Words that would tell the judge which passage came later, or that an
 *  editing session produced it. The prompt must contain none of them. */
const LEAKING = [
	'original',
	'revised',
	'revision',
	'new',
	'newer',
	'draft',
	'rewrite',
	'rewritten',
	'improved',
	'improvement',
	'first',
	'second',
	'author',
	'edit',
	'editing',
	'copyedit',
	'version',
	'before',
	'after',
	'previous',
	'changed',
]

const ORIGINAL = 'The committee made a determination.'
const REWRITE = 'The committee decided.'

describe('judgePrompt', () => {
	const { system, prompt } = judgePrompt(ORIGINAL, REWRITE)
	const whole = `${system}\n${prompt}`

	test('contains the word json, which json_object endpoints require', () => {
		// DeepSeek and other OpenAI-compatible endpoints return a 400 for a
		// structured output request whose prompt never says "json".
		expect(system).toMatch(/json/i)
		expect(prompt).toMatch(/json/i)
	})

	test('carries both passages, labelled only as A and B', () => {
		expect(prompt).toContain(ORIGINAL)
		expect(prompt).toContain(REWRITE)
		expect(prompt).toContain('Passage A')
		expect(prompt).toContain('Passage B')
		expect(prompt.indexOf('Passage A')).toBeLessThan(prompt.indexOf('Passage B'))
	})

	test('says nothing about which passage came later', () => {
		// The passages themselves are the only text the judge sees, so every
		// leaking word has to be absent from the scaffolding around them.
		const scaffolding = `${system}\n${prompt.replace(ORIGINAL, '').replace(REWRITE, '')}`
		for (const word of LEAKING) {
			expect(scaffolding.toLowerCase()).not.toContain(word)
		}
	})

	test('asks which passage is better written and for one sentence of reason', () => {
		expect(prompt).toMatch(/better written/i)
		expect(whole).toMatch(/one sentence/i)
	})

	test('forbids praise, as Rule Two requires', () => {
		expect(system).toMatch(/never praise/i)
	})

	test('allows a tie', () => {
		expect(whole).toContain('tie')
	})

	test('is symmetric: swapping the passages swaps nothing else', () => {
		const one = judgePrompt('ALPHA', 'BETA')
		const other = judgePrompt('BETA', 'ALPHA')
		const swapped = one.prompt.replace(/ALPHA/g, '\u0000').replace(/BETA/g, 'ALPHA').replace(/\u0000/g, 'BETA')
		expect(swapped).toBe(other.prompt)
		expect(one.system).toBe(other.system)
	})
})

describe('shuffle', () => {
	test('a low draw puts the author version on side A', () => {
		expect(shuffle(ORIGINAL, REWRITE, () => 0)).toEqual({
			aText: ORIGINAL,
			bText: REWRITE,
			aIsOriginal: true,
		})
	})

	test('a high draw puts the author version on side B', () => {
		expect(shuffle(ORIGINAL, REWRITE, () => 0.9)).toEqual({
			aText: REWRITE,
			bText: ORIGINAL,
			aIsOriginal: false,
		})
	})

	test('splits at one half', () => {
		expect(shuffle(ORIGINAL, REWRITE, () => 0.499).aIsOriginal).toBe(true)
		expect(shuffle(ORIGINAL, REWRITE, () => 0.5).aIsOriginal).toBe(false)
	})

	test('returns both texts unchanged, one on each side', () => {
		for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
			const out = shuffle(ORIGINAL, REWRITE, () => r)
			expect([out.aText, out.bText].sort()).toEqual([ORIGINAL, REWRITE].sort())
			expect(out.aText === ORIGINAL).toBe(out.aIsOriginal)
		}
	})

	test('defaults to Math.random and reaches both sides', () => {
		const seen = new Set<boolean>()
		for (let i = 0; i < 200; i++) seen.add(shuffle(ORIGINAL, REWRITE).aIsOriginal)
		expect(seen.size).toBe(2)
	})
})

describe('extractObject', () => {
	test('returns a bare object unchanged', () => {
		expect(extractObject('{"a": 1}')).toBe('{"a": 1}')
	})

	test('reads an object out of a json fence', () => {
		expect(extractObject('```json\n{"a": 1}\n```')).toBe('{"a": 1}')
	})

	test('drops a preamble before the object and chatter after it', () => {
		expect(extractObject('Here you go:\n{"a": 1}\nHope that helps.')).toBe('{"a": 1}')
	})

	test('balances nested objects', () => {
		const json = '{"a": {"b": {"c": 1}}}'
		expect(extractObject(`x ${json} y`)).toBe(json)
	})

	test('a closing brace inside a string does not end the object', () => {
		const json = '{"reason": "it reads like } this"}'
		expect(extractObject(json)).toBe(json)
	})

	test('returns null when there is no object at all', () => {
		expect(extractObject('Neither one, really.')).toBeNull()
	})

	test('returns null for an unterminated object', () => {
		expect(extractObject('{"a": 1')).toBeNull()
	})
})

describe('parseVerdict', () => {
	test('reads a bare object', () => {
		expect(parseVerdict('{"verdict": "A", "reason": "It is shorter."}')).toEqual({
			verdict: 'A',
			reason: 'It is shorter.',
		})
	})

	test('reads a fenced object', () => {
		const out = parseVerdict('```json\n{"verdict": "B", "reason": "B is plainer."}\n```')
		expect(out.verdict).toBe('B')
	})

	test('reads an object between a preamble and trailing chatter', () => {
		const text = 'Let me compare them.\n{"verdict": "tie", "reason": "Both are flat."}\nTell me more?'
		expect(parseVerdict(text).verdict).toBe('tie')
	})

	test('a closing brace inside the reason does not truncate the object', () => {
		const out = parseVerdict('{"verdict": "A", "reason": "B closes with a } and stops."}')
		expect(out.reason).toBe('B closes with a } and stops.')
	})

	test('an escaped quote inside the reason survives', () => {
		const out = parseVerdict('{"verdict": "B", "reason": "A says \\"made a determination\\"."}')
		expect(out.reason).toBe('A says "made a determination".')
	})

	test('salvages a reason whose inner quotes are not escaped', () => {
		// A real DeepSeek reply lost a duel this way: the judge quotes a word
		// from the passage and does not escape the quotes around it.
		const text = '{"verdict": "A", "reason": "Despite its clumsy repetition of "decide," A carries the sentence."}'
		expect(parseVerdict(text)).toEqual({
			verdict: 'A',
			reason: 'Despite its clumsy repetition of "decide," A carries the sentence.',
		})
	})

	test('salvages a reply whose broken object sits between chatter', () => {
		const text = 'Here:\n```json\n{"verdict": "b", "reason": "B drops the "made a determination" padding."}\n```\nDone.'
		expect(parseVerdict(text)).toEqual({
			verdict: 'B',
			reason: 'B drops the "made a determination" padding.',
		})
	})

	test('an escaped quote takes the strict path, untouched', () => {
		// Salvage cannot read this shape, because the reason is not the last
		// field, so a correct result proves JSON.parse handled it.
		const out = parseVerdict('{"reason": "A says \\"stop\\" twice.", "verdict": "B"}')
		expect(out).toEqual({ verdict: 'B', reason: 'A says "stop" twice.' })
	})

	test('salvage unescapes a backslash before a quote correctly', () => {
		const text = '{"verdict": "A", "reason": "A ends on a backslash \\\\ and says "no"."}'
		expect(parseVerdict(text).reason).toBe('A ends on a backslash \\ and says "no".')
	})

	test('a salvaged object with a bad verdict is still rejected', () => {
		const text = '{"verdict": "maybe", "reason": "Neither, it said "both" really."}'
		expect(() => parseVerdict(text, 'deepseek')).toThrow(/deepseek.*schema/)
	})

	test('salvage refuses an unquoted verdict value rather than guessing', () => {
		expect(() => parseVerdict('{"verdict": A, "reason": "A is plainer."}', 'deepseek')).toThrow(
			/deepseek.*will not parse/,
		)
	})

	test('salvage does not fire when the object is well formed', () => {
		// The strict path keeps the parsed value verbatim; salvage would strip
		// the escaping a second time.
		expect(parseVerdict('{"verdict": "A", "reason": "It reads \\\\ cleanly."}').reason).toBe(
			'It reads \\ cleanly.',
		)
	})

	test('normalises a lowercase verdict', () => {
		expect(parseVerdict('{"verdict": "a", "reason": "Short."}').verdict).toBe('A')
		expect(parseVerdict('{"verdict": " b ", "reason": "Short."}').verdict).toBe('B')
		expect(parseVerdict('{"verdict": "TIE", "reason": "Short."}').verdict).toBe('tie')
	})

	test('rejects a reply with no reason', () => {
		expect(() => parseVerdict('{"verdict": "A"}', 'gpt-5')).toThrow(/gpt-5.*schema/)
	})

	test('rejects an empty reason', () => {
		expect(() => parseVerdict('{"verdict": "A", "reason": ""}')).toThrow(/schema/)
	})

	test('rejects a verdict that is not A, B or tie', () => {
		expect(() => parseVerdict('{"verdict": "both", "reason": "Hard to say."}')).toThrow(/schema/)
	})

	test('throws when the reply holds no object, naming who replied', () => {
		expect(() => parseVerdict('I prefer the shorter one.', 'gemini')).toThrow(/gemini/)
	})

	test('throws when the reply is a JSON array rather than an object', () => {
		expect(() => parseVerdict('["A", "it is shorter"]', 'gemini')).toThrow(/gemini/)
	})

	test('throws when the braces hold JSON that will not parse', () => {
		expect(() => parseVerdict('{verdict: A}', 'deepseek')).toThrow(/deepseek.*will not parse/)
	})

	test('names "the judge" when no who is given', () => {
		expect(() => parseVerdict('nothing here')).toThrow(/the judge/)
	})
})

describe('originalWon', () => {
	const cases: [Choice, boolean, boolean | null][] = [
		['A', true, true],
		['A', false, false],
		['B', true, false],
		['B', false, true],
		['tie', true, null],
		['tie', false, null],
	]

	for (const [verdict, aIsOriginal, want] of cases) {
		test(`verdict ${verdict} with the author version on ${aIsOriginal ? 'A' : 'B'} gives ${want}`, () => {
			expect(originalWon(verdict, aIsOriginal)).toBe(want)
		})
	}
})

describe('tally', () => {
	test('an empty list scores zero everywhere', () => {
		expect(tally([])).toEqual({ total: 0, original: 0, rewrite: 0, ties: 0 })
	})

	test('counts wins, losses and ties', () => {
		const duels = [
			{ originalWon: true },
			{ originalWon: false },
			{ originalWon: false },
			{ originalWon: null },
			{ originalWon: false },
		]
		expect(tally(duels)).toEqual({ total: 5, original: 1, rewrite: 3, ties: 1 })
	})

	test('a tie counts towards the total but towards neither side', () => {
		const { total, original, rewrite, ties } = tally([{ originalWon: null }])
		expect([total, original, rewrite, ties]).toEqual([1, 0, 0, 1])
	})
})
