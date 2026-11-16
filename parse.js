// A fast, dependency-free Markdown renderer whose parse() returns exactly the
// HTML marked 18.1.3 renders with its default options (GFM on, breaks off,
// pedantic off). Written from scratch: own structure, own names, own control
// flow. The behaviour it reproduces was studied from the CommonMark 0.31.2
// and GFM 0.29 specs and from observing marked's output on the spec examples.

const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

// Compose a regex from a template string by replacing every occurrence of
// each placeholder word with the source of another pattern, dropping any ^
// anchor the inserted pattern carried (it is meaningless inside the host
// pattern). Placeholders are replaced longest-first by the caller ordering
// them so no placeholder is a substring of an earlier one.
const CARET = /(^|[^\[])\^/g;
function compose(tpl, subs, flags = '') {
  let src = tpl;
  for (const [key, val] of subs) {
    const repl = (typeof val === 'string' ? val : val.source).replace(CARET, '$1');
    src = src.split(key).join(repl);
  }
  return new RegExp(src, flags);
}

// ---------- shared fragments ----------
const HR_SRC = ' {0,3}(?:(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)';
const HEADING_SRC = ' {0,3}#{1,6}(?:\\s|$)';
const FENCES_SRC = ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)';
const BLOCKQUOTE_SRC = ' {0,3}>';
const LIST_BULL_SRC = ' {0,3}(?:[*+-]|\\d{1,9}[.)])';
const HTML_OPEN_SRC = ' {0,3}(?:</?(?:' + BLOCK_TAGS + ')(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';
const TITLE_SRC = '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n]|\\n(?!\\n))*\'|\\((?:\\\\[\\s\\S]|[^()\\\\])*\\)';
const LABEL_SRC = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\\\n]|\\n(?![ \\t]*\\n))+';
const ATTR_SRC = ' +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *\'[^\'\\n]*\'| *= *[^\\s"\'=<>`]+)?';
const COMMENT_SRC = '<!--(?:-?>|[\\s\\S]*?(?:-->|$))';

// ---------- block rules (GFM) ----------
const RE_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const RE_INDENT_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const RE_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const RE_HR = new RegExp('^' + HR_SRC);
const RE_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const RE_LIST_OPEN = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)/;
const RE_HTML_BLOCK = compose(
  '^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|COMMENT[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(TAG)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:ATTR)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))',
  [['COMMENT', COMMENT_SRC], ['TAG', BLOCK_TAGS], ['ATTR', ATTR_SRC]],
  'i'
);
const RE_DEF = compose(
  '^ {0,3}\\[(LABEL)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(TITLE))? *(?:\\n+|$)',
  [['LABEL', LABEL_SRC], ['TITLE', TITLE_SRC]]
);
const RE_TABLE = compose(
  '^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|HR|HEADING|BLOCKQUOTE|CODE|FENCES|LIST|HTML).*(?:\\n|$))*)\\n*|$)',
  [
    ['HR', new RegExp(HR_SRC)],
    ['HEADING', new RegExp(HEADING_SRC)],
    ['BLOCKQUOTE', / {0,3}>/],
    ['CODE', /(?: {4}| {0,3}\t)[^\n]/],
    ['FENCES', new RegExp(FENCES_SRC)],
    ['LIST', / {0,3}(?:[*+-]|1[.)])[ \t]/],
    ['HTML', new RegExp(HTML_OPEN_SRC)],
  ]
);
const RE_SETEXT = compose(
  '^(?!BULL|BLOCKCODE|FENCES|BLOCKQUOTE|HEADING|HR|HTML|TABLE)((?:.|\\n(?!\\s*?\\n|BULL|FENCES|BLOCKQUOTE|HEADING|HR|HTML|TABLE))+?)\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)',
  [
    ['BULL', new RegExp(LIST_BULL_SRC)],
    ['BLOCKCODE', /(?: {4}| {0,3}\t)/],
    ['FENCES', / {0,3}(?:`{3,}|~{3,})/],
    ['BLOCKQUOTE', / {0,3}>/],
    ['HEADING', new RegExp(HEADING_SRC)],
    ['HR', new RegExp(HR_SRC)],
    ['HTML', / {0,3}<[^\n>]+>\n/],
    ['TABLE', / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/],
  ]
);
// Paragraph body: first line, then continuation lines that do not start a
// block construct. In GFM the setext alternative is empty (setext headings
// are handled by their own rule, tried first) and the table alternative is
// the table rule itself.
const RE_PARAGRAPH = compose(
  '^([^\\n]+(?:\\n(?!HR|HEADING|BLOCKQUOTE|FENCES|LIST|HTML|TABLE|[ \\t]+\\n)[^\\n]+)*)',
  [
    ['HR', new RegExp(HR_SRC)],
    ['HEADING', new RegExp(HEADING_SRC)],
    ['BLOCKQUOTE', / {0,3}>/],
    ['FENCES', new RegExp(FENCES_SRC)],
    ['LIST', / {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/],
    ['HTML', new RegExp(HTML_OPEN_SRC)],
    ['TABLE', RE_TABLE],
  ]
);
const RE_TEXT = /^[^\n]+/;
// Blockquote body: lines starting with >, or paragraph lines while the quote
// is still "open" (the paragraph rule below is the GFM paragraph built with
// the list pattern that starts a list only after a space).
const RE_BQ_PARAGRAPH = compose(
  '^([^\\n]+(?:\\n(?!HR|HEADING|BLOCKQUOTE|FENCES|LIST|HTML|[ \\t]+\\n)[^\\n]+)*)',
  [
    ['HR', new RegExp(HR_SRC)],
    ['HEADING', new RegExp(HEADING_SRC)],
    ['BLOCKQUOTE', / {0,3}>/],
    ['FENCES', new RegExp(FENCES_SRC)],
    ['LIST', / {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/],
    ['HTML', new RegExp(HTML_OPEN_SRC)],
  ]
);
const RE_BLOCKQUOTE = compose(
  '^( {0,3}> ?(?:(?![ \\t]*(?:\\n|$))(PARA)|[^\\n]*)(?:\\n|$))+',
  [['PARA', RE_BQ_PARAGRAPH]]
);

// ---------- inline rules (GFM) ----------
const RE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RE_TAG = compose(
  '^COMMENT|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:ATTR)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
  [['COMMENT', COMMENT_SRC], ['ATTR', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/]]
);
const LABEL_INLINE_SRC = '(?:\\[(?:BRACKETS|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\])|[^\\[\\]\\\\`])*?';
const BRACKETS_SRC = '\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]';
const HREF_SRC = '<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]+|(?=\\))';
const RE_LINK = compose(
  '^!?\\[(LABEL)\\]\\([ \\t\\n]*(HREF)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(TITLE))?[ \\t\\n]*\\)',
  [
    ['LABEL', compose(LABEL_INLINE_SRC, [['BRACKETS', BRACKETS_SRC]])],
    ['HREF', HREF_SRC],
    ['TITLE', TITLE_SRC],
  ]
);
const RE_REFLINK = compose('^!?\\[(LABEL)\\]\\[(REF)\\]', [
  ['LABEL', compose(LABEL_INLINE_SRC, [['BRACKETS', BRACKETS_SRC]])],
  ['REF', LABEL_SRC],
]);
const RE_NOLINK = compose('^!?\\[(REF)\\](?:\\[\\])?', [['REF', LABEL_SRC]]);
// Delimiter regexes. The right-delimiter scanners are built from a template
// whose placeholders name character classes that differ between the GFM
// variants (tilde is punctuation-like for * and _ but not for ~~).
const PUNCT = '[\\p{P}\\p{S}]';
const PUNCT_NOT_TILDE = '(?!~)[\\p{P}\\p{S}]';
const SPACE_PUNCT = '[\\s\\p{P}\\p{S}]';
const SPACE_PUNCT_NOT_TILDE = '(?!~)[\\s\\p{P}\\p{S}]';
const NOT_SPACE_PUNCT = '[^\\s\\p{P}\\p{S}]';
const NOT_SPACE_PUNCT_TILDE = '(?:[^\\s\\p{P}\\p{S}]|~)';
const AST_RDELIM_TPL =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)PUNCT(\\*+)(?=[\\s]|$)|NOTPUNCTSPACE(\\*+)(?!\\*)(?=PUNCTSPACE|$)|(?!\\*)PUNCTSPACE(\\*+)(?=NOTPUNCTSPACE)|[\\s](\\*+)(?!\\*)(?=PUNCT)|(?!\\*)PUNCT(\\*+)(?!\\*)(?=PUNCT)|NOTPUNCTSPACE(\\*+)(?=NOTPUNCTSPACE)';
const UND_RDELIM_TPL =
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)PUNCT(_+)(?=[\\s]|$)|NOTPUNCTSPACE(_+)(?!_)(?=PUNCTSPACE|$)|(?!_)PUNCTSPACE(_+)(?=NOTPUNCTSPACE)|[\\s](_+)(?!_)(?=PUNCT)|(?!_)PUNCT(_+)(?!_)(?=PUNCT)';
const DEL_RDELIM_TPL =
  '^[^~]+(?=[^~])|(?!~)PUNCT(~~?)(?=[\\s]|$)|NOTPUNCTSPACE(~~?)(?!~)(?=PUNCTSPACE|$)|(?!~)PUNCTSPACE(~~?)(?=NOTPUNCTSPACE)|[\\s](~~?)(?!~)(?=PUNCT)|(?!~)PUNCT(~~?)(?!~)(?=PUNCT)|NOTPUNCTSPACE(~~?)(?=NOTPUNCTSPACE)';
