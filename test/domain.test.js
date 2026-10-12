import test from 'node:test';
import assert from 'node:assert/strict';
import { Attempt, AttemptStatus, DomainError, Evaluation, Submission } from '../src/domain/models.js';

const now = '2026-10-12T10:00:00.000Z';
const submission = new Submission({ content: '## Scope\nA clear design with classes, flows, interfaces, errors, tests, and future extensions.' });

function evaluation() {
  return new Evaluation({ evaluator: 'test', rubricVersion: 'v1', createdAt: now, summary: {}, dimensions: [{ id: 'one', label: 'One', score: 3, evidence: '', concern: '', suggestion: '' }] });
}

test('an attempt follows the submitted → evaluating → completed lifecycle', () => {
  const attempt = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  attempt.submit(now);
  attempt.startEvaluation(now);
  attempt.complete(evaluation(), now);
  assert.equal(attempt.status, AttemptStatus.COMPLETED);
  assert.equal(attempt.evaluation.score, 3);
  assert.equal(attempt.submittedAt, now);
});

test('an attempt cannot complete before it has begun evaluation', () => {
  const attempt = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  assert.throws(() => attempt.complete(evaluation(), now), (error) => error instanceof DomainError && error.code === 'INVALID_ATTEMPT_TRANSITION');
});

test('a design brief needs enough evidence to review', () => {
  assert.throws(() => new Submission({ content: 'too short' }), (error) => error.code === 'SUBMISSION_TOO_SHORT');
});

test('a submission accepts content meeting exactly the minimum 80 chars boundary', () => {
  const content80 = 'A'.repeat(80);
  const sub = new Submission({ content: content80 });
  assert.equal(sub.content.length, 80);
});

test('an evaluation rejects scores outside the 1 to 5 range', () => {
  assert.throws(
    () => new Evaluation({
      evaluator: 'test',
      rubricVersion: 'v1',
      createdAt: now,
      summary: {},
      dimensions: [{ id: 'one', label: 'One', score: 6, evidence: '', concern: '', suggestion: '' }],
    }),
    (error) => error instanceof DomainError && error.message.includes('Rubric scores must be numbers between 1 and 5')
  );

  assert.throws(
    () => new Evaluation({
      evaluator: 'test',
      rubricVersion: 'v1',
      createdAt: now,
      summary: {},
      dimensions: [{ id: 'one', label: 'One', score: 0, evidence: '', concern: '', suggestion: '' }],
    }),
    (error) => error instanceof DomainError && error.message.includes('Rubric scores must be numbers between 1 and 5')
  );
});

test('an attempt can transition to FAILED from SUBMITTED or EVALUATING', () => {
  const attempt1 = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  attempt1.submit(now);
  attempt1.fail('Evaluator crashed before start', now);
  assert.equal(attempt1.status, AttemptStatus.FAILED);
  assert.equal(attempt1.failureReason, 'Evaluator crashed before start');

  const attempt2 = new Attempt({ id: 'a2', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  attempt2.submit(now);
  attempt2.startEvaluation(now);
  attempt2.fail('Evaluator timed out during execution', now);
  assert.equal(attempt2.status, AttemptStatus.FAILED);
});

test('an attempt cannot transition once COMPLETED', () => {
  const attempt = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  attempt.submit(now);
  attempt.startEvaluation(now);
  attempt.complete(evaluation(), now);
  assert.throws(() => attempt.fail('Late failure', now), (error) => error.code === 'INVALID_ATTEMPT_TRANSITION');
});

test('an evaluation rejects non-numeric or NaN scores', () => {
  assert.throws(
    () => new Evaluation({
      evaluator: 'test',
      rubricVersion: 'v1',
      createdAt: now,
      summary: {},
      dimensions: [{ id: 'one', label: 'One', score: NaN, evidence: '', concern: '', suggestion: '' }],
    }),
    (error) => error instanceof DomainError && error.message.includes('Rubric scores must be numbers between 1 and 5')
  );

  assert.throws(
    () => new Evaluation({
      evaluator: 'test',
      rubricVersion: 'v1',
      createdAt: now,
      summary: {},
      dimensions: [{ id: 'one', label: 'One', score: '3', evidence: '', concern: '', suggestion: '' }],
    }),
    (error) => error instanceof DomainError && error.message.includes('Rubric scores must be numbers between 1 and 5')
  );
});

test('an evaluation rejects missing evaluator or rubricVersion', () => {
  assert.throws(
    () => new Evaluation({
      evaluator: '',
      rubricVersion: 'v1',
      createdAt: now,
      summary: {},
      dimensions: [{ id: 'one', label: 'One', score: 3, evidence: '', concern: '', suggestion: '' }],
    }),
    (error) => error instanceof DomainError && error.message.includes('needs an evaluator identifier')
  );
});

test('a submission accepts diagram format (Change Test A)', () => {
  const diagramSub = new Submission({
    format: 'diagram',
    content: 'classDiagram\nParkingLot --> SpotAllocator',
  });
  assert.equal(diagramSub.format, 'diagram');
  assert.equal(diagramSub.content, 'classDiagram\nParkingLot --> SpotAllocator');
});

test('a submission rejects unsupported format or non-string content', () => {
  assert.throws(
    () => new Submission({ format: 'video', content: 'test content' }),
    (error) => error instanceof DomainError && error.code === 'UNSUPPORTED_FORMAT'
  );
  assert.throws(
    () => new Submission({ content: 12345 }),
    (error) => error instanceof DomainError && error.code === 'SUBMISSION_TOO_SHORT'
  );
});

test('an attempt cannot be submitted without a submission', () => {
  const attemptNoSub = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission: null, createdAt: now });
  assert.throws(
    () => attemptNoSub.submit(now),
    (error) => error instanceof DomainError && error.code === 'MISSING_SUBMISSION'
  );
});

test('an attempt can retry from FAILED to SUBMITTED', () => {
  const attempt = new Attempt({ id: 'a1', problemId: 'parking-lot', learnerId: 'l1', submission, createdAt: now });
  attempt.submit(now);
  attempt.fail('Evaluator crashed', now);
  assert.equal(attempt.status, AttemptStatus.FAILED);
  
  attempt.retry(now);
  assert.equal(attempt.status, AttemptStatus.SUBMITTED);
  assert.equal(attempt.failureReason, null);
});


