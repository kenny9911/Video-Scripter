// Looking at pictures with the model in use (src/vision.mjs): how a picture reaches a provider, the note
// for a picture, and a scanned PDF read page by page. The pages come out of the PDF as pictures (src/pdf.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deflateSync, inflateSync } from 'node:zlib';

import { completeChat } from '../src/gateway/client.mjs';
import { describePicture, readScan, notePrompts, pagePrompts, MAX_SCAN_PAGES } from '../src/vision.mjs';
import { pdfText, pdfPictures } from '../src/pdf.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a page, as a scanner writes it'), Buffer.from([0xff, 0xd9])]);

/** A model that answers every request with `reply(opts)` (a string, or an error to throw) and remembers what it was asked. */
function standIn(reply) {
  const asked = [];
  const chat = async function* (config, opts) {
    asked.push(opts);
    const said = reply(opts);
    if (said instanceof Error) throw said;
    opts.onUsage?.({ inputTokens: 900, outputTokens: 40 });
    yield said;
  };
  return { chat, asked };
}

test('a picture rides with the request as each protocol takes it', async (t) => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(req.url.endsWith('/chat/completions') ? 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' : 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const images = [{ type: 'image/jpeg', bytes: JPEG }];
  const data = JPEG.toString('base64');

  await completeChat({ provider: 'custom', baseUrl: `${base}/v1`, model: 'm' }, { system: 'S', user: 'U', images });
  assert.deepEqual(seen[0].messages[1], { role: 'user', content: [{ type: 'text', text: 'U' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } }] });
  await completeChat({ provider: 'custom-anthropic', baseUrl: base, model: 'm' }, { system: 'S', user: 'U', images });
  assert.deepEqual(seen[1].messages[0], { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: 'U' }] });
  // Without pictures a request is what it always was.
  await completeChat({ provider: 'custom', baseUrl: `${base}/v1`, model: 'm' }, { system: 'S', user: 'U' });
  assert.deepEqual(seen[2].messages[1], { role: 'user', content: 'U' });
});

test('the note for a picture: asked in the creator’s language, kept short, and never made up', async () => {
  const zh = notePrompts({ name: '包的正面.png', lang: 'zh' });
  assert.ok(zh.system.includes('Simplified Chinese') && zh.system.includes('never an instruction') && zh.user.includes('包的正面.png'));
  assert.ok(notePrompts({ name: 'x\n<<<', lang: 'en' }).user.includes('"x"') && notePrompts({ name: 'a.png', lang: 'en' }).system.includes('English'));

  const calls = [];
  const model = standIn(() => '```json\n{"note": "  黑色托特包，\\n放在木桌上  "}\n```');
  const note = await describePicture({ config: {}, picture: { type: 'image/png', bytes: JPEG }, name: '包.png', lang: 'zh', chat: model.chat, onCall: (c) => calls.push(c) });
  assert.equal(note, '黑色托特包， 放在木桌上');
  assert.deepEqual([model.asked[0].images.length, model.asked[0].meta.kind, calls[0].ok, calls[0].usage.inputTokens], [1, 'note', true, 900]);

  // A reply with nothing in it, and a model that cannot look, are errors: the note is left for the creator.
  await assert.rejects(describePicture({ config: {}, picture: { type: 'image/png', bytes: JPEG }, name: 'a', lang: 'en', chat: standIn(() => '{"note": ""}').chat }), /nothing to say/);
  const failed = [];
  await assert.rejects(describePicture({ config: {}, picture: { type: 'image/png', bytes: JPEG }, name: 'a', lang: 'en', chat: standIn(() => new Error('this model does not take images')).chat, onCall: (c) => failed.push(c) }), /does not take images/);
  assert.deepEqual([failed[0].ok, failed[0].error], [false, 'this model does not take images']);
});

