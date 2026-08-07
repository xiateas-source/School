# Firebase setup — the ~10-minute part only you can do

Cat Trainer needs a tiny free backend so Mom's phone and Sirus's tablet share the
same live data. This uses **Firebase**, Google's free service. You only do this
once. Nothing here costs money for a one-family app.

You'll end with a small block of text ("your config") that you paste to Claude
(or into `firebase-config.js`). That's the only thing Claude needs.

---

## Step 1 — Create the project
1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Add project** (or **Create a project**).
3. Name it something like **cat-trainer**. Click **Continue**.
4. On "Google Analytics" — you can **turn it off** (not needed). Click **Create project**.
5. Wait for it to finish, then click **Continue**.

## Step 2 — Add a Web app
1. On the project home, click the **`</>`** (web) icon — "Add an app to get started."
2. Nickname it **cat-trainer-web**. Leave "Firebase Hosting" **unchecked**. Click **Register app**.
3. Firebase shows a code block containing **`const firebaseConfig = { ... }`**.
   **This is the part I need.** Copy the whole `{ ... }` block.
4. Click **Continue to console**.

## Step 3 — Turn on the database (Firestore)
1. In the left menu, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location near you (e.g. **nam5 (United States)**). Click **Next**.
4. Start in **production mode** (Claude will provide the exact security rules). Click **Enable**.

## Step 4 — Turn on sign-in (Authentication)
1. Left menu: **Build → Authentication** → **Get started**.
2. Enable **Email/Password** — and inside it, also flip on **Email link (passwordless sign-in)**. Save.
3. Enable **Anonymous** (this is the limited "child device" sign-in). Save.

## Step 5 — Send Claude your config
Paste the `firebaseConfig = { ... }` block from Step 2 back to Claude. That's it —
Claude wires everything up, publishes the security rules, and the synced app comes
to life.

---

### Notes
- The config values are **not secrets** — they only name your project. Real
  protection comes from the security rules Claude installs.
- Free tier ("Spark plan") is far more than a single family will ever use.
- If any screen looks different from these steps (Firebase changes its wording
  sometimes), just tell Claude what you see and you'll be guided through it.
