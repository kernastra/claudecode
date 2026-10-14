// Renders docs/bar.svg: the PR bar's animated background in each of its three moods, from the mod's own art code.
// Run from mods/pr-card: npx tsx docs/render-bar.ts docs/bar.svg
import { writeFileSync } from "node:fs";
import { bandArt, type BandMood } from "../hooks/band.tsx";

const MOODS: { mood: BandMood; label: string }[] = [
  { mood: "calm", label: "Checks passed · calm orange wash with drifting embers" },
  { mood: "pending", label: "Checks running · amber dots race along" },
  { mood: "failing", label: "Checks failing or merge conflicts · red, breathing faster" },
];
const BAR_W = 1400, BAR_H = 64, ART_W = 520, PAD = 24, GAP = 14, R = 16;
const W = BAR_W + PAD * 2;
const H = PAD * 2 + MOODS.length * (BAR_H + GAP) - GAP;
const NAMES = "br|sw|e|d|up|go";

const strips = MOODS.map(({ mood, label }, i) => {
  const y = PAD + i * (BAR_H + GAP);
  // Start a minute into the animation so the first frame already shows embers, and give every band its own
  // class, keyframe and gradient names so the three can share one document.
  const art = bandArt(mood, 60_000)
    .replace(new RegExp(`class="(${NAMES})"`, "g"), `class="$1${i}"`)
    .replace(new RegExp(`\\.(${NAMES})(?=[{,])`, "g"), `.$1${i}`)
    .replace(new RegExp(`(@keyframes |animation:|animation-name:)(${NAMES})\\b`, "g"), `$1$2${i}`)
    .replace(/id="(w|f|s|m|g)"/g, `id="$1${i}"`)
    .replace(/url\(#(w|f|s|m|g)\)/g, `url(#$1${i})`)
    .replace("<svg ", `<svg x="${PAD + BAR_W - ART_W}" y="${y}" `);
  return (
    `<clipPath id="c${i}"><rect x="${PAD}" y="${y}" width="${BAR_W}" height="${BAR_H}" rx="${R}"/></clipPath>` +
    `<rect x="${PAD}" y="${y}" width="${BAR_W}" height="${BAR_H}" rx="${R}" fill="#141416" stroke="#2a2a2f"/>` +
    `<g clip-path="url(#c${i})">${art}</g>` +
    `<text x="${PAD + 28}" y="${y + 41}" class="t">${label}</text>`
  );
});

writeFileSync(
  process.argv[2],
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 1.5}" height="${H / 1.5}">` +
    `<style>.t{font:24px "Adwaita Sans",Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:#d4d4d8}</style>` +
    `<rect width="${W}" height="${H}" rx="20" fill="#0d0d0f"/>${strips.join("")}</svg>`,
);