function rdelim(tpl, notPunctSpace, punctSpace, punct) {
  return compose(
    tpl,
    [
      ['NOTPUNCTSPACE', notPunctSpace],
      ['PUNCTSPACE', punctSpace],
      ['PUNCT', punct],
    ],
    'gu'
  );
}
// * closers treat ~ as a plain character; _ and ~~ closers treat it as punctuation.
const RE_RDELIM_AST = rdelim(AST_RDELIM_TPL, NOT_SPACE_PUNCT_TILDE, SPACE_PUNCT_NOT_TILDE, PUNCT_NOT_TILDE);
const RE_RDELIM_UND = rdelim(UND_RDELIM_TPL, NOT_SPACE_PUNCT, SPACE_PUNCT, PUNCT);
const RE_RDELIM_DEL = rdelim(DEL_RDELIM_TPL, NOT_SPACE_PUNCT, SPACE_PUNCT, PUNCT);
const RE_LDELIM = compose(
  '^(?:\\*+(?:((?!\\*)PUNCT)|([^\\s*]))?)|^_+(?:((?!_)PUNCT)|([^\\s_]))?',
  [['PUNCT', PUNCT_NOT_TILDE]],
  'u'
);
const RE_DEL_LDELIM = compose('^~~?(?:((?!~)PUNCT)|[^\\s~])', [['PUNCT', PUNCT]], 'u');
const RE_CODESPAN = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RE_DEL = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;
const RE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/;
const EMAIL_SRC = '[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])';
const RE_URL = compose(
  '^(?:mailto:EMAIL|xmpp:EMAIL(?:\\/[A-Za-z0-9@.]+)?)|^((?:PROTO):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^MAILAT',
  [
    ['EMAIL', EMAIL_SRC],
    ['MAILAT', '[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])'],
    ['PROTO', '[hH][tT][tT][pP][sS]?|[fF][tT][pP]'],
  ]
);
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const RE_INLINE_TEXT = compose(
  '^(?:[^a-zA-Z0-9](?=MAILPROTO)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[`*~_]|\\b_|PROTO:\\/\\/|WWW|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9](?=MAILPROTO)|[^a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-](?=[a-zA-Z0-9.!#$%&\'*+\\/=?_`{\\|}~-]+@))))',
  [
    ['MAILPROTO', '(?:mailto|xmpp):'],
    ['PROTO', '[hH][tT][tT][pP][sS]?|[fF][tT][pP]'],
    ['WWW', '(?<![^\\s*_~(])www\\.'],
  ]
);
// Masking helpers for the emphasis scan.
const RE_ANY_PUNCT = /\\([\p{P}\p{S}])/gu;
const RE_ANY_PUNCT_OUTSIDE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const RE_BLOCK_SKIP = compose(
  'LINK|PRECODECODE|HTML',
  [
    ['LINK', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/],
    ['PRECODE', '(?<!`)()'],
    ['CODE', /(?<b>`+)[^`]+\k<b>(?!`)/],
    ['HTML', /<(?! )[^<>]*?>/],
  ],
  'g'
);
const REFLINK_LABEL_SRC =
  '(?:[^\\[\\]\\\\`]*(?:\\[(?:BRACKETS|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\]))){0,999}?[^\\[\\]\\\\`]*?';
const REFLINK_REF_SRC = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\]){1,999}';
const RE_REFLINK_SEARCH = compose('REFLINK|NOLINK(?!\\()', [
  [
    'REFLINK',
    compose('^!?\\[(LABEL)\\]\\[(REF)\\]', [
      ['LABEL', compose(REFLINK_LABEL_SRC, [['BRACKETS', BRACKETS_SRC]])],
      ['REF', REFLINK_REF_SRC],
    ]),
  ],
  [
    'NOLINK',
    compose('^!?\\[(REF)\\](?:\\[\\])?', [['REF', REFLINK_REF_SRC]]),
  ],
], 'g');
const RE_IS_PUNCT_OR_SPACE = /^((?![*_])[\s\p{P}\p{S}])/u;
const RE_UNICODE_ALNUM = /[\p{L}\p{N}]/u;

// ---------- small helpers ----------
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RE_ESCAPE_TEST = /[&<>"']/;
const RE_ESCAPE_REPLACE = /[&<>"']/g;
const RE_ESCAPE_TEST_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const RE_ESCAPE_REPLACE_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const RE_NUM_REF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const RE_NUM_REF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

function escHtml(s, encode) {
  if (encode) {
    return RE_ESCAPE_TEST.test(s) ? s.replace(RE_ESCAPE_REPLACE, (c) => ENTITIES[c]) : s;
  }
  return RE_ESCAPE_TEST_NO_ENCODE.test(s)
    ? s.replace(RE_ESCAPE_REPLACE_NO_ENCODE, (c) => ENTITIES[c])
    : s;
}

// Turn numeric character references into characters; a bare & that is not a
// valid reference becomes &amp;. Invalid code points become U+FFFD.
function unescapeEntities(s) {
  if (!RE_NUM_REF.test(s)) return s;
  return s.replace(RE_NUM_REF_OR_AMP, (whole, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

function encodeHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Split one table row on unescaped pipes; pad or trim to the column count.
function splitCells(row, count) {
  const marked = row.replace(/\|/g, (ch, off, str) => {
    let escaped = false;
    for (let p = off - 1; p >= 0 && str[p] === '\\'; p--) escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = marked.split(' |');
  let i = 0;
  if (cells[0].trim()) i = 0;
  else cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// Normalize a link reference label: trim, collapse whitespace, case-fold.
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Find the index of the closing paren matching the opener at the start of
// the string, skipping backslash escapes. -1: a closer exists before any
// opener imbalance; -2: the opener is never closed.
function findParenClose(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

// Expand tabs to the next multiple-of-4 stop, counting from `start`.
function expandTabs(s, start = 0) {
  let col = start;
  let out = '';
  for (const ch of s) {
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// Strip trailing characters: with invert=false strip `ch` itself, with
// invert=true strip everything that is not `ch`.
function trimEndChars(s, ch, invert) {
  const n = s.length;
  if (n === 0) return '';
  let cut = 0;
  for (; cut < n;) {
    const c = s.charAt(n - cut - 1);
    if (c === ch && !invert) cut++;
    else if (c !== ch && invert) cut++;
    else break;
  }
  return s.slice(0, n - cut);
}

// Drop trailing blank lines, but keep the text if only one or two lines
// would be dropped (indented code blocks keep a trailing blank or two).
function stripTrailingBlanks(s) {
  const lines = s.split('\n');
  let last = lines.length - 1;
  for (; last >= 0 && /^[ \t]*$/.test(lines[last]);) last--;
  return lines.length - last <= 2 ? s : lines.slice(0, last + 1).join('\n');
}

// Scan a string for delimiter runs, recording the last index at which a
// closer of each kind could start. A run counts only when the character
// before it is not whitespace.
function scanDelimiters(src) {
  const em = { '*': -1, '_': -1 };
  let del = -1;
  const n = src.length;
  for (let s = 0; s < n; s++) {
    const r = src[s];
    if (r !== '*' && r !== '_' && r !== '~') continue;
    const prev = s === 0 ? '\n' : src[s - 1];
    let i = s + 1;
    for (; i < n && src[i] === r;) i++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (r === '~') del = s;
      else em[r] = s;
    }
    s = i - 1;
  }
  return { em, del };
}

// ---------- block lexer ----------
const RE_BQ_START = /^ {0,3}>/;
const RE_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RE_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RE_BQ_STRIP = /^ {0,3}>[ \t]?/gm;
const RE_CODE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const RE_INDENT_FENCE_COMP = /^(\s+)(?:```)/;
const RE_LEADING_SPACE_TAB = /^[ \t]+/;
const RE_NON_SPACE = /[^ ]/;
const RE_BLANK_LINE = /^[ \t]*$/;
const RE_DOUBLE_BLANK = /\n[ \t]*\n[ \t]*$/;
const RE_ANY_LINE = /\n.*\n/;
const RE_LIST_TASK = /^\[[ xX]\][ \t]+\S/;
const RE_LIST_TASK_STRIP = /^\[[ xX]\][ \t]+/;
const RE_TASK_CHECKBOX = /\[[ xX]\]/;
const RE_SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/;
const RE_TABLE_DELIM = /[:|]/;
const RE_TABLE_TRIM = /^\||\| *$/g;
const RE_TABLE_ROW_BLANK = /\n[ \t]*$/;
const RE_ALIGN_RIGHT = /^ *-+: *$/;
const RE_ALIGN_CENTER = /^ *:-+: *$/;
const RE_ALIGN_LEFT = /^ *:-+ *$/;
const RE_ANGLE_OPEN = /^</;
const RE_ANGLE_CLOSE = />$/;
const RE_HREF_BRACKETS = /^<(.*)>$/;
const RE_END_HASH = /#$/;
const RE_END_SPACE_TAB = /[ \t]$/;
const RE_START_A = /^<a /i;
const RE_END_A = /^<\/a>/i;
const RE_START_PRE = /^<(pre|code|kbd|script)(\s|>)/i;
const RE_END_PRE = /^<\/(pre|code|kbd|script)(\s|>)/i;

function freshCtx() {
  return {
    links: Object.create(null),
    queue: [],
    state: { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true },
  };
}

// Queue a string for later inline tokenizing; returns its token array.
function queueInline(ctx, src) {
  const tokens = [];
  ctx.queue.push({ src, tokens });
  return tokens;
}

function tokSpace(src) {
  const m = RE_NEWLINE.exec(src);
  return m && m[0].length > 0 ? { type: 'space', raw: m[0] } : null;
}

function tokIndentCode(src) {
  const m = RE_INDENT_CODE.exec(src);
  if (!m) return null;
  const raw = stripTrailingBlanks(m[0]);
  return { type: 'code', raw, codeBlockStyle: 'indented', text: raw.replace(RE_CODE_INDENT, '') };
}

function tokFences(src) {
  const m = RE_FENCES.exec(src);
  if (!m) return null;
  let text = m[3] || '';
  const open = RE_INDENT_FENCE_COMP.exec(m[0]);
  if (open) {
    const ind = open[1];
    text = text.split('\n').map((line) => {
      const lead = /^[ \t]+/.exec(line);
      return lead ? line.slice(Math.min(lead[0].length, ind.length)) : line;
    }).join('\n');
  }
  const lang = m[2] ? m[2].trim().replace(RE_ANY_PUNCT, '$1') : m[2];
  return { type: 'code', raw: m[0], lang, text };
}

function tokHeading(src, ctx) {
  const m = RE_HEADING.exec(src);
  if (!m) return null;
  let text = m[2].trim();
  if (RE_END_HASH.test(text)) {
    const stripped = trimEndChars(text, '#');
    if (!stripped || RE_END_SPACE_TAB.test(stripped)) text = stripped.trim();
  }
  return { type: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[1].length, text, tokens: queueInline(ctx, text) };
}

function tokHr(src) {
  const m = RE_HR.exec(src);
  return m ? { type: 'hr', raw: trimEndChars(m[0], '\n') } : null;
}

function tokBlockquote(src, ctx) {
  const m = RE_BLOCKQUOTE.exec(src);
  if (!m) return null;
  let lines = trimEndChars(m[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];
  while (lines.length > 0) {
    let seenMarker = false;
    const chunk = [];
    let p = 0;
    for (; p < lines.length; p++) {
      if (RE_BQ_START.test(lines[p])) { chunk.push(lines[p]); seenMarker = true; }
      else if (!seenMarker) chunk.push(lines[p]);
      else break;
    }
    lines = lines.slice(p);
    const joined = chunk.join('\n');
    const stripped = joined
      .replace(RE_BQ_MARKER_WS, (whole, marker, ws) => marker + expandTabs(ws, marker.length))
      .replace(RE_BQ_SETEXT, '\n    $1')
      .replace(RE_BQ_STRIP, '');
    raw = raw ? raw + '\n' + joined : joined;
    text = text ? text + '\n' + stripped : stripped;
    const savedTop = ctx.state.top;
    ctx.state.top = true;
    blockTokens(stripped, tokens, true, ctx);
    ctx.state.top = savedTop;
    if (lines.length === 0) break;
    const last = tokens[tokens.length - 1];
    if (last && (last.type === 'code' || last.type === 'heading' || last.type === 'hr' || last.type === 'html' || last.type === 'table')) break;
    if (last && last.type === 'blockquote') {
      const rest = lines.join('\n');
      const reparsed = last.raw + '\n' + rest.replace(RE_BQ_STRIP, '');
      const inner = tokBlockquote(reparsed, ctx);
      tokens[tokens.length - 1] = inner;
      const leftover = reparsed.substring(inner.raw.length).replace(/^\n/, '');
      const leftCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftCount ? lines.slice(0, -leftCount) : lines;
      if (consumed.length > 0) raw = raw + '\n' + consumed.join('\n');
      text = text.substring(0, text.length - last.text.length) + inner.text;
      lines = lines.slice(consumed.length);
      if (lines.length > 0 && RE_BQ_START.test(lines[0])) continue;
      break;
    } else if (last && last.type === 'list') {
      const whole = last.raw + '\n' + lines.join('\n');
      const relisted = tokList(whole, ctx);
      tokens[tokens.length - 1] = relisted;
      const extra = relisted.raw.length > last.raw.length
        ? whole.slice(last.raw.length + 1, relisted.raw.length).split('\n').length
        : 0;
      if (extra > 0) {
        const taken = lines.slice(0, extra).join('\n');
        raw = raw + '\n' + taken;
        text = text + '\n' + taken;
      }
      lines = lines.slice(extra);
      continue;
    }
  }
  return { type: 'blockquote', raw, tokens, text };
}

const regexCache = new Map();
function cachedRegex(key, make) {
  let re = regexCache.get(key);
  if (!re) { re = make(); regexCache.set(key, re); }
  return re;
}
const listItemRegex = (bullet) =>
  cachedRegex('item:' + bullet, () => new RegExp(`^( {0,3}${bullet})((?:[\t ][^\\n]*)?(?:\\n|$))`));
const nextBulletRegex = (n) =>
  cachedRegex('next:' + n, () => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`));
const hrRegex = (n) =>
  cachedRegex('hr:' + n, () => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const fencesBeginRegex = (n) =>
  cachedRegex('fence:' + n, () => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`));
const headingBeginRegex = (n) =>
  cachedRegex('head:' + n, () => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`));
const htmlBeginRegex = (n) =>
  cachedRegex('html:' + n, () => new RegExp(`^ {0,${n}}(?:</?(?:${BLOCK_TAGS})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const blockquoteBeginRegex = (n) =>
  cachedRegex('bq:' + n, () => new RegExp(`^ {0,${n}}>`));

function tokList(src, ctx) {
  const open = RE_LIST_OPEN.exec(src);
  if (!open) return null;
  const full = src;
  const consumed = () => full.length - src.length;
  let bullet = open[1].trim();
  const ordered = bullet.length > 1;
  const list = { type: 'list', raw: '', ordered, start: ordered ? +bullet.slice(0, -1) : '', loose: false, items: [] };
  bullet = ordered ? `\\d{1,9}\\${bullet.slice(-1)}` : `\\${bullet}`;
  const itemRe = listItemRegex(bullet);
  let prevBlank = false;
  while (src) {
    let empty = false;
    let body = '';
    let m = itemRe.exec(src);
    if (!m || RE_HR.test(src)) break;
    const startPos = consumed();
    src = src.substring(m[0].length);
    const ni0 = m[2].indexOf('\n');
    const firstLine = ni0 === -1 ? m[2] : m[2].slice(0, ni0);
    const markerLen = m[1].length;
    const fc0 = firstLine.charCodeAt(0);
    let content = (fc0 === 32 || fc0 === 9) ? firstLine.replace(RE_LEADING_SPACE_TAB, (ws) => expandTabs(ws, markerLen)) : firstLine;
    const ni1 = src.indexOf('\n');
    let nextLine = ni1 === -1 ? src : src.slice(0, ni1);
    let firstEmpty = !content.trim();
    let indent;
    if (firstEmpty) {
      indent = markerLen + 1;
    } else {
      indent = content.search(RE_NON_SPACE);
      indent = indent > 4 ? 1 : indent;
      body = content.slice(indent);
      indent += markerLen;
    }
    if (firstEmpty && RE_BLANK_LINE.test(nextLine)) {
      src = src.substring(nextLine.length + 1);
      empty = true;
    }
    if (!empty) {
      const clamped = Math.max(0, Math.min(3, indent - 1));
      const nextBullet = nextBulletRegex(clamped);
      const hrRe = hrRegex(clamped);
      const fenceRe = fencesBeginRegex(clamped);
      const headRe = headingBeginRegex(clamped);
      const htmlRe = htmlBeginRegex(clamped);
      const bqRe = blockquoteBeginRegex(clamped);
      while (src) {
        const nl = src.indexOf('\n');
        const line = nl === -1 ? src : src.slice(0, nl);
        nextLine = line;
        const lc0 = line.charCodeAt(0);
        const expanded = (lc0 === 32 || lc0 === 9) ? line.replace(RE_LEADING_SPACE_TAB, (ws) => expandTabs(ws)) : line;
        // A line can only start a fence, heading, html block, blockquote,
        // list item or hr when its first non-space character (within the
        // allowed indent) is one of ` ~ # < > - + * _ or a digit; anything
        // else skips all six begin-tests.
        let pi = 0;
        while (pi < line.length && pi <= clamped && line.charCodeAt(pi) === 32) pi++;
        const fc = pi <= clamped ? line.charCodeAt(pi) : -1;
        if ((fc === 96 || fc === 126 || fc === 35 || fc === 60 || fc === 62 || fc === 45 || fc === 43 || fc === 42 || fc === 95 || (fc >= 48 && fc <= 57)) &&
            (fenceRe.test(line) || headRe.test(line) || htmlRe.test(line) || bqRe.test(line) || nextBullet.test(line) || hrRe.test(line))) break;
        const blank = !line.trim();
        const nonSpace = expanded.length === 0 ? -1 : (expanded.charCodeAt(0) === 32 ? expanded.search(RE_NON_SPACE) : 0);
        if (nonSpace >= indent || blank) {
          body += '\n' + expanded.slice(indent);
        } else {
          if (firstEmpty || (content.includes('\t') ? content.replace(/\t/g, '    ') : content).search(RE_NON_SPACE) >= 4 || fenceRe.test(content) || headRe.test(content) || htmlRe.test(content) || hrRe.test(content)) break;
          const setext = RE_SETEXT_LINE.test(line) && RE_SETEXT.test(content + '\n' + line);
          body += '\n' + (setext ? '    ' + expanded.replace(/^ {0,3}/, '') : line);
        }
        firstEmpty = blank;
        src = nl === -1 ? '' : src.substring(nl + 1);
        content = expanded.slice(indent);
      }
    }
    const rawItem = full.slice(startPos, consumed());
    if (!list.loose) {
      if (prevBlank) list.loose = true;
      else if (RE_DOUBLE_BLANK.test(rawItem)) prevBlank = true;
    }
    list.items.push({ type: 'list_item', raw: rawItem, task: RE_LIST_TASK.test(body), loose: false, text: body, tokens: [] });
  }
  const lastItem = list.items[list.items.length - 1];
  if (!lastItem) return null;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  list.raw = full.slice(0, consumed()).trimEnd();
  for (const item of list.items) {
    ctx.state.top = false;
    item.tokens = blockTokens(item.text, [], false, ctx);
    if (!list.loose) {
      const spaces = item.tokens.filter((t) => t.type === 'space');
      list.loose = spaces.length > 0 && spaces.some((t) => RE_ANY_LINE.test(t.raw));
    }
  }
  ctx.state.top = true;
  for (const item of list.items) {
    const first = item.tokens[0];
    if (item.task && first && (first.type === 'text' || first.type === 'paragraph')) {
      item.text = item.text.replace(RE_LIST_TASK_STRIP, '');
      first.raw = first.raw.replace(RE_LIST_TASK_STRIP, '');
      first.text = first.text.replace(RE_LIST_TASK_STRIP, '');
      for (let q = ctx.queue.length - 1; q >= 0; q--) {
        if (RE_LIST_TASK.test(ctx.queue[q].src)) {
          ctx.queue[q].src = ctx.queue[q].src.replace(RE_LIST_TASK_STRIP, '');
          break;
        }
      }
      const check = RE_TASK_CHECKBOX.exec(item.raw);
      if (check) {
        const box = { type: 'checkbox', raw: check[0] + ' ', checked: check[0] !== '[ ]' };
        item.checked = box.checked;
        if (list.loose) {
          if (item.tokens[0] && (item.tokens[0].type === 'paragraph' || item.tokens[0].type === 'text') && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
            item.tokens[0].raw = box.raw + item.tokens[0].raw;
            item.tokens[0].text = box.raw + item.tokens[0].text;
            item.tokens[0].tokens.unshift(box);
          } else {
            item.tokens.unshift({ type: 'paragraph', raw: box.raw, text: box.raw, tokens: [box] });
          }
        } else {
          item.tokens.unshift(box);
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const t of item.tokens) if (t.type === 'text') t.type = 'paragraph';
    }
  }
  return list;
}

function tokHtmlBlock(src) {
  const m = RE_HTML_BLOCK.exec(src);
  if (!m) return null;
  const raw = stripTrailingBlanks(m[0]);
  return { type: 'html', block: true, raw, pre: m[1] === 'pre' || m[1] === 'script' || m[1] === 'style', text: raw };
}

function tokDef(src) {
  const m = RE_DEF.exec(src);
  if (!m) return null;
  if (!RE_ANGLE_OPEN.test(m[2]) && findParenClose(m[2]) !== -1) return null;
  const tag = normalizeLabel(m[1]);
  const href = m[2] ? m[2].replace(RE_HREF_BRACKETS, '$1').replace(RE_ANY_PUNCT, '$1') : '';
  const title = m[3] ? m[3].substring(1, m[3].length - 1).replace(RE_ANY_PUNCT, '$1') : m[3];
  return { type: 'def', tag, raw: trimEndChars(m[0], '\n'), href, title };
}

function tokTable(src, ctx) {
  const m = RE_TABLE.exec(src);
  if (!m || !RE_TABLE_DELIM.test(m[2])) return null;
  const heads = splitCells(m[1]);
  const aligns = m[2].replace(RE_TABLE_TRIM, '').split('|');
  if (heads.length !== aligns.length) return null;
  const rows = m[3] && m[3].trim() ? m[3].replace(RE_TABLE_ROW_BLANK, '').split('\n') : [];
  const table = { type: 'table', raw: trimEndChars(m[0], '\n'), header: [], align: [], rows: [] };
  for (const a of aligns) {
    table.align.push(RE_ALIGN_RIGHT.test(a) ? 'right' : RE_ALIGN_CENTER.test(a) ? 'center' : RE_ALIGN_LEFT.test(a) ? 'left' : null);
  }
  for (let i = 0; i < heads.length; i++) {
    table.header.push({ text: heads[i], tokens: queueInline(ctx, heads[i]), header: true, align: table.align[i] });
  }
  for (const row of rows) {
    table.rows.push(splitCells(row, table.header.length).map((cell, j) => ({ text: cell, tokens: queueInline(ctx, cell), header: false, align: table.align[j] })));
  }
  return table;
}

function tokSetext(src, ctx) {
  if (!/\n {0,3}[=-]/.test(src)) return null;
  const m = RE_SETEXT.exec(src);
  if (!m) return null;
  const text = m[1].trim();
  return { type: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[2].charAt(0) === '=' ? 1 : 2, text, tokens: queueInline(ctx, text) };
}

function tokParagraph(src, ctx) {
  const m = RE_PARAGRAPH.exec(src);
  if (!m) return null;
  const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
  return { type: 'paragraph', raw: m[0], text, tokens: queueInline(ctx, text) };
}

function tokText(src, ctx) {
  const m = RE_TEXT.exec(src);
  if (!m) return null;
  return { type: 'text', raw: m[0], text: m[0], tokens: queueInline(ctx, m[0]) };
}

// Lex one block level. `tokens` accumulates; `nested` is true when called
// from inside a blockquote/list chunk, where a leading paragraph merges into
// a preceding paragraph token. Returns the token array.
function blockTokens(src, tokens, nested, ctx) {
  let guard = Infinity;
  while (src) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    let tok;
    if ((tok = tokSpace(src))) {
      src = src.slice(tok.raw.length);
      const last = tokens[tokens.length - 1];
      if (tok.raw.length === 1 && last !== undefined) last.raw += '\n';
      else tokens.push(tok);
      continue;
    }
    if ((tok = tokIndentCode(src))) {
      src = src.slice(tok.raw.length);
      const last = tokens[tokens.length - 1];
      if (last && (last.type === 'paragraph' || last.type === 'text')) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        last.text += '\n' + tok.text;
        ctx.queue[ctx.queue.length - 1].src = last.text;
      } else tokens.push(tok);
      continue;
    }
    if ((tok = tokFences(src))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokHeading(src, ctx))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokHr(src))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokBlockquote(src, ctx))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokList(src, ctx))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokHtmlBlock(src))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokDef(src))) {
      src = src.slice(tok.raw.length);
      const last = tokens[tokens.length - 1];
      if (last && (last.type === 'paragraph' || last.type === 'text')) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        last.text += '\n' + tok.raw;
        ctx.queue[ctx.queue.length - 1].src = last.text;
      } else {
        if (!ctx.links[tok.tag]) ctx.links[tok.tag] = { href: tok.href, title: tok.title };
        tokens.push(tok);
      }
      continue;
    }
    if ((tok = tokTable(src, ctx))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if ((tok = tokSetext(src, ctx))) { src = src.slice(tok.raw.length); tokens.push(tok); continue; }
    if (ctx.state.top && (tok = tokParagraph(src, ctx))) {
      const last = tokens[tokens.length - 1];
      if (nested && last && last.type === 'paragraph') {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        last.text += '\n' + tok.text;
        ctx.queue.pop();
        ctx.queue[ctx.queue.length - 1].src = last.text;
      } else {
        tokens.push(tok);
      }
      nested = false;
      src = src.slice(tok.raw.length);
      continue;
    }
    if ((tok = tokText(src, ctx))) {
      src = src.slice(tok.raw.length);
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'text') {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        last.text += '\n' + tok.text;
        ctx.queue.pop();
        ctx.queue[ctx.queue.length - 1].src = last.text;
      } else {
        tokens.push(tok);
      }
      continue;
    }
    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  ctx.state.top = true;
  return tokens;
}

