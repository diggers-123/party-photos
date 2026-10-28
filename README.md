# 🪩 Party photo album: setup guide

A photo album for **Heli's 50th (with a touch of Daisy's 16th)**. Guests open the link (by scanning the QR code at the party, or from a message someone sent them), type their first name and upload photos from their phone, during the party or the next day.

**What guests see**

- **★ Favourites**: each guest stars up to **5** of their own photos, and those appear in one shared album for everyone, labelled with who took them.
- **My photos**: everything they uploaded themselves. Only they and the host can see these.
- Other guests' un-starred photos are **never** shown to guests. Only you see every photo, in the host dashboard.

Set aside about **40 minutes**. You don't need to install anything. Everything below happens in a web browser, preferably on a computer.

---

## How it works (the short version)

```
Guest's phone ──▶ your website on Vercel ──▶ /api functions on Vercel ──▶ Supabase (private)
                  (pages, no secrets)         (decide who sees what)       (database + photo files)
```

- Anyone with the link can join. Guests can share it with the **🔗 Share the album link** button.
- Each phone gets a random ID the first time it opens the album. That ID is how the server knows which photos are "yours", so you can see, star and delete them. Nobody else ever sees your ID.
- The Supabase database and photo storage are **private**. All listing, viewing and uploading goes through the server functions, which only hand out favourites plus your own photos.
- Phones shrink photos to 1600 px (JPEG, 80%) before uploading. This also strips the hidden GPS location from each photo.

### What's in the folder

| File | What it is |
|---|---|
| `index.html`, `assets/app.js` | The guest album |
| `admin.html`, `assets/admin.js` | Your host dashboard (see all photos, delete, download zip, print QR poster) |
| `assets/style.css` | The look |
| `api/*.js` | The server functions |
| `api/_config.js` | **Party name and details.** Edit this if you want to change the wording |
| `supabase-setup.sql` | Creates the private table and storage bucket |
| `make-keys.html` | Makes your admin password (runs offline) |
| `vercel.json`, `robots.txt` | Settings that keep search engines out, among other things |

---

## Step 1: Make your admin password (1 min)

1. Double-click **`make-keys.html`** in the folder. It opens in your browser and doesn't send anything anywhere.
2. Copy the **ADMIN_PASSWORD** into your password manager or a note. You'll paste it into Vercel in Step 4.

Prefer your own password? Use a long one. It's the only thing protecting the host dashboard, which can see and delete every photo.

---

## Step 2: Set up Supabase, which stores the photos (10 min)

1. Go to **https://supabase.com** → **Start your project** → sign up (signing in with GitHub is easiest. You need GitHub in Step 3 anyway).
2. Click **New project**:
   - **Name:** `party-photos`
   - **Database password:** click *Generate*. You won't need it for this site, but save it anyway.
   - **Region:** **West EU (London)**, so it's fast for UK guests.
   - Plan: **Free**. Click **Create new project** and wait about 2 minutes.
3. **Create the table and the private bucket:**
   - In the left sidebar, open **SQL Editor** → **New query**.
   - Open `supabase-setup.sql` from the folder in Notepad, copy *everything*, paste it in, and click **Run**.
   - You should see "Success. No rows returned".
4. **Check that it worked:**
   - Sidebar → **Table Editor**: you should see a `photos` table with an `is_favourite` column. It may show **"RLS enabled"**, which is good: it means the table is locked.
   - Sidebar → **Storage**: you should see a bucket called `photos` **without** a "Public" badge.
   - *If the bucket is missing:* click **New bucket**, name it `photos`, leave **Public bucket OFF**, and create it.
