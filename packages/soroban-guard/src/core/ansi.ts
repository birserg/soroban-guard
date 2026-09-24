/**
 * The smallest colour layer that does the job: raw SGR codes, no
 * dependency.
 *
 * A palette package would be one more thing to audit in a tool that signs
 * transactions, and the surface actually needed here is five colours and a
 * dim. `style` is the only entry point, so a caller cannot forget the
 * reset that leaks colour into the next line.
 */

/** SGR codes, resolved by name so call sites read as intent. */
const CODES = {
	green: 32,
	red: 31,
	yellow: 33,
	blue: 34,
	grey: 90,
	bold: 1,
	dim: 2,
} as const;

export type StyleName = keyof typeof CODES;

/**
 * Wrap text in one style, or return it untouched when colour is off.
 *
 * The `enabled` flag is a parameter rather than a module-level check so the
 * renderer stays pure: a test asserts both the coloured and the plain form
 * without touching `process.stdout` or the environment.
 */
export function style(text: string, name: StyleName, enabled: boolean): string {
	return enabled ? `\u001B[${CODES[name]}m${text}\u001B[0m` : text;
}

/**
 * Printable width, ignoring the SGR sequences `style` inserts.
 *
 * Padding a coloured string with `padEnd` would count the escape bytes and
 * under-pad by about ten columns per cell, which is what turns a table into
 * a staircase. Every alignment decision measures with this instead.
 */
export function visibleWidth(text: string): number {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escapes is the point
	return text.replace(/\u001B\[[0-9;]*m/g, "").length;
}

/** `padEnd` that measures printable width rather than raw length. */
export function padVisible(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

/**
 * Whether this stream should get colour.
 *
 * `NO_COLOR` is honoured because it is the de facto standard for exactly
 * this, and a piped stream gets none: a report redirected to a file should
 * be greppable, not full of escape bytes. `hasColors` is asked rather than
 * assumed since it exists only on a real TTY stream.
 */
export function supportsColor(stream: {
	isTTY?: boolean;
	hasColors?: () => boolean;
}): boolean {
	// Present means off, even empty: that is the NO_COLOR standard, and an
	// empty export (`NO_COLOR= command`) is the common way to set it.
	if (process.env.NO_COLOR !== undefined) {
		return false;
	}
	if (stream.isTTY !== true) {
		return false;
	}
	return stream.hasColors?.() ?? true;
}
