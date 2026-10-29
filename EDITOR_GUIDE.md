# Fiction Annotation Editor — Editor Guide

Use this editor to review character information and assign speakers to dialogue. You do not need to edit XML by hand.

## 1. Start a session

1. Open <https://yuecui.github.io/fiction-annotation-editor/> in your usual browser.
2. Click **Choose File** and select the XML file you are working on.
3. On first use, enter the name you want your work reports to use. The editor remembers it on this browser.
4. Review the loaded character and dialogue information.

Keep using the same browser and website address. Private browsing, clearing website data, or moving to another browser can remove the remembered identity and pending reports. Your XML remains a separate local file: save it regularly and reopen your latest exported copy when returning to work.

## 2. Review character names, aliases, and genders

Open **Character Genders**. Its badge shows how many characters still have an unknown gender; it is not your reward count.

Use **Canonical Name** for the main name. Alternate spellings, titles, and nicknames belong in separate aliases. You can edit or remove an alias, or enter one and click **+ Alias**. Pressing Enter in the add-alias field also adds it.

Use the **Sex / Gender** dropdown to select **Unknown**, **Female**, **Male**, or **Gender Ambiguous**. Correct existing values when necessary. A source, when present, appears below the field.

Use **Remove** only for a character entry that should not remain. The confirmation explains whether any speaker assignments are affected. Removing a referenced character returns those quotations to unresolved so the XML does not retain a broken speaker reference.

## 3. Select a quotation and assign its speaker

Open **Dialogue Attribution**. Yellow quotations are unresolved; green quotations already have a speaker. Click a highlighted quotation to focus it. The **Dialogue Focus** box shows the selected text.

Search in **Select Speaker** by canonical name, alias, or XML ID. Click the correct person's button to assign that speaker. The editor records a manual decision, removes stale automated confidence, and moves to the next unresolved quotation.

You can click a green quotation to correct its speaker too. The exported summary counts corrections separately from newly identified dialogue.

## 4. Navigate or mark Not dialogue

Use **Skip / Next Unresolved →** when you want to move on without assigning a speaker. Use the previous-unresolved control to go back. If you are unsure, skip the quotation and return to it later.

If highlighted text should not be treated as dialogue, select it and use **Not dialogue**. Confirm the decision when asked. The quotation wrapper is removed while its text and inner content remain in the story. The exported XML also retains a review record so the decision can be inspected later.

## 5. Add a person or alias

Click **+ Add Person / Alias** when the speaker list needs an addition.

- For a missing person, choose **Create a new person**, enter the canonical name and gender if known, and save. The new person becomes available as a speaker.
- For an existing person with a missing name variant, choose **Add alias to an existing person**, select the person, enter the alias, and save.

Search existing names and aliases before creating another person to avoid duplicates.

## 6. Review advanced metadata when needed

The selected quotation can show `who`, `cert`, `source`, and `resp`. Normal work usually only requires selecting a speaker.

Use **Enable Editing XML Attributes** when you intentionally need to change the additional fields. Click **Save Attribute Changes** to commit them. These edits are included in XML, but do not add reward points.

## 7. Save your XML

Click **Save XML** to export the current document. The filename has exactly one `resolved_` prefix:

| Loaded filename | Suggested export filename |
| --- | --- |
| `story.xml` | `resolved_story.xml` |
| `resolved_story.xml` | `resolved_story.xml` |
| `resolved_resolved_story.xml` | `resolved_story.xml` |

In supported browsers, choose a local destination in the Save dialog. You can select the existing resolved file and confirm replacement. Later saves during that page session reuse the selected destination. Cancelling the dialog leaves your work available for the next save.

Other browsers start a download. The browser may add a number to the filename if a copy already exists. Check the new downloaded XML and replace the previous copy yourself if needed. **Download started** does not confirm that the browser completed the save.

