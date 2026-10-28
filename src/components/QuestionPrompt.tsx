import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Answers, Question } from '../lib/questions.js';
import { theme } from '../lib/theme.js';

type Props = { questions: Question[]; onSubmit: (answers: Answers) => void; onCancel: () => void };

const otherLabel = 'Type something else…';

export function QuestionPrompt({ questions, onSubmit, onCancel }: Props) {
  const instant = questions.length === 1 && !questions[0]!.multiSelect;
  const tabs = instant ? 1 : questions.length + 1;
  const [tab, setTab] = useState(0);
  const [cursors, setCursors] = useState<number[]>(() => questions.map(() => 0));
  const [answers, setAnswers] = useState<Answers>(() => questions.map(() => []));
  const [typing, setTyping] = useState<string | null>(null);

  const reviewing = tab === questions.length;
  const question = questions[tab];
  const cursor = cursors[tab] ?? 0;
  const optionCount = question ? question.options.length + 1 : 0;
  const unanswered = answers.findIndex((a) => !a.length);

  const move = (to: number) => {
    setTyping(null);
    setTab((to + tabs) % tabs);
  };
  const setCursor = (value: number) => setCursors((all) => all.map((c, i) => (i === tab ? (value + optionCount) % optionCount : c)));
  const setAnswer = (value: string[]) => {
    const next = answers.map((a, i) => (i === tab ? value : a));
    setAnswers(next);
    return next;
  };
  const choose = (value: string) => {
    if (!question) return;
    if (question.multiSelect) {
      const current = answers[tab]!;
      setAnswer(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
      return;
    }
    const next = setAnswer([value]);
    if (instant) return onSubmit(next);
    move(tab + 1);
  };
  const pick = (index: number) => {
    if (!question) return;
    if (index === question.options.length)
      return setTyping(question.multiSelect ? '' : (answers[tab]!.find((a) => !question.options.some((o) => o.label === a)) ?? ''));
    choose(question.options[index]!.label);
  };

  useInput((input, key) => {
    if (typing !== null) {
      if (key.escape) return setTyping(null);
      if (key.return) {
        const text = typing.trim();
        setTyping(null);
        return text ? choose(text) : undefined;
      }
      if (key.backspace || key.delete) return setTyping(typing.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setTyping(typing + input.replace(/[\r\n]+/g, ' '));
      return;
    }
    if (key.escape) return onCancel();
    if (key.rightArrow || (key.tab && !key.shift)) return move(tab + 1);
    if (key.leftArrow || (key.tab && key.shift)) return move(tab - 1);
    if (reviewing) {
      if (key.return) return unanswered === -1 ? onSubmit(answers) : move(unanswered);
      return;
    }
    if (key.upArrow) return setCursor(cursor - 1);
    if (key.downArrow) return setCursor(cursor + 1);
    if (/^[1-9]$/.test(input) && Number(input) <= optionCount) {
      setCursor(Number(input) - 1);
      return pick(Number(input) - 1);
    }
    if (input === ' ' && question?.multiSelect) return pick(cursor);
    if (key.return) {
      if (question?.multiSelect && answers[tab]!.length) return move(tab + 1);
      return pick(cursor);
    }
  });

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.caramel} paddingX={1}>
      {instant ? null : (
        <Box gap={2}>
          {questions.map((q, i) => (
            <Text key={i} color={i === tab ? theme.caramel : answers[i]!.length ? theme.mint : theme.muted} bold={i === tab}>
              {`${answers[i]!.length ? '✔' : '○'} ${q.header}`}
            </Text>
          ))}
          <Text color={reviewing ? theme.caramel : theme.muted} bold={reviewing}>
            ➤ Submit
          </Text>
        </Box>
      )}
      {question ? (
        <Box flexDirection="column" marginTop={instant ? 0 : 1}>
          <Text color={theme.cream} bold>
            {question.question}
          </Text>
          {[...question.options, { label: otherLabel, description: undefined }].map((option, i) => {
            const isOther = i === question.options.length;
            const custom = isOther ? answers[tab]!.filter((a) => !question.options.some((o) => o.label === a)) : [];
            const selected = isOther ? custom.length > 0 : answers[tab]!.includes(option.label);
            const mark = question.multiSelect ? (selected ? '[x] ' : '[ ] ') : selected ? '● ' : '';
            const active = i === cursor;
            return (
              <Box key={i}>
                <Text color={active ? theme.caramel : theme.muted}>{active ? '› ' : '  '}</Text>
                <Text color={active ? theme.caramel : selected ? theme.mint : theme.cream} wrap="truncate-end">
                  {`${i + 1}. ${mark}`}
                  {isOther && typing !== null ? (
                    <Text color={theme.cream}>
                      {typing}
                      <Text inverse> </Text>
                    </Text>
                  ) : isOther && custom.length ? (
                    custom.join('; ')
                  ) : (
                    option.label
                  )}
                  {option.description ? <Text color={theme.muted}>{`  ${option.description}`}</Text> : null}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {questions.map((q, i) => (
            <Text key={i} wrap="truncate-end">
              <Text color={theme.muted}>{`${q.header}: `}</Text>
              <Text color={answers[i]!.length ? theme.cream : theme.strawberry}>{answers[i]!.length ? answers[i]!.join('; ') : 'not answered'}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {typing !== null
            ? 'type your answer · enter save · esc back'
            : reviewing
              ? unanswered === -1
                ? 'enter submit all answers · ←→ review · esc cancel'
                : 'enter go to the unanswered question · ←→ review · esc cancel'
              : `${question?.multiSelect ? 'space toggle · enter next' : 'enter select'} · ↑↓ move · 1-${optionCount} pick${instant ? '' : ' · ←→ question'} · esc cancel`}
        </Text>
      </Box>
    </Box>
  );
}
