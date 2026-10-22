# Check-In Board

A password-locked page where management staff can view the Hottie Check In Attendance check-in log and analytics. The data comes live from Clappia; this page only displays it.

## How it stays private

- The Clappia embed links are **encrypted** inside `payload.js` (AES-256-GCM, key derived from the staff password with PBKDF2-SHA256, 600,000 rounds). The repo is public, but without the password the links can't be read.
- Search engines are told not to index it (`robots.txt`, `noindex`).
- The password and plain links live only in `tools/config.local.json`, which is git-ignored. **Never commit it.**

## Updating links or the password

1. Fill in `tools/config.local.json` (see the comment at the top of `tools/build.mjs`).
2. Run `node tools/build.mjs`.
3. Commit and push the new `payload.js`.

Changing the password and rebuilding locks out every saved device.
