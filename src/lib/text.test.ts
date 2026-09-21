import { describe, expect, test } from 'bun:test'
import { parseMarkdown } from './markdown'
import {
	buildTextIndex,
	codePointRangeToPM,
	contextAt,
	pmRangeToCodePoints,
	type TextIndex,
} from './text'

const indexOf = (md: string): TextIndex => buildTextIndex(parseMarkdown(md))

/** Code point index of the first occurrence of `needle`. */
function cpIndex(index: TextIndex, needle: string): number {
	const utf16 = index.text.indexOf(needle)
	expect(utf16).toBeGreaterThanOrEqual(0)
	return Array.from(index.text.slice(0, utf16)).length
}

const THREE = 'First para.\n\nSecond para.\n\nThird para.\n'

describe('buildTextIndex', () => {
	test('joins blocks with a blank line', () => {
		const index = indexOf(THREE)
		expect(index.text).toBe('First para.\n\nSecond para.\n\nThird para.')
	})

	test('has one position per code point', () => {
		const index = indexOf(THREE)
		expect(index.pos.length).toBe(Array.from(index.text).length)
	})

	test('positions never go backwards', () => {
		const index = indexOf(THREE)
		for (let i = 1; i < index.pos.length; i++) {
			expect(index.pos[i]!).toBeGreaterThanOrEqual(index.pos[i - 1]!)
		}
	})

	test('code point 0 is the first position inside the first block', () => {
		const index = indexOf(THREE)
		expect(index.pos[0]).toBe(1)
		expect(codePointRangeToPM(index, 0, 5)).toEqual({ from: 1, to: 6 })
	})

	test('a separator takes the position at the end of the preceding block', () => {
		const index = indexOf('ab\n\ncd\n')
		// doc: <p>ab</p><p>cd</p> — "ab" sits at 1 and 2, the first paragraph ends at 3,
		// and "cd" sits at 5 and 6. Both separator code points take position 3.
		expect(index.text).toBe('ab\n\ncd')
		expect(index.pos).toEqual([1, 2, 3, 3, 5, 6])
	})

	test('an empty document has no text and no positions', () => {
		const index = indexOf('')
		expect(index.text).toBe('')
		expect(index.pos).toEqual([])
	})

	test('nested blocks each contribute text', () => {
		const index = indexOf('- one\n- two\n')
		expect(index.text).toBe('one\n\ntwo')
	})

	test('a heading and a code block contribute text', () => {
		const index = indexOf('# Title\n\n```js\nlet a = 1;\n```\n')
		expect(index.text).toBe('Title\n\nlet a = 1;')
	})

	test('a hard break contributes a newline', () => {
		const index = indexOf('one\\\ntwo\n')
		expect(index.text).toBe('one\ntwo')
		expect(index.pos.length).toBe(7)
	})
})

