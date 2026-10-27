import React, { useEffect, useRef, type ReactNode } from 'react';
import { Box, useBoxMetrics, type DOMElement } from 'ink';

type Props = {
  children: ReactNode;
  anchor: number | null;
  onMetrics: (max: number, height: number) => void;
};

export function ScrollView({ children, anchor, onMetrics }: Props) {
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const viewport = useBoxMetrics(viewportRef);
  const content = useBoxMetrics(contentRef);
  const max = Math.max(0, content.height - viewport.clientHeight);

  useEffect(() => onMetrics(max, viewport.clientHeight), [max, viewport.clientHeight]);

  const pinned = anchor === null;

  return (
    <Box
      ref={viewportRef}
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      overflowY="hidden"
      justifyContent={pinned && max > 0 ? 'flex-end' : 'flex-start'}
      contentOffsetY={pinned ? 0 : Math.min(anchor, max)}
    >
      <Box ref={contentRef} flexDirection="column" flexShrink={0} paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}
