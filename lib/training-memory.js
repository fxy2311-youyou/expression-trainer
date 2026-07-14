const fs = require('fs');
const path = require('path');

const MAX_SESSIONS = 100;

function emptyMemory() {
  return {
    version: 2,
    sessions: [],
    profile: {
      totalSessions: 0,
      frequentFillers: [],
      frequentHedges: [],
      averages: { fillersPerKChars: 0, hedgesPerKChars: 0, vaguePerKChars: 0, density: 100 },
      stablePatterns: [],
      observedPatterns: [],
      strengths: [],
      recommendedDrill: null,
      currentFocus: '完成第一次训练，建立你的表达基线',
      updatedAt: null
    }
  };
}

function loadMemory(filePath) {
  try {
    if (!fs.existsSync(filePath)) return emptyMemory();
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { ...emptyMemory(), ...data, profile: { ...emptyMemory().profile, ...(data.profile || {}) } };
  } catch (error) {
    console.warn('[记忆] 训练记录读取失败，将使用空记录:', error.message);
    return emptyMemory();
  }
}

function countWords(items = []) {
  const counts = new Map();
  items.forEach(item => {
    const word = typeof item === 'string' ? item : item.word;
    if (word) counts.set(word, (counts.get(word) || 0) + 1);
  });
  return counts;
}

function mergeCounts(target, source) {
  source.forEach((count, word) => target.set(word, (target.get(word) || 0) + count));
}

function topWords(counts, limit = 5) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function deriveProfile(sessions) {
  if (!sessions.length) return emptyMemory().profile;

  const recent = sessions.slice(-10);
  const fillerCounts = new Map();
  const hedgeCounts = new Map();
  let chars = 0;
  let fillers = 0;
  let hedges = 0;
  let vague = 0;
  let densityTotal = 0;

  recent.forEach(session => {
    const sessionChars = Math.max(session.textLength || session.stats?.totalWords || 0, 1);
    chars += sessionChars;
    fillers += session.stats?.fillers || 0;
    hedges += session.stats?.hedges || 0;
    vague += session.stats?.vagueWords || 0;
    densityTotal += session.stats?.density ?? 100;
    mergeCounts(fillerCounts, countWords(session.fillerWords));
    mergeCounts(hedgeCounts, countWords(session.hedgeWords));
  });

  const rates = {
    fillersPerKChars: round(fillers / chars * 1000),
    hedgesPerKChars: round(hedges / chars * 1000),
    vaguePerKChars: round(vague / chars * 1000),
    density: round(densityTotal / recent.length)
  };

  const patternMap = new Map();
  const strengthMap = new Map();
  recent.forEach(session => {
    const insight = session.structuredMemory;
    if (!insight) return;

    const sessionPatterns = [insight.mainProblem, ...(insight.patterns || [])]
      .filter(item => item?.category && item.confidence >= 0.45);
    const seenCategories = new Set();
    sessionPatterns.forEach(item => {
      if (seenCategories.has(item.category)) return;
      seenCategories.add(item.category);
      const current = patternMap.get(item.category) || {
        category: item.category,
        occurrences: 0,
        confidenceTotal: 0,
        summary: '',
        latestEvidence: ''
      };
      current.occurrences += 1;
      current.confidenceTotal += item.confidence;
      current.summary = item.summary || current.summary;
      current.latestEvidence = item.evidence || current.latestEvidence;
      patternMap.set(item.category, current);
    });

    (insight.strengths || []).forEach(item => {
      if (!item?.category) return;
      const current = strengthMap.get(item.category) || { category: item.category, occurrences: 0, summary: '' };
      current.occurrences += 1;
      current.summary = item.summary || current.summary;
      strengthMap.set(item.category, current);
    });
  });

  const observedPatterns = [...patternMap.values()]
    .map(item => ({
      category: item.category,
      occurrences: item.occurrences,
      confidence: round(item.confidenceTotal / item.occurrences),
      summary: item.summary,
      latestEvidence: item.latestEvidence,
      status: item.occurrences >= 2 ? 'stable' : 'observed'
    }))
    .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);
  const stablePatterns = observedPatterns.filter(item => item.status === 'stable');
  const strengths = [...strengthMap.values()]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5);

  const candidates = [
    { key: 'fillersPerKChars', score: rates.fillersPerKChars / 20, text: '用停顿替代填充词' },
    { key: 'hedgesPerKChars', score: rates.hedgesPerKChars / 12, text: '减少犹豫词，先说明确结论' },
    { key: 'vaguePerKChars', score: rates.vaguePerKChars / 18, text: '把笼统表达换成数字和例子' }
  ].sort((a, b) => b.score - a.score);

  const latestInsight = [...recent].reverse().find(session => session.structuredMemory)?.structuredMemory;
  const memoryFocus = stablePatterns[0]?.summary || latestInsight?.mainProblem?.summary;
  const fallbackFocus = candidates[0].score > 0 ? candidates[0].text : '先说结论，再给理由和例子';

  return {
    totalSessions: sessions.length,
    frequentFillers: topWords(fillerCounts),
    frequentHedges: topWords(hedgeCounts),
    averages: rates,
    stablePatterns,
    observedPatterns,
    strengths,
    recommendedDrill: latestInsight?.recommendedDrill || null,
    currentFocus: memoryFocus || fallbackFocus,
    updatedAt: new Date().toISOString()
  };
}

function saveSession(filePath, session) {
  const memory = loadMemory(filePath);
  const normalized = {
    id: session.id || `${Date.now()}`,
    createdAt: session.createdAt || new Date().toISOString(),
    source: session.source || 'recording',
    topic: session.topic || '',
    textLength: session.textLength || 0,
    stats: session.stats || {},
    fillerWords: session.fillerWords || [],
    hedgeWords: session.hedgeWords || [],
    focus: session.focus || '',
    reportSummary: session.reportSummary || '',
    structuredMemory: session.structuredMemory || null
  };

  const existingIndex = memory.sessions.findIndex(item => item.id === normalized.id);
  if (existingIndex >= 0) memory.sessions[existingIndex] = normalized;
  else memory.sessions.push(normalized);

  memory.sessions = memory.sessions.slice(-MAX_SESSIONS);
  memory.profile = deriveProfile(memory.sessions);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
  return memory;
}

function getMemorySummary(filePath) {
  const memory = loadMemory(filePath);
  return {
    profile: memory.profile,
    recentSessions: memory.sessions.slice(-5).reverse()
  };
}

module.exports = { loadMemory, saveSession, getMemorySummary, deriveProfile };
