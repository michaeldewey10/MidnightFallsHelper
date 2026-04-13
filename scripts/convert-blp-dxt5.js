const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [, , sourceDir, outputDir] = process.argv;

if (!sourceDir || !outputDir) {
  console.error('Usage: node scripts/convert-blp-dxt5.js <sourceDir> <outputDir>');
  process.exit(1);
}

const files = {
  'T.blp': 't.png',
  'Cross.blp': 'x.png',
  'Triangle.blp': 'v.png',
  'Circle.blp': 'o.png',
  'Diamond.blp': 'baklava.png'
};

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function color565(value) {
  const r = (value >> 11) & 0x1f;
  const g = (value >> 5) & 0x3f;
  const b = value & 0x1f;

  return [
    Math.round((r * 255) / 31),
    Math.round((g * 255) / 63),
    Math.round((b * 255) / 31)
  ];
}

function decodeDxt5(buffer, width, height, offset, size) {
  const rgba = Buffer.alloc(width * height * 4);
  const end = offset + size;
  let blockOffset = offset;

  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      if (blockOffset + 16 > end) {
        throw new Error('Unexpected end of DXT5 data');
      }

      const alpha0 = buffer[blockOffset];
      const alpha1 = buffer[blockOffset + 1];
      const alphas = [alpha0, alpha1];

      if (alpha0 > alpha1) {
        for (let i = 1; i <= 6; i += 1) {
          alphas.push(Math.round(((7 - i) * alpha0 + i * alpha1) / 7));
        }
      } else {
        for (let i = 1; i <= 4; i += 1) {
          alphas.push(Math.round(((5 - i) * alpha0 + i * alpha1) / 5));
        }
        alphas.push(0, 255);
      }

      let alphaBits = 0n;
      for (let i = 0; i < 6; i += 1) {
        alphaBits |= BigInt(buffer[blockOffset + 2 + i]) << BigInt(8 * i);
      }

      const color0 = buffer.readUInt16LE(blockOffset + 8);
      const color1 = buffer.readUInt16LE(blockOffset + 10);
      const c0 = color565(color0);
      const c1 = color565(color1);
      const colors = [
        c0,
        c1,
        [
          Math.round((2 * c0[0] + c1[0]) / 3),
          Math.round((2 * c0[1] + c1[1]) / 3),
          Math.round((2 * c0[2] + c1[2]) / 3)
        ],
        [
          Math.round((c0[0] + 2 * c1[0]) / 3),
          Math.round((c0[1] + 2 * c1[1]) / 3),
          Math.round((c0[2] + 2 * c1[2]) / 3)
        ]
      ];
      const colorBits = buffer.readUInt32LE(blockOffset + 12);

      for (let py = 0; py < 4; py += 1) {
        for (let px = 0; px < 4; px += 1) {
          const pixelIndex = py * 4 + px;
          const x = bx + px;
          const y = by + py;

          if (x >= width || y >= height) {
            continue;
          }

          const alphaIndex = Number((alphaBits >> BigInt(3 * pixelIndex)) & 0x7n);
          const colorIndex = (colorBits >> (2 * pixelIndex)) & 0x03;
          const color = colors[colorIndex];
          const target = (y * width + x) * 4;

          rgba[target] = color[0];
          rgba[target + 1] = color[1];
          rgba[target + 2] = color[2];
          rgba[target + 3] = alphas[alphaIndex];
        }
      }

      blockOffset += 16;
    }
  }

  return rgba;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(filePath, width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, png);
}

function convertBlp(sourcePath, outputPath) {
  const buffer = fs.readFileSync(sourcePath);
  const magic = buffer.toString('ascii', 0, 4);
  const version = readUInt32LE(buffer, 4);
  const encoding = buffer[8];
  const alphaDepth = buffer[9];
  const alphaEncoding = buffer[10];
  const width = readUInt32LE(buffer, 12);
  const height = readUInt32LE(buffer, 16);
  const mipOffset = readUInt32LE(buffer, 20);
  const mipSize = readUInt32LE(buffer, 84);

  if (magic !== 'BLP2' || version !== 1 || encoding !== 2 || alphaDepth !== 8 || alphaEncoding !== 7) {
    throw new Error(`Unsupported BLP format in ${sourcePath}`);
  }

  const rgba = decodeDxt5(buffer, width, height, mipOffset, mipSize);
  writePng(outputPath, width, height, rgba);
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [inputName, outputName] of Object.entries(files)) {
  const sourcePath = path.join(sourceDir, inputName);
  const outputPath = path.join(outputDir, outputName);
  convertBlp(sourcePath, outputPath);
  console.log(`${inputName} -> ${outputName}`);
}
