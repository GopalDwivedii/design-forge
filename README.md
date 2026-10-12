# Design Forge — LLD Practice Platform

A focused prototype for the loop **choose a design problem → write a design brief → submit → receive explainable feedback → revisit attempts**.

The goal is not to declare one class diagram “correct”. Instead, the learner receives feedback against visible evidence in a fixed rubric: scope, responsibilities, collaboration, behaviour, and evolution.

![Node]<img src="https://img.shields.io/badge/tests-node%20test-1d6b5b?style=flat-square" alt="Tests" /> ![Tests]<img src="https://img.shields.io/badge/tests-node%20test-1d6b5b?style=flat-square" alt="Tests" />
<img width="1900" height="970" alt="image" src="https://github.com/user-attachments/assets/f73579c8-cd85-4203-a6e4-cf66515fc10f" />

## Run locally

```bash
npm test
npm start
# open http://localhost:3000
```

No package install or API key is required. The server binds to `0.0.0.0` and defaults to port `3000`; override it with `PORT=3001 npm start`.

## What is implemented

- **Three bounded LLD prompts:** Adaptive Parking Lot, Vending Machine, and Elevator Controller.
- **Structured design brief + extensible submission formats:** supports `design-brief`, `diagram`, and `code` formats (`SubmissionFormat`), addressing **Change Test A**.
- **Submission lifecycle with retry:** `DRAFT → SUBMITTED → EVALUATING → COMPLETED | FAILED`, with `FAILED ──(retry)──► SUBMITTED`.
- **Explainable rubric feedback:** five dimensions; each result includes score, observed evidence, concern, and a next suggestion.
- **Multiple Evaluators & Composite Pattern:** includes `HeuristicRubricEvaluator`, `RuleBasedRubricEvaluator`, and `CompositeEvaluator`, addressing **Change Test B**.
- **Concurrency & Reliability:** mutex locking in `InMemoryIdempotencyRepository.acquire()` guaranteeing zero duplicate attempts under high concurrency (e.g. 20 parallel requests), persisted-before-evaluation sequencing, word-boundary signal matching, and comprehensive tests.
- **Attempt trail & learning loop:** browser-scoped learner identity, interactive "Revise & try again", "Iterate in studio", and "Retry evaluation" actions.

## Architecture at a glance

```text
Browser UI
  │ relative JSON API
  ▼
HTTP adapter ──► AttemptService ──► Attempt / Submission / Evaluation (domain)
                    │                    │
                    │                    └── lifecycle rules & retry
                    ├── repositories (in-memory + concurrency mutex lock)
                    └── Evaluator port ──► Heuristic / RuleBased / Composite Evaluator
```

The HTTP layer is intentionally thin. `AttemptService` owns the use case, while `Attempt` owns legal state transitions. `HeuristicRubricEvaluator`, `RuleBasedRubricEvaluator`, and `CompositeEvaluator` implement the same `evaluate({ problem, submission, rubric })` contract that an LLM adapter or human-review adapter would use.

Read the rationale in [`docs/DESIGN.md`](docs/DESIGN.md) and learner research in [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Evaluation approach

The prototype includes:
1. `HeuristicRubricEvaluator`: deterministic, boundary-safe evidence detection grounded in problem domain terms.
2. `RuleBasedRubricEvaluator`: checks document structural sections (Scope, Classes, Flows, Trade-offs).
3. `CompositeEvaluator`: orchestrates multiple evaluators via the Composite pattern.

A production-quality next step would add `LlmRubricEvaluator` behind the same evaluator port. It would receive the problem, fixed rubric, learner brief, and a JSON schema; its structured output would be validated before an `Evaluation` is stored. Deterministic checks (length, valid state changes, idempotency, schema validation) remain outside the model.

## Important trade-offs and limitations

| Decision | Why | Cost / follow-up |
|---|---|---|
| Text brief only | Captures responsibilities and reasoning in two days without building a fragile diagram editor. | Add `DiagramSubmission` or `CodeSubmission` as new submission types later. |
| In-memory repositories | Keeps the demo runnable with zero setup. | Replace with a database adapter for persistence across server restarts. |
| Delayed in-process work | Shows a real evaluation state without distributed-system ceremony. | Use a durable job queue once evaluation latency/retries need durability. |
| Heuristic evaluator | Transparent and deterministic for a demo. | Add a guarded LLM evaluator and calibration with reviewers. |
| One learner per browser | Makes the learning trail easy to demonstrate. | Add authentication and a `LearnerRepository`. |

## Project layout

```text
public/                    responsive product UI
src/domain/                rules and stateful domain objects
src/application/           attempt use case orchestration
src/infrastructure/        repositories, problems, evaluator adapter
src/server.js              HTTP and static-file adapter
test/                      important domain and service behaviour
docs/                      research and design notes
AI_USAGE.md                meaningful AI-assisted decisions
```

## Test coverage

`npm test` covers lifecycle transitions, too-short designs, queued evaluation, idempotent retry, and unknown-problem rejection. The test strategy deliberately targets behaviours that would otherwise make feedback unreliable or attempts disappear.

## Next product increments

1. Persist attempts and evaluation jobs, then add retry from a failed evaluation.
2. Validate structured LLM feedback against the rubric schema and show quoted submission evidence.
3. Add a comparison view across attempts for the same problem.
4. Add code or UML submission adapters without changing the attempt lifecycle.

## AI usage

See [`AI_USAGE.md`](AI_USAGE.md). AI assisted implementation and design exploration; the final MVP scope, feedback guardrails, trade-offs, and documentation were deliberately reviewed against the assignment’s LLD focus.
