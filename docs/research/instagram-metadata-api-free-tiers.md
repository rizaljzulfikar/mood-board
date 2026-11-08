# Instagram post metadata on free API tiers

**Question:** which third-party API can return an Instagram post's thumbnail URL, caption and author for a self‑hosted mood board, on a tier that is actually free?

**Method:** every claim below was fetched from the provider's own pricing or docs page on **2026‑11‑08**. No blog posts, no aggregator comparisons. Where a page was silent, gated behind signup, or contradicted itself, that is stated instead of guessed.

**Baseline (excluded by request):** Meta's own Graph API / oEmbed would be the "correct" source but needs an approved Meta app and app review, so it is out of scope here.

---

## 1. TL;DR

**Top pick: Apify — `apify/instagram-post-scraper`**
Free plan is $0 with **$5 of usage credit every month**, no credit card. That actor costs **$2.70 per 1,000 results on the Free plan**, which the actor docs themselves translate as *"you can get nearly 2,000 results for free"* — one result = one post. Its documented output includes `displayUrl` (the image), `caption`, `ownerUsername` and `ownerFullName`, i.e. exactly the three fields needed. Recurring ~1,850 imports/month for $0, forever, without a card.
Sources: https://apify.com/pricing · https://apify.com/apify/instagram-post-scraper.md

**Runner‑up: SearchAPI.io — `engine=instagram_post`**
**100 free requests** on signup, **"No credit card required"**. A single synchronous `GET /api/v1/search?engine=instagram_post&post_id=<shortcode>` returns `post.link` (full image URL), `post.thumbnail`, `post.caption`, `post.user.username`. Much simpler to call from a Next.js route than Apify's async run+dataset flow, but the 100 requests are **one‑time**, not monthly, so it is a pilot/burst budget rather than a permanent free tier.
Sources: https://www.searchapi.io/pricing · https://www.searchapi.io/docs/instagram-post-api

**Why not Bright Data, despite the biggest headline number:** it genuinely offers **5,000 free records/month** with no card, and its Instagram triggers accept post URLs — but the sample payload printed on its own Instagram Posts page does **not** contain a media/photo URL, only `url`, `user_posted`, `description`, `hashtags`, `num_comments`, `date_posted`, `likes`. The field list mentions "Photos", so it probably works, but it is not demonstrated on the page. Best free volume, unproven for this exact field — test with one record before committing.

---

## 2. Comparison table

