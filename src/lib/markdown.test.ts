import { describe, expect, test } from 'bun:test'
import {
	editorSchema,
	jsonToMarkdown,
	markdownToJSON,
	parseMarkdown,
	serializeMarkdown,
} from './markdown'

/** Parse then serialize. */
const round = (md: string) => serializeMarkdown(parseMarkdown(md))

describe('editorSchema', () => {
	test('is memoised', () => {
		expect(editorSchema()).toBe(editorSchema())
	})

	test('uses TipTap node and mark names', () => {
		const schema = editorSchema()
		for (const name of ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'hardBreak']) {
			expect(schema.nodes[name]).toBeDefined()
		}
		for (const name of ['bold', 'italic', 'code', 'link']) {
			expect(schema.marks[name]).toBeDefined()
		}
	})
})

describe('parseMarkdown', () => {
	test('headings carry their level', () => {
		const doc = parseMarkdown('# One\n\n### Three\n')
		expect(doc.child(0).type.name).toBe('heading')
		expect(doc.child(0).attrs.level).toBe(1)
		expect(doc.child(1).attrs.level).toBe(3)
	})

	test('a fenced block keeps its language', () => {
		const doc = parseMarkdown('```rust\nlet x = 1;\n```\n')
		expect(doc.child(0).type.name).toBe('codeBlock')
		expect(doc.child(0).attrs.language).toBe('rust')
		expect(doc.child(0).textContent).toBe('let x = 1;')
	})

	test('an indented block has no language', () => {
		const doc = parseMarkdown('    let x = 1;\n')
		expect(doc.child(0).type.name).toBe('codeBlock')
		expect(doc.child(0).attrs.language).toBeNull()
	})

	test('an ordered list keeps its start number', () => {
		const doc = parseMarkdown('3. three\n4. four\n')
		expect(doc.child(0).type.name).toBe('orderedList')
		expect(doc.child(0).attrs.start).toBe(3)
	})

	test('emphasis becomes italic and strong becomes bold', () => {
		const doc = parseMarkdown('*a* **b**\n')
		const marks = doc.child(0).content.content.map((n) => n.marks.map((m) => m.type.name))
		expect(marks).toEqual([['italic'], [], ['bold']])
	})

	test('a link keeps href and title', () => {
		const doc = parseMarkdown('[text](https://example.com "T")\n')
		const mark = doc.child(0).child(0).marks[0]!
		expect(mark.type.name).toBe('link')
		expect(mark.attrs.href).toBe('https://example.com')
		expect(mark.attrs.title).toBe('T')
	})

	test('a hard break is a hardBreak node', () => {
		const doc = parseMarkdown('one\\\ntwo\n')
		expect(doc.child(0).child(1).type.name).toBe('hardBreak')
	})

	test('an empty string gives one empty paragraph', () => {
		const doc = parseMarkdown('')
		expect(doc.childCount).toBe(1)
		expect(doc.child(0).type.name).toBe('paragraph')
		expect(doc.child(0).content.size).toBe(0)
	})

	test('a nested list nests', () => {
		const doc = parseMarkdown('- outer\n  - inner\n')
		const item = doc.child(0).child(0)
		expect(item.type.name).toBe('listItem')
		expect(item.child(1).type.name).toBe('bulletList')
		expect(item.child(1).textContent).toBe('inner')
	})
})

describe('serializeMarkdown', () => {
	test('an empty document serializes to an empty string', () => {
		expect(serializeMarkdown(parseMarkdown(''))).toBe('')
	})

	test('output carries no trailing newline', () => {
		expect(round('# Title\n')).toBe('# Title')
	})

	test('inline code containing backticks is padded', () => {
		expect(round('inline ``a ` b`` code\n')).toBe('inline `` a ` b `` code')
	})

	test('a code block containing a fence gets a longer fence', () => {
		const md = '````\n```\ninner\n```\n````\n'
		expect(round(md)).toBe('````\n```\ninner\n```\n````')
	})

	test('bold and italic nest', () => {
		expect(round('**bold with *italic* inside**\n')).toBe('**bold with *italic* inside**')
	})

	test('a hard break survives', () => {
		expect(round('one\\\ntwo\n')).toBe('one\\\ntwo')
	})

	test('bullets are normalised to a dash', () => {
		expect(round('* a\n* b\n')).toBe('- a\n- b')
	})

	test('lists serialize tight, so a loose list becomes tight', () => {
		expect(round('- a\n\n- b\n')).toBe('- a\n- b')
	})
})

describe('round trips', () => {
	const document = [
		'# On plainness',
		'',
		'A paragraph with *emphasis*, **strength**, `code` and a',
		'[link](https://example.com).',
		'',
		'## A list',
		'',
		'- first item',
		'- second item',
		'  - nested item',
		'',
		'1. one',
		'2. two',
		'',
		'> A quotation.',
		'>',
		'> Its second paragraph.',
		'',
		'```python',
		'def f():',
		'    return 1',
		'```',
		'',
		'---',
		'',
		'A last line\\',
		'broken in two.',
	].join('\n')

	test('a realistic document is stable after one pass', () => {
		const once = round(document)
		expect(round(once)).toBe(once)
	})

	test('a realistic document keeps every construct', () => {
		const once = round(document)
		expect(once).toContain('# On plainness')
		expect(once).toContain('*emphasis*')
		expect(once).toContain('**strength**')
		expect(once).toContain('`code`')
		expect(once).toContain('[link](https://example.com)')
		expect(once).toContain('  - nested item')
		expect(once).toContain('1. one')
		expect(once).toContain('> A quotation.')
		expect(once).toContain('```python')
		expect(once).toContain('---')
		expect(once).toContain('\\\nbroken in two.')
	})

	test('a table survives as literal text', () => {
		const out = round('| a | b |\n|---|---|\n| 1 | 2 |\n')
		expect(out).toContain('| a | b |')
		expect(out).toContain('| 1 | 2 |')
		expect(round(out)).toBe(out)
	})

	test('raw HTML survives as literal text', () => {
		const out = round('<div class="x">raw</div>\n')
		expect(out).toBe('<div class="x">raw</div>')
		expect(round(out)).toBe(out)
	})

	test('an astral character survives', () => {
		expect(round('A face \u{1F600} here.\n')).toBe('A face \u{1F600} here.')
	})
})

describe('JSON bridge', () => {
	test('markdownToJSON produces a ProseMirror document', () => {
		const json = markdownToJSON('# Title\n')
		expect(json.type).toBe('doc')
		expect(json).toEqual({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
			],
		})
	})

	test('jsonToMarkdown reverses markdownToJSON', () => {
		const md = '## Heading\n\nA paragraph with **bold**.'
		expect(jsonToMarkdown(markdownToJSON(md))).toBe(md)
	})
})
