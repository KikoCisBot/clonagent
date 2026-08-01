# Reddit drafts

Post to a *handful* of genuinely relevant subreddits, spaced out — not all at once.
Each draft discloses we built it and leads with value. Read each sub's rules before
posting; the relevant rule is noted per-sub. When a sub has a dedicated self-promo /
show-off thread, use it instead of a standalone post.

Session note: Reddit is logged in in Chrome, so `browser-post` can fire these on your go.
Use a real account with some history — a fresh throwaway posting a link gets auto-removed.

---

## r/webdev — "Showoff Saturday" thread (weekly)

**Rule:** No standalone self-promo posts. Projects go in the weekly *Showoff Saturday*
thread. Comment there, don't create a post.

> **Sentinell — free external security scan for a domain (built it for the small shops I maintain)**
>
> I maintain a few small WooCommerce/WordPress sites and kept finding the same external
> leaks — exposed `.env`, readable `wp-config.php`, `.git/` served in the open, EOL
> versions with public CVEs. So I built a scanner that checks a domain from the outside
> (no access, no agent): ~100 checks for exposed files, headers/CORS/dir-listing misconfigs
> and known CVEs, then emails a severity-ranked report with fixes.
>
> Free one-off scan, no signup wall: https://sentinell.utopiaia.com — paste a domain + email.
> It's external-recon only (won't catch authenticated/app-logic bugs, and CVE detection is
> version-based so it can over-flag backported patches). Would love feedback on the check
> set. Built with Node; happy to talk implementation.

---

## r/SideProject — standalone "I built X" post allowed

**Rule:** Self-promo of your own project is welcome. Be genuine, engage in comments.

> **Title:** I built a free external security scanner for small websites (Sentinell)
>
> **Body:**
> I do maintenance for some small online shops and got tired of finding the same
> from-the-outside leaks: exposed `.env`/`wp-config.php`, open `.git/` directories, missing
> security headers, EOL software with public CVEs.
>
> Sentinell scans a domain like an attacker's recon would — external only, no credentials,
> no agent on your server. ~100 checks, and it emails you a report ranked by severity with
> concrete fix steps. The scan is free and there's no signup wall; the paid tier
> (30 €/yr/domain) just re-runs it continuously and alerts on anything new.
>
> Try it on a domain you own: https://sentinell.utopiaia.com
>
> Honest limits: it only sees public surface (not logged-in flows or app-logic bugs), and
> CVE matching is version-based so it can flag a version that was patched via backport.
> Feedback on signal-vs-noise very welcome — what would you want flagged?

---

## r/indiehackers — build/business framing

**Rule:** Sharing your own product + the story/numbers behind it is on-topic. Lead with
the lesson, not the link.

> **Title:** Turned "the same 5 security holes I keep finding" into a 30 €/yr product
>
> **Body:**
> Maintaining small WooCommerce sites, I kept fixing the identical external issues over and
> over — exposed config files, open `.git/`, EOL software with known CVEs. Packaged the
> checks into Sentinell: a free external scan that emails a severity-ranked report, with a
> 30 €/yr tier for continuous monitoring + optional managed fixes.
>
> Deliberately kept it dead simple: no signup wall on the free scan, one price, external
> only (no server access). Sharing partly to get feedback on the model — is a flat cheap
> annual price the right shape for "security hygiene for people who aren't security people",
> or does that undersell it? Free scan if you want to poke at it:
> https://sentinell.utopiaia.com

---

## r/woocommerce — audience-specific, value-first

**Rule:** Helpful/relevant content is fine; blatant ads get removed. Frame around a real
WooCommerce risk, disclose the tool, don't hard-sell.

> **Title:** PSA: check your shop isn't leaking wp-config.php / .env from the outside
>
> **Body:**
> A surprising number of small WooCommerce shops serve sensitive files publicly without
> realizing — `wp-config.php` readable, a stray `.env`, an open `.git/` directory, or an
> EOL WordPress/plugin version with a public CVE. None of it needs anyone to "hack" you;
> it's just visible.
>
> Quick manual checks you can do right now (no tools):
> - open `https://yourshop.com/.git/config` — should be 404, not a file
> - open `https://yourshop.com/.env` — should be 404
> - check WP + plugins are on current versions (Dashboard → Updates)
>
> I built a free scanner that automates this and ~100 more checks and emails you a report:
> https://sentinell.utopiaia.com (disclosure: it's mine). External-only, no access to your
> store. Happy to answer WooCommerce-security questions in the comments either way.

---

## r/ecommerce — same idea, broader audience

**Rule:** Value-first; self-promo tolerated with disclosure and substance.

> **Title:** Your store's biggest security risk is usually a file you're serving by accident
>
> **Body:**
> (same body as r/woocommerce, generalized: replace "WooCommerce shop" with "online store"
> and drop the WP-specific plugin line. Keep the three manual checks — they apply to any
> stack — and the disclosed free-scan link.)

---

## Optional, higher-effort: a real-data post (only if you've run real scans)

The strongest Reddit post is findings, not a tool. If you scan a real, opted-in or
publicly-listed set (e.g. your own portfolio of maintained sites) you can post:

> **Title:** I scanned <<FILL: N>> small Spanish online shops from the outside — <<FILL: X>>
> were leaking something they shouldn't
>
> Body: real breakdown (how many exposed `.env`, open `.git/`, EOL WP, etc.), what the fix
> is for each, then the disclosed free-scan link.

**Only use real numbers.** `<<FILL>>` must come from scans you actually ran — never invent
them, and never scan domains you don't own/aren't authorized to, beyond the single free
report each owner requests themselves.
