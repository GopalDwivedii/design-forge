import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptService } from '../src/application/attempt-service.js';
import { CompositeEvaluator, HeuristicRubricEvaluator, RuleBasedRubricEvaluator, findMatches } from '../src/infrastructure/heuristic-evaluator.js';
import { seedProblems } from '../src/infrastructure/problems.js';
import { InMemoryAttemptRepository, InMemoryIdempotencyRepository, InMemoryProblemRepository } from '../src/infrastructure/repositories.js';
import { DEFAULT_RUBRIC } from '../src/domain/rubric.js';
import { Submission } from '../src/domain/models.js';

function makeService(scheduler = () => {}) {
  let count = 0;
  return new AttemptService({
    problemRepository: new InMemoryProblemRepository(seedProblems),
    attemptRepository: new InMemoryAttemptRepository(),
    idempotencyRepository: new InMemoryIdempotencyRepository(),
    evaluator: new HeuristicRubricEvaluator({ clock: () => '2026-10-12T10:01:00.000Z' }),
    scheduler,
    clock: () => '2026-10-12T10:00:00.000Z',
    idGenerator: () => `attempt-${++count}`,
  });
}

const meaningfulDesign = `## Scope and assumptions
The requirement is a multi-floor lot with a capacity rule and a lost ticket policy.
## Classes and responsibilities
ParkingLot owns the spots. SpotAllocator is an interface and class that selects a suitable spot. Ticket owns the entry time. PricingPolicy is a strategy injected into the exit service.
## Flow and edge cases
When entry happens, the allocator returns a spot or a full error. At exit, the ticket is invalid if closed; the policy calculates a fee and the spot state transitions to available.
## Evolution and tests
We can replace the pricing strategy for weekend rates. Unit tests mock the allocator and test cancellation and full-lot behaviour.`;

test('creates a saved attempt then evaluates it through the queued work', async () => {
  let queued;
  const service = makeService((work) => { queued = work; });
  const created = await service.create({ problemId: 'parking-lot', learnerId: 'learner-1', learnerName: 'Sam', content: meaningfulDesign, idempotencyKey: 'request-1' });
  assert.equal(created.attempt.status, 'SUBMITTED');
  await queued();
  const finished = await service.get(created.attempt.id);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.evaluation.dimensions.length, 5);
});

test('replays an idempotent create request instead of duplicating an attempt', async () => {
  const service = makeService();
  const command = { problemId: 'parking-lot', learnerId: 'learner-1', learnerName: 'Sam', content: meaningfulDesign, idempotencyKey: 'same-request' };
  const first = await service.create(command);
  const second = await service.create(command);
  assert.equal(second.replayed, true);
  assert.equal(second.attempt.id, first.attempt.id);
  assert.equal((await service.listForLearner('learner-1')).length, 1);
});

test('handles high concurrency with 20 parallel requests under the same idempotency key', async () => {
  const service = makeService();
  const command = { problemId: 'parking-lot', learnerId: 'learner-concurrent', learnerName: 'Concurrent Sam', content: meaningfulDesign, idempotencyKey: 'concurrent-key-99' };

  // Dispatch 20 concurrent creation requests
  const results = await Promise.all(
    Array.from({ length: 20 }, () => service.create(command))
  );

  // Exactly one request creates the attempt, 19 are replayed
  const createdCount = results.filter((r) => !r.replayed).length;
  const replayedCount = results.filter((r) => r.replayed).length;
  assert.equal(createdCount, 1);
  assert.equal(replayedCount, 19);

  // All returned attempts have the exact same ID
  const firstId = results[0].attempt.id;
  for (const r of results) {
    assert.equal(r.attempt.id, firstId);
  }

  // Learner history contains exactly one attempt
  const list = await service.listForLearner('learner-concurrent');
  assert.equal(list.length, 1);
});

test('rejects a submission for an unknown problem', async () => {
  const service = makeService();
  await assert.rejects(() => service.create({ problemId: 'missing', learnerId: 'learner-1', content: meaningfulDesign, idempotencyKey: 'missing-problem' }), { code: 'PROBLEM_NOT_FOUND' });
});

test('marks attempt as FAILED when evaluator throws', async () => {
  let queued;
  let count = 0;
  const failingEvaluator = {
    async evaluate() {
      throw new Error('Simulated evaluator timeout or crash');
    },
  };
  const service = new AttemptService({
    problemRepository: new InMemoryProblemRepository(seedProblems),
    attemptRepository: new InMemoryAttemptRepository(),
    idempotencyRepository: new InMemoryIdempotencyRepository(),
    evaluator: failingEvaluator,
    scheduler: (work) => { queued = work; },
    clock: () => '2026-10-12T10:00:00.000Z',
    idGenerator: () => `attempt-fail-${++count}`,
  });

  const created = await service.create({
    problemId: 'parking-lot',
    learnerId: 'learner-fail',
    learnerName: 'Test Learner',
    content: meaningfulDesign,
    idempotencyKey: 'fail-request-1',
  });
  assert.equal(created.attempt.status, 'SUBMITTED');

  await queued();

  const failedAttempt = await service.get(created.attempt.id);
  assert.equal(failedAttempt.status, 'FAILED');
  assert.match(failedAttempt.failureReason, /Evaluation did not finish/);
  assert.equal(failedAttempt.submission.content, meaningfulDesign);
});

