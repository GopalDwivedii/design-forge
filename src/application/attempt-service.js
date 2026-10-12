import { Attempt, AttemptStatus, DomainError, Evaluation, Submission, SubmissionFormat } from '../domain/models.js';
import { DEFAULT_RUBRIC } from '../domain/rubric.js';

export class AttemptService {
  constructor({ problemRepository, attemptRepository, idempotencyRepository, evaluator, scheduler, clock, idGenerator }) {
    if (!problemRepository || !attemptRepository || !idempotencyRepository || !evaluator) {
      throw new Error('AttemptService requires problemRepository, attemptRepository, idempotencyRepository, and evaluator.');
    }
    this.problemRepository = problemRepository;
    this.attemptRepository = attemptRepository;
    this.idempotencyRepository = idempotencyRepository;
    this.evaluator = evaluator;
    this.scheduler = scheduler || ((fn) => setTimeout(fn, 0));
    this.clock = clock || (() => new Date().toISOString());
    this.idGenerator = idGenerator || (() => Math.random().toString(36).substring(2, 11));
  }

  async create({ problemId, learnerId, learnerName, content, assumptions, idempotencyKey, format = SubmissionFormat.DESIGN_BRIEF, metadata = {} }) {
    if (!idempotencyKey) throw new DomainError('Provide an idempotency key before submitting.', 'MISSING_IDEMPOTENCY_KEY');

    // Concurrency protection if repository supports acquire
    if (typeof this.idempotencyRepository.acquire === 'function') {
      const lock = await this.idempotencyRepository.acquire(idempotencyKey);
      if (lock.status === 'COMPLETED') {
        return { attempt: lock.result, replayed: true };
      }
      try {
        const problem = await this.problemRepository.findById(problemId);
        if (!problem) throw new DomainError('That practice problem does not exist.', 'PROBLEM_NOT_FOUND');

        const now = this.clock();
        const submission = new Submission({ format, content, assumptions, metadata });
        const attempt = new Attempt({
          id: this.idGenerator(),
          problemId,
          learnerId: learnerId || 'anonymous',
          learnerName,
          submission,
          createdAt: now,
        });
        attempt.submit(now);
        await this.attemptRepository.save(attempt);
        lock.release(attempt);
        this.scheduler(() => this.evaluate(attempt.id));
        return { attempt, replayed: false };
      } catch (error) {
        lock.abort(error);
        throw error;
      }
    }

    const previous = await this.idempotencyRepository.find(idempotencyKey);
    if (previous) return { attempt: previous, replayed: true };

    const problem = await this.problemRepository.findById(problemId);
    if (!problem) throw new DomainError('That practice problem does not exist.', 'PROBLEM_NOT_FOUND');

    const now = this.clock();
    const submission = new Submission({ format, content, assumptions, metadata });
    const attempt = new Attempt({
      id: this.idGenerator(),
      problemId,
      learnerId: learnerId || 'anonymous',
      learnerName,
      submission,
      createdAt: now,
    });
    attempt.submit(now);
    await this.attemptRepository.save(attempt);
    await this.idempotencyRepository.save(idempotencyKey, attempt);
    this.scheduler(() => this.evaluate(attempt.id));
    return { attempt, replayed: false };
  }

  /**
   * Submit guided review answers and calculate renewed improved scores.
   * Questions the user on their design choices and gives guided feedback.
   */
  async submitReviewImprovement(attemptId, { responses = [] }) {
    const attempt = await this.get(attemptId);
    if (attempt.status !== AttemptStatus.COMPLETED || !attempt.evaluation) {
      throw new DomainError('Review improvement can only be applied to a completed evaluation.', 'INVALID_ATTEMPT_STATE');
    }

    const originalEval = attempt.evaluation;
    const now = this.clock();

    // Map responses to evaluate user understanding and improve dimension scores
    const renewedDimensions = originalEval.dimensions.map((dim) => {
      const resp = responses.find((r) => r.dimensionId === dim.id);
      let newScore = dim.score;
      let renewalEvidence = dim.evidence;
      let updatedConcern = dim.concern;

      if (resp) {
        // If user selected the correct approach or provided a thoughtful reflection
        const isCorrectOption = resp.selectedOptionIndex === resp.correctOptionIndex;
        const hasReflection = resp.reflection && resp.reflection.trim().length > 10;

        if (isCorrectOption) {
          newScore = Math.min(5, newScore + 1);
          renewalEvidence += ` [Guided Review: Learner recognized correct design pattern and addressed ${dim.label.toLowerCase()}]`;
          updatedConcern = 'Learner demonstrated clear grasp of this component in guided review.';
        }
        if (hasReflection) {
          renewalEvidence += ` [Learner Reflection: "${resp.reflection.trim().slice(0, 80)}..."]`;
        }
      }

      return {
        ...dim,
        score: newScore,
        evidence: renewalEvidence,
        concern: updatedConcern,
      };
    });

    const renewedEvaluation = new Evaluation({
      evaluator: `${originalEval.evaluator}-guided-review`,
      rubricVersion: originalEval.rubricVersion,
      dimensions: renewedDimensions,
      summary: {
        ...originalEval.summary,
        headline: `Renewed Review: Overall score improved to ${Math.round((renewedDimensions.reduce((sum, d) => sum + d.score, 0) / renewedDimensions.length) * 10) / 10}/5!`,
        reviewFeedback: 'Great progress. Working through guided review reflections successfully improved your design understanding.',
      },
      createdAt: now,
    });

    attempt.applyReviewImprovement(responses, renewedEvaluation, now);
    await this.attemptRepository.save(attempt);
    return attempt;
  }

  async evaluate(attemptId) {
    const attempt = await this.get(attemptId);
    if (attempt.status !== AttemptStatus.SUBMITTED) return attempt;

    try {
      attempt.startEvaluation(this.clock());
      await this.attemptRepository.save(attempt);
      const problem = await this.problemRepository.findById(attempt.problemId);
      const evaluation = await this.evaluator.evaluate({ problem, submission: attempt.submission, rubric: DEFAULT_RUBRIC });
      attempt.complete(evaluation, this.clock());
      await this.attemptRepository.save(attempt);
    } catch (error) {
      if (attempt.status === AttemptStatus.SUBMITTED || attempt.status === AttemptStatus.EVALUATING) {
        attempt.fail('Evaluation did not finish. Your design was saved; submit a new attempt when ready.', this.clock());
        await this.attemptRepository.save(attempt);
      }
    }
    return attempt;
  }

  async retryEvaluation(attemptId) {
    const attempt = await this.get(attemptId);
    if (attempt.status !== AttemptStatus.FAILED) {
      throw new DomainError(`Only failed attempts can be re-evaluated. Current status: ${attempt.status}.`, 'INVALID_RETRY_STATUS');
    }
    const now = this.clock();
    attempt.retry(now);
    await this.attemptRepository.save(attempt);
    this.scheduler(() => this.evaluate(attempt.id));
    return attempt;
  }

  async get(attemptId) {
    const attempt = await this.attemptRepository.findById(attemptId);
    if (!attempt) throw new DomainError('That attempt does not exist.', 'ATTEMPT_NOT_FOUND');
    return attempt;
  }

  async listForLearner(learnerId) {
    return this.attemptRepository.listForLearner(learnerId || 'anonymous');
  }
}