// ---------- inline lexer ----------
function linkInText(src, ctx) {
  if (!src.includes('[')) return false;
  for (const m of src.matchAll(RE_BLOCK_SKIP)) {
    if (RE_LINK.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of src.matchAll(RE_REFLINK_SEARCH)) {
    const s = m[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(ctx.links, normalizeLabel(s.slice(r + 1, -1)))) &&
        !(r > 1 && linkInText(s.slice(1, r - 1), ctx))) return true;
  }
  return false;
}

// Does the link text contain a `<` that opens a tag or autolink reaching
// past the end of the text? If so the link is not a link.
function linkTextHasTag(src, label, bang) {
  if (!label.includes('<')) return false;
  for (let s = 0; s < label.length; s++) {
    if (label[s] === '\\') { s++; continue; }
    if (label[s] === '`') {
      const code = RE_CODESPAN.exec(label.slice(s));
      if (code) { s += code[0].length - 1; continue; }
    }
    if (label[s] !== '<') continue;
    const rest = src.slice(bang + s);
    const tag = RE_TAG.exec(rest) || RE_AUTOLINK.exec(rest);
    if (tag) {
      if (tag[0].length > label.length - s) return true;
      s += tag[0].length - 1;
    }
  }
  return false;
}

// Build a link or image token, tokenizing its text inline. Returns null
// when the text itself contains a link (a link cannot hold another link).
function makeLink(match, ref, raw, ctx) {
  const text = match[1].replace(/\\([\[\]])/g, '$1');
  const isImage = match[0].charAt(0) === '!';
  const savedInLink = ctx.state.inLink;
  const savedEmitted = ctx.state.linkEmitted;
  const savedRawBlock = ctx.state.inRawBlock;
  ctx.state.inLink = true;
  ctx.state.linkEmitted = false;
  const inner = [];
  inlineTokensInto(text, inner, ctx);
  const innerEmitted = ctx.state.linkEmitted;
  ctx.state.linkEmitted = savedEmitted;
  ctx.state.inLink = savedInLink;
  if (!isImage) {
    if (innerEmitted) {
      ctx.state.inRawBlock = savedRawBlock;
      return null;
    }
    ctx.state.linkEmitted = true;
  }
  return { type: isImage ? 'image' : 'link', raw, href: ref.href, title: ref.title || null, text, tokens: inner };
}

