import { describe, expect, it } from 'vitest';
import { TURN_GAP, turnScrollTarget } from './turnScroll';

describe('turnScrollTarget', () => {
  it('goes to the bottom while the whole answer fits under the question', () => {
    // 1000 px of content in a 600 px view, question at 700: the bottom (400) is above it.
    expect(turnScrollTarget(1000, 600, 700)).toBe(400);
  });

  it('stops with the question at the top when the answer is longer than the view', () => {
    // Question at 300 followed by 1500 px of answer: the view stops at the question.
    expect(turnScrollTarget(1800, 600, 300)).toBe(300 - TURN_GAP);
  });

  it('never scrolls above the top or when nothing overflows', () => {
    expect(turnScrollTarget(400, 600, 10)).toBe(0);
    expect(turnScrollTarget(1800, 600, 5)).toBe(0);
  });
});
