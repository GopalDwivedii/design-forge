export const AttemptStatus = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  EVALUATING: 'EVALUATING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export const SubmissionFormat = Object.freeze({
  DESIGN_BRIEF: 'design-brief',
  DIAGRAM: 'diagram',
  CODE: 'code',
});

const transitions = Object.freeze({
  [AttemptStatus.DRAFT]: [AttemptStatus.SUBMITTED],
  [AttemptStatus.SUBMITTED]: [AttemptStatus.EVALUATING, AttemptStatus.FAILED],
  [AttemptStatus.EVALUATING]: [AttemptStatus.COMPLETED, AttemptStatus.FAILED],
  [AttemptStatus.COMPLETED]: [],
  [AttemptStatus.FAILED]: [AttemptStatus.SUBMITTED],
});

export class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class Problem {
  constructor({ id, title, level, durationMinutes, prompt, goals, constraints, tags, starter }) {
    if (!id || !title || !prompt) throw new DomainError('A problem needs an id, title, and prompt.');
    this.id = id;
    this.title = title;
    this.level = level;
    this.durationMinutes = durationMinutes;
    this.prompt = prompt;
    this.goals = goals ?? [];
    this.constraints = constraints ?? [];
    this.tags = tags ?? [];
    this.starter = starter ?? '';
  }
}

export class Submission {
  constructor({ format = SubmissionFormat.DESIGN_BRIEF, content, assumptions = '', metadata = {} }) {
    if (!Object.values(SubmissionFormat).includes(format)) {
      throw new DomainError(`Only supported formats (${Object.values(SubmissionFormat).join(', ')}) are accepted. Received: ${format}.`, 'UNSUPPORTED_FORMAT');
    }
    if (!content || typeof content !== 'string') {
      throw new DomainError('Write at least 80 characters so feedback has enough design evidence.', 'SUBMISSION_TOO_SHORT');
    }
    if (format === SubmissionFormat.DESIGN_BRIEF && content.trim().length < 80) {
      throw new DomainError('Write at least 80 characters so feedback has enough design evidence.', 'SUBMISSION_TOO_SHORT');
    }
    this.format = format;
    this.content = content.trim();
    this.assumptions = typeof assumptions === 'string' ? assumptions.trim() : '';
    this.metadata = metadata && typeof metadata === 'object' ? metadata : {};
  }
}

export class Evaluation {
  constructor({ evaluator, rubricVersion, dimensions, summary, createdAt }) {
    if (!evaluator || typeof evaluator !== 'string') {
      throw new DomainError('An evaluation needs an evaluator identifier.');
    }
    if (!rubricVersion || typeof rubricVersion !== 'string') {
      throw new DomainError('An evaluation needs a rubric version.');
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      throw new DomainError('An evaluation needs at least one rubric dimension.');
    }
    for (const dimension of dimensions) {
      if (typeof dimension.score !== 'number' || !Number.isFinite(dimension.score) || dimension.score < 1 || dimension.score > 5) {
        throw new DomainError('Rubric scores must be numbers between 1 and 5.');
      }
    }
    this.evaluator = evaluator;
    this.rubricVersion = rubricVersion;
    this.dimensions = dimensions;
    this.summary = summary ?? {};
    this.createdAt = createdAt;
  }

  get score() {
    return Math.round((this.dimensions.reduce((sum, item) => sum + item.score, 0) / this.dimensions.length) * 10) / 10;
  }
}

export class Attempt {
  constructor({ id, problemId, learnerId, learnerName, submission, createdAt, status = AttemptStatus.DRAFT }) {
    if (!id || !problemId || !learnerId) throw new DomainError('An attempt needs identity, problem, and learner.');
    if (submission && !(submission instanceof Submission)) {
      throw new DomainError('Attempt submission must be a valid Submission instance.', 'INVALID_SUBMISSION');
    }
    this.id = id;
    this.problemId = problemId;
    this.learnerId = learnerId;
    this.learnerName = learnerName || 'Learner';
    this.submission = submission ?? null;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.evaluation = null;
    this.failureReason = null;
    this.submittedAt = status === AttemptStatus.SUBMITTED ? createdAt : null;
    this.evaluatedAt = null;
    this.reviewResponses = [];
    this.renewedEvaluation = null;
  }

  transitionTo(nextStatus, now) {
    if (!transitions[this.status] || !transitions[this.status].includes(nextStatus)) {
      throw new DomainError(`Cannot transition an attempt from ${this.status} to ${nextStatus}.`, 'INVALID_ATTEMPT_TRANSITION');
    }
    this.status = nextStatus;
    this.updatedAt = now;
  }

  submit(now) {
    if (!this.submission) {
      throw new DomainError('Cannot submit an attempt without a submission.', 'MISSING_SUBMISSION');
    }
    this.transitionTo(AttemptStatus.SUBMITTED, now);
    this.submittedAt = now;
  }

  startEvaluation(now) {
    this.transitionTo(AttemptStatus.EVALUATING, now);
  }

  complete(evaluation, now) {
    if (!(evaluation instanceof Evaluation)) throw new DomainError('Only a valid evaluation can complete an attempt.');
    this.transitionTo(AttemptStatus.COMPLETED, now);
    this.evaluation = evaluation;
    this.evaluatedAt = now;
  }

  fail(reason, now) {
    this.transitionTo(AttemptStatus.FAILED, now);
    this.failureReason = reason || 'Evaluation could not be completed.';
  }

  retry(now) {
    this.transitionTo(AttemptStatus.SUBMITTED, now);
    this.failureReason = null;
    this.evaluation = null;
    this.renewedEvaluation = null;
    this.reviewResponses = [];
  }

  applyReviewImprovement(reviewResponses, renewedEvaluation, now) {
    if (this.status !== AttemptStatus.COMPLETED) {
      throw new DomainError('Cannot apply review improvement to an incomplete attempt.', 'INVALID_ATTEMPT_STATE');
    }
    if (!(renewedEvaluation instanceof Evaluation)) {
      throw new DomainError('Renewed evaluation must be a valid Evaluation instance.', 'INVALID_EVALUATION');
    }
    this.reviewResponses = Array.isArray(reviewResponses) ? reviewResponses : [];
    this.renewedEvaluation = renewedEvaluation;
    this.updatedAt = now;
  }
}