function tokEscape(src) {
  const m = RE_ESCAPE.exec(src);
  return m ? { type: 'escape', raw: m[0], text: m[1] } : null;
}

function tokTag(src, ctx) {
  const m = RE_TAG.exec(src);
  if (!m) return null;
  if (!ctx.state.inLink && RE_START_A.test(m[0])) ctx.state.inLink = true;
  else if (ctx.state.inLink && RE_END_A.test(m[0])) ctx.state.inLink = false;
  if (!ctx.state.inRawBlock && RE_START_PRE.test(m[0])) ctx.state.inRawBlock = true;
  else if (ctx.state.inRawBlock && RE_END_PRE.test(m[0])) ctx.state.inRawBlock = false;
  return { type: 'html', raw: m[0], inLink: ctx.state.inLink, inRawBlock: ctx.state.inRawBlock, block: false, text: m[0] };
}

function tokLink(src, ctx) {
  if (ctx.state.linkParenPossible === false) return null;
  const m = RE_LINK.exec(src);
  if (!m) return null;
  const bang = m[0].charAt(0) === '!' ? 2 : 1;
  if (linkTextHasTag(src, m[1], bang)) return null;
  let hrefPart = m[2].trim();
  if (RE_ANGLE_OPEN.test(hrefPart)) {
    if (!RE_ANGLE_CLOSE.test(hrefPart)) return null;
    const stripped = trimEndChars(hrefPart.slice(0, -1), '\\');
    if ((hrefPart.length - stripped.length) % 2 === 0) return null;
  } else {
    const paren = findParenClose(m[2]);
    if (paren === -2) return null;
    if (paren > -1) {
      const cut = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + paren;
      m[2] = m[2].substring(0, paren);
      m[0] = m[0].substring(0, cut).trim();
      m[3] = '';
    }
  }
  const noTrail = trimEndChars(m[0].slice(0, -1), '\\');
  if ((m[0].length - noTrail.length) % 2 === 0) return null;
  let href = m[2];
  const title = m[3] ? m[3].slice(1, -1) : '';
  href = href.trim();
  if (RE_ANGLE_OPEN.test(href)) href = href.slice(1, -1);
  return makeLink(m, { href: href && href.replace(RE_ANY_PUNCT, '$1'), title: title && title.replace(RE_ANY_PUNCT, '$1') }, m[0], ctx);
}

