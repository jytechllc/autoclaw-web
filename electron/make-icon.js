// Generate electron-resources/icon.png (1024x1024) from public/logo.svg using
// sharp. electron-builder derives the Windows .ico / mac .icns from this PNG.
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const src = path.join(root, "public", "logo.svg");
const outDir = path.join(root, "electron-resources");
const out = path.join(outDir, "icon.png");

fs.mkdirSync(outDir, { recursive: true });

const SIZE = 1024;
const PAD = 140; // padding so the glyph isn't edge-to-edge

(async () => {
  const inner = SIZE - PAD * 2;
  const glyph = await sharp(src, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 11, g: 11, b: 15, alpha: 1 }, // #0b0b0f
    },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toFile(out);

  console.log("Wrote", out);
})().catch((e) => {
  console.error("icon generation failed:", e);
  process.exit(1);
});
