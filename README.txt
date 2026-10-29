Fiction Annotation Editor — rewards and statistics update

Deploy the contents of this folder to the existing GitHub Pages source directory.
Replace all application HTML, CSS, and JavaScript files together, including the
new stats files. Keep the existing repository and its Pages settings.

The deployed Google Apps Script /exec URL is already in stats-config.js.
stats_backend/Code.gs is a copy of the receiving script already deployed.
The frontend update does not require redeploying that unchanged script.

After GitHub Pages publishes the update, hard refresh the website:
macOS: Command + Shift + R
Windows/Linux: Ctrl + Shift + R

Editors enter their name once, load their XML, and work normally. Save XML opens
a five-category summary. Send report submits the batch; Reports reopens pending
and sent reports. Retrying a pending report does not give duplicate credit.
Use the Send pending reports action when several batches are waiting. Long or
resumed sessions can include 0 XP reports that retain earlier effective time.
Those reports are not sent automatically and do not alter annotation counts.

The XML filename keeps exactly one resolved_ prefix. Supported browsers can
reuse a chosen local save destination. Other browsers start a download; verify
the downloaded file before closing the page. Sending statistics does not upload
or back up the XML.

Each week, run prepareWeeklyLeaderboard() in Apps Script, review the previous
week's draft in WeeklyLeaderboard, then set every approved row's published cell
to TRUE. Work weeks use America/Chicago. Duration stays in WorkLog and is not
ranked or shown to editors.

Full editor instructions: EDITOR_GUIDE.md
Administrator and weekly publication instructions: ADMIN_SETUP.md
Developer overview and report/audit design: README.md
