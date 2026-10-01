import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

/** Space kept above the question when it sits at the top of the view. */
export const TURN_GAP = 20;

/** Where the view should sit for the latest turn: the bottom while everything still fits,
 *  and never past the point where the question reaches the top. A long answer is then read
 *  from its beginning, like in any chat, instead of opening at its last line. */
export function turnScrollTarget(scrollHeight: number, clientHeight: number, questionTop: number): number {
  const bottom = Math.max(0, scrollHeight - clientHeight);
  return Math.min(bottom, Math.max(0, questionTop - TURN_GAP));
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * Keeps the latest question in view while its answer streams in (see `turnScrollTarget`).
 * Following stops as soon as the reader scrolls on their own, until the next question.
 * Questions are found by `data-role="user"` inside `contentRef`.
 */
export function useTurnScroll(
  contentRef: RefObject<HTMLElement>,
  messages: readonly { key: string; role: string }[],
): void {
  const follow = useRef<{ key: string; top: number | null } | null>(null);
  let lastQuestion: string | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastQuestion = messages[i].key;
      break;
    }
  }

  const apply = useRef(() => {
    const content = contentRef.current;
    const state = follow.current;
    if (!content || !state) return;
    const container = scrollParent(content);
    if (!container) return;
    // The reader moved the view since the last adjustment: leave it where they put it.
    if (state.top !== null && Math.abs(container.scrollTop - state.top) > 2) {
      follow.current = null;
      return;
    }
    const questions = content.querySelectorAll<HTMLElement>('[data-role="user"]');
    const question = questions[questions.length - 1];
    if (!question) return;
    const questionTop =
      question.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = turnScrollTarget(container.scrollHeight, container.clientHeight, questionTop);
    state.top = container.scrollTop;
  });

  // A new question (sent, picked from the suggestions or loaded with a past conversation)
  // starts a new follow.
  useLayoutEffect(() => {
    follow.current = lastQuestion ? { key: lastQuestion, top: null } : null;
  }, [lastQuestion]);

  useLayoutEffect(() => {
    apply.current();
  }, [messages]);

  // Cards, charts and fonts can change height after the state update that created them.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => apply.current());
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef]);
}
