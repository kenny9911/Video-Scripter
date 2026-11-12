// Reading the text of a PDF (src/pdf.mjs): files written by real tools (test/fixtures), and small ones
// built here to hold one thing each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

import { pdfText, isPdf } from '../src/pdf.mjs';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

/** A PDF from its objects, in order; object 1 is the catalog. It has no cross-reference table: the reader does not use one. */
const pdf = (objects) => Buffer.from(`%PDF-1.5\n${objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const stream = (data, dict = '') => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const packed = (data, dict = '') => stream(deflateSync(Buffer.from(data, 'latin1')).toString('latin1'), `${dict} /Filter /FlateDecode`);
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
/** A one-page document: `content` is what the page draws, `fonts` the fonts it names (F1, F2, …), `more` further objects (from number 5 + fonts). */
const onePage = (content, fonts = [HELVETICA], more = []) =>
  pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << ${fonts.map((f, i) => `/F${i + 1} ${5 + i} 0 R`).join(' ')} >> >> >>`,
    content,
    ...fonts,
    ...more,
  ]);
/** A font whose two-byte codes are named by a ToUnicode map (object `n` holds the map). */
const mapped = (n) => `<< /Type /Font /Subtype /Type0 /BaseFont /Song /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /DW 1000 >>] /ToUnicode ${n} 0 R >>`;
const cmap = (body) => stream(`/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${body}\nendcmap end`);

const TEXT = ['The Hario V60 brews 250 ml in three minutes.', '手冲咖啡：水温九十二度，粉水比一比十五。', 'First line of a paragraph\nsecond line of it', 'A new paragraph after a gap', 'Page two: price 198 yuan.'].join('\n\n');

test('a PDF written by a real tool is read: two pages, English and Chinese, lines and paragraphs', async () => {
  const bytes = await fixture('two-pages.pdf');
  assert.ok(isPdf(bytes) && !isPdf(Buffer.from('PK\u0003\u0004 not a pdf')));
  assert.deepEqual(pdfText(bytes), { text: TEXT, pages: 2, cut: false, partial: false });
  // Reading stops once it has enough.
  const short = pdfText(bytes, { maxChars: 60 });
  assert.ok(short.cut && short.text.startsWith('The Hario V60') && !short.text.includes('Page two'));
});

test('a PDF that is protected but opens without a password is read; one that needs a password is not', async () => {
  for (const name of ['protected-rc4.pdf', 'protected-aes128.pdf', 'protected-aes256.pdf']) assert.equal(pdfText(await fixture(name)).text, TEXT, name);
  const locked = await fixture('password.pdf');
  assert.throws(() => pdfText(locked), /password/);
});

test('where text is drawn says what is a space, a new line and a new paragraph', () => {
  const content = stream(
    [
      'BT /F1 12 Tf 72 720 Td',
      '[(Hel) 20 (lo) -300 (wor) 15 (ld)] TJ', // a small step is kerning, a wide one a space
      '0 -14 Td (second line) Tj',
      '0 -40 Td (after a gap) Tj',
      'ET',
      'BT /F1 12 Tf 1 0 0 1 72 600 Tm (left) Tj 1 0 0 1 97 600 Tm (right) Tj 1 0 0 1 300 600 Tm (far) Tj ET', // words placed one by one
      'BT /F1 12 Tf 72 580 Td (bold) Tj ET BT /F1 12 Tf 72.3 580 Td (bold) Tj ET', // drawn twice to look bold
      'BT /F1 12 Tf 72 560 Td (fi) Tj (ll) Tj ET', // the same letter twice in a row is two letters
    ].join('\n'),
  );
  assert.equal(pdfText(onePage(content)).text, 'Hello world\nsecond line\n\nafter a gap\n\nleft right\tfar\nbold\nfill');
});

test('a font says which characters its codes draw: a map, packed streams, objects kept in an object stream', () => {
  const page = '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  const inner = [page, mapped(6)];
  const head = `3 0 5 ${page.length + 1} `;
  const bytes = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'null', // the page itself is in the object stream (object 7), as most writers keep it
    packed('BT /F1 12 Tf 72 700 Td <000100020003> Tj 0 -20 Td <00100011> Tj ET'),
    'null',
    cmap('2 beginbfchar <0001> <624B> <0002> <51B2> endbfchar\n2 beginbfrange <0003> <0003> [<5496>] <0010> <0011> <2F00> endbfrange'),
    packed(head + inner.join(' '), `/Type /ObjStm /N 2 /First ${head.length}`),
  ]);
  // 手冲咖, then the Kangxi radicals ⼀⼁ some writers use for 一丨, which are made the ordinary characters.
  assert.deepEqual(pdfText(bytes), { text: '手冲咖\n一丨', pages: 1, cut: false, partial: false });
});

