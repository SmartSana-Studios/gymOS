import sharp from "sharp";

// Test fixture builder for story 24.6: a real JPEG that carries GPS EXIF, an orientation tag, XMP and IPTC, written by hand
// (sharp cannot write IPTC), so the test can prove none of it survives in the derivative.

function u16(n: number, le = true) {
  const b = Buffer.alloc(2);
  le ? b.writeUInt16LE(n) : b.writeUInt16BE(n);
  return b;
}
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function entry(tag: number, type: number, count: number, value: Buffer) {
  return Buffer.concat([u16(tag), u16(type), u32(count), value.length < 4 ? Buffer.concat([value, Buffer.alloc(4 - value.length)]) : value]);
}

/** Little-endian TIFF with IFD0 {Orientation, GPS pointer} and a GPS IFD {LatRef, Lat, LonRef, Lon}. */
export function exifWithGps(orientation: number): Buffer {
  const header = Buffer.concat([Buffer.from("II"), u16(42), u32(8)]);
  const ifd0Len = 2 + 2 * 12 + 4;
  const gpsOffset = 8 + ifd0Len;
  const ifd0 = Buffer.concat([
    u16(2),
    entry(0x0112, 3, 1, u16(orientation)),
    entry(0x8825, 4, 1, u32(gpsOffset)),
    u32(0),
  ]);
  const gpsLen = 2 + 4 * 12 + 4;
  const ratOffset = gpsOffset + gpsLen;
  const rat = (n: number, d: number) => Buffer.concat([u32(n), u32(d)]);
  const lat = Buffer.concat([rat(4, 1), rat(3, 1), rat(0, 1)]); // 4 deg 3 min N (Douala)
  const lon = Buffer.concat([rat(9, 1), rat(42, 1), rat(0, 1)]);
  const gps = Buffer.concat([
    u16(4),
    entry(0x0001, 2, 2, Buffer.from("N\0")),
    entry(0x0002, 5, 3, u32(ratOffset)),
    entry(0x0003, 2, 2, Buffer.from("E\0")),
    entry(0x0004, 5, 3, u32(ratOffset + 24)),
    u32(0),
  ]);
  return Buffer.concat([header, ifd0, gps, lat, lon]);
}

function app(marker: number, payload: Buffer) {
  return Buffer.concat([Buffer.from([0xff, marker]), u16(payload.length + 2, false), payload]);
}

export const XMP_MARK = "http://ns.adobe.com/xap/1.0/";
export const SECRET_TEXT = "SECRET-GYM-OWNER-HOME";

/** IPTC record 2:05 (object name) and 2:80 (byline) inside a Photoshop 3.0 / 8BIM resource 0x0404. */
function iptcBlock(): Buffer {
  const ds = (n: number, text: string) => Buffer.concat([Buffer.from([0x1c, 0x02, n]), u16(text.length, false), Buffer.from(text)]);
  const data = Buffer.concat([ds(5, SECRET_TEXT), ds(80, "Photographer Name")]);
  const padded = data.length % 2 ? Buffer.concat([data, Buffer.from([0])]) : data;
  const res = Buffer.concat([Buffer.from("8BIM"), u16(0x0404, false), Buffer.from([0, 0]), Buffer.from([0, 0, 0, 0]).fill(0), padded]);
  res.writeUInt32BE(data.length, 4 + 2 + 2);
  return Buffer.concat([Buffer.from("Photoshop 3.0\0"), res]);
}

/** A JPEG of the given raw size (before orientation) with EXIF (GPS + orientation), XMP, IPTC and a comment segment. */
export async function jpegWithMetadata(width: number, height: number, orientation = 1): Promise<Buffer> {
  const base = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();
  const soi = base.subarray(0, 2);
  const rest = base.subarray(2);
  // drop any APP0 that sharp wrote so the order is predictable; keep everything else
  const segments = Buffer.concat([
    app(0xe1, Buffer.concat([Buffer.from("Exif\0\0"), exifWithGps(orientation)])),
    app(0xe1, Buffer.from(`${XMP_MARK}\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description dc:creator="${SECRET_TEXT}"/></x:xmpmeta>`)),
    app(0xed, iptcBlock()),
    app(0xfe, Buffer.from(`comment ${SECRET_TEXT}`)),
  ]);
  return Buffer.concat([soi, segments, rest]);
}
