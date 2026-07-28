# Torn Recruiter

Tampermonkey script for torn.com. On the user search / advanced search pages it hides everyone who is not a donator/subscriber or who is fedded/fallen, and adds hours played, xanax/day and activity streak next to each remaining player. Works on profile pages too. Paste a Torn API key in the panel (bottom right) — it is kept in sessionStorage.

## Build

```bash
npm install
npm run build
```

Then install `dist/recruiter.user.js` in Tampermonkey (drag it onto the browser or paste it into a new script).

Use `npm run watch` while developing.

## Publish

The script lives at https://greasyfork.org/nb/scripts/588927-torn-recruiter and syncs from this repo. One-time setup: on the Greasy Fork script page → Admin → set the sync URL to

```
https://raw.githubusercontent.com/lommerusk113/recruiter/main/dist/recruiter.user.js
```

Every release:

```bash
./scripts/release.sh
```

Bumps the patch version, rebuilds, commits and pushes — Greasy Fork syncs the new version from the raw URL (use "Update from sync source now" on the admin page to force it immediately).
