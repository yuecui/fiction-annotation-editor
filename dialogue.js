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
            <span class="text-xs text-slate-500">${escapeHtml(char.gender === 'non-binary' ? 'gender-ambiguous' : char.gender)}</span>
          </span>
          ${aliases}`;
        container.appendChild(btn);
      });
    }

    function scrollDialogueIntoReaderView(targetElem) {
      const readerPane = document.getElementById('reader-pane');
      if (!readerPane || !targetElem) return;

      // Chrome is most reliable when the right pane is the only scrolling
      // ancestor. Measure after layout, then scroll that pane by the exact
      // delta between the quote center and pane center.
      requestAnimationFrame(() => {
        const paneRect = readerPane.getBoundingClientRect();
        const targetRect = targetElem.getBoundingClientRect();
        const delta = (targetRect.top + targetRect.height / 2) -
                      (paneRect.top + paneRect.height / 2);

        readerPane.scrollTop = readerPane.scrollTop + delta;

        // Re-check after Chrome applies the first scroll. This also handles
        // inline quotations that wrap across multiple lines.
        requestAnimationFrame(() => {
          const paneRect2 = readerPane.getBoundingClientRect();
          const targetRect2 = targetElem.getBoundingClientRect();
          const correction = (targetRect2.top + targetRect2.height / 2) -
                             (paneRect2.top + paneRect2.height / 2);
          if (Math.abs(correction) > 2) {
            readerPane.scrollTop = readerPane.scrollTop + correction;
          }
        });
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

        // Chrome needs the Dialogue Attribution layout to finish updating before
        // measuring the quotation. Two animation frames make this reliable when
        // switching from the Character Genders tab and when using Skip / Next.
        scrollDialogueIntoReaderView(targetElem);

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

    function focusPreviousUnresolved() {
      const unresolvedElements = Array.from(
        document.querySelectorAll('#reader-content q[data-xml-id].dialogue-unresolved')
      );

      if (unresolvedElements.length === 0) {
        document.getElementById('selected-dialogue-preview').textContent = "All dialogues are resolved! 🎉";
        document.getElementById('dialogue-metadata-card').classList.add('hidden');
        activeDialogueId = null;
        return;
      }

      // Navigate within the unresolved list itself. If the current quotation is
      // resolved (or nothing is selected), go to the nearest previous unresolved
      // quotation in document order, wrapping to the last unresolved item.
      const allDialogues = Array.from(document.querySelectorAll('#reader-content q[data-xml-id]'));
      const currentIndex = activeDialogueId
        ? allDialogues.findIndex(el => el.getAttribute('data-xml-id') === activeDialogueId)
        : -1;

      let target = null;
      if (currentIndex < 0) {
        target = unresolvedElements[unresolvedElements.length - 1];
      } else {
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (allDialogues[i].classList.contains('dialogue-unresolved')) {
            target = allDialogues[i];
            break;
          }
        }
        if (!target) target = unresolvedElements[unresolvedElements.length - 1];
      }

      selectDialogue(target.getAttribute('data-xml-id'));
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

    function markActiveQuotationNotDialogue() {
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode) {
        alert('Select a quotation first.');
        return;
      }

      const quoteText = (xmlNode.textContent || '').trim();
      const preview = quoteText.length > 120 ? `${quoteText.slice(0, 117)}...` : quoteText;
      const confirmed = confirm(
        `Mark this quotation as not dialogue?\n\n“${preview}”\n\nThe <${xmlNode.nodeName}> tag will be removed, but its text and any content inside it will remain in the document.`
      );
      if (!confirmed) return;

      // Remember the next unresolved quotation before changing the XML so the
      // editor can continue from the same point in the document.
      const dialogueNodes = Array.from(activeXmlDoc.querySelectorAll('q, quotation'));
      const currentIndex = dialogueNodes.indexOf(xmlNode);
      let nextUnresolvedId = null;
      for (let i = currentIndex + 1; i < dialogueNodes.length; i++) {
        const who = dialogueNodes[i].getAttribute('who') || '#unknown';
        if (who === '#unknown') {
          nextUnresolvedId = dialogueNodes[i].getAttribute('xml:id') || dialogueNodes[i].getAttribute('id');
          if (nextUnresolvedId) break;
        }
      }
      if (!nextUnresolvedId) {
        for (let i = 0; i < currentIndex; i++) {
          const who = dialogueNodes[i].getAttribute('who') || '#unknown';
          if (who === '#unknown') {
            nextUnresolvedId = dialogueNodes[i].getAttribute('xml:id') || dialogueNodes[i].getAttribute('id');
            if (nextUnresolvedId) break;
          }
        }
      }

      // Unwrap <q>/<quotation>: move all child nodes into the parent at the
      // same position, then remove only the quotation element itself.
      const parent = xmlNode.parentNode;
      if (!parent) return;
      while (xmlNode.firstChild) {
        parent.insertBefore(xmlNode.firstChild, xmlNode);
      }
      parent.removeChild(xmlNode);

      activeDialogueId = null;
      markDirty();
      renderReaderStep();
      updateBadges();
      document.getElementById('dialogue-metadata-card').classList.add('hidden');
      document.getElementById('selected-dialogue-preview').textContent = 'Quotation marked as not dialogue. Its text was preserved.';

      if (nextUnresolvedId && document.querySelector(`q[data-xml-id="${nextUnresolvedId}"]`)) {
        selectDialogue(nextUnresolvedId);
      } else {
        focusNextUnresolved();
      }
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

