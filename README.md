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
- Easiest: **Admin → Directory Upload** — upload an Excel/CSV file (one row per person), review the changes, then import. Download the current directory, edit it, and upload it back for bulk updates.
- Or use Supabase **Table Editor → Import data from CSV** for both tables (families first).
- `contributions` / `pledges` — import past giving from your accounting spreadsheet, or have trustees enter it from **Admin → Giving**.
- Make the secretary and trustees officers: in **Admin → Members**, edit their record and set Portal role to Officer (only an admin can do this).
- Members-only documents and announcements: add rows to `member_documents` (link to a file in Supabase Storage or Google Drive) and `member_announcements`.

Want to test first? `supabase/sample-data.sql` creates one sample family — put your email in it, run it, and invite yourself.

### Inviting members
**Authentication → Users → Invite user** with the member's email. When they click the invite, their login links automatically to their member row (matched by email). They can set a password under **Account**, or always use "Email me a sign-in link".

### What members can see and do
| Area | Members (`/members/`) | Officers & admins (`/admin/`) |
|---|---|---|
| Profile & household | View; edit phone, address, birthday, directory opt-in | Add/edit/delete families and members; bulk upload/update from Excel or CSV (Admin → Directory Upload) |
| Portal access | — | Email an invitation or set a starting password; admins can reset passwords or remove access |
| Giving | Own family's statement, printable per year | Record contributions, set pledges, export CSVs |
| Announcements | Members + "both" announcements | Post to the home page, the portal, or both; pin; expire |
| Events | Public + members-only events | Add/edit events; drafts and members-only |
| Documents | Read | Upload files or add links |
| Photos | Submit photos for review | Approve/decline; approved photos appear on the Gallery |
| Portal settings | — | Admins only: turn portal tabs on/off, photo limits, home-page blocks |

Roles live in `members.role`: `member`, `officer` (can use Admin), `admin` (also roles + settings). Only an admin can change roles.

### Mitra AI chat assistant ("Ask Mitra AI")
- A Claude-powered chat bubble on the public site and member portal (not the admin console). It answers only from `assets/chat-knowledge.json` (built from `_data/`), live public events and home-page announcements, and its copy of **marthoma.in** (below).
- Backend: Supabase function `chat` (`supabase/functions/chat`) using Claude Haiku 5.5. It needs the secret **ANTHROPIC_API_KEY** (Supabase → Edge Functions → Secrets).
- Limits: 30 messages per visitor per hour and 1,500 per day site-wide (change the hourly limit in Admin → Portal Settings). No conversation text is stored.
- Turn it on/off or change the greeting in **Admin → Portal Settings → Mitra AI chat**.
- At DNS cutover nothing changes: the function already accepts mtcatlanta.org.

#### Reference sources (marthoma.in)
- The `mitra-sources` function keeps a searchable copy of the official Mar Thoma Church site in the database:
  - **Lectionary** (marthoma.in/prayer) — every Sunday and feast day with theme, Lessons, Epistle/Gospel, Evening readings and song numbers, plus the special-occasion readings. Mitra AI quotes these exactly.
  - **Kalpanas** (marthoma.in/circulars) — the latest ~200 with number, title and PDF link. The PDF text is read where possible (English and Unicode Malayalam). Older scans and old-font Malayalam PDFs can't be read, so for those Mitra AI gives the title and link.
  - **Sabha pages** (history, overview, bishops, dioceses, organisations, office bearers…) and the latest **news**.
- Refresh: hourly (`mitra-sources-hourly`, at :07) plus a small job every 10 minutes that reads a few Kalpana PDFs (`mitra-sources-pdfs`). Both are `pg_cron` jobs calling the function with a private key stored in `app_secrets`.
- **Admin → Portal Settings → Mitra AI reference sources** shows what's loaded, has a **Refresh now** button, an on/off switch for marthoma.in, and a box for up to 25 other web pages Mitra AI may use.

