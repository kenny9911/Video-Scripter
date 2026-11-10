// Minimal ZIP writer (no dependencies): UTF-8 names, deflate for text, store for media that is already compressed.

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Buffer | string, store?: boolean }] -> Buffer of a .zip archive. */
export function zip(files, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const body = f.store ? raw : deflateRawSync(raw);
    // version 2.0, flag bit 11 = UTF-8 names, method 0 (store) or 8 (deflate)
    const meta = Buffer.alloc(26);
    meta.writeUInt16LE(20, 0);
    meta.writeUInt16LE(0x0800, 2);
    meta.writeUInt16LE(f.store ? 0 : 8, 4);
    meta.writeUInt16LE(time, 6);
    meta.writeUInt16LE(day, 8);
    meta.writeUInt32LE(crc32(raw), 10);
    meta.writeUInt32LE(body.length, 14);
    meta.writeUInt32LE(raw.length, 18);
    meta.writeUInt16LE(name.length, 22);
    meta.writeUInt16LE(0, 24);

    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), meta, name]);
    const tail = Buffer.alloc(14); // comment len, disk, internal attrs, external attrs, local header offset
    tail.writeUInt32LE(offset, 10);
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), meta, tail, name]));
    parts.push(local, body);
    offset += local.length + body.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