| Provider | Free tier (credits/month) | Credit card? | IG post endpoint workable on free tier? | Paid pricing | Source URL |
| --- | --- | --- | --- | --- | --- |
| **Apify** (`apify/instagram-post-scraper`) | **$5 usage credit / month** ≈ **~1,850 post results** at $2.70/1K; renews monthly, unused credit expires | **No** — "No credit card is required" | **Yes** — output documents `displayUrl`, `caption`, `ownerUsername`; post-URL input | Starter $19/mo ($19 usage) → $2.30/1K results; Scale $199; Business $999 | https://apify.com/pricing ; https://apify.com/apify/instagram-post-scraper.md |
| **SearchAPI.io** (`engine=instagram_post`) | **100 requests, one‑time** on signup | **No** — "No credit card required" | **Yes** — docs show `post.link`, `post.thumbnail`, `post.caption`, `post.user.username` for a shortcode | $40/mo for 10,000 searches ($4/1K) down to $1.5/1K at volume | https://www.searchapi.io/pricing ; https://www.searchapi.io/docs/instagram-post-api |
| **Bright Data** (Instagram Posts / Image scrapers) | **5,000 records/month**, renews on the 1st | **No** — "Credit card not required" | **Probably** — post URLs accepted; field list says "Photos" but sample payload shows no image URL | PAYG **$1.5/1K records**; Scale $499/mo (384K records) | https://brightdata.com/pricing/web-scraper ; https://brightdata.com/products/web-scraper/instagram/posts |
| **Captapi** (`/v1/instagram/details`) | **100 lifetime credits** (one‑time), all 180 endpoints included | **No** — "No credit card required" | **Yes** — 1 credit/request; returns `thumbnailUrl`, `caption`, `author.username`; `cache=true` hits cost 0 | Starter $9/mo (2,000 credits) → $4.50/1K; Pro $27/6,000; Business $90/20,000 | https://captapi.com/pricing ; https://captapi.com/apis/instagram-details |
| **Bridgly** (`POST /instagram/post`) | **100 credits, one‑time** (business email required) | **No** — "No credit card required" | **Partly** — 1 credit/request, returns `display_url`, `caption`; example response has **no username/author field** | PAYG $2.00/1K credits; Growth $50/30K; Scale $300/300K | https://bridgly.app ; https://bridgly.app/platforms/instagram/post |
| **opendata-api.com** (Instagram post-detail) | **100 "starter credits"** on signup | Not stated on page | Documented (`image_versions2`), but **per-request price literally "temporarily unavailable. No price is assumed."** | Credit packages; per-endpoint cost not published | https://opendata-api.com ; https://opendata-api.com/en/instagram/post-detail.html |
| **Fetchcat** | **None of its own** — `fetchcat.dev/pricing` returns **404**; site is a catalog of Apify actors | n/a (Apify account) | Runs on Apify, so any free allowance is Apify's, not Fetchcat's | "Usage-based" on actor cards; "Normal Apify charges apply" | https://fetchcat.dev ; https://fetchcat.dev/actors/instagram-profile-posts-scraper/ |
| **Microlink** | 25 requests/day, free forever | **No** — "No card needed" | **No** — live test returns HTTP 400 `EPROXYNEEDED`: "uses antibot protection. Upgrade to a PRO plan." | Pro $49/mo (46K req) | https://microlink.io/pricing |
| **Iframely** | Starter $0/mo, 2,000 hits/mo | Ambiguous — "only requires a credit card for usage auto-scaling" | **Unverified** — page never confirms Instagram media survives the login wall | Business $49/mo (25K hits) | https://iframely.com/pricing |
| **ScraperAPI** | 7-day trial, **5,000 credits** (page header) / FAQ says free plan **1,000 credits** — self-contradictory | **No** | **No IG structured endpoint** (Structured Data = Amazon, Google, Walmart, eBay, Etsy…) | Hobby $49/mo (100K credits) | https://www.scraperapi.com/pricing/ |
| **ScrapingBee** | **1,000 API credits**, one‑time | **No** — "No credit card required" | **No IG scraper**; dedicated APIs are Google/Amazon/Walmart/YouTube/ChatGPT/Gemini | Hobby $19/mo (75K credits); JS rendering = 5 credits/req | https://www.scrapingbee.com/pricing/ |
| **ScrapeOwl** | **1,000 credits**, one‑time | **No** — "no credit card required" | **No IG endpoint**; returns page HTML/elements only | Bootstrap $29/mo (250K credits) | https://scrapeowl.com/pricing |
| **ScrapFly** | **1,000 API credits** on signup, hard cap | **No** — "No credit card required" | **No IG endpoint**; generic scrape with unblocker, cost depends on features | Discovery $30/mo (200K credits) | https://scrapfly.io/pricing |

---

## 3. Per-provider notes

### 3.1 Apify — best recurring free allowance

