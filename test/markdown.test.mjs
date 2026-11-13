// The chat's Markdown: what a reply is read as, what it may link to, and what never reaches the page as markup.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parse, inline, toHtml, embeds, titleOf, safeHref, safeSrc, highlight } from '../public/markdown.js';

const html = (text) => toHtml(parse(text));

test('headings, paragraphs and emphasis', () => {
  assert.equal(html('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.'), '<h1>Title</h1>\n<p>Some <strong>bold</strong>, <em>italic</em>, <del>gone</del> and <code>code</code>.</p>');
  assert.equal(html('***both*** and **a *nested* one**'), '<p><strong><em>both</em></strong> and <strong>a <em>nested</em> one</strong></p>');
  assert.equal(html('#hashtag is text, and so is 2 * 3 * 4 and snake_case_name'), '<p>#hashtag is text, and so is 2 * 3 * 4 and snake_case_name</p>');
  assert.equal(html('**“引用”**后面的中文**加粗**也行'), '<p><strong>“引用”</strong>后面的中文<strong>加粗</strong>也行</p>'); // no spaces around the marks, as Chinese is written
  assert.equal(html('an unclosed **bold and a lone * star'), '<p>an unclosed **bold and a lone * star</p>');
  assert.equal(html('line one\nline two'), '<p>line one<br>\nline two</p>'); // a line break is kept, as chat text is written
  assert.equal(titleOf(parse('intro\n\n## The *real* title\n\n# Later')), 'The real title');
});

test('lists: bullets, numbers, tasks, nesting and loose items', () => {
  assert.equal(html('- one\n- two\n  - inner\n- three'), '<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>inner</li>\n</ul></li>\n<li>three</li>\n</ul>');
  assert.equal(html('3. third\n4. fourth'), '<ol start="3">\n<li>third</li>\n<li>fourth</li>\n</ol>');
  assert.equal(html('- [x] done\n- [ ] open'), '<ul>\n<li><input type="checkbox" disabled checked> done</li>\n<li><input type="checkbox" disabled> open</li>\n</ul>');
  // A list under a numbered item is its child however the model indented it (two spaces here, where three are "right").
  const nested = parse('1. Step\n  - detail\n  - more\n2. Next');
  assert.deepEqual([nested.length, nested[0].items.length, nested[0].items[0].blocks[1].type, nested[0].items[0].blocks[1].items.length], [1, 2, 'list', 2]);
  const loose = parse('- first\n\n- second\n\n  with a second paragraph');
  assert.deepEqual([loose[0].tight, loose[0].items[1].blocks.length], [false, 2]);
  assert.equal(parse('- a\n\nA paragraph after the list').length, 2);
  assert.deepEqual(parse('- one\n1. other kind').map((b) => b.ordered), [false, true]); // a change of marker starts a new list
});

