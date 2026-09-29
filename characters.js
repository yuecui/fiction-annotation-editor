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
          <div class="character-card-header flex items-center justify-between gap-3 mb-4">
            <span class="text-xs font-bold uppercase tracking-wide text-slate-500">Character</span>
            <button type="button" onclick="removeCharacterCard('${char.rawId}')"
              class="text-xs px-3 py-1.5 rounded-md bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 font-semibold transition-colors">
              Remove
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div class="min-w-0">
              <label class="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Canonical Name</label>
              <input type="text" value="${escapeHtml(char.name)}"
                onchange="updateCanonicalName('${char.rawId}', this.value)"
                class="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <div class="text-xs text-slate-400 mt-1.5">ID: ${escapeHtml(char.id)}</div>
            </div>

            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <label class="text-xs font-bold uppercase tracking-wide text-slate-500">Sex / Gender</label>
                ${isUnresolved ? '<span class="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide">Unresolved</span>' : ''}
              </div>
              <select onchange="updateCharacterGender('${char.rawId}', this.value)"
                class="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 shadow-sm">
                <option value="unknown" ${char.gender === 'unknown' ? 'selected' : ''}>Unknown</option>
                <option value="female" ${char.gender === 'female' ? 'selected' : ''}>Female</option>
                <option value="male" ${char.gender === 'male' ? 'selected' : ''}>Male</option>
                <option value="non-binary" ${char.gender === 'non-binary' ? 'selected' : ''}>Non-binary</option>
              </select>
              ${char.sexNode?.getAttribute('source') ? `<div class="text-[10px] text-slate-400 mt-1.5">Source: ${escapeHtml(char.sexNode.getAttribute('source'))}</div>` : ''}
            </div>
          </div>

          <div class="border-t border-slate-200 pt-4">
            <div class="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Aliases</div>
            <div class="space-y-2">${aliasRows}</div>
            <div class="flex gap-2 mt-3">
              <input id="alias-add-${char.rawId}" type="text" placeholder="Add alias..."
                class="flex-1 min-w-0 border border-slate-300 rounded-md px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onkeydown="if(event.key === 'Enter'){ event.preventDefault(); addAliasFromGenderCard('${char.rawId}'); }">
              <button type="button" onclick="addAliasFromGenderCard('${char.rawId}')"
                class="shrink-0 text-xs px-3 py-2 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-semibold">+ Alias</button>
            </div>
          </div>`;
        container.appendChild(card);
      });
    }

    function removeCharacterCard(personId) {
      const charIndex = charactersList.findIndex(c => c.rawId === personId);
      if (charIndex === -1) return;

      const char = charactersList[charIndex];
      const speakerId = char.id;
      const affectedDialogues = [];

      activeXmlDoc.querySelectorAll('q, quotation').forEach(node => {
        const whoTokens = (node.getAttribute('who') || '')
          .split(/\s+/)
          .filter(Boolean);
        if (whoTokens.includes(speakerId)) affectedDialogues.push(node);
      });

      let message = `Remove “${char.name}” from the XML?`;
      if (affectedDialogues.length > 0) {
        const noun = affectedDialogues.length === 1 ? 'quotation' : 'quotations';
        message += `\n\nThis character is currently assigned to ${affectedDialogues.length} dialogue ${noun}. Those speaker assignments will be changed to unresolved.`;
      }
      message += '\n\nThis action will be included in the exported XML.';

      if (!window.confirm(message)) return;

      // Any dialogue that points to the removed person must not retain a broken
      // #person-id reference. Return those quotations to the unresolved state.
      affectedDialogues.forEach(node => {
        node.setAttribute('who', '#unknown');
        if (node.getAttribute('ana') === '#speaker-resolved') node.removeAttribute('ana');
        node.removeAttribute('cert');
        node.setAttribute('source', 'manual-editor');
        node.setAttribute('resp', 'manual-editor');
      });

      // Remove the actual <person> node from the source XML, not just the card.
      char.element.remove();
      charactersList.splice(charIndex, 1);

      // If the currently selected dialogue was affected, clear its selection so
      // the refreshed reader can safely select the next unresolved quotation.
      if (activeDialogueId) {
        const activeWasAffected = affectedDialogues.some(node => {
          const id = node.getAttribute('xml:id') || node.getAttribute('id');
          return id === activeDialogueId;
        });
        if (activeWasAffected) activeDialogueId = null;
      }

      markDirty();
      renderGenderStep();
      renderReaderStep();
      renderSpeakerButtons();
      populateAliasPersonSelect();
      updateBadges();

      const metadataCard = document.getElementById('dialogue-metadata-card');
      if (metadataCard) metadataCard.classList.add('hidden');
      const preview = document.getElementById('selected-dialogue-preview');
      if (preview && affectedDialogues.length > 0) {
        preview.textContent = 'Character removed. Affected dialogue assignments were returned to unresolved.';
      }
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
