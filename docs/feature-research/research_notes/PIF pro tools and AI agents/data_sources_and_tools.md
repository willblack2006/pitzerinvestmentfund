# Data sources, existing MCP servers, and an agent tool catalog for PIF

Research date: 2026-11-13. "Live probe" means I sent a real HTTP request from this machine on 2026-11-13 (User-Agent set, no keys unless stated) and recorded the status code. A probe shows the endpoint answered on that day. It does not show the terms allow our use. GitHub star counts and last-push dates come from the GitHub REST API (`gh api repos/<owner>/<repo>`) on 2026-11-13.

What the app already calls (from `lib/sources/*.js` and grep of `lib/` and `routes/`): Yahoo (`query1/query2.finance.yahoo.com` v1/v6/v7/v8/v10), SEC (`data.sec.gov/submissions`, `data.sec.gov/api`, `www.sec.gov/Archives`, `www.sec.gov/files`, `efts.sec.gov/LATEST`, `cgi-bin`), Finnhub (`finnhub.io/api`), FRED (`api.stlouisfed.org/fred`), Fed (`federalreserve.gov/json`, `/feeds`), FINRA (`cdn.finra.org/equity`), USAspending (`api.usaspending.gov/api`), House Clerk (`disclosures-clerk.house.gov`), Senate eFD (`efdsearch.senate.gov`), OpenAI. So the catalog below marks each tool as EXISTING (a source the app already hits, the tool is a wrapper over code we have) or NEW.

## Key question 1: Which sources have official APIs, which are free, and what limits and terms apply?

### Takeaway
Almost every government source on the list has an official, free JSON API. Most need no key (SEC, Treasury, Federal Register, USAspending, ClinicalTrials.gov, FINRA query API for short data, CFTC Socrata, Wikimedia). The rest use free keys (FRED, BLS v2, BEA, Census, EIA, api.data.gov for FEC/openFDA, LDA). The binding limits are SEC 10 req/s with a declared User-Agent, FRED about 120 req/min, BLS v2 500 queries/day, GDELT one request per 5 s, and Finnhub free 60 calls/min. Two terms issues matter most: Senate (and House) financial disclosure reports carry a statutory use restriction, and Yahoo Finance has no official public market-data API (the endpoints the app uses are undocumented).

Two changes since earlier builds matter: the Senate LDA lobbying API now answers at `lda.gov` (the old `lda.senate.gov/api` returned 503), and PatentsView's API is gone (redirects to the USPTO Open Data Portal transition guide). Census now redirects keyless calls to a "missing key" page.

### Cited Findings