test('tables, quotes, rules and code', () => {
  const table = parse('| Name | Count |\n| :--- | ---: |\n| a \\| b | `x|y` |\n| only one |')[0];
  assert.deepEqual([table.type, table.align, table.rows.length, table.rows[1].length], ['table', ['left', 'right'], 2, 2]);
  assert.match(html('| A | B |\n|---|---|\n| 1 | 2 |'), /^<table>\n<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>\n<tbody>\n<tr><td>1<\/td><td>2<\/td><\/tr>/);
  assert.equal(html('a | b is just text'), '<p>a | b is just text</p>');
  assert.equal(html('> quoted\n> still\n\nafter'), '<blockquote>\n<p>quoted<br>\nstill</p>\n</blockquote>\n<p>after</p>');
  assert.equal(html('above\n\n---\n\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
  assert.equal(html('```js\nconst a = "<b>";\n```'), '<pre><code class="language-js">const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  assert.equal(html('````md\n```js\ninner\n```\n````'), '<pre><code class="language-md">```js\ninner\n```</code></pre>'); // a longer fence holds a shorter one
  // A reply that is still being written: the open fence runs to the end, and says it is not closed.
  assert.deepEqual(parse('text\n\n```py\nprint(1)').map((b) => [b.type, b.closed]), [['paragraph', undefined], ['code', false]]);
});

test('nothing a reply writes becomes markup or a link that runs code', () => {
  assert.equal(html('<script>alert(1)</script> and <img src=x onerror=alert(1)>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; and &lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(html('[click](javascript:alert(1)) [data](data:text/html,<b>) [ok](https://example.com/a_(b))'), '<p>click data <a href="https://example.com/a_(b)" target="_blank" rel="noopener noreferrer">ok</a></p>');
  assert.equal(html('![x](javascript:alert(1)) ![y](https://example.com/y.png "t") ![z](/media/chat-1-image-a.png)'), '<p>x <img src="https://example.com/y.png" alt="y"> <img src="/media/chat-1-image-a.png" alt="z"></p>');
  assert.equal(html('[a"b](https://example.com/?q="x")'), '<p><a href="https://example.com/?q=&quot;x&quot;" target="_blank" rel="noopener noreferrer">a&quot;b</a></p>');
  assert.deepEqual(['javascript:alert(1)', ' JaVaScRiPt:x', 'vbscript:x', '//evil.example', 'data:text/html,x'].map(safeHref), ['', '', '', '', '']);
  assert.deepEqual(['https://a.test/x', 'mailto:a@b.test', '/app.html', '#top', 'example.com/page'].map(safeHref), ['https://a.test/x', 'mailto:a@b.test', '/app.html', '#top', 'https://example.com/page']);
  assert.deepEqual(['data:image/svg+xml,<svg onload=x>', 'data:text/html;base64,AAAA', '/media/../secret', '/api/history'].map(safeSrc), ['', '', '', '']);
  assert.equal(safeSrc('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
});

test('links: written out, in angle brackets, and bare addresses', () => {
  assert.deepEqual(inline('see https://example.com/a?b=1. Then'), [{ type: 'text', text: 'see ' }, { type: 'link', href: 'https://example.com/a?b=1', children: [{ type: 'text', text: 'https://example.com/a?b=1' }] }, { type: 'text', text: '. Then' }]);
  assert.equal(html('见https://example.com/页面。更多'), '<p>见<a href="https://example.com/" target="_blank" rel="noopener noreferrer">https://example.com/</a>页面。更多</p>'); // the address ends where the Chinese begins
  assert.equal(html('(https://example.com/x) <https://example.com/y>'), '<p>(<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a>) <a href="https://example.com/y" target="_blank" rel="noopener noreferrer">https://example.com/y</a></p>');
  assert.equal(html('a `[not](a link)` and \\[escaped\\] and [1] and &lt;tag&gt; &amp; &#x4e2d;'), '<p>a <code>[not](a link)</code> and [escaped] and [1] and &lt;tag&gt; &amp; 中</p>');
});

test('embeds: the pictures and clips a reply asks for, in order, with their settings', () => {
  const reply = ['Here you go:', '', '```image', 'aspect: 16:9', 'A red fox in snow', 'at dawn', '```', '', '- and inside a list:', '  ```video', '  aspect：9x16', '  seconds: 8', '', '  A lighthouse at dusk', '  ```', '', '```js', 'not one', '```', '', '```image', 'unfinished'].join('\n');
  assert.deepEqual(embeds(parse(reply)), [
    { kind: 'image', prompt: 'A red fox in snow\nat dawn', aspect: '16:9', seconds: 0 },
    { kind: 'video', prompt: 'A lighthouse at dusk', aspect: '9:16', seconds: 8 },
  ]);
  // The settings end at the first line that is not one: a description may itself begin "Length: …" after a blank line.
  assert.deepEqual(embeds(parse('```video\naspect: 1:1\n\nLength: a long corridor\n```'))[0], { kind: 'video', prompt: 'Length: a long corridor', aspect: '1:1', seconds: 0 });
  assert.equal(toHtml(parse('```image\na cat\n```'), { embed: (asked, i) => `<figure data-i="${i}">${asked.prompt}</figure>` }), '<figure data-i="0">a cat</figure>');
});

test('highlight colours code by family and leaves an unknown language alone', () => {
  assert.deepEqual(highlight('const n = 42; // answer', 'js'), [['k', 'const'], ['', ' n = '], ['n', '42'], ['', '; '], ['c', '// answer']]);
  assert.deepEqual(highlight('{"a": "b", "n": 1.5, "t": true}', 'json').filter(([cls]) => cls), [['p', '"a"'], ['s', '"b"'], ['p', '"n"'], ['n', '1.5'], ['p', '"t"'], ['k', 'true']]);
  assert.deepEqual(highlight('def f(x):  # doc\n    return "s"', 'python').filter(([cls]) => cls), [['k', 'def'], ['f', 'f'], ['c', '# doc'], ['k', 'return'], ['s', '"s"']]);
  assert.deepEqual(highlight('SELECT name FROM t -- all', 'sql').filter(([cls]) => cls).map(([cls]) => cls), ['k', 'k', 'c']);
  assert.deepEqual(highlight('<a href="x">t</a>', 'html').filter(([cls]) => cls), [['t', '<a'], ['p', ' href='], ['s', '"x"'], ['p', '>'], ['t', '</a'], ['p', '>']]);
  assert.deepEqual(highlight('anything at all', 'brainfuck'), [['', 'anything at all']]);
  assert.equal(highlight('a "never closed\nb = 1', 'js').map(([, text]) => text).join(''), 'a "never closed\nb = 1'); // every character comes back, whatever the code
});
