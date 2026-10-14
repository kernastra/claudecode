// Renders docs/themes.svg: every month's band, animated, from the mod's own theme code.
// Run from mods/usage-bar: npx tsx docs/render-themes.ts docs/themes.svg
import { writeFileSync } from "node:fs";
import { SEASONS, seasonArt, ART_W, ART_H } from "../hooks/seasons.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAD = 24, GAP = 14, R = 16;
const W = ART_W + PAD * 2;
const H = PAD + SEASONS.length * (ART_H + GAP) - GAP + PAD;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;");

const strips = SEASONS.map((s, i) => {
  const y = PAD + i * (ART_H + GAP);
  // Each band's art defines the same class, keyframe and gradient names; suffix them per band.
  // Start a minute into the animation so the first frame already shows particles.
  const art = seasonArt(s, 60_000)
    .replace(/class="p"/g, `class="p${i}"`).replace(/\.p\{/g, `.p${i}{`).replace(/\.p,/g, `.p${i},`)
    .replace(/\bmv\b/g, `mv${i}`).replace(/\bbr\b/g, `br${i}`)
    .replace(/id="w"/g, `id="w${i}"`).replace(/url\(#w\)/g, `url(#w${i})`)
    .replace(/id="g"/g, `id="g${i}"`).replace(/url\(#g\)/g, `url(#g${i})`)
    .replace("<svg ", `<svg x="${PAD}" y="${y}" `);
  return (
    `<clipPath id="c${i}"><rect x="${PAD}" y="${y}" width="${ART_W}" height="${ART_H}" rx="${R}"/></clipPath>` +
    `<rect x="${PAD}" y="${y}" width="${ART_W}" height="${ART_H}" rx="${R}" fill="#212121"/>` +
    `<g clip-path="url(#c${i})">${art}</g>` +
    `<text x="${PAD + 28}" y="${y + 42}" class="t">${esc(`${MONTHS[i]} · ${s.name}`)}</text>`
  );
});

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 1.5}" height="${H / 1.5}">` +
  `<style>.t{font:26px "Adwaita Sans",Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:#e8e6e3}</style>` +
  `<rect width="${W}" height="${H}" rx="20" fill="#141414"/>` +
  strips.join("") +
  `</svg>`;
writeFileSync(process.argv[2], svg);
console.log(`${W}x${H}, ${(svg.length / 1024).toFixed(1)} KB`);
