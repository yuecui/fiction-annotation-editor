# Fiction Annotation Editor

A browser application for reviewing character names, aliases, genders, and dialogue speakers in fiction XML. The site runs on GitHub Pages. A Google Apps Script web app receives summary statistics in Google Sheets and serves the administrator's published weekly leaderboard.

There is no build step and no server for the project owner to operate. Apps Script provides the small hosted receiving service; Google Sheets stores the work reports. XML editing and per-item review history remain in the browser and exported XML.

## Start here

- Editors: [EDITOR_GUIDE.md](EDITOR_GUIDE.md).
- Site and spreadsheet administrator: [ADMIN_SETUP.md](ADMIN_SETUP.md).
- Hosted editor: <https://yuecui.github.io/fiction-annotation-editor/>.

Keep all the application's HTML, CSS, and JavaScript files together. Deploy the contents of this directory to the existing GitHub Pages source directory. The configured receiver URL is in `stats-config.js`; the supplied package already contains the project's deployed `/exec` URL.

The editor's Tailwind styles are bundled locally in `vendor/tailwind.css`; its editing and reward interfaces do not depend on a styling CDN. An internet connection is needed for report submission and leaderboard retrieval. The help page's Markdown renderer still uses its existing CDN. The intended deployment is the HTTPS GitHub Pages website; opening a local copy in a different browser or origin does not share the site's saved editor identity or pending reports.

## Editor behavior

The XML DOM is the source of truth. The editor supports canonical-name edits, separate alias elements, gender values, speaker search, speaker reassignment, new characters, Not dialogue decisions, and optional `cert`, `source`, and `resp` changes.

Manual speaker assignment sets `who`, records manual provenance, and removes stale automated confidence. **Not dialogue** removes only the quotation wrapper while retaining its text and child content. A local review-history comment preserves the original quotation information for a future review application.

The character and dialogue badges show **unresolved items remaining**. They are separate from the contribution counts in an export summary.

### XML save behavior

`story.xml` becomes `resolved_story.xml`; an existing `resolved_` prefix is retained exactly once. The editor preserves the real XML root and restores an original XML declaration. A temporary wrapper is removed only when the editor added it for an XML fragment.

In browsers supporting a file save picker, the editor asks for a destination and can reuse that destination during the same page session. Selecting the existing file lets the editor replace it with permission. Cancelling the picker does not settle the batch or clear the unsaved-change state.

Other browsers initiate a download. They decide whether a same-name file is replaced or renamed. The application reports **Download started**, because it cannot verify that the browser finished saving the file; the unsaved-change warning remains conservative. Check the downloaded copy before leaving the page.

## Export rewards and work reports

On first use, the editor asks for a name and remembers it in this browser together with a stable editor UUID. Each editor should keep using their usual browser and website address. There is no account login or persistent editor-switching control.

Every successful save or initiated fallback download opens a summary with five categories:

| Report field | Contribution | XP |
| --- | --- | ---: |
| `genders_marked` | An unknown gender receives a known value, including for a new person | 1 per item |
| `genders_corrected` | An existing gender value is corrected | 1 per item |
| `dialogues_identified` | An unresolved quotation receives a speaker | 1 per item |
| `dialogues_corrected` | An existing speaker assignment is corrected | 1 per item |
| `not_dialogue` | A quotation is marked Not dialogue | 1 per item |

Counts compare the final state with the previous export baseline. Existing annotations loaded from a file do not earn points. An item can contribute only once in its category during one batch. For example, unknown → Male → Female earns one newly marked gender; Male → Female → Male earns zero. Assigning a speaker and then marking that quote Not dialogue earns one Not dialogue decision. Repeated exports without new changes earn no additional XP. A meaningful correction in a later batch can count again.

Names, aliases, and advanced provenance metadata are still saved in XML, but are not among the five reward categories.

### Submission and recovery

The summary's **Send report** button submits the frozen batch. Reports are not sent automatically. **Reports** reopens saved pending and sent reports so an editor can retry a report later.

Saving XML and sending a report are separate operations. The receiver gets only the editor name, filename, identifiers, five counters, and effective duration. It does not receive the fiction text, XML, or per-item audit history.

Each report has a random submission UUID and a SHA-256 hash of its exact JSON request body. Retries retain both the UUID and body. The receiver rejects a reused UUID with different content and ignores duplicate submissions of the same body. The interface marks a report sent only after a read-only receipt confirms that exact batch; an opaque `no-cors` response alone is not success.

Pending reports are stored on this browser's device. Closing and reopening the same website can preserve them, but clearing site data, using another browser/profile, or a private session can lose the local identity and queue. A report queue is not a backup of the XML. Export and retain the actual XML separately.

### Effective work time

The browser estimates active work time, including reading, searching, and scrolling. Timing pauses while the page is hidden or unfocused, while a statistics dialog or save picker is open, and after 10 minutes without activity. Activity resumes the timer without charging the inactive gap.

