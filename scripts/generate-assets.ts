/** Reproducible original SVG illustrations and synthesized PCM sounds; no external assets. */
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
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
// Expansion pack: all paths and patterns are drawn here, without external artwork.
Object.assign(illustrations, {
  bolt: `<path d="M286 38L93 291H222L185 475L424 211H291L333 38Z" fill="#ffd176"/><path d="M286 85L150 268H254" fill="none" stroke="${cream}" stroke-width="15" stroke-linejoin="round"/>`,
  cloud: `<path d="M112 388A83 83 0 0 1 87 226A113 113 0 0 1 303 160A84 84 0 0 1 431 263A64 64 0 0 1 422 388Z" fill="#dcf3ff"/><path d="M137 233Q153 166 208 177" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round"/><path d="M123 383H404" stroke="#a3d2ec" stroke-width="10" stroke-linecap="round"/>`,
  moon: `<path d="M340 55C187 53 70 161 86 303C100 436 260 496 377 413C436 370 451 322 444 267C377 315 284 301 245 231C207 162 248 83 340 55Z" fill="#ffd176"/><polygon points="${star(389,133,58,25,5)}" fill="${cream}"/><circle cx="467" cy="214" r="12" fill="${mint}"/>`,
  leaf: `<path d="M418 57C151 53 39 205 102 347C160 478 370 413 412 250C430 180 409 105 418 57Z" fill="${mint}"/><path d="M92 455Q188 258 344 145M166 325L151 234M226 248L324 246" fill="none" stroke="#1b7968" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/>`,
  flame: `<path d="M277 35C315 159 448 209 421 346C394 478 171 500 101 382C37 273 139 214 173 136C165 207 188 228 216 228C257 218 226 105 277 35Z" fill="${coral}"/><path d="M267 233C288 298 359 320 333 383C307 442 211 449 188 389C165 333 224 313 267 233Z" fill="#ffd176"/>`,
  camera: `<rect x="55" y="152" width="402" height="280" rx="44" fill="${navy}"/><path d="M147 154L177 90H300L331 154Z" fill="${mint}"/><rect x="79" y="186" width="62" height="35" rx="8" fill="${coral}"/><circle cx="267" cy="292" r="100" fill="${mint}"/><circle cx="267" cy="292" r="72" fill="#24475d"/><circle cx="267" cy="292" r="45" fill="#7295b0"/><circle cx="246" cy="270" r="17" fill="${cream}"/><circle cx="404" cy="198" r="13" fill="${cream}"/>`,
  headphones: `<path d="M93 300V219A163 163 0 0 1 419 219V300" fill="none" stroke="${navy}" stroke-width="47" stroke-linecap="round"/><path d="M113 207A143 143 0 0 1 399 207" fill="none" stroke="${mint}" stroke-width="16" stroke-linecap="round"/><rect x="52" y="251" width="97" height="180" rx="40" fill="${mint}"/><rect x="363" y="251" width="97" height="180" rx="40" fill="${coral}"/><path d="M78 286V389M391 286V389" stroke="${cream}" stroke-width="13" stroke-linecap="round"/>`,
  microphone: `<rect x="180" y="40" width="152" height="286" rx="76" fill="${mint}"/><path d="M139 235V257A117 117 0 0 0 373 257V235M256 374V449M184 454H328" fill="none" stroke="${navy}" stroke-width="27" stroke-linecap="round"/><path d="M198 143H239M273 143H314M198 185H239M273 185H314M204 227H308" stroke="#218b7b" stroke-width="11" stroke-linecap="round"/>`,
  coffee: `<path d="M347 190H391A63 63 0 0 1 391 316H355" fill="none" stroke="${coral}" stroke-width="31"/><path d="M80 177H360L343 335Q334 414 220 414Q106 414 97 335Z" fill="${cream}"/><ellipse cx="220" cy="181" rx="139" ry="33" fill="#9b6a50"/><path d="M57 433H388" stroke="${mint}" stroke-width="22" stroke-linecap="round"/><path d="M152 117C186 84 137 61 168 28M260 113C294 80 245 57 276 24" fill="none" stroke="${coral}" stroke-width="14" stroke-linecap="round"/>`,
  paw: `<ellipse cx="97" cy="203" rx="47" ry="66" transform="rotate(-24 97 203)" fill="${coral}"/><ellipse cx="199" cy="120" rx="48" ry="68" transform="rotate(-8 199 120)" fill="${coral}"/><ellipse cx="313" cy="120" rx="48" ry="68" transform="rotate(8 313 120)" fill="${coral}"/><ellipse cx="415" cy="203" rx="47" ry="66" transform="rotate(24 415 203)" fill="${coral}"/><path d="M256 230C208 230 188 279 142 322C83 377 128 463 194 436Q256 408 318 436C384 463 429 377 370 322C324 279 304 230 256 230Z" fill="${coral}"/>`,
  medal: `<path d="M153 268L108 468L209 425L247 472L278 306Z" fill="${mint}"/><path d="M359 268L404 468L303 425L265 472L234 306Z" fill="${coral}"/><circle cx="256" cy="205" r="165" fill="#ffd176"/><circle cx="256" cy="205" r="132" fill="none" stroke="#cb8c3c" stroke-width="10"/><polygon points="${star(256,205,95,44,5)}" fill="${cream}"/>`,
  clock: `<circle cx="256" cy="264" r="199" fill="${navy}"/><circle cx="256" cy="264" r="166" fill="${cream}"/>${Array.from({length:12},(_,i)=>`<path d="M256 119V138" transform="rotate(${i*30} 256 264)" stroke="#9badb9" stroke-width="11" stroke-linecap="round"/>`).join("")}<path d="M256 166V264L337 314" fill="none" stroke="${coral}" stroke-width="21" stroke-linecap="round" stroke-linejoin="round"/><circle cx="256" cy="264" r="17" fill="${navy}"/><path d="M160 61L132 33M352 61L380 33" stroke="${mint}" stroke-width="28" stroke-linecap="round"/>`,
  "bg-aurora": `<defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#09172e"/><stop offset="1" stop-color="#253357"/></linearGradient></defs><path d="M0 0H1920V1080H0Z" fill="url(#g)"/>${[0,1,2,3,4].map(i=>`<path d="M-150 ${400+i*60}C420 ${-290+i*80} 960 ${930-i*65} 2080 ${140+i*90}" stroke="${i%2?'#88c6ff':mint}" stroke-width="${135-i*15}" opacity="${.08+i*.025}" fill="none"/>`).join("")}${Array.from({length:60},(_,i)=>`<circle cx="${(i*173+71)%1920}" cy="${(i*79+31)%650}" r="${1+i%3}" fill="#dfeeff" opacity=".65"/>`).join("")}`,
  "bg-ocean": `<defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#acddeb"/><stop offset="1" stop-color="#275b8a"/></linearGradient></defs><path d="M0 0H1920V1080H0Z" fill="url(#g)"/>${['#5eabc8','#3a8da9','#246981','#194b66'].map((c,i)=>`<path d="M0 ${480+i*125}Q420 ${330+i*125} 960 ${520+i*125}T1920 ${430+i*125}V1080H0Z" fill="${c}"/>`).join("")}`,
  "bg-lavender": `<defs><radialGradient id="g" cx=".7" cy=".3" r=".9"><stop stop-color="#eee2fc"/><stop offset=".52" stop-color="#ad9dd7"/><stop offset="1" stop-color="#625c99"/></radialGradient></defs><path d="M0 0H1920V1080H0Z" fill="url(#g)"/><circle cx="220" cy="110" r="500" fill="#f0cef0" opacity=".15"/><circle cx="1650" cy="1080" r="440" fill="#cec7fb" opacity=".22"/>`,
  "bg-peach": `<path d="M0 0H1920V1080H0Z" fill="#f9ddd1"/><circle cx="1630" cy="130" r="580" fill="#f0a49d"/><path d="M0 430L1120 1080H0Z" fill="#df8e95"/><rect x="195" y="145" width="630" height="360" rx="180" transform="rotate(-24 510 325)" fill="#fbeccf"/><circle cx="1460" cy="830" r="180" fill="#c8b0ba"/>`,
  "bg-sand": `<path d="M0 0H1920V1080H0Z" fill="#e8d7bd"/><circle cx="1450" cy="275" r="128" fill="#fff0cf"/>${['#d9b894','#c89873','#aa795e','#805f50'].map((c,i)=>`<path d="M0 ${640+i*100}Q${400+i*190} ${100+i*220} 1920 ${700+i*100}V1080H0Z" fill="${c}"/>`).join("")}`,
  "bg-dots": `<defs><pattern id="d" width="160" height="160" patternUnits="userSpaceOnUse"><circle cx="40" cy="40" r="12" fill="#dfae96"/><circle cx="120" cy="120" r="9" fill="#96bcb0"/></pattern></defs><path d="M0 0H1920V1080H0Z" fill="#fff2dc"/><path d="M0 0H1920V1080H0Z" fill="url(#d)"/><rect x="245" y="170" width="1430" height="740" rx="55" fill="#fff9ed" fill-opacity=".88"/>`,
  "bg-blueprint": `<defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" stroke="#5688b9" stroke-width="1" fill="none"/></pattern></defs><path d="M0 0H1920V1080H0Z" fill="#183d68"/><path d="M0 0H1920V1080H0Z" fill="url(#g)" opacity=".5"/><g fill="none" stroke="#c1e5fc" opacity=".55" stroke-width="2"><circle cx="1480" cy="480" r="270"/><circle cx="1480" cy="480" r="200"/><path d="M1140 480H1820M1480 140V820M130 900H930V320H130Z"/><path d="M1100 920H1820M1100 900V940M1820 900V940"/></g>`,
  "bg-comic": `<path d="M0 0H1920V1080H0Z" fill="#ffe3a0"/>${Array.from({length:24},(_,i)=>{const t=i*Math.PI/12,x=960+1700*Math.cos(t),y=540+1700*Math.sin(t),t2=t+.08;return `<path d="M${960+250*Math.cos(t)} ${540+250*Math.sin(t)}L${x} ${y}L${960+1700*Math.cos(t2)} ${540+1700*Math.sin(t2)}Z" fill="#ecac75" opacity=".48"/>`;}).join("")}<ellipse cx="960" cy="540" rx="510" ry="270" fill="#fff2ce"/>`,
  "title-pill": `<rect x="110" y="809" width="830" height="146" rx="73" fill="${navy}" fill-opacity=".94"/><circle cx="183" cy="882" r="49" fill="${mint}"/><path d="M174 857L201 882L174 907" stroke="${navy}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "title-news": `<path d="M100 773H1570V885H100Z" fill="#eaf2f5"/><path d="M100 885H1810V967H100Z" fill="${navy}" fill-opacity=".95"/><path d="M100 773H120V967H100Z" fill="${coral}"/><path d="M1570 773H1810V885H1570Z" fill="${coral}"/>`,
  "title-split": `<rect x="280" y="325" width="1360" height="430" rx="30" fill="${navy}" fill-opacity=".94"/><path d="M310 325H600V755H310Q280 755 280 725V355Q280 325 310 325Z" fill="${mint}"/><path d="M672 650H1500" stroke="${coral}" stroke-width="7"/><circle cx="438" cy="534" r="64" fill="none" stroke="${navy}" stroke-width="8"/>`,
  "title-subtitle": `<defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#0b1420" stop-opacity="0"/><stop offset="1" stop-color="#0b1420" stop-opacity=".85"/></linearGradient></defs><path d="M0 680H1920V1080H0Z" fill="url(#s)"/><path d="M730 1000H1190" stroke="${mint}" stroke-width="5" stroke-linecap="round"/>`,
  "title-tape": `<path d="M360 369L1560 340L1578 732L378 761Z" fill="#fff0d5"/><path d="M297 342L337 327L385 347L430 327L472 344L493 421L451 433L405 416L358 437L316 423Z" fill="${mint}" fill-opacity=".85"/><path d="M1468 670L1508 655L1556 675L1601 655L1643 672L1664 749L1622 761L1576 744L1529 765L1487 751Z" fill="${coral}" fill-opacity=".85"/>`,
  "title-chapter": `<path d="M370 356H1550M370 730H1550" fill="none" stroke="${cream}" stroke-width="6"/><path d="M320 390V690M1600 390V690" fill="none" stroke="${mint}" stroke-width="12"/><polygon points="960,313 977,330 960,347 943,330" fill="${mint}"/>`,
});

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
    if(a.id==="sound-shutter") value=(noise*.75+Math.sin(2*Math.PI*1800*t)*.3)*(Math.exp(-t*48)+.7*Math.exp(-Math.max(0,t-.065)*65)*(t>=.065?1:0));
    if(a.id==="sound-impact") value=(Math.sin(2*Math.PI*(90*t-55*t*t))+.16*filtered)*Math.exp(-t*8);
    if(a.id==="sound-twinkle") value=[1318.5,1760,2093,2637].reduce((sum,f,j)=>{const local=t-j*.12;return sum+(local>=0?Math.sin(2*Math.PI*f*local)*Math.exp(-local*6)*.4:0);},0);
    if(a.id==="sound-fall") value=Math.sin(2*Math.PI*(1150*t-690*t*t))*Math.sin(Math.PI*u)*.65;
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
await writeFile(path.join(out,"LICENSE.txt"),`Original ReaCut illustrations and synthesized sounds\nCopyright (c) 2026 ReaCut contributors\n\nThese original assets are provided under the MIT License (see the repository LICENSE).\nYou may use, modify and redistribute them, including in exported commercial videos.\nThe asset SVGs and sounds use no external media, fonts, recordings or third-party artwork.\nSVG sources and PNG renders are included; sounds are deterministic 48 kHz mono PCM synthesis.\nNo likeness, endorsement or ownership of another application's branding is claimed.\n\n${await readFile(path.resolve("LICENSE"), "utf8")}`);
console.log(`Generated ${manifest.length} original assets in public/builtin-assets/`);

