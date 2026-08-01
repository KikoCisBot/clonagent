# Sentinell — launch playbook (Reddit + Hacker News)

Ready-to-fire launch content for **Sentinell** (`sentinell.utopiaia.com`), the free
external security scan → 30 €/year monitoring product. The goal of every post is the
same one honest call to action: **"paste your domain, get a free vulnerability report."**

> ⚠️ Nothing here is auto-posted. These are staged drafts. Post them yourself, or tell
> the agent which one to fire via the `browser-post` skill. Session status at time of
> writing: **Reddit = logged in** in Chrome, **Hacker News = not logged in** (you'll need
> to sign in to HN in Chrome first, or post manually).

## Non-negotiable rules (same ethos as the store-audit skill)

These keep us out of spam territory *and* out of bans. Breaking them burns the domain.

1. **Disclose it's ours.** Every post says plainly that we built it. No sockpuppets, no
   "hey has anyone tried this tool I found" fake-discovery posts.
2. **Value first, one honest CTA.** The post has to be worth reading even for someone who
   never clicks. Free report, no signup wall, no "book a call".
3. **Never mass-blast.** One Show HN. A *handful* of genuinely relevant subreddits, spaced
   out (not all in one hour). Prefer each sub's dedicated self-promo/show-off thread.
4. **Respect each community's self-promo rules.** They're noted per-subreddit below. When
   in doubt, comment helpfully in existing threads instead of dropping a link post.
5. **No fabricated numbers.** If a post cites "we scanned N shops and X% leaked .env",
   those must be **real numbers from real scans you ran**. Placeholders below are marked
   `<<FILL>>` — never invent them.
6. **Honor opt-outs everywhere.** If someone replies "stop"/"not interested", disengage.

## Suggested order & pacing

1. **Day 1 — Hacker News** `Show HN` (highest signal, technical audience, one shot). Post
   Tue–Thu, ~08:00–10:00 PT for best visibility. Requires HN login in Chrome.
2. **Day 1–2 — r/webdev / r/SideProject / r/indiehackers** show-and-tell posts.
3. **Day 2–3 — r/woocommerce, r/wordpress, r/ecommerce** — value-first, audience-specific.
4. Reply to *every* comment for the first 48h. That's where launches are won.

## Files

- `show-hn.md` — HN title + author's first comment.
- `reddit.md` — per-subreddit drafts with each sub's rule noted.

## Firing via browser-post (when you give the go)

The `browser-post` skill drives your already-logged-in Chrome session. Typical flow:
> "Post the Show HN draft to Hacker News" — the agent reads `show-hn.md`, submits the
> story, then pastes the author comment. For Reddit: "Post the r/webdev draft." The agent
> will confirm the exact title/body before submitting each one.
