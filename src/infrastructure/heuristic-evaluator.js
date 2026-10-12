import { Evaluation } from '../domain/models.js';

const signals = {
  requirements: ['assumption', 'requirement', 'scope', 'rule', 'constraint', 'capacity', 'policy'],
  responsibilities: ['class', 'responsibil', 'owns', 'entity', 'object', 'service', 'manager'],
  collaboration: ['interface', 'depend', 'composition', 'inject', 'strategy', 'factory', 'adapter', 'collabor'],
  behaviour: ['flow', 'state', 'when', 'if', 'error', 'invalid', 'full', 'cancel', 'transition', 'edge'],
  evolution: ['extend', 'replace', 'test', 'mock', 'future', 'swap', 'plugg', 'change'],
};

const problemDomainSignals = {
  'parking-lot': ['spot', 'ticket', 'vehicle', 'pricing', 'floor', 'allocat', 'slot'],
  'vending-machine': ['item', 'coin', 'money', 'change', 'inventory', 'dispens', 'stock', 'refund'],
  'elevator-control': ['floor', 'elevator', 'door', 'request', 'dispatch', 'car', 'schedul'],
};

const guidance = {
  requirements: 'State the rules you are choosing and call out one rule you intentionally leave out.',
  responsibilities: 'Name who owns each decision; avoid a single manager that knows every detail.',
  collaboration: 'Draw one dependency seam, such as an interface around a policy that is likely to vary.',
  behaviour: 'Walk through one happy path and one failure path in ordered steps or states.',
  evolution: 'Name one expected future change and show the boundary that protects today’s flow.',
};

