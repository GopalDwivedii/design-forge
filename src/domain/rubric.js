export const DEFAULT_RUBRIC = Object.freeze({
  version: '2026-09.v1',
  dimensions: [
    {
      id: 'requirements',
      label: 'Requirements & assumptions',
      question: 'Did the learner set a useful boundary and state the important rules or assumptions?',
    },
    {
      id: 'responsibilities',
      label: 'Responsibilities',
      question: 'Are responsibilities named clearly and placed on cohesive objects?',
    },
    {
      id: 'collaboration',
      label: 'Collaboration & abstraction',
      question: 'Are relationships, interfaces, and dependencies intentional rather than incidental?',
    },
    {
      id: 'behaviour',
      label: 'Behaviour & edge cases',
      question: 'Can a reader follow important flows, states, and failure cases?',
    },
    {
      id: 'evolution',
      label: 'Evolution & testability',
      question: 'Does the design identify a credible change seam or way to verify behaviour?',
    },
  ],
});