#### SEC EDGAR
- Fair access: "Current max request rate: 10 requests/second." SEC "reserves the right to limit request rates to preserve fair access for all users." Requests must declare a User-Agent such as "Sample Company Name AdminContact@<sample company domain>.com", plus `Accept-Encoding: gzip, deflate` and `Host: www.sec.gov`. Source: [SEC: Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- data.sec.gov APIs "do not require any authentication or API keys"; data.sec.gov "does not support Cross Origin Resource Scripting (CORS)" (so calls must go server side, which our Express app already does). Source: [SEC: EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Endpoints: `https://data.sec.gov/submissions/CIK##########.json` (10-digit CIK with leading zeros); `https://data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/AccountsPayableCurrent.json`; `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`; `https://data.sec.gov/api/xbrl/frames/us-gaap/AccountsPayableCurrent/USD/CY2019Q1I.json`. Frames "aggregates one fact for each reporting entity" that best fits the period. Period codes: `CY####` annual (365 days ±30), `CY####Q#` quarterly (91 days ±30), `CY####Q#I` instantaneous. Ratio units use `-per-` (e.g. `USD-per-shares`). Source: [SEC: EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Bulk: `companyfacts.zip` (`https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip`) and `submissions.zip` (`https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip`) are rebuilt nightly at about 3:00 a.m. ET. Submissions API latency is typically under a second; XBRL APIs under a minute. Source: [SEC: EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Index paths: `/Archives/edgar/daily-index` and `/Archives/edgar/full-index` (full index covers the current quarter through the previous business day and rolls into a static quarterly index at quarter end); each directory also offers index.json. Other paths: `/Archives/edgar/Feed/` (daily tar/gzip), `/Archives/edgar/Oldloads/`, `/Archives/edgar/monthly/` (XBRL RSS archive from April 2005), ticker files `company_tickers.json`, `company_tickers_exchange.json`, `company_tickers_mf.json` under `https://www.sec.gov/files/`. Full-text search UI is at `https://www.sec.gov/edgar/search/`. Source: [SEC: Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- Live probes 2026-11-13, all HTTP 200: frames `us-gaap/Revenues/USD/CY2024` and `us-gaap/NetIncomeLoss/USD/CY2025Q2`; frames `dei/EntityCommonStockSharesOutstanding/shares/CY2025Q3I`; full-text search backend `https://efts.sec.gov/LATEST/search-index?q="data center"&forms=8-K&dateRange=custom&startdt=2026-10-01&enddt=2026-11-12` (returned 565 hits); Atom latest-filings feed `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=10&output=atom`; `https://www.sec.gov/Archives/edgar/full-index/2026/QTR4/form.idx` (header "Last Data Received: November 13, 2026"); XBRL RSS `https://www.sec.gov/Archives/edgar/usgaap.rss.xml`. Source: [frames example](https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2024.json), [EFTS](https://efts.sec.gov/LATEST/search-index?q=%22data%20center%22&forms=8-K), [Atom feed](https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=10&output=atom), [form.idx](https://www.sec.gov/Archives/edgar/full-index/2026/QTR4/form.idx), [usgaap.rss.xml](https://www.sec.gov/Archives/edgar/usgaap.rss.xml)
- 8-K items are already in the submissions JSON: `filings.recent` has an `items` field. For NVIDIA it returned values like `5.02,9.01`, `8.01`, `2.02,9.01`. Other fields: accessionNumber, filingDate, reportDate, acceptanceDateTime, form, primaryDocument, isXBRL, isInlineXBRL. (Live probe.). Source: [NVDA submissions](https://data.sec.gov/submissions/CIK0001045810.json)
- Pay vs Performance XBRL is in companyfacts under the `ecd` taxonomy. NVIDIA's companyfacts had 7 `ecd` concepts: CoSelectedMeasureAmt, NonPeoNeoAvgCompActuallyPaidAmt, NonPeoNeoAvgTotalCompAmt, PeerGroupTotalShareholderRtnAmt, PeoActuallyPaidCompAmt, PeoTotalCompAmt, TotalShareholderRtnAmt. The frames API worked for `ecd/PeoActuallyPaidCompAmt/USD/CY2024` (HTTP 200), so cross-sectional CEO "compensation actually paid" is one call. (A guessed concept `ecd/CompActuallyPaidAmt` returned 404, so concept names must be exact.) Live probe. Source: [NVDA companyfacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json), [ecd frame](https://data.sec.gov/api/xbrl/frames/ecd/PeoActuallyPaidCompAmt/USD/CY2024.json)
- SEC structured data sets index lists: Financial Statement Data Sets, Financial Statement and Notes Data Sets, Form 13F, Insider Transactions (Forms 3/4/5), Form N-PORT, Form D, Form N-CEN, N-MFP, BDC, crowdfunding, transfer agent, adviser data and others. The old `/dera/data/...` URLs redirect or 404; the current paths are under `/data-research/sec-markets-data/`. (Live probe.). Source: [SEC Markets Data index](https://www.sec.gov/data-research/sec-markets-data), [Financial Statement Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets), [Financial Statement and Notes](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets), [Form 13F data sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets), [Insider transactions data sets](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets), [Form N-PORT data sets](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets), [Form D data sets](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets)
- Schedule 13D/13G: SEC technical specifications list a Schedule 13D & 13G XML spec (Version 2.3, April 15, 2026) and a Form 144 XML spec (Version 2.0, October 17, 2022). Third-party parser docs say new-format filings use form types "SCHEDULE 13D"/"SCHEDULE 13G" with a `primary_doc.xml`, while legacy "SC 13D"/"SC 13G" filings are HTML/text only, and that 13D and 13G schemas use different field names. Source: [SEC technical specifications](https://www.sec.gov/submit-filings/technical-specifications), [edgarjure schedule13 docs](https://cljdoc.org/d/com.github.clojure-finance/edgarjure/0.4.0/api/edgar.forms.schedule13)

#### FRED / ALFRED
- "All web service requests require an API key.". Source: [FRED API keys](https://fred.stlouisfed.org/docs/api/api_key.html)
- Endpoints include `fred/series/observations`, `fred/series/vintagedates` ("dates in history when a series' data values were revised or new data values were released") and `fred/series/updates`. The API serves FRED and ALFRED (vintages). Real-time periods are documented on a separate page. Source: [FRED API docs](https://fred.stlouisfed.org/docs/api/fred/), [Real-time periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)
- Rate limit: FRED's own docs pages I fetched state none. The FRED MCP server sets `FRED_RATE_LIMIT_PER_MINUTE` default `120` as a "client-side token bucket matching FRED's per-key quota"; several third-party sources say 120 req/min with HTTP 429 when exceeded. Treat 120/min as widely reported, not confirmed by FRED. Source: [fred-mcp-server README](https://github.com/stefanoamorelli/fred-mcp-server), [apis.io FRED rate limits](https://apis.io/rate-limits/fred/fred-rate-limits/)

#### Federal Reserve and Treasury
- Fed press-release RSS `https://www.federalreserve.gov/feeds/press_all.xml` returned 200 (live probe; app already uses Fed feeds). Source: [Fed RSS](https://www.federalreserve.gov/feeds/press_all.xml)
- Treasury daily par yield curve CSV: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv` returned 200 with columns 1 Mo through 30 Yr and a row for 11/13/2026 (live probe, no key). Source: [Treasury yield CSV](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv)
- Fiscal Data API: `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1` returned 200 with record_date 2026-11-12 (live probe, no key). Source: [Fiscal Data debt to the penny](https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bsize%5D=1)

#### BLS, BEA, Census, EIA
- BLS: v2 (registered) allows 500 queries/day, 50 series/query, 20 years/query; v1 (unregistered) 25 queries/day, 25 series, 10 years; both 50 requests per 10 seconds. v1 "does not require registration.". Source: [BLS API FAQs](https://www.bls.gov/developers/api_faqs.htm), [BLS developers](https://www.bls.gov/developers/)
- Live probe: `https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0` (CPI-U all items) returned REQUEST_SUCCEEDED with 2026 M10 data, without a key. Source: [BLS CPI-U endpoint](https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0)
- BEA: requires a UserID (name, email, accept terms). Source: [BEA API signup](https://apps.bea.gov/api/signup/). A university data guide says BEA enforces 100 requests, 100 MB and 30 errors per minute. Source: [UA Libraries BEA cookbook](https://ua-libraries-research-data-services.github.io/UALIB_ScholarlyAPI_Cookbook/overview/bea.html). I could not confirm the lockout length from BEA itself.
- Census: a keyless call to `https://api.census.gov/data/timeseries/eits/marts?...` (monthly retail trade) returned HTTP 302 to `https://api.census.gov/data/missing_key.html` (live probe), so plan on a key. Key request page:. Source: [Census API key](https://www.census.gov/data/developers/guidance/api-user-guide.Help_&_Contact_Us.html)
- EIA: key required ("you must use the unique API key assigned to you", passed as `?api_key=`). Base `https://api.eia.gov/v2/`; documented example `https://api.eia.gov/v2/electricity/rto?api_key=xxxxxx`. JSON responses cap at 5,000 rows (XML 300). Automated clients "must throttle the number of the requests they make per second and per hour"; over-limit keys are temporarily suspended. No numeric limit published on that page. Source: [EIA API documentation](https://www.eia.gov/opendata/documentation.php)

#### Spending, lobbying, campaign finance
- USAspending `https://api.usaspending.gov/api/v2/references/toptier_agencies/` returned 200 without a key (live probe; the app already uses USAspending). Source: [USAspending endpoint](https://api.usaspending.gov/api/v2/references/toptier_agencies/)
- LDA lobbying: `https://lda.senate.gov/api/v1/filings/?client_name=Oracle&filing_year=2025` returned HTTP 503; the same query at `https://lda.gov/api/v1/filings/` returned 200 with count 96 (live probe). The `lda.gov/api/v1/` root lists `filings`, `contributions`, `registrants`, `clients`, `lobbyists` and `constants/...` endpoints. The lda.gov API page links to API key registration, V1 docs (`/api/redoc/v1/`) and API terms of service. Source: [lda.gov API page](https://lda.gov/api/), [lda.gov API root](https://lda.gov/api/v1/)
- FEC: `https://api.open.fec.gov/v1/candidates/?api_key=DEMO_KEY` returned 200 (live probe). It runs on api.data.gov, where most APIs allow 1,000 requests/hour per key and DEMO_KEY allows 30/hour and 50/day per IP; keys go in `X-Api-Key` header or `api_key` query param. Source: [api.data.gov developer manual](https://api.data.gov/docs/developer-manual/), [OpenFEC](https://api.open.fec.gov/developers/)

#### Health
- openFDA: without a key 240 requests/min and 1,000/day per IP; with a key 240/min and 120,000/day per key. Source: [openFDA authentication](https://open.fda.gov/apis/authentication/). Live probe of `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:semaglutide&limit=1` returned 200 with a disclaimer "Do not rely on openFDA to make decisions regarding medical care.". Source: [openFDA drug event](https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:semaglutide&limit=1)
- ClinicalTrials.gov API v2: `https://clinicaltrials.gov/api/v2/studies?query.spons=Novo%20Nordisk&filter.overallStatus=RECRUITING&countTotal=true&pageSize=1` returned 200 with totalCount 108 (live probe, no key). `query.spons=Hims` returned zero studies, so this source matters little for HIMS directly. Source: [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api), [probe URL](https://clinicaltrials.gov/api/v2/studies?query.spons=Novo%20Nordisk&filter.overallStatus=RECRUITING&countTotal=true&pageSize=1)

#### Regulation, patents
- Federal Register: `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=semiconductor&per_page=2` returned 200, count 3,830 (live probe, no key). The human docs page redirected WebFetch to an "unblock" page, so I could not read the documented limits. Source: [Federal Register documents.json](https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=semiconductor&per_page=2)
- PatentsView: `https://api.patentsview.org/patents/query` returns 301 to `https://data.uspto.gov/support/transition-guide/patentsview`; `search.patentsview.org` did not resolve (live probe). A USPTO notice titled "PatentsView migrating to USPTO Open Data Portal on March 20" exists. Source: [USPTO notice](https://www.uspto.gov/subscription-center/2026/patentsview-migrating-uspto-open-data-portal-march-20), [USPTO transition guide](https://data.uspto.gov/support/transition-guide/patentsview). The ODP key process and rate limit (one third-party page says about 50 req/min) are unverified.

#### Market structure
- FINRA query API, no credentials, both returned 200 (live probe): `https://api.finra.org/data/group/otcMarket/name/regShoDaily` (fields tradeReportDate, securitiesInformationProcessorSymbolIdentifier, shortParQuantity, shortExemptParQuantity, totalParQuantity, marketCode, reportingFacilityCode) and `https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest` (fields include symbolCode, currentShortPositionQuantity, previousShortPositionQuantity). The CDN file the app uses, `https://cdn.finra.org/equity/regsho/daily/CNMSshvol20261112.txt`, also returned 200 (Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market). Source: [FINRA regShoDaily](https://api.finra.org/data/group/otcMarket/name/regShoDaily), [FINRA consolidatedShortInterest](https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest), [FINRA CDN file](https://cdn.finra.org/equity/regsho/daily/CNMSshvol20261112.txt)
- CFTC: Socrata endpoint `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=1` returned a COT record (WHEAT-SRW, CBOT) with no key (live probe). I did not confirm which COT report variant this dataset ID is. Source: [CFTC Socrata dataset](https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=1), [CFTC COT page](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)

#### Academic factor and valuation data
- Kenneth French Data Library and Damodaran's current data page both returned 200 (live probe). Both are static file downloads (CSV/zip, xls), not APIs. Source: [French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html), [Damodaran current data](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)

#### Attention and alternative data
- Google Trends: Google announced a Google Trends API alpha in July 2025 with limited, rolling access to selected developers; the web site's five-term comparison limit does not apply. Source: [Google Search Central blog](https://developers.google.com/search/blog/2025/07/trends-api), [Trends API alpha signup](https://developers.google.com/search/apis/trends). The popular unofficial library pytrends is archived on GitHub (last push 2024-08-10). Source: [GeneralMills/pytrends](https://github.com/GeneralMills/pytrends)
- Wikimedia pageviews: `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Nvidia/daily/20261001/20261003` returned 200 (5,277 views on 2026-10-01), no key (live probe). Wikimedia requires an identifying User-Agent. Source: [pageviews probe](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Nvidia/daily/20261001/20261003), [Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy)
- GDELT DOC 2.0: my probe got HTTP 429 with the message "Please limit requests to one every 5 seconds". Source: [GDELT DOC API](https://api.gdeltproject.org/api/v2/doc/doc?query=%22Constellation%20Energy%22&mode=artlist&maxrecords=2&format=json)
- Reddit: an unauthenticated `search.json` request returned 403 (live probe). Secondary sources say the free Data API is 100 queries/min per OAuth client ID, free only for approved non-commercial use, and that new clients need Reddit approval since November 11, 2025. I did not reach Reddit's own docs. Source: [data365 Reddit API pricing](https://data365.co/blog/reddit-api-pricing), [activepieces Reddit API 2026](https://www.activepieces.com/blog/reddit-api-access-in-2026-how-to-get-started)
- GitHub REST API answered without auth (live probe of `api.github.com/repos/meta-llama/llama-models`). GitHub documents 60 requests/hour unauthenticated and 5,000/hour with a token. Source: [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- App store: Apple's marketing RSS `https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/10/apps.json` returned 200 (live probe). It gives chart ranks, not download counts. Download estimates come from paid vendors (no free official source found). Source: [Apple top-free RSS](https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/10/apps.json)

#### Commercial market data
- Finnhub free: 60 API calls/minute (pricing page snippet). A per-second cap of 30 calls/s appears only on a competitor page (massive.com); unverified. Exceeding returns 429 per a third-party guide. Source: [Finnhub pricing](https://finnhub.io/pricing), [Massive vs Finnhub](https://massive.com/compare/massive-vs-finnhub)
- Alpha Vantage free: "25 API requests per day"; verified open-source or educational projects can get "unlimited API requests.". Source: [Alpha Vantage support](https://www.alphavantage.co/support/)
- Massive (formerly Polygon) free Stocks Basic: 5 API calls/minute, 2 years history, end-of-day data; current day requests return 403; over-limit returns 429. Paid: Stocks Advanced $199/month, Financials & Ratios $29/month, both "Individual use only.". Source: [Massive pricing](https://massive.com/pricing), [Massive KB: free plan timing](https://massive.com/knowledge-base/article/on-the-free-basic-plan-when-can-i-pull-the-previous-trading-days-data), [Massive KB: request limit](https://massive.com/knowledge-base/article/what-is-the-request-limit-for-massives-restful-apis)
- sec-api.io: Free $0 with 100 API calls total; Personal & Startups $49/month (covers "researchers at universities"); Business Internal Use $199/month; educational licenses discounted on request. Source: [sec-api.io pricing](https://sec-api.io/pricing)
- Financial Datasets: Credits $20 one-time for 1,000 requests; Personal $200/month (100,000 requests); Professional $1,000/month (1,000,000). No free tier listed. Source: [Financial Datasets pricing](https://www.financialdatasets.ai/pricing)
- Finviz Elite: $39.50/month or $299.50/year (a $149 first-year promo was showing); "Export to Excel, CSV" included in Elite, not in free. No API terms on that page. Source: [Finviz Elite](https://finviz.com/elite)
- Quartr: API is sales-led custom pricing, no self-serve; transcripts via `/public/v3/documents/transcripts` with an `x-api-key` header. Source: [Quartr API pricing](https://quartr.com/pricing/api), [Quartr transcripts docs](https://quartr.com/docs/api-reference/transcripts/retrieve-a-transcript)
- Earnings call transcripts on free tiers: Alpha Vantage exposes `EARNINGS_CALL_TRANSCRIPT` as a tool in its MCP server (so the free 25/day key may cover it, not verified). Source: [alpha_vantage_mcp README](https://github.com/alphavantage/alpha_vantage_mcp). API Ninjas lists a free plan (3,000 calls/month) but its transcript docs mark some transcript features as premium; sources conflict. Source: [API Ninjas transcript API](https://www.api-ninjas.com/api/earningscalltranscript)

#### Terms that restrict use
- Senate eFD search requires users to affirm "I understand the prohibitions on obtaining and use of financial disclosure reports," citing "5 U.S.C. app. § 105(c)". Source: [Senate eFD](https://efdsearch.senate.gov/search/home/)
- The statute (now 5 U.S.C. § 13107(c), formerly 5 U.S.C. App. 105) makes it unlawful to obtain or use a report "(A) for any unlawful purpose; (B) for any commercial purpose, other than by news and communications media for dissemination to the general public; (C) for determining or establishing the credit rating of any individual; or (D) for use, directly or indirectly, in the solicitation of money for any political, charitable, or other purpose." Civil penalty up to $10,000. Source: [5 U.S.C. § 13107 (Cornell LII)](https://www.law.cornell.edu/uscode/text/5/13107)
- Yahoo's API terms bar using Yahoo APIs to "derive income" without permission, bar selling or sublicensing access, and say APIs "may be subject to rate limits at Yahoo's absolute and sole discretion.". Source: [Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html). yfinance states it is "not affiliated, endorsed, or vetted by Yahoo," is "intended for research and educational purposes," and "the Yahoo! finance API is intended for personal use only.". Source: [yfinance README](https://github.com/ranaroussi/yfinance). The Node library yahoo-finance2 calls itself an "Unofficial API for Yahoo Finance.". Source: [yahoo-finance2](https://github.com/gadicc/yahoo-finance2)

### Inferences
- For a student fund that does not sell its output, the Senate/House disclosure restriction is mainly about not building a commercial product or solicitation on top of it. The fund already shows congressional trades. An agent tool over that data should be labeled internal research, and the app should not resell or monetize those pages. This is my reading of the statute, not legal advice; Pitzer counsel or a faculty adviser should confirm.
- Yahoo is the most fragile dependency: undocumented endpoints, personal-use framing, rate limits at Yahoo's discretion. Agent tools should call our own cached price layer (`lib/prices.js`) and not let the agent call Yahoo directly in loops. A free fallback for EOD prices is Massive Basic (5/min) or Alpha Vantage (25/day); neither can replace Yahoo for the whole book on its own without caching.
- Every SEC-backed tool should go through the existing `fetchWithLimit.js` with a shared token bucket under 10 req/s across all agents at once, since multiple agent runs could otherwise burst past it.
- Needed new keys if we add everything: FRED (have), BLS v2, BEA, Census, EIA, api.data.gov (FEC, and optionally openFDA), LDA (optional), GitHub token. All free. `.env.example` must list each one per the project CLAUDE.md.
- The LDA host change and PatentsView shutdown show that a source can move in a year. Each tool should return the upstream URL it called (as lzinga's MCP does with `meta.sources`) so stale endpoints are visible.

### Gaps
- FRED, Census, Federal Register, ClinicalTrials.gov, USAspending, Wikimedia and LDA numeric rate limits: not found in official pages I could read.
- BEA lockout duration: only a secondary source for the 100/100MB/30 numbers.
- FINRA TRACE (corporate bond trades) access: I did not verify which TRACE datasets the FINRA query API serves without credentials. My probe of a guessed treasury aggregates dataset name returned 404.
- Finnhub's per-second cap and paid prices: the pricing page did not render for WebFetch.
- Reddit official terms: secondary sources only.
- Google Trends API: no confirmation whether it left alpha by November 2026.
- Job postings: I found no free official API with firm-level job postings. Commercial vendors (LinkUp, etc.) exist; pricing not researched.

## Key question 2: Which existing MCP servers and libraries are credible to reuse, and which should we build ourselves in Node?

### Takeaway
The credible, maintained options are EdgarTools (MIT, 2,850 stars, pushed 2026-11-14 UTC, Python, local MCP plus hosted edgar.tools MCP), Alpha Vantage's official remote MCP (MIT), Massive's official MCP (MIT), Alpaca's MCP (paper trading, MIT, 1,082 stars), and OpenBB's `openbb-mcp-server` (OpenBB repo 75,400 stars). Several popular servers are AGPL-3.0 (sec-edgar-mcp, fred-mcp-server), which matters if we modify and host them. Financial Datasets' MCP is popular (2,326 stars) but last pushed 2025-06-05 and needs a paid key. Because PIF is Node/Express and already has working clients for SEC, FRED, Finnhub, Yahoo, FINRA and USAspending, the practical path is to expose our own `lib/` functions as agent tools in Node, and borrow tool designs (not code) from these servers. lzinga's `us-gov-open-data-mcp` (MIT, TypeScript, 300+ tools over 40+ government APIs) is the one Node-native server that could be imported directly for the government long tail.

### Cited Findings

| Project | License | Stars | Last push (UTC) | Lang / form | Cost of data | Source |
|---|---|---|---|---|---|---|
| dgunning/edgartools | MIT | 2,850 | 2026-11-14 | Python lib + local MCP (`edgartools-mcp` via `uvx --from edgartools[ai]`) + hosted MCP at app.edgar.tools/mcp | Free (SEC), hosted platform has free account tier | [repo](https://github.com/dgunning/edgartools) |
| stefanoamorelli/sec-edgar-mcp | AGPL-3.0 | 387 | 2026-11-01 | Python, Docker; needs `SEC_EDGAR_USER_AGENT` | Free (SEC) | [repo](https://github.com/stefanoamorelli/sec-edgar-mcp) |
| stefanoamorelli/fred-mcp-server | AGPL-3.0 | 132 | 2026-08-22 | TypeScript (pnpm); 3 tools | Free FRED key | [repo](https://github.com/stefanoamorelli/fred-mcp-server) |
| financial-datasets/mcp-server | MIT | 2,326 | 2025-06-05 | Python | Paid key (from $20 credits) | [repo](https://github.com/financial-datasets/mcp-server), [pricing](https://www.financialdatasets.ai/pricing) |
| alphavantage/alpha_vantage_mcp | MIT | 227 | 2026-10-03 | Remote `https://mcp.alphavantage.co/mcp` (OAuth) | Free 25 req/day | [repo](https://github.com/alphavantage/alpha_vantage_mcp), [support](https://www.alphavantage.co/support/) |
| massive-com/mcp_massive (was polygon-io/mcp_polygon, which redirects) | MIT | 402 | 2026-11-03 | Python | Free 5 calls/min EOD | [repo](https://github.com/massive-com/mcp_massive), [pricing](https://massive.com/pricing) |
| Alex2Yang97/yahoo-finance-mcp | MIT | 369 | 2026-09-19 | Python (yfinance) | Free, Yahoo terms | [repo](https://github.com/Alex2Yang97/yahoo-finance-mcp) |
| gadicc/yahoo-finance2 | MIT | 816 | 2026-11-11 | Node/TS lib, says it includes "CLI, MCP and Agent Skill" | Free, Yahoo terms | [repo](https://github.com/gadicc/yahoo-finance2) |
| wshobson/maverick-mcp | MIT | 727 | 2026-11-13 | Python | mixed | [repo](https://github.com/wshobson/maverick-mcp) |
| OpenBB (Open Data Platform) | README says Apache 2.0; GitHub API reports "Other" | 75,400 | 2026-11-14 | Python; `openbb-mcp-server` on PyPI | Free platform; providers may need keys | [repo](https://github.com/OpenBB-finance/OpenBB), [openbb-mcp-server](https://pypi.org/project/openbb-mcp-server/), [docs](https://docs.openbb.co/python/extensions/interface/openbb-mcp) |
| OpenBB-finance/agents-for-openbb | MIT | 413 | 2026-07-01 | archived | n/a | [repo](https://github.com/OpenBB-finance/agents-for-openbb) |
| SEC-API-io/sec-api-python | MIT (SDK) | 324 | 2026-04-13 | Python SDK for paid sec-api.io | 100 free calls, then $49+/mo | [repo](https://github.com/SEC-API-io/sec-api-python), [pricing](https://sec-api.io/pricing) |
| lzinga/us-gov-open-data-mcp | MIT | 112 | 2026-11-02 | TypeScript MCP + SDK, 300+ tools, 40+ APIs | Free keys | [repo](https://github.com/lzinga/us-gov-open-data-mcp) |
| cyanheads/clinicaltrialsgov-mcp-server | Apache-2.0 | 101 | 2026-11-13 | TypeScript | Free | [repo](https://github.com/cyanheads/clinicaltrialsgov-mcp-server) |
| imbenrabi/Financial-Modeling-Prep-MCP-Server | Apache-2.0 | 149 | 2026-11-05 | | FMP key | [repo](https://github.com/imbenrabi/Financial-Modeling-Prep-MCP-Server) |
| alpacahq/alpaca-mcp-server | MIT | 1,082 | 2026-11-13 | Python; paper and live trading | Free paper account | [repo](https://github.com/alpacahq/alpaca-mcp-server) |
| Finnhub MCPs (cfdude/mcp-finnhub 11 stars, SalZaki/finnhub-mcp 7) | MIT | ≤11 | 2026-11 | community | Finnhub key | [GitHub search](https://github.com/search?q=finnhub+mcp&type=repositories) |
| ranaroussi/yfinance | Apache-2.0 | 25,915 | 2026-11-12 | Python lib | Free, Yahoo terms | [repo](https://github.com/ranaroussi/yfinance) |

- EdgarTools: "There is no key, signup or rate-limit tier"; it keeps to SEC's 10 req/s; covers full-text search, live filing feed, XBRL financials, Form 3/4/5, 13F, N-PORT, 8-K, Schedule 13D/G. EdgarTools 6.0 needs Python 3.11+. Its README warns to attach either the local or hosted MCP, not both, because "they overlap and split your assistant's routing.". Source: [edgartools README](https://github.com/dgunning/edgartools), [13D/G guide](https://edgartools.readthedocs.io/en/latest/guides/schedule13dg-data-object-guide/)
- sec-edgar-mcp tools: CIK lookup, company info, company facts; 10-K/10-Q/8-K retrieval and section extraction; XBRL balance sheet, income statement, cash flow; Form 3/4/5. "All responses include SEC filing URLs for verification." HTTP transport has "No authentication." It ships a Promptfoo eval suite. Source: [sec-edgar-mcp README](https://github.com/stefanoamorelli/sec-edgar-mcp)
- fred-mcp-server tools: `fred_browse`, `fred_search`, `fred_get_series` (with transformations and date ranges). Source: [fred-mcp-server README](https://github.com/stefanoamorelli/fred-mcp-server)
- Financial Datasets MCP tools: get_income_statements, get_balance_sheets, get_cash_flow_statements, get_current_stock_price, get_historical_stock_prices, get_company_news, plus crypto tools. Source: [financial-datasets/mcp-server README](https://github.com/financial-datasets/mcp-server)
- Alpha Vantage MCP exposes API functions directly as tools, grouped: alpha_intelligence (`NEWS_SENTIMENT`, `EARNINGS_CALL_TRANSCRIPT`, `TOP_GAINERS_LOSERS`, `INSIDER_TRANSACTIONS`, `INSTITUTIONAL_HOLDINGS`, analytics windows), fundamental_data (`COMPANY_OVERVIEW`, `INCOME_STATEMENT`, `BALANCE_SHEET`, `CASH_FLOW`, `EARNINGS`, `EARNINGS_CALENDAR`, `IPO_CALENDAR` and more), technical_indicators (SMA, EMA, RSI, MACD, BBANDS, ATR, OBV and dozens more). The API-key-in-URL connection is marked deprecated in favor of OAuth. Source: [alpha_vantage_mcp README](https://github.com/alphavantage/alpha_vantage_mcp)
- Massive MCP uses three composable tools (`search_endpoints`, `call_api`, `query_data`) instead of one tool per endpoint, indexes endpoints at startup from `llms.txt`, and can store results in in-memory SQLite. `POLYGON_API_KEY` is a deprecated alias. Source: [mcp_massive README](https://github.com/massive-com/mcp_massive)
- Yahoo Finance MCP tools: get_historical_stock_prices, get_stock_info, get_yahoo_finance_news, get_stock_actions, get_financial_statement, get_holder_info, get_option_expiration_dates, get_option_chain, get_recommendations. Source: [yahoo-finance-mcp README](https://github.com/Alex2Yang97/yahoo-finance-mcp)
- OpenBB: ODP exposes data to "Python environments for quants, OpenBB Workspace and Excel for analysts, MCP servers for AI agents, and REST APIs." `openbb-mcp-server` serves FastAPI routes as MCP tools via FastMCP; default transport streamable-http at `http://127.0.0.1:8001/mcp`; optional tool-discovery mode (`available_categories`, `available_tools`, `search_tools`, `call_tool`). PyPI and docs disagree on whether discovery is on by default. Source: [OpenBB README](https://github.com/OpenBB-finance/OpenBB), [openbb-mcp-server PyPI](https://pypi.org/project/openbb-mcp-server/), [OpenBB MCP docs](https://docs.openbb.co/python/extensions/interface/openbb-mcp)
- Oddity: `gh api repos/OpenBB-finance/OpenBB` resolved to `openbq-org/OpenBB` (html_url `https://github.com/openbq-org/OpenBB`) on 2026-11-13, while the README still links `OpenBB-finance`. I could not find an explanation. Source: [GitHub API result for OpenBB-finance/OpenBB](https://api.github.com/repos/OpenBB-finance/OpenBB)
- lzinga/us-gov-open-data-mcp: "300+ tools covering economic, fiscal, health, education, energy, environment, lobbying, housing, patents, safety, banking ... clinical trials, pharma payments ... procurement"; "20+ APIs require no key"; "Discovery mode ... lists 4 tools instead of 350"; "Sources on every result"; "every API is importable as a standalone typed client, no MCP required." It also warns AI was used to scaffold it and "some endpoints may return unexpected results.". Source: [us-gov-open-data-mcp README](https://github.com/lzinga/us-gov-open-data-mcp)

### Inferences
- Build in Node, reuse designs. The app's agent (OpenAI function calling today) can call plain JS functions; standing up Python MCP servers next to an Express app on Render adds a second runtime and process for data we already fetch. Exceptions worth considering: (1) EdgarTools for parsing-heavy filings we do not parse yet (13D/G XML, N-PORT, proxy sections), run as an offline job that writes to SQLite, not as a live agent dependency; (2) lzinga's TypeScript SDK for government long-tail sources (Census, BEA, EIA, LDA, openFDA), imported as a library, after spot-checking each endpoint given its own AI-scaffolding warning.
- Avoid AGPL code inside the app. sec-edgar-mcp and fred-mcp-server are AGPL-3.0; copying their code into a network-served app can trigger source-sharing duties. Reading their tool lists for ideas is fine.
- Tool count design: Massive and lzinga both moved to a small "search tools, then call" surface (3 to 4 tools) because hundreds of tools overwhelm models. PIF should do the same once the catalog passes about 30 tools: a `find_tool(query)` plus `call_tool(name, args)`, or route by agent role (macro agent gets FRED/BLS/Treasury tools; filings agent gets SEC tools).
- Every tool should return `source_url` and `as_of` fields, copying sec-edgar-mcp's "filing URLs for verification" and lzinga's `meta.sources`. This lets the UI show citations and lets students check numbers.
- Alpaca's MCP is the credible option if paper trading ever moves from our own simulator to a broker paper account. Keep it paper-only.
- Paid MCPs (Financial Datasets, sec-api.io, Massive paid) add little over free SEC data for a fund this size. sec-api.io's $49 tier is the best value if we need parsed exec comp or 13D/G history without building parsers.

### Gaps
- Download counts, issue response times and test coverage were not checked; stars and last push are weak maturity signals.
- I did not run any of these MCP servers.
- EdgarTools' exact MCP tool names were not in the README; the MCP setup guide was not fetched.
- The OpenBB org redirect is unexplained.

## Key question 3: Agent tool catalog by source (name, inputs, outputs, purpose, how it helps PIF)

### Takeaway
About 95 tools across 30 sources. The highest-value new tools for the current book are: XBRL frames peer ranking (all holdings), Pay vs Performance frames (governance screens), 8-K item tracking from submissions (already in the JSON), FRED/ALFRED vintages (honest backtests of macro signals), Treasury curve, EIA power and fuel data (CEG, XOM, TALO), openFDA adverse events and drug shortages (HIMS GLP-1 compounding risk), LDA lobbying and FEC (PLTR, ORCL, HOOD, SOFI, APO), FINRA consolidated short interest (already free via API), Wikipedia pageviews (free attention proxy), and CFTC COT for oil, gas and cocoa (XOM, TALO, HSY).

### Cited Findings
Endpoints used in the catalog are those cited in Key question 1. Additional facts:
- FINRA's consolidated short interest is exposed at `api.finra.org/data/group/otcMarket/name/consolidatedShortInterest` (live probe). Source: [FINRA consolidatedShortInterest](https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest)
- FRED series referenced below exist at these pages: 10-year Treasury (DGS10), 10Y minus 2Y spread (T10Y2Y), ICE BofA US High Yield OAS (BAMLH0A0HYM2). Source: [DGS10](https://fred.stlouisfed.org/series/DGS10), [T10Y2Y](https://fred.stlouisfed.org/series/T10Y2Y), [BAMLH0A0HYM2](https://fred.stlouisfed.org/series/BAMLH0A0HYM2)
- EIA RTO (hourly grid operator) data route: `https://api.eia.gov/v2/electricity/rto`. Source: [EIA API documentation](https://www.eia.gov/opendata/documentation.php)

### Inferences
The catalog below is my design, built on the verified endpoints. "EXISTING" means the app already calls that source. Tool names use snake_case verbs so they work with OpenAI or Anthropic function calling. Every tool should return `{data, source_url, as_of, cached}`.

#### A. SEC EDGAR (EXISTING source; no key; 10 req/s, User-Agent)
| Tool | Inputs | Outputs | Purpose | How it helps PIF |
|---|---|---|---|---|
| `resolve_company` | ticker or name | CIK, name, exchange, SIC | `company_tickers_exchange.json` lookup | Every other SEC tool needs a CIK |
| `get_filing_history` | ticker, forms[], since | list of accession, form, filingDate, items, primaryDocument URL | submissions JSON | "What did HOOD file since our last meeting?" |
| `get_8k_events` | tickers[], items[] (e.g. 1.01, 2.02, 5.02, 8.01), since | 8-K list with decoded item names | filter submissions `items` field (verified present) | Flags CEO changes (5.02), material agreements (1.01), earnings (2.02) across holdings without reading text |
| `get_financial_concept` | ticker, concept, taxonomy=us-gaap, unit | time series of values with fy, fp, form, filed, accn | companyconcept | Point-in-time fundamentals: the `filed` date shows when the number was public |
| `get_company_facts_summary` | ticker, concepts[] | latest annual and quarterly values | companyfacts (EXISTING in `fundamentals.js`) | Quick fundamentals card for pitches |
| `get_xbrl_frame` | concept, unit, period (CY2025, CY2025Q3, CY2025Q3I), filter cik list or SIC | one value per filer, ranked | frames API | Cross-sectional peer ranking: where does STRL's revenue growth or WM's capex rank among all filers |
| `rank_peers` | ticker, concept(s), period, peer set (SIC or manual) | percentile, rank, peer table | wraps several frames calls | One-shot "how does COST's margin compare" for a pitch deck |
| `get_pay_vs_performance` | ticker or SIC, year | PEO total comp, compensation actually paid, TSR, peer TSR, company-selected measure | companyfacts `ecd` concepts, frames `ecd/PeoActuallyPaidCompAmt` | Governance check: pay out of line with TSR; ranks holdings on pay-for-performance |
| `search_filings_fulltext` | query, forms[], startdt, enddt, ciks[] | hits with form, filer, date, snippet, URL | `efts.sec.gov/LATEST/search-index` (EXISTING) | Theme research ("data center", "GLP-1 compounding", "tariff") across all filers |
| `get_latest_filings_feed` | form type, count | newest filings (Atom) | `cgi-bin/browse-edgar?action=getcurrent&output=atom` | Intraday alerting for holdings and watchlist |
| `get_form_index` | date or quarter, form | rows from daily-index / full-index | `/Archives/edgar/daily-index`, `full-index/.../form.idx` | Backfill and gap check after downtime |
| `get_insider_trades` | ticker, since, codes (P, S, A, M) | Form 4 rows: insider, role, code, shares, price, 10b5-1 flag | Form 4 XML, or quarterly Insider Transactions data sets for history | Already a signal (`insiderSignals.js`); data sets allow history without per-filing fetches |
| `get_13f_holders` / `get_13f_changes` | ticker or filer CIK, quarter | holders, shares, value, QoQ change | Form 13F data sets and live feed (EXISTING `thirteenF*.js`) | Crowding and smart-money context |
| `get_beneficial_owners` | ticker, since | 13D/13G filers, percent owned, purpose (13D Item 4) | Schedule 13D/G XML (`primary_doc.xml`) for new-format filings | Activist alerts (EXISTING `activistFilings.js` could switch to XML parsing) |
| `get_form144_notices` | ticker, since | planned insider sales: seller, shares, approx. value, broker | Form 144 filings (XML spec exists) | Early warning of insider selling before the Form 4 |
| `get_fund_holdings_nport` | fund CIK or ETF ticker, period | holdings with weights | Form N-PORT data sets or filings | Look through our ETFs; who owns our names among mutual funds |
| `get_statement_notes_dataset` | quarter, adsh, tags | raw tag values from the notes | Financial Statement and Notes data sets | Off-face items (lease commitments, segment data) for deeper models |
| `get_proxy_section` | ticker, year, section (summary comp table, related party) | text excerpt + URL | DEF 14A text via existing `filingText.js` | Student governance write-ups |
| `diff_filing_sections` | ticker, form, section (risk factors, MD&A) | added and removed sentences | EXISTING `filingDiff.js` | "What changed in META's risk factors" |

#### B. FRED / ALFRED (EXISTING; free key; about 120/min reported)
| Tool | Inputs | Outputs | Purpose | How it helps PIF |
|---|---|---|---|---|
| `get_fred_series` | series_id, start, end, units/transform | observations | `series/observations` | Macro dashboard (DGS10, T10Y2Y, HY OAS) |
| `get_fred_vintage` | series_id, as_of_date | the series as it was known on that date | `series/observations` with `realtime_start`/`realtime_end` | Point-in-time macro so backtests do not use revised data |
| `list_fred_vintage_dates` | series_id | dates the series was revised or released | `series/vintagedates` | Show how much a print got revised (payrolls, GDP) |
| `search_fred` | text, tags | series ids and titles | series search | Lets the agent find a series instead of guessing ids |
| `get_macro_regime` | none | curve slope, HY spread, inflation trend, labels | composite over FRED | One-line macro context for every pitch |

#### C. Federal Reserve (EXISTING)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_fomc_calendar` | year | meeting dates, SEP flags | Fed calendar JSON (EXISTING `fed.js`) | Event risk for rate-sensitive names (SOFI, APO, utilities) |
| `get_fed_press_releases` | since, type | releases with links | `feeds/press_all.xml` | Statement and minutes alerts |
| `summarize_fed_statement_change` | meeting date | sentence-level diff vs prior statement | press release text | Teaching tool for the macro analyst |

#### D. Treasury (NEW; no key)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_yield_curve` | date or range | par yields 1 Mo to 30 Yr | daily treasury rates CSV | Discount-rate input for DCFs; curve chart |
| `get_curve_change` | date1, date2 | bp change by tenor | same | Explains moves in long-duration tech and utilities |
| `get_fiscal_data` | dataset (debt_to_penny, etc.), filters | rows | fiscaldata API | Macro context; debt and auction topics for meetings |

#### E. BLS (NEW; free key for v2; 500 queries/day)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_bls_series` | series_ids[] (≤50), start_year, end_year | monthly values | `publicAPI/v2/timeseries/data` | CPI, payrolls, wages |
| `get_cpi_components` | components (food at home, apparel, etc.) | YoY by component | CPI series ids | Pricing power check for HSY, COST, WMT, TJX |
| `get_release_surprise` | series, date | actual vs prior and vs consensus (if we store consensus) | BLS plus our notes | Explains release-day moves |

#### F. BEA (NEW; free UserID)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_bea_table` | dataset (NIPA), table, frequency, years | table rows | BEA API | GDP, personal consumption for consumer names |
| `get_pce_breakdown` | category | real and nominal PCE | NIPA tables | Spending trends behind COST, WMT, CELH |

#### G. Census (NEW; key required)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_retail_sales` | category (NAICS), months | monthly retail sales | `timeseries/eits/marts` | Warehouse clubs, general merchandise, food and beverage stores for COST, WMT, TJX |
| `get_construction_spending` | category | monthly value put in place | Census EITS | Demand backdrop for STRL |
| `get_economic_indicator` | indicator code | time series | EITS family | Generic access for the macro agent |

#### H. EIA (NEW; free key; 5,000 rows/request)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_grid_demand` | respondent (RTO, e.g. PJM), start, end | hourly demand and generation by fuel | `v2/electricity/rto` | Data-center load and nuclear demand context for CEG |
| `get_power_prices` | region, period | retail or wholesale prices | EIA electricity routes | Margin context for CEG |
| `get_oil_gas_prices` | product, period | spot prices | EIA petroleum and natural gas routes (route names to confirm via `api.eia.gov/v2/` discovery) | XOM, TALO revenue drivers |
| `get_inventories` | product (crude, gas), weeks | weekly stocks | EIA weekly data | Oil and gas supply signal |

#### I. USAspending (EXISTING; no key)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_federal_awards` | recipient name or UEI, since, award type | awards, amounts, agencies | USAspending search (EXISTING `govContracts.js`) | PLTR, ORCL, STRL, WM government revenue |
| `get_award_trend` | recipient, fiscal years | obligations by year and agency | spending_by_award / over_time | Is government revenue growing for PLTR |
| `get_agency_budget_context` | agency | toptier budget, obligations | `references/toptier_agencies` | Exposure to budget cuts or growth |

#### J. Senate LDA lobbying (NEW; host is now lda.gov)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_lobbying` | client name, years | filings, amounts, issues, agencies lobbied | `lda.gov/api/v1/filings/?client_name=` | Policy exposure for ORCL, META, GOOG, HOOD, SOFI, APO |
| `get_lobbying_issues` | client, year | issue codes and text | filings + `constants/filing/lobbyingactivityissues` | Shows what rules a company is fighting |
| `get_lobbying_contributions` | registrant or lobbyist | contributions (LD-203) | `/contributions/` | Political ties context |

#### K. FEC (NEW; api.data.gov key; 1,000/hr)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_pac_activity` | company PAC name or committee id, cycle | receipts, disbursements, recipients | OpenFEC committees, schedule_b | Political spending for governance write-ups |
| `get_employee_donations` | employer, cycle | itemized contributions totals by party | schedule_a by employer | Context only; not a trading signal |

#### L. Congressional trading disclosures (EXISTING; use restriction)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_congress_trades` | ticker or member, since | trades with ranges and disclosure lag | House Clerk, Senate eFD (EXISTING) | Already a feature; label as internal research per 5 U.S.C. § 13107(c) |
| `get_member_committee_overlap` | ticker | members trading the stock who sit on relevant committees | our data plus committee lists | Teaching tool on conflicts; same restriction applies |

#### M. openFDA (NEW; key optional)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_adverse_events` | drug generic name, since | counts by reaction, seriousness | `drug/event.json` | Safety-signal tracking for GLP-1s relevant to HIMS |
| `get_drug_shortages` | drug | shortage status | openFDA drug shortages endpoint (not probed) | Compounding of semaglutide depends on shortage status; core HIMS risk |
| `get_fda_enforcement` | firm or product | recalls, warning letters (enforcement) | `drug/enforcement.json` (not probed) | Regulatory risk for HIMS and suppliers |
| `get_food_recalls` | firm | recalls | `food/enforcement.json` (not probed) | HSY, CELH product risk |

#### N. ClinicalTrials.gov (NEW; no key)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_clinical_trials` | sponsor or condition, status | studies, phase, completion dates | `api/v2/studies?query.spons=&filter.overallStatus=` | Pipeline catalysts for any future health holding; competitor trials (Novo, Lilly) for HIMS |
| `get_trial_readout_calendar` | sponsors[] | primary completion dates in next N months | same | Catalyst calendar |

#### O. Federal Register (NEW; no key)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `search_federal_register` | term, agencies[], type (RULE, PRORULE, NOTICE), since | documents, comment deadlines, links | `api/v1/documents.json` | Rules affecting holdings (EPA for WM, FERC/NRC for CEG, SEC/CFPB for HOOD, SOFI) |
| `get_public_inspection` | agency | documents before publication | public-inspection-documents endpoint (not probed) | Day-ahead regulatory heads-up |

#### P. USPTO patents (NEW; PatentsView retired, use USPTO Open Data Portal)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_patent_grants` | assignee, since | grants by CPC class | USPTO ODP (endpoint to confirm) | Innovation intensity for NVDA, GOOG, META, ORCL |
| `get_patent_trend` | assignee, years | grants per year vs peers | same | Pairs with the KPSS literature in Key question 4 |

#### Q. FINRA (EXISTING CDN file; query API is NEW and keyless for these datasets)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_short_volume` | ticker, days | daily short volume ratio | CDN files (EXISTING `finra.js`) or `regShoDaily` | Existing short-pressure feature |
| `get_short_interest` | ticker, periods | short position, change, days to cover | `consolidatedShortInterest` | Better than daily short volume for crowding (HOOD, SOFI, CELH, HIMS) |
| `get_bond_trades` | issuer, since | TRACE prints | FINRA TRACE (access not verified) | Credit stress read for APO, MCO clients |

#### R. CFTC Commitments of Traders (NEW; no key)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_cot_positioning` | market (crude, natural gas, cocoa, Treasuries), weeks | net positions by trader type | Socrata `publicreporting.cftc.gov` | Positioning for XOM, TALO (energy), HSY (cocoa) |
| `get_cot_extremes` | market | percentile of current net position vs 3 years | same | Contrarian context |

#### S. Factor and valuation libraries (NEW; static files)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_ff_factors` | model (3, 5, momentum), frequency | factor returns | French library CSVs | Factor attribution of PIF returns (EXISTING `factors.js` could use it) |
| `get_industry_portfolios` | count (12, 49), frequency | industry returns | French library | Sector benchmark |
| `get_damodaran_industry` | industry, metric (beta, margin, WACC, multiples) | values | Damodaran datasets | Sanity-check DCF inputs in student pitches |

#### T. Attention and alternative data (NEW)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_wikipedia_pageviews` | article title, start, end | daily views | Wikimedia pageviews API | Free attention proxy for every holding |
| `get_attention_spike` | ticker | z-score of views vs 90-day baseline | same | Flags unusual attention before earnings |
| `get_google_trends` | terms, region, range | interest index | Trends API alpha (if access granted) | Consumer demand proxy for CELH, HIMS, HOOD |
| `get_news_volume` | query, timespan | article count, tone | GDELT DOC 2.0 (one request per 5 s) | News-flow context beyond Finnhub |
| `get_reddit_mentions` | ticker, subreddits | mention counts | Reddit Data API (approval needed) | Retail attention for HOOD, SOFI, PLTR, HIMS |
| `get_github_activity` | org or repo | stars, commits, contributors over time | GitHub REST | Developer traction for NVDA (CUDA libs), META (Llama), GOOG |
| `get_app_rank` | app id or company | daily chart rank | Apple marketing RSS | HOOD, SOFI, HIMS app rank trend (rank only, not downloads) |
| `get_job_postings_trend` | company | posting counts | no free official source found | Placeholder; needs a vendor |

#### U. Commercial market data (EXISTING Yahoo and Finnhub)
| Tool | Inputs | Outputs | Purpose | How it helps |
|---|---|---|---|---|
| `get_price_history` | ticker, range, interval | OHLCV | Yahoo chart via `prices.js` cache | Core |
| `get_quote_summary` | ticker, modules | profile, estimates, holders | Yahoo quoteSummary (EXISTING) | Core |
| `get_company_news` | ticker, since | headlines | Finnhub company-news (EXISTING) | News triage |
| `get_earnings_calendar` | from, to, tickers | dates, EPS estimates | Finnhub (EXISTING) | Event calendar |
| `get_basic_metrics` | ticker | valuation and margin metrics | Finnhub metric (EXISTING) | Quick screens |
| `get_earnings_transcript` | ticker, quarter | transcript text | Alpha Vantage `EARNINGS_CALL_TRANSCRIPT` (25/day free) or paid Quartr | Q&A summaries for each holding after earnings |
| `get_screener_export` | Finviz screen URL | CSV rows | Finviz Elite export ($39.50/mo) | Idea generation, only if the fund pays |

#### V. Internal PIF tools (not external sources, but agents need them)
| Tool | Inputs | Outputs | Purpose |
|---|---|---|---|
| `get_portfolio` | none | holdings, weights, cost, cash | Ground every answer in the real book (`portfolio.js`) |
| `get_position_risk` | ticker | beta, volatility, drawdown, factor loadings | `analytics.js`, `factors.js` |
| `get_red_flags` | ticker | existing red-flag checks | `redFlags.js` |
| `get_meeting_brief` | date | brief draft | `meetingBrief.js` |
| `paper_trade` | ticker, side, qty | simulated fill | `paperTrading.js`; keep simulation only |

- Holdings coverage check: tech (NVDA, ORCL, PLTR, META, GOOG) gets frames ranking, 8-K events, USAspending, LDA, patents, GitHub, EIA grid demand; consumer (COST, WMT, HSY, TJX, CELH) gets Census retail, BLS CPI components, CFTC cocoa, Trends, openFDA food recalls; HIMS gets openFDA adverse events, shortages and enforcement, ClinicalTrials (competitors), app rank, Reddit; energy and utilities (CEG, XOM, TALO) get EIA, CFTC, Federal Register, Treasury curve; industrials (STRL, WM) get Census construction, USAspending, Federal Register (EPA); financials (APO, HOOD, SOFI, MCO) get FRED spreads, FINRA short interest and TRACE, LDA, Fed calendar, app rank.

### Gaps
- openFDA drug shortages and enforcement, Federal Register public inspection, Census construction and BEA endpoints were not live-probed; their exact paths need checking before build.
- EIA petroleum and natural gas route names were not confirmed.
- USPTO ODP patent search endpoint and key process are unverified after the PatentsView shutdown.
- No free firm-level job postings source found.

## Key question 4: What evidence shows alternative data (Google Trends, Wikipedia views, job postings, patents, app downloads) has value for returns?

### Takeaway
Each alt-data family on the list has peer-reviewed or working-paper evidence, but the effects are mostly short-horizon, often decay after publication, and some were measured on small samples. For a student fund, these work best as context and red-flag inputs, not standalone trade signals.

### Cited Findings
- Google search (SVI): Da, Engelberg and Gao, "In Search of Attention," Journal of Finance 66(5), 2011, pp. 1461 to 1499. They use Google Search Volume Index as a direct measure of investor attention on Russell 3000 stocks (2004 to 2008), find it is related to but different from older attention proxies, and argue it captures retail attention; they apply it to IPO returns and momentum. Source: [EconPapers record](https://econpapers.repec.org/RePEc:bla:jfinan:v:66:y:2011:i:5:p:1461-1499), [authors' working paper](https://rady.ucsd.edu/faculty/directory/engelberg/pub/portfolios/GOOGLE.pdf). I did not read the published abstract, so the commonly cited "higher prices in the next two weeks, then reversal" result is not verified here.
- Wikipedia: Moat et al., "Quantifying Wikipedia Usage Patterns Before Stock Market Moves," Scientific Reports 3, 1801 (2013). Using page views of the 30 DJIA company pages (December 2007 to April 2012), a page-view strategy reportedly returned up to 141% (up to 297% using 285 financial topic pages) vs 3% buy and hold; edit activity showed no similar link. Source: [ADS abstract](https://ui.adsabs.harvard.edu/abs/2013NatSR...3E1801M/abstract), [Warwick repository](https://wrap.warwick.ac.uk/54525/)
- Job postings: Gutierrez, Lourie, Nekrasov and Shevlin, "Are Online Job Postings Informative to Investors?" (Management Science). Changes in postings are positively associated with one-year-ahead employee growth, SG&A, sales and earnings growth; a secondary summary reports a positive two-day return reaction. Source: [LinkUp research summary](https://www.linkup.com/insights/research/are-online-job-postings-informative-to-investors). Vendor-reported long/short results (information ratio 1.1, 2.9% annualized) are self-reported. Source: [LinkUp x RavenPack](https://www.linkup.com/partners/ravenpack)
- Patents: Kogan, Papanikolaou, Seru and Stoffman build a patent value measure from stock returns around grant dates for US patents 1926 to 2010; the market reaction strongly predicts future citations. Later work points out bias in the method and cross-country distortions. Source: [NBER w17769](https://www.nber.org/system/files/working_papers/w17769/w17769.pdf), [NBER w33056 (extension)](https://www.nber.org/system/files/working_papers/w33056/w33056.pdf)
- App downloads: Chen, Liu and Wu (working paper) use downloads of apps owned by 831 US public firms (2012 to 2023); downloads predict next-quarter earnings, analyst forecast errors and returns; a long-short on abnormal downloads earns about 12% annualized equal-weighted and 9% value-weighted; app disclosure in filings weakens the effect. Source: [AEA 2025 program](https://www.aeaweb.org/conference/2025/program/paper/tsKtGb3z), [McCombs news](https://news.mccombs.utexas.edu/news/understanding-the-value-of-mobile-apps/). Yuan and Chen (ICIS 2019, 326 firms, July 2015 to December 2017) find abnormal downloads and daily users positively associated with next-month abnormal returns. Source: [AIS eLibrary](https://aisel.aisnet.org/icis2019/data_science/data_science/18/)

### Inferences
- The free proxies PIF can get (Wikipedia pageviews, Apple chart ranks, GitHub activity) are weaker than the data in these papers (Google SVI, vendor download estimates, LinkUp postings). Agent tools should describe them as attention or traction context.
- The Chen, Liu and Wu finding that disclosure weakens predictability suggests alt data helps most where companies disclose little (for example HIMS subscriber or app metrics between earnings).
- PIF's backtest module could test pageview spikes on its own holdings, but with 20 to 25 names the sample is too small for strong conclusions.

### Gaps
- No primary-source check of Preis, Moat and Stanley (2013) Google Trends trading paper or of later replications showing decay.
- Published (not working paper) versions of Kogan et al. (QJE 2017) and the app-download paper were not opened.
- No study found on GitHub activity and returns, or on Reddit mentions beyond media coverage; not searched in depth.
