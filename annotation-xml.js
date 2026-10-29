/* Local XML helpers. Audit records stay in the exported XML, never in reports. */
(function (root) {
  'use strict';
  const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
  const PREFIXES = Object.freeze({
    document: 'fiction-annotation-document:v1:',
    excluded: 'fiction-annotation-excluded:v1:',
    batch: 'fiction-annotation-batch:v1:'
  });
  const nameOf = node => node.localName || String(node.nodeName || '').split(':').pop();

  function elements(node, ...localNames) {
    if (!node || typeof node.getElementsByTagName !== 'function') return [];
    const all = Array.from(node.getElementsByTagName('*'));
    if (node.nodeType === 1) all.unshift(node);
    return localNames.length ? all.filter(element => localNames.includes(nameOf(element))) : all;
  }

  function id(node) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    return node.getAttributeNS(XML_NAMESPACE, 'id') || node.getAttribute('xml:id') || node.getAttribute('id') || '';
  }

  function comments(doc) {
    const found = [];
    const pending = [doc];
    while (pending.length) {
      const node = pending.pop();
      if (node.nodeType === 8) found.push(node);
      const children = Array.from(node.childNodes || []);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    return found;
  }

  function encodeRecord(record) {
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    // Standard base64 contains no hyphens, so arbitrary text cannot close a
    // comment or introduce XML's forbidden double-hyphen sequence.
    return btoa(binary);
  }

  function decodeRecord(encoded) {
    try {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Expected an object.');
      return record;
    } catch (_) {
      throw new Error('An annotation history record in this XML is damaged. Keep the file and ask the project administrator to check it.');
    }
  }

  function recordNodes(doc, prefix) {
    return comments(doc).map(node => ({ node, data: node.data.trim() }))
      .filter(item => item.data.startsWith(prefix))
      .map(item => ({ node: item.node, record: decodeRecord(item.data.slice(prefix.length)) }));
  }

  function readExclusions(doc) {
    return recordNodes(doc, PREFIXES.excluded).map(({ record }) => {
      if (typeof record.quote_id !== 'string' || !record.quote_id) {
        throw new Error('An excluded quotation is missing its stable ID in the XML history.');
      }
      return record;
    });
  }

  function ensureIds(doc) {
    const reserved = new Map();
    const all = elements(doc);
    all.forEach(node => {
      const values = [node.getAttributeNS(XML_NAMESPACE, 'id'), node.getAttribute('xml:id'), node.getAttribute('id')].filter(Boolean);
      values.forEach(value => {
        const prior = reserved.get(value);
        if (prior && prior !== node) {
          throw new Error(`Duplicate XML ID “${value.slice(0, 120)}” is used by more than one element. Give each element a unique ID before loading this file.`);
        }
        reserved.set(value, node);
      });
    });
    // Deleted quote IDs remain reserved for the later review application.
    readExclusions(doc).forEach(record => {
      if (!reserved.has(record.quote_id)) reserved.set(record.quote_id, true);
    });
    let personCounter = 1;
    let quoteCounter = 1;
    let assigned = 0;
    all.forEach(node => {
      const tag = nameOf(node);
      if (!['person', 'q', 'quotation'].includes(tag) || id(node)) return;
      let candidate;
      do {
        candidate = tag === 'person' ? `auto-person-${personCounter++}` : `auto-q-${quoteCounter++}`;
      } while (reserved.has(candidate));
      node.setAttributeNS(XML_NAMESPACE, 'xml:id', candidate);
      reserved.set(candidate, node);
      assigned += 1;
    });
    return assigned;
  }

  function parserError(doc) {
    return elements(doc, 'parsererror')[0] || null;
  }

  function parse(raw) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('This XML file is empty.');
    const parser = new DOMParser();
    const originalHadXmlDeclaration = /^\uFEFF?<\?xml\s/i.test(raw);
    const direct = parser.parseFromString(raw, 'application/xml');
    const directError = parserError(direct);
    if (!directError && direct.documentElement) {
      return { doc: direct, usedSyntheticRoot: false, originalHadXmlDeclaration };
    }
    // Some project files are valid XML fragments with several top-level
    // elements. Only add a wrapper after a normal document parse has failed.
    const fragment = raw.replace(/^\uFEFF?/, '').replace(/^<\?xml\s[\s\S]*?\?>/i, '');
    const wrapped = parser.parseFromString(`<root>${fragment}</root>`, 'application/xml');
    const wrappedError = parserError(wrapped);
    if (!wrappedError && elements(wrapped.documentElement).length > 1) {
      return { doc: wrapped, usedSyntheticRoot: true, originalHadXmlDeclaration };
    }
    const detail = (directError || wrappedError)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 360);
    throw new Error(`The file could not be read as XML.${detail ? ` ${detail}` : ' Check that its tags are complete and correctly nested.'}`);
  }

  function serialize(doc, { usedSyntheticRoot = false, originalHadXmlDeclaration = false } = {}) {
    if (!doc || !doc.documentElement) throw new Error('There is no XML document to export.');
    const serializer = new XMLSerializer();
    let result;
    if (usedSyntheticRoot) {
      result = Array.from(doc.childNodes).map(node => node === doc.documentElement
        ? Array.from(node.childNodes).map(child => serializer.serializeToString(child)).join('')
        : serializer.serializeToString(node)).join('');
    } else {
      result = serializer.serializeToString(doc);
    }
    if (originalHadXmlDeclaration && !result.trimStart().startsWith('<?xml')) {
      result = `<?xml version="1.0" encoding="UTF-8"?>\n${result}`;
    }
    return result;
  }

  function getDocumentRecord(doc) {
    const records = recordNodes(doc, PREFIXES.document);
    if (records.length > 1) throw new Error('This XML contains more than one document identity. Ask the project administrator to check the annotation history.');
    return records.length ? records[0].record : null;
  }

  function setDocumentRecord(doc, record) {
    getDocumentRecord(doc); // Reject ambiguous identities before changing data.
    const existing = recordNodes(doc, PREFIXES.document)[0];
    const data = PREFIXES.document + encodeRecord(record);
    if (existing) existing.node.data = data;
    else doc.documentElement.insertBefore(doc.createComment(data), doc.documentElement.firstChild);
    return record;
  }

  function addExclusion(doc, quoteNode, info = {}) {
    const quoteId = id(quoteNode);
    if (!quoteId || !quoteNode.parentNode) throw new Error('The quotation must have a stable XML ID before it can be excluded.');
    const record = {
      ...info,
      quote_id: quoteId,
      original_xml: new XMLSerializer().serializeToString(quoteNode),
      text: quoteNode.textContent || ''
    };
    quoteNode.parentNode.insertBefore(doc.createComment(PREFIXES.excluded + encodeRecord(record)), quoteNode);
    return record;
  }

  function setExclusionSubmission(doc, quoteIds, submissionId) {
    const selected = new Set(quoteIds || []);
    let updated = 0;
    recordNodes(doc, PREFIXES.excluded).forEach(({ node, record }) => {
      if (!selected.has(record.quote_id)) return;
      node.data = PREFIXES.excluded + encodeRecord({ ...record, submission_id: submissionId });
      updated += 1;
    });
    return updated;
  }

  function readBatches(doc) {
    return recordNodes(doc, PREFIXES.batch).map(({ record }) => record);
  }

  function appendBatch(doc, record) {
    if (record.submission_id) {
      const existing = readBatches(doc).find(batch => batch.submission_id === record.submission_id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('An export history ID already exists with different content.');
        return existing;
      }
    }
    doc.documentElement.appendChild(doc.createComment(PREFIXES.batch + encodeRecord(record)));
    return record;
  }

  root.AnnotationXml = Object.freeze({
    PREFIXES, elements, id, ensureIds, parse, serialize,
    getDocumentRecord, setDocumentRecord, readExclusions, addExclusion,
    setExclusionSubmission, appendBatch, readBatches
  });
})(window);
