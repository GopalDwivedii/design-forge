# AI usage

AI was used as an engineering copilot for exploration, drafting, and implementation. The final choices below were reviewed against the assignment’s constraint: build a focused LLD/domain-design MVP, not a large assessment platform.

| AI-assisted decision | Suggestion / exploration | Accepted or rejected | Why |
|---|---|---|---|
| MVP scope | Explored problem catalogues, diagrams, code execution, AI chat, leaderboards, and retries. | **Accepted:** three prompts, text brief, rubric feedback, attempt history. **Rejected:** a canvas, accounts, leaderboard, code sandbox. | A two-day build should strengthen the practice loop instead of spreading effort across LMS features. |
| Submission format (Change Test A) | Considered code, UML, free text, and a combined format. | **Accepted:** scaffolded text design brief as default with extensible `SubmissionFormat` (`design-brief`, `diagram`, `code`). | Captures object responsibilities and trade-offs while proving the domain model accommodates diagrams with zero redesign. |
| Domain split | Proposed a controller-heavy CRUD shape and a domain-oriented model. | **Accepted:** `Attempt`, `Submission`, `Evaluation`, `Problem`, and `AttemptService`; **rejected:** putting state changes in HTTP handlers. | Attempt lifecycle and failure rules are core behaviour and need direct unit tests. |
| Evaluation design (Change Test B) | Explored a raw prompt asking an LLM for a 100-point grade vs multiple evaluators. | **Rejected:** opaque single score. **Accepted:** five fixed rubric dimensions with pluggable `Evaluator` hierarchy (`HeuristicRubricEvaluator`, `RuleBasedRubricEvaluator`, `CompositeEvaluator`). | Multiple LLD solutions can be valid. Pluggable evaluators allow composing rule-based, heuristic, and future LLM models seamlessly. |
| Concurrency & Idempotency | Considered ignoring concurrent requests or relying on DB unique constraints. | **Accepted:** in-memory mutex promise locking via `InMemoryIdempotencyRepository.acquire()`. | Guarantees that parallel bursts of identical idempotency keys (e.g. 20 concurrent requests) resolve with 0 duplicate attempts. |
| Failure & Retry | Considered making `FAILED` a permanent dead end requiring re-typing the entire brief. | **Accepted:** `FAILED ──(retry)──► SUBMITTED` lifecycle transition via `attempt.retry()` and `service.retryEvaluation()`. | Evaluator hiccups should not force the learner to lose their work; enables a 1-click retry in the UI. |
| UI implementation | Assisted with information hierarchy and responsive styling ideas. | **Accepted:** problem-first studio, visible evaluation state, "Revise & try again", and "Iterate in studio" actions. | The UI keeps learners oriented around the next design decision and active iteration. |

## Human judgement and verification

- The AI output was not treated as an authoritative design answer. The domain model, state transitions, error handling, and scope were checked against the assignment’s change tests.
- The rubric labels explicitly describe **visible evidence**, not design correctness; the deterministic evaluator cannot judge semantic quality.
- Word boundary regexes (`\b`) were added to prevent false-positive substring matches (e.g. `downstream` matching `owns`).
- Tests were written for lifecycle transitions, validation, queued evaluation, duplicate submission, concurrent race conditions, evaluator crash recovery, and Change Test A/B compliance.

