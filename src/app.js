// 宇宙无敌表达训练系统 V2

class ExpressionTrainer {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStart = null;
    this.timerInterval = null;
    this.fullText = '';
    this.sentences = [];
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.lastFeedbackText = '';
    this.lastReport = '';
    this.sessionId = null;
    this.sessionSource = 'recording';
    this.fillerWords = [];
    this.hedgeWords = [];
    this.feedbackRequestPending = false;
    this.feedbackEvents = [];
    this.feedbackEventId = 0;

    this.initElements();
    this.bindEvents();
    this.loadTrainingMemory();
  }

  initElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnCloseReport = document.getElementById('btn-close-report');
    this.btnClosePaste = document.getElementById('btn-close-paste');
    this.btnAnalyzePaste = document.getElementById('btn-analyze-paste');
    this.btnCopyText = document.getElementById('btn-copy-text');
    this.btnSaveText = document.getElementById('btn-save-text');
    this.btnClear = document.getElementById('btn-clear');
    this.btnCopyReport = document.getElementById('btn-copy-report');
    this.pasteModal = document.getElementById('paste-modal');
    this.pasteTextarea = document.getElementById('paste-textarea');
    this.timer = document.getElementById('timer');
    this.subtitleScroll = document.getElementById('subtitle-scroll');
    this.subtitleContainer = document.getElementById('subtitle-container');
    this.feedbackContent = document.getElementById('feedback-content');
    this.feedbackHint = document.getElementById('feedback-hint');
    this.reportModal = document.getElementById('report-modal');
    this.reportBody = document.getElementById('report-body');
    this.statFillers = document.getElementById('stat-fillers');
    this.statHedges = document.getElementById('stat-hedges');
    this.statVague = document.getElementById('stat-vague');
    this.statDensity = document.getElementById('stat-density');
    this.memorySessionCount = document.getElementById('memory-session-count');
    this.memoryCurrentFocus = document.getElementById('memory-current-focus');
  }

  bindEvents() {
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnSettings.addEventListener('click', () => window.api.openSettings());
    document.getElementById('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnCopyReport.addEventListener('click', () => {
      const reportText = this.reportBody.innerText;
      navigator.clipboard.writeText(reportText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      });
    });
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
  }

  // ===== 录制控制 =====

  async startRecording() {
    const initResult = await window.api.initASR();
    if (!initResult.success) {
      this.showError(`语音识别启动失败: ${initResult.error}`);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.audioProcessor.onaudioprocess = async (e) => {
        if (!this.isRecording || this.isPaused) return;
        const samples = e.inputBuffer.getChannelData(0);
        const result = await window.api.feedAudio(samples);
        if (result) this.handleASRResult(result);
      };
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      this.mediaStream = stream;
    } catch (err) {
      this.showError(`麦克风访问失败: ${err.message}`);
      return;
    }

    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
    this.sessionId = `recording-${Date.now()}`;
    this.sessionSource = 'recording';
    this.resetStats();
    this.subtitleContainer.innerHTML = '';

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    this.feedbackHint.textContent = '正在记录反馈，不用分心阅读';
  }

  pauseRecording() {
    this.isPaused = true;
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
  }

  resumeRecording() {
    this.isPaused = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
  }

  async stopRecording() {
    if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    await window.api.stopASR();
    this.isRecording = false;
    this.isPaused = false;

    clearInterval(this.timerInterval);
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    this.stats.duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);

    // UI：显示生成报告按钮，可翻阅字幕
    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.timer.classList.remove('active');

    if (this.fullText.trim()) {
      this.btnReport.classList.remove('hidden');
      this.btnCopyText.classList.remove('hidden');
      this.btnSaveText.classList.remove('hidden');
      this.btnClear.classList.remove('hidden');
    }
    this.feedbackHint.textContent = '点击任意反馈，自动定位并高亮对应原句';
    this.renderFeedbackTimeline();
  }

  // ===== ASR结果处理 =====

  handleASRResult({ text, isFinal }) {
    if (isFinal) {
      this.sentences.push(text);
      this.fullText += text;
      const sentenceIndex = this.sentences.length - 1;
      this.analyzeCurrentSentence(text, sentenceIndex);

      // 每30字触发一次AI反馈（语境化精准词建议）
      if (this.fullText.length - this.lastFeedbackText.length >= 30) {
        this.requestRealtimeFeedback();
      }
    }
    this.renderSubtitle(text, isFinal);
  }

  renderSubtitle(currentText, isFinal) {
    if (isFinal) {
      // 移除interim
      const interim = this.subtitleContainer.querySelector('.interim-line');
      if (interim) interim.remove();

      // 旧行变灰
      this.subtitleContainer.querySelectorAll('.subtitle-line:not(.old)').forEach(el => {
        el.classList.add('old');
      });

      // 新行
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.dataset.sentenceIndex = this.sentences.length - 1;
      line.innerHTML = this.highlightText(currentText);
      this.subtitleContainer.appendChild(line);
    } else {
      let interim = this.subtitleContainer.querySelector('.interim-line');
      if (!interim) {
        interim = document.createElement('div');
        interim.className = 'subtitle-line interim-line';
        this.subtitleContainer.appendChild(interim);
      }
      interim.textContent = currentText;
    }

    // 自动滚到底
    this.subtitleScroll.scrollTop = this.subtitleScroll.scrollHeight;
  }

  highlightText(text) {
    let result = text;
    const vagueWords = ['开心','难过','害怕','生气','不舒服','很好','很多','很快','很大','很小','好看','不好','喜欢','讨厌','觉得','想想'];
    vagueWords.forEach(w => {
      result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
    });
    const fillerPatterns = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
    result = result.replace(fillerPatterns, '<span class="filler">$1</span>');
    const hedgePatterns = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;
    result = result.replace(hedgePatterns, '<span class="hedge">$1</span>');
    return result;
  }

  // ===== 分析 =====

  async analyzeCurrentSentence(text, sentenceIndex) {
    const analysis = await window.api.analyzeText(text);
    if (analysis) {
      this.stats.fillers += analysis.fillers.length;
      this.stats.hedges += analysis.hedges.length;
      this.stats.vagueWords += analysis.vagueWords.length;
      this.stats.totalWords += analysis.totalWords;
      this.fillerWords.push(...analysis.fillers.map(item => item.word));
      this.hedgeWords.push(...analysis.hedges.map(item => item.word));
      this.updateStatsDisplay();
      // 碰到笼统词 → 立刻在反馈栏弹出替换建议
      if (analysis.vagueWords && analysis.vagueWords.length > 0) {
        analysis.vagueWords.forEach(item => {
          const alts = item.alternatives.slice(0, 3).join(' / ');
          this.addFeedbackItem(`「${item.word}」→ ${alts}`, 'vague', { sentenceIndex, excerpt: text });
        });
      }
      // 碰到填充词 → 弹提醒
      if (analysis.fillers && analysis.fillers.length >= 2) {
        const uniqueFillers = [...new Set(analysis.fillers.map(f => f.word))].slice(0, 3);
        this.addFeedbackItem(`填充词：${uniqueFillers.join('、')}——试试停顿`, 'filler', { sentenceIndex, excerpt: text });
      }
      // 碰到犹豫词 → 弹提醒
      if (analysis.hedges && analysis.hedges.length >= 1) {
        const uniqueHedges = [...new Set(analysis.hedges.map(h => h.word))].slice(0, 2);
        this.addFeedbackItem(`「${uniqueHedges.join('」「')}」→ 直接说`, 'hedge', { sentenceIndex, excerpt: text });
      }
    }
  }

  updateStatsDisplay() {
    this.statFillers.textContent = this.stats.fillers;
    this.statHedges.textContent = this.stats.hedges;
    this.statVague.textContent = this.stats.vagueWords;
    if (this.stats.totalWords > 0) {
      this.statDensity.textContent = this.calculateDensity() + '%';
    }
  }

  // ===== 实时反馈 =====

  async requestRealtimeFeedback() {
    if (this.feedbackRequestPending || !this.fullText.trim()) return;
    this.feedbackRequestPending = true;
    this.lastFeedbackText = this.fullText;
    const anchor = {
      sentenceIndex: Math.max(0, this.sentences.length - 1),
      excerpt: this.sentences[this.sentences.length - 1] || this.fullText.slice(-100),
      elapsedSec: this.getElapsedSeconds()
    };
    try {
      const result = await window.api.getRealtimeFeedback({
        text: this.fullText,
        elapsedSec: this.getElapsedSeconds(),
        topic: this.sentences[0]?.slice(0, 80) || '',
        previousPoints: this.sentences.slice(-6, -1).map(item => item.slice(0, 80)),
        currentSentence: anchor.excerpt
      });
      if (result.success && result.feedback) {
        const lines = result.feedback.split('\n').filter(l => l.trim());
        lines.forEach(line => {
          const type = this.classifyFeedback(line.trim());
          this.addFeedbackItem(line.trim(), type, anchor);
        });
      }
    } finally {
      this.feedbackRequestPending = false;
    }
  }

  classifyFeedback(text) {
    if (text === '✓' || text.includes('✓')) return 'good';
    // 填充词相关
    const fillerKeywords = ['嗯','啊','呃','那个','就是','然后','这个','对吧','是吧','反正','基本上','所以说'];
    if (fillerKeywords.some(w => text.includes(`「${w}」`))) return 'filler';
    // 犹豫词相关
    const hedgeKeywords = ['可能','也许','大概','应该','我觉得','好像','似乎','感觉','或许'];
    if (hedgeKeywords.some(w => text.includes(`「${w}」`))) return 'hedge';
    // 其他精准词替换
    if (text.includes('→')) return 'vague';
    return 'ai';
  }

  addFeedbackItem(text, type = 'ai', meta = {}) {
    const recent = this.feedbackEvents.slice(-3);
    if (recent.some(event => event.text === text && event.sentenceIndex === meta.sentenceIndex)) return;

    this.feedbackEvents.push({
      id: ++this.feedbackEventId,
      text,
      type,
      sentenceIndex: Number.isInteger(meta.sentenceIndex) ? meta.sentenceIndex : Math.max(0, this.sentences.length - 1),
      excerpt: (meta.excerpt || '').trim().slice(0, 100),
      elapsedSec: Number.isFinite(meta.elapsedSec) ? meta.elapsedSec : this.getElapsedSeconds(),
      positionLabel: meta.positionLabel || ''
    });
    this.renderFeedbackTimeline();
  }

  renderFeedbackTimeline() {
    this.feedbackContent.innerHTML = '';
    if (!this.feedbackEvents.length) return;

    if (!this.isRecording) {
      const labels = { vague: '笼统词', filler: '填充词', hedge: '犹豫词', ai: '结构建议', good: '亮点' };
      const counts = this.feedbackEvents.reduce((result, event) => {
        result[event.type] = (result[event.type] || 0) + 1;
        return result;
      }, {});
      const summary = document.createElement('div');
      summary.className = 'feedback-summary';
      Object.entries(counts).forEach(([type, count]) => {
        const chip = document.createElement('span');
        chip.className = 'feedback-summary-chip';
        chip.textContent = `${labels[type] || '其他'} ${count}`;
        summary.appendChild(chip);
      });
      this.feedbackContent.appendChild(summary);
    }

    this.feedbackEvents.slice().reverse().forEach(event => {
      const item = document.createElement('div');
      item.className = `feedback-item type-${event.type}`;
      item.innerHTML = `
        <div class="feedback-item-time">${event.positionLabel || this.formatTime(event.elapsedSec)}</div>
        <div class="feedback-item-text"></div>
        <div class="feedback-item-excerpt"></div>
      `;
      item.querySelector('.feedback-item-text').textContent = event.text;
      item.querySelector('.feedback-item-excerpt').textContent = event.excerpt ? `原句：${event.excerpt}` : '';
      item.addEventListener('click', () => this.focusSentence(event.sentenceIndex));
      this.feedbackContent.appendChild(item);
    });
  }

  formatTime(totalSeconds = 0) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  focusSentence(sentenceIndex) {
    const target = this.subtitleContainer.querySelector(`[data-sentence-index="${sentenceIndex}"]`);
    if (!target) return;
    this.subtitleContainer.querySelectorAll('.feedback-target').forEach(item => item.classList.remove('feedback-target'));
    target.classList.add('feedback-target');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearTimeout(this.feedbackHighlightTimer);
    this.feedbackHighlightTimer = setTimeout(() => target.classList.remove('feedback-target'), 3500);
  }

  // ===== 报告 =====

  async generateReport() {
    this.reportBody.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">正在生成报告...</p>';
    this.reportModal.classList.remove('hidden');

    const result = await window.api.getFinalReport({
      fullText: this.fullText,
      stats: { ...this.stats, density: this.calculateDensity() },
      session: {
        id: this.sessionId || `session-${Date.now()}`,
        source: this.sessionSource,
        topic: this.sentences[0]?.slice(0, 100) || '',
        fillerWords: this.fillerWords,
        hedgeWords: this.hedgeWords
      }
    });

    if (result.success) {
      this.lastReport = result.report;
      this.renderReport(result.report, result.memoryExtracted);
      if (result.profile) this.renderTrainingProfile(result.profile);
    } else {
      this.reportBody.innerHTML = `<p style="color:#ff6b6b;">生成失败: ${result.error}</p>`;
    }
  }

  renderReport(report, memoryExtracted = false) {
    let html = report
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\|(.+)\|/g, (match) => {
        // 简单表格支持
        return match;
      })
      .replace(/\n/g, '<br>');

    this.reportBody.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;">
        <span style="font-size:11px;color:${memoryExtracted ? '#69db7c' : '#888'};">
          ${memoryExtracted ? '🧠 已提炼并写入长期记忆' : '⚠️ 本次报告未能提炼为长期记忆'}
        </span>
        <button id="btn-save-report" style="background:#E5007E;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer;">💾 保存为 Markdown</button>
      </div>
      ${html}
    `;

    document.getElementById('btn-save-report').addEventListener('click', () => this.saveReport());
  }

  async saveReport() {
    if (!this.lastReport) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练报告\n\n**日期**: ${dateStr}  \n**时长**: ${this.stats.duration}秒  \n**总字数**: ${this.stats.totalWords}  \n\n---\n\n## 完整原文\n\n${this.fullText}\n\n---\n\n${this.lastReport}`;
    const filename = `表达训练-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        const btn = document.getElementById('btn-save-report');
        btn.textContent = '✓ 已保存';
        btn.style.background = '#333';
        setTimeout(() => { btn.textContent = '💾 保存为 Markdown'; btn.style.background = '#E5007E'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  // ===== 工具 =====

  updateTimer() {
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    const elapsed = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    this.timer.textContent = `${minutes}:${seconds}`;
  }

  getElapsedSeconds() {
    if (!this.startTime) return this.stats.duration || 0;
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    return Math.max(0, Math.floor((Date.now() - this.startTime - totalPaused) / 1000));
  }

  calculateDensity() {
    if (!this.stats.totalWords) return 100;
    return Math.round((this.stats.totalWords - this.stats.fillers - this.stats.hedges) / this.stats.totalWords * 100);
  }

  async loadTrainingMemory() {
    try {
      const memory = await window.api.getTrainingMemory();
      this.renderTrainingProfile(memory.profile);
    } catch (error) {
      console.warn('训练记忆读取失败', error);
    }
  }

  renderTrainingProfile(profile) {
    if (!profile) return;
    this.memorySessionCount.textContent = profile.totalSessions || 0;
    this.memoryCurrentFocus.textContent = profile.currentFocus || '完成第一次训练，建立你的表达基线';
  }

  resetStats() {
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.fillerWords = [];
    this.hedgeWords = [];
    this.lastFeedbackText = '';
    this.updateStatsDisplay();
    this.feedbackContent.innerHTML = '';
    this.feedbackEvents = [];
    this.feedbackEventId = 0;
  }

  showError(msg) {
    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.color = '#ff6b6b';
    line.textContent = msg;
    this.subtitleContainer.appendChild(line);
  }

  // ===== 复制 & 保存原文 & 清空 =====

  copyOriginalText() {
    if (!this.fullText.trim()) return;
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.btnCopyText.querySelector('.btn-label').textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.querySelector('.btn-label').textContent = '复制原文'; }, 1500);
    });
  }

  async saveOriginalText() {
    if (!this.fullText.trim()) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练原文\n\n**日期**: ${dateStr}\n\n---\n\n${this.fullText}`;
    const filename = `原文-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        this.btnSaveText.querySelector('.btn-label').textContent = '✓ 已保存';
        setTimeout(() => { this.btnSaveText.querySelector('.btn-label').textContent = '保存原文'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  clearAll() {
    this.fullText = '';
    this.sentences = [];
    this.lastReport = '';
    this.subtitleContainer.innerHTML = '<div class="subtitle-line hint">点击下方按钮开始说话</div>';
    this.feedbackContent.innerHTML = '';
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
    this.feedbackHint.textContent = '说话时只记录，结束后点击反馈定位原句';
  }

  // ===== 粘贴逐字稿分析 =====

  openPasteModal() {
    this.pasteTextarea.value = '';
    this.pasteModal.classList.remove('hidden');
    this.pasteTextarea.focus();
  }

  async analyzePastedText() {
    const text = this.pasteTextarea.value.trim();
    if (!text) return;

    // 关闭粘贴弹窗
    this.pasteModal.classList.add('hidden');

    // 把文本显示到字幕区（高亮标记）
    this.subtitleContainer.innerHTML = '';
    this.fullText = text;
    this.sessionId = `paste-${Date.now()}`;
    this.sessionSource = 'transcript';
    this.startTime = null;
    this.resetStats();

    // 按句号/问号/感叹号/换行分句
    const sentences = text.split(/(?<=[。！？\n])/g).filter(s => s.trim());
    this.sentences = sentences;

    for (const [sentenceIndex, sentence] of sentences.entries()) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.dataset.sentenceIndex = sentenceIndex;
      line.innerHTML = this.highlightText(sentence.trim());
      this.subtitleContainer.appendChild(line);

      // 词库分析
      const analysis = await window.api.analyzeText(sentence);
      if (analysis) {
        this.stats.fillers += analysis.fillers.length;
        this.stats.hedges += analysis.hedges.length;
        this.stats.vagueWords += analysis.vagueWords.length;
        this.stats.totalWords += analysis.totalWords;
        this.fillerWords.push(...analysis.fillers.map(item => item.word));
        this.hedgeWords.push(...analysis.hedges.map(item => item.word));

        const meta = { sentenceIndex, excerpt: sentence.trim(), positionLabel: `第 ${sentenceIndex + 1} 句` };
        analysis.vagueWords.forEach(item => {
          this.addFeedbackItem(`「${item.word}」→ ${item.alternatives.slice(0, 3).join(' / ')}`, 'vague', meta);
        });
        if (analysis.fillers.length >= 2) {
          const words = [...new Set(analysis.fillers.map(item => item.word))].slice(0, 3);
          this.addFeedbackItem(`填充词：${words.join('、')}——试试停顿`, 'filler', meta);
        }
        if (analysis.hedges.length >= 1) {
          const words = [...new Set(analysis.hedges.map(item => item.word))].slice(0, 2);
          this.addFeedbackItem(`「${words.join('」「')}」→ 直接说`, 'hedge', meta);
        }
      }
    }

    this.stats.duration = 0; // 粘贴模式没有时长
    this.updateStatsDisplay();

    // 显示操作按钮
    this.btnReport.classList.remove('hidden');
    this.btnCopyText.classList.remove('hidden');
    this.btnSaveText.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');
    this.feedbackHint.textContent = '点击任意反馈，自动定位并高亮对应原句';

    // 请求AI语境化反馈
    this.requestRealtimeFeedback();
  }
}

document.addEventListener('DOMContentLoaded', () => { new ExpressionTrainer(); });
