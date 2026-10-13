# Mar Thoma Church, Atlanta — website

The new mtcatlanta.org: a static site hosted free on **GitHub Pages** (built with Jekyll, which GitHub runs for you), plus a **member portal** whose logins and data live in **Supabase** (free tier is plenty for a parish).

```
_config.yml          site settings (title, URL, where images come from)
_data/               ← most day-to-day edits happen here
  church.yml           email, worship time, Sunday language schedule, livestream link, address
  leadership.yml       vicar + executive committee
  announcements.yml    flyers on the home page
  newsletters.yml      newsletter PDFs
  gallery.yml          gallery photos
  organizations.yml    parish organizations
index.html, about.html, worship.html, organizations.html, gallery.html, newsletters.html, contact.html
members/index.html   member portal (sign-in + dashboard)
assets/css, assets/js
assets/js/config.js  ← paste your Supabase URL + anon key here
supabase/schema.sql  database tables + security rules (run once)
scripts/import-wp-media.sh   copies images/PDFs off WordPress
CNAME                tells GitHub Pages the custom domain
```

Until `assets/js/config.js` has Supabase keys, the portal runs in **preview mode**: any email/password opens a sample account so everyone can review the design.

---

## 1. Put it on GitHub (≈10 min)

1. Create a repository, e.g. `mtcatlanta/mtcatlanta.org` (public is fine — no member data lives in the repo).
2. Upload these files (or `git init && git add . && git commit -m "New site" && git push`).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. In a minute or two it's live at `https://<org>.github.io/<repo>/`.
   *If you preview at that sub-path,* set `baseurl: "/<repo>"` in `_config.yml`; set it back to `""` once the domain points here.

## 2. Move the images and PDFs off WordPress (do this BEFORE the DNS switch)

All the images on the new site (logo, Vicar photo, flyers, gallery, banner, church illustration) and the newsletter PDFs are the same files as the current site. Until this step they load from the WordPress server.

**Easiest:** GitHub → **Actions → Import WordPress media → Run workflow.** It downloads every file into `wp-content/uploads/…` (the same paths WordPress used, so old shared newsletter links keep working), switches `media_base` to `/wp-content/uploads`, and commits. If the run fails, the log lists any file it couldn't get.

*Or on your own computer:* `bash scripts/import-wp-media.sh`, set `media_base: "/wp-content/uploads"` in `_config.yml`, commit and push. Also take a full WordPress backup (Tools → Export, plus your host's backup) before going further.

## 3. Set up the member database in Supabase (≈20 min)

1. Create a free project at supabase.com (region: East US).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled, **turn OFF "Allow new users to sign up"** (members are invited; strangers can't self-register).
4. **Authentication → URL Configuration**: Site URL `https://mtcatlanta.org`; add Redirect URL `https://mtcatlanta.org/members/` (add the github.io preview URL too while testing).
5. **Project Settings → API**: copy the *Project URL* and *anon public* key into `assets/js/config.js`. (The anon key is meant to be public — the row-level security rules decide what each person can read.)
6. **Email delivery:** Supabase's built-in email is rate-limited (a few messages/hour). Before inviting the congregation, add custom SMTP under **Authentication → Emails → SMTP** (Resend, SendGrid, Google Workspace, etc.) and send from an `@mtcatlanta.org` address.

### Load the parish register
- `families` — one row per household (address, phone, prayer group, member number).
- `members` — one row per person, linked to a family. Put an `email` on each adult who should be able to log in.
- Use **Table Editor → Import data from CSV** for both tables (families first).
- `contributions` / `pledges` — import past giving from your accounting spreadsheet, or have trustees enter it from **Officer Tools** in the portal.
- Make the secretary and trustees officers: set `role` = `officer` (or `admin`) on their member rows.
- Members-only documents and announcements: add rows to `member_documents` (link to a file in Supabase Storage or Google Drive) and `member_announcements`.

Want to test first? `supabase/sample-data.sql` creates one sample family — put your email in it, run it, and invite yourself.

### Inviting members
**Authentication → Users → Invite user** with the member's email. When they click the invite, their login links automatically to their member row (matched by email). They can set a password under **Account**, or always use "Email me a sign-in link".

### What members can see and do
| Area | Members | Officers / admin |
|---|---|---|
| Profile & household | View; edit phone, address, birthday, directory opt-in | View all |
| Family | Own family only | All families |
| Giving | Own family's statement, printable per year | Record contributions, view any family |
| Directory | Only people who opted in, contact fields only | — |
| Documents & announcements | Yes | Yes |
| Export register (CSV) | — | Yes |

Changes to names, member numbers, prayer groups or sacramental records go through the secretary (edit in the Supabase Table Editor).

## 4. Switch the domain (≈15 min + DNS propagation)

> ⚠️ **Don't break church email.** If anything uses `@mtcatlanta.org` email (vicar@, secretary@, trustee@), change only the website records below and leave the **MX** (and SPF/TXT) records exactly as they are.

At the domain registrar's DNS settings:

| Type | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<your-github-org>.github.io` |

Remove the old A/CNAME records that pointed to the WordPress host. Then in `_config.yml` set `baseurl: ""` (it's `/AtlantaMarthomaChurch` while previewing on github.io), and in **Settings → Pages** enter `mtcatlanta.org` as the custom domain (GitHub adds a `CNAME` file) and tick **Enforce HTTPS** once the certificate is issued (can take up to an hour).

Old URLs `/gallery/`, `/newsletters/`, `/contact-us/` keep the same addresses on the new site.

## Everyday editing

- **New newsletter:** add the PDF to `wp-content/uploads/YYYY/MM/`, then add an entry at the top of `_data/newsletters.yml`.
- **New flyer:** add the image, update `_data/announcements.yml`.
- **New photos:** add to the folder and list them in `_data/gallery.yml` (a new `- album:` block makes a new album).
- **New vicar/committee:** edit `_data/leadership.yml`.

All of these can be done in the GitHub website editor — the site rebuilds automatically in about a minute.

## Still to confirm before launch
- Church street address (`_data/church.yml`) — not on the current site.
- The Organizations list (`_data/organizations.yml`) — the old site's menu was empty, so these are the standard Mar Thoma organizations.
- What happens on 5th Sundays (shown as "Special"; change in `assets/js/site.js`).
- Facebook or other social links, if any.
