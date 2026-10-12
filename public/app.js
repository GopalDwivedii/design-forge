const state = {
  problems: [],
  attempts: [],
  selectedProblem: null,
  activeAttempt: null,
  selectedAttemptId: null,
  uploadedDiagrams: [], // Array of { id, filename, diagramType, url, caption, analysis }
};

const learner = {
  id: localStorage.getItem('design-forge.learner-id') || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'learner-' + Math.random().toString(36).substring(2, 9)),
  name: localStorage.getItem('design-forge.learner-name') || 'Aarav Sharma',
};
localStorage.setItem('design-forge.learner-id', learner.id);

const $ = (selector) => document.querySelector(selector);
const problemGrid = $('#problem-grid');
const contentInput = $('#design-content');
const submitButton = $('#submit-attempt');
const reviewPanel = $('#review-panel');
const toast = $('#toast');
const diagramFileInput = $('#diagram-file-input');
const diagramPreviews = $('#diagram-previews');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatDate(value) {
  if (!value) return 'just now';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function statusLabel(status) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setLearnerName(name) {
  learner.name = name.trim() || 'Learner';
  localStorage.setItem('design-forge.learner-name', learner.name);
  $('#sidebar-name').textContent = learner.name;
  $('.avatar').textContent = learner.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function renderProblems() {
  const problemsHtml = state.problems.map((problem) => `
    <article class="problem-card ${problem.id.startsWith('custom-') ? 'custom-card' : ''}" tabindex="0" data-problem-id="${problem.id}" role="button" aria-label="Open ${escapeHtml(problem.title)}">
      <div class="card-top"><span class="level-badge">${escapeHtml(problem.level)}</span></div>
      <h3>${escapeHtml(problem.title)}</h3>
      <p>${escapeHtml(problem.prompt)}</p>
      <div class="tag-row">${problem.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="card-action">Open design brief <span>↗</span></div>
    </article>`).join('');

  const customCardHtml = `
    <article class="problem-card custom-add-card" id="open-custom-card" tabindex="0" role="button" aria-label="Create Custom Design Brief">
      <div class="card-top"><span class="level-badge">Custom</span></div>
      <h3>Custom</h3>
      <p>Design your own software architecture or system prompt. Define your own domain model, entities, workflow constraints, and testable trade-offs.</p>
      <div class="tag-row">
        <span class="tag">Create</span>
        <span class="tag">Your Brief</span>
        <span class="tag">Architecture</span>
      </div>
      <div class="card-action custom-action-line">Create custom brief <span>+</span></div>
    </article>`;

  problemGrid.innerHTML = problemsHtml + customCardHtml;

  problemGrid.querySelectorAll('.problem-card[data-problem-id]').forEach((card) => {
    card.addEventListener('click', () => openProblem(card.dataset.problemId));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProblem(card.dataset.problemId); } });
  });

  const customCard = $('#open-custom-card');
  if (customCard) {
    customCard.addEventListener('click', () => openCustomBriefModal());
    customCard.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCustomBriefModal();
      }
    });
  }
}

function openProblem(problemId) {
  const problem = state.problems.find((item) => item.id === problemId);
  if (!problem) return;
  state.selectedProblem = problem;
  state.activeAttempt = null;
  state.selectedAttemptId = null;
  state.uploadedDiagrams = [];
  renderDiagramPreviews();

  $('#studio-level').textContent = problem.level;
  $('#studio-time').textContent = `~ ${problem.durationMinutes} minute studio`;
  $('#studio-title').textContent = problem.title;
  $('#studio-prompt').textContent = problem.prompt;
  $('#studio-goals').innerHTML = problem.goals.map((goal) => `<li>${escapeHtml(goal)}</li>`).join('');
  $('#studio-constraints').innerHTML = problem.constraints.map((constraint) => `<li>${escapeHtml(constraint)}</li>`).join('');
  contentInput.value = '';
  updateEditorSignals();
  reviewPanel.classList.add('hidden');
  document.body.classList.add('studio-open');
  $('#studio').classList.remove('hidden');
  $('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateEditorSignals() {
  const words = contentInput.value.trim() ? contentInput.value.trim().split(/\s+/).length : 0;
  $('#word-count').textContent = `${words} word${words === 1 ? '' : 's'} · ${state.uploadedDiagrams.length} diagram${state.uploadedDiagrams.length === 1 ? '' : 's'}`;
  $('#writing-hint').textContent = words < 60
    ? 'Feedback works best with a concrete flow, edge cases, and attached diagrams.'
    : words < 120
      ? 'Good start. Add a change seam, Class/Activity diagrams, or testing angle.'
      : 'Nice evidence. Submit when your decisions feel inspectable.';
}

function useScaffold() {
  if (!state.selectedProblem) return;
  if (contentInput.value.trim() && !confirm('Replace the current writing with the brief scaffold?')) return;
  contentInput.value = state.selectedProblem.starter;
  updateEditorSignals();
  contentInput.focus();
  showToast('Scaffold loaded — make the decisions your own.');
}

function generateUuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
}

