// Shared vocabulary mastery calculation.
//
// vocabulary.html is the only page with the full Genki word list (its tables),
// so it parses that list at runtime and publishes it to localStorage as
// `vocab_word_list` (an array of { kana, kanji:[], en, extra } objects).
// Any page can then compute the SAME word-level mastery the vocab page shows on
// its bar — live from the current vocab_scores — by calling VocabProgress.compute.
//
// Keep statusFromEntry + the worst-of loop here IDENTICAL to applyScores() in
// vocabulary.html so the dashboard wheel and the vocab bar can never disagree.
(function (global) {
  "use strict";

  // worst -> best
  var STATUS_RANK = { red: 0, amber: 1, untested: 2, green: 3 };

  function statusFromEntry(e) {
    if (!e) return 'untested';
    var st = e.state || null;
    if (!st && typeof e.streak === 'number') {
      if (e.streak >= 1) st = 'g';
      else if (e.streak === -1) st = 'a';
      else if (e.streak <= -2) st = 'r';
      else if (e.total > 0) st = 'r';
    }
    if (st === 'g') return 'green';
    if (st === 'a') return 'amber';
    if (st === 'r') return 'red';
    return 'untested';
  }

  // Is a single kanji character "known" per kanji_scores? Mirrors the dashboard
  // wheel's existing kanji-counting rule (status === 'green' OR legacy entries
  // with streak >= 1) so the kanji wheel and the vocab kanji-form fallback
  // can't disagree.
  function kanjiCharGreen(e) {
    if (!e) return false;
    if (e.status === 'green') return true;
    if (!e.status && typeof e.streak === 'number' && e.streak >= 1) return true;
    return false;
  }

  // A vocab kanji form (e.g. "高校" for "high school") counts as green when the
  // user has either tested that exact form via flashcards (vocab_scores key
  // "form|en") OR mastered every component kanji character via the kanji page /
  // kanji-category flashcards (kanji_scores entries). The second path is what
  // makes "I'm learning more kanji" actually move the vocab wheel — otherwise
  // multi-character forms like 弁護士 are stuck untested forever, because
  // nothing the user does in kanji study touches their per-form keys.
  function kanjiFormGreen(form, kanjiScores) {
    if (!form || !kanjiScores) return false;
    var chars = [];
    for (var i = 0; i < form.length; i++) {
      var ch = form.charAt(i);
      // CJK Unified Ideographs — covers the N5 kanji range.
      if (ch >= '一' && ch <= '鿿') chars.push(ch);
    }
    if (!chars.length) return false;
    for (var j = 0; j < chars.length; j++) {
      if (!kanjiCharGreen(kanjiScores[chars[j]])) return false;
    }
    return true;
  }

  // Each FORM (the kana form + every kanji form) is an independent item with
  // its own status. We do NOT merge a word's forms into a single status — this
  // mirrors the per-form logic in vocabulary.html applyScores() (and the
  // per-card model in flashcards.html), so the dashboard wheel, the vocab bar,
  // and the flashcards deck can never disagree. Extra-vocab words are excluded
  // from the totals, exactly like the vocab page's bar.
  // list item: { kana: string, kanji: string[], en: string, extra: boolean }
  // kanjiScores is the optional kanji_scores map; when provided, a kanji form
  // also counts as green if every component character is green there.
  function compute(list, scores, kanjiScores) {
    var total = 0, mastered = 0;
    if (!Array.isArray(list)) return { mastered: 0, total: 0 };
    scores = scores || {};
    list.forEach(function (w) {
      if (!w || w.extra) return;
      var en = w.en;
      // Kana form: only vocab_scores can mark it green.
      total++;
      if (statusFromEntry(scores[w.kana + '|' + en]) === 'green') mastered++;
      // Kanji forms: vocab_scores wins; fall back to kanji_scores propagation.
      (w.kanji || []).forEach(function (f) {
        total++;
        if (statusFromEntry(scores[f + '|' + en]) === 'green') mastered++;
        else if (kanjiFormGreen(f, kanjiScores)) mastered++;
      });
    });
    return { mastered: mastered, total: total };
  }

  // Per-form status used by vocabulary.html applyScores so the page's dots and
  // chapter percentages stay in lockstep with the dashboard wheel.
  function formStatus(form, en, scores, kanjiScores, isKanji) {
    var st = statusFromEntry(scores[form + '|' + en]);
    if (st === 'green') return 'green';
    if (isKanji && kanjiFormGreen(form, kanjiScores)) return 'green';
    return st;
  }

  global.VocabProgress = {
    STATUS_RANK: STATUS_RANK,
    statusFromEntry: statusFromEntry,
    kanjiCharGreen: kanjiCharGreen,
    kanjiFormGreen: kanjiFormGreen,
    formStatus: formStatus,
    compute: compute
  };
})(typeof window !== 'undefined' ? window : this);
