import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const api = fs.readFileSync('functions/api/[[route]].ts', 'utf8');

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
  'landing page has left news panel wired to /api/news',
  /id=["']news-panel["']/.test(index) &&
    /id=["']news-list["']/.test(index) &&
    /news-kicker/.test(index) &&
    /News wire/.test(index) &&
    /fetch\(['"]\/api\/news['"]/.test(index) &&
    /body\.immersive\s+#news-panel/.test(index)
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
  'hub symbol is a single continuous stroked Sigma/Pi mark',
  /viewBox=["']0 0 120 80["']/.test(index) &&
    /id=["']hub-mark-sp["']/.test(index) &&
    /stroke:\s*currentColor/.test(index) &&
    /stroke-width:\s*8\.5/.test(index) &&
    /stroke-linejoin:\s*round/.test(index) &&
    /M100 64V18H25L49 40L25 64H66V18H100/.test(index) &&
    !/id=["']hub-mark-sigma["']/.test(index) &&
    !/id=["']hub-mark-pi["']/.test(index)
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
