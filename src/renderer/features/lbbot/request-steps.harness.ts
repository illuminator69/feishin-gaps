import assert from 'node:assert/strict';
import test from 'node:test';

import { currentStep, requestSteps } from './request-steps.ts';

/**
 * R11: a request's five steps, after Navic's `requestSteps`.
 *
 *     node --test src/renderer/features/lbbot/request-steps.harness.ts
 */

test('each running state is one step', () => {
    assert.equal(currentStep(requestSteps('searching', 0, 0)), 0);
    assert.equal(currentStep(requestSteps('queued', 0, 0)), 1);
    assert.equal(currentStep(requestSteps('downloading', 0, 0)), 2);
    assert.equal(currentStep(requestSteps('placing', 0, 0)), 3);
    assert.equal(currentStep(requestSteps('placed', 0, 0)), 4);
});

test('verified has every step done', () => {
    const steps = requestSteps('verified', 0, 0);
    assert.equal(currentStep(steps), -1);
    assert.ok(steps.every((step) => step.status === 'done'));
});

test('a state that is not a step of a running request gives none', () => {
    assert.deepEqual(requestSteps('failed', 0, 0), []);
    assert.deepEqual(requestSteps('', 0, 0), []);
    assert.deepEqual(requestSteps('cancelled', 0, 0), []);
});

test('the first step says whether the source is still being found', () => {
    assert.equal(requestSteps('searching', 0, 0)[0].label, 'Finding a source');
    assert.equal(requestSteps('queued', 0, 0)[0].label, 'Source chosen');
});

test('the count rides on Downloading only while it is the step that moves', () => {
    assert.equal(requestSteps('downloading', 3, 12)[2].detail, '3 of 12');
    assert.equal(requestSteps('downloading', 0, 0)[2].detail, '');
    assert.equal(requestSteps('placing', 12, 12)[2].detail, '');
});
