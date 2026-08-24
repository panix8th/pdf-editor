/**
 * Helpers for the "Add Form Field" tool - creating new fillable AcroForm
 * fields (as opposed to the existing Forms panel, which only fills fields
 * already present in the opened PDF). Shared between AnnotationLayer.jsx
 * (creation) and PropertiesPanel.jsx (rename validation) so both agree on
 * what counts as "this name is already taken".
 */

export const FIELD_TYPE_LABELS = {
  text: 'Text Field',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown'
};

/** Every field name already in use in this document: both fields detected
 * in the original PDF and any 'formfield' annotations already added this
 * session, across every page. */
function collectFieldNames(doc) {
  const names = new Set((doc.formFields || []).map((f) => f.name));
  for (const pageKey of Object.keys(doc.annotations)) {
    for (const ann of doc.annotations[pageKey]) {
      if (ann.type === 'formfield') names.add(ann.name);
    }
  }
  return names;
}

/** First unused "Field N" name, so newly drawn fields never collide with
 * each other or with the PDF's own fields by default. */
export function nextFieldName(doc) {
  const used = collectFieldNames(doc);
  let n = 1;
  while (used.has(`Field ${n}`)) n++;
  return `Field ${n}`;
}

export function isFieldNameTaken(doc, name, excludeId) {
  for (const pageKey of Object.keys(doc.annotations)) {
    for (const ann of doc.annotations[pageKey]) {
      if (ann.type === 'formfield' && ann.name === name && ann.id !== excludeId) return true;
    }
  }
  return (doc.formFields || []).some((f) => f.name === name);
}