/**
 * Read a file as Data URL using Promise.
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Handle multiple image file selections for Class, Activity, and Use Case diagrams simultaneously.
 */
async function handleDiagramFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  showToast(`Uploading ${files.length} diagram${files.length > 1 ? 's' : ''} simultaneously…`);

  try {
    const uploadPromises = files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file);
      const defaultType = file.name.toLowerCase().includes('activity')
        ? 'activity'
        : file.name.toLowerCase().includes('use')
          ? 'use_case'
          : 'class';

      return api('/api/diagrams/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl,
          filename: file.name,
          diagramType: defaultType,
          caption: `${file.name} attached for LLD verification`,
        }),
      });
    });

    const results = await Promise.all(uploadPromises);
    for (const res of results) {
      state.uploadedDiagrams.push(res.diagram);
    }

    renderDiagramPreviews();
    updateEditorSignals();
    showToast(`Successfully uploaded & processed ${results.length} diagram${results.length > 1 ? 's' : ''}!`);
  } catch (err) {
    showToast(`Upload failed: ${err.message}`);
  } finally {
    event.target.value = '';
  }
}

/**
 * Open Photo Review modal to inspect a diagram photo and its structural LLD analysis.
 */
function openPhotoReview(diagram) {
  if (!diagram) return;
  const modal = $('#photo-review-modal');
  if (!modal) return;

  $('#photo-review-img').src = diagram.url;
  $('#photo-review-type').textContent = diagram.diagramType.replace('_', ' ').toUpperCase() + ' DIAGRAM';
  $('#photo-review-filename').textContent = diagram.filename || 'diagram.png';
  $('#photo-review-size').textContent = `${diagram.sizeBytes ? Math.round(diagram.sizeBytes / 1024) : diagram.analysis?.sizeKb || 0} KB · Resolution verified`;
  $('#photo-review-clarity').textContent = diagram.analysis?.clarityScore || 'High visual fidelity';
  $('#photo-review-summary').textContent = diagram.analysis?.summary || 'Diagram structural analysis completed successfully.';
  
  const elementsList = $('#photo-review-elements');
  const detected = diagram.analysis?.elementsDetected || ['Domain classes and associations identified'];
  elementsList.innerHTML = detected.map((elem) => `<li>✔ ${escapeHtml(elem)}</li>`).join('');

  $('#photo-review-caption').textContent = diagram.caption || 'No user caption provided.';

  modal.classList.remove('hidden');
}

function closePhotoReview() {
  $('#photo-review-modal')?.classList.add('hidden');
}