function tokReflink(src, ctx) {
  const m = RE_REFLINK.exec(src) || RE_NOLINK.exec(src);
  if (!m) return null;
  const bang = m[0].charAt(0) === '!' ? 2 : 1;
  if (linkTextHasTag(src, m[1], bang)) return null;
  const ref = ctx.links[normalizeLabel(m[2] || m[1])];
  if (!ref) {
    const ch = m[0].charAt(0);
    return { type: 'text', raw: ch, text: ch };
  }
  return makeLink(m, ref, m[0], ctx);
}

function tokEmStrong(src, masked, prev, ctx, delims) {
  const m = RE_LDELIM.exec(src);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const r = m[0][0];
  const samePrev = prev === r;
  const i = masked.length - src.length;
  let l = i;
  for (; l > 0 && masked[l - 1] === r;) l--;
  const beforeRun = [...masked.slice(Math.max(0, l - 2), l)].at(-1) ?? '';
  const beforeIsPunct = beforeRun === '*' || beforeRun === '_' || RE_IS_PUNCT_OR_SPACE.test(beforeRun);
  if (l < i) prev = beforeRun;
  const prevIsPunct = l < i ? beforeIsPunct : RE_IS_PUNCT_OR_SPACE.test(prev);
  if (m[4] && RE_UNICODE_ALNUM.test(prev)) return null;
  const d = m[1] || m[3] || '';
  if (!d || !prev || prevIsPunct) {
    const k = [...m[0]].length - 1;
    let mm = k;
    let f = 0;
    const y = i - l + k;
    const R = !!beforeRun.trim() && (!!d || (r === '*' && !beforeIsPunct));
    const closer = r === '*' ? RE_RDELIM_AST : RE_RDELIM_UND;
    const v = delims.em[r];
    const Q = masked.length - src.length + k;
    if (v < Q) return null;
    const rest = masked.slice(-1 * src.length + k);
    const ee = v - Q;
    closer.lastIndex = 0;
    let s2;
    while ((s2 = closer.exec(rest)) !== null && !(s2.index > ee)) {
      const g = s2[1] || s2[2] || s2[3] || s2[4] || s2[5] || s2[6];
      if (!g) continue;
      let b = [...g].length;
      if (s2[3] || s2[4]) { mm += b; continue; }
      if (s2[5] || s2[6] || R) {
        if (samePrev && (s2[5] || s2[6])) break;
        if (y % 3 && !((y + b) % 3)) { f += b; continue; }
      }
      if ((mm -= b) > 0) continue;
      b = Math.min(b, b + mm + f);
      const te = [...s2[0]][0].length;
      const M = src.slice(0, k + s2.index + te + b);
      if (Math.min(k, b) % 2) {
        const inner = M.slice(1, -1);
        const innerTokens = [];
        inlineTokensInto(inner, innerTokens, ctx);
        return { type: 'em', raw: M, text: inner, tokens: innerTokens };
      }
      const inner = M.slice(2, -2);
      const innerTokens = [];
      inlineTokensInto(inner, innerTokens, ctx);
      return { type: 'strong', raw: M, text: inner, tokens: innerTokens };
    }
  }
  return null;
}