test('a span that says what it reads as is believed; a mark laid across the page is left out', () => {
  const content = stream(
    [
      'BT /F1 12 Tf 72 700 Td <0001> Tj ET',
      // A ligature the font has no character for, as Word on a Mac writes it.
      '/Span << /ActualText (ti) >> BDC BT /F1 12 Tf 84 700 Td <0009> Tj ET EMC',
      'BT /F1 12 Tf 96 700 Td <0002> Tj ET',
      // A code tiled over the page at an angle, and once more upright in the margin.
      ...[300, 500, 700].map((y) => `BT /F2 16 Tf 0.766 0.643 -0.643 0.766 90 ${y} Tm (a352f05903fe3b931Hx) Tj ET`),
      'BT /F2 16 Tf 0 1 -1 0 580 200 Tm (a352f05903fe3b931Hx) Tj ET',
    ].join('\n'),
  );
  const withMap = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> >>',
    content,
    mapped(6),
    cmap('2 beginbfchar <0001> <0061> <0002> <0062> endbfchar'),
    HELVETICA,
  ]);
  assert.equal(pdfText(withMap).text, 'atib');
});

test('a font with an empty map is read from the font file it carries', () => {
  // The smallest font file that says anything: a `cmap` table giving 你 and 佡 as glyphs 5 and 6.
  const u16 = (...n) => Buffer.concat(n.map((x) => Buffer.from([(x >> 8) & 255, x & 255])));
  const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const sub = u16(4, 32, 0, 4, 4, 1, 0, 0x4f61, 0xffff, 0, 0x4f60, 0xffff, (5 - 0x4f60) & 0xffff, 1, 0, 0);
  const table = Buffer.concat([u16(0, 1, 3, 1), u32(12), sub]);
  const font = Buffer.concat([u32(0x00010000), u16(1, 0, 0, 0), Buffer.from('cmap'), u32(0), u32(28), u32(table.length), table]);
  const type0 = '<< /Type /Font /Subtype /Type0 /BaseFont /Hei /Encoding /Identity-H /ToUnicode 6 0 R /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap /Identity /FontDescriptor 7 0 R >>] >>';
  const bytes = onePage(stream('BT /F1 12 Tf 72 700 Td <00050006> Tj ET'), [type0], [cmap(''), '<< /Type /FontDescriptor /FontName /Hei /FontFile2 8 0 R >>', packed(font.toString('latin1'))]);
  assert.equal(pdfText(bytes).text, '你佡');
});

test('what cannot be read is said, not guessed', () => {
  const said = (bytes) => {
    try {
      pdfText(bytes);
    } catch (err) {
      return [err.status, err.message];
    }
    return null;
  };
  assert.deepEqual(said(Buffer.from('just some text'))?.[0], 415);
  // A scan: a page that draws a picture and no text.
  let [status, message] = said(onePage(stream('q 612 0 0 792 0 0 cm /Im1 Do Q')));
  assert.ok(status === 400 && /scan/.test(message), message);
  // A font that names no characters: codes with no map, no known encoding, no font file.
  const blind = '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 >>] >>';
  [status, message] = said(onePage(stream('BT /F1 12 Tf 72 700 Td <0001000200030004> Tj ET'), [blind]));
  assert.ok(status === 400 && /cannot be read/.test(message), message);
  // Mostly readable, with a part that is not: the text comes back, marked as partial.
  const mixed = onePage(stream('BT /F1 12 Tf 72 700 Td (A dozen letters here) Tj /F2 12 Tf 0 -20 Td <00010002> Tj ET'), [HELVETICA, blind]);
  assert.deepEqual(pdfText(mixed), { text: 'A dozen letters here', pages: 1, cut: false, partial: true });
  // Broken files end in an error or an empty answer, never a crash or a hang.
  const deep = `%PDF-1.4\n1 0 obj ${'['.repeat(200_000)}`; // nested past any reader's depth
  const endless = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${'beginbfchar <0001> '.repeat(50_000)}`;
  for (const junk of ['%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj', '%PDF-1.7\n1 0 obj << /Length 99999 >> stream\nabc', '%PDF-1.4\n((((((((', '%PDF-1.4\n1 0 obj [ << /A [ << ', deep, endless]) assert.equal(said(Buffer.from(junk))?.[0], 400, junk.slice(0, 40));
});