Duration is stored as `active_seconds` and `active_minutes` in the administrator's `WorkLog`. It is not displayed in the editor, export summary, or leaderboard and does not contribute to XP or rank. This is a browser activity estimate, not a precise measure of attention or annotation quality.

Long-running or resumed sessions can create additional **0 XP** pending reports that preserve an earlier work-time interval. These retain their original work dates, do not reset the annotation baseline, and are not sent automatically. Editors can use **Send … pending reports** in Reports to send all pending batches. Administrators should sum `active_seconds` across all of an editor's records, including records whose `points` value is zero.

## Weekly leaderboard

The Apps Script function `prepareWeeklyLeaderboard()` creates an unpublished draft for the preceding complete Monday–Sunday week in `America/Chicago`. The administrator reviews it in `WeeklyLeaderboard` and sets that week's `published` cells to `TRUE` when ready.

The site requests the latest eligible published week. New boards appear on a later website visit, and the **Leaderboard** control can reopen the board. The score is the sum of all five categories. Equal scores receive equal rank. Effective duration is never returned in the public leaderboard response.

Draft creation does not overwrite an existing draft or automatically add late reports to it. See [ADMIN_SETUP.md](ADMIN_SETUP.md) for the publication and late-submission workflow.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Existing editor layout and styling |
| `vendor/tailwind.css` | Locally bundled utility styles; retain the accompanying license |
| `core.js` | XML load, shared state, and XML helpers |
| `characters.js` | Character names, aliases, and gender editing |
| `dialogue.js` | Reader, quote navigation, and speaker editing |
| `app.js` | Tabs, unresolved counters, and XML export |
| `stats-config.js` | Receiver URL and project settings |
| `stats-engine.js` | Net-change counting and effective timer |
| `stats-service.js` | Durable report queue, sending, receipts, and leaderboard reads |
| `stats-controller.js`, `rewards.css` | Export settlement, editor identity, celebration, reports, and leaderboard UI |
| `annotation-xml.js` | XML parsing, stable IDs, and local review-history comments |
| `stats_backend/Code.gs` | Copy of the deployed Apps Script service |
| `help.html`, `EDITOR_GUIDE.md` | Editor instructions |
| `ADMIN_SETUP.md` | Deployment, spreadsheet, and weekly publication instructions |

`index.html` defines the module load order. Do not replace only `app.js` when updating the site.

## XML review-history comments

Exported XML includes versioned comments carrying base64-encoded UTF-8 JSON. The reader ignores these comments; they do not become story text or Google Sheet data.

| Comment prefix | Purpose |
| --- | --- |
| `fiction-annotation-document:v1:` | Stable document identity across exports and filename changes |
| `fiction-annotation-excluded:v1:` | Original quotation ID, text/XML, editor, and decision time for Not dialogue |
| `fiction-annotation-batch:v1:` | Export batch identity, editor, and per-item changes |

Base64 protects the XML-comment syntax when story text contains characters such as `--`. These comments prepare the data for the future review application; they do not implement that application. Preserve them when processing exported XML if the review history is needed. Existing and generated person/quotation IDs must also be preserved.

## Transport and privacy boundaries

The receiver supports read-only health, receipt, and leaderboard endpoints. The frontend uses a text/plain POST for a frozen report and JSONP for receipt and leaderboard reads across origins. Only published leaderboard columns are returned publicly; raw work logs and durations remain in the private spreadsheet.

This is a small-team self-reporting workflow. The stored editor UUID prevents accidental fragmentation within the same browser, but it is not authenticated identity. The public receiving endpoint and local counters do not verify that annotations are correct. The separate review application is intended to address annotation review later.

## Development and verification

No package installation or frontend build is required. Test through a local HTTP server or the deployed HTTPS origin.

The bundled CSS is ready to host. If utility classes in the source change, an optional rebuild uses:

```bash
npx tailwindcss@3.4.17 --content './index.html,./help.html,./*.js' --output vendor/tailwind.css --minify
```

Before publishing changes, check JavaScript syntax, export round trips, and these behaviors:

1. Existing annotations load without contribution credit; valid root/declaration and IDs survive export.
2. Gender and speaker corrections, reversions, and Not dialogue classify by final net state.
3. Save cancellation preserves work; unchanged repeated exports do not duplicate points.
4. Pending reports survive reload; retries reuse the exact body and need receipt confirmation.
5. Reading time pauses for hidden/unfocused/idle/modal states and never appears in editor UI.
6. Only an eligible published board is displayed; ties and duration privacy are preserved.
7. Name/alias editing, previous/next unresolved navigation, and both scrolling layouts still work.

Local mock tests do not prove that a production Google deployment accepts writes. The first genuine editor report should be checked in `WorkLog` as part of deployment acceptance.