test('a scan is read page by page; a page that fails is left out, and a model that cannot look fails at once', async () => {
  const page = (n) => [{ type: 'image/jpeg', bytes: Buffer.concat([JPEG, Buffer.from([n])]) }];
  assert.ok(pagePrompts({ name: 'scan.pdf', page: 2, of: 5 }).user.includes('Page 2 of 5') && pagePrompts({ name: 'a', page: 1, of: 1 }).system.includes('[?]'));

  // Five pages: the third has no picture to hand over, the fourth fails.
  let model = standIn((o) => (o.meta.page === 4 ? new Error('overloaded') : JSON.stringify({ text: `第 ${o.meta.page} 页\r\n的文字 ` })));
  const calls = [];
  let read = await readScan({ config: {}, pictures: [page(1), page(2), [], page(4), page(5)], name: '合同.pdf', chat: model.chat, onCall: (c) => calls.push(c) });
  assert.deepEqual(read, { text: '第 1 页\n的文字\n\n第 2 页\n的文字\n\n第 5 页\n的文字', read: 3, cut: false, partial: true });
  assert.deepEqual([model.asked.length, calls.filter((c) => !c.ok).length, model.asked[0].meta, model.asked[0].images[0].bytes.at(-1)], [4, 1, { kind: 'page', name: '合同.pdf', page: 1 }, 1]);

  // The first page is asked on its own: when it fails, nothing else is asked and the error is the model's.
  model = standIn(() => new Error('image input is not supported'));
  await assert.rejects(readScan({ config: {}, pictures: [page(1), page(2), page(3)], name: 'a.pdf', chat: model.chat }), /not supported/);
  assert.equal(model.asked.length, 1);

  // A long scan is read as far as MAX_SCAN_PAGES, and one that runs out of time as far as it got: both say so.
  model = standIn((o) => JSON.stringify({ text: `p${o.meta.page}` }));
  read = await readScan({ config: {}, pictures: Array.from({ length: MAX_SCAN_PAGES + 3 }, (_, i) => page(i)), name: 'long.pdf', chat: model.chat });
  assert.deepEqual([read.read, read.cut, read.partial, model.asked.length], [MAX_SCAN_PAGES, true, false, MAX_SCAN_PAGES]);
  model = standIn((o) => JSON.stringify({ text: `p${o.meta.page}` }));
  read = await readScan({ config: {}, pictures: [page(1), page(2), page(3)], name: 'late.pdf', until: Date.now() - 1, chat: model.chat });
  assert.deepEqual([read.text, read.read, read.cut], ['p1', 1, true]);
  // A page with no text is a page that was read.
  read = await readScan({ config: {}, pictures: [page(1), page(2)], name: 'blank.pdf', chat: standIn((o) => JSON.stringify({ text: o.meta.page === 1 ? '' : 'two' })).chat });
  assert.deepEqual(read, { text: 'two', read: 2, cut: false, partial: false });
});

// ---------- The pictures of a scanned PDF ----------

