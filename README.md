# Fiction Annotation Editor

A browser-based XML editing tool for reviewing character metadata and resolving dialogue speaker attribution in fiction texts.

The application is designed for lightweight editorial use without requiring users to edit XML directly. It supports canonical names, aliases, sex/gender metadata, dialogue attribution, manual provenance tracking, and XML export.

## Features

- Load an XML file directly in the browser.
- Review and edit character canonical names.
- Review, add, edit, and remove character aliases.
- Review and update sex/gender values.
- Search speakers by canonical name, alias, or XML ID.
- Resolve dialogue speaker attribution interactively.
- Add new people or add aliases to existing people.
- Mark manual dialogue resolution with editor provenance.
- Review and edit dialogue metadata such as `cert`, `source`, and `resp`.
- Export all committed changes back to XML.
- Warn users before leaving the page when edits have not yet been exported.

## Project Structure

```text
fiction-annotation-editor/
├── index.html          # Interface structure
├── styles.css          # Custom styling
├── app.js              # XML parsing and editing logic
├── app.txt             # Plain-text copy of app.js
├── README.md           # Developer documentation
└── EDITOR_GUIDE.md     # Interface guide for editors
```

## Running the Application

No build system is required.

Keep `index.html`, `styles.css`, and `app.js` in the same directory, then open `index.html` in a modern browser.

The interface currently loads Tailwind CSS from a CDN:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

An internet connection is therefore required for the intended Tailwind-based styling unless Tailwind is bundled locally in a future version.

## Main Application Flow

The application keeps an in-memory XML DOM in `activeXmlDoc`.

The basic flow is:

```text
Upload XML
    ↓
Parse XML with DOMParser
    ↓
Build character model
    ↓
Render character review interface
    ↓
Render dialogue reading interface
    ↓
Apply editorial changes directly to activeXmlDoc
    ↓
Serialize activeXmlDoc
    ↓
Export edited XML
```

The uploaded source file is never overwritten directly.

## Character Model

The editor supports person records such as:

```xml
<person xml:id="spk-adolphus-irwine">
  <persName type="canonical">Adolphus Irwine</persName>
  <persName type="alias">Irwine</persName>
  <persName type="alias">Mester Irwine</persName>
  <persName type="alias">Mr. Irwine</persName>
  <sex value="male" source="#name-gender-csv" />
</person>
```

The application treats:

- `persName[@type="canonical"]` as the primary display name;
- `persName[@type="alias"]` as alternate searchable names;
- `sex/@value` as the current sex/gender value;
- `sex/@source` as provenance when present.

Speaker search checks canonical names, aliases, and XML IDs.

## Dialogue Attribution

Dialogue is read from `<q>` and `<quotation>` elements.

A quotation is treated as unresolved when its `who` attribute is absent or equivalent to `#unknown` under the current logic.

When an editor manually assigns a speaker, the application updates the quotation approximately as follows:

```xml
<quotation
  xml:id="q00108"
  who="#spk-mr-joshua-rann"
  ana="#speaker-resolved"
  source="manual-editor"
  resp="manual-editor">
  ...
</quotation>
```

A stale automated `cert` value is removed during manual attribution so an earlier machine confidence value is not mistakenly presented as confidence in the human decision.

## XML Editing Behavior

Edits are applied directly to the in-memory XML DOM rather than to the rendered HTML alone.

This includes:

- canonical-name changes;
- alias additions, edits, and removals;
- sex/gender changes;
- newly created people;
- speaker assignments;
- dialogue metadata changes.

Because export serializes `activeXmlDoc`, committed edits are retained in the downloaded XML.

## XML Namespace Handling

The application uses namespace-aware element creation where needed so newly created XML nodes remain structurally consistent with namespaced source documents.

When modifying this code, avoid assuming that all XML files are namespace-free. In particular, newly created elements such as `person`, `persName`, and `sex` should follow the namespace of the surrounding XML structure whenever possible.

## Export Behavior

The export function serializes the current in-memory XML document using `XMLSerializer`.

Important behaviors include:

- all committed edits are included;
- currently open advanced metadata edits are committed before export;
- an application-added temporary `<root>` wrapper is removed only when the application itself added it;
- an original `<root>` element is preserved;
- the original XML declaration is preserved/restored when applicable;
- the downloaded filename is prefixed with `resolved_`.

## Unsaved-Work Protection

The application tracks whether changes have occurred since the most recent export.

When the document is dirty, a `beforeunload` handler asks the browser to warn the user before closing, reloading, or navigating away.

Modern browsers control the wording of this confirmation message, so custom warning text cannot be guaranteed.

After a successful export, the document is marked clean until another edit occurs.

## UI Organization

The interface has two primary tabs:

### Character Genders

Used to review and edit:

- canonical names;
- aliases;
- XML IDs;
- sex/gender values;
- sex/gender provenance.

The badge shows the number of characters whose sex/gender value remains unresolved or unknown.

### Dialogue Attribution

Used to:

- select dialogue from the reading pane;
- find speakers by name, alias, or ID;
- assign speakers;
- add new people;
- add aliases to existing people;
- advance through unresolved dialogue;
- inspect or edit dialogue metadata.

The badge shows the number of unresolved quotations.

## Development Notes

### No framework dependency

The editor currently uses plain JavaScript and browser DOM APIs. There is no front-end framework or build pipeline.

### State

Core runtime state is maintained in JavaScript variables such as:

```javascript
activeXmlDoc
charactersList
activeDialogueId
```

When extending the application, ensure that UI state and the XML DOM remain synchronized.

### Rendered HTML is not the source of truth

The XML DOM should remain the authoritative data source. UI changes that only alter HTML without updating `activeXmlDoc` will not survive export.

### Character aliases

Aliases should remain separate XML elements rather than being flattened into one string or merged into the canonical name.

### Manual provenance

Human speaker selections should remain distinguishable from automated attribution. Do not leave stale machine provenance in place after a human editor changes the attribution.

## Testing Checklist

Before committing changes, test at least the following:

1. Load an XML file containing people and quotations.
2. Confirm character and dialogue counts are correct.
3. Edit a canonical name.
4. Add, edit, and remove an alias.
5. Change a sex/gender value.
6. Search for a speaker using both canonical name and alias.
7. Assign a speaker to an unresolved quotation.
8. Use **Skip / Next Unresolved**.
9. Create a new person.
10. Add an alias to an existing person.
11. Edit advanced dialogue metadata.
12. Export the XML.
13. Inspect the exported XML and confirm all changes are present.
14. Make another edit and verify that closing/reloading triggers the unsaved-work warning.
15. Export again and verify that the warning is cleared until the next change.

For JavaScript syntax validation, a quick check can be run with Node.js:

```bash
node --check app.js
```

## Editor Documentation

Instructions intended for nontechnical editors are kept separately in:

```text
EDITOR_GUIDE.md
```

That file focuses on how to use the interface rather than implementation details.
