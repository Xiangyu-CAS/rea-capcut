/** Reproducible original SVG illustrations and synthesized PCM sounds; no external assets. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { BUILTIN_ASSETS, type BuiltinAsset } from "../src/core/builtinAssets";
const out = path.resolve("public/builtin-assets");
await mkdir(out, { recursive: true });
const mint = "#62ead1", coral = "#ff806e", cream = "#fff4d7", navy = "#162332";
const svg = (a: BuiltinAsset, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}">${body}</svg>`;
const star = (cx: number, cy: number, outer: number, inner: number, count: number) => Array.from({length: count * 2}, (_, i) => {
  const angle = i * Math.PI / count - Math.PI / 2, radius = i % 2 ? inner : outer;
  return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
}).join(" ");
const illustrations: Record<string, string> = {
  sparkle: `<path d="M256 30 Q277 225 482 256 Q277 280 256 482 Q230 280 30 256 Q230 225 256 30" fill="${mint}"/><path d="M392 34 Q397 82 447 89 Q399 99 392 145 Q381 99 337 89 Q383 82 392 34" fill="${cream}"/>`,
  burst: `<polygon points="${star(256,256,225,155,12)}" fill="${coral}"/><polygon points="${star(256,256,164,140,12)}" fill="${cream}"/>`,
  heart: `<path d="M256 443 C222 403 62 306 62 172 C62 73 188 46 256 148 C324 46 450 73 450 172 C450 306 290 403 256 443Z" fill="${coral}"/><path d="M116 180 Q113 121 170 119" fill="none" stroke="${cream}" stroke-width="22" stroke-linecap="round"/>`,
  "arrow-curved": `<path d="M74 417 C62 225 329 380 344 159" fill="none" stroke="${mint}" stroke-width="38" stroke-linecap="round"/><path d="M253 196 L347 90 L421 218" fill="none" stroke="${mint}" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow-left": `<path d="M248 118 L66 256 L248 394Z" fill="${mint}"/><path d="M443 118 L261 256 L443 394Z" fill="${coral}"/>`,
  play: `<circle cx="256" cy="256" r="213" fill="${navy}"/><circle cx="256" cy="256" r="199" fill="none" stroke="${mint}" stroke-width="13"/><path d="M205 142 Q188 134 188 158 L188 354 Q188 378 208 367 L368 270 Q390 256 368 242Z" fill="${mint}"/>`,
  check: `<circle cx="256" cy="256" r="205" fill="${mint}"/><path d="M142 253 L221 331 L379 179" stroke="${navy}" stroke-width="43" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  pin: `<path d="M256 468 C207 405 104 285 104 192 A152 152 0 1 1 408 192 C408 285 305 405 256 468Z" fill="${coral}"/><circle cx="256" cy="190" r="63" fill="${cream}"/>`,
  speech: `<path d="M60 62 H452 V354 H230 L112 451 L125 354 H60Z" fill="${cream}"/><circle cx="166" cy="210" r="19" fill="${navy}"/><circle cx="256" cy="210" r="19" fill="${navy}"/><circle cx="346" cy="210" r="19" fill="${navy}"/>`,
  quote: `<path d="M76 330 V220 Q76 95 222 83 V143 Q143 153 143 220 H228 V382 H76Z M284 330 V220 Q284 95 430 83 V143 Q351 153 351 220 H436 V382 H284Z" fill="${mint}"/>`,
  film: `<rect x="61" y="52" width="390" height="408" rx="32" fill="${navy}"/><rect x="125" y="109" width="262" height="294" rx="9" fill="${mint}"/>${[90,174,258,342].map(y => `<rect x="77" y="${y}" width="27" height="46" rx="5" fill="${cream}"/><rect x="408" y="${y}" width="27" height="46" rx="5" fill="${cream}"/>`).join("")}`,
  clap: `<rect x="62" y="202" width="388" height="226" rx="22" fill="${navy}"/><path d="M66 182 L443 100 L425 29 L48 111Z" fill="${mint}"/>${[100,200,300,400].map(x=>`<path d="M${x} 175 l38 -81" stroke="${navy}" stroke-width="27"/>`).join("")}<path d="M110 277 H397 M110 338 H297" stroke="${cream}" stroke-width="18"/>`,
  sun: `<circle cx="256" cy="256" r="110" fill="#ffc969"/>${Array.from({length:12},(_,i)=>`<path d="M256 38 V93" transform="rotate(${i*30} 256 256)" stroke="#ffc969" stroke-width="24" stroke-linecap="round"/>`).join("")}`,
  rainbow: [coral,"#ffc969",mint,"#9290fb"].map((c,i)=>`<path d="M${51+i*48} 386 V299 A${205-i*48} ${205-i*48} 0 0 1 ${461-i*48} 299 V386" fill="none" stroke="${c}" stroke-width="43"/>`).join(""),
  confetti: Array.from({length:24},(_,i)=>`<rect x="${45+(i*127)%415}" y="${38+(i*83)%413}" width="${12+i%3*6}" height="${25+i%5*5}" rx="3" fill="${[mint,coral,cream,"#9290fb"][i%4]}" transform="rotate(${i*41%180} ${45+(i*127)%415} ${38+(i*83)%413})"/>`).join(""),
  focus: `<g fill="none" stroke="${mint}" stroke-width="16" stroke-linecap="round"><path d="M62 164 V62 H164 M348 62 H450 V164 M450 348 V450 H348 M164 450 H62 V348"/><circle cx="256" cy="256" r="39"/><path d="M256 181 V216 M256 296 V331 M181 256 H216 M296 256 H331"/></g>`,
  "bg-midnight": `<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#0c152b"/><stop offset="1" stop-color="#393275"/></linearGradient></defs><path fill="url(#g)" d="M0 0H1920V1080H0Z"/><circle cx="1540" cy="880" r="590" fill="#506394" opacity=".14"/>`,
  "bg-sunrise": `<defs><linearGradient id="g" x2="0.6" y2="1"><stop stop-color="#ffc985"/><stop offset=".6" stop-color="#ed8c83"/><stop offset="1" stop-color="#b46596"/></linearGradient></defs><path fill="url(#g)" d="M0 0H1920V1080H0Z"/><circle cx="1460" cy="345" r="175" fill="#ffe5b4" opacity=".65"/><path d="M0 890 Q460 590 980 900 T1920 780V1080H0Z" fill="#ae6a99" opacity=".4"/>`,
  "bg-mint": `<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#103b40"/><stop offset="1" stop-color="#277964"/></linearGradient></defs><path fill="url(#g)" d="M0 0H1920V1080H0Z"/><path d="M-160 930 Q560 80 2120 440" fill="none" stroke="${mint}" stroke-width="220" opacity=".15"/><path d="M-160 1100 Q760 280 2120 560" fill="none" stroke="${mint}" stroke-width="100" opacity=".18"/>`,
  "bg-paper": `<path fill="#efe9dc" d="M0 0H1920V1080H0Z"/>${Array.from({length:180},(_,i)=>`<path d="M${i*151%1920} ${i*239%1080}h${2+i%4}" stroke="#9c8c76" opacity=".14" stroke-width="2"/>`).join("")}`,
  "bg-grid": `<defs><pattern id="g" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#47657d" stroke-width="1"/></pattern></defs><path fill="#142331" d="M0 0H1920V1080H0Z"/><path fill="url(#g)" d="M0 0H1920V1080H0Z"/><path d="M960 0V1080M0 540H1920" stroke="${mint}" opacity=".3" stroke-width="2"/>`,
  "bg-orbit": `<path fill="#191c3c" d="M0 0H1920V1080H0Z"/>${[210,370,530,690,850].map((r,i)=>`<ellipse cx="1400" cy="540" rx="${r}" ry="${r*.62}" fill="none" stroke="${i%2 ? mint : "#9690f7"}" stroke-width="${i%2?2:5}" opacity=".35" transform="rotate(-26 1400 540)"/>`).join("")}<circle cx="1410" cy="330" r="65" fill="#9690f7"/>`,
  "title-mint": `<path d="M110 794H1080V949H110Z" fill="${navy}" fill-opacity=".94"/><path d="M110 794H128V949H110Z" fill="${mint}"/><path d="M128 949H710V989H128Z" fill="${mint}"/>`,
  "title-coral": `<path d="M300 837H1620V963H300Z" fill="${navy}" fill-opacity=".94"/><path d="M300 823H1620V837H300Z" fill="${coral}"/><circle cx="348" cy="900" r="12" fill="${coral}"/>`,
  "title-glass": `<rect x="120" y="740" width="960" height="240" rx="28" fill="${navy}" fill-opacity=".82" stroke="#edf6ff" stroke-opacity=".6" stroke-width="2"/><path d="M165 794H210" stroke="${mint}" stroke-width="8" stroke-linecap="round"/>`,
  "title-frame": `<rect x="80" y="68" width="1760" height="944" rx="8" fill="none" stroke="${cream}" stroke-width="3"/><path d="M80 848H1840" stroke="${cream}" stroke-width="3"/>`,
  "title-corner": `<path d="M100 110H160V490H100Z" fill="${coral}"/><path d="M160 110H730V212H160Z" fill="${navy}" fill-opacity=".92"/><path d="M1680 860H1800V980H1680Z" fill="${mint}"/><path d="M1730 885L1768 920L1730 955" fill="none" stroke="${navy}" stroke-width="9"/>`,
  "title-ribbon": `<path d="M345 820H1575L1535 900L1575 980H345L385 900Z" fill="${coral}"/><path d="M410 840H1510V960H410Z" fill="none" stroke="${cream}" stroke-width="2"/>`,
};
function wav(a: BuiltinAsset) {
  const rate=48000, count=Math.round(a.duration*rate), data=Buffer.alloc(44+count*2);
  data.write("RIFF"); data.writeUInt32LE(36+count*2,4); data.write("WAVEfmt ",8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(rate,24); data.writeUInt32LE(rate*2,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write("data",36); data.writeUInt32LE(count*2,40);
  let seed=87452, filtered=0;
  for(let i=0;i<count;i++) {
    const t=i/rate, u=t/a.duration, fade=Math.min(1,t/.005,(a.duration-t)/.015); let value=0;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0; const noise=seed/2147483648-1; filtered=.82*filtered+.18*noise;
    if(a.id==="sound-pop") value=Math.sin(2*Math.PI*(700*t-850*t*t))*Math.exp(-t*20);
    if(a.id==="sound-click") value=(.65*Math.sin(2*Math.PI*1500*t)+.35*noise)*Math.exp(-t*65);
    if(a.id==="sound-chime") value=(Math.sin(2*Math.PI*1046.5*t)+.4*Math.sin(2*Math.PI*1568*t))*Math.exp(-t*4);
    if(a.id==="sound-rise") value=Math.sin(2*Math.PI*(330*t+650*t*t))*Math.sin(Math.PI*u)*.65;
    if(a.id==="sound-whoosh") value=filtered*Math.sin(Math.PI*u)**2*2;
    if(a.id==="sound-complete") value=[523.25,659.25,783.99].reduce((sum,f,j)=>{const local=t-j*.16;return sum+(local>=0?Math.sin(2*Math.PI*f*local)*Math.exp(-local*5)*.48:0);},0);
    data.writeInt16LE(Math.round(Math.max(-.92,Math.min(.92,value*.55*fade))*32767),44+i*2);
  }
  return data;
}
const manifest=[];
for(const asset of BUILTIN_ASSETS) {
  let bytes: Buffer;
  if(asset.kind==="image") {
    const source=svg(asset, illustrations[asset.id]);
    if(!illustrations[asset.id]) throw new Error(`Missing ${asset.id}`);
    await writeFile(path.join(out,`${asset.id}.svg`),source);
    const canvas=createCanvas(asset.width,asset.height); canvas.getContext("2d").drawImage(await loadImage(Buffer.from(source)),0,0); bytes=canvas.toBuffer("image/png");
  } else bytes=wav(asset);
  await writeFile(path.join(out,asset.fileName),bytes);
  manifest.push({...asset,source:asset.kind==="image"?`${asset.id}.svg`:"../../scripts/generate-assets.ts",provenance:"original-programmatic",license:"MIT",sha256:createHash("sha256").update(bytes).digest("hex")});
}
await writeFile(path.join(out,"manifest.json"),JSON.stringify({schema:1,generator:"scripts/generate-assets.ts",assets:manifest},null,2)+"\n");
await writeFile(path.join(out,"LICENSE.txt"),`Original ReaCut illustrations and synthesized sounds\nCopyright (c) 2026 ReaCut contributors\n\nThese original assets are provided under the MIT License (see the repository LICENSE).\nYou may use, modify and redistribute them, including in exported commercial videos.\nThe generator uses no external media, fonts, recordings or third-party artwork.\nSVG sources and PNG renders are included; sounds are deterministic 48 kHz mono PCM synthesis.\nNo likeness, endorsement or ownership of another application's branding is claimed.\n\n${await readFile(path.resolve("LICENSE"), "utf8")}`);
console.log(`Generated ${manifest.length} original assets in public/builtin-assets/`);