function tokCodespan(src) {
  const m = RE_CODESPAN.exec(src);
  if (!m) return null;
  let text = m[2].replace(/\n/g, ' ');
  if (/[^ ]/.test(text) && text.charAt(0) === ' ' && text.charAt(text.length - 1) === ' ') {
    text = text.substring(1, text.length - 1);
  }
  return { type: 'codespan', raw: m[0], text };
}

function tokBr(src) {
  const m = RE_BR.exec(src);
  return m ? { type: 'br', raw: m[0] } : null;
}

function tokDel(src, masked, prev, ctx, delims) {
  const m = RE_DEL_LDELIM.exec(src);
  if (!m) return null;
  if (!(m[1] || '') || !prev || RE_IS_PUNCT_OR_SPACE.test(prev)) {
    const o = [...m[0]].length - 1;
    let p = o;
    const u = delims.del;
    const d = masked.length - src.length + o;
    if (u < d) return null;
    const rest = masked.slice(-1 * src.length + o);
    const k = u - d;
    RE_RDELIM_DEL.lastIndex = 0;
    let s2;
    while ((s2 = RE_RDELIM_DEL.exec(rest)) !== null && !(s2.index > k)) {
      const g = s2[1] || s2[2] || s2[3] || s2[4] || s2[5] || s2[6];
      if (!g) continue;
      let l = [...g].length;
      if (l !== o) continue;
      if (s2[3] || s2[4]) { p += l; continue; }
      if ((p -= l) > 0) continue;
      l = Math.min(l, l + p);
      const gg = [...s2[0]][0].length;
      const b = src.slice(0, o + s2.index + gg + l);
      const inner = b.slice(o, -o);
      const innerTokens = [];
      inlineTokensInto(inner, innerTokens, ctx);
      return { type: 'del', raw: b, text: inner, tokens: innerTokens };
    }
  }
  return null;
}

