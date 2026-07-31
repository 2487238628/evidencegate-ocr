import zlib from "node:zlib";

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function redPixelRatio(png) {
  if (png.length < 33 || png.subarray(1, 4).toString() !== "PNG") throw new Error("Invalid PNG.");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // ponytail: only the repository's 8-bit, non-interlaced RGB fixtures; add formats when real inputs require them.
  if (png[24] !== 8 || png[25] !== 2 || png[28] !== 0) throw new Error("Only 8-bit non-interlaced RGB PNG is supported.");
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString();
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  let previous = Buffer.alloc(stride);
  let red = 0;
  for (let y = 0, offset = 0; y < height; y += 1) {
    const filter = raw[offset];
    const source = raw.subarray(offset + 1, offset + 1 + stride);
    const row = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? row[x - 3] : 0;
      const up = previous[x];
      const upperLeft = x >= 3 ? previous[x - 3] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : NaN;
      if (!Number.isFinite(predictor)) throw new Error(`Unsupported PNG filter: ${filter}.`);
      row[x] = (source[x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += 3) {
      const [r, g, b] = [row[x], row[x + 1], row[x + 2]];
      if (r >= 150 && r - g >= 45 && r - b >= 45) red += 1;
    }
    previous = row;
    offset += stride + 1;
  }
  return red / (width * height);
}
