    function switchStep(step) {
      if (typeof commitOpenMetadata === 'function') commitOpenMetadata();
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

    function getResolvedFilename(filename) {
      // The legacy export convention uses a resolved_ prefix, exactly once.
      // Normalize files exported by older editor versions as well.
      return `resolved_${filename.replace(/^(?:resolved_)+/i, '')}`;
    }

    let xmlExportInProgress = false;

    async function exportUpdatedXML() {
      if (!activeXmlDoc || xmlExportInProgress) return;
      xmlExportInProgress = true;
      const editor = document.getElementById('screen-editor');
      const button = document.getElementById('export-xml-button');
      let transaction = null;
      let fileOperationCompleted = false;

      try {
        // Flush a still-focused text field, then commit metadata to the quote
        // that actually owns its form before freezing the XML and work totals.
        if (document.activeElement && editor.contains(document.activeElement)) document.activeElement.blur();
        if (typeof commitOpenMetadata === 'function') commitOpenMetadata();
        const outputName = getResolvedFilename(fileName);
        transaction = window.AnnotationStats ? AnnotationStats.prepareExport(outputName) : null;
        const exportDoc = transaction ? transaction.exportDoc : activeXmlDoc.cloneNode(true);
        const xmlString = AnnotationXml.serialize(exportDoc, { usedSyntheticRoot, originalHadXmlDeclaration });
        const blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8' });
        editor.inert = true;
        button.disabled = true;
        button.querySelector('span').textContent = 'Saving…';

        if (typeof window.showSaveFilePicker === 'function') {
          // Keep this call inside the original click's user activation. No
          // network request or asynchronous hashing precedes the save picker.
          if (!savedXmlFileHandle) {
            savedXmlFileHandle = await window.showSaveFilePicker({
              suggestedName: outputName,
              types: [{ description: 'XML document', accept: { 'application/xml': ['.xml'] } }]
            });
          }
          const writable = await savedXmlFileHandle.createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (error) {
            if (typeof writable.abort === 'function') { try { await writable.abort(); } catch (_) {} }
            throw error;
          }
          fileOperationCompleted = true;
          fileName = savedXmlFileHandle.name;
          document.getElementById('file-status').textContent = fileName;
          markClean();
          if (transaction) { transaction.outputName = fileName; await AnnotationStats.completeExport(transaction, 'saved'); }
        } else {
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = outputName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
          fileOperationCompleted = true;
          // A download can be initiated but its completion cannot be observed.
          // Preserve the original unsaved-work warning in this browser path.
          if (transaction) await AnnotationStats.completeExport(transaction, 'download');
        }
      } catch (error) {
        if (!fileOperationCompleted && window.AnnotationStats) AnnotationStats.cancelExport(transaction);
        if (error.name !== 'AbortError') {
          console.error('XML export failed:', error);
          alert(fileOperationCompleted
            ? 'The XML export completed, but its work summary could not be opened. Your recoverable report will remain in this browser.'
            : `Could not save XML: ${error.message || error}`);
        }
      } finally {
        editor.inert = false;
        button.disabled = false;
        button.querySelector('span').textContent = 'Save XML';
        xmlExportInProgress = false;
        if (window.AnnotationStats) AnnotationStats.resume('export');
      }
    }
