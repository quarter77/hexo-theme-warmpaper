function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function searchRecords(records, query) {
  var terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return [];

  return records.map(function (record, index) {
    var title = normalize(record.title);
    var content = normalize(record.content);
    var score = 0;

    for (var i = 0; i < terms.length; i++) {
      var inTitle = title.indexOf(terms[i]) !== -1;
      var inContent = content.indexOf(terms[i]) !== -1;
      if (!inTitle && !inContent) return null;
      score += inTitle ? 3 : 1;
    }

    return { record: record, score: score, index: index };
  }).filter(Boolean).sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var dateDiff = new Date(b.record.date || 0) - new Date(a.record.date || 0);
    return dateDiff || a.index - b.index;
  }).map(function (item) { return item.record; });
}

function highlightText(text, terms) {
  var value = String(text || '');
  var normalizedTerms = (terms || []).map(normalize).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
  if (!normalizedTerms.length || !value) return [{ text: value, highlight: false }];
  var pattern = normalizedTerms.map(function (term) {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');
  var matcher = new RegExp(pattern, 'gi');
  var segments = [];
  var cursor = 0;
  var match;
  while ((match = matcher.exec(value))) {
    if (match.index > cursor) segments.push({ text: value.slice(cursor, match.index), highlight: false });
    segments.push({ text: match[0], highlight: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), highlight: false });
  return segments.length ? segments : [{ text: value, highlight: false }];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalize: normalize, searchRecords: searchRecords, highlightText: highlightText };
} else if (typeof window !== 'undefined') {
  window.WarmpaperSearchCore = { normalize: normalize, searchRecords: searchRecords, highlightText: highlightText };
}
