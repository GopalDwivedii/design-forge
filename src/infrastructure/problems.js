import { Problem } from '../domain/models.js';

export const seedProblems = [
  new Problem({
    id: 'parking-lot',
    title: 'Adaptive Parking Lot',
    level: 'Intermediate',
    durationMinutes: 35,
    tags: ['Allocation', 'Pricing', 'State'],
    prompt: 'Design the core software for a multi-floor parking lot. It should admit vehicles, allocate a suitable spot, issue a ticket, calculate fees at exit, and show availability. Focus on the object model and the interactions, not APIs or a database.',
    goals: ['Separate allocation policy from parking-lot state.', 'Make pricing replaceable without editing exit flow.', 'Handle a full lot, an invalid ticket, and a lost-ticket policy.'],
    constraints: ['Support motorcycle, car, and truck spots.', 'Assume one active ticket per vehicle.', 'Availability must not go negative.'],
    starter: `## Scope & assumptions\n- The lot has multiple floors and a finite set of typed spots.\n- A vehicle has at most one active ticket.\n\n## Core objects & responsibilities\n- ParkingLot: ...\n- SpotAllocator: ...\n- ParkingSpot: ...\n- Ticket: ...\n- PricingPolicy: ...\n\n## Key flows\n### Entry\n1. ...\n\n### Exit\n1. ...\n\n## Edges, trade-offs & tests\n- ...`,
  }),
  new Problem({
    id: 'vending-machine',
    title: 'Vending Machine',
    level: 'Foundational',
    durationMinutes: 25,
    tags: ['State', 'Money', 'Inventory'],
    prompt: 'Design a vending machine that accepts coins, lets a shopper select an item, dispenses stock, returns change, and supports restocking. Explain how the machine behaves for insufficient funds, unavailable stock, cancellation, and no exact change.',
    goals: ['Model the transaction state explicitly.', 'Keep inventory and payment concerns separate.', 'Make accepted money or change strategy replaceable.'],
    constraints: ['The MVP handles one shopper transaction at a time.', 'Stock cannot fall below zero.', 'A cancelled transaction returns inserted money.'],
    starter: `## Scope & assumptions\n- One transaction is active at a time.\n- Coin denominations are configured by the machine.\n\n## Core objects & responsibilities\n- VendingMachine: ...\n- Transaction: ...\n- Inventory: ...\n- ChangeCalculator: ...\n\n## Key flows\n### Purchase\n1. ...\n\n## Edges, trade-offs & tests\n- ...`,
  }),
  new Problem({
    id: 'elevator-control',
    title: 'Elevator Controller',
    level: 'Advanced',
    durationMinutes: 45,
    tags: ['Scheduling', 'Events', 'Policy'],
    prompt: 'Design the core control software for a building with several elevators. A user can request a lift from a floor, choose a destination inside a car, and see progress. Focus on assigning requests and keeping each car safe and understandable.',
    goals: ['Separate dispatch policy from elevator movement.', 'Model door and travel states.', 'Explain how requests are represented and assigned.'],
    constraints: ['Ignore emergency hardware integration.', 'Do not send a car with doors open.', 'A policy can be swapped for a better scheduling strategy later.'],
    starter: `## Scope & assumptions\n- Requests come from floors and from inside a car.\n- Safety rules are enforced by the elevator state machine.\n\n## Core objects & responsibilities\n- ElevatorController: ...\n- DispatchPolicy: ...\n- ElevatorCar: ...\n- Request: ...\n\n## Key flows\n### Hall request\n1. ...\n\n## Edges, trade-offs & tests\n- ...`,
  }),
];
