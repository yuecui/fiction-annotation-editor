    function renderReaderStep() {
      const readerContent = document.getElementById('reader-content');
      const readerPane = document.getElementById('reader-pane');
      const previousScroll = readerPane?.scrollTop || 0;
      readerContent.innerHTML = '';
      const bodies = AnnotationXml.elements(activeXmlDoc, 'body');
      const texts = AnnotationXml.elements(activeXmlDoc, 'text');
      const candidates = bodies.length ? bodies : texts.length ? texts : [activeXmlDoc.documentElement];
      const readingRoots = candidates.filter(candidate => !candidates.some(other =>
        other !== candidate && other.contains(candidate)));
      const blockTags = new Set(['body', 'text', 'div', 'chapter', 'section', 'lg', 'l']);

      function appendReadingNode(node, target) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
          target.appendChild(document.createTextNode(node.textContent));
          return;
        }
        // Comments contain local audit JSON, and processing instructions are
        // not story text. Neither should ever be displayed to an annotator.
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.localName || node.nodeName.split(':').pop();
        if (['teiHeader', 'listPerson', 'person', 'standOff', 'facsimile'].includes(tag)) return;
        let element;
        if (tag === 'q' || tag === 'quotation') {
          element = document.createElement('q');
          const quoteId = AnnotationXml.id(node);
          element.dataset.xmlId = quoteId;
          element.className = isUnknownSpeaker(node.getAttribute('who')) ? 'dialogue-unresolved' : 'dialogue-resolved';
          if (quoteId === activeDialogueId) element.classList.add('dialogue-active');
          element.tabIndex = 0;
          element.setAttribute('role', 'button');
          element.setAttribute('aria-label', `Review quotation: ${(node.textContent || '').slice(0, 160)}`);
          element.addEventListener('click', event => {
            event.stopPropagation();
            selectDialogue(quoteId);
          });
          element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              selectDialogue(quoteId);
            }
          });
        } else if (tag === 'lb') {
          element = document.createElement('br');
        } else {
          element = document.createElement(tag === 'p' ? 'p' : tag === 'head' ? 'h3' : blockTags.has(tag) ? 'div' : 'span');
          if (tag === 'hi') {
            const rendition = node.getAttribute('rend') || '';
            if (/italic/i.test(rendition)) element.style.fontStyle = 'italic';
            if (/bold/i.test(rendition)) element.style.fontWeight = 'bold';
          }
        }
        Array.from(node.childNodes).forEach(child => appendReadingNode(child, element));
        target.appendChild(element);
      }

      readingRoots.forEach(readingRoot => appendReadingNode(readingRoot, readerContent));
      if (readerPane) readerPane.scrollTop = previousScroll;
      renderSpeakerButtons();
    }

    function isUnknownSpeaker(value) {
      return !String(value || '').trim() || /^#?unknown$/i.test(String(value).trim());
    }

    function findReaderDialogueById(xmlId) {
      return Array.from(document.querySelectorAll('#reader-content q[data-xml-id]'))
        .find(element => element.dataset.xmlId === xmlId) || null;
    }

    function findXmlDialogueById(xmlId) {
      return AnnotationXml.elements(activeXmlDoc, 'q', 'quotation')
        .find(node => AnnotationXml.id(node) === xmlId) || null;
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
      const targetElem = findReaderDialogueById(xmlId);
      if (!targetElem) return;
      commitOpenMetadata();
      document.querySelectorAll('#reader-content q.dialogue-active').forEach(el => {
        el.classList.remove('dialogue-active');
      });

      activeDialogueId = xmlId;
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
      const xmlNode = findXmlDialogueById(xmlId);
      if (!xmlNode) return;
      document.getElementById('dialogue-metadata-card').classList.remove('hidden');
      const who = xmlNode.getAttribute('who') || '#unknown';
      const speakerChar = charactersList.find(c => c.id === who);
      
      document.getElementById('meta-current-speaker').textContent = speakerChar ? speakerChar.name : who;
      document.getElementById('xml-meta-who').textContent = who;
      document.getElementById('xml-meta-cert').textContent = xmlNode.getAttribute('cert') || 'N/A';
      document.getElementById('xml-meta-source').textContent = xmlNode.getAttribute('source') || 'N/A';
      document.getElementById('xml-meta-resp').textContent = xmlNode.getAttribute('resp') || 'N/A';
    }

    function focusNextUnresolved() {
      commitOpenMetadata();
      const allDialogues = Array.from(document.querySelectorAll('#reader-content q[data-xml-id]'));
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
      commitOpenMetadata();
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
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode || (!charactersList.some(character => character.id === speakerId) && speakerId !== '#unknown')) return;
      commitOpenMetadata();
      const quoteId = activeDialogueId;

      // Update HTML DOM
      const htmlElem = findReaderDialogueById(quoteId);
      if (htmlElem) {
        htmlElem.classList.toggle('dialogue-unresolved', isUnknownSpeaker(speakerId));
        htmlElem.classList.toggle('dialogue-resolved', !isUnknownSpeaker(speakerId));
      }

      // Update Source XML
      xmlNode.setAttribute('who', speakerId);
      const annotations = (xmlNode.getAttribute('ana') || '').split(/\s+/).filter(token => token && token !== '#speaker-resolved');
      if (!isUnknownSpeaker(speakerId)) annotations.push('#speaker-resolved');
      if (annotations.length) xmlNode.setAttribute('ana', annotations.join(' '));
      else xmlNode.removeAttribute('ana');

      // This assignment was explicitly made by a person in this editor.
      xmlNode.removeAttribute('cert');
      xmlNode.setAttribute('source', 'manual-editor');
      xmlNode.setAttribute('resp', 'manual-editor');
      markDirty();
      window.AnnotationStats?.touchDialogue(quoteId);
      updateBadges();
      focusNextUnresolved();
    }

    function markActiveQuotationNotDialogue() {
      commitOpenMetadata();
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode) {
        alert('Select a quotation first.');
        return;
      }
      if (xmlNode === activeXmlDoc.documentElement) {
        alert('This quotation is the XML document root. Put it inside a containing story element before marking it as not dialogue, so the exported file keeps a valid root.');
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
      const dialogueNodes = AnnotationXml.elements(activeXmlDoc, 'q', 'quotation');
      const currentIndex = dialogueNodes.indexOf(xmlNode);
      let nextUnresolvedId = null;
      for (let i = currentIndex + 1; i < dialogueNodes.length; i++) {
        const who = dialogueNodes[i].getAttribute('who') || '#unknown';
        if (isUnknownSpeaker(who)) {
          nextUnresolvedId = AnnotationXml.id(dialogueNodes[i]);
          if (nextUnresolvedId) break;
        }
      }
      if (!nextUnresolvedId) {
        for (let i = 0; i < currentIndex; i++) {
          const who = dialogueNodes[i].getAttribute('who') || '#unknown';
          if (isUnknownSpeaker(who)) {
            nextUnresolvedId = AnnotationXml.id(dialogueNodes[i]);
            if (nextUnresolvedId) break;
          }
        }
      }

      // Unwrap <q>/<quotation>: move all child nodes into the parent at the
      // same position, then remove only the quotation element itself.
      const parent = xmlNode.parentNode;
      if (!parent) return;
      try {
        if (window.AnnotationStats) window.AnnotationStats.excludeQuotation(xmlNode);
        else AnnotationXml.addExclusion(activeXmlDoc, xmlNode, { excluded_at: new Date().toISOString() });
      } catch (error) {
        alert(`The quotation was kept because its review record could not be saved: ${error?.message || error}`);
        return;
      }
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

      if (nextUnresolvedId && findReaderDialogueById(nextUnresolvedId)) {
        selectDialogue(nextUnresolvedId);
      } else {
        focusNextUnresolved();
      }
    }

    function getActiveDialogueXmlNode() {
      if (!activeDialogueId) return null;
      return findXmlDialogueById(activeDialogueId);
    }

    function enableTwoStepEditing() {
      commitOpenMetadata();
      const xmlNode = getActiveDialogueXmlNode();
      if (!xmlNode) return;

      document.getElementById('input-meta-cert').value = xmlNode.getAttribute('cert') || '';
      document.getElementById('input-meta-source').value = xmlNode.getAttribute('source') || '';
      document.getElementById('input-meta-resp').value = xmlNode.getAttribute('resp') || '';
      document.getElementById('meta-edit-form').dataset.quoteId = AnnotationXml.id(xmlNode);
      document.getElementById('meta-edit-form').classList.remove('hidden');
      document.getElementById('btn-toggle-edit').classList.add('hidden');
    }

    function saveAdvancedMetadata() {
      commitOpenMetadata();
    }

    function commitOpenMetadata() {
      const form = document.getElementById('meta-edit-form');
      if (!form || form.classList.contains('hidden')) return false;
      const originId = form.dataset.quoteId;
      const xmlNode = originId ? findXmlDialogueById(originId) : null;
      let changed = false;

      const fields = [
        ['cert', document.getElementById('input-meta-cert').value.trim()],
        ['source', document.getElementById('input-meta-source').value.trim()],
        ['resp', document.getElementById('input-meta-resp').value.trim()]
      ];

      fields.forEach(([attribute, value]) => {
        if (!xmlNode) return;
        const prior = xmlNode.getAttribute(attribute) || '';
        if (prior === value) return;
        if (value) xmlNode.setAttribute(attribute, value);
        else xmlNode.removeAttribute(attribute);
        changed = true;
      });

      if (changed) markDirty();
      form.classList.add('hidden');
      delete form.dataset.quoteId;
      document.getElementById('btn-toggle-edit').classList.remove('hidden');
      if (xmlNode && activeDialogueId === originId) displayDialogueMetadata(originId);
      return changed;
    }

    function getActiveDialogueSpeakerRawId() {
      if (!activeDialogueId) return null;
      const who = getActiveDialogueXmlNode()?.getAttribute('who');
      if (isUnknownSpeaker(who)) return null;
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
      const usedIds = new Set(AnnotationXml.elements(activeXmlDoc).flatMap(node =>
        [node.getAttribute('xml:id'), node.getAttribute('id')].filter(Boolean)));
      AnnotationXml.readExclusions(activeXmlDoc).forEach(record => usedIds.add(record.quote_id));
      while (usedIds.has(newId)) {
        newId = `${baseId}-${suffix++}`;
      }

      let listPerson = AnnotationXml.elements(activeXmlDoc, 'listPerson')[0] || null;
      const xmlNamespace = listPerson?.namespaceURI || charactersList[0]?.element.namespaceURI || activeXmlDoc.documentElement.namespaceURI;
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
      markDirty();
      window.AnnotationStats?.touchGender(newId);

      nameInput.value = '';
      genderInput.value = 'unknown';
      document.getElementById('new-character-form').classList.add('hidden');
      document.getElementById('speaker-search').value = '';

      renderGenderStep();
      renderSpeakerButtons();
      updateBadges();
    }

