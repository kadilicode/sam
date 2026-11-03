# THE CURRENT INVESTMENT — Invoices

Invoice system for THE CURRENT INVESTMENT (Electrical Solution).
Plain HTML, CSS and JavaScript. No build step and no server code.

## Upload

1. Upload everything in this folder, keeping the folder structure, to your hosting
   (for example `public_html/` or a subfolder such as `public_html/invoices/`).
2. Open the site address. It goes straight to the sign-in screen.
3. Use HTTPS. Installing the app and offline use only work over HTTPS.

## Sign in

- Email: `thecurrentinvestment@gmail.com`
- Password: set by the owner

The email and password are checked against a SHA-256 hash in `assets/js/auth.js`;
the password itself is not stored in the files. To change the login, generate the hash of
`email|password` (email in lowercase):

```
node -e "console.log(require('crypto').createHash('sha256').update('you@example.com|NewPassword').digest('hex'))"
```

Then replace `CREDENTIAL_HASH` in `assets/js/auth.js`.

## Settings (your invoice details)

Open **Settings** at any time to change what appears on invoices:
business name, tagline, address, phone, email, TIN, logo (and the logo watermark),
invoice prefix, currency, payment terms, tax name and rate (VAT 18% by default),
bank / account details and the thank-you message. Saved changes apply to every
preview, print and PDF from then on.

## Your data

- Invoices and settings are saved in the browser's IndexedDB on each device. They are not synced between devices.
- Export a backup regularly from **Backup and restore** and keep the file somewhere safe.
- Clearing browser data for the site deletes the invoices on that device.

## After changing files

Increase `VERSION` in `service-worker.js` (for example `v1.0.1`) so installed apps pick up the update.

## Files

```
index.html               Sign-in screen and app shell
manifest.json            PWA manifest
service-worker.js        Offline cache
icons/                   App icons (from the company logo)
assets/img/logo.png      Company logo (also used as the invoice watermark)
assets/css/style.css     All styles, light and dark themes, print styles
assets/js/utils.js       Formatting, dates, helpers
assets/js/database.js    IndexedDB storage and default company details
assets/js/ui.js          Modals, toasts, menus, form helpers
assets/js/auth.js        Sign-in and session
assets/js/invoices.js    Invoice generator, preview, print, PDF, invoice history
assets/js/settings.js    Settings, backup and restore
assets/js/pwa.js         Install prompt and updates
assets/js/app.js         Router and app start-up
```
# sam
