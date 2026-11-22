# Tijori: a private document cabinet

An encrypted, offline cabinet for IDs, cards, insurance policies, licences and warranty cards.
Your documents never leave the device: there's no server and no account. The page's security
policy (`connect-src 'none'`) makes the browser block every network request the app could make.

## Three ways to run it

**Live:** https://pranayvasani.github.io/llm_apps/tijori/

1. **Desktop, quickest:** open `index.html` in Chrome or Edge. Data is stored in that browser's
   profile. (Safari and Firefox restrict storage for local files, so use option 2 or 3 there.)
2. **Desktop, as an app:** in this folder run `python3 -m http.server 8080`, open
   http://localhost:8080 in Chrome or Edge, then use "Install app" in the address bar.
3. **Phone (Android or iPhone):** put this folder on any static https host you control, such as a
   GitHub Pages repo. Open the URL on your phone, then choose "Add to Home screen" or "Install".
   After that it runs offline. The host only serves the app's code. Your documents stay in the
   phone's own storage.

## Backups and moving data between devices
The cabinet reminds you whenever there are changes that haven't been backed up. Tap **Back up** and
choose **Save to Downloads** or **Send to…**, which opens the share sheet (Quick Share, AirDrop,
Files…). The file is encrypted with your passphrase. To restore, or to copy the cabinet to another
device, go to Settings → Import there. Importing merges the two cabinets, and the newer version of
each document wins.

## Scan to fill
When adding a document, tap **Camera**, or **Photos or PDFs** to pick several files at once (front
and back of a card, every page of a policy). **Read attached** reads files already attached to the
document, and the document view has **Read details from these files**. Values are taken from
whichever file read each field most reliably, and the review shows which file each came from.

Digital PDFs (most e-policies and invoices) are read from their text layer, which is exact and needs
no OCR. Scanned PDF pages go through the photo reader. Password-protected PDFs ask for the password,
which is used only to open the file on the phone.

In the "Scan to fill" box: Tijori reads the
photo **on the phone** using PaddleOCR (PP-OCRv5 mobile) running in ONNX Runtime Web, then picks out
the fields with format rules and check digits. Those include PAN format, the Aadhaar check digit, the
card-number check digit, IFSC, DL and vehicle registration formats, and dates next to labels like
"Valid till". You confirm or edit every value before it's filled in. Values that fail a check digit
are left unticked and marked "please check".

- The first photo scan downloads the engine and models (about 36 MB). The first PDF downloads
  the PDF reader (about 2 MB). Both come from this app's own `ocr/` folder.
  After that, scanning works offline. Settings → Scan to fill can remove the download.
- Photos are never uploaded. The page's security policy only allows network reads from `ocr/`,
  so the app can't send anything anywhere.
- Works best with the document filling the frame, in even light, without glare. Raised digits on
  credit cards and handwriting are hard for any OCR.
- Third-party files and their checksums are listed in `ocr/NOTICE.md` and `ocr/SHA256SUMS`.

## Sharing scans
Open a document and tap **Share scan** (or **Share all scans**), or use the share button while
viewing a photo or PDF. The file is decrypted for that one share and sent to the app you pick, such
as WhatsApp or email. Shared copies are no longer protected by Tijori.

## Things to know
- If you forget the passphrase, nothing can be recovered. Keep regular backups.
- Clearing the browser's site data deletes the cabinet. Back up first.
- Photos are re-encoded on import, which strips their location/EXIF data.
- "Remind me in my calendar" creates an .ics file that holds only a label and a date. If your
  calendar syncs to the cloud, those reminders will sync too.
