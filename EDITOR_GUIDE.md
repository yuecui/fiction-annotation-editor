# Fiction Annotation Editor — Editor Guide

This guide explains how to use the **Fiction Annotation Editor** to review character information and assign speakers to dialogue.

You do not need to edit XML by hand.

## 1. Open the Editor

1. Open `index.html` in your web browser.
2. Click **Choose File**.
3. Select the XML file you want to review.
4. Wait for the editor to load the character and dialogue information.

The editor does **not** overwrite your original XML file. Your work stays in the browser until you export a new XML file.

## 2. Review Character Information

The first tab is **Character Genders**.

The number beside the tab tells you how many characters still have an unknown or unresolved sex/gender value.

Each character card may show:

- canonical name;
- aliases;
- XML ID;
- sex/gender;
- source of the sex/gender information.

### Edit the canonical name

Use the **Canonical Name** field when the person's main name needs correction.

Do not replace the canonical name with a nickname or alternate spelling if that form should instead be an alias.

### Review aliases

Aliases appear underneath the canonical name.

You can:

- edit an alias;
- remove an alias;
- add a new alias.

Use aliases for alternate forms of the same person's name, for example:

```text
Adolphus Irwine
Irwine
Mester Irwine
Mr. Irwine
Rev. Adolphus Irwine
```

### Add an alias

Type the new alias in the alias field and use **+ Alias**.

You can also press **Enter** after typing the alias.

### Review sex/gender

Use the **Sex / Gender** dropdown to correct the value when necessary.

If a source is available, it is shown below the field so you can see where the existing value came from.

## 3. Open Dialogue Attribution

Click the **Dialogue Attribution** tab.

The number beside this tab shows how many quotations still need a speaker assignment.

In the reading pane:

- unresolved dialogue is highlighted in yellow;
- resolved dialogue is highlighted in green.

## 4. Select a Dialogue

Click any highlighted quotation in the reading pane.

The selected quotation appears in the **Dialogue Focus** box on the left side of the interface.

This is the quotation you are currently editing.

## 5. Find and Assign the Speaker

The **Select Speaker** panel appears directly below the selected quotation.

Start typing the person's name in the search field.

The search can match:

- the canonical name;
- an alias;
- the person's XML ID.

For example, if the same character has these names:

```text
Adolphus Irwine
Mr. Irwine
Mester Irwine
```

typing any of those forms can help locate the same person.

When you find the correct person, click that person's button.

The dialogue will be marked as resolved and the editor will move to another unresolved quotation.

## 6. Move to the Next Unresolved Dialogue

Use:

**Skip / Next Unresolved →**

This moves to the next unresolved quotation without assigning the current one.

Use this when you are unsure who is speaking and want to return to the quotation later.

## 7. Add a Missing Person

If the speaker does not exist in the character list, click:

**+ Add Person / Alias**

Choose **Create a new person**.

Enter:

- the person's canonical name;
- sex/gender, if known.

Then save the person.

The new person will become available in the speaker list.

Before creating a new person, search the existing names and aliases first so you do not accidentally create a duplicate character.

## 8. Add a Missing Alias to an Existing Person

Sometimes the person already exists, but the form of the name used in the text is missing.

Click:

**+ Add Person / Alias**

Then choose **Add alias to an existing person**.

1. Select the correct existing person.
2. Enter the new alias.
3. Click **Save**.

If the current quotation already has a speaker, the editor may automatically select that person for you.

## 9. Review Dialogue Metadata When Needed

For the selected quotation, the interface may show:

- `who`;
- `cert`;
- `source`;
- `resp`.

For normal editorial work, you usually only need to choose the correct speaker.

Use **Enable Editing XML Attributes** only when you specifically need to change this additional metadata.

After changing metadata, click **Save Attribute Changes**.

## 10. How Manual Speaker Assignment Is Recorded

When you choose a speaker manually, the editor marks the result as a human editorial decision.

It records the dialogue as manually resolved rather than leaving the previous automated source information in place.

You do not need to enter this information yourself; the editor handles it automatically when you assign the speaker.

## 11. Export Your Work

Click **Export XML** in the upper-right corner when you want to save your edits.

The browser downloads a new XML file with a name beginning with:

```text
resolved_
```

For example:

```text
resolved_story.xml
```

The exported file includes your committed edits, including:

- canonical-name changes;
- alias changes;
- sex/gender changes;
- newly added people;
- dialogue speaker assignments;
- dialogue metadata changes.

## 12. Export Before Closing the Page

Your edits are stored in the browser until you export them.

If you have made changes since the last export and then try to:

- close the tab;
- reload the page;
- navigate away;

the browser will display a warning.

If you want to keep your current work, cancel the close or reload action and click **Export XML** first.

After exporting, the warning is cleared until you make another change.

## 13. Recommended Workflow

For a complete review session:

1. Upload the XML file.
2. Review character canonical names.
3. Review aliases.
4. Review unknown sex/gender values.
5. Open **Dialogue Attribution**.
6. Work through unresolved quotations.
7. Search for the speaker by canonical name or alias.
8. Add a missing alias when the person already exists.
9. Add a new person only when necessary.
10. Skip quotations you cannot confidently resolve.
11. Export your XML regularly during a long editing session.
12. Export once more before closing the editor.

## 14. Common Problems

### I cannot find the speaker

Try searching by:

- first name;
- last name;
- title;
- nickname;
- known alias.

If the person exists but the name form is missing, add an alias rather than creating a duplicate person.

### The person is not in the list at all

Use **+ Add Person / Alias** and create a new person.

### The unresolved count did not change

Selecting a quotation does not resolve it. You must click a speaker to assign that person to the quotation.

### I changed something but the original XML file did not change

This is expected. The editor never overwrites the uploaded file.

Click **Export XML** and use the downloaded `resolved_...xml` file.

### The browser warns me when I try to close the page

You have made changes since your last export.

If you want to keep those changes, stay on the page and export the XML before closing.

### I am unsure who is speaking

Do not guess. Use **Skip / Next Unresolved →** and return to the quotation later.
