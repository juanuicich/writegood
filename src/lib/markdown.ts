/**
 * Markdown is the source of truth for a draft (SPEC 6.1). This module converts
 * between a Markdown string and a TipTap/ProseMirror document.
 *
 * `prosemirror-markdown` ships a parser and a serializer for the
 * prosemirror-example schema. TipTap's StarterKit uses different node and mark
 * names (`codeBlock` for `code_block`, `bold` for `strong`), and different
 * attribute names (`language` for `params`, `start` for `order`). This module
 * rebuilds both sides against whatever nodes and marks the schema really has,
 * so removing an extension does not break conversion.
 *
 * The supported subset is the one SPEC 6.1 lists: paragraphs, headings,
 * emphasis, strong, code, code blocks, blockquotes, lists, horizontal rules,
 * links and hard breaks. Anything else round-trips as literal text.
 */
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import MarkdownIt from 'markdown-it'
import {
	MarkdownParser,
	MarkdownSerializer,
	type MarkdownSerializerState,
} from 'prosemirror-markdown'

/** A markdown-it token. Typed locally because markdown-it's own token path moved. */
interface MDToken {
	info: string
	tag: string
	attrGet(name: string): string | null
}

type ParseSpec = ConstructorParameters<typeof MarkdownParser>[2][string]
type NodeSerializer = MarkdownSerializer['nodes'][string]
type MarkSerializer = MarkdownSerializer['marks'][string]

let cachedSchema: Schema | null = null

/** The editor schema. Memoised: building it walks every extension. */
export function editorSchema(): Schema {
	if (!cachedSchema) cachedSchema = getSchema([StarterKit]) as Schema
	return cachedSchema
}

const parsers = new WeakMap<Schema, MarkdownParser>()
const serializers = new WeakMap<Schema, MarkdownSerializer>()

/**
 * The markdown-it dialect. CommonMark with raw HTML off, so a construct outside
 * the subset arrives as plain text. The commonmark preset already leaves tables
 * and strikethrough out; disabling them again states the intent and survives a
 * change of preset.
 */
function tokenizer(): ReturnType<typeof MarkdownIt> {
	return MarkdownIt('commonmark', { html: false }).disable(['table', 'strikethrough'], true)
}

function buildParser(schema: Schema): MarkdownParser {
	const tokens: Record<string, ParseSpec> = {}
	const node = (token: string, name: string, spec: Omit<ParseSpec, 'node'> = {}) => {
		if (schema.nodes[name]) tokens[token] = { node: name, ...spec }
	}
	const block = (token: string, name: string, spec: Omit<ParseSpec, 'block'> = {}) => {
		if (schema.nodes[name]) tokens[token] = { block: name, ...spec }
	}
	const mark = (token: string, name: string, spec: Omit<ParseSpec, 'mark'> = {}) => {
		if (schema.marks[name]) tokens[token] = { mark: name, ...spec }
	}

	block('paragraph', 'paragraph')
	block('blockquote', 'blockquote')
	block('list_item', 'listItem')
	block('bullet_list', 'bulletList')
	block('ordered_list', 'orderedList', {
		getAttrs: (tok) => ({ start: Number((tok as MDToken).attrGet('start')) || 1 }),
	})
	block('heading', 'heading', {
		getAttrs: (tok) => ({ level: Number((tok as MDToken).tag.slice(1)) }),
	})
	block('code_block', 'codeBlock', { noCloseToken: true })
	block('fence', 'codeBlock', {
		getAttrs: (tok) => ({ language: (tok as MDToken).info || null }),
		noCloseToken: true,
	})
	node('hr', 'horizontalRule')
	node('hardbreak', 'hardBreak')
	mark('em', 'italic')
	mark('strong', 'bold')
	mark('code_inline', 'code', { noCloseToken: true })
	mark('link', 'link', {
		getAttrs: (tok) => ({
			href: (tok as MDToken).attrGet('href'),
			title: (tok as MDToken).attrGet('title') || null,
		}),
	})

	return new MarkdownParser(schema, tokenizer(), tokens)
}

/** Backtick fence long enough to contain the code block's own backticks. */
function fenceFor(text: string): string {
	const runs = text.match(/`{3,}/gm)
	return runs ? runs.sort().slice(-1)[0]! + '`' : '```'
}

/** Backticks needed to delimit an inline code span that contains backticks. */
function backticksFor(child: PMNode | null, side: number): string {
	let len = 0
	if (child && child.isText && child.text) {
		const ticks = /`+/g
		let m: RegExpExecArray | null
		while ((m = ticks.exec(child.text))) len = Math.max(len, m[0].length)
	}
	let result = len > 0 && side > 0 ? ' `' : '`'
	for (let i = 0; i < len; i++) result += '`'
	if (len > 0 && side < 0) result += ' '
	return result
}

