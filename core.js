let activeXmlDoc = null;
    let fileName = "edited_fiction.xml";
    let charactersList = [];
    let activeDialogueId = null;
    let hasUnsavedChanges = false;


    const featureHelpContent = {
      upload: {
        title: 'Upload XML',
        text: 'Choose the XML file you want to review. The file is processed locally in your browser. After it loads, review character information first and then continue to dialogue attribution.'
      },
      characters: {
        title: 'Character Names & Genders',
        text: 'Review each canonical name, aliases, and sex/gender value. You can edit names, add or remove aliases, and correct the gender value. These edits are written into the XML that will be exported.'
      },
      dialogue: {
        title: 'Dialogue Focus',
        text: 'The highlighted quotation is the dialogue currently being reviewed. Click any highlighted quote in the text, or use “Skip / Next Unresolved” to move to the next unresolved quotation.'
      },
      speaker: {
        title: 'Select Speaker',
        text: 'Type part of a canonical name, alias, or speaker ID to filter the list. Click a person to assign that speaker to the active quotation. The assignment is recorded as a manual editor decision.'
      },
      personAlias: {
        title: 'Add Person / Alias',
        text: 'Use this when the correct speaker is missing from the list or when the text uses a name variant that should be recorded. You can create a new person or add an alias to an existing person.'
      },
      metadata: {
        title: 'Attribution Details',
        text: 'This section shows the XML attributes for the active quotation, including who, certainty, source, and responsibility. Use advanced editing only when you intentionally need to change those metadata fields.'
      },
      export: {
        title: 'Export XML',
        text: 'Download a new XML file containing all saved edits made in this session. Export regularly, especially before closing or reloading the page. After export, the page treats the current work as saved.'
      }
    };

    function showFeatureHelp(event, key) {
      event.preventDefault();
      event.stopPropagation();

      const data = featureHelpContent[key];
      const popover = document.getElementById('feature-help-popover');
      if (!data || !popover) return;

      document.getElementById('feature-help-title').textContent = data.title;
      document.getElementById('feature-help-text').textContent = data.text;

      popover.classList.remove('hidden');
      popover.style.visibility = 'hidden';

      const buttonRect = event.currentTarget.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 12;

      let left = buttonRect.left + (buttonRect.width / 2) - (popoverRect.width / 2);
      left = Math.max(margin, Math.min(left, window.innerWidth - popoverRect.width - margin));

      let top = buttonRect.bottom + 8;
      if (top + popoverRect.height > window.innerHeight - margin) {
        top = buttonRect.top - popoverRect.height - 8;
      }
      top = Math.max(margin, top);

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.visibility = 'visible';
    }

    function hideFeatureHelp() {
      const popover = document.getElementById('feature-help-popover');
      if (popover) popover.classList.add('hidden');
    }

    document.addEventListener('click', function(event) {
      const popover = document.getElementById('feature-help-popover');
      if (!popover || popover.classList.contains('hidden')) return;
      if (!popover.contains(event.target) && !event.target.closest('.feature-help-btn')) {
        hideFeatureHelp();
      }
    });

    window.addEventListener('resize', hideFeatureHelp);
    window.addEventListener('scroll', hideFeatureHelp, true);

    function markDirty() {
      if (activeXmlDoc) hasUnsavedChanges = true;
    }

    function markClean() {
      hasUnsavedChanges = false;
    }

    window.addEventListener('beforeunload', function(event) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    });

    // Mark editable form changes as unsaved immediately, even before an input loses focus.
    document.addEventListener('input', function(event) {
      const target = event.target;
      if (!activeXmlDoc || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      if (target.id === 'speaker-search') return;
      if (target.closest('#screen-editor')) markDirty();
    });
    let usedSyntheticRoot = false;
    let originalHadXmlDeclaration = false;

    document.getElementById('xml-input').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;

      fileName = file.name;
      document.getElementById('file-status').textContent = fileName;
      
      const reader = new FileReader();
      reader.onload = function(evt) {
        let rawContent = evt.target.result;
        const trimmedContent = rawContent.trim();
        originalHadXmlDeclaration = trimmedContent.startsWith('<?xml');
        usedSyntheticRoot = !originalHadXmlDeclaration && !trimmedContent.startsWith('<root');

        if (usedSyntheticRoot) {
          rawContent = `<root>${rawContent}</root>`;
        }

        const parser = new DOMParser();
        activeXmlDoc = parser.parseFromString(rawContent, "text/xml");

        // Ensure all quote tags have valid XML IDs
        let idCounter = 1;
        activeXmlDoc.querySelectorAll('q, quotation').forEach(node => {
          let id = node.getAttribute('xml:id') || node.getAttribute('id');
          if (!id) {
            id = `auto-q-${idCounter++}`;
            node.setAttribute('xml:id', id);
          }
        });

        document.getElementById('screen-upload').classList.add('hidden');
        document.getElementById('screen-editor').classList.remove('hidden');
        initializeData();
        markClean();
      };
      reader.readAsText(file);
    });

    function getDirectPersNames(person) {
      return Array.from(person.children).filter(child => child.localName === 'persName' || child.nodeName === 'persName');
    }

    function initializeData() {
      charactersList = [];
      const personNodes = activeXmlDoc.querySelectorAll('person');
      personNodes.forEach(person => {
        const id = person.getAttribute('xml:id') || person.getAttribute('id') || `char-${Math.random()}`;
        const persNames = getDirectPersNames(person);
        const canonicalNode = persNames.find(node => node.getAttribute('type') === 'canonical') || persNames[0] || null;
        const name = canonicalNode?.textContent.trim() || id;
        const aliases = persNames
          .filter(node => node !== canonicalNode && (node.getAttribute('type') === 'alias' || node.getAttribute('type') !== 'canonical'))
          .map(node => node.textContent.trim())
          .filter(Boolean);

        const sexNode = Array.from(person.children).find(child => child.localName === 'sex' || child.nodeName === 'sex') || null;
        let gender = 'unknown';
        if (sexNode) {
          gender = sexNode.getAttribute('value') || sexNode.textContent.trim().toLowerCase() || 'unknown';
        }

        charactersList.push({
          id: `#${id}`,
          rawId: id,
          name,
          aliases,
          gender,
          element: person,
          canonicalNode,
          sexNode
        });
      });

      renderGenderStep();
      renderReaderStep();
      updateBadges();
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