Pricing page (https://apify.com/pricing):

> | Free | $0 | $0 | **$5** | ... |
> "Each subscription plan comes with a certain amount of prepaid platform usage... **Note that unused usage credits are not rolled over to the next billing cycle, and they expire at the end of the billing cycle.**"
> "**No credit card is required.** The free plan includes Apify Proxy..."

Free plan constraints: max 16 GB RAM, **5 concurrent runs**, community support. When the $5 is gone: "If you're on the free plan, your access to Apify's services will be blocked until the beginning of the next monthly cycle."

Actor page (https://apify.com/apify/instagram-post-scraper.md):

> "On our Free plan, the price is **$2.70 per 1,000 results**, meaning each result is $0.0027, and **you can get nearly 2,000 results for free**."

Documented output fields (verbatim from the sample JSON on that page): `displayUrl`, `images`, `caption`, `ownerUsername`, `ownerFullName`, `likesCount`, `timestamp`, `childPosts`. Input accepts a direct post URL: `"https://www.instagram.com/p/DLNsnpUTdVS/"`.

Caveats: it is an **async actor** — POST a run, poll or `waitForFinish`, then read the dataset. That is more integration work than a single GET. Also note the sibling `apify/instagram-scraper` (https://apify.com/apify/instagram-scraper.md) is the same $2.70/1K on Free and also accepts post URLs, but its documented posts sample has no `displayUrl`; prefer `instagram-post-scraper` for this use case. ToS: Apify's own FAQ says scraping public Instagram is fine but flags GDPR exposure for personal data — a mood board storing only public image/caption/username is low risk, but it is still scraping.

### 3.2 SearchAPI.io — cleanest single call

Pricing (https://www.searchapi.io/pricing): no "Free" plan card; all cards are paid (Developer $40/mo = 10,000 searches, i.e. $4/1K, through Octo 1M at $1.5/1K). The free allowance is in the footer CTA only:

> "**No credit card required.** No commitment. Cancel anytime."
> "Sign up for **100 free requests**"

Also relevant: "you can utilize only up to **20% of your plan's credits each hour**" — on a 100-request budget that caps you at 20/hour, so a bulk import needs throttling.

Docs (https://www.searchapi.io/docs/instagram-post-api): `post_id` accepts the shortcode (`DavpizrjugI`) **or the full post URL**. Response fields shown: `post.link` (full-resolution image URL), `post.thumbnail` (640×640 jpg), `post.image_versions[]`, `post.caption`, `post.user.username` (+ `name`, `avatar`, `is_verified`), `post.type`, `post.iso_date`.

Caveat, quoted: "Direct image, thumbnail, avatar, and video URLs are **signed by Instagram and can expire. Run the search again whenever you need fresh media URLs.**" Same for every provider below.

### 3.3 Bright Data — biggest free bucket, one unproven field

Pricing (https://brightdata.com/pricing/web-scraper):

> Free Tier **5K records** — "5K records per month", "**No credit card required**", "Expert support"
> Pay as you go **$1.5/1K record**; Scale $499/month (384,000 records, $1.3/1K additional)

Instagram page FAQ (https://brightdata.com/products/web-scraper/instagram):

> "Every new Bright Data account automatically includes **5,000 free credits per month** (approximately $7.50 in value) — **no credit card required**, no promo code, no commitment... **Credits renew on the 1st of each month**... unused free credits do not roll over."
> "If you have no deposited funds, requests will return an error until you add funds or until your credits renew on the 1st of the following month."

Post-by-URL is real: the "Instagram Posts" trigger example on https://brightdata.com/products/web-scraper/instagram/posts posts an array of `https://www.instagram.com/p/<shortcode>` URLs to `https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_lk5ns7kz21pck8jpis`.

**The gap:** the field list for that dataset reads "URL, User posted, Description, Hashtags, Num comments, Date posted, Likes, **Photos**, and more", and the page blurb says it collects "photos", but the 5-record sample response printed directly beneath it contains only `timestamp`, `url`, `user_posted`, `description`, `hashtags`, `num_comments`, `date_posted`, `likes`. The separate "Instagram Image" scraper advertises "**photo URL**, post URL, username, description..." (https://brightdata.com/products/web-scraper/instagram/image) but shows a profile-dataset example, not a post lookup. Conclusion: plausible, not proven — spend 1 free credit to confirm before designing around it.

### 3.4 Captapi — small but the most honest docs

Pricing (https://captapi.com/pricing): "**Free** — Perfect for testing — **$0 forever** — **100 lifetime credits** — 40 requests / minute — **All 180 APIs included**". Paid: Starter $9/mo (2,000 credits), Pro $27/mo (6,000), Business $90/mo (20,000). "Pay only for what you use — **cached results are always free**." The signup page and pricing page both state no card ("Start with 100 free credits... **No credit card required**" — https://captapi.com/apis).

Endpoint (https://captapi.com/apis/instagram-details): "**1 credit per request**"; `GET /v1/instagram/details?url=<post or reel URL>`; returns `thumbnailUrl`, `caption`, `author.username`, `author.displayName`, `author.profileImage`, `publishedAt`, `postType`, `children[]` for carousels. "Pass **cache=true** for a free 24h cache hit (default is always fresh)" — a cache hit costs **0 credits**, which materially stretches those 100.

Caveat: "100 **lifetime** credits" is one‑time; there is no monthly refresh. It is the cheapest way to prototype, then $9/mo for 2,000/month.

### 3.5 Bridgly — 100 credits, but no author in the post response

Homepage and pricing (https://bridgly.app): "**100 free credits on business email. No card required.**"; PAYG $2.00/1,000 credits (500 credits per $1), Growth $50/30,000, Scale $300/300,000; "**one credit per call**".

Endpoint (https://bridgly.app/platforms/instagram/post): `POST /instagram/post`, price "1 credit per request", accepts `shortcode` or full link. Documented response envelope:

```json
{ "id": "...", "shortcode": "...", "url": "...", "type": "Image", "display_url": "...",
  "video_url": "...", "caption": "...", "likes": 0, "comments": 0, "timestamp": 0,
  "is_video": true, "video_view_count": 0 }
```

That is image + caption but **no username/author** — Bridgly puts owner details on `user-posts` (https://bridgly.app/platforms/instagram), not on the single-post endpoint. Also note the business-email gate on the free credits.

### 3.6 opendata-api.com — exists, but refuses to state a price

Homepage (https://opendata-api.com): "🆓 Free — Sign up for **100 starter credits**, then test with your API key. Requests consume the credits shown in pricing."

Pricing (https://opendata-api.com/en/pricing.html): the credit-per-project table renders **empty**, and the FAQ only says "Each API request consumes a certain number of credits. Different APIs may have different credit costs per request." No card requirement is stated either way.

Its post endpoint does exist and looks right (https://opendata-api.com/en/instagram/post-detail.html): `code_or_url` takes a shortcode or full URL; response has `caption`, `user` (owner id, username, verification), `image_versions2` / `video_versions` media URLs, `carousel_media`. But the page itself prints: "**Request cost is temporarily unavailable. No price is assumed.**"

Verdict: do not build on it until the price is visible; you cannot compute a free-tier budget from this site.

### 3.7 Fetchcat — not a provider, an Apify publisher

`https://fetchcat.dev/pricing` → **HTTP 404**. The site is a browsable catalog ("Browse **322** ready-to-run Apify actors", https://fetchcat.dev). Actor pages such as https://fetchcat.dev/actors/instagram-profile-posts-scraper/ label pricing "**Usage-based**" and say "**Normal Apify charges apply. Check the live Pricing tab**", linking to `apify.com/fetch_cat/...`. There is an `instagram-post-details-scraper` in the catalog (30 fields incl. captions, authors, media URLs) but no separate billing relationship. Any free allowance you get is Apify's $5/month, so it collapses into the Apify row.

### 3.8 Generic scraping APIs — free tiers exist, Instagram support does not

- **ScraperAPI** (https://www.scraperapi.com/pricing/): "Start collecting data with our **7-day trial and 5,000 API credits. No credit card required.**" — but the FAQ on the same page contradicts it: "ScraperAPI offers a free plan... get **1,000 free API credits**". Structured Data Endpoints cover "Amazon, Google, Walmart and more" / the site nav lists Amazon, Google Shopping, Walmart, eBay, Etsy, Home Depot, Target — **no Instagram**. You would be fetching raw HTML that is login-walled. Paid from $49/mo.
- **ScrapingBee** (https://www.scrapingbee.com/pricing/): "Get access to **1,000 free scraper API credits**, no credit card required!" Dedicated Scraper APIs are Google, Fast Search, Amazon, Walmart, ChatGPT, Gemini, YouTube, Employee Search — **no Instagram**. JS rendering costs **5 credits** per successful request, so 1,000 credits ≈ 200 rendered fetches. Hobby $19/mo.
- **ScrapeOwl** (https://scrapeowl.com/pricing): "Get **1000 credits for free, no credit card required.**" It is a raw HTML/element extractor ("only gets you the elements that you specify") — no Instagram recipe, no login-wall bypass guarantee. Bootstrap $29/mo.
- **ScrapFly** (https://scrapfly.io/pricing): "**Free tier** — 1,000 API credits on signup — No credit card required — Discovery, hobby, and evaluation use cases", 5 concurrency, "not allowed" to buy overflow. "Credit cost per request depends on the features you enable (JavaScript rendering, Unblocker, residential proxies...)" — no Instagram structured API.

None of these four returns post metadata as JSON; building on them means writing and maintaining your own Instagram parser against a login wall, which is the thing we are trying to avoid.

### 3.9 Microlink — free plan, but Instagram is explicitly paywalled

Pricing (https://microlink.io/pricing): "**Free** — Every Pro feature. No card. **$0/month — 25 requests per day**"; "Payment method: **No card needed**"; Pro $49/month (~$1.07/1K requests).

But it does not work for Instagram on Free. Live request on 2026‑11‑08:

```
GET https://api.microlink.io/?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FDavpizrjugI%2F
HTTP 400

{"status":"fail","data":{"url":"The URL `https://www.instagram.com/p/DavpizrjugI/`
uses antibot protection. Upgrade to a PRO plan."},
"code":"EPROXYNEEDED","message":"The request has been not processed."}
```

This is the one candidate where the free tier was empirically disproven rather than inferred. (The pricing table does list "Automatic proxy resolution — Included" for Free, which contradicts the runtime error; trust the runtime.)

### 3.10 Iframely — plausible, unverified

https://iframely.com/pricing: "**Starter** — $0 / mo — **2,000 hits/mo included** — $0.4 per 100 hits over 2K — Pilot projects". Card requirement is stated only obliquely: "It gives 2,000 hits/mo for free and **only requires a credit card for usage auto-scaling**." For previews, "a 'hit' is **an hour of URL activity**", so repeated imports of the same URL within an hour are cheap.

Not verified: whether the Instagram preview still yields an image after the anonymous-login-wall change. The page markets "1900+ publishers" but names no Instagram behaviour, and the free Starter tier is licensed for "**Pilot projects**" only, not production. Treat as a maybe, test before relying.

---

## 4. Caveats that apply across the board

1. **Instagram CDN URLs expire.** SearchAPI: "signed by Instagram and can expire. Run the search again whenever you need fresh media URLs." Captapi: `mediaUrlsExpireAt` is "the earliest Instagram CDN `oe=` stamp (typically **~5 days**)". Do not persist the remote URL as the card image — download the bytes and re-host (or proxy through your own route) at import time.

2. **One-time vs monthly is the whole ballgame.** Monthly-recurring: Apify ($5 credit/month), Bright Data (5,000/month). One-time only: SearchAPI (100), Captapi (100 lifetime), Bridgly (100), opendata-api (100 starter), ScrapingBee/ScrapeOwl/ScrapFly (1,000). A mood board that imports a handful of posts per user will burn a one-time 100 in an afternoon of testing.

3. **Signup gates.** Apify and Bright Data need an account (email; Bright Data may run KYC/compliance review — its compliance section mentions a "documented Know Your Customer process"). Bridgly requires a **business** email for the free credits. SearchAPI/Captapi/ScrapingBee/ScrapeOwl/ScrapFly free tiers are plain signups.

4. **Ambiguity, stated rather than resolved:**
   - ScraperAPI's page contradicts itself on trial size (5,000 vs 1,000 credits).
   - Iframely does not say plainly whether a card is required, nor whether Instagram previews still work.
   - opendata-api shows no per-request price at all ("temporarily unavailable. No price is assumed").
   - Bright Data advertises a "Photos" field for posts but its sample response omits it.
   - Microlink's pricing table says proxy resolution is included on Free while the API returns `EPROXYNEEDED` — the runtime wins.

5. **Free-plan ceilings beyond request count.** Apify Free = 5 concurrent runs and execution stops until the next monthly cycle once the $5 is spent. Bright Data Free = requests error out when credits are gone unless funds are deposited. ScrapFly Free = hard quota cap, no overflow purchases. SearchAPI enforces 20% of plan credits per hour, so ~20 requests/hour on the 100-request grant.

6. **Terms-of-service / legal risk is real and not eliminated by paying.** All of these are unofficial scrapers operating outside Meta's terms; Meta's own approved Graph API is the compliant route. Apify's FAQ concedes results "could contain personal data" under GDPR. For a private, self-hosted mood board storing public images, captions and usernames, exposure is modest — but do not republish the images as your own, and expect each provider to break whenever Instagram changes its anti-bot posture (Bright Data markets "self-healing" scrapers; the others may just 502).

7. **Pricing pages change.** Everything above reflects the pages as fetched on **2026‑11‑08**. Re-check the two numbers that decide the choice — Apify's $5/month free credit and SearchAPI's 100 free requests — before shipping.
