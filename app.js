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

    function renderGenderStep() {
      const container = document.getElementById('gender-cards-container');
      container.innerHTML = '';

      if (charactersList.length === 0) {
        container.innerHTML = `<p class="text-slate-500 italic">No character entities found in file.</p>`;
        return;
      }

      charactersList.forEach(char => {
        const isUnresolved = char.gender === 'unknown';
        const card = document.createElement('div');
        card.className = isUnresolved
          ? "bg-amber-50/60 p-4 rounded-lg border-2 border-amber-300 shadow-sm transition-colors"
          : "bg-white p-4 rounded-lg border border-slate-200 shadow-sm transition-colors";

        const aliasRows = char.aliases.length
          ? char.aliases.map((alias, index) => `
              <div class="flex gap-2 items-center">
                <input type="text" value="${escapeHtml(alias)}"
                  onchange="updateCharacterAlias('${char.rawId}', ${index}, this.value)"
                  class="flex-1 border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                  aria-label="Alias ${index + 1} for ${escapeHtml(char.name)}">
                <button type="button" onclick="removeCharacterAlias('${char.rawId}', ${index})"
                  class="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100">Remove</button>
              </div>`).join('')
          : `<div class="text-xs text-slate-400 italic">No aliases.</div>`;

        card.innerHTML = `
          <div class="flex items-start justify-between gap-4 mb-3">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-bold uppercase tracking-wide text-slate-500">Canonical name</span>
                ${isUnresolved ? '<span class="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full font-semibold uppercase">Gender unresolved</span>' : ''}
              </div>
              <input type="text" value="${escapeHtml(char.name)}"
                onchange="updateCanonicalName('${char.rawId}', this.value)"
                class="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-semibold text-slate-800 bg-white">
              <div class="text-xs text-slate-400 mt-1">ID: ${escapeHtml(char.id)}</div>
            </div>
            <div class="shrink-0 min-w-[140px]">
              <label class="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Sex / Gender</label>
              <select onchange="updateCharacterGender('${char.rawId}', this.value)" class="w-full bg-white border border-slate-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 shadow-sm">
                <option value="unknown" ${char.gender === 'unknown' ? 'selected' : ''}>Unknown</option>
                <option value="female" ${char.gender === 'female' ? 'selected' : ''}>Female</option>
                <option value="male" ${char.gender === 'male' ? 'selected' : ''}>Male</option>
                <option value="non-binary" ${char.gender === 'non-binary' ? 'selected' : ''}>Non-binary</option>
              </select>
              ${char.sexNode?.getAttribute('source') ? `<div class="text-[10px] text-slate-400 mt-1">Source: ${escapeHtml(char.sexNode.getAttribute('source'))}</div>` : ''}
            </div>
          </div>
          <div class="border-t border-slate-100 pt-3">
            <div class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Aliases</div>
            <div class="space-y-2">${aliasRows}</div>
            <div class="flex gap-2 mt-2">
              <input id="alias-add-${char.rawId}" type="text" placeholder="Add alias..."
                class="flex-1 border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                onkeydown="if(event.key === 'Enter'){ event.preventDefault(); addAliasFromGenderCard('${char.rawId}'); }">
              <button type="button" onclick="addAliasFromGenderCard('${char.rawId}')"
                class="text-xs px-3 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-semibold">+ Alias</button>
            </div>
          </div>`;
        container.appendChild(card);
      });
    }

    function createXmlElementForPerson(person, tagName) {
      const xmlNamespace = person?.namespaceURI || activeXmlDoc.documentElement.namespaceURI;
      return xmlNamespace
        ? activeXmlDoc.createElementNS(xmlNamespace, tagName)
        : activeXmlDoc.createElement(tagName);
    }

    function updateCanonicalName(personId, newName) {
      const char = charactersList.find(c => c.rawId === personId);
      if (!char) return;
      newName = newName.trim();
      if (!newName) {
        renderGenderStep();
        return;
      }

      let node = char.canonicalNode;
      if (!node) {
        node = createXmlElementForPerson(char.element, 'persName');
        node.setAttribute('type', 'canonical');
        char.element.insertBefore(node, char.element.firstChild);
        char.canonicalNode = node;
      } else {
        node.setAttribute('type', 'canonical');
      }
      node.textContent = newName;
      char.name = newName;
      renderSpeakerButtons();
      populateAliasPersonSelect();
    }

    function getAliasNodes(char) {
      return getDirectPersNames(char.element).filter(node => node !== char.canonicalNode && node.getAttribute('type') === 'alias');
    }

    function updateCharacterAlias(personId, aliasIndex, newAlias) {
      const char = charactersList.find(c => c.rawId === personId);
      if (!char) return;
      const aliasNodes = getAliasNodes(char);
      const node = aliasNodes[aliasIndex];
      if (!node) return;
      const value = newAlias.trim();
      if (!value) {
        removeCharacterAlias(personId, aliasIndex);
        return;
      }
      node.textContent = value;
      char.aliases[aliasIndex] = value;
      renderSpeakerButtons();
    }

    function addAliasToCharacter(personId, alias) {
      const char = charactersList.find(c => c.rawId === personId || c.id === personId);
      if (!char) return false;
      const value = alias.trim();
      if (!value) return false;
      if ([char.name, ...char.aliases].some(name => name.toLowerCase() === value.toLowerCase())) return false;

      const node = createXmlElementForPerson(char.element, 'persName');
      node.setAttribute('type', 'alias');
      node.textContent = value;

      const sexNode = Array.from(char.element.children).find(child => child.localName === 'sex' || child.nodeName === 'sex');
      if (sexNode) char.element.insertBefore(node, sexNode);
      else char.element.appendChild(node);

      char.aliases.push(value);
      renderGenderStep();
      renderSpeakerButtons();
      populateAliasPersonSelect(char.rawId);
      return true;
    }

    function addAliasFromGenderCard(personId) {
      const input = document.getElementById(`alias-add-${personId}`);
      if (!input) return;
      if (addAliasToCharacter(personId, input.value)) input.value = '';
    }

    function removeCharacterAlias(personId, aliasIndex) {
      const char = charactersList.find(c => c.rawId === personId);
      if (!char) return;
      const aliasNodes = getAliasNodes(char);
      const node = aliasNodes[aliasIndex];
      if (node) node.remove();
      char.aliases.splice(aliasIndex, 1);
      renderGenderStep();
      renderSpeakerButtons();
    }

    function updateCharacterGender(personId, newGender) {
    const char = charactersList.find(c => c.rawId === personId);
    if (!char) return;

    char.gender = newGender;

    let sexNode = char.sexNode || Array.from(char.element.children).find(child => child.localName === 'sex' || child.nodeName === 'sex') || null;
    if (!sexNode) {
        const xmlNamespace = char.element.namespaceURI || activeXmlDoc.documentElement.namespaceURI;
        sexNode = xmlNamespace
          ? activeXmlDoc.createElementNS(xmlNamespace, 'sex')
          : activeXmlDoc.createElement('sex');
        char.element.appendChild(sexNode);
        char.sexNode = sexNode;
    }
    sexNode.setAttribute('value', newGender);

    // Refresh card styling and badge count
    renderGenderStep();
    updateBadges();
    renderSpeakerButtons();
    }
    function renderReaderStep() {
      const readerContent = document.getElementById('reader-content');
      readerContent.innerHTML = '';
      let paragraphs = activeXmlDoc.querySelectorAll('p');
      if (paragraphs.length === 0) paragraphs = [activeXmlDoc.documentElement];

      paragraphs.forEach(p => {
        const pElem = document.createElement('p');
        p.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            pElem.appendChild(document.createTextNode(node.textContent));
          } else if (node.nodeName === 'q' || node.nodeName === 'quotation') {
            const qElem = document.createElement('q');
            const qId = node.getAttribute('xml:id') || node.getAttribute('id');
            const who = node.getAttribute('who') || '#unknown';
            const isUnresolved = who === '#unknown';

            qElem.setAttribute('data-xml-id', qId);
            qElem.textContent = node.textContent;
            qElem.className = isUnresolved ? 'dialogue-unresolved' : 'dialogue-resolved';
            qElem.onclick = () => selectDialogue(qId);
            pElem.appendChild(qElem);
          } else {
            const span = document.createElement('span');
            span.textContent = node.textContent;
            pElem.appendChild(span);
          }
        });
        readerContent.appendChild(pElem);
      });
      renderSpeakerButtons();
    }

    function renderSpeakerButtons() {
      const container = document.getElementById('speaker-buttons');
      const searchInput = document.getElementById('speaker-search');
      const searchText = (searchInput?.value || '').trim().toLowerCase();

      container.innerHTML = '';

      const matches = charactersList.filter(char => {
        if (!searchText) return true;
        return char.name.toLowerCase().includes(searchText) ||
               char.rawId.toLowerCase().includes(searchText) ||
               char.aliases.some(alias => alias.toLowerCase().includes(searchText));
      });

      if (matches.length === 0) {
        container.innerHTML = `<div class="text-xs text-slate-500 italic p-2">No matching person. You can add the typed name as an alias or create a new person above.</div>`;
        return;
      }

      matches.forEach(char => {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.className = "w-full text-left p-2.5 rounded-lg border border-indigo-100 bg-white hover:bg-indigo-100 text-sm transition";
        btn.onclick = () => assignSpeakerToActiveDialogue(char.id);
        const aliases = char.aliases.length
          ? `<span class="block text-[10px] text-slate-500 mt-1">Aliases: ${char.aliases.map(escapeHtml).join(', ')}</span>`
          : '';
        btn.innerHTML = `
          <span class="flex items-center justify-between gap-2">
            <span>
              <span class="font-semibold text-slate-800">${escapeHtml(char.name)}</span>
              <span class="block text-[10px] text-slate-400">${escapeHtml(char.id)}</span>
            </span>
            <span class="text-xs text-slate-500">${escapeHtml(char.gender)}</span>
          </span>
          ${aliases}`;
        container.appendChild(btn);
      });
    }

    function selectDialogue(xmlId) {
      document.querySelectorAll('q.dialogue-active').forEach(el => {
        el.classList.remove('dialogue-active');
      });

      activeDialogueId = xmlId;
      const targetElem = document.querySelector(`q[data-xml-id="${xmlId}"]`);
      if (targetElem) {
        targetElem.classList.add('dialogue-active');

        // Scroll only the reading pane vertically. Using scrollIntoView() can cause
        // Chrome to horizontally scroll the whole flex layout and hide the sidebar.
        const readerPane = document.getElementById('reader-pane');
        if (readerPane) {
          const paneRect = readerPane.getBoundingClientRect();
          const targetRect = targetElem.getBoundingClientRect();
          const targetCenterWithinPane = (targetRect.top - paneRect.top) + (targetRect.height / 2);
          const nextScrollTop = readerPane.scrollTop + targetCenterWithinPane - (readerPane.clientHeight / 2);
          readerPane.scrollTo({
            top: Math.max(0, nextScrollTop),
            behavior: 'smooth'
          });
        }

        document.getElementById('selected-dialogue-preview').textContent = `"${targetElem.textContent}"`;
        displayDialogueMetadata(xmlId);
      }
    }

    function displayDialogueMetadata(xmlId) {
      document.getElementById('dialogue-metadata-card').classList.remove('hidden');
      let xmlNode = null;
      activeXmlDoc.querySelectorAll('q, quotation').forEach(node => {
        const id = node.getAttribute('xml:id') || node.getAttribute('id');
        if (id === xmlId) xmlNode = node;
      });

      if (!xmlNode) return;
      const who = xmlNode.getAttribute('who') || '#unknown';
      const speakerChar = charactersList.find(c => c.id === who);
      
      document.getElementById('meta-current-speaker').textContent = speakerChar ? speakerChar.name : who;
      document.getElementById('xml-meta-who').textContent = who;
      document.getElementById('xml-meta-cert').textContent = xmlNode.getAttribute('cert') || 'N/A';
      document.getElementById('xml-meta-source').textContent = xmlNode.getAttribute('source') || 'N/A';
      document.getElementById('xml-meta-resp').textContent = xmlNode.getAttribute('resp') || 'N/A';
    }

    function focusNextUnresolved() {
      const allDialogues = Array.from(document.querySelectorAll('q[data-xml-id]'));
      const unresolvedElements = allDialogues.filter(el => el.classList.contains('dialogue-unresolved'));

      if (unresolvedElements.length === 0) {
        document.getElementById('selected-dialogue-preview').textContent = "All dialogues are resolved! 🎉";
        document.getElementById('dialogue-metadata-card').classList.add('hidden');
        activeDialogueId = null;
        return;
      }

      // Move forward from the currently active dialogue, wrapping to the start.
      const currentIndex = activeDialogueId
        ? allDialogues.findIndex(el => el.getAttribute('data-xml-id') === activeDialogueId)
        : -1;

      let target = null;
      for (let offset = 1; offset <= allDialogues.length; offset++) {
        const candidate = allDialogues[(currentIndex + offset) % allDialogues.length];
        if (candidate.classList.contains('dialogue-unresolved')) {
          target = candidate;
          break;
        }
      }

      if (target) selectDialogue(target.getAttribute('data-xml-id'));
    }

    function assignSpeakerToActiveDialogue(speakerId) {
      if (!activeDialogueId) return;

      // Update HTML DOM
      const htmlElem = document.querySelector(`q[data-xml-id="${activeDialogueId}"]`);
      if (htmlElem) {
        htmlElem.classList.remove('dialogue-unresolved');
        htmlElem.classList.add('dialogue-resolved');
      }

      // Update Source XML
      activeXmlDoc.querySelectorAll('q, quotation').forEach(xmlNode => {
        const id = xmlNode.getAttribute('xml:id') || xmlNode.getAttribute('id');
        if (id === activeDialogueId) {
          xmlNode.setAttribute('who', speakerId);
          xmlNode.setAttribute('ana', '#speaker-resolved');

          // This assignment was explicitly made by a person in this editor.
          // Remove any stale automated confidence and provenance values so the
          // exported XML does not imply that the enrichment script made it.
          xmlNode.removeAttribute('cert');
          xmlNode.setAttribute('source', 'manual-editor');
          xmlNode.setAttribute('resp', 'manual-editor');
        }
      });

      updateBadges();
      focusNextUnresolved();
    }

    function getActiveDialogueXmlNode() {
      if (!activeDialogueId) return null;

      return Array.from(activeXmlDoc.querySelectorAll('q, quotation')).find(node => {
        const id = node.getAttribute('xml:id') || node.getAttribute('id');
        return id === activeDialogueId;
      }) || null;
    }

    function enableTwoStepEditing() {
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode) return;

      document.getElementById('input-meta-cert').value = xmlNode.getAttribute('cert') || '';
      document.getElementById('input-meta-source').value = xmlNode.getAttribute('source') || '';
      document.getElementById('input-meta-resp').value = xmlNode.getAttribute('resp') || '';
      document.getElementById('meta-edit-form').classList.remove('hidden');
      document.getElementById('btn-toggle-edit').classList.add('hidden');
    }

    function saveAdvancedMetadata() {
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode) return;

      const fields = [
        ['cert', document.getElementById('input-meta-cert').value.trim()],
        ['source', document.getElementById('input-meta-source').value.trim()],
        ['resp', document.getElementById('input-meta-resp').value.trim()]
      ];

      fields.forEach(([attribute, value]) => {
        if (value) xmlNode.setAttribute(attribute, value);
        else xmlNode.removeAttribute(attribute);
      });

      displayDialogueMetadata(activeDialogueId);
      document.getElementById('meta-edit-form').classList.add('hidden');
      document.getElementById('btn-toggle-edit').classList.remove('hidden');
    }

    function getActiveDialogueSpeakerRawId() {
      if (!activeDialogueId) return null;
      let who = null;
      activeXmlDoc.querySelectorAll('q, quotation').forEach(node => {
        const id = node.getAttribute('xml:id') || node.getAttribute('id');
        if (id === activeDialogueId) who = node.getAttribute('who');
      });
      if (!who || who === '#unknown') return null;
      return who.replace(/^#/, '');
    }

    function populateAliasPersonSelect(preferredId = null) {
      const select = document.getElementById('alias-person-select');
      if (!select) return;
      const selectedId = preferredId || select.value || getActiveDialogueSpeakerRawId();
      select.innerHTML = '';
      charactersList.forEach(char => {
        const option = document.createElement('option');
        option.value = char.rawId;
        option.textContent = `${char.name} (${char.rawId})`;
        if (char.rawId === selectedId) option.selected = true;
        select.appendChild(option);
      });
    }

    function updateNewCharacterFormMode() {
      const mode = document.getElementById('new-char-action').value;
      const personFields = document.getElementById('new-person-fields');
      const aliasFields = document.getElementById('new-alias-fields');
      personFields.classList.toggle('hidden', mode !== 'person');
      aliasFields.classList.toggle('hidden', mode !== 'alias');
      if (mode === 'alias') {
        populateAliasPersonSelect(getActiveDialogueSpeakerRawId());
        document.getElementById('new-alias-name').focus();
      } else {
        document.getElementById('new-char-name').focus();
      }
    }

    function toggleNewCharacterModal() {
      const form = document.getElementById('new-character-form');
      form.classList.toggle('hidden');

      if (!form.classList.contains('hidden')) {
        const activeSpeaker = getActiveDialogueSpeakerRawId();
        const searchText = (document.getElementById('speaker-search')?.value || '').trim();
        const action = document.getElementById('new-char-action');

        if (activeSpeaker) {
          action.value = 'alias';
          populateAliasPersonSelect(activeSpeaker);
          if (searchText) document.getElementById('new-alias-name').value = searchText;
        } else {
          action.value = 'person';
          if (searchText) document.getElementById('new-char-name').value = searchText;
        }
        updateNewCharacterFormMode();
      }
    }

    function saveNewCharacterAction() {
      const mode = document.getElementById('new-char-action').value;
      if (mode === 'alias') {
        const personId = document.getElementById('alias-person-select').value;
        const aliasInput = document.getElementById('new-alias-name');
        if (!aliasInput.value.trim()) {
          aliasInput.focus();
          return;
        }
        if (addAliasToCharacter(personId, aliasInput.value)) {
          aliasInput.value = '';
          document.getElementById('new-character-form').classList.add('hidden');
          document.getElementById('speaker-search').value = '';
          renderSpeakerButtons();
        }
        return;
      }
      createNewCharacter();
    }

    function createNewCharacter() {
      const nameInput = document.getElementById('new-char-name');
      const genderInput = document.getElementById('new-char-gender');
      const name = nameInput.value.trim();
      const gender = genderInput.value;

      if (!name) {
        nameInput.focus();
        return;
      }

      let baseId = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'person';

      if (!/^[A-Za-z_]/.test(baseId)) baseId = `person-${baseId}`;
      if (!baseId.startsWith('spk-')) baseId = `spk-${baseId}`;

      let newId = baseId;
      let suffix = 2;
      while (charactersList.some(char => char.rawId === newId)) {
        newId = `${baseId}-${suffix++}`;
      }

      const xmlNamespace = activeXmlDoc.documentElement.namespaceURI;
      const createXmlElement = (tagName) => xmlNamespace
        ? activeXmlDoc.createElementNS(xmlNamespace, tagName)
        : activeXmlDoc.createElement(tagName);

      const person = createXmlElement('person');
      person.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:id', newId);

      const persName = createXmlElement('persName');
      persName.setAttribute('type', 'canonical');
      persName.textContent = name;
      person.appendChild(persName);

      const sex = createXmlElement('sex');
      sex.setAttribute('value', gender);
      sex.setAttribute('source', '#manual-editor');
      person.appendChild(sex);

      let listPerson = activeXmlDoc.querySelector('listPerson');
      if (!listPerson) {
        listPerson = createXmlElement('listPerson');
        activeXmlDoc.documentElement.appendChild(listPerson);
      }
      listPerson.appendChild(person);

      charactersList.push({
        id: `#${newId}`,
        rawId: newId,
        name,
        aliases: [],
        gender,
        element: person,
        canonicalNode: persName,
        sexNode: sex
      });

      nameInput.value = '';
      genderInput.value = 'unknown';
      document.getElementById('new-character-form').classList.add('hidden');
      document.getElementById('speaker-search').value = '';

      renderGenderStep();
      renderSpeakerButtons();
      updateBadges();
    }

    function switchStep(step) {
      const genderTab = document.getElementById('tab-gender');
      const dialogueTab = document.getElementById('tab-dialogue');

      const setActiveTab = (activeTab, inactiveTab) => {
        activeTab.classList.remove('border-transparent', 'text-slate-500');
        activeTab.classList.add('border-indigo-600', 'text-indigo-600');

        inactiveTab.classList.remove('border-indigo-600', 'text-indigo-600');
        inactiveTab.classList.add('border-transparent', 'text-slate-500');
      };

      if (step === 'gender') {
        document.getElementById('view-gender').classList.remove('hidden');
        document.getElementById('view-dialogue').classList.add('hidden');
        setActiveTab(genderTab, dialogueTab);
      } else {
        document.getElementById('view-gender').classList.add('hidden');
        document.getElementById('view-dialogue').classList.remove('hidden');
        setActiveTab(dialogueTab, genderTab);
        if (!activeDialogueId) focusNextUnresolved();
      }
    }

    function updateBadges() {
      const unresolvedDialogues = document.querySelectorAll('q.dialogue-unresolved').length;
      const unresolvedGenders = charactersList.filter(char => char.gender === 'unknown').length;

      document.getElementById('badge-gender-count').textContent = unresolvedGenders;
      document.getElementById('badge-dialogue-count').textContent = unresolvedDialogues;
      document.getElementById('counter-unresolved').textContent = unresolvedDialogues;
    }

    function exportUpdatedXML() {
      if (!activeXmlDoc) return;

      // If the metadata editor is currently open, treat the visible field values
      // as the user's latest edit and write them to the XML before exporting.
      const metaEditForm = document.getElementById('meta-edit-form');
      if (activeDialogueId && metaEditForm && !metaEditForm.classList.contains('hidden')) {
        const xmlNode = getActiveDialogueXmlNode();
        if (xmlNode) {
          const fields = [
            ['cert', document.getElementById('input-meta-cert').value.trim()],
            ['source', document.getElementById('input-meta-source').value.trim()],
            ['resp', document.getElementById('input-meta-resp').value.trim()]
          ];

          fields.forEach(([attribute, value]) => {
            if (value) xmlNode.setAttribute(attribute, value);
            else xmlNode.removeAttribute(attribute);
          });
        }
      }

      const serializer = new XMLSerializer();
      let xmlString;

      // Only remove <root> when this application added it as a temporary wrapper.
      // A genuine <root> element from the user's source file must be preserved.
      if (usedSyntheticRoot && activeXmlDoc.documentElement.tagName === 'root') {
        xmlString = Array.from(activeXmlDoc.documentElement.childNodes)
          .map(node => serializer.serializeToString(node))
          .join('');
      } else {
        xmlString = serializer.serializeToString(activeXmlDoc);
      }

      // DOMParser/XMLSerializer does not reliably retain the XML declaration.
      // Restore one when the uploaded document originally contained it.
      if (originalHadXmlDeclaration && !xmlString.trimStart().startsWith('<?xml')) {
        xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n${xmlString}`;
      }

      const blob = new Blob([xmlString], { type: "application/xml;charset=utf-8" });
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = `resolved_${fileName}`;
      document.body.appendChild(link);
      link.click();
      markClean();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