### New Members form (/new-members/)
- Visitors fill in their details, family, home parish and transfer-letter status. Each request is saved in **Admin → New Members** (badge shows how many are new) and emailed to the Vicar and Secretary (change the addresses there). Replying to the email writes straight to the applicant.
- In Admin: add office notes, **Mark as contacted**, **Add family to the parish register** (creates the family and its members in one click), or **Close request**.
- Email uses the same Resend setup as newsletters and greetings (`RESEND_API_KEY` + mtcatlanta.org verified in Resend). Until then requests are still saved in Admin.

### Prayer requests (/prayer-request/)
- Anyone can send a prayer request, with their name and contact details or **anonymously** (then no name, email or phone is stored at all). They can also say whether it may be mentioned, without names, in intercessions or the prayer group.
- Requests are private: the **Prayer Requests** tab in Admin appears only for the people listed under **Portal Settings → Prayer requests** (default: vicar@mtcatlanta.org; they need a portal account with that email). Other officers and admins cannot read them. Each request is also emailed to the Vicar once email sending is set up.
- Linked from the top bar on every page, the home page, Worship and Contact pages; Mitra AI points people to it.

### Worship schedule (Admin → Worship)
- **Upcoming Sundays:** officers can change any Sunday: language (Malayalam, English, Bilingual, Combined, No service), time, a note (e.g. "Holy Communion", "Episcopal Visit") and the celebrant. Sundays left alone follow the regular pattern. **Reset** returns a Sunday to normal.
- **Regular pattern** (admins): service time and the language for the 1st–5th Sundays.
- Changes show on the Worship page (with that Sunday's lectionary readings), the "This Sunday" banner and home card, and in Mitra AI's answers.

### Flyers and newsletter covers
- **Flyers:** in Admin → Announcements or Events, use the **Flyer** field to upload a JPG/PNG. It shows beside the announcement on the home page (click to enlarge), in the member portal, as a thumbnail in "Coming up", and in the event's detail window. Editing without choosing a new file keeps the flyer; tick "Remove this flyer" to drop it.
- **Newsletter covers:** add the PDF to `assets/newsletters/` and an entry to `_data/newsletters.yml` as before. The **Newsletter covers** GitHub Action renders page 1 as the cover and adds the `cover:` line automatically within a few minutes. Newsletters without a cover show a plain blue card.

### Database files
- `supabase/schema.sql` — core tables and privacy rules.
- `supabase/002_admin_events_photos.sql` — events, photo submissions, portal settings, admin write access, file storage.
- `supabase/functions/admin-users/` — server function behind "Portal access" (deployed as `admin-users`).
- `supabase/003_chat.sql` + `supabase/functions/chat/` — chat assistant usage limits and function.
- `supabase/012_prayer_requests.sql` + `supabase/functions/prayer-request/` — private prayer requests.
- `supabase/011_new_members.sql` + `supabase/functions/new-member/` — New Members form requests and the staff email.
- `supabase/006_worship.sql` — per-Sunday worship changes and the regular pattern; public read of the lectionary.
- `supabase/005_flyers.sql` — flyer images on events and announcements (public `flyers` bucket) and the events "Register / details" link.
- `supabase/004_mitra_references.sql` + `supabase/functions/mitra-sources/` — marthoma.in reference copy, search and the scheduled refresh jobs.

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

- **New newsletter:** upload the PDF to `assets/newsletters/`, then add an entry at the top of `_data/newsletters.yml` with its `url` (see the September 2026 entry).
- **New flyer:** add the image, update `_data/announcements.yml`.
- **New photos:** add to the folder and list them in `_data/gallery.yml` (a new `- album:` block makes a new album).
- **New vicar/committee:** edit `_data/leadership.yml`.

All of these can be done in the GitHub website editor — the site rebuilds automatically in about a minute.

## Still to confirm before launch
- Church street address (`_data/church.yml`) — not on the current site.
- The Organizations list (`_data/organizations.yml`) — the old site's menu was empty, so these are the standard Mar Thoma organizations.
- What happens on 5th Sundays (shown as "Special"; change in `assets/js/site.js`).
- Facebook or other social links, if any.