Saving includes name and alias changes, gender decisions, new people, speaker assignments, Not dialogue decisions, and advanced metadata. Sending a work report does not save or back up the XML.

## 8. Review the celebration and summary

After export, a short celebration accompanies a summary of this batch's work. You can skip the animation and continue immediately. The summary has five categories:

| Category | What counts |
| --- | --- |
| Genders marked | An unknown gender receives a value |
| Genders corrected | An existing gender value is changed |
| Dialogues identified | An unresolved quotation receives a speaker |
| Dialogues corrected | An existing speaker assignment is changed |
| Not dialogue | A quotation is excluded from dialogue |

Each counted item earns **1 XP**. The editor compares the final result with the state at your previous export. Existing work in the loaded file does not count as newly completed work.

Examples:

- Unknown → Male → Female before one export counts as one gender marked.
- Male → Female → Male before one export counts as zero because the final value did not change.
- Assigning a speaker and then choosing Not dialogue for the same quotation counts as one Not dialogue decision.
- Saving again without new changes gives no additional XP.
- Correcting an earlier exported decision in a later batch can count as a correction.

Canonical names, aliases, and metadata are useful edits and are saved, but they are not reward categories.

## 9. Send the work report

Click **Send report** in the export summary. Your name, filename, five counts, and effective work duration are submitted to the project's statistics spreadsheet. The fiction text and XML are not submitted.

Wait for confirmation. If the network fails or confirmation has not arrived, the report remains pending on your browser. Continue working if needed; open **Reports** later to find the pending batch and retry it. Retrying the same report does not add duplicate points.

Reports are sent only when you choose to send them. Closing a summary does not send its report. Saving XML and sending a report have separate statuses, so check both before finishing your work session.

If several batches are waiting, **Reports** offers a **Send … pending reports** button. Long or resumed sessions may include additional **0 XP** reports for earlier work; send those too. They preserve the work record without awarding extra annotation points or changing the next export's contribution counts.

The editor estimates effective work duration while you work, including reading and scrolling. It pauses for inactive/hidden pages, dialogs, and long idle periods. Duration is visible only in the administrator's work log. It is not shown in your summary or used in ranking.

Do not clear this website's browser data while reports are pending. A pending report is stored only in that browser until its submission is confirmed.

## 10. View the weekly leaderboard

The project administrator reviews and publishes a leaderboard for a completed week. A newly published board can appear when you next open the website. Use **Leaderboard** to reopen it.

There is one leaderboard combining all five contribution categories. Each counted item is worth one point; tied scores share a rank. Work duration does not affect the ranking.

If no board is available yet, you can keep editing and submitting reports. Publishing the board is a separate weekly administrator step.

## 11. Finish your session

1. Save the XML and confirm the local file is available.
2. Review the export summary and click **Send report**.
3. Confirm the report is sent, or leave it in **Reports** to retry later.
4. Keep the latest `resolved_...xml` for your next session.

The browser warns before leaving when it believes XML edits are unsaved. If you need to keep those changes, cancel navigation and save. For fallback downloads, the warning can remain because the editor cannot confirm the download finished; verify the file yourself before proceeding.

## Common questions

### I cannot find a speaker

Search by first name, last name, title, nickname, or alias. If the person exists but the name variant is missing, add an alias. Create a new person only when needed.

### The unresolved count did not change

Selecting a quotation does not resolve it. Choose its speaker, or use Not dialogue if it should not be a dialogue quotation. The unresolved badge and the export contribution counts measure different things.

### My original file has not changed

Loading a file grants read access. Save XML either writes to the destination you choose or downloads a new copy. Continue from the latest exported file.

### The report is pending even though I clicked Send report

The editor has not received confirmation for that exact batch yet. Retry it from **Reports** when the connection is available. Keep using the same browser; do not clear website data.

### Can I recover my XML from the spreadsheet?

No. The spreadsheet stores summary statistics, not the XML or story text. Keep the exported file.
