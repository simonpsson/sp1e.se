import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const api = fs.readFileSync('functions/api/[[route]].ts', 'utf8');
const monogramPath = 'assets/sp_monogram.svg';
const monogram = fs.existsSync(monogramPath) ? fs.readFileSync(monogramPath, 'utf8') : '';
const hubButton = index.match(/<button class=["']card hub-card["'][\s\S]*?<\/button>/)?.[0] ?? '';

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

check(
  'landing page has fixed Google search form',
  /id=["']google-search["']/.test(index) &&
    /action=["']https:\/\/www\.google\.com\/search["']/.test(index) &&
    /name=["']q["']/.test(index) &&
    /target=["']_blank["']/.test(index) &&
    /body\.immersive\s+#google-search/.test(index)
);

check(
  'landing search is minimal: no Google placeholder and Lambda submit',
  /<input\s+type=["']search["']\s+name=["']q["'][^>]*aria-label=["']Sökfråga["'][^>]*>/.test(index) &&
    !/<input\s+type=["']search["']\s+name=["']q["'][^>]*placeholder=/.test(index) &&
    !/Sök på Google/.test(index) &&
    /<button\s+type=["']submit["']\s+aria-label=["']Sök["']>\s*Λ\s*<\/button>/.test(index)
);

check(
  'landing static background is brighter than the previous heavy overlay',
  /#bg-overlay\s*\{[\s\S]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.48\)/.test(index) &&
    !/background:\s*rgba\(0,\s*0,\s*0,\s*0\.62\)/.test(index)
);

check(
  'landing page has left news panel wired to /api/news',
  /id=["']news-panel["']/.test(index) &&
    /id=["']news-hover-zone["']/.test(index) &&
    /id=["']news-list["']/.test(index) &&
    /news-kicker/.test(index) &&
    /News wire/.test(index) &&
    /fetch\(['"]\/api\/news['"]/.test(index) &&
    /body\.immersive\s+#news-hover-zone/.test(index) &&
    /body\.immersive\s+#news-panel/.test(index)
);

check(
  'news panel is compact and reveals from the left edge on hover',
  /#news-hover-zone\s*\{[\s\S]*position:\s*fixed[\s\S]*left:\s*0[\s\S]*width:\s*28px/.test(index) &&
    /#news-panel\s*\{[\s\S]*width:\s*264px[\s\S]*transform:\s*translateX\(calc\(-100% - 30px\)\)\s*scale\(0\.92\)/.test(index) &&
    /#news-hover-zone:hover\s*\+\s*#news-panel/.test(index) &&
    /#news-panel:hover/.test(index) &&
    /#news-panel:focus-within/.test(index) &&
    /#news-panel\.news-open/.test(index) &&
    /aria-hidden=["']true["']/.test(index) &&
    /\sinert\b/.test(index) &&
    /function\s+setNewsPanelOpen/.test(index) &&
    /pointer-events:\s*none/.test(index) &&
    /pointer-events:\s*auto/.test(index)
);

check(
  'landing page uses the gallery-wall static background asset',
  /const\s+LANDING_STATIC_ART\s*=\s*\{[\s\S]*image_url:\s*['"]\/assets\/landing\/gallery-wall-wide\.png['"][\s\S]*title:\s*['"]Gallery wall['"]/.test(index) &&
    fs.existsSync('assets/landing/gallery-wall-wide.png')
);

check(
  'landing page no longer renders the cocktail banner',
  !/id=["']cocktail-ad["']/.test(index) &&
    !/initCocktailBanner/.test(index) &&
    !/DR_THULE/.test(index)
);

check(
  'landing text uses the same Cormorant typeface as the SP1E wordmark',
  /body\s*\{[\s\S]*font-family:\s*'Cormorant Garamond',\s*serif/.test(index) &&
    /\.landing-type-lock[\s\S]*font-family:\s*'Cormorant Garamond',\s*serif\s*!important/.test(index) &&
    /<body class=["']landing-type-lock["']/.test(index)
);

check(
  'news sources render as local logo wordmarks instead of generic text',
  /function\s+renderNewsSourceLogo/.test(index) &&
    /class="news-source-logo/.test(index) &&
    /news-source-bbc/.test(index) &&
    /news-source-dn/.test(index) &&
    /news-source-aftonbladet/.test(index) &&
    /news-source-aljazeera/.test(index)
);

check(
  'SP1E wordmark is a centered four-column HTML lockup',
  /class=["']sp1e-wordmark["']/.test(index) &&
    /grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(index) &&
    !/<svg class=["']sp1e-logo["']/.test(index)
);

check(
  'hub symbol uses a thin Scandinavian monoline Sigma/Pi mark',
  fs.existsSync(monogramPath) &&
    /viewBox=["']0 0 100 80["']/.test(monogram) &&
    /id=["']sp-monogram-line["']/.test(monogram) &&
    /d=["']M 84 66 L 84 16 L 18 16 L 40 40 L 18 64 L 54 64 L 54 16["']/.test(monogram) &&
    /fill=["']none["']/.test(monogram) &&
    /stroke=["']currentColor["']/.test(monogram) &&
    /stroke-width=["']5["']/.test(monogram) &&
    /stroke-linecap=["']butt["']/.test(monogram) &&
    /stroke-linejoin=["']miter["']/.test(monogram) &&
    /stroke-miterlimit=["']2["']/.test(monogram) &&
    !/mask=/.test(monogram) &&
    /class=["']hub-symbol["']/.test(hubButton) &&
    /viewBox=["']0 0 100 80["']/.test(hubButton) &&
    /id=["']sp-monogram-line-inline["']/.test(hubButton) &&
    /d=["']M 84 66 L 84 16 L 18 16 L 40 40 L 18 64 L 54 64 L 54 16["']/.test(hubButton) &&
    /stroke-width=["']5["']/.test(hubButton) &&
    /width:\s*100px/.test(index) &&
    /height:\s*54px/.test(index) &&
    !/mask=/.test(hubButton) &&
    !/id=["']hub-mark-sp["']/.test(hubButton) &&
    !/id=["']hub-mark-sigma["']/.test(hubButton) &&
    !/id=["']hub-mark-pi["']/.test(hubButton)
);

const protectedIndex = api.indexOf('Protected');
const newsIndex = api.indexOf("resource === 'news'");

check(
  '/api/news public route is before protected routes',
  newsIndex !== -1 && protectedIndex !== -1 && newsIndex < protectedIndex
);

check(
  'news API includes Swedish and international RSS sources',
  /Dagens Nyheter/.test(api) &&
    /Aftonbladet/.test(api) &&
    /BBC World/.test(api) &&
    /Al Jazeera/.test(api)
);

check(
  'news API parser decodes XML and CDATA',
  /function\s+parseNewsItems/.test(api) &&
    /function\s+readXmlTag/.test(api) &&
    /function\s+stripCdata/.test(api) &&
    /function\s+decodeXml/.test(api)
);

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}`);

if (failed.length) {
  console.error(`\n${failed.length} landing layout check(s) failed.`);
  process.exit(1);
}

console.log('\nLanding layout checks passed.');