describe('mapping', () => {
	test('a range in the third paragraph maps back and forth losslessly', () => {
		const index = indexOf(THREE)
		const from = cpIndex(index, 'Third')
		const to = from + 5
		const pm = codePointRangeToPM(index, from, to)!
		expect(pm).not.toBeNull()
		expect(pmRangeToCodePoints(index, pm.from, pm.to)).toEqual({ from, to })
	})

	test('a mapped range selects the quoted text in the document', () => {
		const doc = parseMarkdown(THREE)
		const index = buildTextIndex(doc)
		const from = cpIndex(index, 'Second')
		const pm = codePointRangeToPM(index, from, from + 6)!
		expect(doc.textBetween(pm.from, pm.to)).toBe('Second')
	})

	test('an offset after an emoji still maps correctly', () => {
		const doc = parseMarkdown('Hello \u{1F600} world.\n')
		const index = buildTextIndex(doc)
		// "world" starts at code point 8: the emoji is one code point, two UTF-16 units.
		const from = cpIndex(index, 'world')
		expect(from).toBe(8)
		const pm = codePointRangeToPM(index, from, from + 5)!
		expect(doc.textBetween(pm.from, pm.to)).toBe('world')
		expect(pmRangeToCodePoints(index, pm.from, pm.to)).toEqual({ from, to: from + 5 })
	})

	test('an emoji occupies one code point and two ProseMirror positions', () => {
		const index = indexOf('a\u{1F600}b\n')
		expect(Array.from(index.text).length).toBe(3)
		expect(index.pos).toEqual([1, 2, 4])
		expect(codePointRangeToPM(index, 1, 2)).toEqual({ from: 2, to: 4 })
	})

	test('several emoji in a row stay aligned', () => {
		const doc = parseMarkdown('\u{1F600}\u{1F600}\u{1F600} tail\n')
		const index = buildTextIndex(doc)
		const from = cpIndex(index, 'tail')
		const pm = codePointRangeToPM(index, from, from + 4)!
		expect(doc.textBetween(pm.from, pm.to)).toBe('tail')
	})

	test('an empty range maps to a single position', () => {
		const index = indexOf(THREE)
		expect(codePointRangeToPM(index, 3, 3)).toEqual({ from: 4, to: 4 })
	})

	test('a range covering the whole text maps to the last position', () => {
		const index = indexOf('ab\n')
		expect(codePointRangeToPM(index, 0, 2)).toEqual({ from: 1, to: 3 })
	})

	test('out of range returns null rather than clamping', () => {
		const index = indexOf(THREE)
		const n = Array.from(index.text).length
		expect(codePointRangeToPM(index, 0, n + 1)).toBeNull()
		expect(codePointRangeToPM(index, -1, 2)).toBeNull()
		expect(codePointRangeToPM(index, 5, 2)).toBeNull()
		expect(codePointRangeToPM(index, 0, 1.5)).toBeNull()
	})

	test('a ProseMirror range outside the text returns null', () => {
		const index = indexOf('ab\n')
		expect(pmRangeToCodePoints(index, 0, 99)).toBeNull()
		expect(pmRangeToCodePoints(index, -1, 2)).toBeNull()
		expect(pmRangeToCodePoints(index, 3, 1)).toBeNull()
	})

	test('an empty index maps only the empty range', () => {
		const index = indexOf('')
		expect(codePointRangeToPM(index, 0, 0)).toEqual({ from: 0, to: 0 })
		expect(codePointRangeToPM(index, 0, 1)).toBeNull()
	})
})

describe('contextAt', () => {
	test('gives 32 code points either side by default', () => {
		const index = indexOf('x'.repeat(50) + ' QUOTE ' + 'y'.repeat(50) + '\n')
		const from = cpIndex(index, 'QUOTE')
		const ctx = contextAt(index, from, from + 5)
		expect(ctx.quote).toBe('QUOTE')
		expect(Array.from(ctx.prefix).length).toBe(32)
		expect(Array.from(ctx.suffix).length).toBe(32)
		expect(ctx.prefix.endsWith('x ')).toBe(true)
	})

	test('clamps at the start of the document', () => {
		const index = indexOf(THREE)
		const ctx = contextAt(index, 0, 5)
		expect(ctx.prefix).toBe('')
		expect(ctx.quote).toBe('First')
		expect(ctx.suffix).toBe(' para.\n\nSecond para.\n\nThird para.'.slice(0, 32))
	})

	test('clamps at the end of the document', () => {
		const index = indexOf(THREE)
		const n = Array.from(index.text).length
		const ctx = contextAt(index, n - 5, n)
		expect(ctx.quote).toBe('para.')
		expect(ctx.suffix).toBe('')
		expect(Array.from(ctx.prefix).length).toBe(32)
	})

	test('counts context in code points, not UTF-16 units', () => {
		const index = indexOf('\u{1F600}\u{1F600}\u{1F600}quote\n')
		const ctx = contextAt(index, 3, 8, 2)
		expect(ctx.quote).toBe('quote')
		expect(ctx.prefix).toBe('\u{1F600}\u{1F600}')
	})

	test('a range beyond the text clamps to the end', () => {
		const index = indexOf('ab\n')
		expect(contextAt(index, 1, 99)).toEqual({ prefix: 'a', quote: 'b', suffix: '' })
	})
})