function tokAutolink(src) {
  const m = RE_AUTOLINK.exec(src);
  if (!m) return null;
  let text;
  let href;
  if (m[2] === '@') { text = m[1]; href = 'mailto:' + text; }
  else { text = m[1]; href = text; }
  return { type: 'link', raw: m[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
}

function tokUrl(src) {
  const m = RE_URL.exec(src);
  if (!m) return null;
  let text;
  let href;
  if (m[2] === '@') {
    text = m[0];
    href = 'mailto:' + text;
  } else {
    let cur = m[0];
    let prev;
    do {
      prev = cur;
      cur = (RE_BACKPEDAL.exec(cur) || [''])[0];
    } while (cur !== prev);
    m[0] = cur;
    text = m[0];
    href = m[1] === 'www.' ? 'http://' + m[0] : m[0];
  }
  return { type: 'link', raw: m[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
}

function tokInlineText(src, ctx) {
  const m = RE_INLINE_TEXT.exec(src);
  if (!m) return null;
  const inRaw = ctx.state.inRawBlock;
  return { type: 'text', raw: m[0], text: inRaw ? m[0] : unescapeEntities(m[0]), escaped: inRaw };
}

// Mask links, code spans and tags so the emphasis scan only sees the
// delimiter runs that can actually open or close. Every replacement keeps
// the string the same length, so indices still line up with the source.
function maskEmStrong(src, ctx) {
  let t = src;
  if (ctx.links && src.includes('[')) {
    const maskRef = (match) => {
      const o = match.lastIndexOf('[');
      if (!Object.hasOwn(ctx.links, normalizeLabel(match.slice(o + 1, -1)))) return match;
      if (o > 1 && match.charAt(0) !== '!') {
        const inner = match.slice(1, o - 1);
        if (linkInText(inner, ctx)) return '[' + inner.replace(RE_REFLINK_SEARCH, maskRef) + '][' + 'a'.repeat(match.length - o - 2) + ']';
      }
      return '[' + 'a'.repeat(match.length - 2) + ']';
    };
    t = t.replace(RE_REFLINK_SEARCH, maskRef);
  }
  if (t.includes('`') || t.includes('\\')) {
    t = t.replace(RE_ANY_PUNCT_OUTSIDE_CODE, (whole, ticks, punct) => {
      if (punct) return '+'.repeat(whole.length);
      if (ticks) return ticks + whole.slice(ticks.length, -ticks.length).replace(/`/g, '+') + ticks;
      return whole;
    });
  }
  if (t.includes('[') || t.includes('<') || t.includes('`')) {
    t = t.replace(RE_BLOCK_SKIP, (whole, gA, gEmpty) => {
      const lead = gEmpty ? gEmpty.length : 0;
      return whole.slice(0, lead) + '[' + 'a'.repeat(whole.length - lead - 2) + ']';
    });
  }
  return t;
}

// Tokenize one inline string into `out`, using the shared lexer state.
function inlineTokensInto(src, out, ctx) {
  const savedParen = ctx.state.linkParenPossible;
  ctx.state.linkParenPossible = savedParen && src.includes(')');
  try {
    const masked = src.includes('*') || src.includes('_') || src.includes('~') ? maskEmStrong(src, ctx) : src;
    const delims = scanDelimiters(masked);
    let guard = Infinity;
    let prev = '';
    let lastWasText = false;
    while (src) {
      if (src.length < guard) guard = src.length;
      else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      if (!lastWasText) prev = '';
      lastWasText = false;
      // Dispatch on the first character: each tokenizer can only match a
      // string starting with one of a few characters, so the ones that
      // cannot match are never tried. The trial order inside each branch
      // is the same as the untriaged order, so the result is identical.
      const c0 = src.charCodeAt(0);
      let tok = null;
      if (c0 === 92) { // backslash
        tok = tokEscape(src) || tokBr(src);
      } else if (c0 === 60) { // <
        tok = tokTag(src, ctx) || tokAutolink(src);
      } else if (c0 === 91 || c0 === 33) { // [ or !
        tok = tokLink(src, ctx);
        if (!tok) {
          tok = tokReflink(src, ctx);
          if (tok) {
            src = src.slice(tok.raw.length);
            const last = out[out.length - 1];
            if (tok.type === 'text' && last && last.type === 'text') { last.raw += tok.raw; last.text += tok.text; }
            else out.push(tok);
            continue;
          }
        }
      } else if (c0 === 42 || c0 === 95) { // * or _
        tok = tokEmStrong(src, masked, prev, ctx, delims);
      } else if (c0 === 96) { // backtick
        tok = tokCodespan(src);
      } else if (c0 === 126) { // ~
        tok = tokDel(src, masked, prev, ctx, delims);
      } else if (c0 === 32) { // space
        tok = tokBr(src);
      } else if (!ctx.state.inLink && (c0 >= 48 && c0 <= 57 || c0 >= 65 && c0 <= 90 || c0 >= 97 && c0 <= 122 || c0 === 46 || c0 === 43 || c0 === 45)) {
        tok = tokUrl(src);
      }
      if (tok) { src = src.slice(tok.raw.length); out.push(tok); continue; }
      if ((tok = tokInlineText(src, ctx))) {
        src = src.slice(tok.raw.length);
        if (tok.raw.slice(-1) !== '_') prev = tok.raw.slice(-1);
        lastWasText = true;
        const last = out[out.length - 1];
        if (last && last.type === 'text') { last.raw += tok.raw; last.text += tok.text; }
        else out.push(tok);
        continue;
      }
      if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
    return out;
  } finally {
    ctx.state.linkParenPossible = savedParen;
  }
}

// ---------- renderer ----------
function renderInline(tokens, ctx, plain) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'escape': out += plain ? tok.text : escHtml(tok.text); break;
      case 'html': out += plain ? tok.text : tok.text; break;
      case 'link': {
        if (plain) { out += tok.tokens ? renderInline(tok.tokens, ctx, true) : tok.text; break; }
        const inner = tok.autolink ? escHtml(tok.text, true) : renderInline(tok.tokens, ctx, false);
        const href = encodeHref(tok.href);
        if (href === null) { out += inner; break; }
        let tag = '<a href="' + escHtml(href, tok.autolink) + '"';
        if (tok.title) tag += ' title="' + escHtml(tok.title) + '"';
        out += tag + '>' + inner + '</a>';
        break;
      }
      case 'image': {
        if (plain) { out += tok.tokens ? renderInline(tok.tokens, ctx, true) : tok.text; break; }
        const alt = tok.tokens ? renderInline(tok.tokens, ctx, true) : tok.text;
        const href = encodeHref(tok.href);
        if (href === null) { out += escHtml(alt); break; }
        let tag = '<img src="' + escHtml(href) + '" alt="' + escHtml(alt) + '"';
        if (tok.title) tag += ' title="' + escHtml(tok.title) + '"';
        out += tag + '>';
        break;
      }
      case 'checkbox': out += plain ? tok.raw : '<input ' + (tok.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> '; break;
      case 'strong': out += plain ? renderInline(tok.tokens, ctx, true) : '<strong>' + renderInline(tok.tokens, ctx, false) + '</strong>'; break;
      case 'em': out += plain ? renderInline(tok.tokens, ctx, true) : '<em>' + renderInline(tok.tokens, ctx, false) + '</em>'; break;
      case 'codespan': out += plain ? tok.text : '<code>' + escHtml(tok.text, true) + '</code>'; break;
      case 'br': out += plain ? '' : '<br>'; break;
      case 'del': out += plain ? renderInline(tok.tokens, ctx, true) : '<del>' + renderInline(tok.tokens, ctx, false) + '</del>'; break;
      case 'text': {
        if (tok.tokens) { out += renderInline(tok.tokens, ctx, plain); break; }
        out += plain ? tok.text : (tok.escaped ? tok.text : escHtml(tok.text));
        break;
      }
      default: throw new Error('Token with "' + tok.type + '" type was not found.');
    }
  }
  return out;
}

function renderBlocks(tokens, ctx) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space': break;
      case 'hr': out += '<hr>\n'; break;
      case 'heading': out += '<h' + tok.depth + '>' + renderInline(tok.tokens, ctx, false) + '</h' + tok.depth + '>\n'; break;
      case 'code': {
        const langWord = (tok.lang || '').match(/^\S*/)?.[0];
        const body = tok.text ? tok.text.replace(/\n$/, '') + '\n' : '';
        const shown = escHtml(body, true);
        out += langWord
          ? '<pre><code class="language-' + escHtml(langWord) + '">' + shown + '</code></pre>\n'
          : '<pre><code>' + shown + '</code></pre>\n';
        break;
      }
      case 'table': {
        let head = '';
        for (const cell of tok.header) head += renderTableCell(cell, ctx);
        let bodyRows = '';
        for (const row of tok.rows) {
          let cells = '';
          for (const cell of row) cells += renderTableCell(cell, ctx);
          bodyRows += '<tr>\n' + cells + '</tr>\n';
        }
        const tbody = bodyRows ? '<tbody>' + bodyRows + '</tbody>' : '';
        out += '<table>\n<thead>\n<tr>\n' + head + '</tr>\n</thead>\n' + tbody + '</table>\n';
        break;
      }
      case 'blockquote': out += '<blockquote>\n' + renderBlocks(tok.tokens, ctx) + '</blockquote>\n'; break;
      case 'list': {
        let items = '';
        for (const item of tok.items) items += '<li>' + renderBlocks(item.tokens, ctx) + '</li>\n';
        const tag = tok.ordered ? 'ol' : 'ul';
        const start = tok.ordered && tok.start !== 1 ? ' start="' + tok.start + '"' : '';
        out += '<' + tag + start + '>\n' + items + '</' + tag + '>\n';
        break;
      }
      case 'checkbox': out += '<input ' + (tok.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> '; break;
      case 'html': out += tok.text; break;
      case 'def': break;
      case 'paragraph': out += '<p>' + renderInline(tok.tokens, ctx, false) + '</p>\n'; break;
      case 'text': {
        if (tok.tokens) out += renderInline(tok.tokens, ctx, false);
        else out += tok.escaped ? tok.text : escHtml(tok.text);
        break;
      }
      default: throw new Error('Token with "' + tok.type + '" type was not found.');
    }
  }
  return out;
}

function renderTableCell(cell, ctx) {
  const tag = cell.header ? 'th' : 'td';
  const open = cell.align ? '<' + tag + ' align="' + cell.align + '">' : '<' + tag + '>';
  return open + renderInline(cell.tokens, ctx, false) + '</' + tag + '>\n';
}

// Render one Markdown document to the HTML marked produces for it.
export function parse(markdown) {
  const ctx = freshCtx();
  const src = markdown.replace(/\r\n|\r/g, '\n');
  const tokens = blockTokens(src, [], false, ctx);
  for (const item of ctx.queue) {
    ctx.state.inRawBlock = false;
    inlineTokensInto(item.src, item.tokens, ctx);
  }
  ctx.queue.length = 0;
  return renderBlocks(tokens, ctx);
}
