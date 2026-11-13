// A .zip written in the browser, for files that are already compressed (pictures): they are stored as they
// are. UTF-8 names. The server's own writer is src/zip.mjs.

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Uint8Array | string }] -> Uint8Array of a .zip archive. */
export function zipStore(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    // version 2.0, flag bit 11 = UTF-8 names, method 0 (store)
    const meta = new DataView(new ArrayBuffer(26));
    meta.setUint16(0, 20, true);
    meta.setUint16(2, 0x0800, true);
    meta.setUint16(6, time, true);
    meta.setUint16(8, day, true);
    meta.setUint32(10, crc32(data), true);
    meta.setUint32(14, data.length, true);
    meta.setUint32(18, data.length, true);
    meta.setUint16(22, name.length, true);
    const tail = new DataView(new ArrayBuffer(14)); // comment length, disk, internal attributes, external attributes, offset of the local header
    tail.setUint32(6, (0o100644 << 16) >>> 0, true);
    tail.setUint32(10, offset, true);
    const m = new Uint8Array(meta.buffer);
    parts.push(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), m, name, data);
    central.push(Uint8Array.of(0x50, 0x4b, 0x01, 0x02, 20, 3), m, new Uint8Array(tail.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of all) out.set(b, at), (at += b.length);
  return out;
}
