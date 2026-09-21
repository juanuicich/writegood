/**
 * Flattens a ProseMirror document to plain text and keeps a position table.
 *
 * Findings are anchored by quote plus context (SPEC 7). Rust does the string
 * matching and returns offsets in Unicode scalar values — code points, not
 * bytes and not UTF-16 code units. This module builds the same view of the
 * document on the TypeScript side, so a Rust offset indexes straight into the
 * table and comes back as a ProseMirror position.
 *
 * A text node's ProseMirror size is counted in UTF-16 code units, so an astral
 * character such as an emoji occupies two positions but one code point. Every
 * index here is built by iterating code points for that reason.
 */
import type { Node as PMNode } from '@tiptap/pm/model'

export interface TextIndex {
	/** The flattened document text. */
	text: string
	/** One entry per CODE POINT of `text`: the ProseMirror position of that code point. */
	pos: number[]
}

/** Blocks are separated by a blank line, so passes can split the text on paragraphs. */
const SEPARATOR = '\n\n'

/**
 * Per-index code points, kept beside the public shape so slicing and width
 * lookups stay O(1) without changing `TextIndex`.
 */
const codePoints = new WeakMap<TextIndex, string[]>()

function cpsOf(index: TextIndex): string[] {
	let cps = codePoints.get(index)
	if (!cps) {
		cps = Array.from(index.text)
		codePoints.set(index, cps)
	}
	return cps
}

/**
 * Flatten `doc` into text plus a code-point-to-position table.
 *
 * Every textblock — a paragraph, a heading, a list item's paragraph, a code
 * block — contributes its text. Consecutive textblocks are separated by a blank
 * line. The separator's code points take the position at the end of the
 * preceding block, so a range that runs over a block boundary still maps to a
 * position inside the document.
 *
 * A hard break contributes a single newline at its own position, because it is
 * a line boundary the author can see and can quote across.
 */
export function buildTextIndex(doc: PMNode): TextIndex {
	const parts: string[] = []
	const pos: number[] = []
	let lastEnd = 0
	let started = false

	doc.descendants((node, nodePos) => {
		if (node.isTextblock) {
			if (started) {
				for (const ch of SEPARATOR) {
					parts.push(ch)
					pos.push(lastEnd)
				}
			}
			started = true
			// Position just inside the block's closing token.
			lastEnd = nodePos + node.nodeSize - 1

			node.descendants((child, childPos) => {
				const at = nodePos + 1 + childPos
				if (child.isText && child.text) {
					let offset = 0
					for (const cp of child.text) {
						parts.push(cp)
						pos.push(at + offset)
						offset += cp.length
					}
				} else if (child.type.name === 'hardBreak') {
					parts.push('\n')
					pos.push(at)
				}
				return true
			})
			// Text inside a textblock is handled above.
			return false
		}
		return true
	})

	const index: TextIndex = { text: parts.join(''), pos }
	codePoints.set(index, parts)
	return index
}

/** The ProseMirror position one past the last code point, or 0 for an empty index. */
function endPosition(index: TextIndex): number {
	const n = index.pos.length
	if (n === 0) return 0
	const cps = cpsOf(index)
	return index.pos[n - 1]! + cps[n - 1]!.length
}

/**
 * Map a code point range, half-open, to ProseMirror positions.
 * Returns null when the range falls outside the document.
 */
export function codePointRangeToPM(
	index: TextIndex,
	from: number,
	to: number,
): { from: number; to: number } | null {
	const n = index.pos.length
	if (!Number.isInteger(from) || !Number.isInteger(to)) return null
	if (from < 0 || to < from || to > n) return null

	const cps = cpsOf(index)
	const pmFrom = from < n ? index.pos[from]! : endPosition(index)
	const pmTo = to === from ? pmFrom : index.pos[to - 1]! + cps[to - 1]!.length
	return { from: pmFrom, to: pmTo }
}

/** First code point index whose position is at or after `target`. */
function lowerBound(pos: number[], target: number): number {
	let lo = 0
	let hi = pos.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (pos[mid]! < target) lo = mid + 1
		else hi = mid
	}
	return lo
}

/**
 * Map a ProseMirror range back to a code point range, half-open.
 * Returns null when the range falls outside the flattened text.
 */
export function pmRangeToCodePoints(
	index: TextIndex,
	from: number,
	to: number,
): { from: number; to: number } | null {
	if (!Number.isInteger(from) || !Number.isInteger(to)) return null
	if (from < 0 || to < from) return null
	const end = endPosition(index)
	if (from > end || to > end) return null

	return { from: lowerBound(index.pos, from), to: lowerBound(index.pos, to) }
}

/**
 * The text quote selector for a range: the quote and `len` code points either
 * side of it. Context is shorter at the edges of the document.
 */
export function contextAt(
	index: TextIndex,
	from: number,
	to: number,
	len = 32,
): { prefix: string; quote: string; suffix: string } {
	const cps = cpsOf(index)
	const n = cps.length
	const start = Math.max(0, Math.min(from, n))
	const stop = Math.max(start, Math.min(to, n))
	return {
		prefix: cps.slice(Math.max(0, start - len), start).join(''),
		quote: cps.slice(start, stop).join(''),
		suffix: cps.slice(stop, Math.min(n, stop + len)).join(''),
	}
}