function renderDiagramPreviews() {
  if (!diagramPreviews) return;
  if (state.uploadedDiagrams.length === 0) {
    diagramPreviews.innerHTML = '';
    return;
  }

  diagramPreviews.innerHTML = state.uploadedDiagrams.map((diag, index) => `
    <div class="diagram-preview-card" data-index="${index}">
      <div class="diagram-thumb-wrapper" title="Click for Photo Review">
        <img src="${diag.url}" alt="${escapeHtml(diag.filename)}" class="diagram-thumb" />
        <span class="thumb-zoom-badge">🔍 Review</span>
      </div>
      <div class="diagram-meta">
        <div class="diagram-type-row">
          <select class="diagram-type-select" data-index="${index}">
            <option value="class" ${diag.diagramType === 'class' ? 'selected' : ''}>Class Diagram</option>
            <option value="activity" ${diag.diagramType === 'activity' ? 'selected' : ''}>Activity Diagram</option>
            <option value="use_case" ${diag.diagramType === 'use_case' ? 'selected' : ''}>Use Case Diagram</option>
          </select>
          <button class="review-photo-btn outline-button small" data-index="${index}" type="button">Review photo 🔍</button>
          <button class="remove-diagram-btn" data-index="${index}" title="Remove diagram">×</button>
        </div>
        <input type="text" class="diagram-caption-input" data-index="${index}" placeholder="Caption / components shown..." value="${escapeHtml(diag.caption || '')}" />
        <small class="diagram-status">${escapeHtml(diag.analysis?.clarityScore || 'Processed')} · ${diag.analysis?.elementsDetected?.[0] || 'Diagram verified'}</small>
      </div>
    </div>
  `).join('');

  // Attach event handlers for diagram edits & photo review
  diagramPreviews.querySelectorAll('.diagram-thumb-wrapper, .review-photo-btn').forEach((elem) => {
    elem.addEventListener('click', (e) => {
      const card = e.target.closest('.diagram-preview-card');
      const idx = Number(card?.dataset.index);
      if (state.uploadedDiagrams[idx]) {
        openPhotoReview(state.uploadedDiagrams[idx]);
      }
    });
  });

  diagramPreviews.querySelectorAll('.diagram-type-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.index);
      if (state.uploadedDiagrams[idx]) {
        state.uploadedDiagrams[idx].diagramType = e.target.value;
      }
    });
  });

  diagramPreviews.querySelectorAll('.diagram-caption-input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.index);
      if (state.uploadedDiagrams[idx]) {
        state.uploadedDiagrams[idx].caption = e.target.value;
      }
    });
  });

  diagramPreviews.querySelectorAll('.remove-diagram-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.target.dataset.index);
      state.uploadedDiagrams.splice(idx, 1);
      renderDiagramPreviews();
      updateEditorSignals();
    });
  });
}