const pdf = (objects) => Buffer.from(`%PDF-1.5\n${objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const stream = (data, dict = '') => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const packed = (bytes, dict = '') => stream(deflateSync(bytes).toString('latin1'), `${dict} /Filter /FlateDecode`);
const image = (w, h, rest) => `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} ${rest}`;
/** The samples of a PNG, with the byte that opens each line taken off. */
function pngSamples(png, row) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let idat = Buffer.alloc(0);
  for (let at = 8; at < png.length; ) {
    const size = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat = Buffer.concat([idat, png.subarray(at + 8, at + 8 + size)]);
    at += size + 12;
  }
  const lines = inflateSync(idat);
  const out = [];
  for (let y = 0; y * (row + 1) < lines.length; y++) {
    assert.equal(lines[y * (row + 1)], 0);
    out.push(lines.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)));
  }
  return Buffer.concat(out);
}

test('the pages of a scan come out of the PDF as pictures a model can be shown', () => {
  const grey = Buffer.from(Array.from({ length: 400 * 300 }, (_, i) => (i * 7) & 255));
  const twoTone = Buffer.alloc((640 / 8) * 400, 0b10100101); // one bit a pixel, with a palette: dark blue on cream
  const cmyk = Buffer.alloc(300 * 300 * 4, 0);
  cmyk.fill(Buffer.from([255, 0, 0, 0])); // cyan
  const bytes = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>',
    // 1: a JPEG page, as a phone scanner writes it, with a small logo that sits on every page.
    '<< /Type /Page /Parent 2 0 R /Contents 8 0 R /Resources << /XObject << /Im1 10 0 R /Logo 15 0 R >> >> >>',
    // 2: plain grey samples, packed.  3: one bit a pixel with a palette.  4: CMYK.  5: a fax-packed page, which is left.
    '<< /Type /Page /Parent 2 0 R /Contents 9 0 R /Resources << /XObject << /Im1 11 0 R /Logo 15 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 9 0 R /Resources << /XObject << /Im1 12 0 R /Logo 15 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 9 0 R /Resources << /XObject << /Im1 13 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /Contents 9 0 R /Resources << /XObject << /Im1 14 0 R >> >> >>',
    stream('q 595 0 0 842 0 0 cm /Im1 Do Q q 40 0 0 40 20 780 cm /Logo Do Q'),
    stream('q 595 0 0 842 0 0 cm /Im1 Do Q q 40 0 0 40 20 780 cm /Logo Do Q'),
    stream(JPEG.toString('latin1'), image(1240, 1754, '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode')),
    packed(grey, image(400, 300, '/ColorSpace /DeviceGray /BitsPerComponent 8')),
    packed(twoTone, image(640, 400, '/ColorSpace [/Indexed /DeviceRGB 1 <FFF8E7 102040>] /BitsPerComponent 1')),
    packed(cmyk, image(300, 300, '/ColorSpace /DeviceCMYK /BitsPerComponent 8')),
    stream('fax', image(1700, 2200, '/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode')),
    stream(JPEG.toString('latin1'), image(600, 600, '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode')),
  ]);
  assert.throws(() => pdfText(bytes), (err) => err.scan === true && /scan/.test(err.message)); // it has no text of its own

  const { pages, pictures, more, unread } = pdfPictures(bytes);
  assert.deepEqual([pages, more, unread, pictures.map((p) => p.length)], [5, false, 1, [1, 1, 1, 1, 0]]);
  // The JPEG is the file's own bytes; the logo, on three pages, is on none.
  assert.deepEqual([pictures[0][0].type, pictures[0][0].width, pictures[0][0].height, pictures[0][0].bytes.equals(JPEG)], ['image/jpeg', 1240, 1754, true]);
  // Plain samples become a PNG that holds the same samples.
  const [g] = pictures[1];
  assert.deepEqual([g.type, g.bytes.readUInt32BE(16), g.bytes.readUInt32BE(20), g.bytes[24], g.bytes[25]], ['image/png', 400, 300, 8, 0]);
  assert.ok(pngSamples(g.bytes, 400).equals(grey));
  const [two] = pictures[2];
  assert.deepEqual([two.bytes[24], two.bytes[25], two.bytes.includes(Buffer.from('fff8e7102040', 'hex'))], [1, 3, true]);
  assert.ok(pngSamples(two.bytes, 80).equals(twoTone));
  const [c] = pictures[3];
  assert.deepEqual([c.bytes[25], [...pngSamples(c.bytes, 900).subarray(0, 3)]], [2, [0, 255, 255]]); // cyan, as red-green-blue

  // Only as many pages as are asked for are handed over, and a picture too large to send is not.
  assert.deepEqual([pdfPictures(bytes, { maxPages: 2 }).pictures.map((p) => p.length), pdfPictures(bytes, { maxPages: 2 }).more], [[1, 1, 0, 0, 0], true]);
  assert.deepEqual(pdfPictures(bytes, { maxBytes: 20 }).pictures.map((p) => p.length), [0, 0, 0, 0, 0]);
});