// Documentation previews are generated from the same shipped assets.
GlobalFonts.registerFromPath(path.resolve("public/fonts/NotoSansSC.ttf"), "Noto Sans SC");
async function contactSheet(assets: readonly BuiltinAsset[], name: string, heading: string) {
  const columns = 6, cellWidth = 260, cellHeight = 204, margin = 32;
  const canvas = createCanvas(columns * cellWidth + margin * 2, Math.ceil(assets.length / columns) * cellHeight + 146);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#11181f"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eaf5f3"; ctx.font = 'bold 32px "Noto Sans SC"'; ctx.fillText(heading, margin, 48);
  ctx.fillStyle = "#93a6b4"; ctx.font = '16px "Noto Sans SC"'; ctx.fillText(`${assets.length} 款 · 程序绘制 / 合成 · MIT 许可 · 本地可用`, margin, 78);
  for (const [index, asset] of assets.entries()) {
    const x = margin + index % columns * cellWidth, y = 104 + Math.floor(index / columns) * cellHeight;
    const width = cellWidth - 16, height = 148;
    ctx.fillStyle = "#24323e"; ctx.fillRect(x, y, width, height);
    if (asset.transparent) {
      for (let row = 0; row < height; row += 16) for (let col = 0; col < width; col += 16) {
        ctx.fillStyle = ((row + col) / 16) % 2 ? "#293a47" : "#21313e";
        ctx.fillRect(x + col, y + row, Math.min(16, width - col), Math.min(16, height - row));
      }
    }
    if (asset.kind === "image") {
      const img = await loadImage(path.join(out, asset.fileName));
      const scale = Math.min((width - 8) / img.width, (height - 8) / img.height);
      ctx.drawImage(img, x + (width - img.width * scale) / 2, y + (height - img.height * scale) / 2, img.width * scale, img.height * scale);
    } else {
      const bytes = await readFile(path.join(out, asset.fileName)), samples = (bytes.length - 44) / 2;
      ctx.strokeStyle = mint; ctx.lineWidth = 2;
      for (let column = 0; column < 104; column++) {
        let peak = 0; const begin = Math.floor(column * samples / 104), end = Math.floor((column + 1) * samples / 104);
        for (let j = begin; j < end; j++) peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + j * 2)) / 32768);
        ctx.beginPath();ctx.moveTo(x + 18 + column * 2, y + height / 2 - peak * 95);ctx.lineTo(x + 18 + column * 2, y + height / 2 + peak * 95);ctx.stroke();
      }
    }
    ctx.fillStyle = "#eaf5f3"; ctx.font = '18px "Noto Sans SC"'; ctx.fillText(asset.name, x, y + 175);
    ctx.fillStyle = "#8ba0ae"; ctx.font = '12px "Noto Sans SC"'; ctx.fillText(asset.kind === "audio" ? `WAV · ${asset.duration}s` : asset.category === "stickers" ? "PNG + SVG · 透明贴纸" : asset.category === "titles" ? "PNG + SVG · 透明底板" : "PNG + SVG · 1920 × 1080", x, y + 194);
  }
  await mkdir(path.resolve("docs/screenshots"), { recursive: true });
  await writeFile(path.resolve("docs/screenshots", name), canvas.toBuffer("image/png"));
}
await contactSheet(BUILTIN_ASSETS, "original-assets-contact.png", "ReaCut · 离线素材库");
await contactSheet(BUILTIN_ASSETS.slice(34), "new-assets-contact.png", "ReaCut · 新增灵感素材");
