# YANKER — Netlify Ready

## Structure
- index.html
- admin.html
- admin-test.html (if included)
- api-health.html (if included)
- netlify/functions/api.mjs
- package.json
- netlify.toml

## Netlify Environment Variables
Set these in Site configuration → Environment variables:
- ADMIN_USER
- ADMIN_PASSWORD
- SESSION_SECRET

Do not rely on the fallback values in api.mjs for production.

## Deploy
1. Upload this folder/repository to GitHub or deploy it with Netlify.
2. Ensure the build publishes the project root and functions directory is `netlify/functions`.
3. Enable Netlify Blobs for the site.
4. Set the three environment variables above.
5. Trigger a fresh deploy.
6. Test `/.netlify/functions/api?action=health`.
7. Open `/admin.html`.

## Important
The frontend expects the function at `/.netlify/functions/api`.