function buildSerializer(schema: Schema): MarkdownSerializer {
	const nodes: Record<string, NodeSerializer> = {
		text(state, node) {
			state.text(node.text ?? '', !(state as MarkdownSerializerState & { inAutolink?: boolean }).inAutolink)
		},
	}
	const marks: Record<string, MarkSerializer> = {}
	const has = (name: string) => Boolean(schema.nodes[name])

	if (has('paragraph')) {
		nodes.paragraph = (state, node) => {
			state.renderInline(node)
			state.closeBlock(node)
		}
	}
	if (has('heading')) {
		nodes.heading = (state, node) => {
			state.write(state.repeat('#', node.attrs.level as number) + ' ')
			state.renderInline(node, false)
			state.closeBlock(node)
		}
	}
	if (has('blockquote')) {
		nodes.blockquote = (state, node) => {
			state.wrapBlock('> ', null, node, () => state.renderContent(node))
		}
	}
	if (has('codeBlock')) {
		nodes.codeBlock = (state, node) => {
			const fence = fenceFor(node.textContent)
			state.write(fence + ((node.attrs.language as string | null) || '') + '\n')
			state.text(node.textContent, false)
			state.write('\n')
			state.write(fence)
			state.closeBlock(node)
		}
	}
	if (has('bulletList')) {
		nodes.bulletList = (state, node) => {
			state.renderList(node, '  ', () => '- ')
		}
	}
	if (has('orderedList')) {
		nodes.orderedList = (state, node) => {
			const start = (node.attrs.start as number | undefined) ?? 1
			const maxW = String(start + node.childCount - 1).length
			const space = state.repeat(' ', maxW + 2)
			state.renderList(node, space, (i) => {
				const n = String(start + i)
				return state.repeat(' ', maxW - n.length) + n + '. '
			})
		}
	}
	if (has('listItem')) {
		nodes.listItem = (state, node) => state.renderContent(node)
	}
	if (has('horizontalRule')) {
		nodes.horizontalRule = (state, node) => {
			state.write('---')
			state.closeBlock(node)
		}
	}
	if (has('hardBreak')) {
		// A trailing hard break at the end of a block has nothing to break, so skip it.
		nodes.hardBreak = (state, node, parent, index) => {
			for (let i = index + 1; i < parent.childCount; i++) {
				if (parent.child(i).type !== node.type) {
					state.write('\\\n')
					return
				}
			}
		}
	}

	if (schema.marks.italic) {
		marks.italic = { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true }
	}
	if (schema.marks.bold) {
		marks.bold = { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true }
	}
	if (schema.marks.code) {
		marks.code = {
			open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
			close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
			escape: false,
		}
	}
	if (schema.marks.link) {
		marks.link = {
			open: '[',
			close: (_state, mark) => {
				const href = String(mark.attrs.href ?? '').replace(/[()"]/g, '\\$&')
				const title = mark.attrs.title
					? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
					: ''
				return `](${href}${title})`
			},
			mixable: true,
		}
	}

	return new MarkdownSerializer(nodes, marks, {
		hardBreakNodeName: 'hardBreak',
		// Lists round-trip tight. TipTap's list nodes carry no `tight` attribute,
		// so the distinction cannot survive parsing; tight is the common case in prose.
		tightLists: true,
		// A mark the subset does not cover, such as strike, renders as its own text
		// instead of throwing.
		strict: false,
	} as ConstructorParameters<typeof MarkdownSerializer>[2])
}

function parserFor(schema: Schema): MarkdownParser {
	let parser = parsers.get(schema)
	if (!parser) {
		parser = buildParser(schema)
		parsers.set(schema, parser)
	}
	return parser
}

function serializerFor(schema: Schema): MarkdownSerializer {
	let serializer = serializers.get(schema)
	if (!serializer) {
		serializer = buildSerializer(schema)
		serializers.set(schema, serializer)
	}
	return serializer
}

/** Parse Markdown into a ProseMirror document. An empty string gives one empty paragraph. */
export function parseMarkdown(md: string, schema: Schema = editorSchema()): PMNode {
	return parserFor(schema).parse(md) as unknown as PMNode
}

/** Serialize a ProseMirror document to Markdown. An empty document gives an empty string. */
export function serializeMarkdown(doc: PMNode): string {
	const schema = doc.type.schema as unknown as Schema
	return serializerFor(schema).serialize(doc as never)
}

/** Markdown to the ProseMirror JSON stored in `revisions.content_json`. */
export function markdownToJSON(md: string): Record<string, unknown> {
	return parseMarkdown(md).toJSON() as Record<string, unknown>
}

/** ProseMirror JSON from `revisions.content_json` back to Markdown. */
export function jsonToMarkdown(json: Record<string, unknown>): string {
	const schema = editorSchema()
	return serializeMarkdown(schema.nodeFromJSON(json) as unknown as PMNode)
}
