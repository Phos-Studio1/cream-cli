export type QuestionOption = { label: string; description?: string };

export type Question = { question: string; header: string; options: QuestionOption[]; multiSelect: boolean };

export type Answers = string[][];

const maxQuestions = 4;
const maxOptions = 6;

export function parseQuestions(raw: unknown): Question[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'questions must be a non-empty array.';
  if (raw.length > maxQuestions) return `Ask at most ${maxQuestions} questions at a time.`;
  const questions: Question[] = [];
  for (const [index, item] of raw.entries()) {
    const question = String(item?.question ?? '').trim();
    if (!question) return `Question ${index + 1} has no text.`;
    const options = (Array.isArray(item?.options) ? item.options : [])
      .map((option: unknown) =>
        typeof option === 'string'
          ? { label: option.trim() }
          : { label: String((option as QuestionOption)?.label ?? '').trim(), description: (option as QuestionOption)?.description?.trim() || undefined },
      )
      .filter((option: QuestionOption) => option.label && !/^other\b/i.test(option.label));
    if (options.length < 2) return `Question ${index + 1} needs at least 2 options.`;
    if (options.length > maxOptions) return `Question ${index + 1} has more than ${maxOptions} options.`;
    const header = String(item?.header ?? '').trim() || `Q${index + 1}`;
    questions.push({ question, header: header.slice(0, 16), options, multiSelect: Boolean(item?.multi_select ?? item?.multiSelect) });
  }
  return questions;
}

export function formatAnswers(questions: Question[], answers: Answers): string {
  return [
    'The user answered:',
    ...questions.map((q, i) => `${i + 1}. ${q.question}\n   → ${answers[i]?.length ? answers[i]!.join('; ') : '(no answer)'}`),
  ].join('\n');
}