5. **Copy two values** (you'll paste them into Vercel):
   - **Project URL**: click **Connect** at the top of the dashboard, or go to **Project Settings → Data API**. It looks like `https://abcdefghijkl.supabase.co`.
   - **Secret key**: go to **Project Settings → API Keys**. Under **Secret keys**, reveal and copy the key that starts with `sb_secret_…`. If you only see **Legacy API keys**, copy the **`service_role`** key instead. Either works.

> ⚠️ The secret key unlocks everything in Supabase. It goes **only** into Vercel's environment variables, never into a file, chat or email.

---

## Step 3: Put the code on GitHub (5 min)

1. Go to **https://github.com** and sign up or log in.
2. Click **+** (top right) → **New repository**. Name: `party-photos`, choose **Private**, then click **Create repository**.
3. On the next page, click **"uploading an existing file"**.
4. Open the `party-photos` folder on your computer, select **everything inside it** (Ctrl+A) and drag it onto the GitHub page. Use Chrome or Edge, which keep the `api` and `assets` folders intact.
5. When all files are listed, click **Commit changes**.
6. Check that **`api`** and **`assets`** appear at the top level of the repository, next to `index.html`. They must not be inside another `party-photos` folder.

---

## Step 4: Deploy on Vercel (10 min)

1. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub** → choose the free **Hobby** plan.
2. Click **Add New… → Project**. Find `party-photos` and click **Import**. (If it's not listed, click *Adjust GitHub App Permissions* and allow access to that repository.)
3. On the configure screen:
   - **Framework Preset:** `Other`
   - Leave **Build and Output Settings** alone.
   - Open **Environment Variables** and add these **three** (Name → Value → **Add**):

     | Name | Value |
     |---|---|
     | `SUPABASE_URL` | your Project URL, e.g. `https://abcdefghijkl.supabase.co` |
     | `SUPABASE_SECRET_KEY` | your `sb_secret_…` (or `service_role`) key |
     | `ADMIN_PASSWORD` | the password from Step 1 |

4. Click **Deploy**. After a minute you'll see confetti 🎉. Click **Continue to Dashboard**.
5. Under **Domains** you'll see your site address, e.g. `party-photos-abc123.vercel.app`.
   - **Recommended:** go to **Settings → Domains**, edit the `.vercel.app` domain and change it to something easy to read out, e.g. `helis-50th.vercel.app`. People will be sharing and typing it.

> **Whenever you change an environment variable**, it only takes effect after a redeploy: **Deployments** tab → **⋯** on the newest one → **Redeploy**.

---

## Step 5: Test everything before the party (15 min)

Use your phone and a second phone (or a friend's) if you can.

### A. Joining and sharing
1. On your phone, open `https://YOUR-SITE.vercel.app`. ✅ You're asked for your first name. Type it → **Let's go**.
2. Tap **🔗 Share the album link**. ✅ Your phone's share sheet opens (on a computer the link is copied instead). Send it to the second phone.
3. Open the link on the second phone. ✅ They get in too and enter their own name.

### B. Uploading
1. On phone 1, tap **Choose photos** and pick 7 photos at once. ✅ A progress bar appears, then "🎉 7 photos added", and you're taken to **My photos**.
2. Tap **Take a photo** and take one. ✅ It uploads too.
3. Try picking a **video**. ✅ It's skipped with "photos only, no videos".
4. Turn on **aeroplane mode** and upload a photo. ✅ You'll see "No signal — … waiting". Turn aeroplane mode off. ✅ It uploads by itself.

### C. Favourites
1. In **My photos**, tap ☆ on 5 photos. ✅ Each turns into a gold ★, and the hint says "5 of 5 chosen".
2. Tap ☆ on a 6th. ✅ "You've picked 5 already — un-star one first".
3. Open **★ Favourites**. ✅ Your 5 are there with your name on them.
4. On **phone 2**, open **★ Favourites**. ✅ It shows phone 1's 5 photos with phone 1's name. Open **My photos** on phone 2. ✅ It's empty: phone 2 can **not** see phone 1's other 3 photos.
5. On phone 2, open one of phone 1's favourites. ✅ There's no star or Delete button, only **Save**.
6. On phone 1, open a favourite and tap **★ Favourite** to un-star it. ✅ It disappears from Favourites, also on phone 2 after tapping ↻.

### D. Coming back later
**Close the browser completely** on phone 1, open it again and go to the site address. ✅ You're straight back in, with your name, your photos and your stars. (This works as long as it's the same phone and the same browser.)

### E. Supabase itself is private
1. In Supabase → **Project Settings → API Keys**, copy the **publishable** key (`sb_publishable_…`, or the legacy `anon` key). That key is designed to be public.
2. In a browser, open:
   `https://YOUR-PROJECT.supabase.co/rest/v1/photos?select=*&apikey=PASTE_PUBLISHABLE_KEY`
   ✅ You should see `[]` (an empty list) even though photos exist.
3. Try `https://YOUR-PROJECT.supabase.co/storage/v1/object/public/photos/full/anything.jpg`.
   ✅ You should get an error such as "Bucket not found". Nobody can browse the files directly.

### F. Host dashboard
1. Open `https://YOUR-SITE.vercel.app/admin` and type a **wrong** password. ✅ It's refused.
2. Log in with the right one. ✅ You see **every** photo from both phones. Starred ones have a gold border and ★.
3. Tick **★ Favourites only**. ✅ Only the starred photos show.
4. Select a few photos → **Delete selected**. ✅ They disappear for everyone.
5. Click **Download all (.zip)**. ✅ A zip downloads with every photo, named by time and guest.

### G. Clean up
Delete all your test photos in the dashboard so the album starts empty.

### H. Search engines
Open `https://YOUR-SITE.vercel.app/robots.txt`. ✅ It says `Disallow: /`. Each page also has a "noindex" tag, so it won't show up on Google.

---

## Step 6: Print the QR poster

1. On a computer, open **`https://YOUR-SITE.vercel.app/admin`** and log in.
   *Use your real site address, not a "preview" link. The QR code uses whatever address the dashboard is open on.*
2. In **QR code poster**, choose **A4** or **A5**. Tick **Save ink** for a white background.
3. Click **🖨️ Print poster**. In the print window:
   - **More settings → Background graphics: ON** (otherwise the dark design prints white)
   - **Margins: None**
   - Paper size matching your choice
4. **Scan the printed copy with your phone before the party.**

The poster also shows the site address in words, so people can type it or share it.

---

## On the night and afterwards

- **Something inappropriate?** Delete it from the dashboard. It's gone for everyone.
- **Download everything** from the dashboard (best on a computer) within a few days. Large albums are split into parts of 250 photos.
- **Free-plan limits (Supabase):** 1 GB of storage (roughly 2,000+ party photos at this size) and 5 GB of downloads a month. Check Supabase → **Usage**.
- **Free Supabase projects pause after about a week with no activity.** Download your zip within a week of the party. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.
- **When you're completely done:** delete the Supabase project (**Project Settings → General → Delete project**) and, if you like, the Vercel project.

## Good to know

- **Anyone with the link can join and upload.** That's deliberate, so guests can share it. Guests still only see the Favourites album plus their own photos, and you can delete anything from the dashboard. If unwanted people start uploading, you can move the site to a new address in Vercel (**Settings → Domains**) and reprint the poster.
- **"My photos" belongs to the phone and browser.** If a guest switches phone or browser, or clears their browsing data, they start fresh. Their earlier photos are still safe and visible to you in the dashboard, but they can no longer star or delete them.
- **Names aren't verified.** Guests type their own first name.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| "The album isn't set up yet" | An environment variable is missing or misspelt. Check all three names in Vercel exactly as written above, then **Redeploy**. |
| "Something went wrong on our side" | Vercel → your project → **Logs** shows the real error. Usually the `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is wrong, or the SQL in Step 2 wasn't run. |
| Starring fails with a server error | Run `supabase-setup.sql` again. It adds the `is_favourite` column if an older version of the table exists. |
| A Vercel login page appears for guests | You shared a *preview* link. Use the main domain shown under **Domains**. |
| `404` on `/api/photos` | The `api` folder isn't at the top of the GitHub repository. Re-check Step 3.6. |
| An iPhone photo "couldn't be read" | Very rare. Ask the guest to try again or pick another photo. |

## Changing things

- **Party name, subtitle or date:** edit `api/_config.js` on GitHub (open the file → ✏️ pencil → edit → **Commit changes**). Vercel redeploys automatically within a minute.
- **Number of favourites per guest:** `MAX_FAVOURITES` at the top of `api/_lib.js`.
- **Photo size and quality:** the top of `assets/app.js` (`MAX_SIDE`, `JPEG_QUALITY`).