export function findMatches(text, words) {
  return words.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}`, 'i');
    return regex.test(text);
  });
}

function scoreFor(matches, contentLength) {
  const coverage = matches.length;
  if (coverage >= 5 && contentLength > 700) return 5;
  if (coverage >= 3 && contentLength > 400) return 4;
  if (coverage >= 2) return 3;
  if (coverage >= 1) return 2;
  return 1;
}

/**
 * Base interface / contract for all rubric evaluators.
 * Any implementation (deterministic, rule-based, LLM-backed, human reviewer) must adhere to this port.
 */
export class Evaluator {
  /**
   * @param {{ problem?: import('../domain/models.js').Problem, submission: import('../domain/models.js').Submission, rubric: typeof import('../domain/rubric.js').DEFAULT_RUBRIC }} params
   * @returns {Promise<Evaluation>}
   */
  async evaluate({ problem, submission, rubric }) {
    throw new Error('evaluate() must be implemented by subclass or adapter');
  }
}

/**
 * Deliberately conservative evaluator for the demo. It measures evidence in a
 * fixed rubric; it does not claim that keyword presence proves good design.
 * A production LLM adapter can implement the same evaluate contract.
 */
export class HeuristicRubricEvaluator extends Evaluator {
  constructor({ clock = () => new Date().toISOString() } = {}) {
    super();
    this.clock = clock;
    this.name = 'deterministic-rubric-v1';
  }

  async evaluate({ problem, submission, rubric }) {
    const rawContent = submission.content || '';
    const rawAssumptions = submission.assumptions || '';
    const diagrams = (submission.metadata && Array.isArray(submission.metadata.diagrams))
      ? submission.metadata.diagrams
      : [];

    const diagramText = diagrams.map((d) => `${d.diagramType || ''} ${d.caption || ''} ${d.filename || ''}`).join(' ');
    const text = `${rawContent}\n${rawAssumptions}\n${diagramText}`.toLowerCase();
    const problemSpecificMatches = problem && problemDomainSignals[problem.id]
      ? findMatches(text, problemDomainSignals[problem.id])
      : [];

    // Extract sentences or paragraphs from user content to accurately quote user remarks
    const userLines = rawContent.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 15 && !l.startsWith('#'));
    
    // Categorize uploaded diagrams
    const classDiagrams = diagrams.filter((d) => d.diagramType === 'class');
    const activityDiagrams = diagrams.filter((d) => d.diagramType === 'activity');
    const useCaseDiagrams = diagrams.filter((d) => d.diagramType === 'use_case');

    const dimensions = rubric.dimensions.map((criterion) => {
      const matches = findMatches(text, signals[criterion.id] ?? []);
      let score = scoreFor(matches, text.length);

      // Boost score if corresponding diagram exists and provides concrete evidence
      if (criterion.id === 'responsibilities' && classDiagrams.length > 0) {
        score = Math.min(5, Math.max(score, 3) + 1);
      }
      if (criterion.id === 'collaboration' && classDiagrams.length > 0) {
        score = Math.min(5, score + 1);
      }
      if (criterion.id === 'behaviour' && activityDiagrams.length > 0) {
        score = Math.min(5, Math.max(score, 3) + 1);
      }
      if (criterion.id === 'requirements' && useCaseDiagrams.length > 0) {
        score = Math.min(5, Math.max(score, 3) + 1);
      }

      let evidence = matches.length
        ? `Found design evidence around: ${matches.slice(0, 3).join(', ')}.`
        : 'No explicit evidence was found for this dimension in the submitted brief.';

      if (criterion.id === 'requirements' && problemSpecificMatches.length > 0) {
        evidence += ` Domain terms identified: ${problemSpecificMatches.slice(0, 3).join(', ')}.`;
      }

      // Add diagram specific evidence
      if (criterion.id === 'responsibilities' && classDiagrams.length > 0) {
        evidence += ` [Class Diagram: ${classDiagrams.map((d) => d.filename || d.caption || 'uploaded class diagram').join(', ')}]`;
      }
      if (criterion.id === 'behaviour' && activityDiagrams.length > 0) {
        evidence += ` [Activity Diagram: ${activityDiagrams.map((d) => d.filename || d.caption || 'workflow execution flow').join(', ')}]`;
      }
      if (criterion.id === 'requirements' && useCaseDiagrams.length > 0) {
        evidence += ` [Use Case Diagram: ${useCaseDiagrams.map((d) => d.filename || d.caption || 'actor and use-case scope').join(', ')}]`;
      }

      const concern = score >= 4
        ? 'The next improvement is to make the trade-off or boundary more concrete.'
        : guidance[criterion.id];

      // Identify quoted user remarks relevant to this dimension
      const relevantRemarks = userLines.filter((line) => {
        const lineLower = line.toLowerCase();
        return (signals[criterion.id] ?? []).some((sig) => lineLower.includes(sig));
      });
      const quotedUserRemark = relevantRemarks.length > 0
        ? `"${relevantRemarks[0]}"`
        : userLines.length > 0
          ? `"${userLines[0]}"`
          : 'None specified';

      // Identify diagram parts
      let diagramPartEvidence = 'None attached';
      if (criterion.id === 'responsibilities') {
        diagramPartEvidence = classDiagrams.length > 0 ? `Class Diagram (${classDiagrams[0].filename}): Entities, attributes & method contracts` : 'Class Diagram missing or unattached';
      } else if (criterion.id === 'collaboration') {
        diagramPartEvidence = classDiagrams.length > 0 ? `Class Diagram (${classDiagrams[0].filename}): Association & dependency arrows` : 'Class Diagram abstraction seams missing';
      } else if (criterion.id === 'behaviour') {
        diagramPartEvidence = activityDiagrams.length > 0 ? `Activity Diagram (${activityDiagrams[0].filename}): Decision branches & transition nodes` : 'Activity Diagram workflow missing';
      } else if (criterion.id === 'requirements') {
        diagramPartEvidence = useCaseDiagrams.length > 0 ? `Use Case Diagram (${useCaseDiagrams[0].filename}): Actor boundaries & <<include>>/<<extend>>` : 'Use Case Diagram boundary missing';
      } else if (criterion.id === 'evolution') {
        diagramPartEvidence = classDiagrams.length > 0 ? `Class Diagram (${classDiagrams[0].filename}): Strategy/Factory pluggable seams` : 'Change seam diagrams missing';
      }

      return {
        id: criterion.id,
        label: criterion.label,
        score,
        evidence,
        concern,
        suggestion: guidance[criterion.id],
        confidence: matches.length >= 2 ? 'medium' : 'low',
        quotedUserRemark,
        diagramPartEvidence,
      };
    });

    const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
    const priority = [...dimensions].sort((a, b) => a.score - b.score)[0];
    const shortWarning = text.length < 450
      ? 'This is a compact brief. Add a concrete object interaction or edge case for higher-confidence feedback.'
      : 'The rubric found enough written evidence to identify a focused next step.';

    // Generate guided review questions targeting weaker components (score < 4)
    const guidedQuestions = this.generateGuidedReviewQuestions({ dimensions, problem, diagrams });

    return new Evaluation({
      evaluator: this.name,
      rubricVersion: rubric.version,
      dimensions,
      summary: {
        headline: `Your strongest visible signal is ${strongest.label.toLowerCase()}.`,
        nextStep: `Prioritise ${priority.label.toLowerCase()}: ${priority.suggestion}`,
        caveat: shortWarning,
        weakestDimensions: dimensions.filter((d) => d.score < 4).map((d) => d.label),
        diagramsProcessed: diagrams.length,
        guidedQuestions,
      },
      createdAt: this.clock(),
    });
  }

  /**
   * Generates guided, Socratic questions to help the learner understand missing or weak components.
   */
  generateGuidedReviewQuestions({ dimensions, problem, diagrams }) {
    const weakDims = dimensions.filter((d) => d.score < 4);
    const questions = [];

    for (const dim of (weakDims.length > 0 ? weakDims : dimensions.slice(0, 2))) {
      if (dim.id === 'requirements') {
        questions.push({
          dimensionId: 'requirements',
          dimensionLabel: 'Requirements & assumptions',
          question: 'Consider the edge cases and boundaries of this system. What happens when capacity is completely exhausted or a client makes an invalid or duplicate request?',
          hint: 'Think about whether your Use Case or brief specifies error states or system bounds.',
          expectedComponent: 'Boundary constraints and explicit rejection policies',
          options: [
            'Let the system throw an unhandled runtime error',
            'Define an explicit capacity check and return an informative domain error/status',
            'Silently ignore the request and proceed anyway',
          ],
          correctOptionIndex: 1,
          reflectionPrompt: 'How does your design explicitly model this edge case without breaking caller assumptions?',
        });
      } else if (dim.id === 'responsibilities') {
        questions.push({
          dimensionId: 'responsibilities',
          dimensionLabel: 'Responsibilities',
          question: 'Look closely at your primary controller or manager class. Does it own business calculations, state storage, and external notifications all by itself?',
          hint: 'Review your Class Diagram: identify whether a single "god class" knows too much.',
          expectedComponent: 'Separation of concerns (Single Responsibility Principle)',
          options: [
            'Keep all calculation and routing logic in the main controller class',
            'Delegate business calculations and spot allocation to specialized domain strategy/service objects',
            'Let the UI or database directly mutate the domain entity fields',
          ],
          correctOptionIndex: 1,
          reflectionPrompt: 'Which specific class in your design should be freed from orchestration duties?',
        });
      } else if (dim.id === 'collaboration') {
        questions.push({
          dimensionId: 'collaboration',
          dimensionLabel: 'Collaboration & abstraction',
          question: 'If a business rule (such as pricing, rate limiting, or dispatch strategy) changes tomorrow, which classes would need code modifications?',
          hint: 'Check your Class Diagram: are dependencies pointing directly to concrete classes or to abstraction interfaces?',
          expectedComponent: 'Interface abstraction seams (Dependency Inversion)',
          options: [
            'Modify the core controller code with hardcoded if-else statements for each rule',
            'Depend on an abstract interface/policy seam that allows injecting alternate implementations',
            'Duplicate the controller for each different business rule',
          ],
          correctOptionIndex: 1,
          reflectionPrompt: 'What interface contract would you place between the caller and the varying algorithm?',
        });
      } else if (dim.id === 'behaviour') {
        questions.push({
          dimensionId: 'behaviour',
          dimensionLabel: 'Behaviour & edge cases',
          question: 'Follow the execution trace when a transaction fails mid-way (e.g., payment cancelled, spot occupied concurrently). How does the state transition back to safety?',
          hint: 'Inspect your Activity Diagram: does it depict alternate rollback/cancellation branches?',
          expectedComponent: 'Explicit state transition rollback and failure handling',
          options: [
            'Assume operations never fail after initiation',
            'Model a dedicated cancellation/reversal transition path that cleans up reserved resources',
            'Leave the system in an indeterminate state until restart',
          ],
          correctOptionIndex: 1,
          reflectionPrompt: 'What explicit state transitions occur during an aborted or invalid workflow?',
        });
      } else if (dim.id === 'evolution') {
        questions.push({
          dimensionId: 'evolution',
          dimensionLabel: 'Evolution & testability',
          question: 'How easily can your core business logic be unit-tested without connecting to a real clock, network, or storage system?',
          hint: 'Look for seams where time or hardware dependencies can be mocked or swapped.',
          expectedComponent: 'Testability seams and decoupled time/infrastructure dependencies',
          options: [
            'Instantiate concrete hardware and system time directly inside methods',
            'Pass time suppliers and repository dependencies via constructor injection for easy mocking',
            'Skip automated testing and rely only on manual verification',
          ],
          correctOptionIndex: 1,
          reflectionPrompt: 'Where is the dependency injection seam in your object constructors?',
        });
      }
    }

    return questions;
  }
}


/**
 * Rule-based evaluator that checks structural document sections (Change Test B implementation).
 */
export class RuleBasedRubricEvaluator extends Evaluator {
  constructor({ clock = () => new Date().toISOString() } = {}) {
    super();
    this.clock = clock;
    this.name = 'rule-based-structural-v1';
  }

  async evaluate({ problem, submission, rubric }) {
    const text = `${submission.content}\n${submission.assumptions}`.toLowerCase();
    const hasScope = /#+\s*(scope|assumption|requirement|rule)/i.test(text);
    const hasClasses = /#+\s*(class|object|responsibilit|entit|service)/i.test(text);
    const hasFlows = /#+\s*(flow|step|sequence|interaction)/i.test(text);
    const hasEdges = /#+\s*(edge|trade-off|error|fail|test|evolution)/i.test(text);

    const dimensions = rubric.dimensions.map((criterion) => {
      let score = 2;
      let evidence = 'Section not explicitly structured.';
      if (criterion.id === 'requirements') {
        score = hasScope ? 4 : 2;
        evidence = hasScope ? 'Explicit Scope & Assumptions section detected.' : 'No explicit scope header found.';
      } else if (criterion.id === 'responsibilities') {
        score = hasClasses ? 4 : 2;
        evidence = hasClasses ? 'Explicit Object / Responsibilities section detected.' : 'No explicit responsibilities header found.';
      } else if (criterion.id === 'collaboration') {
        score = (hasClasses && hasFlows) ? 3 : 2;
        evidence = (hasClasses && hasFlows) ? 'Interaction between objects referenced.' : 'Limited object interaction shown.';
      } else if (criterion.id === 'behaviour') {
        score = hasFlows ? 4 : 2;
        evidence = hasFlows ? 'Step-by-step key flows detected.' : 'Flow steps not clearly delineated.';
      } else if (criterion.id === 'evolution') {
        score = hasEdges ? 4 : 2;
        evidence = hasEdges ? 'Edge cases, trade-offs, or testing seams documented.' : 'No clear edge case or extension section.';
      }

      return {
        id: criterion.id,
        label: criterion.label,
        score,
        evidence,
        concern: score < 4 ? `Add a dedicated section for ${criterion.label}.` : 'Good structural separation.',
        suggestion: guidance[criterion.id] || `Structure ${criterion.label.toLowerCase()} cleanly.`,
        confidence: 'high',
      };
    });

    return new Evaluation({
      evaluator: this.name,
      rubricVersion: rubric.version,
      dimensions,
      summary: {
        headline: 'Structural section verification complete.',
        nextStep: 'Ensure all critical design sections are explicitly demarcated with headings.',
        caveat: 'This evaluator measures document structure and heading presence.',
      },
      createdAt: this.clock(),
    });
  }
}

/**
 * Composite evaluator that combines multiple evaluators (Composite Pattern, satisfying Change Test B).
 */
export class CompositeEvaluator extends Evaluator {
  constructor({ evaluators = [], clock = () => new Date().toISOString() } = {}) {
    super();
    if (!Array.isArray(evaluators) || evaluators.length === 0) {
      throw new Error('CompositeEvaluator requires at least one sub-evaluator.');
    }
    this.evaluators = evaluators;
    this.clock = clock;
    this.name = `composite-[${evaluators.map((e) => e.name || 'evaluator').join('+')}]`;
  }

  async evaluate({ problem, submission, rubric }) {
    const results = await Promise.all(
      this.evaluators.map((evaluator) => evaluator.evaluate({ problem, submission, rubric }))
    );

    const mergedDimensions = rubric.dimensions.map((criterion) => {
      const dimResults = results.map((r) => r.dimensions.find((d) => d.id === criterion.id)).filter(Boolean);
      const avgScore = Math.max(1, Math.min(5, Math.round(dimResults.reduce((sum, d) => sum + d.score, 0) / dimResults.length)));
      const combinedEvidence = dimResults.map((d) => d.evidence).filter(Boolean).join(' | ');
      const suggestion = dimResults[0]?.suggestion || '';
      const concern = dimResults[0]?.concern || '';

      return {
        id: criterion.id,
        label: criterion.label,
        score: avgScore,
        evidence: combinedEvidence,
        concern,
        suggestion,
        confidence: 'high',
      };
    });

    return new Evaluation({
      evaluator: this.name,
      rubricVersion: rubric.version,
      dimensions: mergedDimensions,
      summary: results[0].summary,
      createdAt: this.clock(),
    });
  }
}
