/**
 * Repository interface and in-memory implementation for Problems.
 */
export class InMemoryProblemRepository {
  constructor(problems) {
    this.problems = new Map(problems.map((problem) => [problem.id, problem]));
  }

  async list() {
    return [...this.problems.values()];
  }

  async findById(id) {
    return this.problems.get(id) ?? null;
  }

  async save(problem) {
    this.problems.set(problem.id, problem);
    return problem;
  }
}

/**
 * Repository interface and in-memory implementation for Attempts.
 */
export class InMemoryAttemptRepository {
  constructor() {
    this.attempts = new Map();
  }

  async save(attempt) {
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async findById(id) {
    return this.attempts.get(id) ?? null;
  }

  async listForLearner(learnerId) {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.learnerId === learnerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

/**
 * Repository interface and in-memory implementation for Idempotency keys.
 * Supports concurrent acquire locking to prevent duplicate processing.
 */
export class InMemoryIdempotencyRepository {
  constructor() {
    this.keys = new Map();
    this.locks = new Map();
  }

  async find(key) {
    return this.keys.get(key) ?? null;
  }

  async save(key, value) {
    this.keys.set(key, value);
  }

  /**
   * Concurrency lock: acquires the key or waits for the in-flight processing to resolve.
   * If already completed, returns status 'COMPLETED'.
   * If acquired, provides release(val) and abort(err) callbacks.
   */
  async acquire(key) {
    if (this.keys.has(key)) {
      return { status: 'COMPLETED', result: this.keys.get(key) };
    }
    if (this.locks.has(key)) {
      try {
        const result = await this.locks.get(key);
        return { status: 'COMPLETED', result };
      } catch (err) {
        // If the initial holder aborted with an error, propagate that error to waiting callers
        throw err;
      }
    }
    let resolveLock;
    let rejectLock;
    const lockPromise = new Promise((resolve, reject) => {
      resolveLock = resolve;
      rejectLock = reject;
    });
    // Attach noop catch to avoid unhandledRejection if nobody is awaiting this promise when aborted
    lockPromise.catch(() => {});
    this.locks.set(key, lockPromise);
    return {
      status: 'ACQUIRED',
      release: (val) => {
        this.locks.delete(key);
        this.keys.set(key, val);
        resolveLock(val);
      },
      abort: (err) => {
        this.locks.delete(key);
        rejectLock(err);
      },
    };
  }
}
