# Research note — making LLD practice a learning loop

## Learner problem

Low-level design practice has an awkward feedback gap. A learner can read a reference solution, reproduce familiar patterns, and still not know whether **their own** objects have sensible boundaries. Unlike a compilation error, a design can have several valid shapes. The learner needs to make reasoning inspectable—what is in scope, who owns which decision, how objects collaborate, and which change was anticipated—then receive feedback that points back to those choices.

The practice loop is therefore more valuable than another question library:

> choose a bounded prompt → create design evidence → receive criterion-level feedback → identify one next move → try again

### What learners need to submit

For an MVP, a structured design brief is enough evidence. It asks for assumptions, named objects/responsibilities, a key interaction, an edge case, and a future change or test angle. This is deliberately smaller than “upload any diagram or code,” but richer than an unstructured answer box. It also lets a reviewer ask *why* a boundary exists rather than merely count classes.

## Existing approaches sampled

| Approach | What it does well | Gap relevant to this MVP |
|---|---|---|
| **DesignGurus / Grokking OOD** | Provides a structured collection of object-oriented design lessons and representative interview problems. It helps learners recognise recurring design techniques. | Content and reference solutions can build recognition, but learners still need feedback on their own alternative design. |
| **Hello Interview guided practice** | Uses guided practice and an AI tutor alongside system-design preparation, moving beyond passive reading. | Feedback needs clear, stable criteria so it teaches a reusable design habit instead of producing an unexplained score. |
| **System Design Primer** | An open-source, deeply referenced study resource with worked concepts and many discussion entry points. | Its breadth is valuable for learning, but it is not a personal LLD attempt record or a focused feedback loop. |
| **Whiteboards / diagram tools** | Let learners express structure freely and resemble an interview setting. | A blank canvas is hard to evaluate consistently and is expensive to build well in a short MVP. |

Sources consulted:

1. [DesignGurus — Grokking the Object Oriented Design Interview](https://www.designgurus.io/course/grokking-the-object-oriented-design-interview)
2. [Hello Interview — System Design](https://www.hellointerview.com/learn/system-design)
3. [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer)
4. [PlantUML](https://plantuml.com/) (an example of a text-to-diagram workflow)

These products and resources suggest that content, examples, and free-form diagramming already exist. The sharper opportunity is to make a learner’s **attempt history and next improvement** first-class.

## Product direction: Design Forge

**Design Forge** is a small “practice studio,” not an LMS. It contains three intentionally constrained LLD problems and one submission format: a text design brief. The learner sees the problem requirements, writes the brief in a scaffold if useful, submits, and gets feedback across five stable dimensions:

1. Requirements and assumptions
2. Class responsibilities
3. Collaboration and abstraction
4. Behaviour and edge cases
5. Evolution and testability

Each dimension returns a score, the evidence visible in the brief, a concern, and a targeted suggestion. The product stores every attempt, so feedback can serve a retry rather than end in a one-time score.

## Why this is an MVP rather than a generic AI grader

The evaluator is rubric-first. It does not compare against a single canonical class diagram because a parking-lot design may reasonably use different policies, aggregates, or object names. The running prototype uses deterministic evidence signals so its output is reproducible and its limits are honest. A future LLM can judge nuance (cohesion, trade-offs, appropriateness) only within the same fixed rubric and only with structured output.

The core success metric is not “average score.” It is whether a learner can name a concrete improvement in the next attempt—e.g., “I will isolate pricing behind `PricingPolicy` and walk through an invalid-ticket flow.”
