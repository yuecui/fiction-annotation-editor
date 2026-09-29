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
        document.body.classList.remove('dialogue-workspace');
        document.getElementById('view-gender').classList.remove('hidden');
        document.getElementById('view-dialogue').classList.add('hidden');
        setActiveTab(genderTab, dialogueTab);
      } else {
        // Lock the app to the viewport only while Dialogue Attribution is active.
        document.body.classList.add('dialogue-workspace');
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
