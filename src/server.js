import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AttemptService } from './application/attempt-service.js';
import { DomainError } from './domain/models.js';
import { HeuristicRubricEvaluator } from './infrastructure/heuristic-evaluator.js';
import { seedProblems } from './infrastructure/problems.js';
import { InMemoryAttemptRepository, InMemoryIdempotencyRepository, InMemoryProblemRepository } from './infrastructure/repositories.js';

import { DiagramProcessor } from './infrastructure/diagram-processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const uploadDir = path.resolve(__dirname, '../uploads');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function createApplication() {
  const diagramProcessor = new DiagramProcessor({ uploadDir });
  const service = new AttemptService({
    problemRepository: new InMemoryProblemRepository(seedProblems),
    attemptRepository: new InMemoryAttemptRepository(),
    idempotencyRepository: new InMemoryIdempotencyRepository(),
    evaluator: new HeuristicRubricEvaluator(),
    scheduler: (work) => setTimeout(() => void work(), 900),
    clock: () => new Date().toISOString(),
    idGenerator: randomUUID,
  });
  return { service, diagramProcessor };
}

function publicProblem(problem) {
  return { id: problem.id, title: problem.title, level: problem.level, durationMinutes: problem.durationMinutes, prompt: problem.prompt, goals: problem.goals, constraints: problem.constraints, tags: problem.tags, starter: problem.starter };
}

function publicAttempt(attempt) {
  return {
    id: attempt.id,
    problemId: attempt.problemId,
    learnerId: attempt.learnerId,
    learnerName: attempt.learnerName,
    status: attempt.status,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    submittedAt: attempt.submittedAt,
    evaluatedAt: attempt.evaluatedAt,
    failureReason: attempt.failureReason,
    submission: attempt.submission ? {
      format: attempt.submission.format,
      content: attempt.submission.content,
      assumptions: attempt.submission.assumptions,
      metadata: attempt.submission.metadata,
    } : null,
    evaluation: attempt.evaluation ? {
      ...attempt.evaluation,
      score: attempt.evaluation.score,
      summary: attempt.evaluation.summary,
    } : null,
    renewedEvaluation: attempt.renewedEvaluation ? {
      ...attempt.renewedEvaluation,
      score: attempt.renewedEvaluation.score,
      summary: attempt.renewedEvaluation.summary,
    } : null,
    reviewResponses: attempt.reviewResponses || [],
  };
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000_000) throw new DomainError('Submission is too large.', 'PAYLOAD_TOO_LARGE');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new DomainError('Request body must be valid JSON.', 'INVALID_JSON'); }
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return send(response, 405, { error: 'Method not allowed' });
  }

  // Handle uploaded images from /uploads/
  if (pathname.startsWith('/uploads/')) {
    const filename = path.basename(pathname);
    const filePath = path.resolve(uploadDir, filename);
    if (!filePath.startsWith(uploadDir)) return send(response, 403, { error: 'Forbidden' });
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      response.end(await readFile(filePath));
      return;
    } catch {
      return send(response, 404, { error: 'File not found' });
    }
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(publicDir)) return send(response, 403, { error: 'Forbidden' });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(await readFile(filePath));
  } catch {
    send(response, 404, { error: 'Not found' });
  }
}

export function createServer(application = createApplication()) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    const cleanPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    try {
      if (request.method === 'GET' && cleanPath === '/api/problems') {
        const problems = await application.service.problemRepository.list();
        return send(response, 200, { problems: problems.map(publicProblem) });
      }
      if (request.method === 'POST' && cleanPath === '/api/problems') {
        const body = await readJson(request);
        const { Problem } = await import('./domain/models.js');
        const customId = body.id || `custom-${Date.now()}`;
        const newProblem = new Problem({
          id: customId,
          title: body.title || 'Custom Design Brief',
          level: body.level || 'Custom',
          durationMinutes: Number(body.durationMinutes) || 30,
          tags: Array.isArray(body.tags) && body.tags.length ? body.tags : ['Custom', 'Design'],
          prompt: body.prompt || 'Design your custom software system architecture and object model.',
          goals: Array.isArray(body.goals) && body.goals.length ? body.goals : ['Define core entities & contracts.', 'Establish state transitions.', 'Identify key change seams.'],
          constraints: Array.isArray(body.constraints) && body.constraints.length ? body.constraints : ['Keep responsibilities separated.', 'Account for failures and boundaries.'],
          starter: body.starter || `## Scope & assumptions\n- Custom problem scope.\n\n## Core objects & responsibilities\n- ...\n\n## Key flows\n1. ...\n\n## Edges & tests\n- ...`,
        });
        await application.service.problemRepository.save(newProblem);
        return send(response, 201, { problem: publicProblem(newProblem) });
      }
      if (request.method === 'GET' && cleanPath.startsWith('/api/problems/')) {
        const id = cleanPath.slice('/api/problems/'.length);
        const problem = await application.service.problemRepository.findById(id);
        return problem ? send(response, 200, { problem: publicProblem(problem) }) : send(response, 404, { error: 'Problem not found' });
      }
      if (request.method === 'GET' && cleanPath === '/api/attempts') {
        const attempts = await application.service.listForLearner(url.searchParams.get('learnerId'));
        return send(response, 200, { attempts: attempts.map(publicAttempt) });
      }
      if (request.method === 'POST' && /^\/api\/attempts\/[^/]+\/retry$/.test(cleanPath)) {
        const id = cleanPath.split('/')[3];
        const attempt = await application.service.retryEvaluation(id);
        return send(response, 202, { attempt: publicAttempt(attempt) });
      }
      if (request.method === 'POST' && /^\/api\/attempts\/[^/]+\/review-improve$/.test(cleanPath)) {
        const id = cleanPath.split('/')[3];
        const body = await readJson(request);
        const attempt = await application.service.submitReviewImprovement(id, body);
        return send(response, 200, { attempt: publicAttempt(attempt) });
      }
      if (request.method === 'POST' && cleanPath === '/api/diagrams/upload') {
        const body = await readJson(request);
        const processed = await application.diagramProcessor.processDiagramUpload(body);
        return send(response, 201, { diagram: processed });
      }
      if (request.method === 'GET' && cleanPath.startsWith('/api/attempts/')) {
        const id = cleanPath.slice('/api/attempts/'.length);
        return send(response, 200, { attempt: publicAttempt(await application.service.get(id)) });
      }
      if (request.method === 'POST' && cleanPath === '/api/attempts') {
        const body = await readJson(request);
        const idempotencyKey = request.headers['idempotency-key'] || body.idempotencyKey;
        const { attempt, replayed } = await application.service.create({ ...body, idempotencyKey });
        return send(response, replayed ? 200 : 202, { attempt: publicAttempt(attempt), replayed });
      }
      return serveStatic(request, response, pathname);
    } catch (error) {
      const status = error instanceof DomainError
        ? (['PROBLEM_NOT_FOUND', 'ATTEMPT_NOT_FOUND'].includes(error.code) ? 404 : error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422)
        : 500;
      if (status === 500) console.error(error);
      return send(response, status, { error: error.message || 'Unexpected server error.', code: error.code });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`Design Forge is ready on http://0.0.0.0:${port}`));
}
