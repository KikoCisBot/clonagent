# Show HN

**Submit as:** Show HN (a story with a URL). No hype words, no exclamation marks — HN
punishes marketing tone. Let the free scan be the thing people try.

---

## Title

```
Show HN: Sentinell – free external security scan for your website
```

**URL**

```
https://sentinell.utopiaia.com
```

---

## Author's first comment (post immediately after submitting)

> I run maintenance for a handful of small WooCommerce shops, and the same thing kept
> biting them from the outside: an exposed `.env`, a readable `wp-config.php`, a `.git/`
> directory served in the clear, a WordPress/plugin version with a public CVE. All of it
> visible to anyone, none of it needing access to the server.
>
> Sentinell scans a domain the way an attacker's recon would — purely from the outside,
> no agent, no credentials, no access to your box. It runs ~100 checks (exposed config
> files, `.git/`/directory listing, missing/weak security headers, CORS wildcards, open
> redirects, EOL software and known CVEs for WordPress/plugins/PHP/servers) and emails you
> a report ranked by severity with concrete fix steps.
>
> The one-off scan is free and there's no signup wall — paste a domain and an email, you
> get the report. The paid tier (30 €/year/domain) just re-runs it continuously and alerts
> you when something new appears, plus optional managed fixes. That's the whole business.
>
> A few honest notes:
> - It only sees what's public. It won't catch app-logic bugs, authenticated flows, or
>   anything behind a login — it's recon-surface hygiene, not a pentest.
> - CVE matching is version-based, so it can flag a version that's actually been patched
>   via backport. The report says "detected version X has known CVEs" rather than claiming
>   active exploitability.
> - No scanning of a domain you don't control beyond the single free report you request
>   yourself. I'm not in the business of unsolicited "we hacked you" emails.
>
> I'd genuinely like feedback on the check set and the report's signal-to-noise — what
> would you want flagged, and what would you consider noise? Happy to answer anything about
> how the scanner works.

---

## Notes for whoever posts it

- If HN asks to dedupe/points to an existing thread, don't repost — engage there instead.
- Expect skepticism about "version-based CVE detection = false positives". The comment
  above pre-empts it honestly; lean into that in replies, don't get defensive.
- Do **not** claim numbers ("we found X% of shops leaking .env") unless you have run real
  scans and can back them up in-thread.