function renderReview(attempt) {
  if (!attempt) return;
  reviewPanel.classList.remove('hidden');

  if (attempt.status === 'SUBMITTED' || attempt.status === 'EVALUATING') {
    reviewPanel.innerHTML = `
      <div class="review-top">
        <div>
          <span class="eyebrow">EVALUATION IN PROGRESS</span>
          <h3>Your design has been saved.</h3>
          <p>The rubric is tracing evidence in responsibilities, collaboration, behaviour, and diagram artifacts. This demo takes a moment so the state change is visible.</p>
        </div>
        <div class="score-pill"><b>···</b><small>REVIEWING</small></div>
      </div>`;
    return;
  }

  if (attempt.status === 'FAILED') {
    reviewPanel.innerHTML = `
      <div class="review-top">
        <div>
          <span class="eyebrow">REVIEW PAUSED</span>
          <h3>We kept your design safe.</h3>
          <p>${escapeHtml(attempt.failureReason)}</p>
        </div>
      </div>
      <div class="review-actions" style="margin-top:14px;">
        <button id="retry-eval-button" class="primary-button small">Retry evaluation <span>↻</span></button>
      </div>`;
    $('#retry-eval-button')?.addEventListener('click', () => retryEvaluation(attempt.id));
    return;
  }

  const evaluation = attempt.evaluation;
  const renewed = attempt.renewedEvaluation;
  const currentScore = renewed ? renewed.score : evaluation.score;

  // Render main Rubric Review Header + Rubric Grid
  let html = `
    <div class="review-top">
      <div>
        <span class="eyebrow">RUBRIC REVIEW · ${escapeHtml(evaluation.evaluator)}</span>
        <h3>${escapeHtml(renewed ? renewed.summary.headline : evaluation.summary.headline)}</h3>
        <p>${escapeHtml(evaluation.summary.caveat)}</p>
      </div>
      <div class="score-pill ${renewed ? 'renewed-highlight' : ''}">
        <b>${currentScore}<small>/5</small></b>
        <small>${renewed ? 'RENEWED SCORE' : 'VISIBLE EVIDENCE'}</small>
      </div>
    </div>

    <!-- 5 Rubric dimensions grid -->
    <div class="rubric-grid">
      ${(renewed ? renewed.dimensions : evaluation.dimensions).map((dim) => `
        <div class="rubric-item ${dim.score < 4 ? 'weak-point' : 'solid-point'}">
          <strong>${dim.score}<small>/5</small></strong>
          <span>${escapeHtml(dim.label)}</span>
          <p>${escapeHtml(dim.concern)}</p>
        </div>
      `).join('')}
    </div>

    <div class="review-next">
      <b>Most useful next move → </b>${escapeHtml(evaluation.summary.nextStep)}
    </div>

    <!-- POINT 2: SUMMARY TAB BELOW TESTING RESULTS QUOTING USER REMARKS AND DIAGRAM PARTS -->
    <div class="summary-section">
      <div class="summary-tab-header">
        <span class="eyebrow">EVALUATION SUMMARY &amp; WEAK POINT REVIEW</span>
        <h4>Detailed Weak Point Breakdown &amp; Visible Evidence</h4>
        <p>Specific findings quoting your submitted remarks and corresponding diagram components across the 5 testing dimensions.</p>
      </div>

      <div class="weak-points-table">
        ${evaluation.dimensions.map((dim) => {
          const isWeak = dim.score < 4;
          return `
            <div class="weak-point-row ${isWeak ? 'is-weak' : 'is-strong'}">
              <div class="dimension-status-col">
                <span class="badge-score ${isWeak ? 'badge-weak' : 'badge-good'}">${dim.score}/5</span>
                <strong>${escapeHtml(dim.label)}</strong>
                <small class="dim-tag">${isWeak ? 'Needs Improvement' : 'Demonstrated'}</small>
              </div>
              <div class="dimension-quotes-col">
                <div class="quote-block">
                  <span class="quote-label">User Submitted Remark:</span>
                  <blockquote class="user-quote">${escapeHtml(dim.quotedUserRemark || 'No specific text remark found for this dimension')}</blockquote>
                </div>
                <div class="diagram-part-block">
                  <span class="diagram-part-label">Diagram Component Analysis:</span>
                  <div class="diagram-part-value">${escapeHtml(dim.diagramPartEvidence || 'No diagram part attached')}</div>
                </div>
                <div class="evidence-findings">
                  <span class="evidence-label">Rubric Finding:</span>
                  <span>${escapeHtml(dim.evidence)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- POINT 3: REVIEW SECTION BELOW SUMMARY WITH GUIDED QUESTIONS & SCORE IMPROVEMENT -->
    <div class="guided-review-section">
      <div class="guided-review-header">
        <span class="eyebrow">SOCRATIC GUIDED REVIEW &amp; SCORE IMPROVEMENT</span>
        <h4>Reflect on Your Approach &amp; Improve Your Score</h4>
        <p>Instead of just revealing answers, answer these guided design questions to discover missing components and earn a renewed score.</p>
      </div>

      <div id="guided-questions-container" class="guided-questions-container">
        ${(evaluation.summary.guidedQuestions || []).map((q, qIndex) => {
          const previousResponse = attempt.reviewResponses?.find((r) => r.dimensionId === q.dimensionId);
          const isAnswered = Boolean(previousResponse);
          return `
            <div class="question-card" data-question-index="${qIndex}" data-dimension-id="${q.dimensionId}">
              <div class="question-top">
                <span class="question-num">Question ${qIndex + 1} of ${(evaluation.summary.guidedQuestions || []).length}</span>
                <span class="dimension-badge">${escapeHtml(q.dimensionLabel)}</span>
              </div>
              <h5>${escapeHtml(q.question)}</h5>
              <div class="question-hint">
                <span class="hint-orb">💡</span>
                <span><strong>Design Hint:</strong> ${escapeHtml(q.hint)}</span>
              </div>

              <div class="options-list">
                ${q.options.map((opt, optIndex) => `
                  <label class="option-label ${isAnswered && previousResponse.selectedOptionIndex === optIndex ? 'selected-option' : ''}">
                    <input type="radio" name="question-${qIndex}" value="${optIndex}"
                      ${isAnswered && previousResponse.selectedOptionIndex === optIndex ? 'checked' : ''}
                      ${renewed ? 'disabled' : ''} />
                    <span>${escapeHtml(opt)}</span>
                  </label>
                `).join('')}
              </div>

              <div class="reflection-input-block">
                <label><strong>Reflection:</strong> ${escapeHtml(q.reflectionPrompt)}</label>
                <textarea class="reflection-textarea" placeholder="Explain your design reasoning here..." ${renewed ? 'disabled' : ''}>${escapeHtml(previousResponse?.reflection || '')}</textarea>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="review-submission-bar">
        ${renewed ? `
          <div class="renewed-banner">
            <span class="renewed-check">✔</span>
            <div>
              <strong>Score renewed successfully!</strong>
              <p>Your guided review responses have been recorded and your visible evidence improved to <b>${renewed.score}/5</b>.</p>
            </div>
          </div>
        ` : `
          <button id="submit-guided-review" class="primary-button">
            Submit guided review &amp; improve score <span>✨</span>
          </button>
        `}
      </div>
    </div>

    <div class="review-actions" style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;">
      <button id="revise-attempt-button" class="outline-button small">Revise &amp; submit new attempt <span>↻</span></button>
    </div>
  `;

  reviewPanel.innerHTML = html;

  // Bind guided review submission event
  $('#submit-guided-review')?.addEventListener('click', () => submitGuidedReview(attempt.id));

  $('#revise-attempt-button')?.addEventListener('click', () => {
    contentInput.focus();
    contentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(`Next move: ${evaluation.summary.nextStep}`);
  });
}

/**
 * Handle Guided Review submission to earn renewed scores.
 */
async function submitGuidedReview(attemptId) {
  const container = $('#guided-questions-container');
  if (!container) return;

  const questionCards = container.querySelectorAll('.question-card');
  const responses = [];

  for (const card of questionCards) {
    const qIndex = card.dataset.questionIndex;
    const dimensionId = card.dataset.dimensionId;
    const selectedInput = card.querySelector(`input[name="question-${qIndex}"]:checked`);
    const reflectionText = card.querySelector('.reflection-textarea')?.value || '';

    if (!selectedInput) {
      showToast('Please select an approach for all questions before submitting.');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const qData = state.activeAttempt?.evaluation?.summary?.guidedQuestions?.[qIndex];

    responses.push({
      dimensionId,
      selectedOptionIndex: Number(selectedInput.value),
      correctOptionIndex: qData ? qData.correctOptionIndex : 1,
      reflection: reflectionText,
    });
  }

  try {
    showToast('Evaluating your guided responses…');
    const result = await api(`/api/attempts/${attemptId}/review-improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses }),
    });

    state.activeAttempt = result.attempt;
    renderReview(result.attempt);
    await loadAttempts();
    showToast('Renewed score updated! Great reflection.');
  } catch (err) {
    showToast(err.message);
  }
}

async function retryEvaluation(attemptId) {
  try {
    showToast('Retrying evaluation...');
    const result = await api(`/api/attempts/${attemptId}/retry`, { method: 'POST' });
    state.activeAttempt = result.attempt;
    renderReview(result.attempt);
    await loadAttempts();
    pollAttempt(attemptId);
  } catch (error) {
    showToast(error.message);
  }
}

async function submitAttempt() {
  const content = contentInput.value.trim();
  if (!state.selectedProblem) return showToast('Choose a practice problem first.');
  if (content.length < 80) return showToast('Add a little more detail (at least 80 characters) before review.');
  
  submitButton.disabled = true;
  submitButton.textContent = 'Saving your design…';
  try {
    const result = await api('/api/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': generateUuid() },
      body: JSON.stringify({
        problemId: state.selectedProblem.id,
        learnerId: learner.id,
        learnerName: learner.name,
        content,
        metadata: {
          diagrams: state.uploadedDiagrams,
        },
      }),
    });
    state.activeAttempt = result.attempt;
    state.selectedAttemptId = result.attempt.id;
    renderReview(result.attempt);
    showToast('Design submitted with diagrams. Your review is starting.');
    await loadAttempts();
    pollAttempt(result.attempt.id);
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit for review <span>↗</span>';
  }
}

async function pollAttempt(id, retries = 0) {
  try {
    const result = await api(`/api/attempts/${id}`);
    state.activeAttempt = result.attempt;
    if (state.selectedAttemptId === id && state.selectedProblem?.id === result.attempt.problemId) {
      renderReview(result.attempt);
    }
    await loadAttempts();
    if (['SUBMITTED', 'EVALUATING'].includes(result.attempt.status)) {
      if (retries < 25) {
        setTimeout(() => pollAttempt(id, retries + 1), 650);
      } else {
        showToast('Evaluation is taking longer than expected. Check back anytime via My Attempts.');
      }
    } else if (result.attempt.status === 'COMPLETED') {
      showToast('Your rubric review and summary breakdown are ready.');
    } else if (result.attempt.status === 'FAILED') {
      showToast('Evaluation paused. You can retry with one click.');
    }
  } catch (error) {
    showToast('Could not refresh this review.');
  }
}

function renderHistory() {
  const complete = state.attempts.filter((attempt) => attempt.status === 'COMPLETED');
  const average = complete.length
    ? (complete.reduce((sum, attempt) => sum + (attempt.renewedEvaluation ? attempt.renewedEvaluation.score : attempt.evaluation.score), 0) / complete.length).toFixed(1)
    : '—';
  const problemsTouched = new Set(state.attempts.map((attempt) => attempt.problemId)).size;
  $('#history-summary').innerHTML = `<div class="summary-card"><strong>${state.attempts.length}</strong><span>ATTEMPTS SAVED</span></div><div class="summary-card"><strong>${average}</strong><span>AVERAGE VISIBLE EVIDENCE</span></div><div class="summary-card"><strong>${problemsTouched}</strong><span>BRIEFS EXPLORED</span></div>`;
  const list = $('#attempt-list');
  if (!state.attempts.length) {
    list.innerHTML = `<div class="empty-detail"><span class="empty-orb">↗</span><h3>No designs yet</h3><p>Start a brief and your decisions will form a learning trail here.</p></div>`;
    $('#attempt-detail').innerHTML = `<div class="empty-detail"><span class="empty-orb">◌</span><h3>Your feedback will collect here.</h3><p>Try one of the focused briefs to begin.</p></div>`;
    return;
  }
  list.innerHTML = state.attempts.map((attempt) => {
    const problem = state.problems.find((item) => item.id === attempt.problemId);
    const scoreVal = attempt.renewedEvaluation ? attempt.renewedEvaluation.score : attempt.evaluation?.score;
    const score = scoreVal ? ` · ${scoreVal}/5${attempt.renewedEvaluation ? ' (renewed)' : ''}` : '';
    const diagCount = attempt.submission?.metadata?.diagrams?.length || 0;
    const diagLabel = diagCount > 0 ? ` · ${diagCount} diagram${diagCount > 1 ? 's' : ''}` : '';
    return `<button class="attempt-row ${attempt.id === state.selectedAttemptId ? 'selected' : ''}" data-attempt-id="${attempt.id}"><div class="attempt-row-top"><h3>${escapeHtml(problem?.title || 'Practice brief')}</h3><span class="status ${attempt.status.toLowerCase()}">${statusLabel(attempt.status)}</span></div><p>${formatDate(attempt.createdAt)}${score}${diagLabel}</p></button>`;
  }).join('');
  list.querySelectorAll('.attempt-row').forEach((row) => row.addEventListener('click', () => selectAttempt(row.dataset.attemptId)));
  if (state.selectedAttemptId) renderAttemptDetail(state.attempts.find((attempt) => attempt.id === state.selectedAttemptId));
}

function selectAttempt(id) {
  state.selectedAttemptId = id;
  const attempt = state.attempts.find((item) => item.id === id);
  renderHistory();
  renderAttemptDetail(attempt);
}

function renderAttemptDetail(attempt) {
  if (!attempt) return;
  const problem = state.problems.find((item) => item.id === attempt.problemId);
  const detail = $('#attempt-detail');
  if (!attempt.evaluation) {
    const retryButtonHtml = attempt.status === 'FAILED'
      ? `<button class="primary-button small history-retry-btn" style="margin-top:10px;">Retry evaluation <span>↻</span></button>`
      : '';
    detail.innerHTML = `<div class="detail-problem"><div><span class="eyebrow">SAVED ATTEMPT</span><h3>${escapeHtml(problem?.title || 'Practice brief')}</h3></div><span class="status ${attempt.status.toLowerCase()}">${statusLabel(attempt.status)}</span></div><div class="detail-summary"><b>Your design is safely stored.</b><p>${attempt.status === 'FAILED' ? escapeHtml(attempt.failureReason) : 'The evaluation is still working. Select another item and return in a moment.'}</p>${retryButtonHtml}</div>`;
    detail.querySelector('.history-retry-btn')?.addEventListener('click', () => retryEvaluation(attempt.id));
    return;
  }
  const evaluation = attempt.renewedEvaluation || attempt.evaluation;
  const diagrams = attempt.submission?.metadata?.diagrams || [];

  detail.innerHTML = `
    <div class="detail-problem">
      <div>
        <span class="eyebrow">REVIEWED ATTEMPT</span>
        <h3>${escapeHtml(problem?.title || 'Practice brief')}</h3>
      </div>
      <div class="detail-date">${formatDate(attempt.createdAt)}<br><b>${evaluation.score}/5 evidence</b></div>
    </div>
    <div class="detail-summary">
      <b>${escapeHtml(evaluation.summary.headline)}</b>
      <p>${escapeHtml(evaluation.summary.nextStep)}</p>
      <button class="outline-button small iterate-history-btn" style="margin-top:10px;">Iterate on this in studio <span>↗</span></button>
    </div>
    ${diagrams.length > 0 ? `
      <div class="history-diagrams-strip">
        <span class="eyebrow">ATTACHED DIAGRAMS (${diagrams.length})</span>
        <div class="history-diag-grid">
          ${diagrams.map((d) => `<a href="${d.url}" target="_blank" class="history-diag-link"><img src="${d.url}" class="history-diag-img" alt="${d.filename}" /><span>${d.diagramType.toUpperCase()}: ${escapeHtml(d.filename)}</span></a>`).join('')}
        </div>
      </div>
    ` : ''}
    <div class="detail-dimensions">
      ${evaluation.dimensions.map((dimension) => `
        <div class="detail-dimension">
          <header><b>${escapeHtml(dimension.label)}</b><span>${dimension.score}/5</span></header>
          <p>${escapeHtml(dimension.evidence)}</p>
        </div>
      `).join('')}
    </div>
    <details class="detail-submission">
      <summary>Read submitted design</summary>
      <pre>${escapeHtml(attempt.submission.content)}</pre>
    </details>
  `;

  detail.querySelector('.iterate-history-btn')?.addEventListener('click', () => {
    openProblem(attempt.problemId);
    contentInput.value = attempt.submission.content;
    state.uploadedDiagrams = [...(attempt.submission?.metadata?.diagrams || [])];
    renderDiagramPreviews();
    updateEditorSignals();
    changeView('practice');
    showToast(`Loaded attempt for ${problem?.title || 'brief'}.`);
  });
}

async function loadAttempts() {
  const result = await api(`/api/attempts?learnerId=${encodeURIComponent(learner.id)}`);
  state.attempts = result.attempts;
  renderHistory();
}

function changeView(view) {
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `${view}-view`));
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item.dataset.viewTarget === view));
  $('#page-title').textContent = view === 'history' ? 'Track the decisions you can improve.' : 'Make the design decisions visible.';
  if (view === 'history') loadAttempts().catch((error) => showToast(error.message));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openNameModal() {
  $('#learner-name').value = learner.name;
  $('#name-modal').classList.remove('hidden');
  setTimeout(() => $('#learner-name').focus(), 50);
}

function closeNameModal() { $('#name-modal').classList.add('hidden'); }

function bindEvents() {
  contentInput.addEventListener('input', updateEditorSignals);
  submitButton.addEventListener('click', submitAttempt);
  diagramFileInput?.addEventListener('change', handleDiagramFileSelect);
  $('#load-starter').addEventListener('click', useScaffold);
  $('#close-studio').addEventListener('click', () => {
    $('#studio').classList.add('hidden');
    document.body.classList.remove('studio-open');
    state.selectedProblem = null;
  });
  $('#quick-history').addEventListener('click', () => changeView('history'));
  $('#open-history').addEventListener('click', () => changeView('history'));
  $('#new-practice').addEventListener('click', () => changeView('practice'));
  document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => changeView(link.dataset.viewTarget)));
  $('#profile-button').addEventListener('click', openNameModal);
  $('#close-modal').addEventListener('click', closeNameModal);
  $('#name-modal').addEventListener('click', (event) => { if (event.target === $('#name-modal')) closeNameModal(); });
  $('#name-form').addEventListener('submit', (event) => { event.preventDefault(); setLearnerName($('#learner-name').value); closeNameModal(); showToast('Practice identity updated.'); });
  $('#close-photo-modal')?.addEventListener('click', closePhotoReview);
  $('#photo-review-modal')?.addEventListener('click', (event) => { if (event.target === $('#photo-review-modal')) closePhotoReview(); });

  // Custom Brief modal events
  $('#close-custom-brief-modal')?.addEventListener('click', closeCustomBriefModal);
  $('#custom-brief-modal')?.addEventListener('click', (event) => {
    if (event.target === $('#custom-brief-modal')) closeCustomBriefModal();
  });

  $('#custom-brief-form')?.addEventListener('submit', handleCreateCustomBrief);
}

function openCustomBriefModal() {
  $('#custom-brief-modal')?.classList.remove('hidden');
  $('#custom-title-input')?.focus();
}

function closeCustomBriefModal() {
  $('#custom-brief-modal')?.classList.add('hidden');
}

async function handleCreateCustomBrief(event) {
  event.preventDefault();
  const title = $('#custom-title-input')?.value.trim();
  const level = $('#custom-level-select')?.value || 'Intermediate';
  const durationMinutes = Number($('#custom-duration-input')?.value) || 30;
  const tags = ($('#custom-tags-input')?.value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const prompt = $('#custom-prompt-input')?.value.trim();
  const goals = ($('#custom-signals-input')?.value || '')
    .split('\n')
    .map((g) => g.trim())
    .filter(Boolean);
  const constraints = ($('#custom-constraints-input')?.value || '')
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  if (!title || !prompt) {
    showToast('Please specify a title and prompt for your custom brief.');
    return;
  }

  try {
    const res = await api('/api/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        level,
        durationMinutes,
        tags: tags.length ? tags : ['Custom', 'Architecture'],
        prompt,
        goals: goals.length ? goals : ['Separate domain boundaries.', 'Handle state and failure modes.'],
        constraints: constraints.length ? constraints : ['Keep responsibilities explicit.', 'Trade-offs must be testable.'],
      }),
    });

    closeCustomBriefModal();
    state.problems.push(res.problem);
    renderProblems();
    openProblem(res.problem.id);
    showToast(`Custom brief "${res.problem.title}" created!`);
  } catch (err) {
    showToast(`Error creating custom brief: ${err.message}`);
  }
}

async function init() {
  setLearnerName(learner.name);
  bindEvents();
  try {
    const result = await api('/api/problems');
    state.problems = result.problems;
    renderProblems();
    await loadAttempts();
  } catch (error) {
    problemGrid.innerHTML = `<p>Could not load the studio: ${escapeHtml(error.message)}</p>`;
  }
}

init();
