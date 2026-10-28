import { describe, expect, it } from 'vitest';
import { formatAnswers, parseQuestions, type Question } from '../src/lib/questions.js';

describe('parseQuestions', () => {
  it('normalizes questions, string options and drops "Other"', () => {
    const parsed = parseQuestions([
      { question: 'Which stack?', header: 'Stack', options: ['React', { label: 'Vue', description: 'Lighter' }, 'Other'] },
      { question: 'Which extras?', options: ['Tests', 'CI'], multi_select: true },
    ]) as Question[];
    expect(parsed[0]).toEqual({
      question: 'Which stack?',
      header: 'Stack',
      options: [{ label: 'React', description: undefined }, { label: 'Vue', description: 'Lighter' }],
      multiSelect: false,
    });
    expect(parsed[1]).toMatchObject({ header: 'Q2', multiSelect: true });
  });

  it('rejects invalid input with a message for the model', () => {
    expect(parseQuestions([])).toMatch(/non-empty/);
    expect(parseQuestions([{ question: 'x', options: ['a'] }])).toMatch(/at least 2 options/);
    expect(parseQuestions(Array.from({ length: 5 }, () => ({ question: 'q', options: ['a', 'b'] })))).toMatch(/at most 4/);
  });
});

describe('formatAnswers', () => {
  it('lists every question with its answers', () => {
    const questions = parseQuestions([
      { question: 'Name?', options: ['A', 'B'] },
      { question: 'Extras?', options: ['X', 'Y'], multi_select: true },
    ]) as Question[];
    expect(formatAnswers(questions, [['A'], ['X', 'custom']])).toBe('The user answered:\n1. Name?\n   → A\n2. Extras?\n   → X; custom');
  });
});