test('retries evaluation on a FAILED attempt via retryEvaluation', async () => {
  let queued;
  let count = 0;
  let shouldFail = true;

  const toggleEvaluator = {
    async evaluate({ submission, rubric }) {
      if (shouldFail) throw new Error('Evaluator temporarily unavailable');
      return new HeuristicRubricEvaluator().evaluate({ submission, rubric });
    },
  };

  const service = new AttemptService({
    problemRepository: new InMemoryProblemRepository(seedProblems),
    attemptRepository: new InMemoryAttemptRepository(),
    idempotencyRepository: new InMemoryIdempotencyRepository(),
    evaluator: toggleEvaluator,
    scheduler: (work) => { queued = work; },
    clock: () => '2026-10-12T10:00:00.000Z',
    idGenerator: () => `attempt-retry-${++count}`,
  });

  const created = await service.create({
    problemId: 'parking-lot',
    learnerId: 'learner-retry',
    content: meaningfulDesign,
    idempotencyKey: 'retry-key-1',
  });
  await queued();

  const failed = await service.get(created.attempt.id);
  assert.equal(failed.status, 'FAILED');

  // Fix evaluator and retry evaluation
  shouldFail = false;
  const retrying = await service.retryEvaluation(created.attempt.id);
  assert.equal(retrying.status, 'SUBMITTED');
  await queued();

  const completed = await service.get(created.attempt.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.evaluation.dimensions.length, 5);
});

test('rejects retryEvaluation on non-failed attempt', async () => {
  const service = makeService();
  const created = await service.create({
    problemId: 'parking-lot',
    learnerId: 'learner-retry-err',
    content: meaningfulDesign,
    idempotencyKey: 'retry-key-err',
  });
  await assert.rejects(
    () => service.retryEvaluation(created.attempt.id),
    (error) => error.code === 'INVALID_RETRY_STATUS'
  );
});

test('requires an idempotency key before submitting', async () => {
  const service = makeService();
  await assert.rejects(
    () => service.create({ problemId: 'parking-lot', learnerId: 'learner-1', content: meaningfulDesign }),
    { code: 'MISSING_IDEMPOTENCY_KEY' }
  );
});

test('lists attempts for learner in descending order of creation time', async () => {
  let currentTime = 1000;
  const service = new AttemptService({
    problemRepository: new InMemoryProblemRepository(seedProblems),
    attemptRepository: new InMemoryAttemptRepository(),
    idempotencyRepository: new InMemoryIdempotencyRepository(),
    evaluator: new HeuristicRubricEvaluator(),
    scheduler: () => {},
    clock: () => new Date(currentTime += 1000).toISOString(),
    idGenerator: () => `id-${currentTime}`,
  });

  await service.create({ problemId: 'parking-lot', learnerId: 'user-ordered', content: meaningfulDesign, idempotencyKey: 'k1' });
  await service.create({ problemId: 'vending-machine', learnerId: 'user-ordered', content: meaningfulDesign, idempotencyKey: 'k2' });

  const list = await service.listForLearner('user-ordered');
  assert.equal(list.length, 2);
  assert.ok(new Date(list[0].createdAt) > new Date(list[1].createdAt));
});

test('Change Test B: RuleBasedRubricEvaluator and CompositeEvaluator', async () => {
  const submission = new Submission({ content: meaningfulDesign });
  const problem = seedProblems[0];

  // 1. RuleBased evaluator
  const ruleEvaluator = new RuleBasedRubricEvaluator();
  const ruleEval = await ruleEvaluator.evaluate({ problem, submission, rubric: DEFAULT_RUBRIC });
  assert.equal(ruleEval.dimensions.length, 5);
  assert.ok(ruleEval.score >= 3);

  // 2. Composite evaluator combining RuleBased + Heuristic
  const compositeEvaluator = new CompositeEvaluator({
    evaluators: [ruleEvaluator, new HeuristicRubricEvaluator()],
  });
  const compositeEval = await compositeEvaluator.evaluate({ problem, submission, rubric: DEFAULT_RUBRIC });
  assert.equal(compositeEval.dimensions.length, 5);
  assert.ok(compositeEval.score >= 3);
  assert.match(compositeEval.evaluator, /composite-/);
});

test('findMatches uses word boundaries avoiding false positives on substring matches', () => {
  // 'downstream' should not match signal 'owns'
  const text = 'This downstream service is completely independent.';
  const matchesOwns = findMatches(text.toLowerCase(), ['owns']);
  assert.equal(matchesOwns.length, 0);

  // 'owns' by itself or as word should match
  const textWithOwns = 'The ParkingLot class owns the spots.';
  const matchesWithOwns = findMatches(textWithOwns.toLowerCase(), ['owns']);
  assert.equal(matchesWithOwns.length, 1);
  assert.equal(matchesWithOwns[0], 'owns');
});

test('DiagramProcessor parses Class, Activity, and Use Case diagram uploads and inspects structural features', async () => {
  const { DiagramProcessor, DiagramType } = await import('../src/infrastructure/diagram-processor.js');
  const processor = new DiagramProcessor();

  // Create mock base64 image data
  const sampleBase64 = 'data:image/png;base64,' + Buffer.from('Fake PNG image binary stream for testing LLD diagrams').toString('base64');

  // 1. Process Class diagram
  const classResult = await processor.processDiagramUpload({
    dataUrl: sampleBase64,
    filename: 'parking-lot-class-diagram.png',
    diagramType: DiagramType.CLASS,
    caption: 'Class Diagram showing SpotAllocator interface and ParkingLot aggregate',
  });
  assert.equal(classResult.diagramType, 'class');
  assert.equal(classResult.analysis.status, 'PROCESSED');
  assert.ok(classResult.analysis.elementsDetected.some((e) => e.includes('Interface') || e.includes('classes')));

  // 2. Process Activity diagram
  const activityResult = await processor.processDiagramUpload({
    dataUrl: sampleBase64,
    filename: 'entry-activity-flow.png',
    diagramType: DiagramType.ACTIVITY,
    caption: 'Activity flow showing entry decision branch and rollback on full lot',
  });
  assert.equal(activityResult.diagramType, 'activity');
  assert.ok(activityResult.analysis.elementsDetected.some((e) => e.includes('decision') || e.includes('flow')));

  // 3. Process Use Case diagram
  const useCaseResult = await processor.processDiagramUpload({
    dataUrl: sampleBase64,
    filename: 'system-use-case.png',
    diagramType: DiagramType.USE_CASE,
    caption: 'Use case diagram showing Driver actor and park vehicle boundary',
  });
  assert.equal(useCaseResult.diagramType, 'use_case');
  assert.ok(useCaseResult.analysis.elementsDetected.some((e) => e.includes('actor') || e.includes('use case')));
});

test('HeuristicRubricEvaluator quotes user remarks, evaluates diagrams, and generates guided review questions', async () => {
  const evaluator = new HeuristicRubricEvaluator();
  const problem = seedProblems[0];
  const submission = new Submission({
    content: meaningfulDesign,
    metadata: {
      diagrams: [
        { diagramType: 'class', filename: 'lot-classes.png', caption: 'Class relationships' },
        { diagramType: 'activity', filename: 'entry-flow.png', caption: 'Ticket flow' },
      ],
    },
  });

  const evaluation = await evaluator.evaluate({ problem, submission, rubric: DEFAULT_RUBRIC });
  assert.equal(evaluation.dimensions.length, 5);

  // Verifies quoting of user remarks & diagram parts specifically for testing dimensions
  const respDim = evaluation.dimensions.find((d) => d.id === 'responsibilities');
  assert.ok(respDim.quotedUserRemark.length > 5);
  assert.match(respDim.diagramPartEvidence, /Class Diagram/);

  // Verifies Socratic guided review questions were generated
  assert.ok(evaluation.summary.guidedQuestions.length > 0);
  assert.ok(evaluation.summary.guidedQuestions[0].question);
  assert.ok(evaluation.summary.guidedQuestions[0].hint);
  assert.ok(evaluation.summary.guidedQuestions[0].options.length >= 2);
});

test('AttemptService.submitReviewImprovement improves scores based on learner reflections', async () => {
  let queued;
  const service = makeService((work) => { queued = work; });

  const created = await service.create({
    problemId: 'parking-lot',
    learnerId: 'learner-reflect',
    learnerName: 'Reflective Learner',
    content: meaningfulDesign,
    idempotencyKey: 'reflect-req-1',
  });

  await queued(); // Complete initial evaluation
  const attempt = await service.get(created.attempt.id);
  assert.equal(attempt.status, 'COMPLETED');
  const initialScore = attempt.evaluation.score;

  // Learner submits guided reflections
  const questions = attempt.evaluation.summary.guidedQuestions;
  const responses = questions.map((q) => ({
    dimensionId: q.dimensionId,
    selectedOptionIndex: q.correctOptionIndex,
    correctOptionIndex: q.correctOptionIndex,
    reflection: 'I separated the SpotAllocator so pricing and spot assignment are decoupled.',
  }));

  const updatedAttempt = await service.submitReviewImprovement(attempt.id, { responses });
  assert.ok(updatedAttempt.renewedEvaluation);
  assert.ok(updatedAttempt.renewedEvaluation.score >= initialScore);
  assert.match(updatedAttempt.renewedEvaluation.summary.headline, /Renewed Review/);
});



